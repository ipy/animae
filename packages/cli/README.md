# animae CLI

See [docs/modules/cli.md](../../docs/modules/cli.md) and the repository [README](../../README.md).

Global **`--mode full|judge-only|narrate-only|rule`** selects runtime backends (overrides `animae.yaml`). **`validate --mode rule`** checks rule-backend playability. Built-in presets include `@animae/preset-rule`.

```bash
bun run build    # from the repository root — compiles dist/animae
bun test         # from this package
node dist/bin.js --help
./dist/animae run --root ./data --mode rule   # zero-token play
```
