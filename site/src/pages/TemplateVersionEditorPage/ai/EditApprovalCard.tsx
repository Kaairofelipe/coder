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
	type: "added" | "removed" | "unchanged";
	text: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const splitLines = (content: string) => content.split("\n");

/**
 * Compute a line-level diff between oldContent and newContent
 * using a simple LCS-based algorithm. Returns lines annotated
 * as "unchanged", "removed", or "added".
 */
const buildDiffLines = (oldContent: string, newContent: string): DiffLine[] => {
	if (oldContent.length === 0) {
		return splitLines(newContent).map((line) => ({ type: "added", text: line }));
	}
	if (newContent.length === 0) {
		return splitLines(oldContent).map((line) => ({ type: "removed", text: line }));
	}

	const oldLines = splitLines(oldContent);
	const newLines = splitLines(newContent);

	// Build the LCS table.
	const m = oldLines.length;
	const n = newLines.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () =>
		new Array<number>(n + 1).fill(0),
	);
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			dp[i][j] =
				oldLines[i - 1] === newLines[j - 1]
					? dp[i - 1][j - 1] + 1
					: Math.max(dp[i - 1][j], dp[i][j - 1]);
		}
	}

	// Backtrack to produce the diff.
	const result: DiffLine[] = [];
	let i = m;
	let j = n;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
			result.push({ type: "unchanged", text: oldLines[i - 1] });
			i--;
			j--;
		} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
			result.push({ type: "added", text: newLines[j - 1] });
			j--;
		} else {
			result.push({ type: "removed", text: oldLines[i - 1] });
			i--;
		}
	}

	return result.reverse();
};

export const EditApprovalCard: FC<EditApprovalCardProps> = ({
	toolCall,
	isPending,
	onApprove,
	onReject,
	onNavigateToFile,
}) => {
	const path = typeof toolCall.args.path === "string" ? toolCall.args.path : "";
	const hasValidPath = path.length > 0;
	const pathLabel = hasValidPath ? path : "(invalid path)";

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
					onClick={() => {
						if (hasValidPath) {
							onNavigateToFile?.(path);
						}
					}}
					disabled={!onNavigateToFile || !hasValidPath}
					className={cn(
						"text-left text-xs font-medium text-content-link hover:underline",
						onNavigateToFile && hasValidPath
							? "cursor-pointer"
							: "cursor-default",
					)}
				>
					{pathLabel}
				</button>
			</div>

			{!hasValidPath && (
				<div className="rounded-md border border-solid border-border-destructive bg-surface-destructive/20 p-2 text-xs text-content-destructive">
					This tool call is missing a valid file path.
				</div>
			)}

			{toolCall.toolName === "editFile" ? (
				<div className="max-h-56 overflow-y-auto rounded-md border border-solid border-border-default bg-surface-primary">
					{diffLines.length > 0 ? (
						diffLines.map((line, index) => (
							<div
								key={`${line.type}-${index}`}
								className={cn(
									"font-mono text-[11px] leading-5 px-2",
									line.type === "added" &&
										"bg-surface-positive/30 text-content-positive",
									line.type === "removed" &&
										"bg-surface-destructive/30 text-content-destructive",
									line.type === "unchanged" && "text-content-secondary",
								)}
							>
								{line.type === "added"
									? "+"
									: line.type === "removed"
										? "−"
										: " "}
								{line.text}
							</div>
						))
					) : (
						<p className="p-2 text-xs text-content-secondary">
							No content changes.
						</p>
					)}
				</div>
			) : (
				<div className="rounded-md border border-solid border-border-destructive bg-surface-destructive/20 p-2 text-xs text-content-destructive">
					Delete file: {pathLabel}
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
