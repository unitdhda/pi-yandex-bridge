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
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI): Promise<void>;
//# sourceMappingURL=index.d.ts.map