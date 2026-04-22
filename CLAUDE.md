# AI-First Builder Series — Session 01 Prep

This directory holds prep work for **"Anatomy of an Agent"**, the first session of Varahi Technologies' AI-First Builder Series (Saturday 25 April 2026, Pune office + livestream, ~15 founders/engineers in the room).

The session is a 2-hour collaborative deep-read of two agentic coding CLI codebases side-by-side. Your job is to help the host walk in on Saturday knowing both repos well enough to lead the walkthrough, facilitate comparison, and extract common patterns.

## Repos under analysis

Both repos should be cloned as siblings of this file. Clone if missing:

```bash
git clone https://github.com/codeaashu/claude-code.git    # ./claude-code/
git clone https://github.com/badlogic/pi-mono.git         # ./pi-mono/
mkdir -p notes
```

- `./claude-code/` — community archive of the Claude Code CLI (leaked source; may have broken imports or Anthropic-internal refs — note, don't fix).
- `./pi-mono/` — MIT-licensed monorepo, live and maintained. Check `git log --oneline -10 packages/<name>/` if a package looks half-finished.
- `./notes/` — all output lands here.

## Working principles

- **Explore, don't guess.** Use Glob/Grep/Read to inspect actual code. Don't summarize from training data.
- **Cite files and line numbers** for every claim. `path:line` format.
- **Signal over coverage.** ~15 most important files per repo, understood deeply — not every file catalogued.
- **Stay in the two repos.** No outside API calls or references unless asked.
- **Plan each stage.** Before executing a stage, outline 3–5 bullets of what you'll do, then proceed.
- **Flag surprises.** Contradictions, clever patterns, confusing choices — these are what make the session worth attending.
- **Reading exercise, not coding.** The only files you produce are the markdown notes below. Don't write runnable code.
- **Short excerpts.** When quoting code: under 20 lines per file, never more than 15 words of verbatim comments. Paraphrase generously.
- **Flag gaps honestly.** "I couldn't find X in pi-mono — here's what I looked for" beats a fabricated answer.

## Stage-by-stage workflow

Work through stages in order. After each stage, **stop and surface the output file for review** before continuing. If the user doesn't respond, assume they're busy and continue — but don't skip stages or merge them.

1. **Stage 1 — Orient and size up** → `notes/01-orientation.md`
   - Read `claude-code/README.md`, every file in `claude-code/docs/`, tree `src/` 2 levels, count files/LOC, top 5 largest files.
   - Read `pi-mono/README.md` and `AGENTS.md`, list every `packages/*` with one-line purpose, total files/LOC, identify the reusable agent-runtime package.

2. **Stage 2 — Architecture map** → `notes/02-architecture-map.md`
   - Claude Code: map `src/main.tsx`, `QueryEngine.ts`, `Tool.ts`, `tools.ts`, `commands.ts`, `context.ts`, `cost-tracker.ts`, 2 representative `tools/*`, `hooks/toolPermission/`, `services/api/`, `services/mcp/`, `coordinator/`.
   - pi-mono: map `packages/ai/src/index.ts` and its multi-provider abstraction, `packages/agent/src/` (runtime + loop + state), `packages/coding-agent/src/`, `packages/mom/src/`, `packages/tui/src/`, `packages/pods/src/`.

3. **Stage 3 — Deep-read the tool loop** → `notes/03-tool-loop.md`
   - In both repos, locate the LLM-decides → call-tool → feed-result → repeat loop. Document: location (file + line range), exit conditions, dispatch, result injection, streaming, retries, thinking-mode integration. Include ~15-line excerpt of each core loop.

4. **Stage 4 — Five-pattern comparison** → `notes/04-five-patterns.md`
   - Side-by-side on: (1) tool contract, (2) permission model, (3) streaming, (4) context/state management, (5) sub-agent orchestration. For each: files, the contract/shape, notable choices, convergence/divergence, one insight to highlight.

5. **Stage 5 — "Steal-this" patterns** → `notes/05-steal-this.md`
   - 5 concrete patterns builders could copy. Each: 3–5 word name, 3-sentence description, file citations, why it's worth stealing. At least one per repo.

6. **Stage 6 — Session script** → `notes/06-session-script.md`
   - Minute-by-minute walkthrough plan for 9:30–11:30. Blocks: opening (9:30–9:35), Claude Code walkthrough (9:35–10:00), pi-mono walkthrough (10:00–10:25), break (10:25–10:35), compare & extract (10:35–11:20), wrap (11:20–11:30). For each block: files to open, 2–3 key lines to highlight per file, a discussion prompt, estimated time per file.

7. **Final summary** → `notes/00-summary.md`
   - One-paragraph insight per stage, the 3 files to have open during the walkthrough, the 3 discussion questions most likely to spark conversation, anything surprising worth thinking about before Saturday.

## Final deliverables

```
notes/
├── 00-summary.md
├── 01-orientation.md
├── 02-architecture-map.md
├── 03-tool-loop.md
├── 04-five-patterns.md
├── 05-steal-this.md
└── 06-session-script.md
```
