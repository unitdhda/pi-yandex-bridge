/**
 * Pi Coding Agent — Yandex Provider Bridge
 *
 * Auth (OAuth — default):
 *   Run /yalogin to authorize. A browser window opens automatically,
 *   the token is captured via a local callback server on port 7890.
 *
 *   YANDEX_OAUTH_TOKEN env var skips the browser flow entirely.
 *   YANDEX_FOLDER_ID   env var skips the folder ID prompt.
 *
 * Auth (static API key — opt-in):
 *   Set both YANDEX_API_KEY and YANDEX_FOLDER_ID env vars.
 */

import { createServer } from "http";
import { readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import type { AddressInfo } from "net";

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ProviderConfig,
} from "@earendil-works/pi-coding-agent";
import type {
	OAuthCredentials,
	OAuthLoginCallbacks,
} from "@earendil-works/pi-ai";

// ─── constants ────────────────────────────────────────────────────────────────

const IAM_TOKEN_URL = "https://iam.api.cloud.yandex.net/iam/v1/tokens";
const AI_FETCH_URL = "https://llm.api.cloud.yandex.net/v1";
const AI_BASE_URL = "https://ai.api.cloud.yandex.net/v1";
const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");

const OAUTH_CLIENT_ID = "0414b7213b22435fa65051f64270584f";
const OAUTH_CALLBACK_PORT = 7890;
const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}/callback`;
const OAUTH_URL =
	`https://oauth.yandex.ru/authorize?response_type=token` +
	`&client_id=${OAUTH_CLIENT_ID}` +
	`&redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}`;

// ─── helpers ──────────────────────────────────────────────────────────────────

interface IamTokenResponse {
	iamToken: string;
	expiresAt: string;
}

function modelEntry(id: string, folderId: string) {
	return {
		id,
		name: id,
		api: "openai-responses" as const,
		provider: "yandex",
		baseUrl: AI_BASE_URL,
		reasoning: true,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 8_192,
		headers: { "OpenAI-Project": folderId },
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens" as const,
		},
	};
}

function openBrowser(url: string) {
	const cmd =
		process.platform === "win32"
			? "start"
			: process.platform === "darwin"
				? "open"
				: "xdg-open";
	spawnSync(cmd, [url], { stdio: "ignore" });
}

async function exchangeOAuthForIam(
	oauthToken: string,
): Promise<{ token: string; expiresAt: number }> {
	const res = await fetch(IAM_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ yandexPassportOauthToken: oauthToken }),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => res.statusText);
		throw new Error(`IAM token exchange failed (${res.status}): ${text}`);
	}
	const data = (await res.json()) as IamTokenResponse;
	return {
		token: data.iamToken,
		expiresAt: new Date(data.expiresAt).getTime(),
	};
}

// authHeader: 'Bearer <iam_token>' for OAuth, 'Api-Key <api_key>' for static key
async function fetchModelIds(
	folderId: string,
	authHeader: string,
): Promise<string[]> {
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), 5_000);
	try {
		const res = await fetch(`${AI_FETCH_URL}/models`, {
			headers: {
				Authorization: authHeader,
				"OpenAI-Project": folderId,
			},
			signal: ac.signal,
		});
		clearTimeout(timer);
		if (!res.ok) return [];
		const payload = (await res.json()) as { data: Array<{ id: string }> };
		return payload.data.map((m) => m.id);
	} catch {
		clearTimeout(timer);
		return [];
	}
}

function readAuthJson(): Record<string, unknown> {
	try {
		return JSON.parse(readFileSync(AUTH_PATH, "utf8")) as Record<
			string,
			unknown
		>;
	} catch {
		return {};
	}
}

function writeAuthJson(data: Record<string, unknown>) {
	writeFileSync(AUTH_PATH, JSON.stringify(data, null, 2), "utf8");
}

// ─── OAuth local callback server ──────────────────────────────────────────────

const CALLBACK_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>pi-yandex-bridge</title></head>
<body style="font-family:sans-serif;padding:2rem">
<p>Authorizing pi-yandex-bridge…</p>
<script>
const p = new URLSearchParams(location.hash.slice(1));
const t = p.get('access_token');
if (t) {
  fetch('/token', { method: 'POST', body: t })
    .then(() => { document.body.innerHTML = '<p>✓ Authorized. You can close this tab.</p>'; });
} else {
  document.body.innerHTML = '<p>Error: no access_token in response.</p>';
}
</script>
</body></html>`;

function captureOAuthToken(): Promise<string> {
	return new Promise((resolve, reject) => {
		const server = createServer((req, res) => {
			if (req.url?.startsWith("/callback")) {
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(CALLBACK_HTML);
			} else if (req.url === "/token" && req.method === "POST") {
				let body = "";
				req.on("data", (chunk) => (body += chunk));
				req.on("end", () => {
					res.writeHead(200);
					res.end();
					server.close();
					resolve(body.trim());
				});
			} else {
				res.writeHead(404);
				res.end();
			}
		});

		server.on("error", (err: NodeJS.ErrnoException) => {
			if (err.code === "EADDRINUSE") {
				reject(new Error(`Port ${OAUTH_CALLBACK_PORT} is already in use.`));
			} else {
				reject(new Error(`Local auth server error: ${err.message}`));
			}
		});

		const timeout = setTimeout(
			() => {
				server.close();
				reject(new Error("OAuth authorization timed out after 5 minutes."));
			},
			5 * 60 * 1000,
		);

		server.listen(OAUTH_CALLBACK_PORT, "127.0.0.1", () => {
			void (server.address() as AddressInfo).port;
			openBrowser(OAUTH_URL);
		});

		server.on("close", () => clearTimeout(timeout));
	});
}

// ─── OAuth provider callbacks ─────────────────────────────────────────────────

async function yandexLogin(
	callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
	let oauthToken = process.env.YANDEX_OAUTH_TOKEN ?? "";
	if (!oauthToken) {
		callbacks.onAuth({ url: OAUTH_URL });
		oauthToken = await captureOAuthToken();
	}

	let folderId = process.env.YANDEX_FOLDER_ID ?? "";
	if (!folderId) {
		folderId = await callbacks.onPrompt({
			message: "Enter your Yandex Cloud folder ID:",
			placeholder: "b1g...",
		});
	}

	const iam = await exchangeOAuthForIam(oauthToken);

	// Fetch available models while we have fresh credentials.
	const modelIds = await fetchModelIds(
		folderId as string,
		`Bearer ${iam.token}`,
	);

	return {
		refresh: oauthToken,
		access: iam.token,
		expires: iam.expiresAt,
		folderId: folderId as string,
		// Store fetched model IDs so modifyModels can stay synchronous.
		modelIds: JSON.stringify(modelIds),
	};
}

async function yandexRefreshToken(
	credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
	const iam = await exchangeOAuthForIam(credentials.refresh);
	// Re-fetch models on token refresh to pick up any new models.
	const modelIds = await fetchModelIds(
		credentials.folderId as string,
		`Bearer ${iam.token}`,
	);
	return {
		...credentials,
		access: iam.token,
		expires: iam.expiresAt,
		modelIds: JSON.stringify(modelIds),
	};
}

// ─── /yalogin command ─────────────────────────────────────────────────────────

async function runYaLogin(ctx: ExtensionCommandContext) {
	try {
		ctx.ui.notify("Opening browser for Yandex authorization…", "info");
		const oauthToken = await captureOAuthToken();

		let folderId = process.env.YANDEX_FOLDER_ID ?? "";
		if (!folderId) {
			folderId = (await ctx.ui.input("Yandex Cloud folder ID", "b1g...")) ?? "";
		}

		if (!folderId) {
			ctx.ui.notify("Login cancelled: folder ID is required.", "error");
			return;
		}

		ctx.ui.notify("Exchanging OAuth token for IAM token…", "info");
		const iam = await exchangeOAuthForIam(oauthToken);

		ctx.ui.notify("Fetching available models…", "info");
		const modelIds = await fetchModelIds(folderId, `Bearer ${iam.token}`);

		const auth = readAuthJson();
		auth.yandex = {
			type: "oauth",
			refresh: oauthToken,
			access: iam.token,
			expires: iam.expiresAt,
			folderId,
			modelIds: JSON.stringify(modelIds),
		};
		writeAuthJson(auth);

		ctx.ui.notify(
			`✓ Yandex credentials saved (${modelIds.length} models). Restart Pi to activate.`,
			"info",
		);
	} catch (err) {
		ctx.ui.notify(
			`Yandex login failed: ${err instanceof Error ? err.message : String(err)}`,
			"error",
		);
	}
}

// ─── extension entry point ────────────────────────────────────────────────────

// Export for testing
export { fetchModelIds, modelEntry, exchangeOAuthForIam };
export default async function (pi: ExtensionAPI) {
	const apiKey = process.env.YANDEX_API_KEY;
	const folderId = process.env.YANDEX_FOLDER_ID;

	if (apiKey && folderId) {
		// Static API key — fetch models immediately, we have credentials.
		const modelIds = await fetchModelIds(folderId, `Api-Key ${apiKey}`);
		pi.registerProvider("yandex", {
			name: "Yandex Cloud",
			baseUrl: AI_BASE_URL,
			apiKey,
			api: "openai-responses",
			models: modelIds.map((id) => modelEntry(id, folderId)),
		} satisfies ProviderConfig);
	} else {
		// OAuth path — seed from auth.json if credentials are already stored.
		let seedModels: ReturnType<typeof modelEntry>[] = [];
		try {
			const auth = readAuthJson() as Record<
				string,
				{
					folderId?: string;
					modelIds?: string;
				}
			>;
			const stored = auth.yandex;
			if (stored?.folderId && stored?.modelIds) {
				const ids = JSON.parse(stored.modelIds) as string[];
				seedModels = ids.map((id) => modelEntry(id, stored.folderId!));
			}
		} catch {
			/* auth.json absent or unreadable */
		}

		pi.registerProvider("yandex", {
			name: "Yandex Cloud",
			baseUrl: AI_BASE_URL,
			api: "openai-responses",
			models: seedModels,
			oauth: {
				name: "Yandex Cloud (OAuth)",
				login: yandexLogin,
				refreshToken: yandexRefreshToken,
				getApiKey: (credentials) => credentials.access,
				modifyModels: (models, credentials) => {
					const fId = credentials.folderId as string;
					const ids: string[] = credentials.modelIds
						? (JSON.parse(credentials.modelIds as string) as string[])
						: [];
					return [
						...models.filter((m) => m.provider !== "yandex"),
						...ids.map((id) => modelEntry(id, fId)),
					];
				},
			},
		} satisfies ProviderConfig);
	}

	pi.registerCommand("yalogin", {
		description: "Authorize Yandex Cloud (opens browser, no pasting required)",
		handler: async (_args, ctx) => runYaLogin(ctx),
	});
}
