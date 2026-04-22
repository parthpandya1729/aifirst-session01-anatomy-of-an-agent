# Stage 6 — Session script

Minute-by-minute walkthrough plan for Saturday 25 April 2026, 9:30–11:30 IST, Varahi office + livestream. Assumes ~15 people in the room, both repos cloned at the SHAs in `README.md`, two projectors (or one projector + laptops open to the same file).

**Design note.** Every block has files to open, lines to highlight, a discussion prompt, and an estimate of how long each file should stay on the screen. If you fall behind, drop the pi-mono subsection of the file in question, not the discussion prompt — the prompts are what make this a session and not a lecture.

---

## 9:30–9:35 · Opening (5 min)

**No files yet.** One slide or one terminal window showing `tree -L 1` of both repos side-by-side.

**What to say (90 seconds).**
- "Two agentic coding CLIs. Both in TypeScript. Both shipped in 2026. Roughly the same job: LLM + tools + REPL."
- "Claude Code: ~520k LOC of leaked Anthropic source. pi-mono: ~105k LOC, MIT-licensed, one maintainer."
- "Thesis: they solve the same problem with **opposite** design philosophies. Today we figure out where each is right."

**Discussion prompt (3 min, open to the room).**
> *"Before we open any code — what would **you** put at the core of an agentic CLI? If you had to name three modules, what would they be?"*

Write the room's answers on the board. Refer back to them at 11:20.

---

## 9:35–10:00 · Claude Code walkthrough (25 min)

One repo, three files. Keep `README.md` open in a second tab only for the "misreported QueryEngine.ts size" flag.

### File 1 — `claude-code/src/query.ts` (10 min)

**Open to:** `:241` (function `queryLoop`).

**Highlight these lines:**
- `:307` — the `while (true)` — this is *the* agent loop. Roughly 12 named exit reasons below.
- `:280-450` — the cascading overflow-recovery ladder (collapse → reactive compact → model-swap → error).
- Any one retry branch (search `withRetry`) — shows that even inside the loop, every API call has its own ladder.

**Key observation:** "The loop itself is ~200 lines. The *recovery* around it is 10× that. That's what production does to an agent."

**Discussion prompt (2 min).**
> *"How many of you have shipped an agent that dies on context-length errors? Raise your hand if a user has ever seen a `413` from your product. What do they see today?"*

### File 2 — `claude-code/src/Tool.ts` (7 min)

**Open to:** `:362` (the `Tool` type).

**Highlight these lines:**
- `:362-420` — the Tool interface: ~60 methods (`name`, `description`, `call`, `renderToolUse`, `renderToolResult`, `renderToolResultMessage`, `checkPermissions`, `getPath`, `isReadOnly`, `needsPermissions`, `validateInput`, `isEnabled`, …).
- `:783` — `buildTool()` factory.
- Compare against any concrete tool, e.g. `src/tools/FileReadTool/FileReadTool.tsx` — every tool implements *all* of these.

**Key observation:** "The Tool isn't a function. It's a UI component + permission checker + schema + prompt-renderer + executor in one class. That's why `tools/` is ~16k LOC for ~40 tools."

**Discussion prompt (2 min).**
> *"Is it better to have fat tool objects that own everything (CC), or thin tool functions where the harness layers on UI and permissions (pi-mono, which we'll see in 15 minutes)? When does each win?"*

### File 3 — `claude-code/src/tools/AgentTool/forkSubagent.ts` (8 min)

**Open to:** `:42` (`FORK_SUBAGENT_TYPE`).

**Highlight these lines:**
- `:42` — the synthetic agent-type constant.
- `:48-54` — the comment explaining `tools: ['*']` + `useExactTools` = byte-identical parent prompt = prompt cache hits on the sub-agent's first turn.
- `claude-code/src/tools/AgentTool/agentToolUtils.ts:337-340` — cache-eviction hint emitted when the sub-agent ends.

**Key observation:** "Every decision in this file is about the **prompt cache**. Sub-agents aren't just a feature, they're a cost-optimization. Byte-identical prefix = 90% cheaper first turn."

**Discussion prompt (2 min).**
> *"Prompt caching is pay-per-byte-of-cache-miss. How many of you have actually measured your cache hit rate in prod? What would change in your prompts if you did?"*

---

## 10:00–10:25 · pi-mono walkthrough (25 min)

Switch repos. Same rhythm, different philosophy.

### File 1 — `pi-mono/packages/agent/src/agent-loop.ts` (8 min)

**Open to:** `:155` (`runLoop`).

**Highlight these lines:**
- `:155-220` — the entire `runLoop`. Compare visually to `claude-code/src/query.ts:241-450` — pi's loop is *a quarter of the size*.
- Two exit reasons vs Claude Code's twelve. No in-loop retries. No overflow ladder.
- `pi-mono/packages/agent/src/types.ts:337-352` — the 12-event `AgentEvent` union that's emitted as the loop runs.

**Key observation:** "pi-mono's loop is small because everything that *could* be outside the loop *is* outside the loop. Compaction is a pure function between turns. Retries are the provider adapter's job. The core is just: ask model → dispatch tools → emit events."

**Discussion prompt (2 min).**
> *"Which loop do you trust more — the 200-line one that handles a dozen edge cases, or the 60-line one that pushes edge cases to the caller?"*

### File 2 — `pi-mono/packages/ai/src/types.ts` and `packages/ai/src/stream.ts` (5 min)

**Open to:** `packages/ai/src/types.ts:248` (`AssistantMessageEvent`).

**Highlight these lines:**
- `:248` and the union following it — 9 normalized events (text delta, tool-call start/delta/end, usage, done, …).
- `packages/ai/src/providers/` — `ls` the directory. 11 provider adapters. Every one of them emits into the *same* event union.
- `packages/ai/src/stream.ts` — the normalizer.

**Key observation:** "pi-mono's agent code doesn't know what provider it's talking to. That's a boundary choice Claude Code didn't make — and it's why pi-ai is reusable while `services/api/claude.ts` is 3,000 lines of Anthropic-specific streaming logic."

**Discussion prompt (2 min).**
> *"When should you normalize at the provider boundary, and when is that premature? What's the actual cost you pay for Claude Code's direct-to-Anthropic coupling?"*

### File 3 — pi-mono's extension SDK (7 min)

**Open to two files in split view:**
- `pi-mono/packages/coding-agent/src/core/extensions/types.ts:907-928` (the `ExtensionEvent` union, 20+ events).
- `pi-mono/packages/coding-agent/examples/extensions/subagent/index.ts:432` (`pi.registerTool(...)` — how a sub-agent becomes a tool).

**Highlight these lines:**
- `types.ts:907-928` — every lifecycle event a user extension can subscribe to.
- `subagent/index.ts:238` (`runSingleAgent`) + `:306` (the `spawn(...)` of a child `pi` process).
- Then `ls pi-mono/packages/coding-agent/examples/extensions/` — 60+ example extensions, each a working feature.

**Key observation:** "pi-mono's answer to 'how do I add a feature?' is 'write a TypeScript file in `~/.pi/agent/extensions/`.' Plan mode, permissions, git checkpoints, sub-agents — all extensions. Claude Code's answer is 'we ship it in the binary behind a feature flag.' Same problem, opposite answer."

**Discussion prompt (3 min).**
> *"If your agent had 60 example extensions versus 60 built-in features, which would your users prefer? Does your answer change if your users are (a) engineers or (b) founders?"*

---

## 10:25–10:35 · Break (10 min)

Chai, snacks, bathroom. If livestream — mute mics, post a "back at 10:35" card.

---

## 10:35–11:20 · Compare & extract (45 min)

Walk the 5-pattern table from `notes/04-five-patterns.md`. **~9 minutes per pattern.** For each: open one file from each repo, highlight 2–3 lines, 2-minute discussion prompt.

### Pattern 1 — Tool contract (9 min)

**CC:** `src/Tool.ts:362` — fat Tool type.
**pi:** `packages/agent/src/types.ts` — find `AgentTool` (search "`interface AgentTool`" or "type AgentTool = "). Contrast: 7 methods vs ~60.

**Highlight:** both repos ultimately produce "a function the LLM can call with JSON arguments." Everything between is UI, permissions, prompt-rendering.

**Discussion prompt.**
> *"Which of the ~60 CC methods could be pulled out into middleware? Which are genuinely tool-specific?"*

### Pattern 2 — Permission model (9 min)

**CC:** `src/hooks/toolPermission/` (directory) + `src/permissions/` — the 1,200-line 4-stage permission runtime (read → ML classify → rules → prompt).
**pi:** `packages/agent/src/agent.ts:219` — `subscribe()`; `packages/coding-agent/examples/extensions/permission-gate.ts` — how a user builds permissions in pi.

**Highlight:** CC's permission state is 4 modes × 4 stages × persistent rules + wildcard patterns + UI dialogs. pi's is 2 callbacks + whatever the extension does.

**Discussion prompt.**
> *"A permission system is an opinion. Whose users is each built for — and what happens if you put CC's permissions in pi's use cases (or vice versa)?"*

### Pattern 3 — Streaming (9 min)

**CC:** `src/services/api/claude.ts:752` — `queryModelWithStreaming`; `:2465-2467` — the warning about mid-stream tool dispatch + retry double-execution.
**pi:** `packages/ai/src/types.ts:248` — `AssistantMessageEvent`; `packages/ai/src/stream.ts` — the normalizer.

**Highlight:** CC's streaming is *entangled with* tool execution. pi's streaming is *separated from* tool execution. Both work; the trade-off is latency vs complexity.

**Discussion prompt.**
> *"Which matters more for your product: cutting 300ms off a tool-heavy turn (CC's mid-stream dispatch), or being able to swap providers without touching agent code (pi's normalized events)?"*

### Pattern 4 — Context / state management (9 min)

**CC:** `src/query.ts` — five in-loop compaction strategies (collapse, reactive, proactive, session-memory, message-level); `src/utils/compact*.ts`.
**pi:** `packages/agent/src/` — a single pure compaction function called between turns.

**Highlight:** CC's compaction is embedded in the loop and reacts to *in-flight* failures. pi's is a clean boundary — compact runs, then the next turn begins. Different postures toward failure.

**Discussion prompt.**
> *"Does your agent need in-loop compaction (long, unpredictable sessions) or turn-boundary compaction (shorter, predictable jobs)? How would you know?"*

### Pattern 5 — Sub-agent orchestration (9 min)

**CC:** `src/tools/AgentTool/` (16 files), `src/coordinator/`, `src/tasks/` — full baked-in sub-agent runtime with in-process fork + shared cache.
**pi:** `packages/coding-agent/examples/extensions/subagent/index.ts` — 988 LOC example extension; `:306` spawns a child `pi` process.

**Highlight:** same feature, opposite layer. CC optimizes for **cache economics** (in-process fork, shared prompt cache). pi optimizes for **isolation** (subprocess, zero shared state).

**Discussion prompt.**
> *"Cache-economic sub-agents are 90% cheaper. Subprocess sub-agents can't leak state. When would you choose each? Which does your current product need?"*

---

## 11:20–11:30 · Wrap (10 min)

Five minutes to walk the "steal this" list from `notes/05-steal-this.md`:

1. **Mid-stream tool dispatch** — latency win, complexity cost.
2. **Cascading overflow recovery** — your users will thank you.
3. **Cache-identical sub-agent fork** — free parallelism if you design for it.
4. **Lifecycle-event extension SDK** — let your users write the features you don't have time for.
5. **Normalized multi-provider stream protocol** — provider churn insurance.

**Closing discussion (5 min).**
> *"Pick one of these five. Say the pattern out loud, and say what it would cost you to ship it next week. We'll do a round — everybody picks one."*

Go around the room. Note who picks what — this is your follow-up list for session 02.

---

## Logistical cheat sheet

- **Two projectors ideal.** One for Claude Code, one for pi-mono. If one projector: use vertical split in your editor.
- **Terminal open on both repos at the SHAs in `README.md`** (`126c3115…` for claude-code, `9f91276a…` for pi-mono). A late push to either repo could invalidate the line numbers — always pin.
- **`notes/02-architecture-map.md`** should be open in a browser/editor tab the whole session — it's the index for "what file do we open next?"
- **`notes/04-five-patterns.md`** is what you drive the 45-minute compare-and-extract section from. Have it open.
- **Discussion prompts are the product.** If a block runs long, cut *file* time, not prompt time. People will remember the conversation, not the line numbers.

---

## If you run out of time

Cut in this order, from first-to-cut to last-to-cut:

1. Cut **pi-mono File 2** (normalized stream protocol) — this is easier to understand from `notes/04-five-patterns.md` Pattern 3 alone.
2. Cut **Claude Code File 2** (`Tool.ts` walkthrough) — you cover the same ground in Pattern 1 of the compare section.
3. Cut **Pattern 3 discussion prompt** in compare-and-extract — tightest pattern to explain quickly without discussion.
4. Never cut the **9:30-9:35 opening prompt** or the **11:20-11:30 closing round**. Those are what turn 15 viewers into 15 participants.
