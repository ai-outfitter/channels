import { readFile } from "node:fs/promises";
import type { A2aArtifact } from "./types.ts";
import { OUTFITTER_TASK_EXTENSION_KEY, OUTFITTER_TASK_EXTENSION_URI } from "./types.ts";

const OUTPUT_SLUG_PATTERN = "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$";
const outputSlug = new RegExp(OUTPUT_SLUG_PATTERN);

export type WorkflowOutputDeclarations = ReadonlyMap<string, { readonly type: string }>;

interface WorkflowManifest {
	readonly workflows: readonly {
		readonly id: string;
		readonly outputs: Readonly<Record<string, unknown>>;
	}[];
}

export async function loadWorkflowOutputsFromEnv(): Promise<
	WorkflowOutputDeclarations | undefined
> {
	const path = process.env.A2A_WORKFLOW_MANIFEST?.trim();
	if (!path) return undefined;
	let source: string;
	try {
		source = await readFile(path, "utf8");
	} catch (error) {
		throw new Error(
			`cannot read A2A workflow manifest ${JSON.stringify(path)}: ${errorMessage(error)}`,
		);
	}
	let manifest: WorkflowManifest;
	try {
		manifest = parseManifest(JSON.parse(source));
	} catch (error) {
		throw new Error(
			`A2A workflow manifest ${JSON.stringify(path)} is malformed: ${errorMessage(error)}`,
		);
	}
	const selectedId = process.env.A2A_WORKFLOW?.trim();
	let workflow: WorkflowManifest["workflows"][number] | undefined;
	if (selectedId) {
		workflow = manifest.workflows.find(({ id }) => id === selectedId);
		if (!workflow) throw new Error(`workflow ${JSON.stringify(selectedId)} is absent from ${path}`);
	} else if (manifest.workflows.length === 1) {
		workflow = manifest.workflows[0];
	} else {
		throw new Error(
			"A2A_WORKFLOW is required when the workflow manifest does not contain exactly one workflow",
		);
	}
	if (!workflow) throw new Error("the workflow manifest contains no selectable workflow");
	return parseOutputs(workflow.id, workflow.outputs);
}

export function outputArtifact(
	taskId: string,
	declarations: WorkflowOutputDeclarations | undefined,
	entry: { readonly output: string; readonly value: Record<string, unknown> },
): A2aArtifact {
	if (!declarations) {
		throw new Error("no workflow output declarations are configured; set A2A_WORKFLOW_MANIFEST");
	}
	const declared = declarations.get(entry.output);
	if (!declared) throw new Error(`output "${entry.output}" is not declared by the workflow`);
	return {
		artifactId: `output-${entry.output}-${taskId}`,
		name: entry.output,
		parts: [{ data: entry.value }],
		extensions: [OUTFITTER_TASK_EXTENSION_URI],
		metadata: {
			[OUTFITTER_TASK_EXTENSION_KEY]: {
				output: entry.output,
				type: declared.type,
				value: entry.value,
			},
		},
	};
}

function parseManifest(value: unknown): WorkflowManifest {
	if (!isRecord(value) || !Array.isArray(value.workflows)) {
		throw new Error("expected an object with a workflows array");
	}
	const workflows = value.workflows.map((workflow, index) => {
		if (!isRecord(workflow) || typeof workflow.id !== "string" || !isRecord(workflow.outputs)) {
			throw new Error(`workflows[${index}] must have a string id and an outputs object`);
		}
		return { id: workflow.id, outputs: workflow.outputs };
	});
	return { workflows };
}

function parseOutputs(
	workflowId: string,
	outputs: Readonly<Record<string, unknown>>,
): WorkflowOutputDeclarations {
	return new Map(
		Object.entries(outputs).map(([name, declaration]) => {
			if (!outputSlug.test(name)) {
				throw new Error(
					`workflow ${JSON.stringify(workflowId)} output ${JSON.stringify(name)} must match pattern ${OUTPUT_SLUG_PATTERN}`,
				);
			}
			if (!isRecord(declaration) || typeof declaration.type !== "string") {
				throw new Error(
					`workflow ${JSON.stringify(workflowId)} output ${JSON.stringify(name)} must have a string type`,
				);
			}
			if (!outputSlug.test(declaration.type)) {
				throw new Error(
					`workflow ${JSON.stringify(workflowId)} output ${JSON.stringify(name)} type ${JSON.stringify(declaration.type)} must match pattern ${OUTPUT_SLUG_PATTERN}`,
				);
			}
			return [name, { type: declaration.type }];
		}),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
