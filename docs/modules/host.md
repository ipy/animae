# Host (`@animae/host`)

UI-agnostic session shell shared by TUI and Web: commands, toolbar actions, entity actions, panel data, turn streaming, and snapshot assembly.

## Actions and locale

Register `HostAction` / `HostEntityAction` labels, hints, and argument field labels like TUI actions: each may be a plain string or a `ResolvableText` thunk (`() => string`) from `@animae/i18n` (the terminal UI re-exports the same type). `SessionHost.listActions()` resolves thunks with the **viewer's UI locale** (`setUiLocale` / `buildSnapshot({ locale })`), so web clients with different `:lang` settings receive localized toolbar and palette copy in the same session. Plain strings are unchanged.

Wire protocol snapshots may still run `localizeSnapshot()` for late-bound `LocalizableValue` fields on action rows.

## Command API

`HostCommandApi` mirrors the TUI `CommandApi` surface. Optional `focusTarget()` exposes the host UI focus id so colon commands can infer a member when no argument is given.
