import { API } from "api/api";
import type { AIBridgeListInterceptionsResponse } from "api/typesGenerated";
import { useFilterParamsKey } from "components/Filter/Filter";
import type { UsePaginatedQueryOptions } from "hooks/usePaginatedQuery";
import type { UseQueryOptions } from "react-query";

/**
 * Query options for checking whether the AI bridge is configured
 * and reachable. Returns true/false — never throws.
 */
export const aiBridgeAvailable = (): UseQueryOptions<boolean> => ({
	queryKey: ["aiBridgeAvailable"],
	queryFn: async () => {
		const response = await API.getAxiosInstance().get(
			"/api/v2/aibridge/openai/v1/models",
			{ validateStatus: () => true },
		);
		return response.status >= 200 && response.status < 300;
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
