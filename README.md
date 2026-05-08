# pi-yandex-bridge

Pi Coding Agent provider bridge for Yandex Cloud AI (YandexGPT).

## Models

| Model             | Context | Max output |
| ----------------- | ------- | ---------- |
| YandexGPT Pro 5.1 | 128k    | 8k         |
| YandexGPT Pro     | 128k    | 8k         |
| YandexGPT Lite    | 32k     | 4k         |

Unknown models discovered via the API are displayed as `slug {last4ofFolderId}`.

## Auth: OAuth (default)

### 1. Find your Yandex Cloud folder ID

In the [Yandex Cloud console](https://console.yandex.cloud), select your folder. The ID is shown in the URL and on the folder overview page (looks like `b1gk28...`).

### 2. Log in

Run `/yalogin` in Pi. A browser window will open automatically — authorize the app, and the token is captured without any pasting. Pi then prompts for your folder ID.

**IAM tokens expire after 12 hours** and are refreshed automatically using the stored OAuth token.

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

You can generate an API key in the Yandex Cloud console under **Service accounts → your account → API keys**. The key is shown only once, so copy it immediately.

Env vars also work for OAuth to skip interactive prompts:

```sh
export YANDEX_OAUTH_TOKEN="y0_AgAAAA..."
export YANDEX_FOLDER_ID="b1g..."
```
