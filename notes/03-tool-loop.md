# Stage 3 — The Tool Loop

> Scope: locate the LLM-decides → call-tool → feed-result → repeat loop in each repo. Document seven axes: location, exit conditions, dispatch, result injection, streaming, retries, thinking-mode integration. With ~15-line excerpts.

---

## Claude Code

### Loop location

The real loop is **not** in `QueryEngine.ts` — that's a façade. The actual work is in `claude-code/src/query.ts`:

- **`query()`** — public generator wrapper, `claude-code/src/query.ts:219-239`. Handles command-lifecycle bookkeeping, then delegates via `yield*`.
- **`queryLoop()`** — the real loop, `claude-code/src/query.ts:241-1729` (~1,488 lines of body).
- Entry from `QueryEngine.ask()` at `claude-code/src/QueryEngine.ts:1186`.

The loop body is a single `while (true)` at `query.ts:307`. Each iteration = one API streaming call + one tool batch + recovery/bookkeeping + continue.

### Exit conditions

Every exit is `return { reason, … }` with a discriminated union of reasons. I count 12:

| Reason | Line | Trigger |
|---|---:|---|
| `blocking_limit` | `query.ts:646` | Pre-call token count exceeds hard blocking limit; auto-compact off |
| `image_error` | `query.ts:977`, `:1175` | Image size/resize error or withheld media error after reactive compact failed |
| `model_error` | `query.ts:996` | Uncaught error from the API call (after tombstoning orphaned messages) |
| `aborted_streaming` | `query.ts:1051` | `abortController.signal.aborted` during model streaming |
| `prompt_too_long` | `query.ts:1175`, `:1182` | 413 withheld; neither collapse-drain nor reactive-compact recovered |
| `stop_hook_prevented` | `query.ts:1279` | Stop-hook returned `preventContinuation` |
| `completed` | `query.ts:1264`, `:1357` | Last message was API error (skip hooks) **or** no more tool uses and stop hooks passed |
| `aborted_tools` | `query.ts:1515` | Abort signal during tool execution |
| `hook_stopped` | `query.ts:1520` | `hook_stopped_continuation` attachment from a pre/post-tool hook |
| `max_turns` | `query.ts:1711` | `turnCount > maxTurns` — hard turn cap |

There's no explicit "done" — the normal path is **when `needsFollowUp === false` and stop hooks don't ask to continue** (`query.ts:1062`, leading to the `completed` return at `:1357`).

### Dispatch

The model call is a `for await` over a streaming async generator:

```ts
// query.ts:659-708 (abbreviated)
for await (const message of deps.callModel({
  messages: prependUserContext(messagesForQuery, userContext),
  systemPrompt: fullSystemPrompt,
  thinkingConfig: toolUseContext.options.thinkingConfig,
  tools: toolUseContext.options.tools,
  signal: toolUseContext.abortController.signal,
  options: { model: currentModel, fallbackModel, querySource, … },
})) { … }
```

Tool dispatch is **partitioned into batches** (`claude-code/src/services/tools/toolOrchestration.ts:19` — `runTools`, `:91` — `partitionToolCalls`):

- **Read-only / concurrency-safe tools run in parallel** — `runToolsConcurrently`, capped by `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` (default 10, `toolOrchestration.ts:8-12`)
- **Anything else runs serially** — `runToolsSerially`
- Decision is per-call: `tool.isConcurrencySafe(parsedInput.data)` after Zod parse (`toolOrchestration.ts:97-107`)

There's also a **streaming tool executor** (`query.ts:562-568`) — optional, gated by a feature gate, that starts tools *while* the assistant message is still streaming, before the full assistant turn arrives. Tools get added as `tool_use` blocks stream in (`query.ts:841-843`).

### Result injection

Tool results are accumulated in `toolResults[]` (`query.ts:552`) and pushed per update (`:1395-1400`). On the next iteration, the loop rebuilds `messages` by concatenating:

```ts
// query.ts:1715-1716
const next: State = {
  messages: [...messagesForQuery, ...assistantMessages, ...toolResults],
  …
}
```

Before being sent to the API, everything goes through `normalizeMessagesForAPI` (`query.ts:1396-1399`) — tool results are rewrapped into proper `user` messages with `tool_result` blocks.

### Streaming

The outer generator yields to the REPL on every streamed assistant message (`query.ts:824`), every tool result attachment (`:1386`, `:1588`, `:1610`, `:1625`), plus meta events like `stream_request_start` (`:337`). Backfill-on-clone at `:748-787` — tool inputs can be enriched for the UI transcript without mutating the copy sent back to the API (preserves prompt cache).

Recoverable errors are **withheld from the stream** (`query.ts:799-822`) and only yielded if recovery fails — avoids showing "prompt too long" when a collapse-drain was about to fix it silently.

### Retries

Three distinct layers, each with its own loop:

1. **Transport layer** — `claude-code/src/services/api/withRetry.ts:170` (`async function* withRetry<T>`, 823 lines total). Handles 529 (overload), 5xx, connection errors, backoff. `shouldRetry()` at `:696`; `getRetryDelay()` at `:530`; `CannotRetryError` at `:144`; `FallbackTriggeredError` at `:160`.

2. **Model-fallback retry** — `query.ts:654` wraps the streaming call in `while (attemptWithFallback)`. When `withRetry` throws `FallbackTriggeredError`, the catch at `:893` swaps `currentModel = fallbackModel`, clears `assistantMessages`, strips thinking-block signatures (`:928`, for ant-only) because thinking signatures are model-bound, and re-enters the inner while.

3. **Context-recovery retries** — `prompt_too_long` is recovered via (a) `contextCollapse.recoverFromOverflow` at `:1094`, then (b) `reactiveCompact.tryReactiveCompact` at `:1120`. Both are `continue` into the next iteration (not throws). `max_output_tokens` has its own ladder: escalate to 64k at `:1205`, then inject a "resume directly" user message for up to `MAX_OUTPUT_TOKENS_RECOVERY_LIMIT` attempts at `:1223`.

### Thinking mode

- `thinkingConfig` is plumbed into the API call at `query.ts:662`. Defined in `claude-code/src/utils/thinking.ts` (163 lines).
- `shouldEnableThinkingByDefault()` decides per-model (`utils/thinking.ts:160`) — newer 4.6+ models always have thinking enabled.
- The important subtlety: **thinking blocks carry model-bound signatures**. If a fallback swap fires mid-turn, the assistant's thinking blocks from the canceled attempt can't be replayed against a different model — the API rejects them. Claude Code strips signatures on fallback at `query.ts:924-929` (`stripSignatureBlocks`, ant-only).

### Code excerpt — the loop skeleton

~15 lines of `query.ts`, showing the shape (paraphrased whitespace — real line numbers shown):

```ts
// claude-code/src/query.ts:307 — the main loop
while (true) {
  let { toolUseContext } = state
  const { messages, turnCount, … } = state
  yield { type: 'stream_request_start' }                          // :337
  let messagesForQuery = /* compaction/snip/collapse/budget */    // :379-648

  // Model fallback retry wrapper
  while (attemptWithFallback) {                                   // :654
    attemptWithFallback = false
    try {
      for await (const message of deps.callModel({ … })) {        // :659
        /* withholding, tombstoning, backfill */                  // :799-822
        if (!withheld) yield yieldMessage                         // :824
        if (message.type === 'assistant') {
          assistantMessages.push(message)
          if (msgToolUseBlocks.length) needsFollowUp = true       // :834
        }
      }
    } catch (innerError) {
      if (innerError instanceof FallbackTriggeredError) { …continue }  // :893
      throw innerError
    }
  }

  if (!needsFollowUp) { /* stop hooks, budget check, exit */; return { reason: 'completed' } }  // :1062-1357

  for await (const update of runTools(toolUseBlocks, assistantMessages, canUseTool, toolUseContext))
    { yield update.message; toolResults.push(…) }                 // :1382-1408

  const next: State = { messages: [...messagesForQuery, ...assistantMessages, ...toolResults], … }
  state = next
}
```

---

## pi-mono

### Loop location

- **Public class wrapper**: `pi-mono/packages/agent/src/agent.ts:158` (`class Agent`). `prompt()` at `:313`, `continue()` at `:326`, internal `runPromptMessages()` at `:374`, `runWithLifecycle()` at `:438`, `processEvents()` reducer at `:495`.
- **The real loop**: `pi-mono/packages/agent/src/agent-loop.ts:155` — `async function runLoop()`.
- Outer `while (true)` at `agent-loop.ts:168` for follow-up-message drain. Inner `while (hasMoreToolCalls || pendingMessages.length > 0)` at `:172` for tool-call turns.

Total: 663 lines. The loop body is ~75 lines; the rest is tool execution (sequential at `:353`, parallel at `:400`) and the `streamAssistantResponse` helper at `:238`.

### Exit conditions

Only two:

| Reason | Line | Trigger |
|---|---:|---|
| error / aborted | `agent-loop.ts:194-198` | `message.stopReason === 'error'` or `'aborted'` — emits `turn_end` then `agent_end`, returns |
| normal | `agent-loop.ts:231` | No more tool calls, no pending or follow-up messages — exits the outer `while` and emits `agent_end` |

`maxTurns` / stop-hooks / budget-checks / prompt-too-long recovery / media recovery — **none of these exist in the pi loop**. The loop trusts the provider (for error semantics) and the consumer (for termination policy).

### Dispatch

```ts
// agent-loop.ts:191 — inside the inner while
const message = await streamAssistantResponse(currentContext, config, signal, emit, streamFn)
newMessages.push(message)
if (message.stopReason === 'error' || message.stopReason === 'aborted') { … return }
const toolCalls = message.content.filter((c) => c.type === 'toolCall')  // :201
hasMoreToolCalls = toolCalls.length > 0
```

Tool calls are partitioned *per-tool* (not per-batch) into parallel vs sequential. **A single sequential tool in an assistant message forces the whole batch sequential** (`agent-loop.ts:344-349`):

```ts
const hasSequentialToolCall = toolCalls.some(
  (tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === 'sequential'
)
if (config.toolExecution === 'sequential' || hasSequentialToolCall) {
  return executeToolCallsSequential(…)  // :353
}
return executeToolCallsParallel(…)      // :400
```

Parallel execution is implemented as `Promise.all` over tool-execution thunks (`agent-loop.ts:445-447`). Each tool has a `prepareArguments` hook (`:484`) and participates in `beforeToolCall` / `afterToolCall` lifecycle callbacks (`:517-534`, `:598-621`) — the permission-and-interception seam for consumers.

### Result injection

```ts
// agent-loop.ts:205-212
if (hasMoreToolCalls) {
  toolResults.push(...(await executeToolCalls(currentContext, message, config, signal, emit)))
  for (const result of toolResults) {
    currentContext.messages.push(result)
    newMessages.push(result)
  }
}
```

Tool results become `ToolResultMessage` values and are appended directly to the transcript. **The LLM never sees these as-is** — the consumer-supplied `convertToLlm` (`config.convertToLlm`, called at `agent-loop.ts:252`) maps from `AgentMessage[]` to the LLM's `Message[]` shape right before each streaming call. That's the extension seam that lets pi's transcript carry UI-only messages (notifications, local commands) that get filtered out before being sent.

### Streaming

Every provider emits the same event shape. Inside `streamAssistantResponse` (`agent-loop.ts:276-319`):

```ts
for await (const event of response) {
  switch (event.type) {
    case 'start': /* begin partial */; await emit({ type: 'message_start', message: partialMessage }); break
    case 'text_start': case 'text_delta': case 'text_end':
    case 'thinking_start': case 'thinking_delta': case 'thinking_end':
    case 'toolcall_start': case 'toolcall_delta': case 'toolcall_end':
      partialMessage = event.partial
      await emit({ type: 'message_update', assistantMessageEvent: event, message: { ...partialMessage } })
      break
    case 'done': case 'error': {
      const finalMessage = await response.result()
      await emit({ type: 'message_end', message: finalMessage })
      return finalMessage
    }
  }
}
```

Nine event types, one switch. `message_update` flows back through the `Agent.subscribe()` stream — Slack bot, terminal REPL, browser chat UI all listen to the same events.

### Retries

**The agent loop does not retry.** `config.maxRetryDelayMs` (`pi-mono/packages/agent/src/agent.ts:186`) is a *cap passed to the provider* — the actual retry logic is inside each provider implementation (e.g., `packages/ai/src/providers/anthropic.ts`, `openai-responses.ts`, etc.).

On `stopReason === 'error'`, the loop emits `turn_end` + `agent_end` and returns. There's no model fallback, no compaction retry, no max-output-tokens ladder, no 413 recovery. **Design choice**: retries are a provider/consumer concern; the agent is a state machine.

### Thinking mode

- `AgentState.thinkingLevel` at `pi-mono/packages/agent/src/types.ts:262` — `ThinkingLevel` from `pi-ai` (values: `off`, `low`, `medium`, `high`, `xhigh`).
- `Agent.thinkingBudgets` at `agent.ts:182` — optional per-level token caps, passed straight through to the provider (`agent.ts:419`).
- `reasoning` param computed at `agent.ts:414`: `thinkingLevel === 'off' ? undefined : thinkingLevel` — passed via `AgentLoopConfig` to the provider.
- Thinking content is streamed as `thinking_start/delta/end` events — **same shape as text**, so consumers can render it identically if they want.

### Code excerpt — the loop skeleton

~15 lines of `agent-loop.ts`, real line numbers shown:

```ts
// pi-mono/packages/agent/src/agent-loop.ts:155
async function runLoop(currentContext, newMessages, config, signal, emit, streamFn) {
  let firstTurn = true
  let pendingMessages = (await config.getSteeringMessages?.()) || []

  while (true) {                                                             // :168 outer (follow-up drain)
    let hasMoreToolCalls = true
    while (hasMoreToolCalls || pendingMessages.length > 0) {                 // :172 inner
      if (!firstTurn) await emit({ type: 'turn_start' }); else firstTurn = false
      if (pendingMessages.length) { /* inject as user messages */ … }        // :179-188

      const message = await streamAssistantResponse(currentContext, config, signal, emit, streamFn)   // :191
      newMessages.push(message)
      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        await emit({ type: 'turn_end', message, toolResults: [] })
        await emit({ type: 'agent_end', messages: newMessages }); return     // :194-198
      }

      const toolCalls = message.content.filter((c) => c.type === 'toolCall')
      hasMoreToolCalls = toolCalls.length > 0
      const toolResults = hasMoreToolCalls
        ? await executeToolCalls(currentContext, message, config, signal, emit)   // :206
        : []
      for (const r of toolResults) { currentContext.messages.push(r); newMessages.push(r) }
      await emit({ type: 'turn_end', message, toolResults })
      pendingMessages = (await config.getSteeringMessages?.()) || []         // :216
    }
    const followUps = (await config.getFollowUpMessages?.()) || []
    if (!followUps.length) break
    pendingMessages = followUps
  }
  await emit({ type: 'agent_end', messages: newMessages })                   // :231
}
```

---

## Comparison — where they converge, where they diverge

Both loops **converge on the core shape**: stream an assistant message, scan for tool-use blocks, execute them, feed results back, repeat. Both partition parallel-safe tools from sequential ones, and both support interruption via an `AbortSignal`. Both stream deltas back to a consumer (REPL, subscriber) rather than buffering whole turns. That's not a small convergence — it's essentially the same algorithm.

They **diverge on what the loop's responsibilities are**. Claude Code's `queryLoop` is a **recovery-heavy state machine**: compaction (auto + snip + microcompact + collapse + reactive), prompt-too-long recovery, max-output-tokens recovery (two ladders), stop hooks, token budget nudges, model fallback, image-error handling, task-budget tracking across compaction boundaries, query-chain-tracking for analytics, memory/skill prefetch, streaming tool executor, tool-use summaries generated by Haiku in parallel with the main stream. Every exit has a named `reason`. pi's `runLoop` is a **bare state machine**: stream, execute, repeat, exit on error/done. Recovery, retries, and compaction live elsewhere — retries in the provider layer, compaction in `packages/coding-agent/src/core/compaction/` (consumer-side), max-turns in the consumer.

### The single most interesting difference

**Claude Code's loop treats "things went wrong" as first-class control flow — with 10+ named exit reasons and 4 retry strategies interleaved in one function.** pi's loop treats "things went wrong" as provider-level concerns — error and aborted are the only two abnormal exits. Both are defensible; Claude Code's gives Anthropic a single place to land all their recovery policy, pi's keeps the loop 10× smaller and lets each consumer pick its own recovery.

### Which one feels more defensible for production?

**pi-mono's** — but only if you already have a good provider layer and can write your own recovery. It's ~130 lines of pure loop, fully readable in one sitting, and the extension seams (`beforeToolCall`, `afterToolCall`, `convertToLlm`, `transformContext`, custom `streamFn`) let you add exactly the policies your product needs without forking the loop.

**Claude Code's** is more defensible if you're shipping one product to millions of users and every recovery path has been fire-tested. The 1,488-line body is intimidating, but every branch has a comment explaining the incident or subtle invariant that drove it (see the taskBudget comments at `:504-515`, the reactive-compact death-spiral comment at `:1292-1297`, the thinking-signature fallback at `:924-929`). That's institutional knowledge crystallized.

**One-line heuristic for the room:** if you're building a platform, copy pi's shape. If you're shipping a product, copy Claude Code's shape once you've learned which recovery paths actually fire in your incident history.

---

## Code references — jump table

### Claude Code

| What | Location |
|---|---|
| Outer façade generator | `claude-code/src/query.ts:219` (`query`) |
| Real loop | `claude-code/src/query.ts:241` (`queryLoop`) |
| `QueryParams` type | `claude-code/src/query.ts:181` |
| Mutable cross-iteration `State` | `claude-code/src/query.ts:204` |
| Main `while (true)` | `claude-code/src/query.ts:307` |
| Pre-call context pipeline (snip / microcompact / collapse / autocompact) | `claude-code/src/query.ts:401-467` |
| Blocking-limit check | `claude-code/src/query.ts:637-648` |
| Model streaming call | `claude-code/src/query.ts:659-708` (`deps.callModel`) |
| Streaming tool executor | `claude-code/src/query.ts:562-568` (`StreamingToolExecutor` instantiation), `:837-844` (registration) |
| Error withholding | `claude-code/src/query.ts:799-822` |
| Fallback retry handler | `claude-code/src/query.ts:893-952` |
| Abort during streaming | `claude-code/src/query.ts:1015-1052` |
| Prompt-too-long recovery (collapse drain) | `claude-code/src/query.ts:1085-1117` |
| Prompt-too-long recovery (reactive compact) | `claude-code/src/query.ts:1119-1183` |
| Max-output-tokens recovery | `claude-code/src/query.ts:1188-1256` |
| Stop-hook handling | `claude-code/src/query.ts:1267-1306` |
| Token-budget decision | `claude-code/src/query.ts:1308-1355` |
| `completed` exit | `claude-code/src/query.ts:1264`, `:1357` |
| Tool dispatch | `claude-code/src/query.ts:1380-1408` — calls either `streamingToolExecutor.getRemainingResults()` or `runTools(...)` |
| Recurse (build `next` state) | `claude-code/src/query.ts:1714-1727` |
| `runTools` | `claude-code/src/services/tools/toolOrchestration.ts:19` |
| Tool-batch partitioning | `claude-code/src/services/tools/toolOrchestration.ts:91` (`partitionToolCalls`) |
| Max concurrency cap | `claude-code/src/services/tools/toolOrchestration.ts:8-12` (`CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`) |
| Retry generator | `claude-code/src/services/api/withRetry.ts:170` (`withRetry`) |
| Retry policy | `claude-code/src/services/api/withRetry.ts:696` (`shouldRetry`), `:84` (`shouldRetry529`) |
| `FallbackTriggeredError` | `claude-code/src/services/api/withRetry.ts:160` |
| Thinking config | `claude-code/src/utils/thinking.ts` (163 lines), default-enable at `:160` |

### pi-mono

| What | Location |
|---|---|
| Agent class | `pi-mono/packages/agent/src/agent.ts:158` |
| `prompt()` entry | `pi-mono/packages/agent/src/agent.ts:313` |
| Lifecycle wrapper | `pi-mono/packages/agent/src/agent.ts:438` (`runWithLifecycle`) |
| Event reducer | `pi-mono/packages/agent/src/agent.ts:495` (`processEvents`) |
| Public loop entries | `pi-mono/packages/agent/src/agent-loop.ts:95` (`runAgentLoop`), `:120` (`runAgentLoopContinue`) |
| **Real loop** | `pi-mono/packages/agent/src/agent-loop.ts:155` (`runLoop`) |
| Outer `while` (follow-up drain) | `pi-mono/packages/agent/src/agent-loop.ts:168` |
| Inner `while` (tool/steering turns) | `pi-mono/packages/agent/src/agent-loop.ts:172` |
| Error/abort exit | `pi-mono/packages/agent/src/agent-loop.ts:194-198` |
| Normal exit | `pi-mono/packages/agent/src/agent-loop.ts:231` (emits `agent_end`) |
| Stream assistant response | `pi-mono/packages/agent/src/agent-loop.ts:238` |
| Stream event switch | `pi-mono/packages/agent/src/agent-loop.ts:276-319` (9 event types) |
| Tool dispatch | `pi-mono/packages/agent/src/agent-loop.ts:336` (`executeToolCalls`) |
| Sequential execution | `pi-mono/packages/agent/src/agent-loop.ts:353` |
| Parallel execution (`Promise.all`) | `pi-mono/packages/agent/src/agent-loop.ts:400-456` |
| `beforeToolCall` hook | `pi-mono/packages/agent/src/agent-loop.ts:517-534` |
| `afterToolCall` hook | `pi-mono/packages/agent/src/agent-loop.ts:598-621` |
| `convertToLlm` seam | `pi-mono/packages/agent/src/agent-loop.ts:252` |
| `transformContext` seam | `pi-mono/packages/agent/src/agent-loop.ts:246-249` |
| `thinkingLevel` → `reasoning` map | `pi-mono/packages/agent/src/agent.ts:414` |
| `thinkingBudgets` forward | `pi-mono/packages/agent/src/agent.ts:419` |
| `maxRetryDelayMs` plumbed to provider | `pi-mono/packages/agent/src/agent.ts:186`, `:420` |
