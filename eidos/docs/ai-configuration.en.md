# AI setup

[简体中文](ai-configuration.md)

## Text models

In **Settings → AI Access**, choose a provider and enter the API key or local service URL it requires. Save your settings before starting an action or creating a world. Eidos uses ALICE for narration, KEI for world creation and review, and UZQ for character reasoning. The three roles can share one provider. Open the advanced settings to configure them individually.

| Provider | What to enter |
| --- | --- |
| DeepSeek, OpenAI, Anthropic, Gemini, or OpenRouter | Use the preset endpoint and a key from your provider. Keep the suggested model or select one your account can access. |
| Ollama | Use `http://127.0.0.1:11434/v1` for a default local server. Enter the full model ID from `ollama list`, including the tag. A local server usually needs no key. |
| LM Studio | Load a model and start the local server, then use `http://127.0.0.1:1234/v1` with the model ID shown there. Enter a key if authentication is enabled. |
| Custom compatible service | Enter the base endpoint, model ID, and any key required by the service. Choose the OpenAI-compatible or Anthropic-compatible preset that matches its protocol. |

The base endpoint ends before `/chat/completions` or `/messages`. The Eidos backend connects to that address, so a loopback address refers to the machine running Eidos. **Test connection** checks all three roles and may count toward provider usage. For DeepSeek, you can create a key from its developer platform. [DeepSeek API keys](https://platform.deepseek.com/api_keys)

Cloud AI services can bill for model usage. **Settings → Display → Narrative language** sets the language for future AI narration independently of the interface language. Existing story text keeps its original language.

The developer HTTP endpoint uses server environment variables for its model connection. [HTTP narration endpoint](developer-engine.en.md#http-narration-endpoint)

## Voice and configuration files

Voice has its own settings. A compatible voice provider receives speech requests at `/audio/speech`. Enter its base endpoint, model ID, voice ID, and any required key. **Generate preview** calls the selected service.

Under **AI Access**, you can export `eidos-ai-config.json` to share provider, endpoint, model, reasoning, and generation settings. The file omits keys. Importing fills a settings draft that you can inspect before saving. A changed provider or endpoint requires its own credentials.

## Data and keys

- The browser stores text model settings and keys in local storage for the current address. Compatible voice keys stay in session storage. Server keys can go in `eidos/.env.local`.
- Each request sends the world, characters, story, and input needed for that task to the selected provider. Attachments, images, or voice samples can be sent when selected for a corresponding request. Search and voice use their own configured services.
- Eidos stores model usage and runtime statistics locally. Diagnostic exports can include them. World archives can contain private setting details and player actions, so review them before sharing.
- Export any worlds you want to keep before clearing browser site data. Site data includes local settings and saves. Server media and data held by your AI provider are managed separately.

[Security and data](../../SECURITY.en.md) · [English home](../../README.en.md)
