import type { Kernel } from "../contracts.ts";
import type { EntityAliasSet } from "../events.ts";
import type { EntityRef } from "../types.ts";
import { AnimaeError } from "../types.ts";
import {
  assertAliasUniqueInScope,
  normalizeAliasKey,
  resolveEntityRef,
  validateAliasLabel,
  type ResolveEntityOptions,
  type ResolvedCharacterRef,
} from "./names.ts";
import { buildCharacterSpecFromBrief, type GenerationBrief, type GenerationPools } from "./generate-brief.ts";
import type { CharacterId } from "../types.ts";
import { spawnSpecToPayload, validateSpawnSpec, type SpawnEntitySpec } from "./spawn.ts";

export async function setEntityAlias(
  k: Kernel,
  input: {
    entity: string;
    nickname?: string | null;
    alias?: string;
    by: string | "player";
    target?: string;
    addressLabel?: string;
  },
): Promise<void> {
  const resolved = resolveEntityRef(k.timeline.state(), k.catalog, input.entity);
  const entityId = resolved.id;
  const payload: EntityAliasSet = { entity: entityId };

  if (input.nickname !== undefined) {
    if (input.nickname === null) payload.nickname = null;
    else {
      validateAliasLabel(input.nickname);
      assertAliasUniqueInScope(k.timeline.state(), k.catalog, entityId, input.nickname, entityId);
      payload.nickname = { label: input.nickname.trim(), by: input.by as CharacterId | "player" };
    }
  }
  if (input.alias) {
    validateAliasLabel(input.alias);
    assertAliasUniqueInScope(k.timeline.state(), k.catalog, entityId, input.alias);
    payload.alias = { key: normalizeAliasKey(input.alias), label: input.alias.trim(), by: input.by as CharacterId | "player" };
  }
  if (input.target && input.addressLabel) {
    validateAliasLabel(input.addressLabel);
    const targetRef = resolveEntityRef(k.timeline.state(), k.catalog, input.target);
    payload.addressAs = {
      target: targetRef.id,
      label: input.addressLabel.trim(),
      by: input.by as CharacterId | "player",
    };
  }

  await k.emit([{ kind: "entity.alias_set", ...payload }], { source: "entities.setAlias" });
}

export function resolveEntity(k: Kernel, ref: string, opts?: ResolveEntityOptions): ResolvedCharacterRef {
  return resolveEntityRef(k.timeline.state(), k.catalog, ref, opts);
}

export async function spawnEntity(
  k: Kernel,
  specRaw: SpawnEntitySpec,
  opts?: { reason?: string; id?: string },
): Promise<EntityRef> {
  const spec = validateSpawnSpec(specRaw);
  const seq = (k.timeline.state().entitySeq ?? 0) + 1;
  const { ref, specJson, data } = spawnSpecToPayload(k, spec, { id: opts?.id });
  await k.emit(
    [
      {
        kind: "entity.spawned",
        entity: ref,
        spec: specJson,
        data,
        reason: opts?.reason,
        entitySeq: seq,
        source: opts?.reason ?? "entities.spawn",
      },
    ],
    { source: opts?.reason ?? "entities.spawn" },
  );
  return ref;
}

export async function retireEntity(k: Kernel, ref: string, opts?: { reason?: string }): Promise<void> {
  const resolved = resolveEntityRef(k.timeline.state(), k.catalog, ref);
  await k.emit(
    [
      {
        kind: "entity.retired",
        entity: { kind: "character", id: resolved.id },
        reason: opts?.reason,
        source: opts?.reason ?? "entities.retire",
      },
    ],
    { source: opts?.reason ?? "entities.retire" },
  );
}

export async function generateFromBrief(
  k: Kernel,
  brief: GenerationBrief,
  opts?: { pools?: GenerationPools; reason?: string },
): Promise<EntityRef> {
  const spec = await buildCharacterSpecFromBrief(k, brief, opts);
  return spawnEntity(k, spec, { reason: opts?.reason ?? "entities.generateFromBrief" });
}
