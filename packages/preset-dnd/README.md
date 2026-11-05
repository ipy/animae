# @animae/preset-dnd

D&D SRD 5.2.1 social & exploration overlay ([Section 19.5](../../docs/spec.md#195-animaepreset-dnd)). Extends `@animae/preset-base` (including its rule-backend templates). Pair with `mode: rule` for offline social checks driven by rules, or add `models` for LLM narration.

```ts
import preset, { notice, conditionField, rest } from "@animae/preset-dnd";
```

**Attribution:** this preset includes SRD 5.2.1 material. The full notice is exported as `notice` and copied in [NOTICE](./NOTICE).

Regenerate bundle: `bun scripts/gen-bundle.ts`.

See [presets module doc](../../docs/modules/presets.md).
