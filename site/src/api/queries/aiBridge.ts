import { API } from "api/api";
import type { AIBridgeListInterceptionsResponse } from "api/typesGenerated";
import { useFilterParamsKey } from "components/Filter/Filter";
import type { UsePaginatedQueryOptions } from "hooks/usePaginatedQuery";
import type { UseQueryOptions } from "react-query";

/**
 * Query options that fetches the list of model IDs available through the
 * AI bridge. Returns an empty array when the bridge is not configured or
 * unreachable — never throws.
 */
export const aiBridgeModels = (): UseQueryOptions<string[]> => ({
	queryKey: ["aiBridgeModels"],
	queryFn: async () => {
		const response = await API.getAxiosInstance().get(
			"/api/v2/aibridge/openai/v1/models",
			{ validateStatus: () => true },
		);
		if (response.status < 200 || response.status >= 300) {
			return [];
		}

		// The response follows the OpenAI List Models format:
		// { data: [{ id: "model-id", ... }, ...] }
		const body = response.data;
		if (
			typeof body === "object" &&
			body !== null &&
			Array.isArray(body.data)
		) {
			return body.data
				.filter(
					(model: unknown): model is { id: string } =>
						typeof model === "object" &&
						model !== null &&
						typeof (model as Record<string, unknown>).id === "string",
				)
				.map((model: { id: string }) => model.id);
		}
		return [];
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
