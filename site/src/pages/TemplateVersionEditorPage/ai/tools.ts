import { tool } from "ai";
import type { FileTree } from "utils/filetree";
import {
	createFile,
	existsFile,
	getFileText,
	isFolder,
	removeFile,
	traverse,
	updateFile,
} from "utils/filetree";
import { z } from "zod";

interface TemplateAgentToolCallbacks {
	onFileEdited?: (path: string) => void;
	onFileDeleted?: (path: string) => void;
}

/**
 * Creates the set of AI tools that operate on the template editor's
 * in-memory FileTree. Tools use the provided callbacks to read and
 * mutate the tree so that React state stays in sync.
 */
export function createTemplateAgentTools(
	getFileTree: () => FileTree,
	setFileTree: (updater: (prev: FileTree) => FileTree) => void,
	callbacks: TemplateAgentToolCallbacks = {},
) {
	const { onFileEdited, onFileDeleted } = callbacks;

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
					.min(1, "Path cannot be empty.")
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
				path: z
					.string()
					.min(1, "Path cannot be empty.")
					.describe("File path relative to template root"),
				oldContent: z
					.string()
					.describe(
						"Exact text to find and replace (empty string to create/append)",
					),
				newContent: z.string().describe("Replacement text"),
			}),
			needsApproval: true,
			execute: async ({ path, oldContent, newContent }) => {
				const result = executeEditFile(getFileTree, setFileTree, {
					path,
					oldContent,
					newContent,
				});
				if (result.success) {
					onFileEdited?.(path);
				}
				return result;
			},
		}),

		deleteFile: tool({
			description: "Delete a file from the template.",
			inputSchema: z.object({
				path: z
					.string()
					.min(1, "Path cannot be empty.")
					.describe("File path to delete"),
			}),
			needsApproval: true,
			execute: async ({ path }) => {
				const result = executeDeleteFile(getFileTree, setFileTree, { path });
				if (result.success) {
					onFileDeleted?.(path);
				}
				return result;
			},
		}),
	};
}

/**
 * Execute the editFile tool logic. Separated from the tool definition
 * so it can be called after user approval.
 */
function executeEditFile(
	getFileTree: () => FileTree,
	setFileTree: (updater: (prev: FileTree) => FileTree) => void,
	args: { path: string; oldContent: string; newContent: string },
): { success: boolean; action?: string; error?: string; path: string } {
	const { path, oldContent, newContent } = args;
	if (path.length === 0) {
		return { success: false, error: "File path cannot be empty.", path };
	}

	const tree = getFileTree();
	const exists = existsFile(path, tree);

	// Create new file. createFile can throw if the path is invalid
	// (e.g. an intermediate segment is an existing file), so we
	// catch and return a structured error instead of breaking the
	// agent loop.
	if (!exists && oldContent === "") {
		try {
			setFileTree((prev) => createFile(path, prev, newContent));
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to create file";
			return { success: false, error: message, path };
		}
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
		return {
			success: false,
			error: `${path} is a directory, not a file.`,
			path,
		};
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

	setFileTree((prev) =>
		updateFile(path, current.replace(oldContent, newContent), prev),
	);
	return { success: true, action: "edited", path };
}

/**
 * Execute the deleteFile tool logic. Separated from the tool definition
 * so it can be called after user approval.
 */
function executeDeleteFile(
	getFileTree: () => FileTree,
	setFileTree: (updater: (prev: FileTree) => FileTree) => void,
	args: { path: string },
): { success: boolean; error?: string; path: string } {
	const { path } = args;
	if (path.length === 0) {
		return { success: false, error: "File path cannot be empty.", path };
	}

	const tree = getFileTree();
	if (!existsFile(path, tree)) {
		return { success: false, error: `File not found: ${path}`, path };
	}
	if (isFolder(path, tree)) {
		return {
			success: false,
			error: `${path} is a directory, not a file. Delete individual files instead.`,
			path,
		};
	}
	setFileTree((prev) => removeFile(path, prev));
	return { success: true, path };
}
