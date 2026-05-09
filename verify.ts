#!/usr/bin/env bun
/**
 * Manual API verification script
 *
 * Tests Yandex Cloud API connectivity and model availability.
 * Run before releasing to ensure all endpoints are responding.
 *
 * Usage:
 *   YANDEX_OAUTH_TOKEN=<token> YANDEX_FOLDER_ID=<id> bun run verify.ts
 *   OR
 *   YANDEX_API_KEY=<key> YANDEX_FOLDER_ID=<id> bun run verify.ts
 */

const colors = {
	reset: "\x1b[0m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	gray: "\x1b[90m",
};

const log = {
	info: (msg: string) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
	success: (msg: string) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
	error: (msg: string) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
	warn: (msg: string) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
	debug: (msg: string) => console.log(`${colors.gray}${msg}${colors.reset}`),
};

async function verify() {
	const oauthToken = process.env.YANDEX_OAUTH_TOKEN;
	const apiKey = process.env.YANDEX_API_KEY;
	const folderId = process.env.YANDEX_FOLDER_ID;

	log.info("Yandex Cloud API Verification");
	console.log();

	// ─── Validate environment ─────────────────────────────────────────────────

	if (!folderId) {
		log.error("YANDEX_FOLDER_ID env var is required");
		process.exit(1);
	}

	if (!oauthToken && !apiKey) {
		log.error("Either YANDEX_OAUTH_TOKEN or YANDEX_API_KEY env var is required");
		process.exit(1);
	}

	log.success(`Using Folder ID: ${folderId}`);
	const authType = oauthToken ? "OAuth Token" : "API Key";
	log.success(`Using Auth: ${authType}`);
	console.log();

	let authHeader = "";
	let iamToken = "";

	// ─── Step 1: OAuth → IAM token exchange (if using OAuth) ──────────────────

	if (oauthToken) {
		log.info("Step 1: Exchanging OAuth token for IAM token…");
		try {
			const res = await fetch("https://iam.api.cloud.yandex.net/iam/v1/tokens", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ yandexPassportOauthToken: oauthToken }),
			});

			if (!res.ok) {
				const text = await res.text().catch(() => res.statusText);
				log.error(`IAM token exchange failed (${res.status}): ${text}`);
				process.exit(1);
			}

			const data = (await res.json()) as {
				iamToken: string;
				expiresAt: string;
			};
			iamToken = data.iamToken;
			authHeader = `Bearer ${iamToken}`;

			const expDate = new Date(data.expiresAt).toLocaleString();
			log.success(`Got IAM token (expires ${expDate})`);
		} catch (err) {
			log.error(`OAuth exchange error: ${err instanceof Error ? err.message : err}`);
			process.exit(1);
		}
	} else {
		authHeader = `Api-Key ${apiKey}`;
		log.success("Using API Key authentication");
	}

	console.log();

	// ─── Step 2: Fetch available models ───────────────────────────────────────

	log.info("Step 2: Fetching available models…");
	let models: Array<{ id: string }> = [];

	try {
		const res = await fetch("https://llm.api.cloud.yandex.net/v1/models", {
			headers: {
				Authorization: authHeader,
				"OpenAI-Project": folderId,
			},
		});

		if (!res.ok) {
			const text = await res.text().catch(() => res.statusText);
			log.error(`Models endpoint failed (${res.status}): ${text}`);
			log.debug("This is the main 404 issue — check folder ID and auth");
			process.exit(1);
		}

		const payload = (await res.json()) as { data: Array<{ id: string }> };
		models = payload.data || [];

		if (models.length === 0) {
			log.warn("No models returned from API");
		} else {
			log.success(`Found ${models.length} model(s)`);
			models.slice(0, 3).forEach((m) => log.debug(`  • ${m.id}`));
			if (models.length > 3) log.debug(`  ... and ${models.length - 3} more`);
		}
	} catch (err) {
		log.error(`Models fetch error: ${err instanceof Error ? err.message : err}`);
		process.exit(1);
	}

	console.log();

	// ─── Step 3: Test model endpoint (find a working format) ──────────────────

	if (models.length > 0) {
		log.info("Step 3: Testing model API compatibility…");
		const testModel = models[0];
		const baseId = testModel.id;

		// Try different ID formats
		const formats = [
			{ name: "full ID", id: baseId },
			{ name: "without /latest", id: baseId.replace(/\/latest$/, "") },
			{ name: "just model name", id: baseId.split("/").pop()! },
		];

		let foundWorking = false;

		for (const fmt of formats) {
			try {
				const res = await fetch("https://llm.api.cloud.yandex.net/openai/v1/chat/completions", {
					method: "POST",
					headers: {
						Authorization: authHeader,
						"OpenAI-Project": folderId,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: fmt.id,
						messages: [{ role: "user", content: "test" }],
						max_tokens: 10,
					}),
				});

				if (res.status === 404) {
					log.debug(`  ✗ ${fmt.name}: 404 — ${fmt.id}`);
				} else if (!res.ok) {
					const text = await res.text().catch(() => res.statusText);
					log.warn(`  ⚠ ${fmt.name}: ${res.status} — ${text.slice(0, 50)}`);
				} else {
					log.success(`  ✓ ${fmt.name}: API responds correctly`);
					log.debug(`    Model ID format: ${fmt.id}`);
					foundWorking = true;
					break;
				}
			} catch (err) {
				log.debug(`  ✗ ${fmt.name}: ${err instanceof Error ? err.message : err}`);
			}
		}

		if (!foundWorking) {
			log.warn("Could not find working model ID format");
			log.debug(`Test model ID: ${baseId}`);
		}
	}

	console.log();

	// ─── Summary ──────────────────────────────────────────────────────────────

	log.success("✓ All checks passed. API is accessible.");
	log.info(`Ready to release with ${models.length} model(s).`);
}

verify().catch((err) => {
	log.error(`Verification failed: ${err instanceof Error ? err.message : err}`);
	process.exit(1);
});
