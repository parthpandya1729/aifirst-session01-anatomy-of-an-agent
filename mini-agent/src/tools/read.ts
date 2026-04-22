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
