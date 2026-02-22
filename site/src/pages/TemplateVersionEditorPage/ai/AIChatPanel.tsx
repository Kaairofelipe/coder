import { Button } from "components/Button/Button";
import { RotateCcwIcon, SparklesIcon, XIcon } from "lucide-react";
import { type FC, useEffect, useRef } from "react";
import type { FileTree } from "utils/filetree";
import { ChatInput } from "./ChatInput";
import { ChatMessage } from "./ChatMessage";
import { useTemplateAgent } from "./useTemplateAgent";

interface AIChatPanelProps {
	getFileTree: () => FileTree;
	setFileTree: (updater: (prev: FileTree) => FileTree) => void;
	onNavigateToFile?: (path: string) => void;
	onFileDeleted?: (path: string) => void;
	onClose: () => void;
}

export const AIChatPanel: FC<AIChatPanelProps> = ({
	getFileTree,
	setFileTree,
	onNavigateToFile,
	onFileDeleted,
	onClose,
}) => {
	const {
		messages,
		isStreaming,
		status,
		pendingApproval,
		send,
		approve,
		reject,
		stop,
		reset,
	} = useTemplateAgent({
		getFileTree,
		setFileTree,
		onFileEdited: onNavigateToFile,
		onFileDeleted,
	});

	// Abort any active stream when the panel is unmounted so we
	// don't leave orphaned network requests running in the
	// background.
	useEffect(() => {
		return () => {
			stop();
		};
	}, [stop]);

	const listRef = useRef<HTMLDivElement>(null);

	const messageCount = messages.length;

	useEffect(() => {
		const node = listRef.current;
		if (!node) {
			return;
		}
		if (messageCount === 0 && status === "idle") {
			return;
		}
		node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
	}, [messageCount, status]);

	const inputDisabled = isStreaming || status === "awaiting_approval";

	return (
		<div className="flex h-full flex-col border-solid border-l border-border-default bg-surface-primary">
			<div className="flex items-center justify-between border-solid border-b border-border-default px-3 py-2">
				<div className="flex items-center gap-2 text-sm font-medium text-content-primary">
					<SparklesIcon className="size-4 text-content-link" />
					<span>AI Assistant</span>
				</div>
				<div className="flex items-center gap-1">
					<Button variant="subtle" size="sm" onClick={reset}>
						<RotateCcwIcon />
						Reset
					</Button>
					<Button
						variant="subtle"
						size="icon"
						onClick={onClose}
						aria-label="Close AI assistant panel"
					>
						<XIcon />
					</Button>
				</div>
			</div>

			<div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-3">
				{messages.length === 0 && (
					<div className="rounded-md border border-dashed border-border-default bg-surface-secondary/20 p-3 text-sm text-content-secondary">
						Ask me to inspect or modify your template files. I can read files,
						propose edits, and ask for approval before changing anything.
					</div>
				)}

				{messages.map((message) => (
					<ChatMessage
						key={message.id}
						message={message}
						pendingApproval={pendingApproval}
						onApprove={approve}
						onReject={reject}
						onNavigateToFile={onNavigateToFile}
					/>
				))}
			</div>

			{isStreaming && (
				<div className="border-solid border-t border-border-default px-3 py-2 text-xs text-content-secondary">
					Thinking…
				</div>
			)}

			{status === "error" && (
				<div className="border-solid border-t border-border-destructive bg-surface-destructive/20 px-3 py-2 text-xs text-content-destructive">
					Something went wrong while streaming the assistant response. Reset the
					chat and try again.
				</div>
			)}

			<ChatInput onSend={send} disabled={inputDisabled} />
		</div>
	);
};
