# pi-yandex-bridge

Pi Coding Agent provider bridge for Yandex Cloud AI (YandexGPT).

## Models

All models available in your Yandex Cloud folder are fetched dynamically after authentication. Model names are displayed as `name{folder_last5/tag}` — e.g. `yandexgpt-5.1{cffev/l}`.

## Installation

Add to `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["/path/to/pi-yandex-bridge/dist/index.js"]
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
