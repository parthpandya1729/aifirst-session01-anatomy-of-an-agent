# Side Note — Why TypeScript (and not Go / Python) for Agentic CLIs?

> Discussion memo for Saturday. Both codebases under study are TypeScript (Claude Code: .tsx + React/Ink; pi-mono: .ts + mini-lit). Worth asking the room *why* — and having an answer grounded in what's actually in the repos, not vibes.

---

## 1. The workload is I/O-bound, not CPU-bound

An agent loop is: HTTP request → stream JSON chunks → spawn subprocess / read file → re-enter the loop. There is essentially no CPU-heavy math in either repo outside of token counting and a little Markdown parsing. Node/Bun's single-threaded event loop with `async`/`await` is a near-perfect match for this shape.

- Go would force you to pick a concurrency model (goroutines + channels) for work that is naturally sequential-with-await.
- Python's async story is workable but less universal — many libs are still sync-first, and the GIL shows up once you try to parallelize streams.
- **Evidence in-repo:** `packages/ai/src/stream.ts` and Claude Code's `services/api/claude.ts` both lean on async iterators over SSE — a pattern TS expresses cleanly with `for await (… of stream)`.

## 2. The API surface is JSON, and TS types *are* the schema

Every LLM provider speaks JSON with nested unions: `{ type: 'text', … } | { type: 'tool_use', … } | { type: 'thinking', … }`. TypeScript's discriminated unions model this natively. Zod (Claude Code) and TypeBox (pi-mono) make the schema and the type the same artifact.

- **Claude Code evidence:** Tool input schemas are Zod objects (`src/Tool.ts`, `buildTool({ inputSchema: z.object({…}) })`). One declaration validates at runtime *and* gives the tool body fully-typed `args`.
- **pi-mono evidence:** `packages/ai/src/utils/typebox-helpers.ts` plus TypeBox-as-JSON-Schema — the same object becomes the OpenAI-style tool schema the provider expects and the TS type the handler receives.
- Go needs struct tags + manual unmarshaling for every event variant; Python has Pydantic but historically runtime-only.

## 3. Terminal UI with a reactive component model

Claude Code uses **React + Ink** — the React renderer for terminals. That's not a gimmick: it lets Anthropic reuse their entire web UI muscle memory (components, hooks, context, state stores) for a CLI. The REPL screen (`src/screens/REPL.tsx`, 5,006 LOC) reads like a React app because it *is* one.

- Go has [Bubble Tea](https://github.com/charmbracelet/bubbletea) — ergonomic but Elm-style, not React-style. Smaller ecosystem.
- Python has [Textual](https://textual.textualize.io/) — nice, but fewer engineers fluent in it vs React.
- **pi-mono evidence:** `packages/tui/` is a hand-rolled minimal TUI with differential rendering — and the *same* agent core (`@mariozechner/pi-agent-core`) also drives `packages/web-ui/` (browser mini-lit components). That cross-surface reuse is only possible because the agent is TS.

## 4. One agent core, many surfaces

This is pi-mono's strongest structural argument. `packages/agent/` (5 files, 1,933 LOC) is imported by:
- `packages/coding-agent/` — terminal CLI
- `packages/mom/` — Slack bot
- `packages/web-ui/` — browser chat UI

Same runtime, three delivery surfaces, all JavaScript. Try that split with Go: you'd need WASM + a whole second stack for the Slack bot. Try it with Python: the browser surface goes away entirely (Pyodide notwithstanding).

## 5. Distribution and iteration speed

- `npm install -g claude-code` / `npx @mariozechner/pi-coding-agent` — zero-friction for the user.
- Bun (Claude Code's runtime) executes `.tsx` directly with no build step. Anthropic can ship the leaked `src/` and it would run.
- Go gives single binaries (genuinely nice) but cross-compilation for macOS/Linux/Windows/arm/x64 is a release-engineering cost.
- Python has well-known install-friction; `pipx` helps but doesn't eliminate it.

## 6. Ecosystem alignment with AI tooling

- **Anthropic SDK**: TypeScript and Python are first-class; JS is what Claude Code uses.
- **MCP (Model Context Protocol)**: reference SDK is TypeScript.
- **OpenAI / Google SDKs**: TS SDKs are on par with Python SDKs.
- **LSP servers, ripgrep, language tooling**: all have TS wrappers.
- Python's ML edge is in *training* (torch, tf, scikit). Agentic *orchestration* — which is what these two repos are — has no such edge.

## 7. The case *against* TS (and why both authors accepted it)

- **Startup time.** Bun helps Claude Code here (native TS, no transpile step). Node with tsx is slower — pi-mono pays this cost.
- **Single-binary distribution.** TS loses to Go on this axis. Bun's `bun build --compile` exists but isn't used by Claude Code as shipped.
- **Memory footprint.** V8 is heavier than a Go runtime. Irrelevant at CLI scale; matters if you fan out many agents server-side (pi-mono's coordinator-less design sidesteps this).
- **Performance-sensitive paths.** Claude Code offloads one to native: `src/native-ts/` has `color-diff`, `file-index`, and a `yoga-layout` wrapper. That's the right tradeoff — TS for the 99% that's I/O, native for the hot paths.

---

## The answer, one sentence for the room

**Agentic CLIs are I/O-bound JSON-plumbing tools with rich terminal UIs, distributed to developers via package managers — and TypeScript is the only mainstream language that is simultaneously good at all four, with the same agent core runnable in a terminal, a browser, and a Slack bot.**

## Discussion prompts

1. *If you were starting a new agentic CLI tomorrow and the LLM API SDK existed equally well in Go, TS, and Python — what would tilt you toward TS, and what would tilt you away?*
2. *Claude Code's leak happened in part because their npm package included source maps. Is that a TS/npm-specific risk, or would Go/Python have equivalent exposure?*
3. *pi-mono's "same agent core, three surfaces" claim — is that real leverage or a marketing point? Would a Go agent core with a Go-to-WASM web frontend be a fair comparison?*
