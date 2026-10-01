# Host（`@animae/host`）

与 TUI / Web 共享的 UI 无关会话壳：命令、工具栏动作、实体动作、面板数据、回合流与快照组装。

## 动作与语言

注册 `HostAction` / `HostEntityAction` 的标签、提示与参数字段标签时，可与 TUI 动作相同：使用 `@animae/i18n` 的 `ResolvableText`（`string | () => string`；终端界面重新导出同一类型）。`SessionHost.listActions()` 在**观众 UI 语言**（`setUiLocale` / `buildSnapshot({ locale })`）下解析 thunk，因此同一会话中不同 Web 客户端可收到各自语言的工具栏与命令面板文案。纯字符串保持不变。

线上快照仍可对动作行上的 `LocalizableValue` 字段运行 `localizeSnapshot()`。

## Command API

`HostCommandApi` 与 TUI `CommandApi` 表面对齐。可选的 `focusTarget()` 暴露宿主 UI 焦点 id，供冒号命令在无参数时推断成员。
