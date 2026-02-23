import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
	createAgentUIStream,
	getToolName,
	isToolUIPart,
	readUIMessageStream,
	stepCountIs,
	ToolLoopAgent,
	type UIMessage,
} from "ai";
import { API } from "api/api";
import type { AIBridgeProvider, AIModelConfig } from "api/queries/aiBridge";
import { useCallback, useMemo, useRef, useState } from "react";
import type { FileTree } from "utils/filetree";
import { createTemplateAgentTools } from "./tools";
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
	apiKey: "coder",
	headers: {
		"X-CSRF-TOKEN": getRuntimeCsrfToken(),
		// Override the SDK's Authorization header so the AI bridge
		// authenticates via the browser's session cookie instead of
		// this placeholder key.
		Authorization: "",
	},
});

const anthropicProvider = createAnthropic({
	baseURL: "/api/v2/aibridge/anthropic/v1",
	apiKey: "coder",
	headers: {
		"X-CSRF-TOKEN": getRuntimeCsrfToken(),
		// Override the SDK's x-api-key header so the AI bridge
		// authenticates via the browser's session cookie instead of
		// this placeholder key.
		"x-api-key": "",
	},
});

const anthropicModelPrefix = "anthropic/";

const resolveProviderModel = (provider: AIBridgeProvider, modelID: string) => {
	if (modelID.length === 0) {
		throw new Error("Model ID cannot be empty.");
	}

	if (provider === "anthropic") {
		const anthropicModelID = modelID.startsWith(anthropicModelPrefix)
			? modelID.slice(anthropicModelPrefix.length)
			: modelID;
		if (anthropicModelID.length === 0) {
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
	modelConfig: AIModelConfig,
	getFileTree: () => FileTree,
	setFileTree: (updater: (prev: FileTree) => FileTree) => void,
	onFileEdited?: (path: string) => void,
	onFileDeleted?: (path: string) => void,
) => {
	const providerOptions: NonNullable<
		ConstructorParameters<typeof ToolLoopAgent>[0]["providerOptions"]
	> = {};
	if (
		modelConfig.model.provider === "openai" &&
		modelConfig.reasoningEffort !== undefined
	) {
		providerOptions.openai = {
			reasoningEffort: modelConfig.reasoningEffort,
		};
	}
	if (modelConfig.model.provider === "anthropic" && modelConfig.thinking) {
		providerOptions.anthropic = {
			thinking: modelConfig.thinking,
			...(modelConfig.anthropicEffort !== undefined && {
				effort: modelConfig.anthropicEffort,
			}),
		};
	}

	return new ToolLoopAgent({
		model: resolveProviderModel(
			modelConfig.model.provider,
			modelConfig.model.id,
		),
		instructions: SYSTEM_PROMPT,
		tools: createTemplateAgentTools(getFileTree, setFileTree, {
			onFileEdited,
			onFileDeleted,
		}),
		stopWhen: stepCountIs(MAX_STEPS),
		providerOptions,
	});
};

interface UseTemplateAgentOptions {
	getFileTree: () => FileTree;
	setFileTree: (updater: (prev: FileTree) => FileTree) => void;
	modelConfig: AIModelConfig;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const toToolArgs = (input: unknown): Record<string, unknown> =>
	isRecord(input) ? input : {};

const cloneMessage = <T>(value: T): T => {
	if (typeof globalThis.structuredClone === "function") {
		return globalThis.structuredClone(value);
	}
	return JSON.parse(JSON.stringify(value)) as T;
};

const upsertMessage = (
	messages: UIMessage[],
	message: UIMessage,
): UIMessage[] => {
	const index = messages.findIndex((existing) => existing.id === message.id);
	if (index === -1) {
		return [...messages, message];
	}
	const next = [...messages];
	next[index] = message;
	return next;
};

const mapToolStateToDisplay = (
	part: Parameters<typeof getToolName>[0],
): DisplayToolCall => {
	const toolName = getToolName(part);
	const args = toToolArgs(part.input);

	switch (part.state) {
		case "output-available":
			return {
				toolCallId: part.toolCallId,
				toolName,
				args,
				result: part.output,
				state: "result",
			};
		case "output-error":
			return {
				toolCallId: part.toolCallId,
				toolName,
				args,
				result: { error: part.errorText },
				state: "result",
			};
		case "output-denied":
			return {
				toolCallId: part.toolCallId,
				toolName,
				args,
				result: {
					error: part.approval.reason ?? "User rejected this action.",
				},
				state: "result",
			};
		default:
			return {
				toolCallId: part.toolCallId,
				toolName,
				args,
				state: "pending",
			};
	}
};

const toDisplayMessages = (uiMessages: UIMessage[]): DisplayMessage[] => {
	return uiMessages
		.filter(
			(message): message is UIMessage & { role: "user" | "assistant" } =>
				message.role === "user" || message.role === "assistant",
		)
		.map((message) => {
			const content = message.parts
				.filter(
					(part): part is { type: "text"; text: string } =>
						part.type === "text",
				)
				.map((part) => part.text)
				.join("");

			const toolCalls = message.parts
				.filter(isToolUIPart)
				.map(mapToolStateToDisplay);

			return {
				id: message.id,
				role: message.role,
				content,
				toolCalls,
			};
		});
};

const collectPendingApprovals = (
	uiMessages: UIMessage[],
): PendingToolCall[] => {
	const pending: PendingToolCall[] = [];

	for (const message of uiMessages) {
		if (message.role !== "assistant") {
			continue;
		}

		for (const part of message.parts) {
			if (!isToolUIPart(part) || part.state !== "approval-requested") {
				continue;
			}

			const toolName = getToolName(part);
			if (toolName !== "editFile" && toolName !== "deleteFile") {
				continue;
			}

			pending.push({
				approvalId: part.approval.id,
				toolCallId: part.toolCallId,
				toolName,
				args: toToolArgs(part.input),
			});
		}
	}

	return pending;
};

const applyApprovalResponse = (
	messages: UIMessage[],
	pending: PendingToolCall,
	approved: boolean,
	reason?: string,
): { nextMessages: UIMessage[]; updated: boolean } => {
	let updated = false;

	const nextMessages = messages.map((message) => {
		if (message.role !== "assistant") {
			return message;
		}

		let messageUpdated = false;
		const nextParts = message.parts.map((part) => {
			if (!isToolUIPart(part)) {
				return part;
			}
			if (
				part.toolCallId !== pending.toolCallId ||
				part.state !== "approval-requested"
			) {
				return part;
			}
			if (
				getToolName(part) !== pending.toolName ||
				part.approval.id !== pending.approvalId
			) {
				return part;
			}

			updated = true;
			messageUpdated = true;

			const approval = reason
				? { id: pending.approvalId, approved, reason }
				: { id: pending.approvalId, approved };
			return {
				...part,
				state: "approval-responded",
				approval,
			} as UIMessage["parts"][number];
		});

		return messageUpdated ? { ...message, parts: nextParts } : message;
	});

	return { nextMessages, updated };
};

export const useTemplateAgent = ({
	getFileTree,
	setFileTree,
	modelConfig,
	onFileEdited,
	onFileDeleted,
}: UseTemplateAgentOptions) => {
	const [uiMessages, setUIMessages] = useState<UIMessage[]>([]);
	const [status, setStatus] = useState<AgentStatus>("idle");

	const uiMessagesRef = useRef<UIMessage[]>([]);
	const messageCounter = useRef(0);
	const abortRef = useRef<AbortController | null>(null);

	const setConversationMessages = useCallback((next: UIMessage[]) => {
		uiMessagesRef.current = next;
		setUIMessages(next);
	}, []);

	const runStream = useCallback(
		async (conversation: UIMessage[]) => {
			abortRef.current?.abort();
			const abortController = new AbortController();
			abortRef.current = abortController;
			setStatus("streaming");

			const finishRun = (nextStatus: AgentStatus) => {
				if (abortRef.current !== abortController) {
					return;
				}
				abortRef.current = null;
				setStatus(nextStatus);
			};

			const agent = createTemplateAgent(
				modelConfig,
				getFileTree,
				setFileTree,
				onFileEdited,
				onFileDeleted,
			);

			let stream: Awaited<ReturnType<typeof createAgentUIStream>>;
			try {
				stream = await createAgentUIStream({
					agent,
					uiMessages: conversation,
					abortSignal: abortController.signal,
				});
			} catch {
				if (!abortController.signal.aborted) {
					finishRun("error");
				} else {
					finishRun("idle");
				}
				return;
			}

			let nextConversation = conversation;
			const lastMessage = conversation[conversation.length - 1];
			const initialAssistantMessage =
				lastMessage?.role === "assistant"
					? cloneMessage(lastMessage)
					: {
							id: `assistant-${++messageCounter.current}`,
							role: "assistant" as const,
							parts: [],
						};

			try {
				for await (const message of readUIMessageStream({
					stream,
					message: initialAssistantMessage,
				})) {
					if (abortController.signal.aborted) {
						break;
					}

					nextConversation = upsertMessage(uiMessagesRef.current, message);
					setConversationMessages(nextConversation);
				}
			} catch {
				if (!abortController.signal.aborted) {
					finishRun("error");
				} else {
					finishRun("idle");
				}
				return;
			}

			if (abortController.signal.aborted) {
				finishRun("idle");
				return;
			}

			const pending = collectPendingApprovals(nextConversation);
			finishRun(pending.length > 0 ? "awaiting_approval" : "idle");
		},
		[
			getFileTree,
			modelConfig,
			onFileDeleted,
			onFileEdited,
			setConversationMessages,
			setFileTree,
		],
	);

	const send = useCallback(
		(text: string) => {
			if (status === "streaming") {
				return;
			}
			// Don't allow new messages while approvals are pending.
			if (status === "awaiting_approval") {
				return;
			}
			if (abortRef.current) {
				return;
			}
			if (status === "error") {
				setStatus("idle");
			}

			const trimmed = text.trim();
			if (!trimmed) {
				return;
			}

			const userMessage: UIMessage = {
				id: `msg-${++messageCounter.current}`,
				role: "user",
				parts: [{ type: "text", text: trimmed }],
			};
			const nextConversation = [...uiMessagesRef.current, userMessage];
			setConversationMessages(nextConversation);

			void runStream(nextConversation);
		},
		[runStream, setConversationMessages, status],
	);

	const pendingApprovals = useMemo(
		() => collectPendingApprovals(uiMessages),
		[uiMessages],
	);

	const approve = useCallback(() => {
		if (status !== "awaiting_approval") {
			return;
		}

		const current = pendingApprovals[0];
		if (!current) {
			return;
		}

		const { nextMessages, updated } = applyApprovalResponse(
			uiMessagesRef.current,
			current,
			true,
		);
		if (!updated) {
			setStatus("error");
			return;
		}

		setConversationMessages(nextMessages);
		const remaining = collectPendingApprovals(nextMessages);
		if (remaining.length > 0) {
			setStatus("awaiting_approval");
			return;
		}

		void runStream(nextMessages);
	}, [pendingApprovals, runStream, setConversationMessages, status]);

	const reject = useCallback(() => {
		if (status !== "awaiting_approval") {
			return;
		}

		const current = pendingApprovals[0];
		if (!current) {
			return;
		}

		const { nextMessages, updated } = applyApprovalResponse(
			uiMessagesRef.current,
			current,
			false,
			"User rejected this action.",
		);
		if (!updated) {
			setStatus("error");
			return;
		}

		setConversationMessages(nextMessages);
		const remaining = collectPendingApprovals(nextMessages);
		if (remaining.length > 0) {
			setStatus("awaiting_approval");
			return;
		}

		void runStream(nextMessages);
	}, [pendingApprovals, runStream, setConversationMessages, status]);

	const stop = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		const pending = collectPendingApprovals(uiMessagesRef.current);
		setStatus(pending.length > 0 ? "awaiting_approval" : "idle");
	}, []);

	const reset = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		messageCounter.current = 0;
		setConversationMessages([]);
		setStatus("idle");
	}, [setConversationMessages]);

	const messages = useMemo(() => toDisplayMessages(uiMessages), [uiMessages]);
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
