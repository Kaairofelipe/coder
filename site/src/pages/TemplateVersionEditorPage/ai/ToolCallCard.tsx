import {
	AlertTriangleIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	FileTextIcon,
	FolderOpenIcon,
} from "lucide-react";
import { type FC, useMemo, useState } from "react";
import { cn } from "utils/cn";
import type { DisplayToolCall } from "./useTemplateAgent";

interface ToolCallCardProps {
	toolCall: DisplayToolCall;
	onNavigateToFile?: (path: string) => void;
}

const MAX_VISIBLE_READ_LINES = 20;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

export const ToolCallCard: FC<ToolCallCardProps> = ({
	toolCall,
	onNavigateToFile,
}) => {
	const [expanded, setExpanded] = useState(false);
	const [showAllReadLines, setShowAllReadLines] = useState(false);

	const result = isRecord(toolCall.result) ? toolCall.result : null;
	const error = typeof result?.error === "string" ? result.error : null;
	const path =
		typeof toolCall.args.path === "string" ? toolCall.args.path : null;

	const files = useMemo(() => {
		if (!Array.isArray(result?.files)) {
			return [];
		}
		return result.files.filter(
			(file): file is string => typeof file === "string",
		);
	}, [result]);

	const readFileContent =
		typeof result?.content === "string" ? result.content : undefined;
	const readFileLines = useMemo(() => {
		if (typeof readFileContent !== "string") {
			return [];
		}
		return readFileContent.split("\n");
	}, [readFileContent]);
	const hasTruncatedReadFile = readFileLines.length > MAX_VISIBLE_READ_LINES;
	const displayedReadFileLines = showAllReadLines
		? readFileLines
		: readFileLines.slice(0, MAX_VISIBLE_READ_LINES);

	const Icon =
		toolCall.toolName === "listFiles" ? FolderOpenIcon : FileTextIcon;

	return (
		<div className="rounded-md border border-solid border-border-default bg-surface-secondary/30">
			<button
				type="button"
				onClick={() => setExpanded((prev) => !prev)}
				className="flex w-full items-center gap-2 p-2 text-left"
			>
				{expanded ? (
					<ChevronDownIcon className="size-4 text-content-secondary" />
				) : (
					<ChevronRightIcon className="size-4 text-content-secondary" />
				)}
				<Icon className="size-4 text-content-secondary" />
				<span className="text-xs font-medium text-content-primary">
					{toolCall.toolName}
				</span>
				{toolCall.state === "pending" && (
					<span className="ml-auto text-2xs text-content-secondary">
						Running…
					</span>
				)}
			</button>

			{expanded && (
				<div className="border-solid border-t border-border-default px-3 pb-3 pt-2">
					{error && (
						<div className="mb-2 flex items-start gap-2 rounded-md border border-solid border-border-destructive bg-surface-destructive/30 p-2">
							<AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-content-destructive" />
							<p className="text-xs text-content-destructive">{error}</p>
						</div>
					)}

					{toolCall.toolName === "listFiles" && files.length > 0 && (
						<ul className="m-0 list-none space-y-1 p-0">
							{files.map((file) => (
								<li key={file}>
									<button
										type="button"
										onClick={() => onNavigateToFile?.(file)}
										className={cn(
											"text-left text-xs text-content-link hover:underline",
											onNavigateToFile ? "cursor-pointer" : "cursor-default",
										)}
										disabled={!onNavigateToFile}
									>
										{file}
									</button>
								</li>
							))}
						</ul>
					)}

					{toolCall.toolName === "readFile" &&
						readFileContent !== undefined && (
							<div className="space-y-2">
								{path && (
									<button
										type="button"
										onClick={() => onNavigateToFile?.(path)}
										disabled={!onNavigateToFile}
										className={cn(
											"text-xs text-content-link hover:underline",
											onNavigateToFile ? "cursor-pointer" : "cursor-default",
										)}
									>
										{path}
									</button>
								)}
								<pre className="overflow-x-auto rounded-md bg-surface-primary p-2 text-[11px] text-content-primary">
									{displayedReadFileLines.join("\n")}
								</pre>
								{hasTruncatedReadFile && (
									<button
										type="button"
										onClick={() => setShowAllReadLines((prev) => !prev)}
										className="text-xs text-content-link hover:underline"
									>
										{showAllReadLines ? "Show less" : "Show more"}
									</button>
								)}
							</div>
						)}

					{toolCall.state === "pending" && !error && (
						<p className="text-xs text-content-secondary">
							Waiting for tool result…
						</p>
					)}
				</div>
			)}
		</div>
	);
};
