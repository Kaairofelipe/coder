import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
	type AssistantContent,
	type ModelMessage,
	stepCountIs,
	ToolLoopAgent,
} from "ai";
import { API } from "api/api";
import { useCallback, useRef, useState } from "react";
import type { FileTree } from "utils/filetree";
import {
	createTemplateAgentTools,
	executeDeleteFile,
	executeEditFile,
} from "./tools";
import type { AgentStatus, PendingToolCall } from "./types";

/**
 * Read the runtime CSRF token from the Axios instance's default
 * headers. This is the correct token in both development (hardcoded)
 * and production (derived from the page's meta tag at startup).
 * Using API.getCsrfToken() would always return the hardcoded
 * development-only value.
 */
function getRuntimeCsrfToken(): string {
	const headers = API.getAxiosInstance().defaults.headers.common;
	const token = headers["X-CSRF-TOKEN"];
	if (typeof token === "string") {
		return token;
	}
	return "";
}

const openAIProvider = createOpenAI({
	baseURL: "/api/v2/aibridge/openai/v1",
	headers: { "X-CSRF-TOKEN": getRuntimeCsrfToken() },
});

const anthropicProvider = createAnthropic({
	baseURL: "/api/v2/aibridge/anthropic/v1",
	headers: { "X-CSRF-TOKEN": getRuntimeCsrfToken() },
});

const anthropicModelPrefix = "anthropic/";

const resolveProviderModel = (modelID: string) => {
	if (modelID.startsWith(anthropicModelPrefix)) {
		const anthropicModelID = modelID.slice(anthropicModelPrefix.length);
		if (!anthropicModelID) {
			throw new Error("Anthropic model ID cannot be empty.");
		}
		return anthropicProvider(anthropicModelID);
	}
	return openAIProvider(modelID);
};

const MAX_STEPS = 20;

const SYSTEM_PROMPT = `You are a Terraform template editing assistant for Coder.
You help users modify Coder workspace templates (Terraform HCL files).

Rules:
- Always use listFiles first to see the template structure.
- Always use readFile before editing a file.
- Use editFile for targeted changes — provide enough context in oldContent
  to uniquely identify the edit location.
- Keep HCL syntax valid. Use proper Terraform formatting conventions.
- Explain what you're changing and why before making edits.`;

const createTemplateAgent = (
	modelId: string,
	getFileTree: () => FileTree,
	setFileTree: (updater: (prev: FileTree) => FileTree) => void,
) => {
	return new ToolLoopAgent({
		model: resolveProviderModel(modelId),
		instructions: SYSTEM_PROMPT,
		tools: createTemplateAgentTools(getFileTree, setFileTree),
		stopWhen: stepCountIs(MAX_STEPS),
	});
};

interface UseTemplateAgentOptions {
	getFileTree: () => FileTree;
	setFileTree: (updater: (prev: FileTree) => FileTree) => void;
	modelId: string;
	/** Called after a file is created or edited so the editor can navigate to it. */
	onFileEdited?: (path: string) => void;
	/** Called after a file is deleted so the editor can clear the active path if needed. */
	onFileDeleted?: (path: string) => void;
}

export interface DisplayToolCall {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result?: unknown;
	state: "pending" | "result";
}

export interface DisplayMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	toolCalls: DisplayToolCall[];
}

type StreamToolCall = {
	toolCallId: string;
	toolName: string;
	input?: unknown;
	args?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const getToolCallArgs = (toolCall: StreamToolCall): Record<string, unknown> => {
	const args = toolCall.input ?? toolCall.args;
	if (!isRecord(args)) {
		throw new Error("Tool call arguments must be an object.");
	}
	return args;
};

const asToolOutput = (value: unknown) => ({
	type: "json" as const,
	value: (value ?? null) as never,
});

/**
 * Collect ALL tool calls from the last step that lack a result and
 * require user approval. The model can emit parallel tool calls
 * (e.g. two editFile calls), so we must handle every one rather
 * than just the first.
 */
const getPendingToolCalls = (
	steps: ReadonlyArray<{
		toolCalls: ReadonlyArray<StreamToolCall>;
		toolResults: ReadonlyArray<{ toolCallId: string }>;
	}>,
): PendingToolCall[] => {
	const lastStep = steps[steps.length - 1];
	if (!lastStep) {
		return [];
	}

	const resultCallIds = new Set(
		lastStep.toolResults.map((result) => result.toolCallId),
	);

	return lastStep.toolCalls
		.filter(
			(toolCall) =>
				!resultCallIds.has(toolCall.toolCallId) &&
				(toolCall.toolName === "editFile" ||
					toolCall.toolName === "deleteFile"),
		)
		.map((toolCall) => ({
			toolCallId: toolCall.toolCallId,
			toolName: toolCall.toolName as "editFile" | "deleteFile",
			args: getToolCallArgs(toolCall),
		}));
};

export const useTemplateAgent = ({
	getFileTree,
	setFileTree,
	modelId,
	onFileEdited,
	onFileDeleted,
}: UseTemplateAgentOptions) => {
	const [messages, setMessages] = useState<DisplayMessage[]>([]);
	const [status, setStatus] = useState<AgentStatus>("idle");
	// Queue of tool calls awaiting user approval. The UI shows
	// the first item; approve/reject pops items off until the
	// queue is drained, then the stream resumes.
	const [pendingApprovals, setPendingApprovals] = useState<PendingToolCall[]>(
		[],
	);

	const messageCounter = useRef(0);
	const messagesRef = useRef<ModelMessage[]>([]);
	const abortRef = useRef<AbortController | null>(null);

	const updateAssistantMessage = useCallback(
		(id: string, content: string, toolCalls: DisplayToolCall[]) => {
			setMessages((prev) => {
				const index = prev.findIndex((message) => message.id === id);
				if (index === -1) {
					return [
						...prev,
						{
							id,
							role: "assistant",
							content,
							toolCalls: [...toolCalls],
						},
					];
				}

				const next = [...prev];
				next[index] = {
					...next[index],
					content,
					toolCalls: [...toolCalls],
				};
				return next;
			});
		},
		[],
	);

	const runStream = useCallback(
		async (coreMessages: ModelMessage[]) => {
			abortRef.current?.abort();
			const abortController = new AbortController();
			abortRef.current = abortController;
			setStatus("streaming");

			const agent = createTemplateAgent(modelId, getFileTree, setFileTree);
			let result: Awaited<ReturnType<typeof agent.stream>>;
			try {
				result = await agent.stream({
					messages: coreMessages,
					abortSignal: abortController.signal,
				});
			} catch {
				setStatus("error");
				abortRef.current = null;
				return;
			}

			let currentAssistantId: string | null = null;
			let currentText = "";
			let currentToolCalls: DisplayToolCall[] = [];

			const ensureAssistantId = () => {
				if (currentAssistantId) {
					return currentAssistantId;
				}
				currentAssistantId = `msg-${++messageCounter.current}`;
				return currentAssistantId;
			};

			const refreshAssistantMessage = () => {
				const id = ensureAssistantId();
				updateAssistantMessage(id, currentText, currentToolCalls);
			};

			try {
				for await (const part of result.fullStream) {
					if (abortController.signal.aborted) {
						break;
					}

					switch (part.type) {
						case "text-delta": {
							currentText += part.text;
							refreshAssistantMessage();
							break;
						}
						case "tool-call": {
							const streamToolCall: StreamToolCall = {
								toolCallId: part.toolCallId,
								toolName: part.toolName,
								input: part.input,
							};
							currentToolCalls = [
								...currentToolCalls,
								{
									toolCallId: streamToolCall.toolCallId,
									toolName: streamToolCall.toolName,
									args: getToolCallArgs(streamToolCall),
									state: "pending",
								},
							];
							refreshAssistantMessage();
							break;
						}
						case "tool-result": {
							const matchingToolCall = currentToolCalls.find(
								(toolCall) => toolCall.toolCallId === part.toolCallId,
							);
							if (matchingToolCall) {
								matchingToolCall.state = "result";
								matchingToolCall.result = part.output;
							}
							refreshAssistantMessage();
							break;
						}
						case "finish-step": {
							currentAssistantId = null;
							currentText = "";
							currentToolCalls = [];
							break;
						}
					}
				}
			} catch {
				if (!abortController.signal.aborted) {
					setStatus("error");
				}
				abortRef.current = null;
				return;
			}

			if (abortController.signal.aborted) {
				setStatus("idle");
				abortRef.current = null;
				return;
			}

			const steps = await result.steps;

			const nextMessages = [...coreMessages];

			for (const step of steps) {
				const assistantParts: Exclude<AssistantContent, string> = [];
				if (step.text) {
					assistantParts.push({ type: "text", text: step.text });
				}

				for (const toolCall of step.toolCalls) {
					assistantParts.push({
						type: "tool-call",
						toolCallId: toolCall.toolCallId,
						toolName: toolCall.toolName,
						input: getToolCallArgs(toolCall),
					});
				}

				if (assistantParts.length > 0) {
					nextMessages.push({ role: "assistant", content: assistantParts });
				}

				if (step.toolResults.length > 0) {
					nextMessages.push({
						role: "tool",
						content: step.toolResults.map((toolResult) => ({
							type: "tool-result" as const,
							toolCallId: toolResult.toolCallId,
							toolName: toolResult.toolName,
							output: asToolOutput(toolResult.output),
						})),
					});
				}
			}

			messagesRef.current = nextMessages;

			const nextPending = getPendingToolCalls(steps);
			if (nextPending.length > 0) {
				setPendingApprovals(nextPending);
				setStatus("awaiting_approval");
				abortRef.current = null;
				return;
			}

			setPendingApprovals([]);
			setStatus("idle");
			abortRef.current = null;
		},
		[getFileTree, modelId, setFileTree, updateAssistantMessage],
	);

	const send = useCallback(
		(text: string) => {
			if (status === "streaming" || status === "awaiting_approval") {
				return;
			}
			if (abortRef.current) {
				return;
			}

			const trimmed = text.trim();
			if (!trimmed) {
				return;
			}

			const userMessage: ModelMessage = { role: "user", content: trimmed };
			const nextMessages = [...messagesRef.current, userMessage];
			messagesRef.current = nextMessages;

			setMessages((prev) => [
				...prev,
				{
					id: `msg-${++messageCounter.current}`,
					role: "user",
					content: trimmed,
					toolCalls: [],
				},
			]);

			void runStream(nextMessages);
		},
		[runStream, status],
	);

	/**
	 * Execute a pending tool call and append its result to the
	 * conversation. Returns the updated core messages array.
	 */
	const executePendingTool = useCallback(
		(pending: PendingToolCall, resultValue: unknown): ModelMessage[] => {
			setMessages((prev) =>
				prev.map((message) => ({
					...message,
					toolCalls: message.toolCalls.map((toolCall) =>
						toolCall.toolCallId === pending.toolCallId
							? { ...toolCall, result: resultValue, state: "result" as const }
							: toolCall,
					),
				})),
			);

			const toolMessage: ModelMessage = {
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: pending.toolCallId,
						toolName: pending.toolName,
						output: asToolOutput(resultValue),
					},
				],
			};
			const next = [...messagesRef.current, toolMessage];
			messagesRef.current = next;
			return next;
		},
		[],
	);

	const approve = useCallback(() => {
		const current = pendingApprovals[0];
		if (!current) {
			return;
		}

		let toolResult: unknown;
		if (current.toolName === "editFile") {
			const path = current.args.path;
			const oldContent = current.args.oldContent;
			const newContent = current.args.newContent;
			if (
				typeof path !== "string" ||
				typeof oldContent !== "string" ||
				typeof newContent !== "string"
			) {
				toolResult = {
					success: false,
					error:
						"editFile arguments are invalid. path, oldContent, and newContent must all be strings.",
					path: typeof path === "string" ? path : "",
				};
			} else {
				toolResult = executeEditFile(getFileTree, setFileTree, {
					path,
					oldContent,
					newContent,
				});
				if (isRecord(toolResult) && toolResult.success === true) {
					onFileEdited?.(path);
				}
			}
		} else {
			const path = current.args.path;
			if (typeof path !== "string" || path.length === 0) {
				toolResult = {
					success: false,
					error:
						"deleteFile arguments are invalid. path must be a non-empty string.",
					path: typeof path === "string" ? path : "",
				};
			} else {
				toolResult = executeDeleteFile(getFileTree, setFileTree, { path });
				if (isRecord(toolResult) && toolResult.success === true) {
					onFileDeleted?.(path);
				}
			}
		}

		const nextMessages = executePendingTool(current, toolResult);
		const remaining = pendingApprovals.slice(1);

		if (remaining.length > 0) {
			// More tool calls waiting for approval — stay in
			// awaiting_approval state and show the next one.
			setPendingApprovals(remaining);
		} else {
			setPendingApprovals([]);
			void runStream(nextMessages);
		}
	}, [
		executePendingTool,
		getFileTree,
		onFileDeleted,
		onFileEdited,
		pendingApprovals,
		runStream,
		setFileTree,
	]);

	const reject = useCallback(() => {
		const current = pendingApprovals[0];
		if (!current) {
			return;
		}

		const rejectionResult = { error: "User rejected this action." };
		const nextMessages = executePendingTool(current, rejectionResult);
		const remaining = pendingApprovals.slice(1);

		if (remaining.length > 0) {
			setPendingApprovals(remaining);
		} else {
			setPendingApprovals([]);
			void runStream(nextMessages);
		}
	}, [executePendingTool, pendingApprovals, runStream]);

	const stop = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		setStatus("idle");
	}, []);

	const reset = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		messagesRef.current = [];
		setMessages([]);
		setPendingApprovals([]);
		setStatus("idle");
	}, []);

	// Expose the first pending item (or null) so the UI can show
	// one approval card at a time.
	const pendingApproval =
		pendingApprovals.length > 0 ? pendingApprovals[0] : null;

	return {
		messages,
		isStreaming: status === "streaming",
		status,
		pendingApproval,
		send,
		approve,
		reject,
		stop,
		reset,
	};
};
