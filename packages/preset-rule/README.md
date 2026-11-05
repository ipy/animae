# @animae/preset-rule

Rule-first preset for Animae: what a game needs to play with **no model at all** (`mode: rule`), and the content the rule backend falls back to when a model call fails.

It extends [`@animae/preset-base`](../preset-base), which already carries the rule backend's appraisal patterns, utterance layers, narration layers and English string table. This preset adds:

- quick replies (`choices.enabled: true`) — without a model, free text is only keyword-matched, so offering choices is the primary way to play;
- extra command words (`/comfort`, `/gift`, `/insult`, `/threaten`, `/greet`);
- fixed memory importance per event type (`memory.writing.importanceByEventType`);
- an offscreen location line (`offscreen.narrateTemplate`) and idle lines for autonomous exchanges (`scene.autonomous.rules`).

Source of truth: `preset.yaml`, `policies/*.yaml` and `locales/<locale>/strings.yaml`. Run `bun scripts/gen-bundle.ts` after editing them.

```yaml
# animae.yaml
preset: "@animae/preset-rule"
mode: rule
```

```ts
import presetBase from "@animae/preset-base";
import presetRule from "@animae/preset-rule";
// createEngine({ presets: [presetBase, presetRule], ... })
```

All player-facing text is a string-table key (`$t:rule.…`, `$t:base.…`). The packages ship the English tables; a game in another language supplies the same keys in its own `locales/<locale>/strings.yaml`, which overrides these.

See the [presets guide](../../docs/modules/presets.md) and the rule backend design in [spec Appendix C](../../docs/spec.md).
