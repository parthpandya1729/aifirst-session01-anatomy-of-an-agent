# mini-agent — usage

A one-page practical guide for running the agent and poking at it. For design rationale and the "what to add next" ladder, read [`../notes/06-build-your-own-agent.md`](../notes/06-build-your-own-agent.md).

## Prerequisites

- Node.js 20+ (uses `node:readline/promises` and native `fetch`)
- One of:
  - **Anthropic** API key — [console.anthropic.com](https://console.anthropic.com/)
  - **Gemini** API key — [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (generous free tier)
  - **Groq** API key — [console.groq.com/keys](https://console.groq.com/keys) (free tier, very fast)

## First run

```bash
cd mini-agent
cp .env.example .env                  # fill in the section for your provider
npm install
export $(cat .env | xargs)
npm start
```

## Choosing a provider

The `PROVIDER` env var picks the backend. Defaults to `anthropic` if unset.

| PROVIDER | Required keys | Default model | Override env var |
|---|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5` | `ANTHROPIC_MODEL` |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.5-flash` | `GEMINI_MODEL` |
| `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` | `GROQ_MODEL` |

Switching providers is a one-line change in `.env`:

```bash
PROVIDER=groq
GROQ_API_KEY=...
```

The agent's transcript stays in the Anthropic message shape internally. Each adapter in `src/providers/` translates to/from its native format — Gemini's `functionCall`/`functionResponse`, or OpenAI-style `tool_calls`/`role: "tool"` for Groq — so `src/agent.ts` never has to know which backend is live.

**Groq note:** Groq is OpenAI-compatible, so the adapter uses the `openai` SDK pointed at `https://api.groq.com/openai/v1`. Tool-use quality depends on the model — stick to Llama 3.3 70B or newer for reliable multi-turn tool calls. Smaller or older models often drop tool calls silently.

You should see:

```
mini-agent — type 'exit' to quit

>
```

## Try these prompts

Each one exercises a different part of the loop.

| Prompt | What you should see |
|---|---|
| `what files are in src/?` | One `bash` call (`ls src/`), then a text reply. |
| `read src/agent.ts and explain the main loop` | One `read_file` call, then streamed prose. |
| `list the .ts files in src/ and summarize each in one line` | `bash` → multiple `read_file` calls → summary. Good demo of multi-turn tool use. |
| `what's in package.json? also show me the git log` | Two parallel tool calls in a single turn — watch both results come back before the model speaks. |

Tool calls aren't printed — only the model's text is streamed. To see the tool traffic, add a `console.log` in `src/agent.ts` inside the `for (const block of response.content)` loop.

## Configuration

Everything worth changing is in `src/`:

- **Provider** — `PROVIDER` env var (`anthropic` | `gemini` | `groq`). Routed in `src/provider.ts`.
- **Anthropic model** — `ANTHROPIC_MODEL` env var, or default in `src/providers/anthropic.ts`. Swap for `claude-opus-4-7` or `claude-haiku-4-5-20251001`.
- **Gemini model** — `GEMINI_MODEL` env var, or default in `src/providers/gemini.ts`. Swap for `gemini-2.5-pro` for a stronger model.
- **Groq model** — `GROQ_MODEL` env var, or default in `src/providers/groq.ts`. `llama-3.3-70b-versatile` is the default; see Groq's model list for alternatives.
- **Max tokens per turn (Anthropic only)** — `src/providers/anthropic.ts`, `max_tokens: 4096`.
- **Registered tools** — `src/cli.ts:6`. Pass whatever tools you want into `new Agent([...])`.
- **Bash timeout / output cap** — `src/tools/bash.ts:20` (30s / 10k chars).

## Adding a tool

Create a file in `src/tools/` that exports a `Tool`:

```ts
import type { Tool } from "../tool.js";

export const writeTool: Tool = {
  name: "write_file",
  description: "Write UTF-8 text to a file on disk.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  async execute({ path, content }) {
    await (await import("node:fs/promises")).writeFile(path, content, "utf8");
    return `wrote ${content.length} bytes to ${path}`;
  },
};
```

Register it in `src/cli.ts`:

```ts
const agent = new Agent([readTool, bashTool, writeTool], ...);
```

That's the whole extension story. No plugin loader, no registry, no permissions. The agent trusts every tool it's handed — which is exactly why you should not expose this thing to the open internet.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `401 Unauthorized` from Anthropic | `ANTHROPIC_API_KEY` not exported. `echo $ANTHROPIC_API_KEY` to verify. |
| `API key not valid` from Gemini | `GEMINI_API_KEY` not exported, or `PROVIDER` still set to `anthropic`. |
| `401` / `Invalid API Key` from Groq | `GROQ_API_KEY` not exported. Groq keys start with `gsk_`. |
| Groq model silently skips tool calls | Model too small or doesn't support tool use. Switch `GROQ_MODEL` to `llama-3.3-70b-versatile` or newer. |
| `Unknown PROVIDER: ...` | Typo in `.env` — must be `anthropic`, `gemini`, or `groq` (case-insensitive). |
| `tsx: command not found` | Ran `npm start` without `npm install` first. |
| Output stops mid-sentence (Anthropic) | Hit `max_tokens`. Bump it in `src/providers/anthropic.ts`. |
| Bash tool returns truncated output | 10k char cap in `src/tools/bash.ts:24`. Raise or chunk. |
| REPL hangs after a tool error | It won't — errors are caught in `src/agent.ts:38`, fed back as `is_error: true`, and the model decides what to do. If it does hang, check your network. |

## Safety note

The `bash` tool runs arbitrary commands with **your user's permissions** in the **current working directory**. No sandbox, no allowlist, no confirmation prompts. Only run `mini-agent` in a repo you'd be comfortable letting a tired intern touch. The production repos we studied (`claude-code`, `pi-mono`) both add a permission layer before shipping — see [`../notes/04-five-patterns.md`](../notes/04-five-patterns.md) for how.
