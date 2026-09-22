# Module: `policy/`

## Purpose

Loads, merges, validates, and default-fills strategy documents into a `ResolvedPolicy`.

## Public API

| Export | Role |
|---|---|
| `mergePolicies(layers)` | Deep merge with `$append` / `$prepend`; `POLICY_OVERRIDE` warnings |
| `createPresetRegistry(initial?)` | In-memory preset bundle registry |
| `resolvePresetChain(registry, id)` | Topological `extends` resolution; `CONFIG_INVALID` on cycle/missing |
| `loadPresetDir(path \| StoragePort)` | Filesystem or storage preset → `PresetBundle` |
| `loadPolicy(storage, config, registry, opts?)` | Full [7.4 load path](../spec.md#74-loading-and-validation); throws `AnimaeError("CONFIG_INVALID")` with `file:path: msg` lines |
| `applyPolicyDefaults(doc)` | Fill spec defaults (memory k=8, render.recentTurns=12, router budget, …) |
| `validatePolicyDocument(merged, opts?)` | Zod + cross-ref validation |
| `ResolvedPolicy`, `Policy` | Re-exported from `schema/policy.ts` |

`LoadPolicyOptions`: `knownRuleFns?: Set<string>`, `authoredFields?: Record<string, { level }>` for grant vs declared field level ([10.3](../spec.md#103-grants)).

Policy hash: `sha256(stableStringify(resolved))`.

## Decisions

- CEL compile checks run via `setCelValidator(celCheck)` from `rules/cel` during zod parse.
- Grant validation uses the **maximum** `maxLevel` across all `fields.grants` entries vs each authored field’s declared level (conservative when grants are broad `holder: "true"`).
- Unknown custom rule `fn` names produce **warnings** (`POLICY_WARN`) unless `knownRuleFns` is supplied (then missing names warn; unregistered still warn).

## Edge cases

- `.ts` policy modules must default-export a document; loaded via `import()` from `storage.root`.
- Merge skips non-object layers with a warning.
- Arrays replace unless the incoming value is `{ $append: [...] }` or `{ $prepend: [...] }`.
