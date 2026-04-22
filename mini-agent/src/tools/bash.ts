import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "../tool.js";

const run = promisify(exec);

export const bashTool: Tool = {
	name: "bash",
	description:
		"Run a shell command in the current working directory. 30s timeout, 10k char output cap.",
	input_schema: {
		type: "object",
		properties: {
			command: { type: "string", description: "Shell command to execute" },
		},
		required: ["command"],
	},
	async execute({ command }: { command: string }) {
		const { stdout, stderr } = await run(command, {
			timeout: 30_000,
			maxBuffer: 1_000_000,
		});
		const combined = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
		return combined.slice(0, 10_000);
	},
};
