# Stage 2 — Architecture Map

> Scope: identify the 10–15 most important files in each repo and describe what they do. Line counts measured directly.

---

## Claude Code — key files

| File | Purpose | Lines |
|---|---|---:|
| `src/main.tsx` | CLI entrypoint. Fires **parallel prefetch side-effects** (`main.tsx:16` `startMdmRawRead()`, `main.tsx:21` `startKeychainPrefetch()`) *before* heavy module imports — the import order is intentional and documented inline (`main.tsx:1-8`). Uses Commander.js to parse ~60 flags and subcommands, then hands off to `launchRepl()` (imported at `main.tsx:37`). | 4,684 |
| `src/QueryEngine.ts` | Exports `QueryEngineConfig` (`QueryEngine.ts:130`), `class QueryEngine` (`QueryEngine.ts:184`), and an async-generator `ask({…})` (`QueryEngine.ts:1186`). This is the *façade* over the real streaming loop in `src/query.ts` — holds session state, thinking config, model choice, tool set, hook points; delegates the actual LLM-chunk-by-chunk reading to `query()`. | 1,297 |
| `src/query.ts` | The real tool-calling loop. `export async function* query(…)` (`query.ts:219`) streams model chunks, yields `SDKMessage`s, dispatches tool calls, feeds results back. `QueryParams` type at `query.ts:181`. This is the single most important file in the repo for Saturday's deep-read. | ~800 |
| `src/Tool.ts` | Tool contract. `Tool<Input, Output, Progress>` type defined at `Tool.ts:362` with ~60 methods; `ToolUseContext` (the per-call context) at `Tool.ts:158`; `ToolPermissionContext` at `Tool.ts:123`; `TOOL_DEFAULTS` at `Tool.ts:757`; `buildTool()` factory at `Tool.ts:783` fills in safe defaults. Input schemas are Zod v4; permissions are a first-class method. | 794 |
| `src/tools.ts` | Tool registry with conditional assembly. Feature-flag-gated imports at `tools.ts:16-135` (19 conditional tools). `getAllBaseTools()` at `tools.ts:193` (through `:251`); `getTools()` at `tools.ts:271`; `assembleToolPool(permCtx, mcpTools)` at `tools.ts:345` merges built-ins with MCP tools and sorts in two partitions — see the inline comment at `tools.ts:354-361` explaining the prompt-cache-breakpoint reason. | 390 |
| `src/commands.ts` | Slash-command registry. `INTERNAL_ONLY_COMMANDS` list at `commands.ts:226`; `builtInCommandNames` at `commands.ts:350`; `getCommands(cwd)` at `commands.ts:478`; `findCommand()` at `commands.ts:690`; `isBridgeSafeCommand()` at `commands.ts:674`. Three command types (`prompt` / `local` / `localJSX`) defined via the `Command` type re-exported at `commands.ts:214`. | 758 |
| `src/context.ts` | Collects the system + user context. `getGitStatus()` at `context.ts:36` runs 5 git commands in parallel via `Promise.all` at `context.ts:61-77`; `getSystemContext()` at `context.ts:116`; `getUserContext()` at `context.ts:155`. All three memoized via `lodash-es/memoize`. | 190 |
| `src/cost-tracker.ts` | Thin façade — all state lives in `bootstrap/state.js` (imports at `cost-tracker.ts:3-29`). Re-exports getters for token counts, cost USD, API duration, lines added/removed at `cost-tracker.ts:49-69`. The `/cost` command reads these. | 336 |
| `src/tools/BashTool/` (18 files) | Largest single tool. `BashTool.tsx` is the core; `bashPermissions.ts` has permission rules; AST parser at `utils/bash/ast.ts` (2,680 LOC); `bashSecurity.ts`, `sedEditParser.ts`, `shouldUseSandbox.ts`, `readOnlyValidation.ts`. Constants at `tools/BashTool/BashTool.tsx:52-58`. Big-result persistence hooked via `utils/toolResultStorage.ts`. | — |
| `src/tools/FileEditTool/` (6 files) | String-replacement file-edit tool. LSP integration (`tools/FileEditTool/FileEditTool.ts:5-6` — `clearDeliveredDiagnosticsForFile`, `getLspServerManager`), team-memory secret guard (`:8`), settings-file edit validator (`:51`), VS Code bridge notification (`:7`). | — |
| `src/hooks/toolPermission/PermissionContext.ts` | Central permission prompt queue. `PermissionQueueOps` interface at `PermissionContext.ts:57-62` decouples the queue from React. 4-stage decision flow — approval source types at `PermissionContext.ts:45-48`; calls `awaitClassifierAutoApproval` (`:15`), `executePermissionRequestHooks` (`:26`), and `persistPermissionUpdates` (`:37`). Handlers live in `hooks/toolPermission/handlers/`. | ~1,200 |
| `src/services/api/claude.ts` | Anthropic API client. `verifyApiKey()` at `services/api/claude.ts:530`; `userMessageToMessageParam()` at `:588`; `assistantMessageToMessageParam()` at `:633`; `queryModelWithoutStreaming()` at `:709`; `queryModelWithStreaming()` at `:752` (the streaming entrypoint); `executeNonStreamingRequest()` at `:818`. Prompt-caching policy: `getPromptCachingEnabled()` at `:333`, `getCacheControl()` at `:358`, `should1hCacheTTL()` at `:393`. Beta headers / extra params at `:272`. | 3,420 |
| `src/services/mcp/client.ts` | MCP client runtime. `McpAuthError` at `services/mcp/client.ts:152`; `McpSessionExpiredError` at `:165`; `McpToolCallError` at `:177`; `createClaudeAiProxyFetch()` at `:372`; `wrapFetchWithTimeout()` at `:492`; `connectToServer` memoized at `:595`. | 3,349 |
| `src/services/mcp/` (22 sibling files) | `MCPConnectionManager.tsx`, transports (`InProcessTransport.ts`, `SdkControlTransport.ts`), `elicitationHandler.ts`, `officialRegistry.ts`, `channelAllowlist.ts`, `channelPermissions.ts`, `vscodeSdkMcp.ts`, `auth.ts`, `oauthPort.ts`, `xaa.ts`, `xaaIdpLogin.ts`. | — |
| `src/coordinator/coordinatorMode.ts` | Entire multi-agent coordinator subsystem in **one file**. `INTERNAL_WORKER_TOOLS` at `coordinatorMode.ts:31-35`; `isCoordinatorMode()` at `:37` (gated on `feature('COORDINATOR_MODE')` + `CLAUDE_CODE_COORDINATOR_MODE` env); `matchSessionMode()` at `:50`; scratchpad-gate workaround explained at `:21-28`. | ~400 |

**Representative tool shape** (BashTool):
```ts
export const BashTool = buildTool({
  name: BASH_TOOL_NAME,
  inputSchema: lazySchema(() => z.object({ command: z.string(), timeout: semanticNumber.optional(), ... })),
  async call(args, context, canUseTool, parentMessage, onProgress) { … },
  async checkPermissions(input, context) { … },
  isConcurrencySafe(input) { return /* read-only commands only */ },
  isReadOnly(input) { … },
  renderToolUseMessage(input, { theme, verbose }) { … },
  renderToolResultMessage(content, progress, opts) { … },
  prompt(opts) { … },           // system-prompt contribution
  toAutoClassifierInput(input) { /* compact form for the auto-mode classifier */ },
})
```

---

## pi-mono — key files

| File / Package | Purpose | Lines |
|---|---|---:|
| `packages/ai/src/index.ts` | Pure re-export façade. Re-exports at `packages/ai/src/index.ts:4-34` — providers exported as `type` to enable lazy loading, models + stream functions + env-key helpers + OAuth types + TypeBox helpers + validation + event-stream utilities. | 40 |
| `packages/ai/src/stream.ts` | Two entrypoints: `stream()` at `packages/ai/src/stream.ts:25` and `streamSimple()` at `:43`. Both call `resolveApiProvider(model.api)` (`:17`) and dispatch. Provider selection is runtime, not compile-time. | 60 |
| `packages/ai/src/api-registry.ts` | Runtime registry. `ApiProvider` interface at `api-registry.ts:23-27`; internal registry `Map` at `:40`; `wrapStream()` type-guard at `:42-52`. Providers are lazy-loaded from `providers/register-builtins.ts`. | 125 |
| `packages/ai/src/providers/*.ts` (14 files) | Each provider emits a normalized event stream (`start`, `text_start/delta/end`, `thinking_start/delta/end`, `toolcall_start/delta/end`, `done`, `error`). See event types at `packages/ai/src/utils/event-stream.ts`. `KnownApi` enum at `packages/ai/src/types.ts:5-15`; `KnownProvider` at `:19-43`. `faux.ts` is the deterministic test provider. | 28,382 total (incl. `models.generated.ts` at 14,830) |
| **`packages/agent/src/agent.ts`** | `class Agent` at `packages/agent/src/agent.ts:158`. Constructor at `:190`. `subscribe()` at `:219`. `steer()`/`followUp()` at `:252`/`:257`. `abort()` at `:288`. `prompt()` at `:313`. `continue()` at `:326`. Internal `runPromptMessages()` at `:374`, `runWithLifecycle()` at `:438`, `processEvents()` reducer at `:495`. `PendingMessageQueue` class at `:113-144`. | 543 |
| **`packages/agent/src/agent-loop.ts`** | The real tool loop. `runAgentLoop()` at `packages/agent/src/agent-loop.ts:95`. `runAgentLoopContinue()` at `:120`. Shared `runLoop()` at `:155` with **outer `while (true)`** at `:168` (follow-up drain) and **inner `while`** at `:172` (tool-call turns + steering). `streamAssistantResponse()` at `:238`. `executeToolCalls()` at `:336`, with `executeToolCallsSequential()` at `:353` and `executeToolCallsParallel()` at `:400`. `prepareToolCall()` (validation + `beforeToolCall` hook) at `:498`. `finalizeExecutedToolCall()` (`afterToolCall` hook) at `:587`. | 663 |
| `packages/agent/src/types.ts` | Contract surface. `StreamFn` at `packages/agent/src/types.ts:24`. `ToolExecutionMode` at `:36`. `AgentToolCall` at `:39`. `BeforeToolCallResult` at `:47`. `AfterToolCallResult` at `:63`. `AgentLoopConfig` (extends `SimpleStreamOptions`) at `:97`. `AgentTool<TInput>` defined via TypeBox schema. `AgentMessage` is a declaration-mergeable union. | 352 |
| `packages/agent/src/proxy.ts` | Inter-process serialization for the coding-agent's `rpc` mode. | 367 |
| `packages/coding-agent/src/core/agent-session.ts` | Session layer wrapping `Agent`. File header comment at `agent-session.ts:1-14` documents its role across the 3 run-modes (interactive, print, rpc). Imports `Agent`/`AgentEvent`/`AgentMessage`/`AgentState`/`AgentTool`/`ThinkingLevel` from `pi-agent-core` at `:22-28`. Compaction pipeline imported from `./compaction/index.js` at `:38-47`. | 3,082 |
| `packages/coding-agent/src/modes/interactive/interactive-mode.ts` | The `pi` REPL. Built on `packages/tui/`. | 5,145 |
| `packages/coding-agent/src/core/tools/` (13 files) | Tool set: `bash.ts`, `edit.ts` (+ `edit-diff.ts`), `find.ts`, `grep.ts`, `ls.ts`, `read.ts`, `truncate.ts`, `write.ts`, `file-mutation-queue.ts`, `render-utils.ts`, `tool-definition-wrapper.ts`, `path-utils.ts`. Each is TypeBox schema + `execute(args, signal, onProgress)` — thinner than Claude Code's `Tool` interface. | — |
| `packages/mom/src/agent.ts` | Slack bot's agent glue. `import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core"` at `packages/mom/src/agent.ts:1`; `AgentSession`, `AuthStorage`, `SessionManager`, `ModelRegistry` imports from `@mariozechner/pi-coding-agent` at `:3-14`. Hardcoded model at `:25`: `getModel("anthropic", "claude-sonnet-4-5")` (TODO for issue #63). | — (pkg 4,046) |
| `packages/mom/src/tools/` (6 files) | Slack-bot-specific tool wrappers over `createExecutor(SandboxConfig)` — host-mode or docker-sandboxed. | — |
| `packages/tui/src/tui.ts` | Terminal UI runtime. **Not React**. `Component` interface with `render(width): string[]` at `packages/tui/src/tui.ts:17-33`. Own differential renderer + CSI 2026 atomic flush. | — (pkg 10,977) |
| `packages/pods/src/cli.ts` | vLLM deployment CLI. `printHelp()` + subcommand dispatch from `packages/pods/src/cli.ts:18+`. The `pi agent <name>` subcommand wires an agent against the pod's OpenAI-compatible endpoint. | — (pkg 1,773) |

**Representative tool shape** (`packages/agent/src/types.ts`):
```ts
interface AgentTool<TInput extends TSchema> {
  name: string;
  description: string;
  parameters: TInput;                              // TypeBox schema = JSON Schema
  execute(toolCallId: string, args: Static<TInput>, signal?: AbortSignal, onPartial?): Promise<AgentToolResult>;
  prepareArguments?(raw: unknown): unknown;        // pre-validation hook
  executionMode?: 'sequential' | 'parallel';
}
```

Note the shape difference from Claude Code's `Tool`: pi's `AgentTool` is ~5 methods; Claude Code's `Tool` is ~60. pi pushes UI, permissions, and rendering **out of the tool contract** — consumers add those layers themselves.

---

## Architectural shape comparison

### Claude Code — top-level structure

One `src/` tree with ~85 sibling directories. No package boundary between the agent loop and the REPL UI — `QueryEngine.ts`, `tools.ts`, `commands.ts`, `screens/REPL.tsx`, `hooks/`, `components/`, `bridge/`, `coordinator/` all live in the same import graph. **Conditional imports via `feature('FLAG')` and `process.env.USER_TYPE` are the only modularity mechanism** — dead-code elimination happens at Bun bundle time, not at package boundary. The `services/` folder is the closest thing to a vertical split: external-integration code (api, mcp, oauth, lsp, analytics, plugins, compact, memory sync) is all there, but each `service/` freely imports from `state/`, `utils/`, and `tools/`. The Tool interface is maximally broad (UI + permissions + schema + rendering all required), so every tool is a self-contained ~6-file directory.

### pi-mono — top-level structure

A 7-package npm workspace with explicit, lockstep-versioned dependencies. The **inversion of control** is total: `packages/agent/` knows nothing about CLIs, sessions, compaction, or UI — it's a pure state machine with an event stream. `packages/ai/` knows nothing about agents — it's a multi-provider streaming client with a runtime registry. Consumers (`coding-agent`, `mom`, `web-ui`) compose the two and add their own session, UI, and persistence layers. The agent loop (`agent-loop.ts`) is 663 LOC of pure logic with six dependencies on `pi-ai` types — no React, no Ink, no file I/O, no config system.

### The fundamental structural difference — in one sentence

**Claude Code is a single monolithic application with ~40 features gated by feature-flags and dead-code elimination; pi-mono is a toolkit of 7 independent packages, where the reusable agent runtime (1,933 LOC) is one of them and everything else is a composition on top.**

### One-insight corollary for Saturday

Claude Code's design optimizes for *shipping a cohesive product*: all features live next to each other, Bun strips what's off, one binary out. pi-mono's design optimizes for *reusing the agent*: the Slack bot and the browser chat UI both import the exact same `Agent` class, tested once. Neither is wrong — they're answers to different questions. If the room wants a one-line takeaway: *if you're Anthropic, ship Claude Code's shape; if you're a team building several AI-product surfaces, ship pi-mono's shape.*

---

## Code references — consolidated jump table

### Claude Code

| What | Location |
|---|---|
| CLI entrypoint, parallel prefetch | `claude-code/src/main.tsx:16` (`startMdmRawRead`), `:21` (`startKeychainPrefetch`), `:1-8` (rationale) |
| Query engine class | `claude-code/src/QueryEngine.ts:184` (class `QueryEngine`), `:130` (`QueryEngineConfig`), `:1186` (`async function* ask`) |
| Real tool-calling loop | `claude-code/src/query.ts:219` (`async function* query`), `:181` (`QueryParams`) |
| Tool contract | `claude-code/src/Tool.ts:362` (`Tool<…>` type), `:158` (`ToolUseContext`), `:123` (`ToolPermissionContext`), `:757` (`TOOL_DEFAULTS`), `:783` (`buildTool`) |
| Tool registry | `claude-code/src/tools.ts:16-135` (19 conditional imports), `:193` (`getAllBaseTools`), `:271` (`getTools`), `:345` (`assembleToolPool`), `:354-361` (cache-breakpoint comment) |
| Command registry | `claude-code/src/commands.ts:226` (`INTERNAL_ONLY_COMMANDS`), `:350` (`builtInCommandNames`), `:478` (`getCommands`), `:690` (`findCommand`), `:674` (`isBridgeSafeCommand`) |
| Context collection | `claude-code/src/context.ts:36` (`getGitStatus`), `:116` (`getSystemContext`), `:155` (`getUserContext`), `:61-77` (5-way parallel git) |
| Cost tracking | `claude-code/src/cost-tracker.ts:49-69` (getter re-exports) |
| Bash tool | `claude-code/src/tools/BashTool/BashTool.tsx` (core), `tools/BashTool/bashPermissions.ts`, `utils/bash/ast.ts` (2,680 LOC AST) |
| File edit tool | `claude-code/src/tools/FileEditTool/FileEditTool.ts:5-6` (LSP), `:8` (secret guard), `:51` (settings validator) |
| Permission queue | `claude-code/src/hooks/toolPermission/PermissionContext.ts:57-62` (`PermissionQueueOps`), `:15` (classifier), `:26` (hooks), `:37` (persist) |
| Anthropic API client | `claude-code/src/services/api/claude.ts:272` (beta headers), `:333` (cache policy), `:530` (`verifyApiKey`), `:709` (non-streaming), `:752` (streaming), `:818` (non-streaming executor) |
| MCP client | `claude-code/src/services/mcp/client.ts:152-193` (error types), `:372` (proxy fetch), `:492` (timeout wrapper), `:595` (`connectToServer`) |
| Coordinator | `claude-code/src/coordinator/coordinatorMode.ts:31-35` (worker tool set), `:37` (`isCoordinatorMode`), `:50` (`matchSessionMode`) |

### pi-mono

| What | Location |
|---|---|
| AI façade | `pi-mono/packages/ai/src/index.ts:4-34` (re-exports) |
| Stream entry | `pi-mono/packages/ai/src/stream.ts:25` (`stream`), `:43` (`streamSimple`), `:17` (`resolveApiProvider`) |
| Runtime registry | `pi-mono/packages/ai/src/api-registry.ts:23-27` (`ApiProvider`), `:40` (registry Map), `:42-52` (type-guard wrapper) |
| Providers | `pi-mono/packages/ai/src/providers/` — 14 files; `faux.ts` is deterministic test provider |
| Known APIs/providers enums | `pi-mono/packages/ai/src/types.ts:5-15` (`KnownApi`), `:19-43` (`KnownProvider`) |
| Agent class | `pi-mono/packages/agent/src/agent.ts:158` (class), `:190` (ctor), `:219` (`subscribe`), `:252` (`steer`), `:257` (`followUp`), `:288` (`abort`), `:313` (`prompt`), `:326` (`continue`), `:374` (`runPromptMessages`), `:438` (`runWithLifecycle`), `:495` (`processEvents`) |
| Agent queue | `pi-mono/packages/agent/src/agent.ts:113-144` (`PendingMessageQueue` class) |
| **The loop** | `pi-mono/packages/agent/src/agent-loop.ts:95` (`runAgentLoop`), `:120` (`runAgentLoopContinue`), `:155` (shared `runLoop`), `:168` (outer `while (true)`), `:172` (inner `while`), `:238` (`streamAssistantResponse`), `:336` (`executeToolCalls`), `:353` (sequential), `:400` (parallel), `:498` (`prepareToolCall` with `beforeToolCall`), `:587` (`finalizeExecutedToolCall` with `afterToolCall`) |
| Loop types | `pi-mono/packages/agent/src/types.ts:24` (`StreamFn`), `:36` (`ToolExecutionMode`), `:39` (`AgentToolCall`), `:47` (`BeforeToolCallResult`), `:63` (`AfterToolCallResult`), `:97` (`AgentLoopConfig`) |
| Session wrapper | `pi-mono/packages/coding-agent/src/core/agent-session.ts:1-14` (header), `:22-28` (pi-agent-core imports), `:38-47` (compaction) |
| Interactive mode | `pi-mono/packages/coding-agent/src/modes/interactive/interactive-mode.ts` (5,145 LOC) |
| Coding-agent tools | `pi-mono/packages/coding-agent/src/core/tools/` — 13 files |
| Slack bot consumer | `pi-mono/packages/mom/src/agent.ts:1` (imports `Agent`), `:3-14` (imports from coding-agent), `:25` (hardcoded Sonnet 4.5) |
| TUI | `pi-mono/packages/tui/src/tui.ts:17-33` (`Component` interface) |
| Pods CLI | `pi-mono/packages/pods/src/cli.ts:18+` (subcommand dispatch) |
