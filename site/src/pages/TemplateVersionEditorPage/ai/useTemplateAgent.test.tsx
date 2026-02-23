import { act, renderHook, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import type { FileTree } from "utils/filetree";

const { createAgentUIStreamMock, readUIMessageStreamMock, ToolLoopAgentMock } =
	vi.hoisted(() => {
		return {
			createAgentUIStreamMock: vi.fn(),
			readUIMessageStreamMock: vi.fn(),
			ToolLoopAgentMock: vi.fn(function MockToolLoopAgent(this: unknown) {
				return this;
			}),
		};
	});

vi.mock("ai", () => {
	return {
		tool: (definition: unknown) => definition,
		createAgentUIStream: createAgentUIStreamMock,
		readUIMessageStream: readUIMessageStreamMock,
		stepCountIs: () => "stop-condition",
		ToolLoopAgent: ToolLoopAgentMock,
		getToolName: (part: { type: string; toolName?: string }) => {
			if (part.type === "dynamic-tool") {
				return part.toolName ?? "";
			}
			return part.type.startsWith("tool-") ? part.type.slice(5) : part.type;
		},
		isToolUIPart: (part: { type?: unknown }) => {
			if (typeof part?.type !== "string") {
				return false;
			}
			return part.type === "dynamic-tool" || part.type.startsWith("tool-");
		},
	};
});

import { useTemplateAgent } from "./useTemplateAgent";

type StreamMessage = UIMessage;

const enqueueUIMessageStreams = (streams: StreamMessage[][]) => {
	let streamIndex = 0;
	createAgentUIStreamMock.mockImplementation(async () => ({
		id: streamIndex++,
	}));
	readUIMessageStreamMock.mockImplementation(() => {
		const streamMessages = streams.shift();
		if (!streamMessages) {
			throw new Error("Expected a queued UI message stream.");
		}

		return (async function* () {
			for (const message of streamMessages) {
				yield structuredClone(message);
			}
		})();
	});
};

const editArgs = {
	path: "main.tf",
	oldContent: "old",
	newContent: "new",
};

const approvalMessage: UIMessage = {
	id: "assistant-1",
	role: "assistant",
	parts: [
		{ type: "text", text: "I can apply this change." },
		{
			type: "tool-editFile",
			toolCallId: "tool-1",
			state: "approval-requested",
			input: editArgs,
			approval: { id: "approval-1" },
		},
	],
};

const approvedResultMessage: UIMessage = {
	id: "assistant-1",
	role: "assistant",
	parts: [
		{ type: "text", text: "Applied." },
		{
			type: "tool-editFile",
			toolCallId: "tool-1",
			state: "output-available",
			input: editArgs,
			output: { success: true, path: "main.tf" },
			approval: { id: "approval-1", approved: true },
		},
	],
};

const deniedResultMessage: UIMessage = {
	id: "assistant-1",
	role: "assistant",
	parts: [
		{ type: "text", text: "I skipped that change." },
		{
			type: "tool-editFile",
			toolCallId: "tool-1",
			state: "output-denied",
			input: editArgs,
			approval: {
				id: "approval-1",
				approved: false,
				reason: "User rejected this action.",
			},
		},
	],
};

const renderTemplateAgentHook = () => {
	let fileTree: FileTree = { "main.tf": "old" };
	const getFileTree = () => fileTree;
	const setFileTree = (updater: (prev: FileTree) => FileTree) => {
		fileTree = updater(fileTree);
	};

	return renderHook(() =>
		useTemplateAgent({
			getFileTree,
			setFileTree,
			modelConfig: {
				model: {
					id: "gpt-4o-mini",
					provider: "openai",
				},
			},
		}),
	);
};

describe("useTemplateAgent approvals", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("moves approval-requested to approval-responded and resumes the stream on approve", async () => {
		enqueueUIMessageStreams([[approvalMessage], [approvedResultMessage]]);
		const { result } = renderTemplateAgentHook();

		act(() => {
			result.current.send("Apply the edit");
		});

		await waitFor(() => {
			expect(result.current.status).toBe("awaiting_approval");
		});
		expect(result.current.pendingApproval?.approvalId).toBe("approval-1");

		act(() => {
			result.current.approve();
		});

		await waitFor(() => {
			expect(result.current.status).toBe("idle");
		});
		expect(createAgentUIStreamMock).toHaveBeenCalledTimes(2);

		const secondCallOptions = createAgentUIStreamMock.mock.calls[1]?.[0] as {
			uiMessages: UIMessage[];
		};
		expect(secondCallOptions).toBeDefined();

		const lastMessage =
			secondCallOptions.uiMessages[secondCallOptions.uiMessages.length - 1];
		expect(lastMessage.role).toBe("assistant");
		const approvalPart = lastMessage.parts.find(
			(part) => part.type === "tool-editFile",
		) as
			| {
					state: string;
					approval: { id: string; approved: boolean; reason?: string };
			  }
			| undefined;
		expect(approvalPart).toMatchObject({
			state: "approval-responded",
			approval: { id: "approval-1", approved: true },
		});

		await waitFor(() => {
			const assistantMessages = result.current.messages.filter(
				(message) => message.role === "assistant",
			);
			const latestAssistant = assistantMessages[assistantMessages.length - 1];
			expect(latestAssistant.toolCalls[0]).toMatchObject({
				toolCallId: "tool-1",
				state: "result",
				result: { success: true, path: "main.tf" },
			});
		});
		expect(result.current.pendingApproval).toBeNull();
	});

	it("marks the approval as denied and resumes the stream on reject", async () => {
		enqueueUIMessageStreams([[approvalMessage], [deniedResultMessage]]);
		const { result } = renderTemplateAgentHook();

		act(() => {
			result.current.send("Do the change");
		});

		await waitFor(() => {
			expect(result.current.status).toBe("awaiting_approval");
		});

		act(() => {
			result.current.reject();
		});

		await waitFor(() => {
			expect(result.current.status).toBe("idle");
		});
		expect(createAgentUIStreamMock).toHaveBeenCalledTimes(2);

		const secondCallOptions = createAgentUIStreamMock.mock.calls[1]?.[0] as {
			uiMessages: UIMessage[];
		};
		const lastMessage =
			secondCallOptions.uiMessages[secondCallOptions.uiMessages.length - 1];
		const approvalPart = lastMessage.parts.find(
			(part) => part.type === "tool-editFile",
		) as
			| {
					state: string;
					approval: { id: string; approved: boolean; reason?: string };
			  }
			| undefined;
		expect(approvalPart).toMatchObject({
			state: "approval-responded",
			approval: {
				id: "approval-1",
				approved: false,
				reason: "User rejected this action.",
			},
		});

		await waitFor(() => {
			const assistantMessages = result.current.messages.filter(
				(message) => message.role === "assistant",
			);
			const latestAssistant = assistantMessages[assistantMessages.length - 1];
			expect(latestAssistant.toolCalls[0]).toMatchObject({
				toolCallId: "tool-1",
				state: "result",
				result: { error: "User rejected this action." },
			});
		});
		expect(result.current.pendingApproval).toBeNull();
	});
});
