import type Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { Tool } from "../tool.js";

const client = new OpenAI({
	apiKey: process.env.GROQ_API_KEY,
	baseURL: "https://api.groq.com/openai/v1",
});

export async function callModelGroq(
	messages: Anthropic.MessageParam[],
	tools: Tool[],
	onText: (chunk: string) => void,
): Promise<Anthropic.Message> {
	const openaiMessages = toOpenAIMessages(messages);

	const stream = await client.chat.completions.create({
		model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
		messages: openaiMessages,
		tools: tools.map((t) => ({
			type: "function",
			function: {
				name: t.name,
				description: t.description,
				parameters: t.input_schema,
			},
		})),
		stream: true,
	});

	let text = "";
	const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();

	for await (const chunk of stream) {
		const delta = chunk.choices[0]?.delta;
		if (delta?.content) {
			text += delta.content;
			onText(delta.content);
		}
		for (const tc of delta?.tool_calls ?? []) {
			const idx = tc.index ?? 0;
			const buf = toolCallBuffers.get(idx) ?? { id: "", name: "", args: "" };
			if (tc.id) buf.id = tc.id;
			if (tc.function?.name) buf.name = tc.function.name;
			if (tc.function?.arguments) buf.args += tc.function.arguments;
			toolCallBuffers.set(idx, buf);
		}
	}

	const toolUses = [...toolCallBuffers.values()].map((tc) => ({
		id: tc.id || `toolu_${randomId()}`,
		name: tc.name,
		input: safeJSON(tc.args),
	}));

	const content: Anthropic.ContentBlock[] = [];
	if (text) content.push({ type: "text", text, citations: null } as any);
	for (const tu of toolUses) content.push({ type: "tool_use", ...tu } as any);

	return {
		id: `msg_${randomId()}`,
		type: "message",
		role: "assistant",
		model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
		content,
		stop_reason: toolUses.length > 0 ? "tool_use" : "end_turn",
		stop_sequence: null,
		usage: {
			input_tokens: 0,
			output_tokens: 0,
			cache_creation_input_tokens: null,
			cache_read_input_tokens: null,
		},
	} as Anthropic.Message;
}

function toOpenAIMessages(
	messages: Anthropic.MessageParam[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
	const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
	for (const m of messages) {
		if (typeof m.content === "string") {
			out.push({ role: m.role, content: m.content });
			continue;
		}
		if (m.role === "assistant") {
			let text = "";
			const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = [];
			for (const b of m.content) {
				if (b.type === "text") text += b.text;
				else if (b.type === "tool_use") {
					toolCalls.push({
						id: b.id,
						type: "function",
						function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
					});
				}
			}
			out.push({
				role: "assistant",
				content: text || null,
				...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
			});
			continue;
		}
		for (const b of m.content) {
			if (b.type === "tool_result") {
				const resultText =
					typeof b.content === "string" ? b.content : JSON.stringify(b.content);
				out.push({ role: "tool", tool_call_id: b.tool_use_id, content: resultText });
			} else if (b.type === "text") {
				out.push({ role: "user", content: b.text });
			}
		}
	}
	return out;
}

function safeJSON(s: string): unknown {
	if (!s) return {};
	try {
		return JSON.parse(s);
	} catch {
		return { _raw: s };
	}
}

function randomId() {
	return Math.random().toString(36).slice(2, 14);
}
