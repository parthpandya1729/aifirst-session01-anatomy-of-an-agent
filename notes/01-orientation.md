# Stage 1 — Orientation

> Scope: structural feel of both codebases before any deep file read. All numbers measured directly (not quoted from READMEs).

---

## Claude Code

**Purpose (one sentence):** Anthropic's official terminal-native coding CLI — a React/Ink REPL that drives the Claude API with a ~40-tool agent loop, ~85 slash commands, MCP client+server, IDE bridge, and multi-agent orchestration.

- **Total files in `src/`:** 1,940 (all file types)
- **TS/TSX files in `src/`:** 1,916
- **Total LOC (TS/TSX):** **519,426**
- **Runtime / stack:** Bun · TypeScript strict · React + Ink · Commander.js · Zod v4 · GrowthBook · OpenTelemetry

### Top 5 largest files

| # | Path | Lines | What it's for |
|---|------|------:|---------------|
| 1 | `src/cli/print.ts` | 5,596 | Non-interactive `print` / `--print` mode — streaming stdout renderer for scripting/CI use |
| 2 | `src/utils/messages.ts` | 5,513 | Conversation-message manipulation: construction, normalization, tool-result stitching |
| 3 | `src/utils/sessionStorage.ts` | 5,106 | Session persistence — resume, replay, thinkback, session index |
| 4 | `src/utils/hooks.ts` | 5,023 | User-defined shell hooks (pre/post tool, stop, notifications) — the harness extension surface |
| 5 | `src/screens/REPL.tsx` | 5,006 | The main interactive screen — input buffer, message feed, status line, all wired together |

**Also notable but outside the top 5:** `src/main.tsx` (4,684), `src/utils/bash/bashParser.ts` (4,437), `src/services/api/claude.ts` (3,420), `src/services/mcp/client.ts` (3,349), `src/QueryEngine.ts` (1,297).

### Key architecture docs (`docs/`)

| Doc | What it covers |
|-----|----------------|
| `architecture.md` | The pipeline (Input → CLI → QueryEngine → API → Tool loop → UI), React+Ink state, feature flags, lazy loading, concurrency model. Good ~5-minute overview. |
| `tools.md` | Complete catalog of ~40 tools grouped by category (FS, shell, agents, tasks, web, MCP, LSP, scheduling, utility) + the `buildTool({…})` shape + permission modes. |
| `commands.md` | ~85 slash commands by category (git, code quality, session, config, memory, MCP, auth, tasks, diagnostics, setup, IDE, misc, debug). Shows 3 command types: `prompt`, `local`, `localJSX`. |
| `subsystems.md` | Deep dives into Bridge (IDE), MCP client+server, Permissions, Plugins, Skills, Tasks, Memory, Coordinator (multi-agent), Voice, Service layer. Highest-leverage doc for the session. |
| `exploration-guide.md` | "How to find things" — study paths, grep patterns, `buildTool` pattern, feature-flag idiom, ESM `.js` convention. Good handout for attendees. |
| `bridge.md` | Bridge transport v1/v2, auth stack (OAuth + JWT + trusted-device + work secret), feature-gate audit. Very IDE-specific. |

---

## pi-mono

**Purpose (one sentence):** An MIT-licensed monorepo of primitives for building AI agents — a multi-provider LLM client, a reusable agent runtime with tool-calling and streaming, plus four concrete products (coding CLI, Slack bot, vLLM pod manager, web chat components) built on the same core.

- **Total TS/TSX files (all packages `src/`):** 300
- **Total LOC (TS/TSX):** **105,172**
- **Runtime / stack:** Node+Bun · TypeScript strict · vitest · TypeBox · lockstep-versioned npm workspaces

### Packages

| Package | Files / LOC | One-line purpose |
|---|---|---|
| **ai** (`@mariozechner/pi-ai`) | 44 / 28,382 | Unified multi-provider LLM API — streams `text`/`tool_call`/`thinking`/`usage`/`stop` events. 11 providers (Anthropic, OpenAI Responses, OpenAI Completions, Google, Gemini CLI, Google Vertex, Amazon Bedrock, Azure OpenAI, Mistral, GitHub Copilot, Codex Responses) plus a `faux` test provider. Auto-generated `models.generated.ts` alone is 14,830 LOC. |
| **agent** (`@mariozechner/pi-agent-core`) | **5 / 1,933** | The reusable agent runtime — *this is the core*. Files: `agent.ts`, `agent-loop.ts`, `types.ts`, `proxy.ts`, `index.ts`. State-machine over `AgentMessage`s, subscribable event stream, tool execution. |
| **coding-agent** (`@mariozechner/pi-coding-agent`) | 130 / 43,432 | The `pi` CLI — consumes `pi-agent-core`. `core/` (23K LOC) has session/compaction/extensions/tools; `modes/` (15K LOC) has interactive + rpc modes. Biggest single file: `interactive-mode.ts` (5,145). |
| **mom** (`@mariozechner/pi-mom`) | 16 / 4,046 | Slack bot ("Master of Mischief") that consumes the same agent core. Tools: bash, read, write, edit, truncate, attach. Self-managing/docker-sandboxed. |
| **tui** (`@mariozechner/pi-tui`) | 25 / 10,977 | Terminal UI primitives — differential rendering, CSI 2026 atomic flushes, bracketed paste, components (Editor, Markdown, SelectList, Image, etc.). Independent of the agent. |
| **pods** (`@mariozechner/pi-pods`) | 9 / 1,773 | CLI for deploying/managing vLLM on remote GPU pods. Not an agent itself. |
| **web-ui** (`@mariozechner/pi-web-ui`) | 71 / 14,629 | Reusable mini-lit web components for AI chat UIs (IndexedDB storage, artifacts, attachments). Parallel to `tui` but for browsers. |

### The reusable agent runtime

`packages/agent/` is the core. Five files, 1,933 LOC total — surprisingly small. `agent-loop.ts` (663) is the tool-calling state machine; `agent.ts` (543) is the subscribable facade; `types.ts` (352) declares `AgentMessage`, events, and declaration-merging extension points; `proxy.ts` (367) is for inter-process transport. Everything else in the monorepo is either a provider wrapper (`ai`), a consumer (`coding-agent`, `mom`, `web-ui`), or a non-agent tool (`tui`, `pods`).

---

## First observations — 5 things worth flagging on Saturday

1. **The Claude Code docs measure file "size" in bytes and present it as lines.** The README's headline claims — "QueryEngine.ts ~46K lines," "Tool.ts ~29K lines," "commands.ts ~25K lines" — are actually the byte counts. True LOC: QueryEngine 1,297 · Tool 794 · commands 758. The real monsters are elsewhere: `cli/print.ts` (5,596), `utils/messages.ts` (5,513), `utils/sessionStorage.ts` (5,106), `utils/hooks.ts` (5,023), `screens/REPL.tsx` (5,006). **Takeaway for the room:** if you walked in expecting to spend the session reading a 46K-line QueryEngine, the action is actually in message plumbing, session storage, and the REPL screen.

2. **pi-agent-core is ~0.4% the size of Claude Code's `src/`.** 1,933 LOC vs 519,426 LOC. The *runtime* part — the LLM-decides-calls-a-tool state machine — fits in five files. Everything else in Claude Code (REPL, IDE bridge, voice, teleport, x402, skills, plugins, coordinator, memdir, sessions, analytics, OAuth, LSP, …) is *harness*, not agent. Good framing for the session: "what fraction of a coding CLI is actually the agent?"

3. **Claude Code talks to exactly one LLM; pi-mono talks to eleven.** Claude Code has one `services/api/claude.ts`. pi-mono's `ai` package has dedicated providers for Anthropic, OpenAI (Responses + Completions + Codex + Azure), Google (native + Gemini CLI + Vertex), Bedrock, Mistral, GitHub Copilot — plus a `faux` provider for deterministic testing. That's not a minor difference; it implies very different assumptions about streaming event shape, tool-call format, thinking mode, and retry surface. The `transform-messages.ts` file exists precisely to translate between them.

4. **pi-mono deliberately tests the agent core against multiple non-CLI surfaces.** The same `pi-agent-core` powers (a) an interactive terminal CLI (`coding-agent`), (b) a Slack bot (`mom`), and (c) browser chat widgets (`web-ui`). That is the strongest structural argument for extracting an agent runtime as a separate package. Claude Code, by contrast, fuses agent logic and REPL+UI inside a single `src/` tree — the only "other surface" is the IDE bridge, which reuses the same process.

5. **Claude Code ships ~40 tools and ~85 slash commands; pi-coding-agent ships ~11 tools.** Claude Code's `src/tools/` has FileRead/Write/Edit, Bash, PowerShell, REPL, Glob, Grep, Web{Fetch,Search}, Agent, SendMessage, Team{Create,Delete}, Task{Create,Update,Get,List,Output,Stop}, Skill, MCP{,Tool,Auth,Resources,ListResources}, LSP, Cron, RemoteTrigger, Sleep, Notebook, TodoWrite, Synthetic, AskUserQuestion, Brief, Config, Plan{Enter,Exit}, Worktree{Enter,Exit}, ToolSearch. pi's `core/tools/` has bash, edit, find, grep, ls, read, truncate, write. The gap is the whole multi-agent/task/skill/scheduling/remote layer. Worth asking the room: *which of those ~30 extras are essential, and which are product features for Anthropic's specific offering?*

---

## Code references

### Claude Code — top-5 largest files (jump points)

| File | Interesting line(s) | What's there |
|---|---|---|
| `claude-code/src/cli/print.ts` | entire file (5,596 lines) | Non-interactive `--print` mode renderer |
| `claude-code/src/utils/messages.ts` | entire file (5,513 lines) | Message construction, normalization, tool-result stitching |
| `claude-code/src/utils/sessionStorage.ts` | entire file (5,106 lines) | Session persistence: resume, replay, thinkback |
| `claude-code/src/utils/hooks.ts` | entire file (5,023 lines) | User-defined pre/post tool hooks |
| `claude-code/src/screens/REPL.tsx` | entire file (5,006 lines) | Main interactive screen |

### Where the "46K lines" misclaim appears (observation 1)

- `claude-code/README.md:82` — "~1,900 files · 512,000+ lines of code" *(this one is correct — total LOC)*
- `claude-code/README.md:216` — `QueryEngine.ts # Core LLM API caller (~46K lines)` — wrong; it's 1,297 lines
- `claude-code/README.md:364` — Key Files table row: `| QueryEngine.ts | ~46K |` — same misleading "K"
- `claude-code/docs/architecture.md:41` — "Query Engine (`src/QueryEngine.ts`, ~46K lines)"
- `claude-code/docs/exploration-guide.md:17` — "Core LLM engine | `src/QueryEngine.ts` (~46K lines)"
- `claude-code/docs/exploration-guide.md:148` — table claims ~46K / ~29K / ~25K (all bytes, not lines)

**Actual line counts** (measured with `wc -l`):
- `claude-code/src/QueryEngine.ts` — 1,297 lines (46,632 bytes)
- `claude-code/src/Tool.ts` — 794 lines (29,518 bytes)
- `claude-code/src/commands.ts` — 758 lines (25,239 bytes)

### pi-mono — agent core (observation 2)

The entire reusable runtime, with exact line counts:

| File | Lines | Role |
|---|---:|---|
| `pi-mono/packages/agent/src/agent.ts` | 543 | `class Agent` (line 158), `subscribe()` (line 219), `prompt()` (line 313) |
| `pi-mono/packages/agent/src/agent-loop.ts` | 663 | `runAgentLoop()` (line 95), inner `runLoop()` (line 155) |
| `pi-mono/packages/agent/src/types.ts` | 352 | `AgentMessage`, `AgentEvent`, `AgentLoopConfig`, `AgentTool` |
| `pi-mono/packages/agent/src/proxy.ts` | 367 | Serialization for RPC-mode |
| `pi-mono/packages/agent/src/index.ts` | 9 | Re-export façade |
| **Total** | **1,934** | |

### One provider vs eleven (observation 3)

- Claude Code's sole API client: `claude-code/src/services/api/claude.ts:752` (`queryModelWithStreaming`), `:818` (`executeNonStreamingRequest`)
- pi-mono provider directory: `pi-mono/packages/ai/src/providers/` — 14 files:
  - `anthropic.ts`, `openai-completions.ts`, `openai-responses.ts`, `openai-codex-responses.ts`, `azure-openai-responses.ts`, `openai-responses-shared.ts`, `google.ts`, `google-gemini-cli.ts`, `google-vertex.ts`, `google-shared.ts`, `amazon-bedrock.ts`, `mistral.ts`, `github-copilot-headers.ts`, `faux.ts`, plus `register-builtins.ts`, `simple-options.ts`, `transform-messages.ts`
- Runtime registry: `pi-mono/packages/ai/src/api-registry.ts:40` (`apiProviderRegistry` Map)
- Stream entry: `pi-mono/packages/ai/src/stream.ts:25` (`stream()`), `:43` (`streamSimple()`)

### Cross-surface reuse (observation 4)

Same `Agent` class imported from all three:

- `pi-mono/packages/coding-agent/src/core/agent-session.ts:22` — `import type { Agent … } from "@mariozechner/pi-agent-core"`
- `pi-mono/packages/mom/src/agent.ts:1` — `import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core"`
- `pi-mono/packages/web-ui/` — imports the same `Agent` and tool registry via `@mariozechner/pi-agent-core` (see package README)

### Tool counts (observation 5)

- Claude Code: `claude-code/src/tools.ts:193` (`getAllBaseTools()` — conditional inclusion logic through line 251), 40 subdirectories under `claude-code/src/tools/`
- pi coding-agent: `pi-mono/packages/coding-agent/src/core/tools/` — 13 files (8 actual tools: `bash.ts`, `edit.ts`, `find.ts`, `grep.ts`, `ls.ts`, `read.ts`, `truncate.ts`, `write.ts`)
- Feature-flag gating in Claude Code: `claude-code/src/tools.ts:16-135` (19 conditional tool imports gated by `feature()`, `USER_TYPE`, env vars)

