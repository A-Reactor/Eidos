# Integrate Eidos into a game

[简体中文完整参考](developer-engine.md)

Eidos turns player input and the results of game rules into narrative. The host game owns rendering, input, simulation, and saves. Eidos can propose a command, then narrate what the host actually did.

## Install the SDK and run a demo

To build from source, use Node.js 22.12 or later, or Node.js 20.19 or later in the 20.x line. Run these commands from the repository root.

```bash
cd eidos
npm ci
npm run demo:engine
npm run demo:rpg
npm run pack:sdk
```

The demos use deterministic offline narration. The first runs a courtyard game with a lock, map traversal, and program results. The RPG demo covers inventory, rules, save recovery, and duplicate reports. You can also run `npm run dev:engine-game` and open [the courtyard in your browser](http://127.0.0.1:3031).

From your own game project, install the local package with its actual path.

```bash
npm install /path/to/eidos/build/sdk/eidos-engine-0.5.2.tgz
```

The MIT-licensed SDK supports CommonJS, ES module imports, and TypeScript. It has no third-party runtime dependencies. Browser games can bundle it with their own tooling. The RPG adapter is available as `@eidos/engine/rpg`. The packaging command produces a local tarball. [Courtyard source](../examples/engine/locked-door.mjs) · [RPG source](../examples/rpg/locked-door.mjs)

## Describe the world and report real outcomes

Give the SDK a stable world ID, the current scene, and the state your game exposes to narration. Scenes, components, map nodes and edges, and commands use stable IDs. A component can represent a character, door, object, or an entity from your own game. Declare the command target and describe its parameters as JSON. Your game validates the parameters and decides whether execution succeeds.

Use `createEngineHost` for an integration that executes commands and saves progress. Its `project` function turns game state into an `EngineWorld`. Its `execute` function runs a game rule and returns the actual outcome. Persist an initial save with `host.persist()` and restore saved sessions with `restoreEngineHost`.

```ts
const revision = host.getSnapshot().engine.revision;
await host.requestCommands({
  id: clickId,
  expectedRevision: revision,
  commands: [{ commandId: 'unlock', args: { key: 'brass' } }],
});
await host.resumePending();
```

Use `host.act()` when free text should reach a narrator. Use `host.synchronize()` to submit outcomes from another system, such as combat or a clock. After the SDK accepts command receipts, `host.narrateReceipts()` can make a separate request that describes the observed result. Button commands can display the host's feedback directly.

Keep stable operation IDs when retrying and store request IDs as opaque values. A host save callback compares the previous **host** revision with the persisted revision in the same transaction as the write. Calls to `act`, `requestCommands`, and `synchronize` use the **engine** revision. Keep game state and the engine checkpoint in the same durable save. Use `encodeEngineHostSnapshot()` for a compact save when needed. [SDK reference in Chinese](../sdk/README.md) · [Host example](../examples/engine/locked-door.mjs)

Project only information appropriate for narration. Secret answers and credentials belong in the host's private state. The context builder selects the active scene, usable objects, and discovered map content from the supplied projection.

## HTTP narration endpoint

Hosts written in other languages can request narration with `POST /api/engine/v1/narrate`. Configure a private `EIDOS_ENGINE_TOKEN` and server-side model settings in `eidos/.env.local`. Send the token in the `Authorization: Bearer …` header. [Environment variable example](../.env.example)

The request carries `{ version: 1, context, input: { text, target? } }`. A successful response contains `{ version: 1, sessionId, revision, proposal: { segments, commands }, usage? }`. Verify the returned session ID and revision before using the proposal. The host owns command execution and saves.

The app listens on loopback by default. If you route the developer endpoint over a network, keep the token on a trusted server and forward only that endpoint. The body limit is 2 MiB, with four concurrent requests per process and a 90-second deadline. Retrying a request may incur another model charge. [Full protocol and error codes in Chinese](developer-engine.md#http-协议-v1) · [Local security](../../SECURITY.en.md#local-use)

## Run the application from source

From `eidos`, run `npm ci` and `npm run dev`. Open [Eidos locally](http://localhost:3000). Use the same browser address to find your existing saves and settings. [AI setup](ai-configuration.en.md)

The portable edition uses your system browser. The Tauri source is available for desktop development. Install the platform prerequisites and run `cargo tauri dev` from `eidos` to start the development shell. [Tauri development instructions in Chinese](../README.md#桌面端开发中)

[Mod quickstart](modding.en.md) · [English home](../../README.en.md)
