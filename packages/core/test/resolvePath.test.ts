import { homedir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePath } from "../src/config-types.js";

describe("resolvePath", () => {
	it("should expand ~/path to home directory", () => {
		const result = resolvePath("~/my-workflows");
		expect(result).toBe(resolve(homedir(), "my-workflows"));
		expect(result).not.toContain("~");
	});

	it("should expand nested tilde paths", () => {
		const result = resolvePath("~/nested/path/to/workflows");
		expect(result).toBe(resolve(homedir(), "nested/path/to/workflows"));
	});

	it("should resolve absolute paths unchanged", () => {
		const result = resolvePath("/absolute/path/to/workflows");
		expect(result).toBe("/absolute/path/to/workflows");
	});

	it("should resolve relative paths to absolute", () => {
		const result = resolvePath("relative/path");
		expect(result).toBe(resolve("relative/path"));
		// Should be absolute
		expect(result.startsWith("/")).toBe(true);
	});

	it("should handle path with trailing slash", () => {
		const result = resolvePath("~/workflows/");
		expect(result).toBe(resolve(homedir(), "workflows/"));
	});

	it("should not expand tilde in middle of path", () => {
		const result = resolvePath("/some/path/with~/tilde");
		// Should not expand ~ in the middle
		expect(result).toBe(resolve("/some/path/with~/tilde"));
	});
});
