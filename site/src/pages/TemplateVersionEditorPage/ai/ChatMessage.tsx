import { SparklesIcon, UserIcon } from "lucide-react";
import type { FC } from "react";
import { cn } from "utils/cn";
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
}

export const ChatMessage: FC<ChatMessageProps> = ({
	message,
	pendingApproval,
	onApprove,
	onReject,
	onNavigateToFile,
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
		<div className="flex gap-2">
			<div className="mt-0.5 rounded-full bg-surface-secondary p-1 text-content-secondary">
				<SparklesIcon className="size-3" />
			</div>
			<div className="min-w-0 flex-1 space-y-2">
				{message.content.trim().length > 0 && (
					<div className="rounded-md bg-surface-secondary/40 p-3 text-sm text-content-primary">
						<p className="m-0 whitespace-pre-wrap break-words">
							{message.content}
						</p>
					</div>
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
							/>
						);
					}

					return (
						<div key={toolCall.toolCallId} className={cn("max-w-full")}>
							<ToolCallCard
								toolCall={toolCall}
								onNavigateToFile={onNavigateToFile}
							/>
						</div>
					);
				})}
			</div>
		</div>
	);
};
