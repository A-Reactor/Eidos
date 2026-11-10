# Modding quickstart

[玩法插件中文参考](gameplay-plugins.md) · [全局插件中文参考](global-plugins.md)

## Add rules to a world

In **Create world → Gameplay and mods**, choose a built-in option or import a plugin JSON file. Try the door puzzle example. Imported versions remain available in the local library, and each world selects one version of a given plugin ID. A world export carries the selected manifests with the world. [Door puzzle JSON](examples/gameplay-door-puzzle.json)

To adapt the example, choose a unique `id` and edit `name`, `description`, and the three prompts. `prompts.creation` guides world creation, `prompts.action` guides narration when the plugin is active, and `prompts.review` guides review. The manifest uses `format: "eidos-gameplay-plugin"`. Version 1 supports Boolean rules. Version 2 adds bounded integer resources.

In the door puzzle, the `find-key` rule sets a flag when the player gets the key. The `open-door` rule requires that flag. ALICE proposes events by plugin ID and rule ID, and the engine checks the declared requirements before it commits a batch. Authors can use prompts alone for free exploration, or add rules where the outcome needs a definite check.

Optional world mod interfaces run in a sandboxed iframe. World mod state follows the playthrough and its timeline. [Gameplay schema and UI reference in Chinese](gameplay-plugins.md) · [Example mods](../mods/README.md)

## Extend the application

Global plugins run across worlds and can customize styles, interface behavior, and submitted actions. From the title screen or the world library, open **Settings → Global plugins**. You can import a plugin file or install the included test plugin. Enable a plugin after reviewing its code. Global JavaScript runs with the application's browser permissions. [Global plugin API in Chinese](global-plugins.md#javascript-入口与-sdk) · [Security and data](../../SECURITY.en.md)

[For game developers](developer-engine.en.md) · [English home](../../README.en.md)
