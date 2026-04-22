# Build your own minimal AI agent framework

We just read ~625k lines of TypeScript across two production agent CLIs. The *core idea* — the thing that actually makes an agent an agent — fits in **under 200 lines of code**. Everything else is production hardening.

This note is a working blueprint. Copy the code below into a fresh directory, add your `ANTHROPIC_API_KEY`, and you have a working coding agent. From there you can grow it in whichever direction your product needs — compaction, permissions, extensions, multi-provider, sub-agents — using the two reference repos as your playbook.

**Design philosophy:** follow pi-mono's posture, not Claude Code's. Pure loop, small tool contract, push everything else outward. When you need a specific feature, you'll find the pattern for it in one of the other notes files.

---

## The five pieces you actually need

1. **LLM client that streams and supports tool calls** — one provider (Anthropic) to start.
2. **Tool contract** — a tiny interface: name, description, JSON schema, execute.
3. **Agent loop** — ask model → dispatch tool calls → feed results back → repeat until model stops calling tools.
4. **Transcript state** — an array of messages, appended as the loop runs.
5. **CLI REPL** — read user input, stream assistant output, loop.

That's it. ~180 lines total.

## What we're deliberately **not** building

Each of these is a feature you should add only when your users ask for it. Citations point to where the two reference repos implement them.

| Skipped | Why skip first | When to add | Reference to steal from |
|---|---|---|---|
| Permission system | Takes ~1,200 LOC in CC; trivially trust the user for now | First time a tool does something destructive | `claude-code/src/hooks/toolPermission/` (heavy) or `pi-mono/packages/coding-agent/examples/extensions/permission-gate.ts` (light) |
| Context compaction | Modern models have 200k–1M token windows; you won't hit it in early use | First time a user hits context-length errors | `notes/05-steal-this.md` pattern #2 (cascading overflow recovery) |
| Sub-agents | The loop works fine single-agent; adds coordination complexity | When single-agent runs get too long for one context | `notes/05-steal-this.md` pattern #3 (cache-identical fork) |
| Multi-provider | One provider works; abstraction costs code | Second provider request from a user | `pi-mono/packages/ai/src/types.ts:248` (`AssistantMessageEvent` as normalization target) |
| Mid-stream tool dispatch | Adds retry/double-execution edge cases | When latency becomes the complaint | `claude-code/src/services/api/claude.ts:2465-2467` (warning comment worth reading) |
| Extension SDK | Premature until you have ≥3 features you can't decide whether to build in | When your GitHub issues fill up with "can you add X?" | `pi-mono/packages/coding-agent/src/core/extensions/types.ts:907-928` |

Pi-mono's core `packages/agent/src/` is ~1,900 LOC — proof that a usable agent runtime can be very small. Ours will be smaller because we skip the multi-provider layer.

---

## File tree

```
mini-agent/
├── package.json
├── tsconfig.json
├── .env                    # ANTHROPIC_API_KEY=...
└── src/
    ├── tool.ts             # The Tool interface (~15 lines)
    ├── provider.ts         # Anthropic adapter + streaming (~35 lines)
    ├── agent.ts            # The loop (~55 lines)
    ├── cli.ts              # REPL entry point (~25 lines)
    └── tools/
        ├── read.ts         # read_file tool (~20 lines)
        └── bash.ts         # bash tool (~25 lines)
```

Seven files, ~175 lines of TypeScript, one dependency at runtime.

---

## The code

### `package.json`

```json
{
  "name": "mini-agent",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "tsx src/cli.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

### `src/tool.ts`

The whole tool contract. Four fields, one method. Compare to Claude Code's ~60-method `Tool.ts:362` — we'll layer UI/permissions/renderers on later, as extensions, if we ever need them.

```typescript
export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute(input: any): Promise<string>;
}
```

### `src/provider.ts`

One function: send transcript + tools, stream text to the callback, return the final message. This is the file you replace when you add a second provider — keep it thin.

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "./tool.js";

const client = new Anthropic();

export async function callModel(
  messages: Anthropic.MessageParam[],
  tools: Tool[],
  onText: (chunk: string) => void,
): Promise<Anthropic.Message> {
  const stream = client.messages.stream({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    messages,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    })),
  });
  stream.on("text", onText);
  return await stream.finalMessage();
}
```

### `src/agent.ts`

The loop. This is the file to read side-by-side with `claude-code/src/query.ts:241` and `pi-mono/packages/agent/src/agent-loop.ts:155` — same shape, a tenth of the LOC.

Exit condition: model returns a `stop_reason` that is not `tool_use`. That's the one exit reason that matters. Everything else the reference repos track (max-turns, aborted, cancelled, rate-limited, overflow) is production hardening.

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import { callModel } from "./provider.js";
import type { Tool } from "./tool.js";

export class Agent {
  private transcript: Anthropic.MessageParam[] = [];

  constructor(
    private tools: Tool[],
    private onText: (chunk: string) => void,
  ) {}

  async run(userInput: string): Promise<void> {
    this.transcript.push({ role: "user", content: userInput });

    while (true) {
      const response = await callModel(this.transcript, this.tools, this.onText);
      this.transcript.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") return;

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const tool = this.tools.find((t) => t.name === block.name);
        if (!tool) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Unknown tool: ${block.name}`,
            is_error: true,
          });
          continue;
        }
        try {
          const output = await tool.execute(block.input);
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: output });
        } catch (e) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: (e as Error).message,
            is_error: true,
          });
        }
      }
      this.transcript.push({ role: "user", content: toolResults });
    }
  }
}
```

### `src/tools/read.ts`

```typescript
import { readFile } from "node:fs/promises";
import type { Tool } from "../tool.js";

export const readTool: Tool = {
  name: "read_file",
  description: "Read a UTF-8 text file from disk and return its contents.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path to the file" },
    },
    required: ["path"],
  },
  async execute({ path }: { path: string }) {
    return await readFile(path, "utf8");
  },
};
```

### `src/tools/bash.ts`

```typescript
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "../tool.js";

const run = promisify(exec);

export const bashTool: Tool = {
  name: "bash",
  description: "Run a shell command in the current working directory. 30s timeout, 10k char output cap.",
  input_schema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute" },
    },
    required: ["command"],
  },
  async execute({ command }: { command: string }) {
    const { stdout, stderr } = await run(command, { timeout: 30_000, maxBuffer: 1_000_000 });
    const combined = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
    return combined.slice(0, 10_000);
  },
};
```

### `src/cli.ts`

```typescript
import readline from "node:readline/promises";
import { Agent } from "./agent.js";
import { readTool } from "./tools/read.js";
import { bashTool } from "./tools/bash.js";

const agent = new Agent(
  [readTool, bashTool],
  (chunk) => process.stdout.write(chunk),
);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log("mini-agent — type 'exit' to quit\n");

while (true) {
  const input = (await rl.question("> ")).trim();
  if (!input || input === "exit") break;
  await agent.run(input);
  process.stdout.write("\n\n");
}
rl.close();
```

---

## Run it

```bash
mkdir mini-agent && cd mini-agent
# paste the files above into place
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```

Try:

```
> list the .ts files in the current directory and summarize what each one does
```

The model will call `bash` to list files, then `read_file` on each, then summarize. Watch the loop do its work.

---

## How to grow it (in the order that matters)

Add features when you feel the pain, not before. Order by how likely a real user is to demand each:

1. **Stop/abort on Ctrl-C.** Pass an `AbortSignal` into `callModel` and check it between loop iterations. ~10 lines. First thing users will want.
2. **More tools.** Copy the pattern from `read.ts` / `bash.ts`. `write_file`, `edit_file`, `glob`, `grep` are the usual next four. See `claude-code/src/tools/` for worked examples — copy the contracts, not the 60-method Tool type.
3. **System prompt.** Add a `system: string` param to `callModel` and pipe it through. Use this for your agent's persona and its "how to use tools" instructions. ~5 lines.
4. **Transcript cap / simple compaction.** When the transcript gets long, drop all but the last N turns (or summarize older turns). Start with the dumb version — see pi-mono's pure-function compaction in `packages/agent/src/` for the clean shape.
5. **A permission callback.** Replace direct `tool.execute(...)` with `await confirm(block) && tool.execute(...)`. One-line change. Grow into Claude Code's 4-stage model only if you ship to untrusted users.
6. **An abort-and-retry ladder around the API call.** When `callModel` throws a 413 or 5xx, attempt a single retry before surfacing. See `notes/05-steal-this.md` pattern #2 for the full ladder.
7. **Extension hook points.** Emit events (`turn_start`, `tool_call`, `turn_end`, etc.) and let users subscribe. See `pi-mono/packages/agent/src/types.ts:337-352` for the union to copy.

Steps 1–3 fit in an afternoon. Steps 4–7 are each a weekend. Don't do them until a user asks.

---

## What you can ship on top of this 180-line core

Everything in `notes/04-five-patterns.md` and `notes/05-steal-this.md` is additive to the code above. The loop itself doesn't need to change for any of them — you're always adding layers around a stable core. That's the real lesson of reading pi-mono and Claude Code side by side: **the loop is small; the production surface is enormous; you decide which layers your product actually needs.**

---

## Cross-references to the reference repos

| Piece of our framework | Analogous code in Claude Code | Analogous code in pi-mono |
|---|---|---|
| `agent.ts` — the loop | `claude-code/src/query.ts:241` (`queryLoop`) | `pi-mono/packages/agent/src/agent-loop.ts:155` (`runLoop`) |
| `tool.ts` — the contract | `claude-code/src/Tool.ts:362` (Tool type, ~60 methods) | `pi-mono/packages/agent/src/types.ts` (`AgentTool`, 7 methods) |
| `provider.ts` — streaming | `claude-code/src/services/api/claude.ts:752` (`queryModelWithStreaming`) | `pi-mono/packages/ai/src/stream.ts` + `providers/` |
| `cli.ts` — REPL | `claude-code/src/main.tsx` (React/Ink) | `pi-mono/packages/coding-agent/src/cli.ts` |
| Tools (`read_file`, `bash`) | `claude-code/src/tools/FileReadTool/`, `src/tools/BashTool/` | `pi-mono/packages/coding-agent/src/tools/` |

Read our 180 lines, then read the analogous files above. You'll see exactly which complexity is essential and which is optional.
