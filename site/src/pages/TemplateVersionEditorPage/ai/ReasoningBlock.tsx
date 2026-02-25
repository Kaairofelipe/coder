import { BrainIcon, ChevronDownIcon, LoaderIcon } from "lucide-react";
import { type FC, useState } from "react";
import type { DisplayReasoning } from "./useTemplateAgent";

interface ReasoningBlockProps {
	reasoning: DisplayReasoning[];
}

/**
 * Collapsible block that shows AI reasoning/thinking traces.
 * Collapsed by default to keep the chat scannable — users can
 * expand to see the full chain of thought.
 */
export const ReasoningBlock: FC<ReasoningBlockProps> = ({ reasoning }) => {
	const [isOpen, setIsOpen] = useState(false);
	const isStreaming = reasoning.some((r) => r.isStreaming);
	const combinedText = reasoning.map((r) => r.text).join("\n\n");

	if (combinedText.trim().length === 0 && !isStreaming) {
		return null;
	}

	return (
		<div className="rounded-md border border-solid border-border/50 text-xs">
			<button
				type="button"
				onClick={() => setIsOpen((prev) => !prev)}
				className="flex w-full items-center gap-1.5 bg-transparent px-2.5 py-1.5 text-left text-content-secondary transition-colors hover:text-content-primary"
			>
				{isStreaming ? (
					<LoaderIcon className="size-3 animate-spin" />
				) : (
					<BrainIcon className="size-3" />
				)}
				<span className="flex-1 font-medium">
					{isStreaming ? "Thinking…" : "Reasoning"}
				</span>
				<ChevronDownIcon
					className={`size-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
				/>
			</button>

			{isOpen && (
				<div className="border-0 border-t border-solid border-border/50 px-2.5 py-2 text-2xs leading-relaxed text-content-secondary">
					<pre className="m-0 whitespace-pre-wrap break-words font-sans">
						{combinedText || "Thinking…"}
					</pre>
				</div>
			)}
		</div>
	);
};
