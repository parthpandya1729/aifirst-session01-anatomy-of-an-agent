import type Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import type { Tool } from "../tool.js";

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function callModelGemini(
	messages: Anthropic.MessageParam[],
	tools: Tool[],
	onText: (chunk: string) => void,
): Promise<Anthropic.Message> {
	const contents = toGeminiContents(messages);

	const stream = await client.models.generateContentStream({
		model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
		contents,
		config: {
			tools: [
				{
					functionDeclarations: tools.map((t) => ({
						name: t.name,
						description: t.description,
						parameters: t.input_schema as any,
					})),
				},
			],
		},
	});

	let text = "";
	const toolUses: Array<{ id: string; name: string; input: unknown }> = [];

	for await (const chunk of stream) {
		if (chunk.text) {
			text += chunk.text;
			onText(chunk.text);
		}
		for (const fc of chunk.functionCalls ?? []) {
			toolUses.push({
				id: `toolu_${randomId()}`,
				name: fc.name ?? "unknown",
				input: fc.args ?? {},
			});
		}
	}

	const content: Anthropic.ContentBlock[] = [];
	if (text) content.push({ type: "text", text, citations: null } as any);
	for (const tu of toolUses) content.push({ type: "tool_use", ...tu } as any);

	return {
		id: `msg_${randomId()}`,
		type: "message",
		role: "assistant",
		model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
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

function toGeminiContents(messages: Anthropic.MessageParam[]) {
	const idToName = new Map<string, string>();
	const contents: Array<{ role: "user" | "model"; parts: any[] }> = [];

	for (const m of messages) {
		const role = m.role === "assistant" ? "model" : "user";
		if (typeof m.content === "string") {
			contents.push({ role, parts: [{ text: m.content }] });
			continue;
		}
		const parts: any[] = [];
		for (const b of m.content) {
			if (b.type === "text") {
				parts.push({ text: b.text });
			} else if (b.type === "tool_use") {
				idToName.set(b.id, b.name);
				parts.push({ functionCall: { name: b.name, args: b.input as any } });
			} else if (b.type === "tool_result") {
				const name = idToName.get(b.tool_use_id) ?? "unknown";
				const resultText =
					typeof b.content === "string" ? b.content : JSON.stringify(b.content);
				parts.push({
					functionResponse: {
						name,
						response: b.is_error ? { error: resultText } : { result: resultText },
					},
				});
			}
		}
		if (parts.length > 0) contents.push({ role, parts });
	}
	return contents;
}

function randomId() {
	return Math.random().toString(36).slice(2, 14);
}
