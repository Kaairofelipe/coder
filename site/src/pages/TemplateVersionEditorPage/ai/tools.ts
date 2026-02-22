import { tool } from "ai";
import { z } from "zod";
import type { FileTree } from "utils/filetree";
import {
	createFile,
	existsFile,
	getFileText,
	removeFile,
	traverse,
	updateFile,
} from "utils/filetree";

/**
 * Creates the set of AI tools that operate on the template editor's
 * in-memory FileTree. Tools use the provided callbacks to read and
 * mutate the tree so that React state stays in sync.
 */
export function createTemplateAgentTools(
	getFileTree: () => FileTree,
	setFileTree: (updater: (prev: FileTree) => FileTree) => void,
) {
	return {
		listFiles: tool({
			description:
				"List all files in the template. Always call this first to understand the template structure.",
			inputSchema: z.object({}),
			execute: async () => {
				const files: string[] = [];
				traverse(getFileTree(), (content, _filename, fullPath) => {
					// Only include leaf files, not directories.
					if (typeof content === "string") {
						files.push(fullPath);
					}
				});
				return { files };
			},
		}),

		readFile: tool({
			description:
				"Read the contents of a file. Use this before editing to understand the current content.",
			inputSchema: z.object({
				path: z
					.string()
					.describe("File path relative to template root, e.g. 'main.tf'"),
			}),
			execute: async ({ path }) => {
				const tree = getFileTree();
				if (!existsFile(path, tree)) {
					return {
						error: `File not found: ${path}. Use listFiles to see available files.`,
					};
				}
				try {
					const content = getFileText(path, tree);
					return { content };
				} catch {
					return { error: `${path} is a directory, not a file.` };
				}
			},
		}),

		editFile: tool({
			description:
				"Edit a file by replacing a specific section. To create a new file, set oldContent to an empty string. " +
				"To append to an existing file, set oldContent to empty string. " +
				"For targeted edits, provide enough context in oldContent to uniquely identify the location.",
			inputSchema: z.object({
				path: z.string().describe("File path relative to template root"),
				oldContent: z
					.string()
					.describe("Exact text to find and replace (empty string to create/append)"),
				newContent: z.string().describe("Replacement text"),
			}),
		}),

		deleteFile: tool({
			description: "Delete a file from the template.",
			inputSchema: z.object({
				path: z.string().describe("File path to delete"),
			}),
		}),
	};
}

/**
 * Execute the editFile tool logic. Separated from the tool definition
 * so it can be called after user approval.
 */
export function executeEditFile(
	getFileTree: () => FileTree,
	setFileTree: (updater: (prev: FileTree) => FileTree) => void,
	args: { path: string; oldContent: string; newContent: string },
): { success: boolean; action?: string; error?: string; path: string } {
	const { path, oldContent, newContent } = args;
	const tree = getFileTree();
	const exists = existsFile(path, tree);

	// Create new file.
	if (!exists && oldContent === "") {
		setFileTree((prev) => createFile(path, prev, newContent));
		return { success: true, action: "created", path };
	}

	// Cannot replace content in a file that doesn't exist.
	if (!exists) {
		return {
			success: false,
			error: `File not found: ${path}. Use listFiles first.`,
			path,
		};
	}

	let current: string;
	try {
		current = getFileText(path, tree);
	} catch {
		return { success: false, error: `${path} is a directory, not a file.`, path };
	}

	// Append or write.
	if (oldContent === "") {
		const updated = current.length > 0 ? current + newContent : newContent;
		const action = current.length > 0 ? "appended" : "written";
		setFileTree((prev) => updateFile(path, updated, prev));
		return { success: true, action, path };
	}

	// Search-and-replace: must match exactly once.
	const occurrences = current.split(oldContent).length - 1;
	if (occurrences === 0) {
		return {
			success: false,
			error: `oldContent not found in ${path}. Read the file first to get exact content.`,
			path,
		};
	}
	if (occurrences > 1) {
		return {
			success: false,
			error: `oldContent matches ${occurrences} locations in ${path}. Include more surrounding context to make the match unique.`,
			path,
		};
	}

	setFileTree((prev) => updateFile(path, current.replace(oldContent, newContent), prev));
	return { success: true, action: "edited", path };
}

/**
 * Execute the deleteFile tool logic. Separated from the tool definition
 * so it can be called after user approval.
 */
export function executeDeleteFile(
	getFileTree: () => FileTree,
	setFileTree: (updater: (prev: FileTree) => FileTree) => void,
	args: { path: string },
): { success: boolean; error?: string; path: string } {
	const { path } = args;
	const tree = getFileTree();
	if (!existsFile(path, tree)) {
		return { success: false, error: `File not found: ${path}`, path };
	}
	setFileTree((prev) => removeFile(path, prev));
	return { success: true, path };
}
