# AI-First Builder Series — Session 01: Anatomy of an Agent

Prep notes and walkthrough materials for the first session of Varahi Technologies' **AI-First Builder Series**: a collaborative deep-read of two agentic coding CLI codebases, side by side.

- **When:** Saturday 25 April 2026, 9:00 AM – 12:00 PM IST
- **Where:** Varahi Technologies office, Pune (+ livestream)
- **Host:** Parth (Varahi Technologies)
- **Format:** 15 founders & engineers in the room + open livestream. 2-hour guided walkthrough, then group discussion.

This repo contains only the prep notes. The two source codebases under study are **not** redistributed here — clone them yourself from the links below to follow along.

---

## The two repos under study

| Repo | Role in the session | GitHub | Commit we analyzed |
|---|---|---|---|
| **Claude Code CLI** (leaked source archive) | Reference implementation from Anthropic: React/Ink REPL, ~40 tools, ~85 slash commands, IDE bridge, MCP client/server, multi-agent coordinator. | https://github.com/codeaashu/claude-code | `126c31154f72ec9babb39142d173ef8c2a5a9803` (2026-04-07) |
| **pi-mono** | Badlogic's MIT-licensed monorepo: reusable agent runtime (`pi-agent-core`), unified multi-provider LLM client (`pi-ai`), coding-agent CLI, Slack bot, TUI primitives, vLLM pod manager, browser chat UI. | https://github.com/badlogic/pi-mono | `9f91276a42482f8cafeacca8497dbc6d657294c4` (2026-04-22) |

To reproduce the notes on your own machine:

```bash
git clone https://github.com/codeaashu/claude-code.git && (cd claude-code && git checkout 126c31154f72ec9babb39142d173ef8c2a5a9803)
git clone https://github.com/badlogic/pi-mono.git     && (cd pi-mono     && git checkout 9f91276a42482f8cafeacca8497dbc6d657294c4)
```

---

## Notes in this repo

Every file is standalone and cross-linked. File:line citations point into the two source repos above — check them out at the SHAs shown to follow along.

| File | What's in it |
|---|---|
| [`notes/00-summary.md`](notes/00-summary.md) | One-page cheat sheet for the host: one-paragraph insight per stage, the 3 files to keep open during the walkthrough, the 3 highest-signal discussion questions, and a surprises list. Read this first on Friday night. |
| [`notes/01-orientation.md`](notes/01-orientation.md) | Stage 1: structural sizing of both repos — file counts, LOC, top-5 largest files, architecture doc summaries, and 5 first observations (including a flag that Claude Code's README misreports `QueryEngine.ts` as ~46K lines when it's actually 1,297). |
| [`notes/02-architecture-map.md`](notes/02-architecture-map.md) | Stage 2: the 14 most important files in each repo with 2-3 sentence purpose + line-number anchors for every key function/class, plus a top-level structural comparison and a consolidated jump table at the end. |
| [`notes/03-tool-loop.md`](notes/03-tool-loop.md) | Stage 3: deep-read of the LLM-decides → call-tool → feed-result loop in both repos. Claude Code's `queryLoop` (12 exit reasons, 4 retry strategies) vs pi-mono's `runLoop` (2 exit reasons, no in-loop retries), with ~15-line excerpts from each. |
| [`notes/04-five-patterns.md`](notes/04-five-patterns.md) | Stage 4: side-by-side comparison across five patterns — tool contract, permission model, streaming, context/state, sub-agent orchestration. Ends with a consolidated cross-cutting table. |
| [`notes/05-steal-this.md`](notes/05-steal-this.md) | Stage 5: five concrete patterns builders could copy into their own agentic product. Mid-stream tool dispatch, cascading overflow recovery, cache-identical sub-agent fork, lifecycle-event extension SDK, normalized multi-provider stream protocol. |
| [`notes/06-build-your-own-agent.md`](notes/06-build-your-own-agent.md) | Stage 6: a working ~180-line minimal AI agent framework in TypeScript — `tool.ts`, `provider.ts`, `agent.ts`, `cli.ts` + two example tools. Plus a "what to add next and in what order" guide so you grow the framework only when real users demand it. |
| [`notes/side-why-typescript.md`](notes/side-why-typescript.md) | Side memo for the room: why both codebases are TypeScript and not Go or Python. Evidence-based, with 3 discussion prompts. |

### Runnable companion code

The blueprint from Stage 6 is also checked in as a working project at [`mini-agent/`](mini-agent/). `cd mini-agent && npm install && npm start` after setting `ANTHROPIC_API_KEY`. Typechecks cleanly with `npm run typecheck`.

---

## Reading order

1. **Start with `notes/00-summary.md`** for the one-page cheat sheet — it's the host's walk-in brief.
2. **Then `notes/01-orientation.md` → `notes/02-architecture-map.md`** to get the structural feel and the file:line index.
3. **`notes/03-tool-loop.md` → `notes/04-five-patterns.md` → `notes/05-steal-this.md`** are the content spine of the session itself; read in order.
4. **`notes/06-build-your-own-agent.md`** is a working ~180-line minimal AI agent framework — the payoff of everything above, as runnable code.
5. **`notes/side-why-typescript.md`** is optional prep but useful context for the discussion.

Notes follow a strict convention: every non-obvious claim cites a specific file and line number in the two source repos. If a citation looks wrong, the two SHAs in the table above are the ground truth — the repos are moving targets, so pin to those.

---

## Contributing

These are personal prep notes, not an official Varahi Technologies publication. Corrections and additions are welcome — open an issue or PR. Keep two rules in mind:

1. **Every claim needs a `file:line` citation** into one of the two upstream repos at the SHAs above.
2. **Don't redistribute source code.** The Claude Code archive is a leaked upstream; pi-mono is MIT-licensed but still belongs to its authors. Link, don't copy.

---

## License

The notes in this repository are licensed **CC BY 4.0** — attribute Varahi Technologies / Parth if you reuse. The two source codebases under study retain their original licenses and copyright (Anthropic for Claude Code; badlogic / MIT for pi-mono).
