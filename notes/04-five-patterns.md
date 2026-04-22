# Stage 4 — Five Patterns, Side by Side

> The spine of the 2-hour walkthrough. Five patterns, each read end-to-end in both repos, with a "highlight this on Saturday" note at the end of every section.

---

## Pattern 1 — Tool Contract

### Claude Code

**Files:** `claude-code/src/Tool.ts` (794 lines, defines the interface), `claude-code/src/tools.ts` (390 lines, the registry), every subdir under `claude-code/src/tools/` (40 directories).

**The contract:** `Tool<Input, Output, Progress>` at `claude-code/src/Tool.ts:362-695` — a **~60-method interface** covering execution, permissions, validation, schema, UI rendering, prompt contribution, search metadata, and analytics.

**Key fields** (abridged — real one has triple this):
```ts
type Tool<Input, Output, Progress> = {
  name: string
  inputSchema: Input                                           // Zod v4
  inputJSONSchema?: ToolInputJSONSchema                        // MCP tools bypass Zod
  call(args, context, canUseTool, parentMessage, onProgress): Promise<ToolResult<Output>>
  checkPermissions(input, context): Promise<PermissionResult>  // permissions are a method
  validateInput?(input, context): Promise<ValidationResult>    // runs before permissions
  isConcurrencySafe(input): boolean                            // drives parallel batching
  isReadOnly(input): boolean
  isDestructive?(input): boolean
  isEnabled(): boolean
  prompt(options): Promise<string>                             // system-prompt contribution
  renderToolUseMessage(input, options): React.ReactNode        // Ink UI
  renderToolResultMessage?(content, progress, options): React.ReactNode
  renderGroupedToolUse?(toolUses, options): React.ReactNode    // multi-instance collapse
  mapToolResultToToolResultBlockParam(content, id): ToolResultBlockParam
  toAutoClassifierInput(input): unknown                        // for the auto-mode security classifier
  maxResultSizeChars: number                                   // over this → persisted to disk
  backfillObservableInput?(input): void                        // UI-visible enrichment
  interruptBehavior?(): 'cancel' | 'block'
  getActivityDescription?(input): string | null                // spinner text
  // … ~20 more optional rendering/telemetry hooks
}
```

**Notable design choices:**
- **Permissions are a first-class method** on every tool, not an external wrapper. A tool knows which inputs need user approval (e.g., `BashTool` reads its own `bashPermissions.ts` to decide).
- **UI rendering is part of the contract.** Tools ship their own Ink React components — there's no generic renderer. This is why `src/tools/BashTool/` has 18 files.
- **`buildTool()` factory at `Tool.ts:783-792`** fills in safe defaults (permissions allow-by-default, concurrency unsafe, not read-only) so simple tools stay concise.
- **`backfillObservableInput`** at `Tool.ts:481` — mutate a *copy* of the input after streaming for the UI transcript, without corrupting the prompt-cache-bound original.

### pi-mono

**Files:** `pi-mono/packages/agent/src/types.ts:295-318` defines `AgentTool`. Consumers wrap `ToolDefinition`s via `pi-mono/packages/coding-agent/src/core/tools/tool-definition-wrapper.ts`. Every concrete tool lives under `packages/coding-agent/src/core/tools/` or `packages/mom/src/tools/`.

**The contract:** `AgentTool<TParameters, TDetails>` at `pi-mono/packages/agent/src/types.ts:295` — a **7-method interface** extending the base `Tool` from `pi-ai`.

**Key fields:**
```ts
interface AgentTool<TParameters extends TSchema, TDetails> extends Tool<TParameters> {
  name: string
  label: string                                                // UI label
  description: string
  parameters: TParameters                                      // TypeBox — JSON Schema at runtime
  prepareArguments?(args: unknown): Static<TParameters>        // pre-validation coercion
  execute(toolCallId, params, signal, onUpdate?): Promise<AgentToolResult<TDetails>>
  executionMode?: 'sequential' | 'parallel'
}
```

That's it. No permissions, no UI rendering, no system-prompt contribution, no analytics.

**Notable design choices:**
- **TypeBox schemas** (`@sinclair/typebox`) instead of Zod — TypeBox emits JSON Schema at runtime, which is the shape providers need anyway, so there's no serialization step. See `bash.ts:33-36` for a real example.
- **Tools throw on failure.** The loop catches and converts to an error `AgentToolResult` (`agent-loop.ts:578-584`). Contrast with Claude Code where tools return `{ data: … }` and never throw.
- **UI rendering is outside the tool.** Consumers like `coding-agent` layer their own `ToolDefinition` with extra fields (`render`, `renderResult`) and then `wrapToolDefinition()` strips them down to just `AgentTool` for the runtime.
- **No `checkPermissions` method.** Permissioning is pushed entirely to `beforeToolCall`/`afterToolCall` hooks at the `AgentLoopConfig` level.

### Convergence

Both use **JSON Schema at runtime** for parameter validation (Zod compiles to it; TypeBox is it), and both pass a validated typed `args` to the tool body. Both support per-tool concurrency hints (`isConcurrencySafe` vs `executionMode`). Both stream partial results back mid-execution (`onProgress` vs `onUpdate`).

### Divergence

Claude Code folds **permissions, UI, prompt contribution, grouping, truncation, and telemetry** into the tool contract itself. Every tool is a self-contained React package. pi keeps the contract minimal — 7 methods, no UI, no permissions — and lets consumers layer those concerns outside.

### One insight to highlight on Saturday

**"Look at a single tool in each repo. `claude-code/src/tools/BashTool/` has 18 files. `pi-mono/packages/coding-agent/src/core/tools/bash.ts` is one file. Both implement the same tool. Ask the room: which shape fits your team?"**

---

## Pattern 2 — Permission Model

### Claude Code

**Files:** `claude-code/src/hooks/toolPermission/PermissionContext.ts` (~1,200 lines — the queue and decision orchestrator), `claude-code/src/hooks/toolPermission/handlers/` (handler plugins), `claude-code/src/types/permissions.ts` (types), per-tool `checkPermissions` implementations (e.g. `tools/BashTool/bashPermissions.ts`).

**The contract:** Four modes (`default`, `plan`, `bypassPermissions`, `auto`). Every tool invocation runs through a **4-stage gate**:

1. **Tool's own `checkPermissions(input, context)`** returning `PermissionResult` — can be `{ behavior: 'allow' | 'deny' | 'ask', reason?, updatedInput? }`.
2. **Hook scripts** via `executePermissionRequestHooks` — user-defined shell commands wired in `src/utils/hooks.ts` (5,023 LOC). See `PermissionContext.ts:26`.
3. **Auto-mode classifier** via `awaitClassifierAutoApproval` — an ML model that decides in `auto` mode. See `PermissionContext.ts:15`.
4. **User dialog** — pushed through the React permission queue (`PermissionQueueOps` at `PermissionContext.ts:57-62`, decoupled from React for testability).

Permission rules use **wildcard patterns** (`Bash(git *)`, `FileEdit(/src/*)`, `FileRead(*)`) stored under four sources per `ToolPermissionContext` (`Tool.ts:123-138`): `alwaysAllowRules`, `alwaysDenyRules`, `alwaysAskRules`, plus `strippedDangerousRules` for the classifier.

**Notable design choices:**
- **"Always allow" persistence** — when user picks "always allow", `persistPermissionUpdates` (`PermissionContext.ts:37`) writes the rule to settings so it never prompts again.
- **Classifier fallback threshold** via `DenialTrackingState` (`Tool.ts:283`) — if the auto classifier rejects too many, fall back to prompting.
- **Subagent prompt-avoidance** — `shouldAvoidPermissionPrompts` on `ToolPermissionContext` (`Tool.ts:133`) auto-denies for background agents that can't show UI.
- **Deny-rule filtering happens at tool-pool assembly, not just call-time** — `filterToolsByDenyRules` at `tools.ts:262` strips denied MCP-server tools before the model even sees them in the prompt. Keeps the tool list clean and the prompt cache stable.

### pi-mono

**Files:** The agent core has **no permission system**. The seam is `beforeToolCall` / `afterToolCall` at `pi-mono/packages/agent/src/agent-loop.ts:517-534` and `:598-621`. Consumers implement whatever they want there.

**The contract:**
```ts
beforeToolCall?: (ctx: BeforeToolCallContext, signal?: AbortSignal) => Promise<{ block?: boolean; reason?: string } | undefined>
afterToolCall?:  (ctx: AfterToolCallContext, signal?: AbortSignal) => Promise<{ content?; details?; isError? } | undefined>
```

That's it — two optional async callbacks. Return `{ block: true, reason: 'why' }` in `beforeToolCall` to refuse.

**How coding-agent uses it:** `pi-mono/packages/coding-agent/src/core/agent-session.ts:372-419` installs `beforeToolCall` / `afterToolCall` once per agent instance. They delegate to an `ExtensionRunner` that fires any user-registered `tool_call` / `tool_result` extension handlers (third-party TypeScript code).

**How mom (Slack bot) uses it:** nothing — mom relies on the Docker sandbox boundary instead of per-tool permission checks.

**Notable design choices:**
- **Permissions are a consumer concern.** Both concrete products (`coding-agent`, `mom`) make different choices: the CLI runs extension handlers, the bot trusts its sandbox.
- **No `default`/`plan`/`bypass`/`auto` modes** — pi has no analog. The README explicitly says "Pi ships with powerful defaults but skips features like sub agents and plan mode."
- **No persisted "always allow" rules.** If a consumer wants that, they build it into their `beforeToolCall`.

### Convergence

Both treat permissioning as **a wrapping of the tool-call lifecycle** — something runs before the tool, something can block it, something runs after. Both give the hook access to the validated args and the full assistant message that produced the call.

### Divergence

Claude Code ships a **complete permission runtime**: 4 modes, 4 decision stages, persistent rules, wildcard patterns, UI dialogs, ML classifier, subagent-aware auto-deny. pi ships **two callback slots** and expects the consumer to build the rest. The trade: Anthropic shipping for millions of users absolutely needs plan mode + user prompts + allowlist persistence out of the box; a toolkit that could be embedded in a trusted CI runner would find that machinery in the way.

### One insight to highlight on Saturday

**"`beforeToolCall` + `afterToolCall` is the whole pi-mono permission API. Claude Code's equivalent is 1,200 lines. Which axis is your product on — generality or policy?"**

---

## Pattern 3 — Streaming

### Claude Code

**Files:** `claude-code/src/services/api/claude.ts` (3,420 LOC — the Anthropic client), `claude-code/src/query.ts:659-863` (the loop's consumer), `claude-code/src/services/tools/toolOrchestration.ts` (tool-level streaming).

**The contract:** `deps.callModel(...)` returns an async generator. The loop does `for await (const message of deps.callModel(...))` at `query.ts:659`. Each yielded `message` is one of: an `assistant` SDK message (with full content blocks), a partial tool_use block, a system info message, a stop-reason signal. The loop:

1. **Backfills input fields on a clone** (`query.ts:747-787`) for the UI transcript — never mutates the original, since the original bytes are prompt-cache-bound.
2. **Withholds recoverable errors** (`query.ts:799-822`) — a 413 isn't yielded immediately; if collapse-drain or reactive-compact can fix it, the error never reaches the user.
3. **Registers tool_use blocks with the `StreamingToolExecutor`** as they arrive (`query.ts:838-844`) — tools start executing *during* streaming, before the assistant turn finishes. Gated by `config.gates.streamingToolExecution`.
4. **Yields the (possibly cloned) message to the REPL** via `yield yieldMessage` (`query.ts:824`).

**Notable design choices:**
- **Streaming tool execution is a first-class design choice** — the executor (`query.ts:562-568`) runs tools concurrently with the model's generation. When the tool finishes before the assistant turn ends, the result is yielded immediately (`query.ts:851-862`) and the executor auto-fills a synthetic result if aborted.
- **Fallback model swap is a tombstone-and-retry** — orphaned partial assistant messages get `{ type: 'tombstone', message }` yielded (`query.ts:717`) so the UI and transcript delete them. Thinking-block signatures get stripped (`query.ts:928`) because they're model-bound.
- **Prompt caching is byte-sensitive** — comments throughout (e.g. `query.ts:743-746`) warn that any mutation of outgoing messages will bust the cache.

### pi-mono

**Files:** `pi-mono/packages/ai/src/providers/*.ts` (14 provider files — each emits the same event shape), `pi-mono/packages/ai/src/utils/event-stream.ts` (`AssistantMessageEventStream` and `EventStream` classes), `pi-mono/packages/agent/src/agent-loop.ts:276-319` (consumer).

**The contract:** Every provider returns an `AssistantMessageEventStream` that emits a **9-event discriminated union**:

| Event | Meaning |
|---|---|
| `start` | First byte received, partial assistant message initialized |
| `text_start` / `text_delta` / `text_end` | Text content, chunk-by-chunk |
| `thinking_start` / `thinking_delta` / `thinking_end` | Thinking content, chunk-by-chunk (same shape as text) |
| `toolcall_start` / `toolcall_delta` / `toolcall_end` | Tool call JSON, chunk-by-chunk (partial JSON before `_end`) |
| `done` | Normal terminal — `response.result()` is the final `AssistantMessage` |
| `error` | Terminal error — `response.result()` has `stopReason: 'error'` |

The loop consumes the stream in a single switch at `agent-loop.ts:276-319`. Every non-terminal event emits `message_update` through the agent's subscriber API, carrying both the delta event and the current `partialMessage`. `done`/`error` emits `message_end` with the final message and returns.

**Notable design choices:**
- **All providers emit the same events.** Anthropic SSE, OpenAI SSE, Google's custom format, Bedrock's Converse-stream — each provider file contains the normalization logic. This is the whole point of `packages/ai/`.
- **Tool calls are first-class streamed content** — `toolcall_delta` events carry the partial JSON so the UI can render "the model is typing a tool call" in real time. Consumers can parse partial JSON via `packages/ai/src/utils/json-parse.ts`.
- **Tool execution is strictly post-stream.** No equivalent of Claude Code's `StreamingToolExecutor` — the loop waits for `done`/`error`, then dispatches (`agent-loop.ts:205-212`). Tool calls collected from `message.content.filter(c => c.type === 'toolCall')`.
- **`validateToolArguments` is called before every tool execute** (`agent-loop.ts:516`) — provider-side JSON is not trusted.

### Convergence

Both stream deltas to a consumer rather than buffering whole turns. Both separate thinking/reasoning as its own sub-stream. Both let consumers render "typing" UIs for tool calls. Both pass validated, typed arguments to the tool body.

### Divergence

The headline: **Claude Code starts tools mid-stream; pi finishes the stream first, then runs tools.** The payoff on Claude Code's side is latency (a slow tool can run in parallel with the assistant's continued generation). The payoff on pi's side is simplicity — no tombstoning, no "what if the assistant's next token overrides the tool call", no orphan-result cleanup on abort.

The other divergence is **provider normalization**. Claude Code's `services/api/claude.ts` only speaks to Anthropic. pi's `packages/ai/` speaks to 11 providers and has an entire sub-package dedicated to making them look identical. That's a ~28K LOC commitment to multi-provider that Claude Code didn't need to make.

### One insight to highlight on Saturday

**"pi's 9-event stream is a protocol. Every provider emits the exact same events. That's why the same `Agent` can drive Anthropic, OpenAI, Google, Bedrock, Mistral — the loop doesn't know which one it's talking to. Worth copying this protocol before writing your own provider client."**

---

## Pattern 4 — Context / State Management

### Claude Code

**Files (conversation state):** `claude-code/src/utils/messages.ts` (5,513 LOC — message construction/normalization), `claude-code/src/utils/sessionStorage.ts` (5,106 LOC — session persist/resume), `claude-code/src/state/AppStateStore.ts` (global mutable store), `claude-code/src/context/` (React context providers).

**Files (compaction):** `claude-code/src/services/compact/` — **11 files**, each a distinct strategy:
- `autoCompact.ts` — proactive compaction when context usage exceeds a threshold
- `microCompact.ts` — fine-grained compaction of individual tool results
- `apiMicrocompact.ts` — server-side cached microcompaction
- `snipCompact.ts` (in `coordinator/snip*.ts` via re-export) — surgical tool-result removal
- `sessionMemoryCompact.ts` — compaction specifically for session-memory subagents
- `postCompactCleanup.ts`, `grouping.ts`, `prompt.ts`, `compactWarningHook.ts`, `compactWarningState.ts`, `timeBasedMCConfig.ts`

Plus `src/services/compact/` has **context-collapse** (progressive summarization) and **reactive compact** (triggered by 413 responses).

**The contract:** Conversation history is a flat `Message[]` that flows through a pipeline on every loop iteration (`query.ts:365-467`):

```
messages
  → applyToolResultBudget (per-turn aggregate size cap)
  → snipCompactIfNeeded (feature('HISTORY_SNIP'))
  → microcompact
  → contextCollapse.applyCollapsesIfNeeded
  → autocompact
  → messagesForQuery (sent to API)
```

If the API returns 413 anyway (`query.ts:1085-1183`): try **collapse-drain** first (cheap, keeps granular context), then **reactive compact** (full summary). If that fails, surface the error.

**Notable design choices:**
- **Task budget survives compaction.** The server-side `task_budget.remaining` counter is recomputed at each compact boundary (`query.ts:504-515`) — the agent tracks what got summarized away so billing/budget policy stays honest.
- **Prompt-cache safety is pervasive.** Every compaction strategy documents how it preserves the outgoing bytes the server caches on.
- **Multi-layer recovery with death-spiral guards.** The comments at `query.ts:1292-1297` are a crystal of hard-won experience: *"Preserve the reactive compact guard — if compact already ran and couldn't recover from prompt-too-long, retrying after a stop-hook blocking error will produce the same result. Resetting to false here caused an infinite loop: compact → still too long → error → stop hook blocking → compact → …"*
- **Memory system** — `src/memdir/` + `/memory` command + extractMemories service. CLAUDE.md files at project and user scope, plus auto-extracted memories from conversations.

### pi-mono

**Files (conversation state):** `pi-mono/packages/agent/src/types.ts:256-281` (`AgentState`), `pi-mono/packages/coding-agent/src/core/session-manager.ts` (1,425 LOC — session file format), `pi-mono/packages/coding-agent/src/core/agent-session.ts` (3,082 LOC — session glue).

**Files (compaction):** `pi-mono/packages/coding-agent/src/core/compaction/` — **4 files**:
- `compaction.ts` — pure functions: `shouldCompact`, `estimateContextTokens`, `findCutPoint`, `generateSummary`
- `branch-summarization.ts` — per-branch summaries for session branching
- `utils.ts`, `index.ts`

**The contract:** `AgentState.messages` is the transcript. Consumers persist it however they want. coding-agent uses a **JSONL session file** format (`session-manager.ts:28-150`) with versioned entries:

```ts
type SessionEntry =
  | SessionMessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | LabelEntry
  | SessionInfoEntry
  | CustomMessageEntry
```

Compaction is a **single entry point**: `compact(entries, settings, …)` returns `CompactionResult` with summary messages + tracked file ops (read/modified files survive the compaction so the next turn still knows which files were touched). Triggered by `shouldCompact(contextTokens, contextWindow, settings)` comparing usage to the model's window.

**Notable design choices:**
- **Compaction is pure.** The functions in `compaction.ts` don't do I/O; the session manager handles that. After compaction, the session is reloaded from disk.
- **File-operation memory.** `CompactionDetails` (`compaction.ts:33-36`) tracks `readFiles` and `modifiedFiles` across compactions — so even after a summary, the agent knows what it has and hasn't touched. Claude Code has nothing quite this explicit.
- **Branch summaries.** Sessions can branch (fork a point in history) and each branch gets its own summary (`branch-summarization.ts`). Enables `/branch` and "undo" without losing memory.
- **No in-loop compaction.** The agent loop itself never compacts. The consumer calls `compact()` between agent runs.

### Convergence

Both understand compaction as **summarization-plus-preserved-tail**: the old history gets summarized, a tail of recent messages is kept verbatim. Both compute token estimates client-side to decide when to trigger. Both persist sessions to disk and support resume.

### Divergence

Claude Code compacts **inside the loop**, with five distinct strategies (snip, microcompact, apiMicrocompact, autocompact, reactive-compact) layered around each model call, plus context-collapse as a separate recovery path. pi compacts **between runs**, with one strategy. Claude Code's approach handles long-running interactive sessions where the model might blow the window mid-turn; pi's approach assumes turns are bounded and the consumer can trigger compaction on a clean boundary.

Claude Code's session file is a proprietary format in `utils/sessionStorage.ts`. pi's is versioned JSONL with a stable schema you could read in a spreadsheet.

### One insight to highlight on Saturday

**"Compaction is where the abstractions leak. Claude Code folds five compaction strategies into the loop with cross-layer death-spiral guards. pi keeps one, outside the loop. The right answer depends on whether your users hit the window mid-turn — which in turn depends on turn length, context size, and whether you're interactive."**

---

## Pattern 5 — Sub-agent / Multi-agent Orchestration

### Claude Code

**Files:** `claude-code/src/coordinator/coordinatorMode.ts` (the mode logic), `claude-code/src/tools/AgentTool/` (16 files — sub-agent spawning), `claude-code/src/tools/SendMessageTool/` (inter-agent messaging), `claude-code/src/tools/TeamCreateTool/` + `TeamDeleteTool/`, `claude-code/src/tasks/LocalAgentTask/`, `tasks/InProcessTeammateTask/`, `tasks/RemoteAgentTask/`.

**The contract:** Four spawning mechanisms, each with a different lifecycle:

| Mechanism | Where | Lifecycle |
|---|---|---|
| **AgentTool** | `src/tools/AgentTool/AgentTool.tsx` (entry), `runAgent.ts:248` (runner) | Synchronous sub-agent call; parent waits or backgrounds (`getAutoBackgroundMs()`) |
| **TeamCreateTool** / `InProcessTeammateTask` | `src/tasks/InProcessTeammateTask/` | Parallel team of peer agents with shared mailbox |
| **RemoteAgentTask** | `src/tasks/RemoteAgentTask/` | Agent running on a remote machine (Anthropic's infra) |
| **Coordinator mode** | `src/coordinator/coordinatorMode.ts` (gated `feature('COORDINATOR_MODE')`) | Main agent orchestrates parallel workers with a restricted tool allowlist |

Messaging: `SendMessageTool` writes to `teammateMailbox.ts` (`SendMessageTool.ts:35-40`), with shutdown request/approve/reject messages as first-class primitives.

**Notable design choices:**
- **`forkSubagent` reuses parent's prompt cache.** The child inherits the parent's system-prompt bytes frozen at fork time (`Tool.ts:297-299` — `renderedSystemPrompt`), avoiding a cache-miss on fork.
- **Coordinator workers have a restricted tool set** — `INTERNAL_WORKER_TOOLS` at `coordinatorMode.ts:31-35` allows only `Team*`, `SendMessage`, `SyntheticOutput`; `ASYNC_AGENT_ALLOWED_TOOLS` at `constants/tools.ts` is the broader worker allowlist.
- **Sub-agent summaries via Haiku** — `AgentSummary` service runs a cheap model in parallel to produce per-agent summaries for the parent (`services/AgentSummary/`).
- **Three task backends** (in-process, local child-process, remote) **with one tool interface** — `AgentTool` resolves which backend at call-time.

### pi-mono

**Files:** sub-agents are **not in the agent core** (`packages/agent/`) but **are shipped as a first-class extension example** at `pi-mono/packages/coding-agent/examples/extensions/subagent/index.ts` (988 LOC). Plan mode is similarly at `examples/extensions/plan-mode/index.ts`. The extension SDK itself is at `packages/coding-agent/src/core/extensions/` (5 files: `types.ts` 1,500 LOC, `loader.ts`, `runner.ts`, `wrapper.ts`, `index.ts`).

**The contract:** The core `packages/agent/` has no sub-agent primitive — you can't spawn a child Agent through a tool in the agent core alone. What pi provides instead is an **extension SDK**: extensions are TypeScript modules loaded from `~/.pi/agent/extensions/` or `.pi/extensions/` that can register tools, intercept events, add commands. The SDK exposes:

- **`pi.registerTool()`** — add arbitrary tools the LLM can call (`examples/extensions/subagent/index.ts:432`).
- **`pi.registerCommand()`** — add slash commands.
- **Lifecycle events** — 20+ subscribable events: `agent_start/end`, `turn_start/end`, `message_*`, `tool_execution_*`, `tool_call`, `tool_result`, `session_*`, `context`, `before_provider_request`, `after_provider_response`, `user_bash`, `input` (see `extensions/types.ts:907-928` for the `ExtensionEvent` union).
- **`ExtensionContext`** (`extensions/types.ts:286-316`) — access to `ui`, `cwd`, `sessionManager`, `modelRegistry`, `model`, `abort()`, `compact()`, `getSystemPrompt()`, etc.

**The sub-agent extension specifically** (`examples/extensions/subagent/index.ts`):

- Registers a single tool named `subagent` with 3 modes: `single`, `parallel`, `chain` (sequential with `{previous}` placeholder for piping output).
- **Spawns a separate `pi` process per sub-agent** (`spawn(invocation.command, …)` at line 306) — `pi --mode json -p --no-session` with isolated context window.
- Streams JSONL output back from the child process (`processLine` at line 313) — every `message_end` event updates the parent's UI in real time.
- Concurrency limit of 4, max 8 parallel tasks (lines 27-28).
- Agents discovered from `~/.pi/agent/agents` (user scope) or `.pi/agents` (project scope) — markdown files with a `systemPrompt` and optional `model`/`tools` override.
- Includes a project-agent confirmation dialog (`ctx.ui.confirm(...)` at line 489) — user approves before running repo-controlled agents.

**Notable design choices:**
- **Sub-agents run in a separate OS process**, not in-process like Claude Code's `AgentTool`. That's heavier (process spawn, fresh model load, no shared memory) but gives genuine isolation — the child can't accidentally mutate parent state, and an abort is a SIGTERM. Claude Code's in-process fork shares the parent's prompt cache; pi's subprocess doesn't.
- **Sub-agent definitions are markdown files on disk**, not code. A user can write a new "researcher" or "reviewer" agent in a markdown file without writing TypeScript.
- **~60 example extensions** at `examples/extensions/` — `permission-gate.ts`, `confirm-destructive.ts`, `git-checkpoint.ts`, `protected-paths.ts`, `custom-compaction.ts`, `handoff.ts`, `minimal-mode.ts`, `plan-mode/`, `subagent/`, `todo.ts`, and many more. Each is a working implementation of a feature Anthropic would build into the core.
- **The extension SDK is pi's equivalent of Claude Code's feature flags** — instead of `feature('COORDINATOR_MODE')` dead-code-eliminating at build time, pi loads extensions at runtime from user directories.

### Convergence

Both support sub-agents. Both let you restrict a sub-agent to a subset of tools (Claude Code via `ASYNC_AGENT_ALLOWED_TOOLS` and agent-definition-level `tools:` field; pi via `agent.tools` array passed as `--tools`). Both can stream child output back into the parent's UI.

### Divergence

**Where the code lives.** Claude Code bakes sub-agents into the core binary: `src/tools/AgentTool/` (16 files), `src/coordinator/`, `src/tasks/` (5 task types), `src/tools/SendMessageTool/`, `TeamCreateTool`, `TeamDeleteTool`. Extension points are feature flags + `USER_TYPE === 'ant'` gates. pi ships sub-agents **as one of many example extensions** — `examples/extensions/subagent/` — that a user copies to `~/.pi/agent/extensions/`. No feature flags; the user decides what gets loaded.

**How sub-agents run.** Claude Code's `AgentTool` spawns an in-process sub-agent (with a remote-task backend too) that shares the parent's memory and prompt cache. pi's `subagent` extension `spawn()`s a separate `pi` process per invocation — simpler isolation, heavier startup.

**Depth of the built-in feature-set.** Claude Code has Haiku-generated per-agent summaries, inter-agent messaging via mailbox (`SendMessageTool` + `teammateMailbox.ts`), team shutdown request/approve/reject protocols, coordinator mode with restricted worker tool allowlist. pi has a reference single/parallel/chain implementation you can extend.

### One insight to highlight on Saturday

**"Both repos answer the sub-agent question — but they answer it in very different layers. Claude Code: 'Here's the runtime, built in.' pi-mono: 'Here's the extension SDK, and here's a reference sub-agent extension — copy and modify it.' Worth discussing with the room: when you build your next agentic product, do you want your users to get sub-agents as a feature flag in your binary, or as a 988-line example they customize? Both positions are defensible; they assume different things about who your user is."**

---

## The thread running through all five patterns

Each pattern shows the **same trade-off rotated onto a different axis:**

| Pattern | Claude Code | pi-mono |
|---|---|---|
| Tool contract | 60 methods, UI+permissions+prompt in one class | 7 methods in core; UI/permissions layered by consumer or extension |
| Permission model | 1,200-line 4-stage runtime, 4 modes, persisted rules | 2 callbacks in core + extension SDK; example extensions (`permission-gate.ts`, `confirm-destructive.ts`) bolt on policy |
| Streaming | Mid-stream tool execution, fallback tombstoning, withheld errors | Post-stream tool execution, 9-event protocol, 11 providers |
| Context/state | 5 in-loop compaction strategies + cross-layer spiral guards | 1 pure compaction function in core, called between turns; `custom-compaction.ts` extension for overrides |
| Multi-agent | 4 mechanisms baked in (AgentTool, Team*, coordinator, remote tasks), 3 task backends, shared mailbox, cache-preserving fork | Not in core; shipped as the `subagent/` example extension (988 LOC) that `spawn()`s a child `pi` process per sub-agent |

**Claude Code folds things inward.** Policy, recovery, UI, sub-agents — all inside the loop, inside the tool contract, inside one binary. One cohesive product, one place for the institutional knowledge to live. Variation happens via feature flags and Bun dead-code elimination.

**pi-mono pushes things outward.** Retries live in providers. Permissions live in consumers. Compaction lives between turns. **Sub-agents, plan mode, permission gates, git checkpointing — all shipped as example extensions at `packages/coding-agent/examples/extensions/`, not core code.** The runtime is ~1,900 lines and could run in a browser unchanged; the extension SDK is where the "big features" live, user-loaded from `~/.pi/agent/extensions/`.

**Neither is the right answer.** The question for the room: *do you want variation at build time (feature flags, dead-code elimination, one binary) or at runtime (user-loaded extensions, per-machine config, many binaries possible)?*

---

## Code references — consolidated jump table

### Pattern 1 — Tool Contract
- Claude Code: `claude-code/src/Tool.ts:362` (`Tool<…>` type), `:783` (`buildTool`), `:757` (`TOOL_DEFAULTS`), `:481` (`backfillObservableInput`)
- pi-mono: `pi-mono/packages/agent/src/types.ts:295` (`AgentTool`), `pi-mono/packages/coding-agent/src/core/tools/tool-definition-wrapper.ts:5` (`wrapToolDefinition`), `pi-mono/packages/coding-agent/src/core/tools/bash.ts:33-36` (TypeBox schema example)

### Pattern 2 — Permission Model
- Claude Code: `claude-code/src/hooks/toolPermission/PermissionContext.ts:15` (classifier), `:26` (hooks), `:37` (persist), `:57-62` (`PermissionQueueOps`); `claude-code/src/Tool.ts:500-503` (`checkPermissions` method), `:123-138` (`ToolPermissionContext`), `:133` (`shouldAvoidPermissionPrompts`); `claude-code/src/tools.ts:262` (`filterToolsByDenyRules`)
- pi-mono: `pi-mono/packages/agent/src/agent-loop.ts:517-534` (`beforeToolCall` wiring), `:598-621` (`afterToolCall`); `pi-mono/packages/coding-agent/src/core/agent-session.ts:372-419` (consumer wiring via `ExtensionRunner`)

### Pattern 3 — Streaming
- Claude Code: `claude-code/src/query.ts:659-708` (stream consumption), `:747-787` (clone-and-backfill), `:799-822` (error withholding), `:838-844` (streaming tool executor registration), `:717` (fallback tombstones), `:928` (signature strip)
- pi-mono: `pi-mono/packages/agent/src/agent-loop.ts:276-319` (9-event switch), `:516` (`validateToolArguments`); `pi-mono/packages/ai/src/utils/event-stream.ts` (`AssistantMessageEventStream`); 14 provider files under `pi-mono/packages/ai/src/providers/`

### Pattern 4 — Context/State
- Claude Code: `claude-code/src/query.ts:365-467` (pre-call pipeline), `:504-515` (task-budget carry-over), `:1085-1183` (413 recovery), `:1292-1297` (death-spiral comment); 11 files under `claude-code/src/services/compact/`
- pi-mono: `pi-mono/packages/coding-agent/src/core/compaction/compaction.ts:33-36` (`CompactionDetails`), `:135` (`calculateContextTokens`), `:219` (`shouldCompact`), `:386` (`findCutPoint`), `:530` (`generateSummary`); `pi-mono/packages/coding-agent/src/core/session-manager.ts:28-150` (session file schema)

### Pattern 5 — Sub-agents
- Claude Code: `claude-code/src/coordinator/coordinatorMode.ts:31-35` (worker tool set), `:37` (`isCoordinatorMode`); `claude-code/src/tools/AgentTool/AgentTool.tsx` (entry), `claude-code/src/tools/AgentTool/runAgent.ts:248` (`runAgent`); `claude-code/src/tools/SendMessageTool/SendMessageTool.ts` (messaging); `claude-code/src/tasks/LocalAgentTask/`, `claude-code/src/tasks/InProcessTeammateTask/`, `claude-code/src/tasks/RemoteAgentTask/`
- pi-mono extension SDK: `pi-mono/packages/coding-agent/src/core/extensions/types.ts:286` (`ExtensionContext`), `:390` (`ToolDefinition`), `:907-928` (`ExtensionEvent` union of 20+ lifecycle events); `pi-mono/packages/coding-agent/src/core/extensions/runner.ts`, `loader.ts`
- pi-mono sub-agent example: **`pi-mono/packages/coding-agent/examples/extensions/subagent/index.ts`** (988 LOC) — `pi.registerTool` at `:432`, `runSingleAgent` (subprocess spawn) at `:238`, three-mode schema at `:419-429`, parallel concurrency limit at `:27-28`
- pi-mono plan-mode example: `pi-mono/packages/coding-agent/examples/extensions/plan-mode/index.ts`
- pi-mono docs: `pi-mono/packages/coding-agent/docs/extensions.md` (SDK reference), `pi-mono/packages/coding-agent/examples/extensions/` (~60 example extensions)
- pi-mono core mid-turn injection (distinct from sub-agents): `pi-mono/packages/agent/src/agent.ts:252` (`steer`), `:257` (`followUp`)
