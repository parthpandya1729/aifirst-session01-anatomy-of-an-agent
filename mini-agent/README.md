# mini-agent

A working ~180-line AI agent framework. Companion code to [`../notes/06-build-your-own-agent.md`](../notes/06-build-your-own-agent.md) — read the notes file first for the design rationale and the "what to add next" guide.

## What's in it

```
mini-agent/
├── package.json
├── tsconfig.json
├── .env.example
└── src/
    ├── tool.ts              # Tool interface (5 fields)
    ├── provider.ts          # Provider router (PROVIDER env var)
    ├── providers/
    │   ├── anthropic.ts     # Anthropic streaming adapter
    │   ├── gemini.ts        # Gemini streaming adapter + format translator
    │   └── groq.ts          # Groq (OpenAI-compatible) adapter + format translator
    ├── agent.ts             # The loop
    ├── cli.ts               # REPL entry point
    └── tools/
        ├── read.ts          # read_file tool
        └── bash.ts          # bash tool
```

Three runtime dependencies (`@anthropic-ai/sdk`, `@google/genai`, `openai`). No permissions, no compaction, no sub-agents — by design. Add those when a real user asks for them; the notes file lists the order.

## Run it

```bash
cd mini-agent
cp .env.example .env           # pick PROVIDER=anthropic | gemini | groq, set the matching key
npm install
export $(cat .env | xargs)     # or use a tool like `direnv`
npm start
```

See [`USAGE.md`](USAGE.md) for the provider table, examples, and troubleshooting.

Then try a prompt that forces multiple tool calls:

```
> list the .ts files in src/ and summarize each one in one line
```

You'll watch the model call `bash` to list, then `read_file` on each, then summarize — all through the same loop.

## Typecheck

```bash
npm run typecheck
```

## Why it's structured this way

The loop in `src/agent.ts` is the same shape as `claude-code/src/query.ts:241` (`queryLoop`) and `pi-mono/packages/agent/src/agent-loop.ts:155` (`runLoop`) — just with every production complication stripped out. Read the three side by side and you'll see exactly which pieces are essential and which are optional.

See [`../notes/06-build-your-own-agent.md`](../notes/06-build-your-own-agent.md) for the full cross-reference table.
