// Shared types for the template editor AI agent.

/** Tool call awaiting user approval (editFile or deleteFile). */
export interface PendingToolCall {
	/** The tool call ID from the AI SDK. */
	toolCallId: string;
	/** Name of the tool being called. */
	toolName: "editFile" | "deleteFile";
	/** The arguments passed to the tool. */
	args: Record<string, unknown>;
}

/** Possible states for the agent conversation loop. */
export type AgentStatus = "idle" | "streaming" | "awaiting_approval" | "error";
