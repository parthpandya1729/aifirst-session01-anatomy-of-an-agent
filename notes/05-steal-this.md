# Stage 5 — Five patterns worth stealing

Five concrete patterns you could lift out of these two codebases and drop into your own agentic product. Each has: a short name, a 3-sentence description, file citations, and the reason it's worth stealing.

Balance: three from Claude Code, two from pi-mono. I skewed slightly to Claude Code because it optimizes harder against real production constraints (cache economics, overflow, latency) — pi-mono's two are the extensibility patterns that Claude Code does *not* have and is probably the weaker for.

---

## 1. Mid-stream tool dispatch

**Repo:** Claude Code.
**Files:** `claude-code/src/services/api/claude.ts:752` (`queryModelWithStreaming`), `claude-code/src/services/api/claude.ts:2465-2467` (warning comment about the double-execution risk this pattern introduces), and the orchestrator at `claude-code/src/query.ts:241-400` (`queryLoop`).

**Description.** Most tutorials teach you to wait for the model's response to finish, *then* dispatch tool calls. Claude Code starts dispatching tool calls as soon as the model emits a `content_block_start` for a `tool_use` block — while the stream is still running. On turns with multiple tool calls, this halves perceived latency because the first tool call's I/O overlaps with the model still generating the second one.

**Why steal it.** Users read latency as product quality. Going from "stream finishes → then tools fire" to "tools fire as they arrive" is a measurable win without changing model choice or tooling. The cost: you have to handle the edge case where a streaming error triggers a retry *after* a tool already fired (`claude.ts:2465-2467` has a five-line warning comment about this — it's a real trap). Worth the complexity on any multi-tool agent.

---

## 2. Cascading context-overflow recovery

**Repo:** Claude Code.
**Files:** `claude-code/src/query.ts` — the recovery ladder runs inside `queryLoop` between roughly `:280` and `:450`. Related helpers: `claude-code/src/services/api/claude.ts` `withRetry` wrapper, and the compaction routines in `claude-code/src/utils/compact*.ts`.

**Description.** When a turn exceeds context limits (a `413` or equivalent from the API), most agents surface the error to the user. Claude Code walks a ladder: first **collapse** old assistant turns to tool-result stubs and retry → if still too big, run **reactive compaction** (LLM-summarized transcript) and retry → only then fall back to a model with a larger window → only then error. Each step is cheaper than the one above and most sessions never reach the later rungs.

**Why steal it.** Context-length failures are the single most common reason long agentic sessions die. A ladder of fallbacks means you degrade gracefully instead of crashing, and the *order* matters — cheap mechanical collapse first, expensive LLM summarization only if needed. Even a two-step ladder (collapse → compact) is a massive UX improvement over "your session is too long, start over."

---

## 3. Cache-identical sub-agent fork

**Repo:** Claude Code.
**Files:** `claude-code/src/tools/AgentTool/forkSubagent.ts:42` (`FORK_SUBAGENT_TYPE`), `forkSubagent.ts:48-54` (the comment explains the design: `tools: ['*']` + `useExactTools` = byte-identical prompt), `claude-code/src/tools/AgentTool/agentToolUtils.ts:44` (`CacheSafeParams`), `agentToolUtils.ts:337-340` (cache-eviction hint when the subagent is done).

**Description.** When Claude Code spawns a sub-agent via `/fork`, it doesn't re-synthesize the child's system prompt — it passes `tools: ['*']` with `useExactTools: true`, producing a **byte-identical** prefix to the parent. Anthropic's prompt cache then hits on every token of the system prompt + tool schemas, so the sub-agent's first turn costs only the new user message. When the sub-agent finishes, it emits a `tengu_cache_eviction_hint` event to signal its cache can be dropped.

**Why steal it.** Prompt caching is pay-per-byte-of-cache-miss. If your sub-agents share 10k tokens of system prompt with the parent, a byte-identical fork is ~90% cheaper than a "fresh" sub-agent with a re-serialized prompt. The rule: **design sub-agent spawning to produce byte-identical prefixes by default** — reach for a fresh prompt only when the sub-agent genuinely needs a different persona. Most don't.

---

## 4. Lifecycle-event extension SDK

**Repo:** pi-mono.
**Files:** `pi-mono/packages/agent/src/types.ts:337-352` (12-event `AgentEvent` union in the core), `pi-mono/packages/coding-agent/src/core/extensions/types.ts:907-928` (20+ `ExtensionEvent` types in the CLI layer), `pi-mono/packages/coding-agent/src/core/extensions/loader.ts` (loads TS modules from `~/.pi/agent/extensions/`), and the ~60 worked examples at `pi-mono/packages/coding-agent/examples/extensions/`.

**Description.** pi-mono doesn't use feature flags or configuration DSLs — it ships an **extension SDK** where users drop TypeScript files into `~/.pi/agent/extensions/` that subscribe to lifecycle events (`agent_start`, `turn_start`, `tool_call`, `before_provider_request`, …) and register new tools or commands. The core's event union is small (12 events); the CLI layer expands to 20+; every hook point you'd need is an event. Plan mode, git checkpointing, permission gates, and even sub-agent spawning all ship as example extensions rather than core features.

**Why steal it.** Customer-facing agents always grow a long tail of "can you add X?" requests. An extension SDK means you can say "yes, here's how to write X in 50 lines of TypeScript" instead of "we'll consider it for the next release." Two design constraints make this work in pi-mono: (a) the event union is versioned and small, so extensions don't break when internals change, and (b) extensions are ordinary TS with full IDE support, not a DSL. If you're building a developer-facing agent, this is the extensibility pattern to copy — and pi-mono's ~60 example extensions mean you can see the API in anger before committing to it.

---

## 5. Normalized multi-provider stream protocol

**Repo:** pi-mono.
**Files:** `pi-mono/packages/ai/src/stream.ts` (stream normalization), `pi-mono/packages/ai/src/types.ts:248` (`AssistantMessageEvent` union — the single protocol all providers emit into), `pi-mono/packages/ai/src/providers/` (11 provider adapters), `pi-mono/packages/ai/src/api-registry.ts`.

**Description.** pi-mono's agent code does not know about Anthropic, OpenAI, Groq, Bedrock, or any other provider. It knows about a small normalized event union (`AssistantMessageEvent`) and trusts that `packages/ai/` will map *any* of 11 provider-specific streaming wire formats into it. New providers land as a single file in `packages/ai/src/providers/`; no agent code changes.

**Why steal it.** Every LLM provider ships a different streaming format, and they all drift at different cadences. If your agent talks directly to a provider's SDK, every SDK bump is a potential regression; every new provider is a porting project. Normalize at the boundary: define a small event union that captures *what your agent needs* (text, tool-call starts/deltas/ends, usage), and make every provider fit into it. pi-mono's union is 9 events wide — small enough to reason about, rich enough for production. The whole `pi-ai` package is effectively a reference implementation of this adapter pattern.

---

## Honorable mentions (didn't make the top five)

- **Runtime env gating instead of build-time feature flags** (`claude-code/src/tools.ts:214-215`, `:232`). Claude Code uses `process.env.USER_TYPE === 'ant'` to conditionally include internal tools. Simple, transparent, and requires no bundler magic. Steal if you ship the same binary to multiple user tiers.
- **Pure-function compaction** (pi-mono). pi's compaction is a single pure function called between turns, not a mid-loop strategy. Much easier to reason about than Claude Code's five in-loop strategies — steal when you don't need the aggressive middle-of-turn recovery of pattern #2.
- **Sub-agent via subprocess** (`pi-mono/packages/coding-agent/examples/extensions/subagent/index.ts:306` — `spawn(invocation.command, invocation.args, …)`). Heavier startup than an in-process fork, but zero shared-state risk. Steal when isolation matters more than cost.

---

## Code references (consolidated)

| Pattern | Repo | Path | Lines |
|---|---|---|---|
| Mid-stream tool dispatch | claude-code | `src/services/api/claude.ts` | 752 (streaming entry), 2465-2467 (retry warning) |
| Mid-stream tool dispatch | claude-code | `src/query.ts` | 241-400 (orchestrator) |
| Cascading overflow recovery | claude-code | `src/query.ts` | 280-450 (ladder) |
| Cascading overflow recovery | claude-code | `src/utils/compact*.ts` | reactive/proactive/memory compaction |
| Cache-identical fork | claude-code | `src/tools/AgentTool/forkSubagent.ts` | 42 (type const), 48-54 (design comment) |
| Cache-identical fork | claude-code | `src/tools/AgentTool/agentToolUtils.ts` | 44 (`CacheSafeParams`), 337-340 (eviction hint) |
| Extension SDK | pi-mono | `packages/agent/src/types.ts` | 337-352 (core AgentEvent) |
| Extension SDK | pi-mono | `packages/coding-agent/src/core/extensions/types.ts` | 907-928 (ExtensionEvent union) |
| Extension SDK | pi-mono | `packages/coding-agent/src/core/extensions/loader.ts` | full file |
| Extension SDK | pi-mono | `packages/coding-agent/examples/extensions/` | ~60 worked examples |
| Normalized stream protocol | pi-mono | `packages/ai/src/types.ts` | 248 (`AssistantMessageEvent`) |
| Normalized stream protocol | pi-mono | `packages/ai/src/stream.ts` | full file |
| Normalized stream protocol | pi-mono | `packages/ai/src/providers/` | 11 adapters |
