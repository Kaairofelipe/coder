import type { FileTree } from "utils/filetree";
import type { BuildOutput, BuildResult } from "./tools";

vi.mock("ai", () => ({
	tool: (definition: unknown) => definition,
}));

// Import AFTER the mock is set up.
// biome-ignore lint/correctness/noUndeclaredVariables: hoisted vi.mock
const { createTemplateAgentTools } = await import("./tools");

type ToolSet = ReturnType<typeof createTemplateAgentTools>;

const makeTools = (overrides: Record<string, unknown> = {}): ToolSet => {
	const fileTree: FileTree = { "main.tf": 'resource "null" {}' };
	return createTemplateAgentTools(() => fileTree, () => {}, overrides);
};

// The execute methods have a second arg for tool context. We use a
// minimal stub that satisfies the type at runtime.
const toolContext = {} as Parameters<ToolSet["buildTemplate"]["execute"]>[1];

describe("buildTemplate tool", () => {
	it("returns error when onBuildRequested callback is not provided", async () => {
		const tools = makeTools({ waitForBuildComplete: vi.fn() });
		const result = await tools.buildTemplate.execute({}, toolContext);
		expect(result).toEqual({ error: "Build tools are not available." });
	});

	it("returns error when waitForBuildComplete callback is not provided", async () => {
		const tools = makeTools({ onBuildRequested: vi.fn() });
		const result = await tools.buildTemplate.execute({}, toolContext);
		expect(result).toEqual({ error: "Build tools are not available." });
	});

	it("returns failed status when onBuildRequested throws", async () => {
		const tools = makeTools({
			onBuildRequested: vi.fn().mockRejectedValue(new Error("Upload failed")),
			waitForBuildComplete: vi.fn(),
		});
		const result = await tools.buildTemplate.execute({}, toolContext);
		expect(result).toMatchObject({
			status: "failed",
			error: "Upload failed",
		});
	});

	it("calls onBuildRequested then waits for build completion", async () => {
		const buildResult: BuildResult = {
			status: "succeeded",
			logs: "[info] Plan: done",
		};
		const onBuildRequested = vi.fn().mockResolvedValue(undefined);
		const waitForBuildComplete = vi.fn().mockResolvedValue(buildResult);
		const tools = makeTools({ onBuildRequested, waitForBuildComplete });

		const result = await tools.buildTemplate.execute({}, toolContext);

		expect(onBuildRequested).toHaveBeenCalledOnce();
		expect(waitForBuildComplete).toHaveBeenCalledOnce();
		expect(result).toEqual(buildResult);
	});

	it("returns timeout when build exceeds time limit", async () => {
		vi.useFakeTimers();
		try {
			const neverResolves = new Promise<BuildResult>(() => {});
			const tools = makeTools({
				onBuildRequested: vi.fn().mockResolvedValue(undefined),
				waitForBuildComplete: vi.fn().mockReturnValue(neverResolves),
			});

			const resultPromise = tools.buildTemplate.execute({}, toolContext);
			await vi.advanceTimersByTimeAsync(180_000);
			const result = await resultPromise;

			expect(result).toMatchObject({ status: "timeout" });
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("getBuildLogs tool", () => {
	it("returns error when getBuildOutput callback is not provided", async () => {
		const tools = makeTools();
		const result = await tools.getBuildLogs.execute({}, toolContext);
		expect(result).toEqual({ error: "Build tools are not available." });
	});

	it("returns no-build status when getBuildOutput returns undefined", async () => {
		const tools = makeTools({
			getBuildOutput: vi.fn().mockReturnValue(undefined),
		});
		const result = await tools.getBuildLogs.execute({}, toolContext);
		expect(result).toMatchObject({ status: "none" });
	});

	it("returns current build output when available", async () => {
		const output: BuildOutput = {
			status: "failed",
			error: "missing provider",
			logs: "[error] Plan: missing provider",
		};
		const tools = makeTools({
			getBuildOutput: vi.fn().mockReturnValue(output),
		});
		const result = await tools.getBuildLogs.execute({}, toolContext);
		expect(result).toEqual(output);
	});
});
