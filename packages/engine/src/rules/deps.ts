import type { Catalog, CelEngine, RuleEngine } from "../contracts.ts";
import type { Authored, FieldEffects } from "../schema/authored.ts";
import type { ResolvedPolicy } from "../schema/policy.ts";
import type { EngineState } from "../state.ts";
import type { CelContext } from "../types.ts";

export interface RulesDeps {
  state: Readonly<EngineState>;
  authored: Readonly<Authored>;
  policy: Readonly<ResolvedPolicy>;
  cel: CelEngine;
  rules: RuleEngine;
  catalog: Catalog;
  celContext: CelContext;
  /** Merged L0–L4 field effects for CEL `fields.*` (e.g. `fields.event_prob`). */
  fieldEffects?: FieldEffects;
}

export type { FieldEffects };
