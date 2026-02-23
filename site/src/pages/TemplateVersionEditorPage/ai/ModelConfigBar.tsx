import type {
	AIBridgeModel,
	AIModelConfig,
	AnthropicThinking,
	OpenAIReasoningEffort,
} from "api/queries/aiBridge";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "components/Select/Select";
import { SingleThumbSlider } from "components/Slider/SingleThumbSlider";
import type { FC } from "react";

const DEFAULT_REASONING_EFFORT: OpenAIReasoningEffort = "medium";
const DEFAULT_THINKING_BUDGET_TOKENS = 10_240;
const MIN_THINKING_BUDGET_TOKENS = 1_024;
const MAX_THINKING_BUDGET_TOKENS = 32_768;
const THINKING_BUDGET_STEP_TOKENS = 1_024;

const OPENAI_REASONING_OPTIONS: readonly OpenAIReasoningEffort[] = [
	"low",
	"medium",
	"high",
];

type ThinkingModeValue = "disabled" | "adaptive" | "budget";

const toModelKey = (model: AIBridgeModel): string =>
	`${model.provider}:${model.id}`;

const parseModelKey = (
	key: string,
): { provider: AIBridgeModel["provider"]; id: string } => {
	const separatorIndex = key.indexOf(":");
	if (separatorIndex === -1) {
		throw new Error(
			`Invalid model key "${key}". Expected provider:model format.`,
		);
	}

	const provider = key.slice(0, separatorIndex);
	const id = key.slice(separatorIndex + 1);
	if ((provider !== "openai" && provider !== "anthropic") || id.length === 0) {
		throw new Error(
			`Invalid model key "${key}". Unknown provider or empty ID.`,
		);
	}

	return { provider, id };
};

const clampThinkingBudgetTokens = (value: number): number => {
	if (!Number.isFinite(value)) {
		throw new Error("Thinking budget must be a finite number.");
	}

	const roundedToStep =
		Math.round(value / THINKING_BUDGET_STEP_TOKENS) *
		THINKING_BUDGET_STEP_TOKENS;
	return Math.min(
		MAX_THINKING_BUDGET_TOKENS,
		Math.max(MIN_THINKING_BUDGET_TOKENS, roundedToStep),
	);
};

const getThinkingMode = (
	thinking: AnthropicThinking | undefined,
): ThinkingModeValue => {
	if (!thinking || thinking.type === "disabled") {
		return "disabled";
	}
	if (thinking.type === "adaptive") {
		return "adaptive";
	}
	return "budget";
};

const getDefaultModelConfig = (model: AIBridgeModel): AIModelConfig => {
	const config: AIModelConfig = { model };

	if (model.provider === "openai" && isOpenAIReasoningModel(model.id)) {
		config.reasoningEffort = DEFAULT_REASONING_EFFORT;
	}
	if (model.provider === "anthropic" && isAnthropicThinkingModel(model.id)) {
		config.thinking = { type: "adaptive" };
	}

	return config;
};

/** Returns true for OpenAI o-series models that support reasoning effort. */
export const isOpenAIReasoningModel = (modelID: string): boolean => {
	const normalized = modelID.toLowerCase();
	return (
		normalized.startsWith("o1") ||
		normalized.startsWith("o3") ||
		normalized.startsWith("o4")
	);
};

/** Returns true for Anthropic models that support extended thinking. */
export const isAnthropicThinkingModel = (modelID: string): boolean => {
	const normalized = modelID.toLowerCase();
	return (
		normalized.includes("claude-3-7-sonnet") ||
		normalized.includes("claude-sonnet-4") ||
		normalized.includes("claude-opus-4")
	);
};

interface ModelConfigBarProps {
	modelConfig: AIModelConfig;
	availableModels: readonly AIBridgeModel[];
	onModelConfigChange: (config: AIModelConfig) => void;
}

export const ModelConfigBar: FC<ModelConfigBarProps> = ({
	modelConfig,
	availableModels,
	onModelConfigChange,
}) => {
	const selectedModel = modelConfig.model;
	const showOpenAIReasoning =
		selectedModel.provider === "openai" &&
		isOpenAIReasoningModel(selectedModel.id);
	const showAnthropicThinking =
		selectedModel.provider === "anthropic" &&
		isAnthropicThinkingModel(selectedModel.id);

	const reasoningEffort =
		modelConfig.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
	const thinkingMode = getThinkingMode(modelConfig.thinking);
	const thinkingBudgetTokens =
		modelConfig.thinking?.type === "enabled"
			? clampThinkingBudgetTokens(modelConfig.thinking.budgetTokens)
			: DEFAULT_THINKING_BUDGET_TOKENS;

	const handleModelChange = (nextModelKey: string) => {
		const parsedModel = parseModelKey(nextModelKey);
		const nextModel = availableModels.find(
			(model) =>
				model.provider === parsedModel.provider && model.id === parsedModel.id,
		);
		if (!nextModel) {
			throw new Error(`Selected model "${nextModelKey}" is not available.`);
		}
		onModelConfigChange(getDefaultModelConfig(nextModel));
	};

	const handleReasoningEffortChange = (nextReasoningEffort: string) => {
		if (
			!OPENAI_REASONING_OPTIONS.includes(
				nextReasoningEffort as OpenAIReasoningEffort,
			)
		) {
			throw new Error(
				`Invalid OpenAI reasoning effort "${nextReasoningEffort}" selected.`,
			);
		}
		onModelConfigChange({
			...modelConfig,
			reasoningEffort: nextReasoningEffort as OpenAIReasoningEffort,
		});
	};

	const handleThinkingModeChange = (nextThinkingMode: string) => {
		switch (nextThinkingMode) {
			case "disabled":
				onModelConfigChange({
					...modelConfig,
					thinking: { type: "disabled" },
				});
				return;
			case "adaptive":
				onModelConfigChange({
					...modelConfig,
					thinking: { type: "adaptive" },
				});
				return;
			case "budget":
				onModelConfigChange({
					...modelConfig,
					thinking: {
						type: "enabled",
						budgetTokens: thinkingBudgetTokens,
					},
				});
				return;
			default:
				throw new Error(
					`Unknown Anthropic thinking mode "${nextThinkingMode}".`,
				);
		}
	};

	return (
		<div className="border-solid border-b border-border-default px-3 py-2">
			<div className="flex flex-wrap items-end gap-3">
				<div className="min-w-[220px] flex-1">
					<div className="mb-1 text-xs text-content-secondary">Model</div>
					<Select
						value={toModelKey(selectedModel)}
						onValueChange={handleModelChange}
					>
						<SelectTrigger className="h-9">
							<SelectValue placeholder="Select a model" />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								<SelectLabel>OpenAI</SelectLabel>
								{availableModels
									.filter((model) => model.provider === "openai")
									.map((model) => (
										<SelectItem
											key={toModelKey(model)}
											value={toModelKey(model)}
										>
											{model.id}
										</SelectItem>
									))}
							</SelectGroup>
							<SelectGroup>
								<SelectLabel>Anthropic</SelectLabel>
								{availableModels
									.filter((model) => model.provider === "anthropic")
									.map((model) => (
										<SelectItem
											key={toModelKey(model)}
											value={toModelKey(model)}
										>
											{model.id}
										</SelectItem>
									))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</div>

				{showOpenAIReasoning && (
					<div className="w-[180px]">
						<div className="mb-1 text-xs text-content-secondary">Reasoning</div>
						<Select
							value={reasoningEffort}
							onValueChange={handleReasoningEffortChange}
						>
							<SelectTrigger className="h-9">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{OPENAI_REASONING_OPTIONS.map((option) => (
									<SelectItem key={option} value={option}>
										{option}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				)}

				{showAnthropicThinking && (
					<>
						<div className="w-[200px]">
							<div className="mb-1 text-xs text-content-secondary">
								Thinking
							</div>
							<Select
								value={thinkingMode}
								onValueChange={handleThinkingModeChange}
							>
								<SelectTrigger className="h-9">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="disabled">Disabled</SelectItem>
									<SelectItem value="adaptive">Adaptive</SelectItem>
									<SelectItem value="budget">Budget</SelectItem>
								</SelectContent>
							</Select>
						</div>
						{thinkingMode === "budget" && (
							<div className="min-w-[240px] flex-1">
								<div className="mb-1 flex items-center justify-between text-xs text-content-secondary">
									<span>Thinking budget</span>
									<span>{thinkingBudgetTokens.toLocaleString()} tokens</span>
								</div>
								<SingleThumbSlider
									value={[thinkingBudgetTokens]}
									min={MIN_THINKING_BUDGET_TOKENS}
									max={MAX_THINKING_BUDGET_TOKENS}
									step={THINKING_BUDGET_STEP_TOKENS}
									onValueChange={(value) => {
										const nextBudgetTokens = value[0];
										if (typeof nextBudgetTokens !== "number") {
											throw new Error(
												"Expected a single slider value for thinking budget.",
											);
										}
										onModelConfigChange({
											...modelConfig,
											thinking: {
												type: "enabled",
												budgetTokens:
													clampThinkingBudgetTokens(nextBudgetTokens),
											},
										});
									}}
								/>
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
};
