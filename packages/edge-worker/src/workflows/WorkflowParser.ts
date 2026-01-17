/**
 * Parser for YAML workflow definitions
 *
 * This class handles parsing, validating, and converting YAML workflow files
 * to the internal ProcedureDefinition format used by the edge worker.
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import type { Ajv as AjvClass, ValidateFunction } from "ajv";
import * as yaml from "yaml";

import type {
	ProcedureDefinition,
	SubroutineDefinition,
} from "../procedures/types.js";
import type {
	SubroutineReference,
	WorkflowCollection,
	WorkflowDefinition,
} from "./types.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Ajv = require("ajv").default as new (options?: {
	allErrors?: boolean;
	strict?: boolean;
}) => AjvClass;

/**
 * Result of schema validation
 */
export interface ValidationResult {
	/** Whether validation passed */
	valid: boolean;
	/** Validation error messages if invalid */
	errors?: string[];
}

/**
 * Result of parsing a directory of workflow files
 */
export interface DirectoryParseResult {
	/** Combined workflow collection from all files */
	collection: WorkflowCollection;
	/** Files that were successfully parsed */
	parsedFiles: string[];
	/** Errors encountered during parsing, keyed by filename */
	errors: Record<string, string>;
}

/**
 * Parser for YAML workflow definitions.
 *
 * Supports:
 * - Parsing single YAML files
 * - Parsing directories with multiple YAML files (merged together)
 * - JSON Schema validation
 * - Conversion to internal ProcedureDefinition format
 */
export class WorkflowParser {
	private ajv: AjvClass;
	private validator: ValidateFunction | null = null;
	private schemaLoaded = false;

	/**
	 * Create a new WorkflowParser
	 *
	 * @param schemaPath - Optional path to the JSON Schema file.
	 *                     Defaults to workflow-schema.json in the same directory.
	 */
	constructor(private schemaPath?: string) {
		this.ajv = new Ajv({ allErrors: true, strict: false });
	}

	/**
	 * Load and compile the JSON Schema for validation
	 */
	private loadSchema(): void {
		if (this.schemaLoaded) {
			return;
		}

		const effectiveSchemaPath =
			this.schemaPath ||
			path.join(
				path.dirname(new URL(import.meta.url).pathname),
				"workflow-schema.json",
			);

		try {
			const schemaContent = fs.readFileSync(effectiveSchemaPath, "utf-8");
			const schema = JSON.parse(schemaContent);
			this.validator = this.ajv.compile(schema);
			this.schemaLoaded = true;
		} catch {
			// Schema loading failed, validation will be skipped
			// This is acceptable for environments where the schema file isn't available
			this.schemaLoaded = true;
		}
	}

	/**
	 * Parse a single YAML string into a WorkflowCollection
	 *
	 * @param yamlContent - The YAML content to parse
	 * @returns The parsed WorkflowCollection
	 * @throws Error if the YAML is invalid or doesn't match expected structure
	 */
	parse(yamlContent: string): WorkflowCollection {
		if (!yamlContent || yamlContent.trim() === "") {
			throw new Error("YAML content is empty");
		}

		let parsed: unknown;
		try {
			parsed = yaml.parse(yamlContent);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unknown parse error";
			throw new Error(`Failed to parse YAML: ${message}`);
		}

		if (parsed === null || parsed === undefined) {
			throw new Error("YAML content is empty or null");
		}

		if (typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("YAML must be an object with a 'workflows' array");
		}

		const obj = parsed as Record<string, unknown>;

		if (!("workflows" in obj)) {
			throw new Error("YAML must contain a 'workflows' property");
		}

		if (!Array.isArray(obj.workflows)) {
			throw new Error("'workflows' must be an array");
		}

		if (obj.workflows.length === 0) {
			throw new Error("'workflows' array cannot be empty");
		}

		// Basic structural validation for each workflow
		for (let i = 0; i < obj.workflows.length; i++) {
			const workflow = obj.workflows[i];
			if (typeof workflow !== "object" || workflow === null) {
				throw new Error(`Workflow at index ${i} must be an object`);
			}
			if (!("name" in workflow) || typeof workflow.name !== "string") {
				throw new Error(`Workflow at index ${i} must have a 'name' string`);
			}
			if (
				!("description" in workflow) ||
				typeof workflow.description !== "string"
			) {
				throw new Error(
					`Workflow '${workflow.name}' must have a 'description' string`,
				);
			}
			if (
				!("subroutines" in workflow) ||
				!Array.isArray(workflow.subroutines)
			) {
				throw new Error(
					`Workflow '${workflow.name}' must have a 'subroutines' array`,
				);
			}
			if (workflow.subroutines.length === 0) {
				throw new Error(
					`Workflow '${workflow.name}' must have at least one subroutine`,
				);
			}

			// Validate each subroutine
			for (let j = 0; j < workflow.subroutines.length; j++) {
				const sub = workflow.subroutines[j];
				if (typeof sub !== "object" || sub === null) {
					throw new Error(
						`Subroutine at index ${j} in workflow '${workflow.name}' must be an object`,
					);
				}
				if (!("name" in sub) || typeof sub.name !== "string") {
					throw new Error(
						`Subroutine at index ${j} in workflow '${workflow.name}' must have a 'name' string`,
					);
				}
				if (!("prompt_file" in sub) || typeof sub.prompt_file !== "string") {
					throw new Error(
						`Subroutine '${sub.name}' in workflow '${workflow.name}' must have a 'prompt_file' string`,
					);
				}
			}
		}

		return obj as unknown as WorkflowCollection;
	}

	/**
	 * Validate a WorkflowCollection against the JSON Schema
	 *
	 * @param collection - The workflow collection to validate
	 * @returns Validation result with success status and any errors
	 */
	validate(collection: WorkflowCollection): ValidationResult {
		this.loadSchema();

		if (!this.validator) {
			// Schema not available, consider valid by default
			return { valid: true };
		}

		const valid = this.validator(collection);

		if (valid) {
			return { valid: true };
		}

		const errors =
			this.validator.errors?.map((err) => {
				const path = err.instancePath || "/";
				const message = err.message || "Unknown validation error";
				return `${path}: ${message}`;
			}) ?? [];

		return { valid: false, errors };
	}

	/**
	 * Parse and validate a YAML string
	 *
	 * @param yamlContent - The YAML content to parse and validate
	 * @returns The validated WorkflowCollection
	 * @throws Error if parsing or validation fails
	 */
	parseAndValidate(yamlContent: string): WorkflowCollection {
		const collection = this.parse(yamlContent);
		const validation = this.validate(collection);

		if (!validation.valid) {
			throw new Error(
				`Workflow validation failed:\n${validation.errors?.join("\n")}`,
			);
		}

		return collection;
	}

	/**
	 * Parse all YAML files in a directory and merge them into a single collection.
	 *
	 * Files are processed in alphabetical order. Later files can override
	 * workflows with the same name from earlier files.
	 *
	 * @param directoryPath - Path to the directory containing YAML files
	 * @returns Combined workflow collection with parse status for each file
	 */
	parseDirectory(directoryPath: string): DirectoryParseResult {
		const result: DirectoryParseResult = {
			collection: { workflows: [] },
			parsedFiles: [],
			errors: {},
		};

		if (!fs.existsSync(directoryPath)) {
			result.errors._directory = `Directory does not exist: ${directoryPath}`;
			return result;
		}

		const stat = fs.statSync(directoryPath);
		if (!stat.isDirectory()) {
			result.errors._directory = `Path is not a directory: ${directoryPath}`;
			return result;
		}

		// Get all YAML files, sorted alphabetically for deterministic ordering
		const files = fs
			.readdirSync(directoryPath)
			.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
			.sort();

		if (files.length === 0) {
			result.errors._directory = "No YAML files found in directory";
			return result;
		}

		// Map to track workflows by name (later files override earlier ones)
		const workflowsByName = new Map<string, WorkflowDefinition>();

		for (const file of files) {
			const filePath = path.join(directoryPath, file);
			try {
				const content = fs.readFileSync(filePath, "utf-8");
				const collection = this.parseAndValidate(content);

				for (const workflow of collection.workflows) {
					workflowsByName.set(workflow.name, workflow);
				}

				result.parsedFiles.push(file);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Unknown error";
				result.errors[file] = message;
			}
		}

		// Build final collection from merged workflows
		result.collection.workflows = Array.from(workflowsByName.values());

		return result;
	}

	/**
	 * Convert a WorkflowDefinition to the internal ProcedureDefinition format
	 *
	 * @param workflow - The workflow definition to convert
	 * @param promptBasePath - Base path for resolving prompt file references.
	 *                         Prompt paths in the workflow are relative to this.
	 * @returns The equivalent ProcedureDefinition
	 */
	toProcedureDefinition(
		workflow: WorkflowDefinition,
		promptBasePath: string,
	): ProcedureDefinition {
		const subroutines: SubroutineDefinition[] = workflow.subroutines.map(
			(ref) => this.toSubroutineDefinition(ref, promptBasePath),
		);

		return {
			name: workflow.name,
			description: workflow.description,
			subroutines,
		};
	}

	/**
	 * Convert a SubroutineReference to the internal SubroutineDefinition format
	 */
	private toSubroutineDefinition(
		ref: SubroutineReference,
		promptBasePath: string,
	): SubroutineDefinition {
		// Resolve the prompt path relative to the base path
		const promptPath = path.join(promptBasePath, ref.prompt_file);

		const definition: SubroutineDefinition = {
			name: ref.name,
			promptPath,
			description: ref.description || ref.name,
		};

		// Map optional fields with snake_case to camelCase conversion
		if (ref.single_turn !== undefined) {
			definition.singleTurn = ref.single_turn;
		}

		if (ref.validation_loop !== undefined) {
			definition.usesValidationLoop = ref.validation_loop;
		}

		if (ref.disallow_tools !== undefined) {
			definition.disallowAllTools = ref.disallow_tools;
		}

		if (ref.disallowed_tools !== undefined) {
			definition.disallowedTools = ref.disallowed_tools;
		}

		if (ref.requires_approval !== undefined) {
			definition.requiresApproval = ref.requires_approval;
		}

		if (ref.suppress_thought_posting !== undefined) {
			definition.suppressThoughtPosting = ref.suppress_thought_posting;
		}

		if (ref.skip_linear_post !== undefined) {
			definition.skipLinearPost = ref.skip_linear_post;
		}

		return definition;
	}

	/**
	 * Convert all workflows in a collection to ProcedureDefinitions
	 *
	 * @param collection - The workflow collection to convert
	 * @param promptBasePath - Base path for resolving prompt file references
	 * @returns Map of procedure name to ProcedureDefinition
	 */
	toProcedureDefinitions(
		collection: WorkflowCollection,
		promptBasePath: string,
	): Map<string, ProcedureDefinition> {
		const procedures = new Map<string, ProcedureDefinition>();

		for (const workflow of collection.workflows) {
			const procedure = this.toProcedureDefinition(workflow, promptBasePath);
			procedures.set(procedure.name, procedure);
		}

		return procedures;
	}
}
