import { describe, expect, it } from "vitest";
import {
	buildClassificationPromptXml,
	formatIssueXml,
	formatNewCommentXml,
} from "../src/formatters.js";

describe("formatters", () => {
	describe("formatIssueXml", () => {
		it("should format minimal issue context", () => {
			const xml = formatIssueXml({
				identifier: "RUB-77",
				title: "Fix the bug",
			});

			expect(xml).toBe(`<linear_issue>
  <identifier>RUB-77</identifier>
  <title>Fix the bug</title>
</linear_issue>`);
		});

		it("should include id when option is set", () => {
			const xml = formatIssueXml(
				{
					identifier: "RUB-77",
					title: "Fix the bug",
					id: "abc-123",
				},
				{ includeId: true },
			);

			expect(xml).toContain("<id>abc-123</id>");
		});

		it("should include url when option is set", () => {
			const xml = formatIssueXml(
				{
					identifier: "RUB-77",
					title: "Fix the bug",
					url: "https://linear.app/issue/RUB-77",
				},
				{ includeUrl: true },
			);

			expect(xml).toContain("<url>https://linear.app/issue/RUB-77</url>");
		});

		it("should include description when option is set", () => {
			const xml = formatIssueXml(
				{
					identifier: "RUB-77",
					title: "Fix the bug",
					description: "This is a detailed description",
				},
				{ includeDescription: true },
			);

			expect(xml).toContain("<description>");
			expect(xml).toContain("This is a detailed description");
			expect(xml).toContain("</description>");
		});

		it("should include state when option is set", () => {
			const xml = formatIssueXml(
				{
					identifier: "RUB-77",
					title: "Fix the bug",
					state: "In Progress",
				},
				{ includeState: true },
			);

			expect(xml).toContain("<state>In Progress</state>");
		});

		it("should include priority when option is set", () => {
			const xml = formatIssueXml(
				{
					identifier: "RUB-77",
					title: "Fix the bug",
					priority: "High",
				},
				{ includePriority: true },
			);

			expect(xml).toContain("<priority>High</priority>");
		});

		it("should include labels when option is set", () => {
			const xml = formatIssueXml(
				{
					identifier: "RUB-77",
					title: "Fix the bug",
					labels: ["bug", "urgent"],
				},
				{ includeLabels: true },
			);

			expect(xml).toContain("<labels>bug, urgent</labels>");
		});

		it("should not include empty labels even when option is set", () => {
			const xml = formatIssueXml(
				{
					identifier: "RUB-77",
					title: "Fix the bug",
					labels: [],
				},
				{ includeLabels: true },
			);

			expect(xml).not.toContain("<labels>");
		});

		it("should not include optional fields when values are missing", () => {
			const xml = formatIssueXml(
				{
					identifier: "RUB-77",
					title: "Fix the bug",
				},
				{
					includeId: true,
					includeUrl: true,
					includeDescription: true,
					includeState: true,
					includePriority: true,
					includeLabels: true,
				},
			);

			expect(xml).not.toContain("<id>");
			expect(xml).not.toContain("<url>");
			expect(xml).not.toContain("<description>");
			expect(xml).not.toContain("<state>");
			expect(xml).not.toContain("<priority>");
			expect(xml).not.toContain("<labels>");
		});
	});

	describe("formatNewCommentXml", () => {
		it("should format comment into XML", () => {
			const xml = formatNewCommentXml("This is a new comment");

			expect(xml).toBe(`<new_comment>
This is a new comment
</new_comment>`);
		});

		it("should return empty string for undefined comment", () => {
			const xml = formatNewCommentXml(undefined);

			expect(xml).toBe("");
		});

		it("should return empty string for empty comment", () => {
			const xml = formatNewCommentXml("");

			expect(xml).toBe("");
		});
	});

	describe("buildClassificationPromptXml", () => {
		it("should build complete classification prompt with all fields", () => {
			const xml = buildClassificationPromptXml({
				identifier: "RUB-77",
				title: "Procedure analyzer does not provide issue context",
				description: "The analyzer needs more context",
				state: "In Progress",
				priority: "High",
				labels: ["bug", "infrastructure"],
				newComment: "Please fix this urgently",
			});

			// Should include issue XML
			expect(xml).toContain("<linear_issue>");
			expect(xml).toContain("<identifier>RUB-77</identifier>");
			expect(xml).toContain(
				"<title>Procedure analyzer does not provide issue context</title>",
			);
			expect(xml).toContain("The analyzer needs more context");
			expect(xml).toContain("<state>In Progress</state>");
			expect(xml).toContain("<priority>High</priority>");
			expect(xml).toContain("<labels>bug, infrastructure</labels>");
			expect(xml).toContain("</linear_issue>");

			// Should include new comment XML
			expect(xml).toContain("<new_comment>");
			expect(xml).toContain("Please fix this urgently");
			expect(xml).toContain("</new_comment>");
		});

		it("should build minimal classification prompt", () => {
			const xml = buildClassificationPromptXml({
				identifier: "RUB-77",
				title: "Simple task",
			});

			expect(xml).toBe(`<linear_issue>
  <identifier>RUB-77</identifier>
  <title>Simple task</title>
</linear_issue>`);
		});

		it("should not include new_comment section when comment is absent", () => {
			const xml = buildClassificationPromptXml({
				identifier: "RUB-77",
				title: "Task without comment",
				description: "Some description",
			});

			expect(xml).not.toContain("<new_comment>");
		});

		it("should have correct structure for ProcedureAnalyzer compatibility", () => {
			// This test ensures the output matches what ProcedureAnalyzer expects
			const xml = buildClassificationPromptXml({
				identifier: "TEST-1",
				title: "Test issue",
				description: "Test description",
				state: "Backlog",
				priority: "Medium",
				labels: ["enhancement"],
				newComment: "Test comment",
			});

			// Verify structure matches the original buildClassificationPrompt output
			const lines = xml.split("\n");
			expect(lines[0]).toBe("<linear_issue>");
			expect(lines[1]).toBe("  <identifier>TEST-1</identifier>");
			expect(lines[2]).toBe("  <title>Test issue</title>");
			expect(lines[3]).toBe("  <description>");
			expect(lines[4]).toBe("Test description");
			expect(lines[5]).toBe("  </description>");
			expect(lines[6]).toBe("  <state>Backlog</state>");
			expect(lines[7]).toBe("  <priority>Medium</priority>");
			expect(lines[8]).toBe("  <labels>enhancement</labels>");
			expect(lines[9]).toBe("</linear_issue>");
			expect(lines[10]).toBe("");
			expect(lines[11]).toBe("<new_comment>");
			expect(lines[12]).toBe("Test comment");
			expect(lines[13]).toBe("</new_comment>");
		});
	});
});
