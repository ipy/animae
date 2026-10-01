# Animae documentation index

Package overview and install: [../README.md](../README.md).

| Document | Audience | Contents |
|----------|----------|----------|
| [spec.md](./spec.md) | Product | Product specification (English; [Chinese edition](./spec.zh-CN.md)) |
| [architecture.md](./architecture.md) | Engineers | Repo layout, pinned decisions, contract changelog |
| [getting-started.md](./getting-started.md) | Authors / integrators | Minimal game, models, TUI / plain / RPC |
| [authoring-guide.md](./authoring-guide.md) | Content authors | Every authored file format + validated examples |
| [policy-reference.md](./policy-reference.md) | Game designers | Policy keys, defaults, merge, CEL sites |
| [cel-reference.md](./cel-reference.md) | Rule authors | Context variables, functions, numeric semantics |
| [pipeline-and-events.md](./pipeline-and-events.md) | Engine users | Turn pipeline, LLM call budget, event catalogue |
| [presets.md](./presets.md) | Preset authors | Bundles, `gen-bundle`, base & DnD presets |
| [mods.md](./mods.md) | Host apps / mod authors | Content packs, layering, patches, `ModBundle`, CLI |
| [tui-guide.md](./tui-guide.md) | UI integrators | Ink 8 TUI: layout, theme, keymap, extensions |
| [rpc-reference.md](./rpc-reference.md) | Tooling | JSON-RPC sidecar (`animae serve --stdio`) |
| [embedding.md](./embedding.md) | Library users | `createEngine`, ports, determinism, sidecar |
| [i18n.md](./i18n.md) | Host apps | UI vs prompt vs content vs output locale, `$t:` / name refs |
| [gallery.md](./gallery.md) | Integrators | CG gallery, `ImagePort`, ratings, jobs, RPC |
| [CHANGELOG.md](./CHANGELOG.md) | Release | v1.0.0 summary |

## Module notes (`modules/`)

Implementation-facing notes (purpose, public API, edge cases):

| Module | File |
|--------|------|
| Store | [modules/store.md](./modules/store.md) |
| Policy | [modules/policy.md](./modules/policy.md) |
| Authored loaders | [modules/authored.md](./modules/authored.md) |
| Rules & CEL | [modules/rules.md](./modules/rules.md) |
| Timeline | [modules/timeline.md](./modules/timeline.md) |
| Model (AI SDK) | [modules/model.md](./modules/model.md) |
| Model call log | [model-call-log.md](./model-call-log.md) |
| Fields | [modules/fields.md](./modules/fields.md) |
| Director | [modules/director.md](./modules/director.md) |
| World | [modules/world.md](./modules/world.md) |
| Memory | [modules/memory.md](./modules/memory.md) |
| Introspect | [modules/introspect.md](./modules/introspect.md) |
| Entities | [modules/entities.md](./modules/entities.md) |
| Router | [modules/router.md](./modules/router.md) |
| Pipeline | [modules/pipeline.md](./modules/pipeline.md) |
| Scene | [modules/scene.md](./modules/scene.md) |
| Engine kernel | [modules/engine.md](./modules/engine.md) |
| Host session shell | [modules/host.md](./modules/host.md) · [modules/host.zh-CN.md](./modules/host.zh-CN.md) |
| Gallery | [modules/gallery.md](./modules/gallery.md) |
| RPC | [modules/rpc.md](./modules/rpc.md) |
| CLI | [modules/cli.md](./modules/cli.md) |
| TUI | [modules/tui.md](./modules/tui.md) |
| Presets | [modules/presets.md](./modules/presets.md) |
| E2E tests | [modules/e2e.md](./modules/e2e.md) |

## Other assets

- [tui-snapshots/](./tui-snapshots/) — frozen terminal renders for layout QA
