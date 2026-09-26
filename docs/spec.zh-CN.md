# Animae 引擎规格 v1.0

> 本文是英文规格 [spec.md](./spec.md) 的中文版。两个版本内容一致，如有出入以英文版为准。

## 1. 概述

Animae 是一个与具体玩法无关的角色与世界运行时，以 TypeScript 库的形式在本地运行，为 TRPG、视觉小说等互动叙事提供以下能力：

- 角色系统
- 认知管线
- 记忆与知识
- 场系统
- 叙事导演
- 世界与时间
- 时间线（存档、回溯、分支）
- 多角色编排
- 内省与可见性
- 输入分类与安全
- 路由与预算
- 骰子与检定

引擎只提供机制。所有玩法相关的选择都由上层通过策略（policy）和预设（preset）注入。

## 2. 技术栈与交付物

| 项 | 规格 |
|---|---|
| 语言 | TypeScript（最新稳定版，`strict`），产物为 ESM |
| 运行时 | Node.js ≥ 24；Bun 最新稳定版 |
| 模型层 | Vercel AI SDK Core（`ai@7`），封装在 `ModelPort` 之后 |
| Schema 校验 | zod 4 |
| 表达式 | CEL，使用 `@marcbachmann/cel-js` 8.x 实现 |
| 存储 | 本地纯文本文件（YAML、Markdown、JSONL、JSON） |

| 交付物 | 内容 |
|---|---|
| `@animae/engine` | 引擎库 |
| `@animae/preset-base` | 内置基础预设（[19.4](#194-animaepreset-base)） |
| `@animae/preset-dnd` | 内置 DnD 预设（[19.5](#195-animaepreset-dnd)） |
| `@animae/tui` | 终端游戏界面：基于 Ink 8（React）的组件库，外加一套默认游戏布局（[21](#21-终端界面-animaetui)） |
| `animae` | 用 `bun build --compile` 构建的单个可执行文件，内含 `@animae/tui`，提供两种模式：交互式 CLI/TUI 和 `animae serve --stdio`（基于 stdio 的 JSON-RPC 2.0 sidecar） |

## 3. 引擎不变式

| # | 不变式 |
|---|---|
| I1 | 引擎代码不包含玩法偏好；所有偏好都以策略、预设或 schema 扩展的形式注入。 |
| I2 | 所有状态变化都以事件形式追加到当前时间线的事件日志中；任何状态都可以通过重放事件得到。 |
| I3 | LLM 的输出只是提议，由裁决器（adjudicator）决定是否写入；写入行为本身也作为事件记录。 |
| I4 | 每个事件都带有 `because`（出处）和 `source`（来源）。 |
| I5 | 所有状态都可以通过 `query` 读取，读取结果按观察者和可见性策略过滤。 |
| I6 | 给定相同的种子和 LLM 录制，重放结果逐字节一致。 |
| I7 | 规则函数是同步纯函数。阶段钩子的 IO 只能经由 `ctx` 提供的端口进行，并且会被录制。 |
| I8 | 写者只有一个进程，由数据根目录下的 `.animae.lock` 文件保证（文件内容为 pid）。 |

## 4. 架构

| 模块 | 职责 |
|---|---|
| `schema` | zod 定义与扩展注册 |
| `store` | `StoragePort` 实现（文件系统）；原子写入（写入临时文件后 rename）；追加写入加 fsync |
| `timeline` | 事件日志、快照、存档、回溯、分支、携带集、裁剪、清除、导出、重放 |
| `rules` | CEL 编译与执行、规则原语、TS 规则函数注册 |
| `adjudicator` | 提议到事件的转换与校验 |
| `pipeline` | 回合管线与阶段钩子 |
| `characters` | 角色、细节层级（LOD）、模板生成、导入导出 |
| `memory` | 记忆条目、知识文档、检索、遗忘、失真、传播、反思 |
| `fields` | 场的声明、授权、解析、代价、账本 |
| `director` | 锚点、节拍、场边提示、例外通道 |
| `world` | 世界变量、地点、物品、历法、调度器、长事件、离屏模拟、惰性补算 |
| `scene` | 场景、参与者、发言轮转、NPC 自主对话 |
| `introspect` | `query`、`grant`、`explain`、事件订阅 |
| `classify` | 输入分类、安全分类 |
| `router` | S1/S2 路由、预算、降级、prompt 分段 |
| `dice` | 掷骰表达式与检定 |
| `model` | `ModelPort`、AI SDK 适配器、录制与回放 |
| `policy` | 策略加载、合并、校验 |
| `rpc` / `cli` | JSON-RPC sidecar 与 CLI |

## 5. 数据根目录

```
<root>/
  animae.yaml                 # 引擎配置：预设、策略列表、种子、模型 id
  world/
    world.yaml                # 语言、历法、世界变量初值、章节定义
    locations/<id>.yaml
    items/<id>.yaml
    fields/<id>.yaml
    anchors.yaml
    beats.yaml
    exceptions.yaml
    schedule.yaml
    knowledge/**/*.md         # 带 frontmatter 的知识文档
  characters/<id>/
    card.md                   # frontmatter：身份、约束集、文风；正文：人设
    traits.yaml
    tracks.yaml               # 初值与轨道覆盖
    goals.yaml
    secrets.yaml
    relations.yaml
    knowledge/*.md            # 角色私有知识（带 frontmatter）
  templates/{character,location,item}/<id>.yaml
  policies/*.yaml | *.ts
  timelines/<branch>/
    events.jsonl              # 第一行是 branch.header
    snapshots/<eventId>.json
    entities/                 # 本分支动态生成的角色、地点、物品
    artifacts/                # LLM 产物：记忆文本、摘要、反思
    recordings.jsonl          # LLM 录制
  saves.yaml                  # 存档槽 → { branch, eventId }
  derived/                    # 可以重建的派生视图
  .animae.lock
```

| 规则 | 规格 |
|---|---|
| 作者文件 | `world/`、`characters/`、`templates/`、`policies/` 下的文件对所有分支全局生效 |
| 分支文件 | `timelines/<branch>/` 只属于该分支；子分支可以读取祖先链上的 `entities/` 和 `artifacts/`，写入则只写到本分支（写时复制） |
| 快照 | 每 200 个事件和每次 `scene.end` 时各生成一次 |
| 分支头 | `{"kind":"branch.header","branch":"b2","parent":"main","forkAt":"evt_0412"}` |
| 事件行 | `{"id","kind","t":<WorldTime>,"sid","scene","turn","source","because":[...],...payload}` |

## 6. 角色系统

### 6.1 角色 schema

| 部分 | 字段 |
|---|---|
| 身份 `identity` | `id`、`name`、`summary`、`language`（可选，覆盖世界语言）、`style_examples[]` |
| 约束集 `constraints` | `motives[]`；`bottom_lines[]`：`{id, text, tags[], hardness: hard\|soft}`；`taboos[]`（标签） |
| 禀赋 `traits` | 自定义维度 `{name: number}`；`event_mult`：`{eventType: number}`，即禀赋系数 |
| 数值轨 `tracks` | 由策略定义（[7.3](#73-规则原语)）；角色文件只写初值和覆盖项 |
| 目标 `goals` | `[{id, text, tags[], priority}]` |
| 秘密 `secrets` | `[{id, text, tags[], unlock: <CEL>}]` |
| 关系 `relations` | `[{to, kind, tracks?, share: <CEL>}]` |
| 细节层级 `lod` | `extra`（路人）\| `supporting`（配角）\| `principal`（主要角色） |

### 6.2 细节层级

| LOD | 持久化内容 | 生成用的模型 |
|---|---|---|
| `extra` | `identity`，以及一行 `summary`；不持久化记忆 | S1 |
| `supporting` | `identity`、`constraints`、`tracks`、记忆 | S1 |
| `principal` | 完整 schema | S2 |

晋升条件由模板中的 CEL 定义。晋升时，引擎按目标 LOD 的模板补全缺失的字段，然后写入 `character.promoted` 事件。

### 6.3 动态生成

1. 生成可以由以下三种方式触发：上层调用 `entities.generate`、规则产出 `entity.generate` 事件、导演通过锚点兜底触发。
2. 模板文件 `templates/<kind>/<id>.yaml` 包含以下字段：`fields`（zod 兼容的字段定义）、`guidance`（生成指引文本）、`defaults`、`promote`（晋升规则）。
3. 模型输出结构化提议，依次经过 schema 校验和裁决器校验，通过后写入 `timelines/<branch>/entities/`，并记录 `entity.created` 事件。
4. 地点（location）、物品（item）的生成与角色使用同一套机制。

### 6.4 导入与导出

- **导入**：`animae import-card <file>`，支持 SillyTavern 角色卡 V2/V3。文件可以是 JSON，也可以是 PNG（读取 `chara` 或 `ccv3` 文本块）。

  | 源字段 | 目标 |
  |---|---|
  | `name` | `identity.name` |
  | `description` + `personality` | `card.md` 正文 |
  | `scenario` | `knowledge/scenario.md`（`inject: always`） |
  | `first_mes` | `identity.greeting` |
  | `mes_example` | `identity.style_examples` |
  | `character_book.entries[]` | `knowledge/<n>.md`：`keys` 转为 `when` 关键词条件，`constant: true` 转为 `inject: always` |
  | 其余字段 | 原样存入 `card.md` frontmatter 的 `x_import` 字段 |

- **导出**：`animae export-card <id>`，生成 `.acard.jsonl` 文件。格式与 [13 时间线](#13-时间线) 导出相同，内容只包含 `characters/<id>/`。

## 7. 规则与表达式

### 7.1 形式

- YAML 中的条件、数值、优先级一律用 CEL 表达式书写。
- 复杂逻辑可以用 TS 同步纯函数实现：通过 `engine.rules.register(name, fn)` 注册，YAML 中用 `fn: <name>` 引用。
- 规则函数的签名：`(ctx: Readonly<RuleCtx>) => EngineEventDraft[]`。函数内只能使用 `ctx.rng()`，即按时间线和事件 id 播种的随机数生成器。

### 7.2 CEL 上下文变量

`self`、`other`、`actor`、`event`、`scene`、`world`、`time`、`tracks`、`tiers`、`memory`、`fields`、`check`、`model`

`model` 始终存在：`{ slot: "s1" | "s2" | "", tags: string[] }`。宿主为各模型端口附加能力标签（例如内容分级标签）。组装 prompt 时，当前槽位由流水线 tier（`s1` 或 `s2`）填入；其它阶段默认 `slot` 为空、`tags` 为空，除非宿主通过 `extra.model` 传入。使用 `'tag' in model.tags` 判断后再依赖某标签。

### 7.3 规则原语

| 原语 | 参数 |
|---|---|
| `track` | `name`、`min`、`max`、`initial`、`tiers[]`（`{name, from}`）、`hysteresis`、`decay`（`{toward, ratePerHour}`） |
| `delta_table` | `{eventType: {track: base}}` |
| `delta_formula` | 固定为 `base × intensity × sincerityFactor × traitMult × marginal(n)` |
| `marginal` | `k`；`n` 为同一 NPC 收到的同类事件计数，按 `halfLifeHours` 衰减 |
| `turn_cap` | `{track: maxAbsPerTurn}` |
| `window` | `{trigger: <CEL>, durationScenes, mult: {eventType: number}, capToLoss: bool}` |
| `threshold` | `{when: <CEL>, emit: <eventDraft>}` |
| `intent_rules` | `[{intent, when: <CEL>, score: <CEL>}]` |

`sincerityFactor` 只对正向的 `base` 生效：取值等于 `sincerity`（0–1）。负向的 `base` 不受它影响。

### 7.4 加载与校验

1. 策略按以下顺序加载：预设 `extends` 链（深度合并，后者覆盖前者）→ 预设自身 → `animae.yaml` 中的 `policies` 列表（按列表顺序）。
2. 同一个键被重复定义时，后加载的覆盖先加载的，并写入一条 `config.warning` 事件。
3. 遇到无效配置时拒绝加载，并在错误信息中给出文件和路径。无效配置包括：引用不存在、类型不匹配、CEL 编译失败、zod 校验失败、场的层级超出授权。

## 8. 认知管线

```
input → classify → appraise → check → adjudicate → applyFields → decide → route → render → commit
```

| 阶段 | 默认实现 | 可替换性 |
|---|---|---|
| `classify` | 由 S1 在 `appraise` 的同一次调用中输出输入类别 | 阶段钩子 |
| `appraise` | S1 结构化输出：`{type, intensity, sincerity, approach, claims[], search_terms[], tags[], input_class, safety?}` | 阶段钩子 |
| `check` | 策略声明了检定规则时，掷骰并写入 `check.rolled` 事件 | 规则 |
| `adjudicate` | 按事件类型和规则原语生成 `track.delta` 事件 | 规则 |
| `applyFields` | 按 [10 场系统](#10-场系统) 解析所有生效的场 | 规则（冲突解析器） |
| `decide` | 按 `intent_rules` 计分，取最高分；同分时按声明顺序 | 规则 |
| `route` | 按 [17 路由、预算与缓存](#17-路由预算与缓存) 选择 S1 或 S2 | 策略 |
| `render` | 流式生成，输出 `text` 分片和 `cue` 分片；按策略附带选项 | 阶段钩子 |
| `commit` | 追加事件，更新派生状态，异步写入记忆 | — |

**同步调用**：会阻塞玩家看到回复的 LLM 调用。每回合固定 2 次：`appraise` 1 次，`render` 1 次。

**生成输出 schema**：`{text, cues[], intent_realized, choices?[]}`。

- 当 `intent_realized` 与 `decide` 的结果不一致时，记录 `intent.mismatch` 事件。是否重试由策略 `render.retryOnMismatch` 决定，取值为 0 或 1。

**演出指令（cue）**：

- cue 分片的格式为 `{type:"cue", cue:{type, args}, at:<文本字符偏移>}`。
- 可用的 cue 类型及其参数 schema 由策略 `cues.types` 声明。

**玩家选项**：

- 策略 `choices` 的配置为 `{enabled, count, filter: <CEL>}`。
- 开启后，在 `render` 的同一次输出中产出 `choices[]`，每一项为 `{text, expected_event_type, tags[]}`。
- 不满足 `filter` 的选项会被丢弃，并记录 `choice.filtered` 事件。

**输出语言**：优先使用 `identity.language`，否则使用 `world.yaml` 中的 `language`（BCP 47 标签）。语言设置只影响 `render` 和 `entities.generate`。

## 9. 记忆与知识

### 9.1 记忆条目

记忆条目存放在 `artifacts/<npc>/memory.jsonl`，格式如下：

```
{id, t, kind: episodic|semantic|summary|reflection, text, tags[], claims[{s,p,o}], importance(0–1), valence(-1–1), src: eventId, branch}
```

### 9.2 知识文档与 frontmatter 注入

知识文档是 `world/knowledge/**/*.md` 和 `characters/<id>/knowledge/*.md` 下的 Markdown 文件。摘要类记忆以带 frontmatter 的 Markdown 形式写入 `artifacts/<npc>/summaries/`。

```yaml
---
name: harbor-history
description: 雾港的建城史与旧灯塔事故
scope: world | location:<id> | character:<id> | scene:<id>
inject: always | when | on-demand
when: "scene.location == 'harbor' || 'lighthouse' in event.tags"   # inject: when 时必填
tags: [harbor, lighthouse]
priority: 0
---
正文……
```

| `inject` 取值 | 注入方式 |
|---|---|
| `always` | 只要处于作用域内，正文就注入半静态段 |
| `when` | CEL 条件为真时，正文注入动态段 |
| `on-demand` | 只把 `name` 和 `description` 列入索引段，作用域内最多 50 条，按 `priority` 降序。正文在检索命中或 S2 调用 `read` 工具时才加载 |

### 9.3 检索

- **召回**：在作用域内的记忆条目和知识文档中，对 `appraise.search_terms` 做大小写不敏感的子串匹配和正则匹配。不建立索引。
- **评分**：`0.5 × 词命中率 + 0.2 × 新近度 + 0.2 × importance + 0.1 × 场的浮现权重`。新近度的半衰期为 7 个世界日。
- **取用**：取评分前 8 条（K = 8），注入动态段。
- **S2 回合**：S2 可以使用 `search({query, scope, tags})` 和 `read({id})` 两个工具，最多 3 步；工具调用的结果会被录制。
- **向量检索**：只定义接口 `EmbeddingPort { embed(texts: string[]): Promise<Float32Array[]> }`。启用后，向量分以权重 0.3 并入评分，其余各项按比例缩放。

### 9.4 遗忘

- 由策略 `memory.forgetting` 控制，`enabled: false` 时关闭。
- 保持度：`retention = exp(-ageDays / (tau × (0.5 + importance)))`。
- 保持度低于 `threshold` 的条目不参与检索，但不会被删除。

### 9.5 失真

- 由策略 `memory.distortion` 控制：`{enabled, p, maxImportance, kinds: [intensify, swap_subject, add_motive]}`。
- 检索命中时，按概率 `p` 为条目附加一条失真指令，写入 `memory.distorted` 事件。
- 原文本始终不变；失真只作用于当次的 `render`。

### 9.6 传播

- 由策略 `memory.propagation` 控制：`{enabled, onTick: day, distortionPerHop}`。
- 每个传播 tick，对标记为 `shareable` 的条目，沿着 `relations[].share` 为真的边传播一跳。
- 每传播一跳，失真计数加 1，写入 `memory.propagated` 事件。

### 9.7 反思

- `scene.end` 时，对每个 `principal` 角色异步调用一次 S2，输出提议：`{summaries[], goal_changes[], new_claims[]}`。
- 裁决器按策略 `reflection.accept` 校验提议。默认规则是：目标的 `tags` 与约束集的 `taboos`、`bottom_lines[].tags` 有交集时拒绝。
- 通过的提议写入 `reflection.accepted` 事件，未通过的写入 `reflection.rejected` 事件。

## 10. 场系统

### 10.1 场的定义

```yaml
id: rainy-old-building
holder: { kind: character|location|item|time|world|external, ref: old-building }
source: author | rule | anchor | runtime
scope: { scene?: <id>, location?: <id>, turns?: n, time?: {from,to}, when?: <CEL> }
level: L0 | L1 | L2 | L3 | L4
effects: { ... }          # 字段必须与 level 对应
priority: 0
stacking: add | max | override | resolver:<fn>
cost: { payer: <entity>, effects: {...}, due: <CEL>, ttlScenes: 3, fallback: {...} }   # 可选
```

### 10.2 层级与效果字段

| 层级 | 作用对象 | 效果字段 |
|---|---|---|
| L0 叙事条件 | 环境与时机 | `world_vars`、`event_prob: {id: Δ}`、`salience: [{tags, boost}]`、`topic_access: {open[], close[]}`、`schedule_offset: {id: minutes}` |
| L1 数值 | 轨道与检定 | `track_mult: {track: {eventType\|"*": m}}`、`track_offset`、`track_caps`、`tier_shift`、`check_mod: {skill\|"*": {bonus, advantage}}` |
| L2 意图 | 意图 | `intent_force`、`intent_forbid[]`、`intent_bias: {intent: score}` |
| L3 规则 | 规则 | `rule_override: {ruleId: ruleId}`、`rule_add[]` |
| L4 感知 | NPC 的自我视图 | `hide_entities[]`、`disguise: {entity: asEntity}`、`inject_belief: [{text, tags, claims}]`、`suppress_memory_tags[]` |

### 10.3 授权

- 由策略 `fields.grants` 配置：`[{holder: <CEL>, source: <CEL>, maxLevel}]`。
- 场的声明层级超过授权时，加载阶段直接报错。如果是运行时授予的场，则写入 `field.rejected` 事件。
- 数值上限由策略 `fields.caps` 配置，超出部分会被截断，并在 `field.applied` 事件中标记 `clamped`。

### 10.4 解析

1. 收集所有作用域命中的场。
2. 按层级分组，组内按 `priority` 降序排列。
3. 同一字段按 `stacking` 规则合并。
4. L4 的效果只写入 `npc:<id>` 自我视图，不改变真实状态。

### 10.5 账本

| 事件 | 写入时机 |
|---|---|
| `field.applied` | 每次场生效 |
| `field.rejected` | 每次场被拒绝 |
| `field.cost_due` | 代价到期 |
| `field.cost_settled` | 代价结算，或按 `fallback` 结算 |

账本是由以上事件派生出的视图，始终会被记录；谁能看到账本由可见性策略决定。

## 11. 叙事导演

| 机制 | 定义 |
|---|---|
| 锚点 `anchors.yaml` | `{id, target: {kind: world_event\|info_arrival\|character_state\|character_choice, spec}, deadline: <WorldTime\|CEL>, strategies: [soft, hard, force], soft: <L0 场>, hard: <兜底事件>}`。`force` 需要有 L2 授权。距离截止时间不足 1 个场景时，`soft` 生效；到达截止时间仍未达成，执行 `hard`；`force` 在截止前最后一个回合生效。期间依次写入 `anchor.progress`、`anchor.fulfilled`、`anchor.fallback` 事件 |
| 节拍 `beats.yaml` | `[{id, enter: <CEL>, exit: <CEL>, fields: [ids]}]`，按顺序排列，同一时刻只有一个节拍处于活动状态 |
| 场边提示 | `director.sidenote(npc, text, {ttlTurns, verbatim: bool})`。提示文本注入动态段；`verbatim: false` 时，如果生成内容包含提示原文中连续 8 个以上的字符，就写入 `sidenote.echoed` 事件 |
| 例外通道 `exceptions.yaml` | `{id, charges, period: session\|day\|chapter, mayBypass: [field_cap, cost_due, track_cap, rule:<id>, constraint:<id>]}`，通过 `director.invokeException` 使用，并写入 `exception.used` 事件 |

## 12. 世界与时间

### 12.1 世界状态

世界状态包括 `world.vars`、地点、物品、阵营，全部采用事件溯源。

### 12.2 历法

在 `world.yaml` 中配置：

```yaml
language: zh-CN
calendar:
  units: { minute: 1, hour: 60, day: 1440 }
  sceneMinutes: 30
  turnMinutes: 1
  chapters: [{ id: ch1, days: [1, 7] }, { id: ch2, days: [8, 14] }]
start: { day: 1, minute: 480 }
```

`WorldTime` 的格式为 `{day, minute}`。`world.advance` 按分钟、小时、天推进，也可以直接推进到某个时间点。

### 12.3 调度器

`schedule.yaml` 中的每一项为：

```
{id, at|every: <WorldTime|"day 08:00">, emit: <eventDraft> | rule: <fn>, duration?, phases?: [{id, minutes}], onInterrupt?: <rule>}
```

触发时写入 `schedule.fired` 事件。

### 12.4 长事件

- 带有 `duration` 和 `phases` 的调度项就是长事件。
- 补算到观察时刻时，根据已经过去的时长确定当前所处的阶段，并写入 `longevent.phase` 事件。
- 玩家介入时执行 `onInterrupt` 规则，并写入 `longevent.interrupted` 事件。

### 12.5 离屏模拟

| 保真度 | 行为 |
|---|---|
| `none` | 不推进 |
| `rule` | 只执行调度、规则和衰减 |
| `narrate` | 在 `rule` 的基础上，为观察点内的可见残迹调用 S1，生成一句叙述，作为 artifact 写入 |
| `full` | 在 `narrate` 的基础上，为调度中的角色相遇生成离屏对话，S1 和 S2 都按 [17 路由、预算与缓存](#17-路由预算与缓存) 路由 |

保真度由策略 `offscreen.fidelity` 配置，可以分别对每个地点、每个角色设置。

### 12.6 惰性补算

以下任一情况发生时，引擎把对应地点或角色从上次推进的时间补算到当前时间：

- 开始一个场景，且场景涉及该地点或角色；
- 观察者 `player` 查询该地点或角色。

补算完成后写入 `offscreen.simulated` 事件。

## 13. 时间线

| 能力 | 规格 |
|---|---|
| 存档 | `timeline.save(label)`：把 `{branch, eventId}` 写入 `saves.yaml` |
| 读档 | `timeline.load(slot)`：从最近的快照开始重放，重放过程使用录制数据 |
| 回溯 | `timeline.rewind(eventId)`：从该事件处开出新分支，写入 `branch.header` 和 `branch.forked` 事件，原分支保持不变 |
| 分支 | `timeline.branches()` 列出所有分支；`timeline.switch(branch)` 切换分支；`timeline.diff(a, b)` 返回两个分支的状态差异和事件差异 |
| 携带集 | 由策略 `timeline.carry` 配置：`[{characters: [ids]\|"*", kinds: [memory, track, world_var], tags: [..], when: <CEL>}]`。开出分支时，匹配的条目会复制到新分支，并标注 `carriedFrom`，写入 `carry.applied` 事件 |
| 裁剪 | `timeline.prune(branch)`：删除一个没有子分支的分支目录 |
| 清除 | `purge(scope)`：物理删除匹配的 artifacts，事件日志中对应的文本字段替换为 `"[redacted]"`，写入 `purge.applied` 事件 |
| 导出 | `timeline.export(branch, {recordings: bool})`：导出为单个 `.asave.jsonl` 文件。第 1 行是清单 `{engine, preset, branch, chain[], hashes}`；之后每一行是 `{path, content}`。内容包括世界定义、角色定义、策略、从根分支到当前分支整条祖先链上的事件和 artifacts，以及可选的录制数据 |
| 导入 | `timeline.import(file)`：导入时校验哈希，生成一个新分支 |
| 重播 | `timeline.replay(branch, {from, to})`：按回合逐个产出 `TurnChunk`，全部使用录制数据 |
| 录制 | `recordings.jsonl` 中每行是 `{key: hash(model, prompt, params, seed), response}`。回放模式下查不到录制时报错 |
| 热加载 | 每个回合结束时，比对作者文件的哈希。有变化时重新加载并校验：校验通过则写入 `config.reloaded` 事件（附带新哈希）；校验失败则保留旧配置，并写入 `config.error` 事件。重放时如果配置哈希不一致，会写入 `config.warning` 事件 |

## 14. 多角色编排

| 项 | 规格 |
|---|---|
| 参与者 | 由 `scene.start({participants})` 指定，可以包含任意数量的 NPC |
| 发言轮转 | 由策略 `scene.turnTaking` 配置，取值为 `addressed`（被点名的角色发言）、`round_robin`（轮流发言）或 `priority: <CEL>`（取分最高的角色） |
| NPC 自主对话 | 由策略 `scene.autonomous` 配置：`{maxExchangesPerPlayerTurn, when: <CEL>}`。每一次交流都走完整的回合管线，并计入预算 |
| S2 预算 | 场景内共享一个预算池，按升级触发的先后顺序消耗 |

## 15. 内省与可见性

| 项 | 规格 |
|---|---|
| 观察者 | 内置五种：`debug`（始终全部可见）、`author`、`gm`、`player`、`npc:<id>`（角色的自我视图，叠加了 L4 效果）。上层可以用 `introspect.registerViewer` 注册自定义观察者 |
| 路径 | `characters/<id>/{identity,constraints,traits,tracks,tiers,goals,secrets,memory,knowledge,alias}`、`world/{vars,locations,items}`、`ledger`、`events`、`timeline` |
| 可见性策略 | `visibility.rules: [{viewer, path: <glob>, allow: bool}]`，按顺序求值，以最后一条匹配的规则为准；没有任何规则匹配时拒绝 |
| 临时授权 | `grant(viewer, path, ttl)`：写入 `visibility.granted` 事件；到期时写入 `visibility.expired` 事件 |
| explain | `explain(turnId, viewer)` 返回该回合的事件链：输入、评估、检定、数值变化、场、意图、路由、检索命中。结果经过可见性过滤 |
| 订阅 | `on(kind, handler)`，`kind` 支持通配符 |

## 16. 输入分类与安全

| 项 | 规格 |
|---|---|
| 输入类别 | `normal`、`injection_suspect`、`meta_probe`，在 `appraise` 中输出 |
| 类别响应 | 由策略 `input.response` 配置：`{class: {emit: <eventType>, intent: <intent>} \| hook: <fn>}` |
| 安全分类 | 默认关闭。通过策略 `safety.enabled: true` 开启。开启后，`appraise` 额外输出 `safety`，取值为 `none`、`self_harm`、`real_world_danger`、`sexual_minors`、`personal_crisis` 之一 |
| 安全响应 | `safety.response: in_character \| out_of_character_notice \| block \| hook:<fn>` |
| 安全留痕 | `safety.log: bool`。为 `true` 时写入 `safety.flagged` 事件 |

## 17. 路由、预算与缓存

### 17.1 升级触发器

由策略 `router.triggers` 配置，满足任意一条即升级到 S2。

| 触发器 | 参数 |
|---|---|
| `anchor_near` | 距离截止时间不超过 N 个场景 |
| `secret_topic` | 评估的 `tags` 与 `secrets[].tags` 有交集 |
| `mood_spike` | `\|Δmood\| ≥ a` 或 `\|mood\| ≥ b` |
| `tier_change` | 任一轨道跨越档位 |
| `contradiction` | 评估中的 `claims` 与记忆中的 `claims` 主语和谓词相同、宾语不同 |
| `ambiguity` | `type == other`；或者 `sincerity < 0.3` 且事件类型为正向；或者 `input_class == injection_suspect` 且 `type != insincere_speech` |
| `field_high` | 本回合有 L2 或更高层级的场生效 |
| `sidenote` | 本回合收到场边提示 |
| `scene_first` | 场景的第一个回合 |

### 17.2 预算

由策略 `router.budget` 配置：

```
{syncCallsPerTurn: 2, s2PerTurn: 1, s2Ratio, s2ReservedForAnchors, maxOutputTokens: {s1, s2}}
```

### 17.3 降级

超出预算时，按策略 `router.degrade` 中列出的顺序依次执行，可选的动作为：

- `s2_to_s1`：非锚点回合改用 S1
- `defer_reflection`：推迟反思
- `skip_offscreen_narrate`：跳过离屏叙述
- `skip_autonomous`：跳过 NPC 自主对话

每执行一次降级，写入一条 `budget.degraded` 事件。

### 17.4 prompt 分段

| 段 | 内容 | 缓存断点 |
|---|---|---|
| 静态段 | 世界规则、`always` 知识、身份、约束集、文风 | 第 1 个 |
| 半静态段 | 关系摘要、长期记忆摘要、`on-demand` 索引；每个场景更新一次 | 第 2 个 |
| 动态段 | 档位标签、场的效果、`when` 知识、检索结果、最近 K 轮对话（K 由策略配置）、场边提示 | — |

缓存断点通过 AI SDK 的 `providerOptions` 传给模型厂商。

## 18. 骰子与检定

| 项 | 规格 |
|---|---|
| 表达式 | `NdM[kh\|klK][±C]`，例如 `2d20kh1+5` |
| 随机数 | `ctx.rng`，按时间线种子和事件 id 播种 |
| 检定 | `check({expr, dc, advantage, disadvantage})`。优势和劣势同时存在时互相抵消；结果写入 `check.rolled` 事件，内容为 `{expr, rolls[], total, dc, success}` |
| 引用 | CEL 中可以通过 `check.success`、`check.total`、`check.margin` 读取检定结果 |

## 19. 策略与预设

### 19.1 策略键

| 键 | 内容 |
|---|---|
| `schema.extend` | 扩展角色、世界、事件的字段 |
| `events.types` | 事件集，以及每类事件的 `positive` 标记 |
| `tracks` / `rules` | 数值轨和规则（[7 规则与表达式](#7-规则与表达式)） |
| `intent.types` / `intent_rules` | 意图类型和意图计分规则 |
| `input.response` / `safety` | 输入类别的响应方式；安全分类 |
| `fields.grants` / `fields.caps` | 场的授权和数值上限 |
| `memory.*` | 检索权重、K 值、遗忘、失真、传播 |
| `reflection.accept` | 反思提议的接受规则 |
| `characters.lod` | 细节层级和晋升规则 |
| `offscreen.fidelity` | 离屏模拟的保真度 |
| `scene.turnTaking` / `scene.autonomous` | 发言轮转；NPC 自主对话 |
| `router.*` | 升级触发器、预算、降级 |
| `render.*` | `retryOnMismatch`、最近对话轮数 K |
| `cues.types` | 演出指令类型 |
| `choices` | 玩家选项 |
| `timeline.carry` / `timeline.allowRewind` | 携带集；是否允许回溯 |
| `visibility.rules` | 可见性规则 |
| `checks` | 检定规则 |

### 19.2 预设

预设是一个目录或 npm 包，包含 `preset.yaml`（字段 `id`、`extends[]`、`policies[]`）、模板、知识文档和规则函数。

### 19.3 模型配置

启动时必须提供两个 `ModelPort`，分别用于 `s1` 和 `s2`，否则报错。`animae.yaml` 示例：

```yaml
preset: "@animae/preset-dnd"
seed: 42
models:
  s1: { provider: anthropic, model: claude-haiku-5-5 }
  s2: { provider: anthropic, model: claude-opus-5-5 }
policies: [policies/my-tweaks.yaml]
```

### 19.4 `@animae/preset-base`

**数值轨**

| 轨道 | 范围 | 初值 | 档位（下限） | 滞回 | 衰减 |
|---|---|---|---|---|---|
| `affinity` 好感 | 0–100 | 50 | 疏远 distant 0 · 冷淡 cool 20 · 普通 neutral 40 · 亲近 close 60 · 倾心 devoted 80 | ±3 | 无 |
| `trust` 信任 | 0–100 | 50 | 戒备 wary 0 · 将信将疑 doubtful 20 · 普通 neutral 40 · 信赖 trusting 60 · 托付 confiding 80 | ±3 | 无 |
| `mood` 情绪 | -100–100 | 0 | — | — | 每小时向 0 衰减 10% |

**事件集与基础增量**（依次为 affinity / trust / mood）

| 事件 | Δ | 事件 | Δ |
|---|---|---|---|
| `care` | +4 / +2 / +10 | `lie_exposed` | -4 / -10 / -15 |
| `praise` | +3 / 0 / +8 | `insincere_speech` | 0 / -3 / -5 |
| `gift` | +4 / +1 / +10 | `boundary_push` | -4 / -4 / -15 |
| `request` | 0 / 0 / 0 | `insult` | -6 / -3 / -20 |
| `promise_kept` | +2 / +6 / +5 | `apology` | +1 / +2 / +5 |
| `promise_broken` | -3 / -8 / -10 | `shared_experience` | +3 / +3 / +8 |
| `disclosure` | +2 / +5 / +5 | `meta_probe` | 0 / -1 / -3 |
| `smalltalk` | +1 / 0 / +2 | `other` | 0 / 0 / 0 |

**数值规则**：`marginal.k = 0.5`，`halfLifeHours = 24`；`turn_cap`：affinity 8、trust 8、mood 20。

**意图**：类型为 `respond`、`comply`、`refuse`、`negotiate`、`deflect`。计分规则依次为：

1. `refuse`：事件 `tags` 与 hardness 为 `hard` 的 `bottom_lines` 有交集
2. `deflect`：`input_class` 不是 `normal`
3. `negotiate`：`type == request` 且 `trust < 40`
4. `comply`：`type == request`
5. `respond`：以上都不满足

**输入响应**：`injection_suspect` 生成 `insincere_speech` 事件，意图为 `deflect`；`meta_probe` 生成 `meta_probe` 事件，意图为 `deflect`。

**其他策略**

| 策略 | 取值 |
|---|---|
| 安全 | `safety.enabled: false` |
| 场 | `fields.grants: [{holder: "true", source: "true", maxLevel: L4}]`；`fields.caps`：`salience.boost ≤ 0.4`，`event_prob ±0.3`，`track_offset ±20` |
| 记忆 | 检索权重按 [9.3 检索](#93-检索)，K = 8；遗忘、失真、传播全部关闭 |
| 反思 | `reflection.accept` 采用 [9.7 反思](#97-反思) 的默认规则 |
| 细节层级 | `extra → supporting`：`interactions >= 3 \|\| 'named' in tags`；`supporting → principal`：被锚点引用，或 `interactions >= 15` |
| 离屏 | `offscreen.fidelity: rule` |
| 场景 | `scene.turnTaking: addressed`；`scene.autonomous.maxExchangesPerPlayerTurn: 0` |
| 路由 | 启用全部触发器，参数为 `anchor_near N=1`、`mood_spike a=30 b=80` |
| 预算 | `syncCallsPerTurn 2`，`s2PerTurn 1`，`s2Ratio 0.15`，`s2ReservedForAnchors 0.03`，`maxOutputTokens s1 400 / s2 800` |
| 降级 | `router.degrade`：`[s2_to_s1, defer_reflection, skip_offscreen_narrate, skip_autonomous]` |
| 生成 | `render.retryOnMismatch: 0`；最近对话轮数 K = 12 |
| 演出指令 | `cues.types`：`expression{name}`、`action{name}`、`sfx{name}` |
| 选项 | `choices.enabled: false` |
| 时间线 | `timeline.allowRewind: true`；`timeline.carry: []` |
| 可见性 | `author` 和 `gm` 可以看全部；`player` 只能看 `events` 中的发言与选项，以及 `world/vars` 中带 `public` 标签的项；`npc:<id>` 只能看自己的自我视图 |

### 19.5 `@animae/preset-dnd`

`extends: ["@animae/preset-base"]`。覆盖 SRD 5.2.1 中社交与探索相关的子集，不含战斗规则。

**属性**

- 六项属性 STR、DEX、CON、INT、WIS、CHA，取值 1–30，调整值为 `floor((score - 10) / 2)`。
- 角色 `traits` 扩展为 `{abilities, level, proficiencies[]}`。
- 熟练加值按等级：1–4 级 +2，5–8 级 +3，9–12 级 +4，13–16 级 +5，17–20 级 +6。

**技能**：SRD 中的 18 项技能各自绑定一项属性。社交技能包括洞悉（Insight，WIS）、欺瞒（Deception，CHA）、威吓（Intimidation，CHA）、游说（Persuasion，CHA）、表演（Performance，CHA）。

**检定**：`1d20 + 属性调整值 + 熟练加值（如熟练）`，结果 ≥ DC 即为成功。

**态度映射**

| 好感档位 | 态度 | 社交检定 |
|---|---|---|
| distant、cool | Hostile | 劣势 |
| neutral | Indifferent | 正常 |
| close、devoted | Friendly | 优势 |

**影响检定**

- **触发**：`appraise.approach` 的取值为 `persuasion`、`deception`、`intimidation` 或 `performance` 时，进行一次检定。DC 取 15 与 NPC 智力值中的较大者。
- **检定成功**：事件按原类型生效。`deception` 成功时，事件额外标记 `deceived`；之后若被识破，转为 `lie_exposed`。`intimidation` 成功时，另外追加 affinity -2、trust -2。
- **检定失败**：`deception` 和 `intimidation` 降级为 `insincere_speech`；`persuasion` 和 `performance` 降级为 `smalltalk`。

**洞悉对抗**：NPC 的意图带有 `lie` 标签时，玩家可以发起洞悉检定，DC 为 `8 + NPC 欺瞒技能调整值`。成功时写入一条 `info_arrival` 事件，内容为“对方在说谎”。

**探索**：调查（Investigation）和察觉（Perception）检定成功时，会解锁 `when` 条件引用 `check.success` 的知识文档，并写入 `info_arrival` 事件。

**状态**（映射为场）

| 状态 | 层级 | 效果 |
|---|---|---|
| 魅惑 Charmed | L1 + L2 | 施术者对目标的社交检定获得优势；目标的意图禁止带 `hostile` 标签 |
| 恐惧 Frightened | L1 | 恐惧源可见时，所有检定处于劣势 |
| 中毒 Poisoned | L1 | 所有属性检定处于劣势 |
| 力竭 Exhaustion | L1 | 每级在所有 d20 检定上 -2 |

**休息**：短休推进 60 分钟世界时间，长休推进 480 分钟，并清除 1 级力竭。

**署名**：本预设的发布物须附带以下声明：

> This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

## 20. 接口

### 20.1 TypeScript API

```ts
function createEngine(opts: {
  root: string;
  models: { s1: ModelPort; s2: ModelPort };
  modelMode?: "live" | "record" | "replay";     // 默认 "record"
  ports?: { storage?: StoragePort; embedding?: EmbeddingPort };
  seed?: number;
}): Promise<Engine>;

interface Engine {
  world:     { now(): WorldTime; advance(by: Duration | { to: WorldTime }): Promise<EngineEvent[]>; set(path: string, value: unknown): void };
  scene:     { start(s: { location: string; participants: string[]; fields?: string[] }): Promise<SceneId>;
               turn(t: { sceneId: SceneId; actor: string; text: string; addressee?: string; choiceId?: string }): AsyncIterable<TurnChunk>;
               end(sceneId: SceneId): Promise<SceneReport> };
  entities:  { generate(r: { kind: "character" | "location" | "item"; template: string; hints?: Record<string, unknown> }): Promise<EntityRef>;
               promote(id: string, to: Lod): Promise<void> };
  fields:    { declare(f: FieldDef): void; grant(f: FieldDef): LedgerEntry; revoke(id: string): void };
  director:  { sidenote(npc: string, text: string, o?: { ttlTurns?: number; verbatim?: boolean }): void;
               invokeException(id: string, target: string): LedgerEntry };
  timeline:  { current(): BranchRef; save(label?: string): SaveSlot; load(slot: SaveSlot): Promise<void>;
               rewind(to: EventId): Promise<BranchRef>; branches(): BranchRef[]; switch(b: BranchRef): Promise<void>;
               diff(a: BranchRef, b: BranchRef): TimelineDiff; prune(b: BranchRef): Promise<void>;
               export(b: BranchRef, o?: { recordings?: boolean }): Promise<string>; import(file: string): Promise<BranchRef>;
               replay(b: BranchRef, r?: { from?: EventId; to?: EventId }): AsyncIterable<TurnChunk> };
  rules:     { register(name: string, fn: RuleFn): void };
  hooks:     { register(stage: Stage, fn: StageHook): void };
  introspect: { registerViewer(v: ViewerDef): void };
  query(viewer: Viewer, path: string): unknown;
  grant(viewer: Viewer, path: string, ttl?: Duration): void;
  explain(turnId: TurnId, viewer: Viewer): Explanation;
  on(kind: string, h: (e: EngineEvent) => void): () => void;
  purge(scope: { characters?: string[]; memoryIds?: string[]; sessions?: string[] }): Promise<void>;
  importCard(file: string): Promise<string>;
  exportCard(id: string): Promise<string>;
  close(): Promise<void>;
}

type TurnChunk =
  | { type: "text"; text: string; newUtterance?: boolean }
  | { type: "cue"; cue: { type: string; args: Record<string, unknown> }; at: number }
  | { type: "choices"; choices: { id: string; text: string; expected_event_type: string; tags: string[] }[] }
  | { type: "done"; turnId: TurnId; events: EventId[] };

同一说话者在相邻两个 `done` 之间连续出现的 `text` chunk 属于同一句台词的流式片段（除非设置了 `newUtterance`）。消费方必须把片段追加到同一条 transcript 记录，且每句台词只触发一次流式 start/end。

interface ModelPort {
  id: string;
  object<T>(req: { schema: ZodType<T>; segments: PromptSegments; tools?: ToolDef[]; maxOutputTokens: number }): Promise<T>;
  stream(req: { schema: ZodType<unknown>; segments: PromptSegments; tools?: ToolDef[]; maxOutputTokens: number }): AsyncIterable<StreamPart>;
}
```

### 20.2 JSON-RPC sidecar

- 启动命令：`animae serve --stdio --root <dir>`。
- 方法名与 API 路径一一对应，例如 `scene.turn`、`timeline.rewind`、`query`。
- 流式结果通过 `turn.chunk` 通知推送，参数为 `{requestId, chunk}`。
- 引擎事件通过 `event` 通知推送，需要先调用 `subscribe({kinds})` 订阅。

### 20.3 CLI

| 命令 | 功能 |
|---|---|
| `animae init <dir> [--preset <id>]` | 生成数据根目录骨架 |
| `animae validate` | 加载并校验全部配置 |
| `animae run [--scene <location>] [--with <ids>] [--viewer <v>] [--theme <file>] [--plain]` | 交互式运行。默认启动 TUI 的默认布局；带 `--plain` 时改为纯文本逐行模式。两种模式都支持 `:save`、`:load`、`:rewind <eventId>`、`:branches`、`:explain [turnId]`、`:query <viewer> <path>`、`:advance <duration>` |
| `animae inspect <path> [--viewer <v>]` | 查询状态 |
| `animae timeline <list\|save\|load\|rewind\|switch\|diff\|prune\|export\|import\|replay> ...` | 时间线操作 |
| `animae import-card <file>` / `animae export-card <id>` | 角色卡导入与导出 |
| `animae serve --stdio` | 启动 JSON-RPC sidecar |

## 21. 终端界面 `@animae/tui`

### 21.1 技术基础

| 项 | 规格 |
|---|---|
| 渲染库 | Ink 8（React） |
| 运行时 | Node ≥ 24 和 Bun 均可运行，可以打包进 `animae` 可执行文件 |
| 连接方式 | 在同一进程内直接调用 `Engine` 实例 |
| 数据读取 | 所有面板内容都通过 `engine.query(viewer, path)` 获取，遵循可见性策略；默认观察者为 `player` |
| 字符宽度 | 按 Unicode 显示宽度计算，正确处理中日韩全角字符 |
| 终端尺寸 | 宽 ≥ 100 列时使用双栏布局；80–99 列时使用单栏布局，侧栏改为覆盖层；不足 80×24 时提示放大终端 |

### 21.2 默认布局

```
┌ Header：世界时间 · 地点 · 章节 · 分支 ─────────────────────────────┐
│ Transcript（对话流，70%）            │ SidePanel（30%）             │
│  角色名 [表情]：台词（打字机效果）     │  参与者与可见数值/档位       │
│  （动作旁白）                         │  生效中的场（若可见）        │
│                                      │  当前锚点/节拍（若可见）     │
├──────────────────────────────────────┴──────────────────────────────┤
│ ChoiceMenu（有选项时显示）                                          │
│ InputLine：> 输入台词或 :命令                                       │
└ Footer：按键提示 · 路由指示（S1/S2）· 预算使用 ──────────────────────┘
```

### 21.3 覆盖层与按键

| 按键 | 动作 |
|---|---|
| Enter | 提交输入 |
| ↑ / ↓、1–9 | 在选项菜单中移动或直接选择 |
| 任意键（打字机效果进行中） | 立即显示当前整段文本 |
| Tab | 在 Transcript 和 SidePanel 之间切换焦点；焦点所在区域可以滚动 |
| F1 | 帮助 |
| F2 | 事件日志 EventLog（可以按 kind 过滤） |
| F3 | 时间线浏览器 TimelineBrowser：分支树、存档槽、切换、回溯 |
| F4 | 上一回合的 explain |
| F5 | 状态检查器 Inspector，相当于交互式的 `query` |
| Ctrl+S / Ctrl+L | 存档 / 读档 |
| Ctrl+Z | 回溯到上一回合：确认后开出新分支 |
| Esc | 关闭当前覆盖层 |
| Ctrl+C | 关闭引擎并退出 |

覆盖层中显示的内容同样按当前观察者过滤。

### 21.4 演出指令渲染

- 每种 cue 类型对应一个 `CueRenderer`，按 `at` 偏移与打字机进度对齐后触发。
- 内置三种渲染器：

  | cue 类型 | 渲染方式 |
  |---|---|
  | `expression` | 在角色名后显示 `[name]` |
  | `action` | 以斜体、暗色的旁白行插入 |
  | `sfx` | 显示为 `♪ name`；主题中 `bell: true` 时同时发出终端响铃 |

- 没有注册渲染器的 cue 类型不显示，只记录在事件日志中。

### 21.5 主题

主题文件为 YAML，通过 `--theme` 或 `runTui({theme})` 指定：

```yaml
colors: { primary: cyan, npc: magenta, player: green, narration: gray, warning: yellow }
border: round            # single | double | round | bold | none
typewriter: { charsPerSecond: 60, enabled: true }
sidePanel: { width: 30, show: [participants, tracks, fields, anchor] }
bell: false
```

### 21.6 API

```ts
import { runTui, defaultLayout, components, hooks } from "@animae/tui";

runTui(opts: {
  engine: Engine;
  viewer?: Viewer;                                  // 默认 "player"
  scene: { location: string; participants: string[] } | { sceneId: SceneId };
  actor?: string;                                   // 默认 "player"
  layout?: React.ComponentType<LayoutProps>;        // 默认 defaultLayout
  theme?: Theme | string;
  cueRenderers?: Record<string, CueRenderer>;
  keymap?: Partial<Keymap>;
}): Promise<void>;

type CueRenderer = (cue: { type: string; args: Record<string, unknown> }, ctx: CueCtx) => React.ReactNode | null;
```

| 组件 `components` | 职责 |
|---|---|
| `Header`、`Footer` | 状态栏 |
| `Transcript` | 对话流，内含 `Typewriter` 和 cue 渲染 |
| `Typewriter` | 逐字显示文本，支持跳过 |
| `ChoiceMenu` | 玩家选项菜单 |
| `InputLine` | 输入行，支持历史记录和 `:` 命令 |
| `SidePanel`、`TrackBar`、`FieldList` | 侧栏、数值条、场列表 |
| `EventLog`、`TimelineBrowser`、`ExplainView`、`Inspector` | 覆盖层视图 |
| `Overlay` | 覆盖层容器 |

| 钩子 `hooks` | 职责 |
|---|---|
| `useEngine()` | 获取当前 `Engine` 实例 |
| `useTurn()` | 提交输入，订阅当前回合的 `TurnChunk` 流 |
| `useQuery(path)` | 以当前观察者查询状态，状态变化时自动刷新 |
| `useEvents(kinds)` | 订阅引擎事件 |
| `useTheme()` | 读取当前主题 |
| `useKeymap()` | 读取和注册按键绑定 |

上层可以替换整个 `layout`，也可以自己组合组件、注册新的 cue 渲染器、覆盖按键绑定。

## 22. 事件类型目录

| 分组 | 事件 |
|---|---|
| 输入 | `input.received`、`input.classified`、`appraisal`、`safety.flagged` |
| 检定 | `check.rolled` |
| 数值 | `track.delta`、`tier.changed` |
| 场 | `field.applied`、`field.rejected`、`field.cost_due`、`field.cost_settled` |
| 意图与生成 | `intent.decided`、`intent.mismatch`、`route.decided`、`utterance`、`choice.offered`、`choice.taken`、`choice.filtered` |
| 记忆 | `memory.written`、`memory.distorted`、`memory.propagated`、`reflection.proposed`、`reflection.accepted`、`reflection.rejected` |
| 实体 | `entity.created`、`character.promoted` |
| 世界 | `world.var_set`、`time.advanced`、`schedule.fired`、`longevent.phase`、`longevent.interrupted`、`offscreen.simulated` |
| 导演 | `anchor.progress`、`anchor.fulfilled`、`anchor.fallback`、`beat.entered`、`beat.exited`、`sidenote.added`、`sidenote.expired`、`sidenote.echoed`、`exception.used` |
| 可见性 | `visibility.granted`、`visibility.expired` |
| 时间线 | `branch.header`、`branch.forked`、`carry.applied`、`purge.applied` |
| 配置与预算 | `config.reloaded`、`config.warning`、`config.error`、`budget.degraded` |
| 图鉴 | `gallery.unlocked`、`gallery.captured`、`gallery.rendered`、`gallery.removed` |

## 23. 术语表

| 中文 | English | 定义 |
|---|---|---|
| 引擎 | Engine | Animae 运行时库 |
| 机制 | Mechanism | 引擎提供的能力 |
| 策略 | Policy | 上层对机制的配置 |
| 预设 | Preset | 一组打包的策略、模板、知识和规则函数 |
| 数据根目录 | Data Root | 存放全部状态的本地目录 |
| 时间线 | Timeline | 一份只追加的事件日志 |
| 分支 | Branch | 从某个事件开出的新时间线 |
| 祖先链 | Ancestor Chain | 从根分支到当前分支的路径 |
| 存档槽 | Save Slot | 指向 `{branch, eventId}` 的指针 |
| 回溯 | Rewind | 从过去某个事件开出新分支 |
| 携带集 | Carry Set | 开分支时复制到新分支的条目过滤器 |
| 裁剪 | Prune | 删除一个没有子分支的分支 |
| 清除 | Purge | 物理删除内容并遮蔽日志中的文本 |
| 快照 | Snapshot | 可以重建的状态缓存 |
| 录制 | Recording | 按请求哈希存储的 LLM 响应 |
| 重放 | Replay | 由事件和录制重新计算状态 |
| 重播 | Playback | 按回合逐个产出历史输出 |
| 事件 | Event | 日志中的一条状态变化记录 |
| 出处 | Because | 事件引用的字段或事件 id |
| 来源 | Source | 产生事件的规则、场、提议或外部调用 |
| 提议 | Proposal | LLM 输出的待裁决内容 |
| 裁决器 | Adjudicator | 把提议转换为事件的组件 |
| 规则原语 | Rule Primitive | 引擎内置的规则构件 |
| 规则函数 | Rule Function | 上层注册的同步纯函数 |
| 阶段钩子 | Stage Hook | 替换管线某个阶段的函数 |
| 回合 | Turn | 一次输入及其处理 |
| 场景 | Scene | 一次“地点 + 参与者”的连续交互 |
| 会话 | Session | 一次引擎运行期间的游玩 |
| 世界时间 | WorldTime | `{day, minute}` |
| 历法 | Calendar | 时间单位、场景时长、章节定义 |
| 章 | Chapter | 历法中声明的天数区间 |
| 调度器 | Scheduler | 定时与周期性事件的执行器 |
| 长事件 | Long Event | 带时长和阶段的调度项 |
| 离屏模拟 | Offscreen Simulation | 玩家不在场时的世界推进 |
| 保真度 | Fidelity | 离屏模拟的档位：`none`、`rule`、`narrate`、`full` |
| 惰性补算 | Lazy Catch-up | 被观察时再补算经过的时间 |
| 角色 | Character | 引擎管理的人物实体 |
| 细节层级 | Level of Detail (LOD) | `extra`、`supporting`、`principal` |
| 晋升 | Promotion | 提升角色的细节层级 |
| 模板 | Template | 动态生成实体所用的定义 |
| 身份 | Identity | 角色的基本信息与文风 |
| 约束集 | Constraint Set | 动机、底线、禁忌 |
| 底线 | Bottom Line | 带硬度的约束条目 |
| 禁忌 | Taboo | 禁止的标签 |
| 禀赋 | Traits | 角色的属性维度与事件系数 |
| 数值轨 | Track | 一条可量化的角色状态 |
| 档位 | Tier | 数值轨的离散等级 |
| 滞回 | Hysteresis | 档位切换的缓冲区间 |
| 边际递减 | Marginal Decay | 同类事件收益随次数递减 |
| 意图 | Intent | 角色本回合的行为取向 |
| 记忆条目 | Memory Entry | 角色记忆中的一条记录 |
| 知识文档 | Knowledge Doc | 带 frontmatter 的 Markdown 文档 |
| 注入 | Injection | 把文本放入 prompt 段 |
| 检索 | Retrieval | 文本匹配与评分 |
| 遗忘 | Forgetting | 按保持度从检索中排除条目 |
| 失真 | Distortion | 检索时附加的改写指令 |
| 传播 | Propagation | 信息沿关系网扩散 |
| 反思 | Reflection | 场景结束时的 S2 提议 |
| 场 | Field | 带层级、授权和账本的修饰器 |
| 持有者 | Holder | 场所附着的实体 |
| 作用域 | Scope | 场生效的范围 |
| 层级 | Level | 场作用的对象，L0–L4 |
| 授权 | Grant | 允许某个场达到的最高层级 |
| 叠加方式 | Stacking | 同一字段的合并方式 |
| 代价 | Cost | 场到期后结算的效果 |
| 账本 | Ledger | 场相关事件的视图 |
| 自我视图 | Self-view | 角色对自身与世界的认知，可以受 L4 影响 |
| 锚点 | Anchor | 带期限的叙事目标 |
| 节拍 | Beat | 带进入与退出条件的叙事阶段 |
| 场边提示 | Sidenote | 运行时注入给角色的提示 |
| 例外通道 | Exception | 带次数限制的规则绕过机制 |
| 观察者 | Viewer | 查询状态的主体 |
| 可见性 | Visibility | 观察者对路径的读取权限 |
| 临时授权 | Temporary Grant | 带 TTL 的可见性授予 |
| 内省 | Introspection | 查询与解释引擎状态 |
| 输入类别 | Input Class | `normal`、`injection_suspect`、`meta_probe` |
| 安全分类 | Safety Classification | 可选开启的安全类别识别 |
| S1 | System 1 | 快速、低成本的模型档位 |
| S2 | System 2 | 深度推理的模型档位 |
| 路由 | Routing | 在 S1 与 S2 之间选择 |
| 升级触发器 | Escalation Trigger | 引发 S2 的条件 |
| 同步调用 | Synchronous Call | 阻塞回复的 LLM 调用 |
| 预算 | Budget | 调用与 token 的上限 |
| 降级 | Degradation | 超出预算时的处理顺序 |
| prompt 分段 | Prompt Segments | 静态段、半静态段、动态段 |
| 演出指令 | Cue | 与文本对齐的结构化演出标签 |
| 玩家选项 | Choice | 随生成产出的可选输入 |
| 骰子表达式 | Dice Expression | `NdM[kh\|klK][±C]` |
| 检定 | Check | 掷骰结果与 DC 的比较 |
| 难度等级 | Difficulty Class (DC) | 检定的目标值 |
| 优势 / 劣势 | Advantage / Disadvantage | 掷两次取较高值 / 较低值 |
| 热加载 | Hot Reload | 在回合边界重新加载作者文件 |
| 角色卡 | Character Card | 角色的导入导出包 |
| 模型端口 | ModelPort | 模型调用接口 |
| 存储端口 | StoragePort | 存储接口 |
| 向量端口 | EmbeddingPort | 向量生成接口 |
| 边车进程 | Sidecar | 通过 stdio JSON-RPC 提供服务的进程 |
| 终端界面 | TUI (Terminal User Interface) | `@animae/tui` 提供的终端游戏界面 |
| 布局 | Layout | 组织界面组件的顶层 React 组件 |
| 覆盖层 | Overlay | 叠加在主界面之上的视图，例如事件日志、时间线浏览器 |
| 主题 | Theme | 界面的颜色、边框、打字机效果等配置 |
| 打字机效果 | Typewriter | 逐字显示文本的效果 |
| cue 渲染器 | Cue Renderer | 把某种演出指令渲染到终端的函数 |
| 按键映射 | Keymap | 按键与动作的对应表 |

## 24. CG 图鉴

按 profile 共享的预设与抓拍插图槽位（跨时间线）。在 `animae.yaml` 的 `gallery` 下配置；可选 `ImagePort` 通过 FIFO 作业队列异步生成图像（并发 1，待处理上限 8）。内容**分级**（CEL `when` 与 `image.tags`）控制列表、简报、生成与分发；预设解锁可在分级暂时不可用时仍写入集合。集合文件位于 `gallery/collection.json` 与 `gallery/images/`（原子写入、损坏索引恢复、孤儿文件清理）。时间线事件记录解锁/抓拍/渲染/删除以便导出；解锁状态与图像字节以集合文件为准。公开 API：`Engine.gallery`（`GalleryService`）；RPC `gallery.*` 与 `gallery.notice`。详见 [gallery.md](./gallery.md)。
