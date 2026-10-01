import type { FieldQuery, FieldSystem, Kernel, LedgerEntry } from "../contracts.ts";
import type { EngineEvent, EventDraft } from "../types.ts";
import { clampEffects } from "./caps.ts";
import { grantAllowed } from "./grants.ts";
import { validateFieldL3Effects } from "./l3-validate.ts";
import { emptyEffectsByLevel, levelIndex, LEVELS } from "./levels.ts";
import { mergeFieldEffects } from "./merge.ts";
import { scopeMatches } from "./scope.ts";
import type { FieldCustomRule } from "../schema/custom-rule.ts";
import type { FieldDef } from "../schema/authored.ts";

function collectL3FieldRules(fields: FieldDef[]): FieldCustomRule[] {
  const sorted = [...fields].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const ordered: FieldCustomRule[] = [];
  for (const f of sorted) {
    for (const entry of f.effects.rule_add ?? []) {
      ordered.push({ ...entry, fieldId: f.id });
    }
  }
  const lastIndex = new Map<string, number>();
  ordered.forEach((r, i) => lastIndex.set(r.id, i));
  return ordered.filter((r, i) => lastIndex.get(r.id) === i);
}

type TrackedField = { def: FieldDef; turnsActive: number };

export function createFieldSystem(k: Kernel, opts?: { bypassArmed?: (what: string) => boolean }): FieldSystem {
  const declared: Record<string, FieldDef> = {};
  const sessionActive: Record<string, TrackedField> = {};
  const resolveDedupe = new Map<string, string>();

  function bypassCap(): boolean {
    return opts?.bypassArmed?.("field_cap") ?? false;
  }
  function bypassCost(): boolean {
    return opts?.bypassArmed?.("cost_due") ?? false;
  }

  function scopeCtx(q: FieldQuery, extra?: { turnsElapsed?: number; scenesElapsed?: number; turnsActive?: number }) {
    const state = k.timeline.state();
    const scene = q.scene
      ? { id: q.scene.id, location: q.scene.location, participants: q.scene.participants, turn: q.scene.turn }
      : state.scene
        ? {
            id: state.scene.id,
            location: state.scene.location,
            participants: state.scene.participants,
            turn: state.scene.turn,
          }
        : undefined;
    return {
      scene,
      owner: q.owner,
      target: q.target,
      cel: k.rules.cel,
      celCtx: q.ctx,
      state,
      now: k.timeline.now(),
      ...extra,
    };
  }

  function collectApplicable(q: FieldQuery): FieldDef[] {
    const out: FieldDef[] = [];
    const tryAdd = (def: FieldDef, meta?: { turnsElapsed?: number; scenesElapsed?: number; turnsActive?: number }) => {
      if (!scopeMatches(def, scopeCtx(q, meta))) return;
      out.push(def);
    };

    const state = k.timeline.state();
    for (const def of Object.values(k.authored.fields)) {
      const tr = sessionActive[def.id];
      tryAdd(def, { turnsActive: tr?.turnsActive ?? 0 });
    }
    for (const def of Object.values(declared)) {
      const tr = sessionActive[def.id];
      tryAdd(def, { turnsActive: tr?.turnsActive ?? 0 });
    }
    for (const af of Object.values(state.fields)) {
      tryAdd(af.def, { turnsElapsed: af.turnsElapsed, scenesElapsed: af.scenesElapsed });
    }
    return out;
  }

  function bumpSessionTurnCounters(): void {
    const state = k.timeline.state();
    if (!state.scene) return;
    const probe = scopeCtx({ ctx: k.celContext({ sceneId: state.scene.id }) });
    for (const def of [...Object.values(k.authored.fields), ...Object.values(declared)]) {
      if (!def.scope.turns) continue;
      if (!scopeMatches(def, { ...probe, turnsActive: sessionActive[def.id]?.turnsActive ?? 0 })) continue;
      const tr = sessionActive[def.id] ?? { def, turnsActive: 0 };
      sessionActive[def.id] = tr;
    }
    for (const tr of Object.values(sessionActive)) {
      tr.turnsActive += 1;
    }
  }

  function resolve(q: FieldQuery) {
    const applicable = collectApplicable(q);
    const byLevel: Record<string, FieldDef[]> = { L0: [], L1: [], L2: [], L3: [], L4: [] };
    for (const f of applicable) byLevel[f.level]?.push(f);
    for (const lvl of LEVELS) byLevel[lvl]!.sort((a, b) => b.priority - a.priority);

    const caps = k.policy.fields?.caps;
    const effects = emptyEffectsByLevel();
    const applied: { id: string; level: string; clamped: string[] }[] = [];
    const events: EventDraft[] = [];
    let maxLevel = 0;

    const turnKey = `${q.scene?.turn ?? k.timeline.state().scene?.turn ?? "none"}|${q.owner ?? ""}`;

    for (const lvl of LEVELS) {
      const fields = byLevel[lvl]!;
      if (fields.length === 0) continue;
      maxLevel = Math.max(maxLevel, levelIndex(lvl));
      const merged = mergeFieldEffects(fields, k, q.ctx as Record<string, unknown>);
      const { effects: levelFx, clamped: levelClamped } = clampEffects(merged, caps, bypassCap());
      effects[lvl] = levelFx;

      for (const f of fields) {
        const { effects: fx, clamped } = clampEffects(f.effects, caps, bypassCap());
        const holderKey = `${f.holder.kind}:${f.holder.ref ?? ""}`;
        const sig = JSON.stringify({ effects: fx, clamped });
        const dedupeKey = `${turnKey}|${f.id}`;
        if (resolveDedupe.get(dedupeKey) === sig) continue;
        resolveDedupe.set(dedupeKey, sig);

        events.push({
          kind: "field.applied",
          source: `field:${f.id}`,
          field: f.id,
          level: lvl,
          holder: holderKey,
          effects: fx,
          clamped: clamped.length ? clamped : levelClamped.length ? levelClamped : undefined,
          owner: lvl === "L4" ? q.owner : undefined,
        });
        applied.push({ id: f.id, level: lvl, clamped: clamped.length ? clamped : levelClamped });
      }
    }

    const l3FieldRules = collectL3FieldRules(byLevel.L3 ?? []);
    return { effects, applied, maxLevel, events, l3FieldRules };
  }

  async function grant(f: FieldDef, why?: { source: string; because?: string[] }): Promise<LedgerEntry> {
    validateFieldL3Effects(k, f);
    const source = why?.source ?? f.source;
    if (!grantAllowed(f, source, k.policy, k.rules.cel)) {
      const evs = await k.emit(
        [{ kind: "field.rejected", field: f.id, level: f.level, source, reason: "grant_denied" }],
        { source: why?.source ?? "fields" },
      );
      const e = evs[0]!;
      return { eventId: e.id, kind: "field.rejected", field: f.id, detail: { level: f.level, source } };
    }
    const evs = await k.emit([{ kind: "field.granted", field: f }], {
      source: why?.source ?? "fields",
      because: why?.because,
    });
    const e = evs[0]!;
    return { eventId: e.id, kind: "field.granted", field: f.id, detail: { level: f.level, source } };
  }

  async function revoke(id: string, why?: { source: string }): Promise<void> {
    await k.emit([{ kind: "field.revoked", field: id }], { source: why?.source ?? "fields" });
  }

  function declare(f: FieldDef): void {
    validateFieldL3Effects(k, f);
    declared[f.id] = f;
  }

  function ledger(): EngineEvent[] {
    return k.timeline.events().filter((e) => e.kind.startsWith("field."));
  }

  async function processCosts(when: "turn_end" | "scene_end"): Promise<EngineEvent[]> {
    const ageDrafts: EventDraft[] = [];
    const state = k.timeline.state();

    if (when === "scene_end") {
      for (const id of Object.keys(state.fields)) ageDrafts.push({ kind: "field.age", field: id, scenes: 1 });
    } else {
      for (const id of Object.keys(state.fields)) ageDrafts.push({ kind: "field.age", field: id, turns: 1 });
      bumpSessionTurnCounters();
    }

    let events: EngineEvent[] = ageDrafts.length ? await k.emit(ageDrafts, { source: "fields" }) : [];

    const state2 = k.timeline.state();
    const drafts: EventDraft[] = [];
    for (const [id, af] of Object.entries(state2.fields)) {
      const def = af.def;
      if (!def.cost || af.cost?.settled) continue;

      const ctx = k.celContext({ extra: { field: def, payer: def.cost.payer } });
      let due = false;
      if (bypassCost()) {
        due = false;
      } else if (def.cost.due) {
        due = k.rules.cel.bool(def.cost.due, ctx);
      } else if (when === "scene_end") {
        const stillInScope = scopeMatches(def, scopeCtx({ ctx }, { turnsElapsed: af.turnsElapsed, scenesElapsed: af.scenesElapsed }));
        due = !stillInScope;
      }

      if (!due && def.cost.ttlScenes && af.scenesElapsed >= def.cost.ttlScenes && !af.cost?.due) due = true;

      if (due && !af.cost?.due) {
        drafts.push({ kind: "field.cost_due", field: id, payer: def.cost.payer, dueScene: state2.scene?.id });
      } else if (af.cost?.due && !af.cost.settled) {
        const useFallback = af.scenesElapsed >= (def.cost.ttlScenes ?? 3);
        const via = bypassCost() ? "bypassed" : useFallback ? "fallback" : "paid";
        if (via === "paid" && def.cost.effects) {
          drafts.push({
            kind: "field.applied",
            field: id,
            level: def.level,
            holder: `${def.holder.kind}:${def.holder.ref ?? ""}`,
            effects: def.cost.effects,
            source: `field:${id}:cost`,
          });
        }
        if (via === "fallback" && def.cost.fallback?.effects) {
          drafts.push({
            kind: "field.applied",
            field: id,
            level: def.level,
            holder: `${def.holder.kind}:${def.holder.ref ?? ""}`,
            effects: def.cost.fallback.effects,
            source: `field:${id}:fallback`,
          });
        }
        if (via === "paid" && def.cost.events) drafts.push(...def.cost.events);
        if (via === "fallback" && def.cost.fallback?.events) drafts.push(...def.cost.fallback.events);
        drafts.push({ kind: "field.cost_settled", field: id, payer: def.cost.payer, via });
      }
    }

    if (drafts.length) events = events.concat(await k.emit(drafts, { source: "fields" }));
    return events;
  }

  return {
    resolve,
    grant,
    revoke,
    declare,
    ledger,
    onTurnEnd: () => processCosts("turn_end"),
    onSceneEnd: () => processCosts("scene_end"),
  };
}
