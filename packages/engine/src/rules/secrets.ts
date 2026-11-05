import type { Kernel } from "../contracts.ts";
import type { CharacterId, EventDraft, SceneId } from "../types.ts";

/**
 * Evaluates the `unlock` expression of every still-locked secret of `owner` and returns one
 * `character.secret_unlocked` draft per secret whose expression holds.
 *
 * The context is the one the adjudication stage uses: `self` is `owner`, `other` and `actor` are the character the owner
 * is dealing with, so `tracks.<name>` is the owner's track toward that character (`tracks.trust >= 50`). A secret that
 * authors no `unlock` expression keeps the schema default (`false`) and never unlocks by itself. Unlocking is permanent.
 */
export function secretUnlockDrafts(
  k: Pick<Kernel, "timeline" | "catalog" | "celContext" | "rules">,
  owner: CharacterId,
  other: CharacterId,
  sceneId?: SceneId,
): EventDraft[] {
  const def = k.catalog.character(owner);
  const st = k.timeline.state().characters[owner];
  if (!def || !st || def.secrets.length === 0) return [];
  const locked = def.secrets.filter((s) => !st.unlockedSecrets.includes(s.id));
  if (locked.length === 0) return [];
  const ctx = k.celContext({ self: owner, other, actor: other, sceneId });
  return locked
    .filter((s) => k.rules.cel.bool(s.unlock, ctx))
    .map((s) => ({ kind: "character.secret_unlocked", source: "rules:secrets", character: owner, secret: s.id }));
}
