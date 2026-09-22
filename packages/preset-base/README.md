# @animae/preset-base

Built-in Animae preset implementing [Section 19.4](../../docs/spec.md#194-animaepreset-base) (tracks, event deltas, intents, visibility, router, memory defaults, …).

Source of truth: `preset.yaml` and `policies/*.yaml`. Run `bun scripts/gen-bundle.ts` after editing YAML.

```ts
import preset from "@animae/preset-base";
// createEngine({ presets: [preset], ... })
```

See [presets module doc](../../docs/modules/presets.md).
