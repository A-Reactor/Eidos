# Security and data

[简体中文](SECURITY.md)

## Report a security issue

Use the public repository's **Security → Advisories → Report a vulnerability** entry to submit a private report. Include the affected version, reproduction steps, and impact. If private reporting is unavailable, open an issue requesting a private contact channel and share the details through that channel. Remove keys, saves, and personal data from public issues, screenshots, and reproduction files. [GitHub private reporting guide](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately)

The maintainer usually reviews reports once a week. An initial reply may arrive at the next review. Fix timing depends on impact and how reliably the issue can be reproduced.

## Local use

The web app listens on `127.0.0.1` by default. Keep the app API local because it can access media, files, and voice services. To connect a game over the network, forward only the Bearer-protected `/api/engine/v1/narrate` endpoint and keep its token on a trusted server. [HTTP narration endpoint](eidos/docs/developer-engine.en.md#http-narration-endpoint)

World mod interfaces run in sandboxed iframes. App-wide global plugins have broader browser permissions, so review their source before enabling them. Native Tauri permissions will be verified separately before a desktop release. [Global plugins](eidos/docs/modding.en.md#extend-the-application)

See the AI setup guide for credential storage, what requests send to providers, and what exports can include. [Data and keys](eidos/docs/ai-configuration.en.md#data-and-keys)
