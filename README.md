# pi-yandex-bridge

Pi Coding Agent provider bridge for Yandex Cloud AI (YandexGPT).

## Models

All models available in your Yandex Cloud folder are fetched dynamically after authentication. Supported models include:
- **YandexGPT** (Pro 5.1, Pro 5, Lite) — with chain-of-thought reasoning
- **DeepSeek V3.2** — with thinking mode
- **Qwen3 series** (235B, 3.5-35B, 3.6-35B) — with reasoning
- **GPT-OSS** (120B, 20B) — with reasoning capability
- Other models like Alice AI LLM, Gemma 3, embedding models, and speech models

## Installation

Install from npm:

```sh
npm install pi-yandex-bridge
```

Or add directly to `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["pi-yandex-bridge"]
}
```

Then restart Pi and run `/yalogin`.

## Auth: OAuth (default)

### 1. Find your Yandex Cloud folder ID

In the [Yandex Cloud console](https://console.yandex.cloud), select your folder. The ID is shown in the URL and on the folder overview page (looks like `b1gk28...`).

### 2. Log in

Run `/yalogin` in Pi. A browser window opens automatically — authorize the app, and the token is captured without any pasting. Pi then prompts for your folder ID. Available models are fetched immediately after login.

**IAM tokens expire after 12 hours** and are refreshed automatically using the stored OAuth token. The model list is re-fetched on each refresh.

To skip the browser flow, set env vars before starting Pi:

```sh
export YANDEX_OAUTH_TOKEN="y0_AgAAAA..."
export YANDEX_FOLDER_ID="b1g..."
```

## Auth: Static API key

Set both env vars before starting Pi — no `auth.json` entry needed:

```sh
export YANDEX_API_KEY="your-api-key"
export YANDEX_FOLDER_ID="your-folder-id"
```

Models are fetched at startup using the API key. You can generate an API key in the [Yandex AI Studio](https://aistudio.yandex.ru) or in the Yandex Cloud console under **Service accounts → your account → API keys**.

## Development & Testing

### Run tests

```sh
bun test
```

Tests cover:
- Model ID parsing from Yandex API response
- OAuth → IAM token exchange
- Header construction (Bearer tokens vs. API keys)
- Error handling and timeouts
- Model entry structure validation

### Manual API verification

Before releasing, verify that the Yandex API is accessible and models are being fetched correctly:

```sh
# OAuth flow
YANDEX_OAUTH_TOKEN="<token>" YANDEX_FOLDER_ID="<id>" bun run verify.ts

# API key flow
YANDEX_API_KEY="<key>" YANDEX_FOLDER_ID="<id>" bun run verify.ts
```

The verification script:
1. Tests IAM token exchange (OAuth only)
2. Fetches the list of available models
3. Tests connectivity to the model API endpoint
4. Reports any 404 errors or misconfiguration

### Build

```sh
bun run build
```

Outputs to `dist/index.js`.
