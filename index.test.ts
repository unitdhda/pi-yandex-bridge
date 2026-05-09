import { describe, it, expect, mock } from "bun:test";

interface MockResponse {
	ok: boolean;
	status: number;
	json: () => Promise<unknown>;
	text: () => Promise<string>;
}

describe("pi-yandex-bridge", () => {
	describe("fetchModelIds", () => {
		it("should parse Yandex models endpoint response", async () => {
			const mockResponse: MockResponse = {
				ok: true,
				status: 200,
				json: async () => ({
					data: [
						{ id: "gpt://b1g123/yandexgpt" },
						{ id: "gpt://b1g123/yandexgpt-lite" },
					],
				}),
				text: async () => "{}",
			};

			global.fetch = mock(async () => mockResponse) as typeof fetch;

			const { fetchModelIds } = await import("./index.ts");
			const result = await fetchModelIds("b1g123", "Bearer token123");

			expect(result).toEqual([
				"gpt://b1g123/yandexgpt",
				"gpt://b1g123/yandexgpt-lite",
			]);
		});

		it("should return empty array on API error", async () => {
			const mockResponse: MockResponse = {
				ok: false,
				status: 404,
				json: async () => ({}),
				text: async () => "Not Found",
			};

			global.fetch = mock(async () => mockResponse) as typeof fetch;

			const { fetchModelIds } = await import("./index.ts");
			const result = await fetchModelIds("b1g123", "Bearer token123");

			expect(result).toEqual([]);
		});

		it("should send correct headers for OAuth Bearer token", async () => {
			let capturedHeaders: Record<string, string> = {};
			const mockResponse: MockResponse = {
				ok: true,
				status: 200,
				json: async () => ({ data: [] }),
				text: async () => "{}",
			};

			global.fetch = mock(async (_url: string, opts?: RequestInit) => {
				if (opts?.headers) {
					capturedHeaders = opts.headers as Record<string, string>;
				}
				return mockResponse;
			}) as typeof fetch;

			const { fetchModelIds } = await import("./index.ts");
			await fetchModelIds("b1g123", "Bearer token123");

			expect(capturedHeaders.Authorization).toBe("Bearer token123");
			expect(capturedHeaders["OpenAI-Project"]).toBe("b1g123");
		});

		it("should send correct headers for API Key", async () => {
			let capturedHeaders: Record<string, string> = {};
			const mockResponse: MockResponse = {
				ok: true,
				status: 200,
				json: async () => ({ data: [] }),
				text: async () => "{}",
			};

			global.fetch = mock(async (_url: string, opts?: RequestInit) => {
				if (opts?.headers) {
					capturedHeaders = opts.headers as Record<string, string>;
				}
				return mockResponse;
			}) as typeof fetch;

			const { fetchModelIds } = await import("./index.ts");
			await fetchModelIds("b1g123", "Api-Key apikey123");

			expect(capturedHeaders.Authorization).toBe("Api-Key apikey123");
			expect(capturedHeaders["OpenAI-Project"]).toBe("b1g123");
		});

		it("should call correct endpoint", async () => {
			let capturedUrl: string = "";
			const mockResponse: MockResponse = {
				ok: true,
				status: 200,
				json: async () => ({ data: [] }),
				text: async () => "{}",
			};

			global.fetch = mock(async (url: string) => {
				capturedUrl = url;
				return mockResponse;
			}) as typeof fetch;

			const { fetchModelIds } = await import("./index.ts");
			await fetchModelIds("b1g123", "Bearer token");

			expect(capturedUrl).toContain("llm.api.cloud.yandex.net");
			expect(capturedUrl).toContain("/models");
		});
	});

	describe("modelEntry", () => {
		it("should create model entry with correct structure", async () => {
			const { modelEntry } = await import("./index.ts");
			const entry = modelEntry("gpt://b1g123/yandexgpt", "b1g123");

			expect(entry.id).toBe("gpt://b1g123/yandexgpt");
			expect(entry.name).toBe("gpt://b1g123/yandexgpt");
			expect(entry.api).toBe("openai-responses");
			expect(entry.provider).toBe("yandex");
			expect(entry.baseUrl).toContain("ai.api.cloud.yandex.net");
			expect(entry.headers["OpenAI-Project"]).toBe("b1g123");
		});

		it("should set correct context window", async () => {
			const { modelEntry } = await import("./index.ts");
			const entry = modelEntry("gpt://b1g123/yandexgpt", "b1g123");

			expect(entry.contextWindow).toBe(128000);
			expect(entry.maxTokens).toBe(8192);
		});

		it("should disable unsupported features", async () => {
			const { modelEntry } = await import("./index.ts");
			const entry = modelEntry("gpt://b1g123/yandexgpt", "b1g123");

			expect(entry.reasoning).toBe(true);
			expect(entry.compat.supportsReasoningEffort).toBe(false);
			expect(entry.compat.supportsDeveloperRole).toBe(false);
		});

		it("should set free cost model", async () => {
			const { modelEntry } = await import("./index.ts");
			const entry = modelEntry("gpt://b1g123/yandexgpt", "b1g123");

			expect(entry.cost).toEqual({
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			});
		});
	});

	describe("exchangeOAuthForIam", () => {
		it("should exchange OAuth token for IAM token", async () => {
			const mockResponse: MockResponse = {
				ok: true,
				status: 200,
				json: async () => ({
					iamToken: "iam_token_xyz",
					expiresAt: "2026-05-10T15:00:00Z",
				}),
				text: async () => "{}",
			};

			global.fetch = mock(async () => mockResponse) as typeof fetch;

			const { exchangeOAuthForIam } = await import("./index.ts");
			const result = await exchangeOAuthForIam("oauth_token_abc");

			expect(result.token).toBe("iam_token_xyz");
			expect(typeof result.expiresAt).toBe("number");
			expect(result.expiresAt).toBeGreaterThan(0);
		});

		it("should throw on failed token exchange", async () => {
			const mockResponse: MockResponse = {
				ok: false,
				status: 401,
				json: async () => ({}),
				text: async () => "Unauthorized",
			};

			global.fetch = mock(async () => mockResponse) as typeof fetch;

			const { exchangeOAuthForIam } = await import("./index.ts");

			try {
				await exchangeOAuthForIam("bad_token");
				expect.unreachable();
			} catch (err) {
				expect(err instanceof Error).toBe(true);
				expect((err as Error).message).toContain("IAM token exchange failed");
			}
		});

		it("should send OAuth token in correct format", async () => {
			let capturedBody: unknown;
			const mockResponse: MockResponse = {
				ok: true,
				status: 200,
				json: async () => ({
					iamToken: "iam_token",
					expiresAt: "2026-05-10T15:00:00Z",
				}),
				text: async () => "{}",
			};

			global.fetch = mock(async (_url: string, opts?: RequestInit) => {
				if (opts?.body) {
					capturedBody = JSON.parse(opts.body as string);
				}
				return mockResponse;
			}) as typeof fetch;

			const { exchangeOAuthForIam } = await import("./index.ts");
			await exchangeOAuthForIam("my_oauth_token");

			expect(capturedBody).toEqual({
				yandexPassportOauthToken: "my_oauth_token",
			});
		});
	});

	describe("reasoning mode detection", () => {
		it("should enable reasoning for YandexGPT models", async () => {
			const { modelEntry } = await import("./index.ts");
			const entry = modelEntry("gpt://b1g123/yandexgpt-5-pro/latest", "b1g123");
			expect(entry.reasoning).toBe(true);
		});

		it("should enable reasoning for DeepSeek v3.2", async () => {
			const { modelEntry } = await import("./index.ts");
			const entry = modelEntry("gpt://b1g123/deepseek-v32/latest", "b1g123");
			expect(entry.reasoning).toBe(true);
		});

		it("should enable reasoning for Qwen3 models", async () => {
			const { modelEntry } = await import("./index.ts");
			const entry = modelEntry(
				"gpt://b1g123/qwen3-235b-a22b-fp8/latest",
				"b1g123",
			);
			expect(entry.reasoning).toBe(true);
		});

		it("should enable reasoning for GPT-OSS models", async () => {
			const { modelEntry } = await import("./index.ts");
			const entry = modelEntry("gpt://b1g123/gpt-oss-120b/latest", "b1g123");
			expect(entry.reasoning).toBe(true);
		});

		it("should disable reasoning for models without reasoning support", async () => {
			const { modelEntry } = await import("./index.ts");
			const entry = modelEntry("gpt://b1g123/aliceai-llm/latest", "b1g123");
			expect(entry.reasoning).toBe(false);
		});

		it("should disable reasoning for embedding models", async () => {
			const { modelEntry } = await import("./index.ts");
			const entry = modelEntry("emb://b1g123/text-embeddings/latest", "b1g123");
			expect(entry.reasoning).toBe(false);
		});
	});
});
