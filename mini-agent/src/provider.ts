import type Anthropic from "@anthropic-ai/sdk";
import { callModelAnthropic } from "./providers/anthropic.js";
import { callModelGemini } from "./providers/gemini.js";
import { callModelGroq } from "./providers/groq.js";
import type { Tool } from "./tool.js";

export async function callModel(
	messages: Anthropic.MessageParam[],
	tools: Tool[],
	onText: (chunk: string) => void,
): Promise<Anthropic.Message> {
	const provider = (process.env.PROVIDER ?? "anthropic").toLowerCase();
	if (provider === "gemini") return callModelGemini(messages, tools, onText);
	if (provider === "groq") return callModelGroq(messages, tools, onText);
	if (provider === "anthropic") return callModelAnthropic(messages, tools, onText);
	throw new Error(
		`Unknown PROVIDER: ${provider}. Use "anthropic", "gemini", or "groq".`,
	);
}
