import { Button } from "components/Button/Button";
import {
	CheckIcon,
	FilePenLineIcon,
	Trash2Icon,
	TriangleAlertIcon,
	XIcon,
} from "lucide-react";
import { type FC, useMemo } from "react";
import { cn } from "utils/cn";
import type { DisplayToolCall } from "./useTemplateAgent";

interface EditApprovalCardProps {
	toolCall: DisplayToolCall;
	isPending: boolean;
	onApprove: () => void;
	onReject: () => void;
	onNavigateToFile?: (path: string) => void;
}

type DiffLine = {
	type: "added" | "removed";
	text: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const splitLines = (content: string) => content.split("\n");

const buildDiffLines = (oldContent: string, newContent: string): DiffLine[] => {
	if (oldContent.length === 0) {
		return splitLines(newContent).map((line) => ({
			type: "added",
			text: line,
		}));
	}

	const removedLines = splitLines(oldContent).map((line) => ({
		type: "removed" as const,
		text: line,
	}));
	const addedLines = splitLines(newContent).map((line) => ({
		type: "added" as const,
		text: line,
	}));
	return [...removedLines, ...addedLines];
};

export const EditApprovalCard: FC<EditApprovalCardProps> = ({
	toolCall,
	isPending,
	onApprove,
	onReject,
	onNavigateToFile,
}) => {
	const path = typeof toolCall.args.path === "string" ? toolCall.args.path : "";
	if (!path) {
		throw new Error("Edit and delete tool calls require a path argument.");
	}

	const oldContent =
		typeof toolCall.args.oldContent === "string"
			? toolCall.args.oldContent
			: "";
	const newContent =
		typeof toolCall.args.newContent === "string"
			? toolCall.args.newContent
			: "";

	const diffLines = useMemo(() => {
		if (toolCall.toolName !== "editFile") {
			return [];
		}
		return buildDiffLines(oldContent, newContent);
	}, [newContent, oldContent, toolCall.toolName]);

	const result = isRecord(toolCall.result) ? toolCall.result : null;
	const resultError = typeof result?.error === "string" ? result.error : null;
	const resultSuccess = result?.success === true;

	return (
		<div className="space-y-3 rounded-md border border-solid border-border-default bg-surface-secondary/20 p-3">
			<div className="flex items-center gap-2">
				{toolCall.toolName === "editFile" ? (
					<FilePenLineIcon className="size-4 text-content-secondary" />
				) : (
					<Trash2Icon className="size-4 text-content-destructive" />
				)}
				<button
					type="button"
					onClick={() => onNavigateToFile?.(path)}
					disabled={!onNavigateToFile}
					className={cn(
						"text-left text-xs font-medium text-content-link hover:underline",
						onNavigateToFile ? "cursor-pointer" : "cursor-default",
					)}
				>
					{path}
				</button>
			</div>

			{toolCall.toolName === "editFile" ? (
				<div className="max-h-56 overflow-y-auto rounded-md border border-solid border-border-default bg-surface-primary">
					{diffLines.length > 0 ? (
						diffLines.map((line, index) => {
							const isAdded = line.type === "added";
							return (
								<div
									key={`${line.type}-${index}-${line.text}`}
									className={cn(
										"font-mono text-[11px] leading-5 px-2",
										isAdded
											? "bg-surface-positive/30 text-content-positive"
											: "bg-surface-destructive/30 text-content-destructive",
									)}
								>
									{isAdded ? "+" : "-"}
									{line.text}
								</div>
							);
						})
					) : (
						<p className="p-2 text-xs text-content-secondary">
							No content changes.
						</p>
					)}
				</div>
			) : (
				<div className="rounded-md border border-solid border-border-destructive bg-surface-destructive/20 p-2 text-xs text-content-destructive">
					Delete file: {path}
				</div>
			)}

			{isPending && (
				<div className="flex items-center gap-2">
					<Button variant="outline" size="sm" onClick={onApprove}>
						<CheckIcon />
						Approve
					</Button>
					<Button variant="subtle" size="sm" onClick={onReject}>
						<XIcon />
						Reject
					</Button>
				</div>
			)}

			{!isPending && toolCall.state === "pending" && (
				<div className="rounded-md border border-solid border-border-warning bg-surface-warning/20 p-2 text-xs text-content-warning">
					Waiting for approval.
				</div>
			)}

			{toolCall.state === "result" && resultSuccess && (
				<div className="rounded-md border border-solid border-border-success bg-surface-positive/20 p-2 text-xs text-content-positive">
					{toolCall.toolName === "deleteFile"
						? "File deleted successfully."
						: "Edit applied successfully."}
				</div>
			)}

			{toolCall.state === "result" && resultError && (
				<div className="flex items-start gap-2 rounded-md border border-solid border-border-destructive bg-surface-destructive/20 p-2 text-xs text-content-destructive">
					<TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
					<span>{resultError}</span>
				</div>
			)}
		</div>
	);
};
