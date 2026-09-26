import type { ActiveScene, Kernel, SceneReport } from "../contracts.ts";
import type { CharacterId, SceneId, TurnChunk } from "../types.ts";
import { AnimaeError } from "../types.ts";
import { runStageRules } from "../rules/stages.ts";
import { buildCelContext } from "../rules/cel-context.ts";
import { formatSceneId, formatTurnId } from "../engine/ids.ts";
import { HookRegistry } from "../pipeline/hooks.ts";
import { runTurn } from "../pipeline/run-turn.ts";
import { resolveEntityRef } from "../entities/names.ts";

export interface SceneService {
  start(s: { location: string; participants: string[]; fields?: string[] }): Promise<SceneId>;
  turn(t: {
    sceneId: SceneId;
    actor: string;
    text: string;
    addressee?: string;
    choiceId?: string;
    outputLocale?: string;
  }): AsyncIterable<TurnChunk>;
  end(sceneId: SceneId): Promise<SceneReport>;
  active(): ActiveScene | null;
}

export function createSceneService(
  k: Kernel,
  hooks: HookRegistry,
  opts?: { afterTurn?: () => Promise<void>; afterSceneEnd?: () => Promise<void> },
): SceneService {
  let turnInFlight = false;

  /** A rule can end the scene part-way through a turn (a stop word, a scripted ending); nothing follows an ended scene. */
  function stillOpen(sceneId: SceneId): boolean {
    return k.timeline.state().scene?.id === sceneId;
  }

  function pickSpeaker(actor: string, addressee: string | undefined, participants: CharacterId[]): CharacterId {
    const player = k.authored.world.player;
    const tt = k.policy.scene.turnTaking;
    if (tt === "round_robin") {
      const npcs = participants.filter((p) => p !== player);
      const idx = k.timeline.state().scene?.turn ?? 0;
      return npcs[idx % npcs.length] ?? npcs[0] ?? actor;
    }
    if (typeof tt === "object" && tt !== null && "priority" in tt) {
      const npcs = participants.filter((p) => p !== player);
      const ctx = buildCelContext(
        { state: k.timeline.state(), authored: k.authored, policy: k.policy, catalog: k.catalog },
        {},
      );
      for (const id of npcs) {
        const cctx = { ...ctx, self: k.celContext({ self: id }).self };
        if (k.rules.cel.bool(tt.priority, cctx)) return id;
      }
      return npcs[0] ?? actor;
    }
    if (addressee && participants.includes(addressee) && addressee !== actor) return addressee;
    const npcs = participants.filter((p) => p !== player);
    return npcs[0] ?? actor;
  }

  function nextAutonomousSpeaker(participants: CharacterId[], prev: CharacterId): CharacterId {
    const player = k.authored.world.player;
    const order = participants.filter((p) => p !== player);
    const idx = order.indexOf(prev);
    return order[(idx + 1) % order.length] ?? prev;
  }

  return {
    async start(s) {
      if (k.timeline.state().scene && !k.timeline.state().scene?.ended) {
        throw new AnimaeError("SCENE_ACTIVE", "A scene is already active");
      }
      const loc = k.catalog.location(s.location);
      if (!loc) throw new AnimaeError("CONFIG_INVALID", `Unknown location "${s.location}"`);
      for (const p of s.participants) {
        if (!k.catalog.character(p)) throw new AnimaeError("CONFIG_INVALID", `Unknown participant "${p}"`);
      }

      const player = k.authored.world.player;
      await k.m.world.move(player, s.location);
      for (const p of s.participants) {
        await k.m.world.catchUp({ kind: "character", id: p });
      }
      await k.m.world.catchUp({ kind: "location", id: s.location });
      await k.m.memory.flushDeferred();

      const sceneId = formatSceneId(k.timeline.state().sceneCount + 1);
      await k.emit([
        {
          kind: "scene.started",
          sceneId,
          location: s.location,
          participants: s.participants,
          fields: s.fields ?? [],
        },
      ]);

      await k.m.director.tick("scene_start");
      const deps = {
        state: k.timeline.state(),
        authored: k.authored,
        policy: k.policy,
        cel: k.rules.cel,
        rules: k.rules,
        catalog: k.catalog,
        celContext: buildCelContext(
          { state: k.timeline.state(), authored: k.authored, policy: k.policy, catalog: k.catalog },
          { sceneId },
        ),
      };
      await k.emit(runStageRules(deps, "scene_start", deps.celContext));

      return sceneId;
    },

    async *turn(t) {
      if (turnInFlight) throw new AnimaeError("TURN_IN_FLIGHT", "Only one turn at a time");
      const scene = k.timeline.state().scene;
      if (!scene || scene.id !== t.sceneId || scene.ended) {
        throw new AnimaeError("SCENE_INVALID", "Scene not active");
      }
      turnInFlight = true;
      try {
        const resolvedAddressee = (() => {
          if (!t.addressee) return undefined;
          if (scene.participants.includes(t.addressee)) return t.addressee;
          try {
            return resolveEntityRef(k.timeline.state(), k.catalog, t.addressee, { scope: scene.participants }).id;
          } catch {
            return t.addressee;
          }
        })();
        const addressee =
          resolvedAddressee && scene.participants.includes(resolvedAddressee)
            ? resolvedAddressee
            : pickSpeaker(t.actor, resolvedAddressee, scene.participants);
        const speaker = pickSpeaker(t.actor, addressee, scene.participants);
        const turnId = formatTurnId(k.timeline.state().turnCount + 1);

        yield* runTurn(k, hooks, {
          turnId,
          sceneId: t.sceneId,
          actor: t.actor,
          addressee,
          speaker,
          text: t.text,
          choiceId: t.choiceId,
          autonomous: false,
          outputLocale: t.outputLocale,
        });
        await opts?.afterTurn?.();
        if (!stillOpen(t.sceneId)) return;

        const auto = k.policy.scene.autonomous ?? { maxExchangesPerPlayerTurn: 0, when: "true" };
        const maxEx = auto.maxExchangesPerPlayerTurn ?? 0;
        if (maxEx <= 0) return;

        const ctx = buildCelContext(
          { state: k.timeline.state(), authored: k.authored, policy: k.policy, catalog: k.catalog },
          { sceneId: t.sceneId },
        );
        if (!k.rules.cel.bool(auto.when, ctx)) return;

        let prevSpeaker = speaker;
        for (let i = 0; i < maxEx; i++) {
          const allow = k.m.router.allow("autonomous");
          if (allow.events.length) await k.emit(allow.events);
          if (!allow.ok) break;

          const nextSpeaker = nextAutonomousSpeaker(scene.participants, prevSpeaker);
          const nextAddressee = nextAutonomousSpeaker(scene.participants, nextSpeaker);
          const autoTurnId = formatTurnId(k.timeline.state().turnCount + 1);
          yield* runTurn(k, hooks, {
            turnId: autoTurnId,
            sceneId: t.sceneId,
            actor: prevSpeaker,
            addressee: nextAddressee,
            speaker: nextSpeaker,
            text: "",
            autonomous: true,
            // The exchange is part of this player turn, so it is narrated in the same language.
            outputLocale: t.outputLocale,
          });
          await opts?.afterTurn?.();
          if (!stillOpen(t.sceneId)) return;
          prevSpeaker = nextSpeaker;
        }
      } finally {
        turnInFlight = false;
      }
    },

    active() {
      const scene = k.timeline.state().scene;
      if (!scene || scene.ended) return null;
      return {
        id: scene.id,
        location: scene.location,
        participants: [...scene.participants],
        turn: scene.turn,
      };
    },

    async end(sceneId) {
      const scene = k.timeline.state().scene;
      if (!scene || scene.id !== sceneId) throw new AnimaeError("SCENE_INVALID", "Scene not active");

      const sceneMinutes = k.authored.world.calendar.sceneMinutes;
      const started = scene.startedAt;
      const now = k.timeline.now();
      const elapsed = (now.day - started.day) * 1440 + (now.minute - started.minute);
      if (elapsed < sceneMinutes) {
        await k.m.world.advance(sceneMinutes - elapsed, "scene_min");
      }

      await k.m.fields.onSceneEnd();
      const participants = [...scene.participants];
      await k.emit([{ kind: "scene.ended", sceneId }]);

      const reflectAllow = k.m.router.allow("reflection");
      if (reflectAllow.events.length) await k.emit(reflectAllow.events);
      const reflections = await k.m.memory.reflect(sceneId, {
        defer: !reflectAllow.ok,
        participants,
      });

      await k.m.memory.propagateTick();
      await k.timeline.maybeSnapshot("scene_end");
      await opts?.afterSceneEnd?.();

      const anchors = Object.entries(k.timeline.state().anchors).map(([id, st]) => ({
        id,
        status: st.status,
      }));

      return {
        sceneId,
        turns: scene.turn,
        events: k.timeline.events().filter((e) => e.scene === sceneId).length,
        reflections,
        anchors,
      };
    },
  };
}
