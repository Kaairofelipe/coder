import { UserIcon } from "lucide-react";
import type { FC } from "react";
import type { FileTree } from "utils/filetree";
import { EditApprovalCard } from "./EditApprovalCard";
import { ToolCallCard } from "./ToolCallCard";
import type { PendingToolCall } from "./types";
import type { DisplayMessage } from "./useTemplateAgent";

interface ChatMessageProps {
	message: DisplayMessage;
	pendingApproval: PendingToolCall | null;
	onApprove: () => void;
	onReject: () => void;
	onNavigateToFile?: (path: string) => void;
	getFileTree: () => FileTree;
}

export const ChatMessage: FC<ChatMessageProps> = ({
	message,
	pendingApproval,
	onApprove,
	onReject,
	onNavigateToFile,
	getFileTree,
}) => {
	if (message.role === "user") {
		return (
			<div className="flex justify-end">
				<div className="max-w-[90%] rounded-lg bg-surface-invert-primary px-3 py-2 text-sm text-content-invert">
					<div className="mb-1 flex items-center gap-1 text-2xs text-content-invert-secondary">
						<UserIcon className="size-3" />
						<span>You</span>
					</div>
					<p className="m-0 whitespace-pre-wrap break-words">
						{message.content}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-2">
			{message.content.trim().length > 0 && (
				<p className="m-0 whitespace-pre-wrap break-words text-sm text-content-primary">
					{message.content}
				</p>
			)}

			{message.toolCalls.map((toolCall) => {
				const isEditAction =
					toolCall.toolName === "editFile" ||
					toolCall.toolName === "deleteFile";
				if (isEditAction) {
					const isPending =
						pendingApproval?.toolCallId === toolCall.toolCallId &&
						toolCall.state === "pending";
					return (
						<EditApprovalCard
							key={toolCall.toolCallId}
							toolCall={toolCall}
							isPending={isPending}
							onApprove={onApprove}
							onReject={onReject}
							onNavigateToFile={onNavigateToFile}
							getFileTree={getFileTree}
						/>
					);
				}

				return (
					<ToolCallCard
						key={toolCall.toolCallId}
						toolCall={toolCall}
						onNavigateToFile={onNavigateToFile}
					/>
				);
			})}
		</div>
	);
};
