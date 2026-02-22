import { API } from "api/api";
import type { AIBridgeListInterceptionsResponse } from "api/typesGenerated";
import { useFilterParamsKey } from "components/Filter/Filter";
import type { UsePaginatedQueryOptions } from "hooks/usePaginatedQuery";
import type { UseQueryOptions } from "react-query";

export type AIBridgeProvider = "openai" | "anthropic";

export interface AIBridgeModel {
	id: string;
	provider: AIBridgeProvider;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const parseProviderModels = (
	body: unknown,
	provider: AIBridgeProvider,
): AIBridgeModel[] => {
	if (!isRecord(body) || !Array.isArray(body.data)) {
		return [];
	}

	return body.data.flatMap((model) => {
		if (!isRecord(model) || typeof model.id !== "string") {
			return [];
		}
		if (model.id.length === 0) {
			return [];
		}
		return [{ id: model.id, provider }];
	});
};

const fetchProviderModels = async (
	path: string,
	provider: AIBridgeProvider,
): Promise<AIBridgeModel[]> => {
	const response = await API.getAxiosInstance().get(path, {
		validateStatus: () => true,
	});
	if (response.status < 200 || response.status >= 300) {
		return [];
	}
	return parseProviderModels(response.data, provider);
};

const getModelKey = (model: AIBridgeModel): string =>
	`${model.provider}:${model.id}`;

const MODEL_DISCOVERY_REFRESH_MS = 60_000;

/**
 * Query options that fetches the list of models available through the
 * AI bridge. We probe both OpenAI and Anthropic model-list endpoints because
 * deployments may configure either provider independently.
 *
 * Returns an empty array when the bridge is not configured or unreachable —
 * never throws.
 */
export const aiBridgeModels = (): UseQueryOptions<AIBridgeModel[]> => ({
	queryKey: ["aiBridgeModels"],
	queryFn: async () => {
		const [openAIModels, anthropicModels] = await Promise.all([
			fetchProviderModels("/api/v2/aibridge/openai/v1/models", "openai").catch(
				() => [],
			),
			fetchProviderModels(
				"/api/v2/aibridge/anthropic/v1/models",
				"anthropic",
			).catch(() => []),
		]);

		const seenModelKeys = new Set<string>();
		const models: AIBridgeModel[] = [];
		for (const model of [...openAIModels, ...anthropicModels]) {
			const modelKey = getModelKey(model);
			if (seenModelKeys.has(modelKey)) {
				continue;
			}
			seenModelKeys.add(modelKey);
			models.push(model);
		}
		return models;
	},
	// Revalidate periodically so transient /models probe failures
	// do not hide the assistant indefinitely.
	staleTime: MODEL_DISCOVERY_REFRESH_MS,
	refetchInterval: MODEL_DISCOVERY_REFRESH_MS,
	refetchOnWindowFocus: true,
});

export const paginatedInterceptions = (
	searchParams: URLSearchParams,
): UsePaginatedQueryOptions<AIBridgeListInterceptionsResponse, string> => {
	return {
		searchParams,
		queryPayload: () => searchParams.get(useFilterParamsKey) ?? "",
		queryKey: ({ payload, pageNumber }) => {
			return ["aiBridgeInterceptions", payload, pageNumber] as const;
		},
		queryFn: ({ limit, offset, payload }) =>
			API.getAIBridgeInterceptions({
				offset,
				limit,
				q: payload,
			}),
	};
};
