# @animae/preset-base

Built-in Animae preset implementing [Section 19.4](../../docs/spec.md#194-animaepreset-base) (tracks, event deltas, intents, visibility, router, memory defaults, …).

Source of truth: `preset.yaml`, `policies/*.yaml` and `locales/<locale>/strings.yaml`. Run `bun scripts/gen-bundle.ts` after editing them.

Besides the mechanics (tracks, event deltas, intents, router, memory defaults) the preset carries the content of the **rule backend**, so an engine started with no model plays out of the box: `appraise.patterns` / `commands` / `fallback` (English keyword patterns), `render.layers` (utterance layers per intent, plus the `narration`, `narration_beat` and `narration_break` narration layers) and `render.fallback`, `choices.rules` (quick replies, offered when `choices.enabled`), and `memory.writing`. The player-facing text of these layers is a string-table key (`$t:base.…`); the package ships the English table, a game in another language ships the same keys in its own `locales/<locale>/strings.yaml`.

```ts
import preset from "@animae/preset-base";
// createEngine({ presets: [preset], ... })
```

See [presets module doc](../../docs/modules/presets.md).
