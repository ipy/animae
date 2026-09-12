import type { Kernel, TurnCtx } from "../contracts.ts";
import type { Appraisal } from "../events.ts";
import type { CharacterId, EventDraft, EventId, SceneId, TurnChunk, TurnId } from "../types.ts";
import { AnimaeError } from "../types.ts";
import { adjudicate } from "../rules/adjudicate.ts";
import { runChecks } from "../rules/checks.ts";
import { decideIntent } from "../rules/decide.ts";
import { buildCelContext } from "../rules/cel-context.ts";
import type { RulesDeps as RD } from "../rules/deps.ts";
import { detectContradiction } from "../router/index.ts";
import { buildRecentHistory } from "./history.ts";
import type { AppraiseInput, RenderInput, RenderPart, RenderResult, SceneInfo } from "./types.ts";
import { HookRegistry } from "./hooks.ts";
import { resolveAppraiseStage, resolveRenderStage } from "./stages-default.ts";

export interface RunTurnInput {
  turnId: TurnId;
  sceneId: SceneId;
  actor: CharacterId;
  addressee: CharacterId;
  speaker: CharacterId;
  text: string;
  choiceId?: string;
  autonomous?: boolean;
  outputLocale?: string;
}

function rulesDeps(k: Kernel, p: Parameters<Kernel["celContext"]>[0]): RD {
  return {
    state: k.timeline.state(),
    authored: k.authored,
    policy: k.policy,
    cel: k.rules.cel,
    rules: k.rules,
    catalog: k.catalog,
    celContext: buildCelContext(
      { state: k.timeline.state(), authored: k.authored, policy: k.policy, catalog: k.catalog },
      { ...p, check: p.check == null ? null : (p.check as Record<string, unknown>) },
    ),
  };
}

function sceneInfo(k: Kernel): SceneInfo {
  const sc = k.timeline.state().scene!;
  const loc = k.catalog.location(sc.location);
  return {
    id: sc.id,
    location: sc.location,
    locationDescription: loc?.summary,
    participants: sc.participants,
    turn: sc.turn,
    firstTurn: sc.turn === 0,
  };
}

function fieldQuery(k: Kernel, owner: CharacterId, target: CharacterId, eventType?: string) {
  const sc = k.timeline.state().scene!;
  return {
    owner,
    target,
    eventType,
    scene: { id: sc.id, location: sc.location, participants: sc.participants, turn: sc.turn },
    ctx: k.celContext({ self: owner, other: target, actor: k.timeline.state().characters[target]?.id, sceneId: sc.id }),
  };
}

function applyInputResponse(k: Kernel, appraisal: Appraisal): { appraisal: Appraisal; forcedIntent?: string } {
  const ic = appraisal.input_class;
  if (ic === "normal") return { appraisal };
  const resp = k.policy.input.response[ic as "injection_suspect" | "meta_probe"];
  if (!resp) return { appraisal };
  let next = { ...appraisal };
  if ("emit" in resp && resp.emit) next = { ...next, type: resp.emit };
  if ("intent" in resp && resp.intent) return { appraisal: next, forcedIntent: resp.intent };
  return { appraisal: next };
}

async function* runTurnPipeline(
  k: Kernel,
  hooks: HookRegistry,
  input: RunTurnInput,
): AsyncGenerator<TurnChunk, EventId[], void> {
  const appraiseStage = resolveAppraiseStage();
  const renderStage = resolveRenderStage();
  const state = k.timeline.state();
  const scene = state.scene;
  if (!scene || scene.id !== input.sceneId) {
    throw new AnimaeError("SCENE_INVALID", "No active scene for turn");
  }

  const turnCtx: TurnCtx = {
    turnId: input.turnId,
    sceneId: input.sceneId,
    actor: input.actor,
    addressee: input.addressee,
    speaker: input.speaker,
    text: input.text,
    choiceId: input.choiceId,
    autonomous: input.autonomous ?? false,
    outputLocale: input.outputLocale ?? k.i18n.outputLocale,
  };

  const eventIds: EventId[] = [];
  let causalBecause: EventId[] = [];
  const append = async (
    drafts: EventDraft[],
    ctx?: { turn?: TurnId; scene?: SceneId; source?: string; because?: EventId[] },
  ) => {
    const ev = await k.emit(drafts, {
      turn: input.turnId,
      scene: input.sceneId,
      source: ctx?.source ?? "engine",
      because: ctx?.because ?? causalBecause,
    });
    eventIds.push(...ev.map((e) => e.id));
    return ev;
  };

  try {
    await append([{ kind: "turn.started", turn: input.turnId, actor: input.actor }]);

    const inputEvents = await append(
      [
        {
          kind: "input.received",
          source: "pipeline:input",
          actor: input.actor,
          addressee: input.addressee,
          text: input.text,
          choiceId: input.choiceId,
          autonomous: input.autonomous ?? false,
        },
      ],
      { source: "pipeline:input", because: [] },
    );
    const inputEventId = inputEvents[0]!.id;
    causalBecause = [inputEventId];
    if (input.choiceId) {
      await append(
        [
          {
            kind: "choice.taken",
            source: "pipeline:input",
            actor: input.actor,
            choiceId: input.choiceId,
          },
        ],
        { source: "pipeline:input", because: [inputEventId] },
      );
    }

    const dirTick = await k.m.director.tick("turn_start");
    if (dirTick.events.length) await append(dirTick.events, { source: "director" });

    const history = buildRecentHistory(k, input.speaker, input.addressee);
    const sceneSnap = sceneInfo(k);

    if (sceneSnap.firstTurn) {
      for (const p of scene.participants) {
        await k.m.world.catchUp({ kind: "character", id: p });
      }
      await k.m.world.catchUp({ kind: "location", id: scene.location });
    }

    let appraisalResult = await hooks.run("appraise", k, turnCtx, async () =>
      appraiseStage(k, turnCtx, {
        speaker: input.speaker,
        addressee: input.addressee,
        actor: input.actor,
        actorText: input.text,
        choiceId: input.choiceId,
        scene: sceneSnap,
        history,
        fieldEffects: k.m.fields.resolve(fieldQuery(k, input.speaker, input.addressee)).effects.L1,
      } satisfies AppraiseInput),
    );
    const appraiseOut = appraisalResult as Awaited<ReturnType<typeof appraiseStage>>;
    const appraiseEvents = await append(
      appraiseOut.drafts.map((d) => ({
        ...d,
        source: d.source ?? "pipeline:appraise",
        because: d.because ?? [inputEventId],
      })),
      { source: "pipeline:appraise", because: [inputEventId] },
    );
    const appraisalEventId = appraiseEvents.find((e) => e.kind === "appraisal")?.id ?? inputEventId;
    causalBecause = [appraisalEventId];

    let appraisal = { ...appraiseOut.appraisal };
    const inputOverride = applyInputResponse(k, appraisal);
    appraisal = inputOverride.appraisal;
    turnCtx.appraisal = appraisal;

    if (appraiseOut.safety) {
      let mode = k.policy.safety.response;
      if (mode.startsWith("hook:")) {
        const fn = mode.slice("hook:".length);
        const deps = rulesDeps(k, {
          self: input.speaker,
          other: input.addressee,
          actor: input.actor,
          event: appraisal,
          sceneId: input.sceneId,
        });
        const hookDrafts = k.rules.run(fn, {
          ...deps,
          stage: "safety",
          time: k.timeline.now(),
          vars: deps.celContext,
          rngKey: `safety:${input.turnId}`,
        });
        if (hookDrafts.length) await append(hookDrafts, { source: "rules" });
      }
      if (mode === "block") {
        const refusal = "I can't continue with that.";
        yield { type: "text", text: refusal, speaker: input.speaker, autonomous: input.autonomous };
        await append([{ kind: "utterance", speaker: input.speaker, text: refusal, cues: [], addressee: input.addressee }]);
        await append([{ kind: "turn.ended", turn: input.turnId }]);
        yield { type: "done", turnId: input.turnId, events: eventIds, speaker: input.speaker };
        return eventIds;
      }
      if (mode === "out_of_character_notice") {
        const notice = "Let's keep things appropriate for this story.";
        yield { type: "text", text: notice, speaker: input.speaker, autonomous: input.autonomous };
      }
    }

    const l01 = (await hooks.run("applyFields", k, turnCtx, async () =>
      k.m.fields.resolve(fieldQuery(k, input.speaker, input.addressee, appraisal.type)),
    )) as ReturnType<Kernel["m"]["fields"]["resolve"]>;
    await append(
      l01.events.map((d) => ({ ...d, because: d.because ?? [appraisalEventId] })),
      { source: "fields" },
    );

    const checkOut = await hooks.run("check", k, turnCtx, async () => {
      const deps = rulesDeps(k, {
        self: input.speaker,
        other: input.addressee,
        actor: input.actor,
        event: appraisal,
        sceneId: input.sceneId,
      });
      return runChecks(deps, {
        appraisal,
        actor: input.actor,
        owner: input.speaker,
        sceneId: input.sceneId,
        turnId: input.turnId,
        fieldEffects: l01.effects.L1,
        rng: k.timeline.rng(`check:${input.turnId}`),
      });
    });
    const checks = checkOut as ReturnType<typeof runChecks>;
    appraisal = checks.appraisal;
    turnCtx.appraisal = appraisal;
    await append(
      checks.drafts.map((d) => ({
        ...d,
        source: d.source ?? "rules:check",
        because: d.because ?? [appraisalEventId],
      })),
      { source: "rules:check", because: [appraisalEventId] },
    );

    const adjOut = await hooks.run("adjudicate", k, turnCtx, async () => {
      const deps = rulesDeps(k, {
        self: input.speaker,
        other: input.addressee,
        actor: input.actor,
        event: appraisal,
        sceneId: input.sceneId,
      });
      return adjudicate(deps, {
        appraisal,
        actor: input.actor,
        owner: input.speaker,
        turnId: input.turnId,
        fieldEffects: l01.effects.L1,
        rng: k.timeline.rng(`adj:${input.turnId}`),
        check: checks.result ?? null,
      });
    });
    const adj = adjOut as ReturnType<typeof adjudicate>;
    await append(
      adj.drafts.map((d) => ({
        ...d,
        source: d.source ?? "rules:adjudicate",
        because: d.because ?? [appraisalEventId],
      })),
      { source: "rules:adjudicate", because: [appraisalEventId] },
    );

    const l2 = (await hooks.run("applyFields", k, turnCtx, async () =>
      k.m.fields.resolve(fieldQuery(k, input.speaker, input.addressee, appraisal.type)),
    )) as ReturnType<Kernel["m"]["fields"]["resolve"]>;
    await append(
      l2.events.map((d) => ({ ...d, because: d.because ?? [appraisalEventId] })),
      { source: "fields" },
    );

    const intentOut = await hooks.run("decide", k, turnCtx, async () => {
      const deps = rulesDeps(k, {
        self: input.speaker,
        other: input.addressee,
        actor: input.actor,
        event: appraisal,
        sceneId: input.sceneId,
      });
      return decideIntent(deps, {
        owner: input.speaker,
        actor: input.actor,
        appraisal,
        sceneId: input.sceneId,
        fieldEffects: l2.effects.L2,
      });
    });
    const intent = intentOut as ReturnType<typeof decideIntent>;
    if (inputOverride.forcedIntent) intent.intent = inputOverride.forcedIntent;
    await append(
      [
        {
          kind: "intent.decided",
          source: "rules:decide",
          owner: input.speaker,
          intent: intent.intent,
          scores: intent.scores,
          forced: intent.forced,
        },
      ],
      { source: "rules:decide", because: [appraisalEventId] },
    );

    const sidenotes = k.m.director.sidenotesFor(input.speaker);
    const sidenoteReceived = sidenotes.length > 0;
    const contradiction = detectContradiction(k, input.speaker, appraisal.claims);

    const speakerMood = k.timeline.state().characters[input.speaker]?.tracks.self.mood;
    const routeOut = await hooks.run("route", k, turnCtx, async () =>
      k.m.router.decide({
        turn: turnCtx,
        appraisal,
        anchorNear: dirTick.anchorNear,
        fieldMaxLevel: l01.maxLevel,
        tierChanged: adj.tierChanged,
        moodDelta: adj.moodDelta,
        mood: speakerMood,
        sidenoteReceived,
        sceneFirstTurn: sceneSnap.firstTurn,
        secretTopic: appraisal.tags.includes("secret"),
        contradiction,
        autonomous: turnCtx.autonomous,
      }),
    );
    const route = routeOut as ReturnType<Kernel["m"]["router"]["decide"]>;
    await append(route.events);

    let extraDynamic = "";
    if (appraiseOut.safety && k.policy.safety.response === "in_character") {
      extraDynamic = "Safety: stay in character while de-escalating.";
    }

    const renderInput: RenderInput = {
      tier: route.decision.tier,
      speaker: input.speaker,
      addressee: input.addressee,
      intent: { intent: intent.intent, scores: intent.scores, forced: intent.forced },
      appraisal,
      fieldEffects: l01.effects.L1,
      scene: sceneSnap,
      history,
      sidenotes,
      extraDynamic,
    };

    let renderResult: RenderResult | undefined;
    const runRenderDefault = async (): Promise<{ result: RenderResult; parts: RenderPart[] }> => {
      const gen = renderStage(k, turnCtx, renderInput);
      const parts: RenderPart[] = [];
      while (true) {
        const step = await gen.next();
        if (step.done) return { result: step.value, parts };
        parts.push(step.value);
      }
    };
    const renderOut = (await hooks.run("render", k, turnCtx, runRenderDefault)) as {
      result: RenderResult;
      parts: RenderPart[];
    };
    renderResult = renderOut.result;
    for (const part of renderOut.parts) {
      if (part.type === "text") {
        yield { type: "text", text: part.text, speaker: input.speaker, autonomous: input.autonomous };
      } else if (part.type === "cue") {
        yield {
          type: "cue",
          cue: part.cue,
          at: part.at,
          speaker: input.speaker,
        };
      }
    }

    if (!renderResult) throw new AnimaeError("RENDER_FAILED", "Render stage produced no result");

    if (renderResult.choiceDrafts.length) await append(renderResult.choiceDrafts);
    if (renderResult.mismatchDraft) await append([renderResult.mismatchDraft]);
    if (renderResult.choices.length) {
      yield { type: "choices", choices: renderResult.choices };
    }

    await hooks.run("commit", k, turnCtx, async () => {
      await append([
        {
          kind: "utterance",
          speaker: input.speaker,
          text: renderResult!.text,
          cues: renderResult!.cues,
          addressee: input.addressee,
          intent: intent.intent,
          autonomous: input.autonomous,
        },
      ]);
      await k.m.director.afterRender(input.speaker, renderResult!.text);

      const writePolicy = k.policy.memory.write ?? { episodic: true, minIntensity: 0.2, maxChars: 240 };
      if (writePolicy.episodic && appraisal.intensity >= (writePolicy.minIntensity ?? 0)) {
        const valence = Math.sign(adj.moodDelta ?? 0);
        await k.m.memory.write(input.speaker, {
          kind: "episodic",
          t: k.timeline.now(),
          text: renderResult!.text.slice(0, writePolicy.maxChars ?? 240),
          tags: appraisal.tags,
          claims: appraisal.claims,
          importance: appraisal.intensity,
          valence,
          src: eventIds.at(-1),
        });
      }

      await k.m.entities.checkPromotions([input.speaker]);
      for (const ev of await k.m.fields.onTurnEnd()) eventIds.push(ev.id);
      const mins = k.authored.world.calendar.turnMinutes;
      if (mins > 0) {
        for (const ev of await k.m.world.advance(mins, "turn")) eventIds.push(ev.id);
      }
      const endTick = await k.m.director.tick("turn_end");
      for (const ev of endTick.events) eventIds.push(ev.id);
      await append([{ kind: "turn.ended", turn: input.turnId }]);
      await k.timeline.maybeSnapshot("count");
      return undefined;
    });

    const turnEventIds = k.timeline.eventsByTurn(input.turnId).map((e) => e.id);
    yield { type: "done", turnId: input.turnId, events: turnEventIds, speaker: input.speaker };
    return turnEventIds;
  } catch (err) {
    await append([{ kind: "turn.ended", turn: input.turnId, error: String(err) }]).catch(() => undefined);
    if (err instanceof AnimaeError) throw err;
    throw new AnimaeError("TURN_FAILED", err instanceof Error ? err.message : String(err), { turnId: input.turnId });
  }
}

export async function* runTurn(
  k: Kernel,
  hooks: HookRegistry,
  input: RunTurnInput,
): AsyncGenerator<TurnChunk, void, void> {
  yield* runTurnPipeline(k, hooks, input);
}
