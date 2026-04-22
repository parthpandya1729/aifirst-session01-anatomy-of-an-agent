import readline from "node:readline/promises";
import { Agent } from "./agent.js";
import { bashTool } from "./tools/bash.js";
import { readTool } from "./tools/read.js";

const agent = new Agent([readTool, bashTool], (chunk) => process.stdout.write(chunk));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log("mini-agent — type 'exit' to quit\n");

while (true) {
	const input = (await rl.question("> ")).trim();
	if (!input || input === "exit") break;
	await agent.run(input);
	process.stdout.write("\n\n");
}
rl.close();
