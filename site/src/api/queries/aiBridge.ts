import { API } from "api/api";
import type { AIBridgeListInterceptionsResponse } from "api/typesGenerated";
import { useFilterParamsKey } from "components/Filter/Filter";
import type { UsePaginatedQueryOptions } from "hooks/usePaginatedQuery";
import type { UseQueryOptions } from "react-query";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const parseModelIDs = (body: unknown): string[] => {
	if (!isRecord(body) || !Array.isArray(body.data)) {
		return [];
	}

	return body.data.flatMap((model) => {
		if (!isRecord(model) || typeof model.id !== "string") {
			return [];
		}
		return [model.id];
	});
};

const fetchProviderModels = async (path: string): Promise<string[]> => {
	const response = await API.getAxiosInstance().get(path, {
		validateStatus: () => true,
	});
	if (response.status < 200 || response.status >= 300) {
		return [];
	}
	return parseModelIDs(response.data);
};

const toOpenAICompatibleAnthropicModelID = (modelID: string): string =>
	modelID.startsWith("anthropic/") ? modelID : `anthropic/${modelID}`;

/**
 * Query options that fetches the list of model IDs available through the
 * AI bridge. We probe both OpenAI and Anthropic model-list endpoints because
 * deployments may configure either provider independently.
 *
 * Returns an empty array when the bridge is not configured or unreachable —
 * never throws.
 */
export const aiBridgeModels = (): UseQueryOptions<string[]> => ({
	queryKey: ["aiBridgeModels"],
	queryFn: async () => {
		const [openAIModels, anthropicModels] = await Promise.all([
			fetchProviderModels("/api/v2/aibridge/openai/v1/models").catch(() => []),
			fetchProviderModels("/api/v2/aibridge/anthropic/v1/models").catch(
				() => [],
			),
		]);

		const normalizedAnthropicModels = anthropicModels.map(
			toOpenAICompatibleAnthropicModelID,
		);

		return Array.from(new Set([...openAIModels, ...normalizedAnthropicModels]));
	},
	// The bridge config rarely changes, so cache for a long time
	// and only re-check on mount.
	staleTime: Number.POSITIVE_INFINITY,
	refetchOnWindowFocus: false,
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
