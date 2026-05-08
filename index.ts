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
const AI_BASE_URL = "https://ai.api.cloud.yandex.net/v1";
const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");

const OAUTH_CLIENT_ID = "0414b7213b22435fa65051f64270584f";
const OAUTH_CALLBACK_PORT = 7890;
const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}/callback`;
const OAUTH_URL =
	`https://oauth.yandex.ru/authorize?response_type=token` +
	`&client_id=${OAUTH_CLIENT_ID}` +
	`&redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}`;

// ─── model catalogue ──────────────────────────────────────────────────────────

const KNOWN_MODELS = [
	{
		slug: "yandexgpt-5.1",
		name: "YandexGPT Pro 5.1",
		contextWindow: 128_000,
		maxTokens: 8_192,
		cost: { input: 8.8, output: 8.8, cacheRead: 0, cacheWrite: 0 },
	},
	{
		slug: "yandexgpt",
		name: "YandexGPT Pro",
		contextWindow: 128_000,
		maxTokens: 8_192,
		cost: { input: 8.8, output: 8.8, cacheRead: 0, cacheWrite: 0 },
	},
	{
		slug: "yandexgpt-lite",
		name: "YandexGPT Lite",
		contextWindow: 32_000,
		maxTokens: 4_096,
		cost: { input: 2.2, output: 2.2, cacheRead: 0, cacheWrite: 0 },
	},
] as const;

// ─── helpers ──────────────────────────────────────────────────────────────────

interface IamTokenResponse {
	iamToken: string;
	expiresAt: string;
}

/** Turns `gpt://<folderId>/<slug>/latest` into a readable display name.
 *  Known slugs get their canonical name; unknown ones get `slug {last4ofFolderId}`. */
function prettyModelName(id: string): string {
	const match = id.match(/^gpt:\/\/([^/]+)\/(.+?)(?:\/latest)?$/);
	if (!match) return id;
	const [, folderId, slug] = match;
	const known = KNOWN_MODELS.find((m) => m.slug === slug);
	if (known) return known.name;
	return `${slug} {${folderId.slice(-4)}}`;
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

function buildModels(folderId: string) {
	return KNOWN_MODELS.map((m) => ({
		id: `gpt://${folderId}/${m.slug}/latest`,
		name: m.name,
		api: "openai-responses" as const,
		provider: "yandex",
		baseUrl: AI_BASE_URL,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: m.cost,
		contextWindow: m.contextWindow,
		maxTokens: m.maxTokens,
		headers: { "OpenAI-Project": folderId },
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens" as const,
		},
	}));
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

function captureOAuthToken(
	onProgress?: (msg: string) => void,
): Promise<string> {
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
				reject(
					new Error(
						`Port ${OAUTH_CALLBACK_PORT} is already in use. Stop the process using it and try again.`,
					),
				);
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
			onProgress?.(
				`[yandex] Listening on port ${(server.address() as AddressInfo).port}. Opening browser…`,
			);
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

	return {
		refresh: oauthToken,
		access: iam.token,
		expires: iam.expiresAt,
		folderId,
	};
}

async function yandexRefreshToken(
	credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
	const iam = await exchangeOAuthForIam(credentials.refresh);
	return { ...credentials, access: iam.token, expires: iam.expiresAt };
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

		const auth = readAuthJson();
		auth.yandex = {
			type: "oauth",
			refresh: oauthToken,
			access: iam.token,
			expires: iam.expiresAt,
			folderId,
		};
		writeAuthJson(auth);

		ctx.ui.notify(
			"✓ Yandex credentials saved. Restart Pi to activate the models.",
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

export default async function (pi: ExtensionAPI) {
	const apiKey = process.env.YANDEX_API_KEY;
	const folderId = process.env.YANDEX_FOLDER_ID;

	// Static API key path — both env vars must be present.
	if (apiKey && folderId) {
		const modelIds = new Set(
			KNOWN_MODELS.map((m) => `gpt://${folderId}/${m.slug}/latest`),
		);

		try {
			const ac = new AbortController();
			const timer = setTimeout(() => ac.abort(), 5_000);
			const res = await fetch(`${AI_BASE_URL}/models`, {
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"OpenAI-Project": folderId,
				},
				signal: ac.signal,
			});
			clearTimeout(timer);
			if (res.ok) {
				const payload = (await res.json()) as { data: Array<{ id: string }> };
				for (const { id } of payload.data) modelIds.add(id);
			}
		} catch {
			/* static list is enough */
		}

		const models = [...modelIds].map((id) => {
			const slug = id.replace(/^gpt:\/\/[^/]+\//, "").replace(/\/latest$/, "");
			const known = KNOWN_MODELS.find((m) => m.slug === slug);
			return {
				id,
				name: prettyModelName(id),
				reasoning: false,
				input: ["text"] as ("text" | "image")[],
				cost: known?.cost ?? {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				contextWindow: known?.contextWindow ?? 128_000,
				maxTokens: known?.maxTokens ?? 8_192,
				headers: { "OpenAI-Project": folderId },
				compat: {
					supportsDeveloperRole: false,
					supportsReasoningEffort: false,
					maxTokensField: "max_tokens" as const,
				},
			};
		});

		pi.registerProvider("yandex", {
			name: "Yandex Cloud",
			baseUrl: AI_BASE_URL,
			apiKey,
			api: "openai-responses",
			models,
		} satisfies ProviderConfig);
	} else {
		// OAuth path — seed models from auth.json if folderId is already stored.
		let storedFolderId: string | undefined;
		try {
			const auth = readAuthJson() as Record<string, { folderId?: string }>;
			storedFolderId = auth.yandex?.folderId;
		} catch {
			/* auth.json absent or unreadable */
		}

		pi.registerProvider("yandex", {
			name: "Yandex Cloud",
			baseUrl: AI_BASE_URL,
			api: "openai-responses",
			models: storedFolderId ? buildModels(storedFolderId) : [],
			oauth: {
				name: "Yandex Cloud (OAuth)",
				login: yandexLogin,
				refreshToken: yandexRefreshToken,
				getApiKey: (credentials) => credentials.access,
				modifyModels: (models, credentials) => [
					...models.filter((m) => m.provider !== "yandex"),
					...buildModels(credentials.folderId as string),
				],
			},
		} satisfies ProviderConfig);
	}

	pi.registerCommand("yalogin", {
		description: "Authorize Yandex Cloud (opens browser, no pasting required)",
		handler: async (_args, ctx) => runYaLogin(ctx),
	});
}
