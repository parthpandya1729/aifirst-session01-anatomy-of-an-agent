import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "../tool.js";

const client = new Anthropic();

export async function callModelAnthropic(
	messages: Anthropic.MessageParam[],
	tools: Tool[],
	onText: (chunk: string) => void,
): Promise<Anthropic.Message> {
	const stream = client.messages.stream({
		model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
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
