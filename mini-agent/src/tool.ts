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
