import { SendIcon } from "lucide-react";
import {
	type FC,
	type KeyboardEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { cn } from "utils/cn";

interface ChatInputProps {
	onSend: (text: string) => void;
	disabled?: boolean;
	placeholder?: string;
}

export const ChatInput: FC<ChatInputProps> = ({
	onSend,
	disabled = false,
	placeholder = "Ask about this template...",
}) => {
	const [value, setValue] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const resizeTextarea = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) {
			return;
		}
		textarea.style.height = "auto";
		textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
	}, []);

	const handleSend = useCallback(() => {
		if (disabled) {
			return;
		}

		const trimmed = value.trim();
		if (!trimmed) {
			return;
		}

		onSend(trimmed);
		setValue("");
		const textarea = textareaRef.current;
		if (textarea) {
			textarea.style.height = "auto";
		}
	}, [disabled, onSend, value]);

	const onKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				event.stopPropagation();
				handleSend();
			}
		},
		[handleSend],
	);

	useEffect(() => {
		resizeTextarea();
	}, [resizeTextarea]);

	return (
		<div className="flex items-end gap-2 border-solid border-t border-border-default p-3">
			<textarea
				ref={textareaRef}
				value={value}
				onChange={(event) => {
					setValue(event.target.value);
					resizeTextarea();
				}}
				onKeyDown={onKeyDown}
				disabled={disabled}
				rows={1}
				placeholder={placeholder}
				className={cn(
					"max-h-[150px] min-h-[36px] flex-1 resize-none rounded-md",
					"border border-solid border-border-default bg-surface-primary px-3 py-2",
					"text-sm text-content-primary placeholder:text-content-secondary",
					"focus:outline-none focus:ring-1 focus:ring-content-link",
					"disabled:cursor-not-allowed disabled:opacity-50",
				)}
			/>
			<button
				type="button"
				onClick={handleSend}
				disabled={disabled || value.trim().length === 0}
				aria-label="Send message"
				className={cn(
					"shrink-0 rounded-md p-2 text-content-primary",
					"transition-colors hover:bg-surface-secondary",
					"disabled:cursor-not-allowed disabled:opacity-50",
				)}
			>
				<SendIcon className="size-4" />
			</button>
		</div>
	);
};
