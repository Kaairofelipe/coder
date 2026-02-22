import { createOpenAI } from "@ai-sdk/openai";
import {
	type AssistantContent,
	type ModelMessage,
	stepCountIs,
	streamText,
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

const provider = createOpenAI({
	baseURL: "/api/v2/aibridge/openai/v1",
	headers: { "X-CSRF-TOKEN": getRuntimeCsrfToken() },
});

const MODEL_ID = "anthropic/claude-sonnet-4-20250514";
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

interface UseTemplateAgentOptions {
	getFileTree: () => FileTree;
	setFileTree: (updater: (prev: FileTree) => FileTree) => void;
	onFileEdited?: (path: string) => void;
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

const getPendingToolCall = (
	steps: ReadonlyArray<{
		toolCalls: ReadonlyArray<StreamToolCall>;
		toolResults: ReadonlyArray<{ toolCallId: string }>;
	}>,
): PendingToolCall | null => {
	const lastStep = steps[steps.length - 1];
	if (!lastStep) {
		return null;
	}

	const resultCallIds = new Set(
		lastStep.toolResults.map((result) => result.toolCallId),
	);
	const pendingToolCall = lastStep.toolCalls.find(
		(toolCall) => !resultCallIds.has(toolCall.toolCallId),
	);

	if (!pendingToolCall) {
		return null;
	}

	if (
		pendingToolCall.toolName !== "editFile" &&
		pendingToolCall.toolName !== "deleteFile"
	) {
		return null;
	}

	return {
		toolCallId: pendingToolCall.toolCallId,
		toolName: pendingToolCall.toolName,
		args: getToolCallArgs(pendingToolCall),
	};
};

export const useTemplateAgent = ({
	getFileTree,
	setFileTree,
	onFileEdited,
}: UseTemplateAgentOptions) => {
	const [messages, setMessages] = useState<DisplayMessage[]>([]);
	const [status, setStatus] = useState<AgentStatus>("idle");
	const [pendingApproval, setPendingApproval] =
		useState<PendingToolCall | null>(null);

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

			const tools = createTemplateAgentTools(getFileTree, setFileTree);
			const result = streamText({
				model: provider(MODEL_ID),
				system: SYSTEM_PROMPT,
				messages: coreMessages,
				tools,
				stopWhen: stepCountIs(MAX_STEPS),
				abortSignal: abortController.signal,
			});

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

			const nextPendingApproval = getPendingToolCall(steps);
			if (nextPendingApproval) {
				setPendingApproval(nextPendingApproval);
				setStatus("awaiting_approval");
				abortRef.current = null;
				return;
			}

			setPendingApproval(null);
			setStatus("idle");
			abortRef.current = null;
		},
		[getFileTree, setFileTree, updateAssistantMessage],
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

	const approve = useCallback(() => {
		if (!pendingApproval) {
			return;
		}

		let toolResult: unknown;
		if (pendingApproval.toolName === "editFile") {
			const path = pendingApproval.args.path;
			const oldContent = pendingApproval.args.oldContent;
			const newContent = pendingApproval.args.newContent;
			if (
				typeof path !== "string" ||
				typeof oldContent !== "string" ||
				typeof newContent !== "string"
			) {
				throw new Error("editFile arguments are invalid.");
			}

			toolResult = executeEditFile(getFileTree, setFileTree, {
				path,
				oldContent,
				newContent,
			});
			if (isRecord(toolResult) && toolResult.success === true) {
				onFileEdited?.(path);
			}
		} else {
			const path = pendingApproval.args.path;
			if (typeof path !== "string") {
				throw new Error("deleteFile arguments are invalid.");
			}
			toolResult = executeDeleteFile(getFileTree, setFileTree, { path });
		}

		setMessages((prev) =>
			prev.map((message) => ({
				...message,
				toolCalls: message.toolCalls.map((toolCall) =>
					toolCall.toolCallId === pendingApproval.toolCallId
						? { ...toolCall, result: toolResult, state: "result" }
						: toolCall,
				),
			})),
		);

		const toolMessage: ModelMessage = {
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: pendingApproval.toolCallId,
					toolName: pendingApproval.toolName,
					output: asToolOutput(toolResult),
				},
			],
		};
		const nextMessages = [...messagesRef.current, toolMessage];
		messagesRef.current = nextMessages;

		setPendingApproval(null);
		void runStream(nextMessages);
	}, [getFileTree, onFileEdited, pendingApproval, runStream, setFileTree]);

	const reject = useCallback(() => {
		if (!pendingApproval) {
			return;
		}

		const rejectionResult = { error: "User rejected this action." };

		setMessages((prev) =>
			prev.map((message) => ({
				...message,
				toolCalls: message.toolCalls.map((toolCall) =>
					toolCall.toolCallId === pendingApproval.toolCallId
						? { ...toolCall, result: rejectionResult, state: "result" }
						: toolCall,
				),
			})),
		);

		const toolMessage: ModelMessage = {
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: pendingApproval.toolCallId,
					toolName: pendingApproval.toolName,
					output: {
						type: "execution-denied",
						reason: "User rejected this action.",
					},
				},
			],
		};
		const nextMessages = [...messagesRef.current, toolMessage];
		messagesRef.current = nextMessages;

		setPendingApproval(null);
		void runStream(nextMessages);
	}, [pendingApproval, runStream]);

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
		setPendingApproval(null);
		setStatus("idle");
	}, []);

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
