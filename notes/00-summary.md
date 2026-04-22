# Session 01 — Summary and cheat sheet

One-page overview of everything in `notes/`. Read this before walking into the room on Saturday 25 April 2026.

---

## One insight per stage

**Stage 1 — Orientation.** Claude Code is 1,916 TS files and ~520k LOC; pi-mono is 300 TS files and ~105k LOC across 7 packages. That 5× size difference shows up everywhere — and almost none of it is "extra features." It's **production weight**: retry ladders, compaction strategies, permission UI, analytics, and IDE/MCP bridges. Flag for the room: the Claude Code README misreports `QueryEngine.ts` as ~46K lines (it's 1,297 — the 46K is file *bytes*). Small thing, but a nice warm-up for "read the code, don't trust the docs." Full details in [`notes/01-orientation.md`](01-orientation.md).

**Stage 2 — Architecture map.** The two repos converge on the same shape: a top-level orchestrator, a tool registry, a provider adapter, a REPL surface, and a permission seam. But the **layering is opposite**. Claude Code stacks 14 files into one binary (everything ships together, toggled by `process.env.USER_TYPE === 'ant'`). pi-mono *separates* the agent runtime (`packages/agent/`) from the coding CLI (`packages/coding-agent/`) so the runtime is reusable — Slack bot, web UI, pods manager all reuse it. Same problem, opposite packaging. Full map in [`notes/02-architecture-map.md`](02-architecture-map.md).

**Stage 3 — Tool loop.** Both repos have the same LLM-decides → call-tool → feed-result loop, but the comparative *size* is the insight: Claude Code's `queryLoop` (`query.ts:241`) is ~200 lines with **12 named exit reasons and 4 retry strategies**; pi-mono's `runLoop` (`agent-loop.ts:155`) is ~60 lines with **2 exit reasons and no in-loop retries**. Claude Code owns failure inside the loop; pi-mono pushes failure to the caller. Both positions are defensible — CC optimizes for the user never seeing an error, pi optimizes for a core that's easy to reason about. Deep-read in [`notes/03-tool-loop.md`](03-tool-loop.md).

**Stage 4 — Five-pattern comparison.** Side-by-side on (1) tool contract, (2) permission model, (3) streaming, (4) context/state, (5) sub-agents. The pattern across all five is **Claude Code bakes in, pi-mono pushes out.** CC has a 1,200-line permission runtime; pi has 2 callbacks. CC has 5 in-loop compaction strategies; pi has 1 pure function between turns. CC has four baked-in sub-agent mechanisms; pi has one 988-line example extension that `spawn()`s a subprocess. Neither is wrong — they optimize for different product realities. Full comparison in [`notes/04-five-patterns.md`](04-five-patterns.md).

**Stage 5 — Steal-this patterns.** Five concrete patterns worth lifting: **mid-stream tool dispatch** (CC, ~halves perceived latency on multi-tool turns), **cascading overflow recovery** (CC, graceful degradation instead of 413 errors), **cache-identical sub-agent fork** (CC, ~90% cheaper sub-agents via byte-identical prompt prefix), **lifecycle-event extension SDK** (pi, user-written TS plugins instead of feature flags), **normalized multi-provider stream protocol** (pi, 9-event union shields agent code from provider churn across 11 providers). Details and citations in [`notes/05-steal-this.md`](05-steal-this.md).

**Stage 6 — Session script.** Minute-by-minute plan for 9:30–11:30: 5-min opening → 25 min Claude Code → 25 min pi-mono → 10 min break → 45 min five-pattern compare → 10 min wrap. The block-by-block breakdown plus a "if you run out of time, cut in this order" section is in [`notes/06-session-script.md`](06-session-script.md). Ten discussion prompts total; the closing round ("pick one of the five steal-this patterns and say what it would cost you to ship next week") is the single most important 5 minutes.

---

## Three files to have open during the walkthrough

Two projectors is ideal. These three files anchor the whole session — if something goes wrong with the script, you can drive 90 minutes off these alone.

1. **`claude-code/src/query.ts`** — open to `:241` (`queryLoop`). The agent loop + the overflow recovery ladder in one place. Drives Stage 3 and Stage 4 Pattern 4.

2. **`pi-mono/packages/agent/src/agent-loop.ts`** — open to `:155` (`runLoop`). Side-by-side contrast to `query.ts` — same loop, one-quarter the size. Drives Stage 3 and Stage 4 Pattern 4.

3. **`pi-mono/packages/coding-agent/examples/extensions/subagent/index.ts`** — open to `:432` (`pi.registerTool`) and `:306` (`spawn(...)` of child `pi` process). The "pi-mono pushes features outward" thesis made concrete — a first-class feature shipped as an 988-line example extension instead of baked-in runtime. Drives Stage 4 Pattern 5 and Stage 5 pattern #4.

Also keep two notes files open in a browser tab:
- **`notes/02-architecture-map.md`** — "what file do we open next?" index.
- **`notes/04-five-patterns.md`** — the script for the 45-minute compare-and-extract block.

---

## Three discussion questions most likely to spark conversation

Curated from Stage 6's ten prompts — the ones most likely to produce disagreement and opinions in the room.

1. **"Is it better to have fat tool objects that own everything, or thin tool functions where the harness layers on UI and permissions?"** (Stage 4 Pattern 1.) Engineers will have strong opinions on this. It's a framing for the entire repo comparison.

2. **"Cache-economic sub-agents are 90% cheaper. Subprocess sub-agents can't leak state. When would you choose each? Which does your current product need?"** (Stage 4 Pattern 5.) This one forces the room to name their own product constraints. That's where the session pays off for founders.

3. **"If your agent had 60 example extensions versus 60 built-in features, which would your users prefer? Does your answer change if your users are (a) engineers or (b) founders?"** (pi-mono walkthrough, File 3.) Gets at the deepest architectural divergence between the two repos and maps directly to how people in this specific room will build.

---

## Surprises worth thinking about before Saturday

- **Claude Code's README misreports file sizes in bytes as lines.** Flag early in Stage 1; it's a nice primer for "read the code, not the docs." Citation: `claude-code/README.md` mentions `QueryEngine.ts` as "~46K lines"; `wc -l` gives 1,297.

- **pi-mono has sub-agents — just not where you'd expect.** They're at `pi-mono/packages/coding-agent/examples/extensions/subagent/index.ts` (988 LOC, 3 modes: single/parallel/chain, `spawn()`s a child `pi` process). *I initially missed this during Stage 4* and wrote that pi-mono had no sub-agent mechanism; the user corrected it. Worth being upfront if anyone in the room asks "does pi have sub-agents?" — the honest answer is "yes, as a user-loadable extension, not baked in, and that's the whole point of pi-mono's extension SDK design."

- **The 12-vs-2 exit reasons asymmetry in the tool loop is the single cleanest illustration of the CC/pi philosophy gap.** If you only had time for one side-by-side on screen, this is the one to show.

- **`Tool.ts` is ~60 methods.** Be ready for "why does this exist?" — the answer is that Claude Code's tool isn't a function, it's a UI component (Ink renderers) + schema + permission-checker + prompt-renderer + executor bundled together. Fat for a reason; not gratuitous.

- **Extension SDK ≈ feature-flag alternative.** When someone asks "why does pi-mono ship 60 example extensions instead of building features in?" — the real answer is "feature flags + bundled-binary is Anthropic's posture because their users want zero-install; extension SDK + examples is badlogic's posture because pi's users are people who write TypeScript." Different users, different right answer.

- **Prompt-cache economics drive more design decisions than you'd guess.** Claude Code's sub-agent fork is literally *designed around* keeping the prompt cache warm (`tools: ['*']` + `useExactTools` → byte-identical prefix → cache hit). If your agent's users pay for tokens, this is the biggest hidden lever in the whole repo.

---

## Reading order for the host (if time-boxed)

If you only have 30 minutes on Friday night to refresh:

1. **This file** (`notes/00-summary.md`) — you're reading it.
2. **`notes/06-session-script.md`** — the minute-by-minute. Skim the "if you run out of time" section at the bottom.
3. **`notes/04-five-patterns.md`** — the cross-cutting table at the end is the single best artifact; everything else is backup.
4. Open `claude-code/src/query.ts` and `pi-mono/packages/agent/src/agent-loop.ts` side by side once, for 5 minutes. That's what the room is going to see — you want that visual in your head before you're on the clock.

If you have 2 hours: read `notes/01-orientation.md` → `notes/02-architecture-map.md` → `notes/03-tool-loop.md` in full, in order. They build on each other.
