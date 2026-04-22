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
