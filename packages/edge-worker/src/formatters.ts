/**
 * Shared formatting utilities for issue context
 *
 * Provides reusable functions for formatting Linear issues into XML
 * for AI classification, prompts, and other contexts.
 */

/**
 * Minimal issue data required for basic XML formatting
 * Used when only identifier, title, and url are needed (e.g., mention prompts)
 */
export interface MinimalIssueContext {
	/** Issue ID (e.g., "aac4720d-80e8-47ca-8da8-1183d1092e7b") */
	id?: string;

	/** Issue identifier (e.g., "RUB-77") */
	identifier: string;

	/** Issue title */
	title: string;

	/** Issue URL */
	url?: string;
}

/**
 * Extended issue context with additional fields for classification
 * Used when rich context is needed for AI classification decisions
 */
export interface ClassificationIssueContext extends MinimalIssueContext {
	/** Issue description (may be empty) */
	description?: string;

	/** Issue state (e.g., "In Progress", "Backlog") */
	state?: string;

	/** Issue priority (e.g., "High", "Medium", "Low") */
	priority?: string;

	/** Labels applied to the issue */
	labels?: string[];

	/** New comment triggering the classification (if any) */
	newComment?: string;
}

/**
 * Options for formatting issue XML
 */
export interface FormatIssueXmlOptions {
	/** Include id field in output */
	includeId?: boolean;

	/** Include url field in output */
	includeUrl?: boolean;

	/** Include description field in output */
	includeDescription?: boolean;

	/** Include state field in output */
	includeState?: boolean;

	/** Include priority field in output */
	includePriority?: boolean;

	/** Include labels field in output */
	includeLabels?: boolean;
}

/**
 * Format an issue into XML for AI prompts
 *
 * @param issue - Issue context data to format
 * @param options - Optional configuration for which fields to include
 * @returns XML string representing the issue
 *
 * @example
 * // Basic formatting for classification
 * formatIssueXml({ identifier: "RUB-77", title: "Bug fix" })
 * // <linear_issue>
 * //   <identifier>RUB-77</identifier>
 * //   <title>Bug fix</title>
 * // </linear_issue>
 *
 * @example
 * // With all options
 * formatIssueXml(
 *   { identifier: "RUB-77", title: "Bug", id: "123", url: "...", description: "..." },
 *   { includeId: true, includeUrl: true, includeDescription: true }
 * )
 */
export function formatIssueXml(
	issue: ClassificationIssueContext,
	options: FormatIssueXmlOptions = {},
): string {
	const parts: string[] = [];

	parts.push("<linear_issue>");

	if (options.includeId && issue.id) {
		parts.push(`  <id>${issue.id}</id>`);
	}

	parts.push(`  <identifier>${issue.identifier}</identifier>`);
	parts.push(`  <title>${issue.title}</title>`);

	if (options.includeDescription && issue.description) {
		parts.push("  <description>");
		parts.push(issue.description);
		parts.push("  </description>");
	}

	if (options.includeState && issue.state) {
		parts.push(`  <state>${issue.state}</state>`);
	}

	if (options.includePriority && issue.priority) {
		parts.push(`  <priority>${issue.priority}</priority>`);
	}

	if (options.includeLabels && issue.labels && issue.labels.length > 0) {
		parts.push(`  <labels>${issue.labels.join(", ")}</labels>`);
	}

	if (options.includeUrl && issue.url) {
		parts.push(`  <url>${issue.url}</url>`);
	}

	parts.push("</linear_issue>");

	return parts.join("\n");
}

/**
 * Format a new comment into XML
 *
 * @param comment - The comment text
 * @returns XML string representing the new comment, or empty string if no comment
 */
export function formatNewCommentXml(comment?: string): string {
	if (!comment) {
		return "";
	}

	const parts: string[] = [];
	parts.push("<new_comment>");
	parts.push(comment);
	parts.push("</new_comment>");

	return parts.join("\n");
}

/**
 * Build a complete classification prompt from issue context
 *
 * This combines issue XML and optional new comment XML into a single prompt
 * suitable for AI classification.
 *
 * @param issue - Issue context data
 * @returns Complete XML prompt string
 */
export function buildClassificationPromptXml(
	issue: ClassificationIssueContext,
): string {
	const parts: string[] = [];

	// Format issue with classification-relevant fields
	parts.push(
		formatIssueXml(issue, {
			includeDescription: true,
			includeState: true,
			includePriority: true,
			includeLabels: true,
		}),
	);

	// Add new comment if present
	if (issue.newComment) {
		parts.push("");
		parts.push(formatNewCommentXml(issue.newComment));
	}

	return parts.join("\n");
}
