import { isSecretTopic, lockedSecretTags } from "../authored/characters.ts";
import type { Kernel, RetrievalHit, TurnCtx } from "../contracts.ts";
import type { Appraisal, RetrievalLogHit } from "../events.ts";
import type { CharacterId, EventDraft, EventId, SceneId, TurnChunk, TurnId } from "../types.ts";
import { AnimaeError } from "../types.ts";
import { writeNarrationMemory, writeTurnMemory } from "../memory/writing.ts";
import { currentMode } from "../model/select.ts";
import { narrationDraft } from "../narration.ts";
import type { RuntimeMode } from "../runtime/types.ts";
import { adjudicate } from "../rules/adjudicate.ts";
import { runChecks } from "../rules/checks.ts";
import { decideIntent } from "../rules/decide.ts";
import { secretUnlockDrafts } from "../rules/secrets.ts";
import { mergeEffectsByLevel } from "../fields/levels.ts";
import { buildCelContext } from "../rules/cel-context.ts";
import type { RulesDeps as RD } from "../rules/deps.ts";
import { detectContradiction } from "../router/index.ts";
import { routerTriggers } from "../router/policy-access.ts";
import { buildRecentHistory } from "./history.ts";
import type { AppraiseInput, RenderInput, RenderPart, RenderResult, SceneInfo } from "./types.ts";
import { HookRegistry } from "./hooks.ts";
import { getPromptSection } from "../prompts/index.ts";
import { resolveAppraiseStage, resolveRenderStage } from "./stages-default.ts";

function joinPromptExtra(base: string, extra: string | undefined): string {
  const tail = extra?.trim();
  if (!base.trim()) return tail ?? "";
  if (!tail) return base;
  return `${base.trim()}\n\n${tail}`;
}

function choiceTextFromTimeline(k: Kernel, choiceId: string): string | undefined {
  for (let i = k.timeline.events().length - 1; i >= 0; i--) {
    const e = k.timeline.events()[i];
    if (!e || e.kind !== "choice.offered") continue;
    const choices = (e as { choices?: { id: string; text: string }[] }).choices ?? [];
    const hit = choices.find((c) => c.id === choiceId);
    if (hit?.text) return hit.text;
  }
  return undefined;
}

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
  /** S2 tier the caller already settled on (an autonomous exchange the router lowered); only used while S2 is on a model */
  s2Tier?: string;
}

function rulesDeps(
  k: Kernel,
  p: Parameters<Kernel["celContext"]>[0],
  playerText?: string,
  fieldEffects?: import("../schema/authored.ts").FieldEffects,
): RD {
  const event =
    p.event == null
      ? playerText !== undefined
        ? { text: playerText }
        : undefined
      : { ...p.event, ...(playerText !== undefined ? { text: playerText } : {}) };
  const celDeps = {
    state: k.timeline.state(),
    authored: k.authored,
    policy: k.policy,
    catalog: k.catalog,
    fieldEffects,
  };
  return {
    state: k.timeline.state(),
    authored: k.authored,
    policy: k.policy,
    cel: k.rules.cel,
    rules: k.rules,
    catalog: k.catalog,
    fieldEffects,
    celContext: buildCelContext(celDeps, {
      ...p,
      event,
      check: p.check == null ? null : (p.check as Record<string, unknown>),
    }),
  };
}

function retrievalLogHits(hits: RetrievalHit[], owner: CharacterId): RetrievalLogHit[] {
  return hits
    .map((h) => ({ kind: h.kind, id: h.id, score: h.score, owner }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind));
}

function trackSpikeInputs(
  k: Kernel,
  speaker: CharacterId,
  addressee: CharacterId,
  track: string,
  moodDelta: number | undefined,
): { value: number; delta: number } {
  const def = k.policy.tracks[track];
  const st = k.timeline.state().characters[speaker];
  if (!def || !st) return { value: 0, delta: 0 };
  if (def.scope === "self") {
    return { value: st.tracks.self[track] ?? def.initial, delta: track === "mood" ? (moodDelta ?? 0) : 0 };
  }
  return { value: st.tracks.toward[addressee]?.[track] ?? def.initial, delta: 0 };
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

/**
 * Field resolution for a turn uses the scene as the turn found it. A rule may end the scene part-way through the turn
 * (a consent stop, an ending event); the rest of that turn is still rendered and must not read a scene that is gone.
 */
function fieldQuery(k: Kernel, sc: SceneInfo, owner: CharacterId, target: CharacterId, eventType?: string) {
  return {
    owner,
    target,
    eventType,
    scene: { id: sc.id, location: sc.location, participants: sc.participants, turn: sc.turn },
    ctx: k.celContext({ self: owner, other: target, actor: k.timeline.state().characters[target]?.id, sceneId: sc.id }),
  };
}

function applyInputResponse(
  k: Kernel,
  ctx: {
    turnId: TurnId;
    sceneId: SceneId;
    speaker: CharacterId;
    addressee: CharacterId;
    actor: CharacterId;
    playerText: string;
  },
  appraisal: Appraisal,
): { appraisal: Appraisal; forcedIntent?: string; drafts: EventDraft[] } {
  const ic = appraisal.input_class;
  if (ic === "normal") return { appraisal, drafts: [] };
  const resp = k.policy.input.response[ic as "injection_suspect" | "meta_probe"];
  if (!resp) return { appraisal, drafts: [] };
  let next = { ...appraisal };
  let forcedIntent: string | undefined;
  const drafts: EventDraft[] = [];
  if ("emit" in resp && resp.emit) next = { ...next, type: resp.emit };
  if ("intent" in resp && resp.intent) forcedIntent = resp.intent;
  if ("hook" in resp && resp.hook && k.rules.fn(resp.hook)) {
    const deps = rulesDeps(
      k,
      {
        self: ctx.speaker,
        other: ctx.addressee,
        actor: ctx.actor,
        event: next,
        sceneId: ctx.sceneId,
      },
      ctx.playerText,
    );
    const hookDrafts = k.rules.run(resp.hook, {
      stage: "classify",
      state: deps.state,
      authored: deps.authored,
      policy: deps.policy,
      time: deps.state.time,
      vars: deps.celContext,
      rngKey: `classify:${ctx.turnId}:${ic}`,
    });
    for (const d of hookDrafts) {
      if (d.kind === "intent.decided" && typeof (d as unknown as { intent?: string }).intent === "string") {
        forcedIntent = (d as unknown as { intent: string }).intent;
        continue;
      }
      if (d.kind === "appraisal" && (d as unknown as { appraisal?: Appraisal }).appraisal) {
        next = { ...next, ...(d as unknown as { appraisal: Appraisal }).appraisal };
        continue;
      }
      drafts.push(d);
    }
  }
  return { appraisal: next, ...(forcedIntent ? { forcedIntent } : {}), drafts };
}

async function* runTurnPipeline(
  k: Kernel,
  hooks: HookRegistry,
  input: RunTurnInput,
  startMode: RuntimeMode,
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

    const playerLine = input.autonomous
      ? input.text.trim()
      : input.text.trim() || (input.choiceId ? choiceTextFromTimeline(k, input.choiceId) : "") || "";
    if (!input.autonomous && playerLine) {
      yield { type: "text", text: playerLine, speaker: input.actor, newUtterance: true };
    }

    // The per-turn budgets may take a model role off the mode the turn started under before its first call.
    const plan = k.m.router.plan({
      turn: turnCtx,
      mode: input.s2Tier !== undefined && startMode.render === "llm" ? { ...startMode, s2Tier: input.s2Tier } : startMode,
    });
    if (plan.events.length) await append(plan.events, { source: "router" });

    const dirTick = await k.m.director.tick("turn_start");
    if (dirTick.events.length) await append(dirTick.events, { source: "director" });

    const history = buildRecentHistory(k, input.speaker, input.addressee, undefined, {
      sceneId: input.sceneId,
      participants: scene.participants,
    });
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
        fieldEffects: k.m.fields.resolve(fieldQuery(k, sceneSnap, input.speaker, input.addressee)).effects.L1,
        backend: plan.mode.appraise,
        inputEventId,
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
    const inputOverride = applyInputResponse(
      k,
      {
        turnId: input.turnId,
        sceneId: input.sceneId,
        speaker: input.speaker,
        addressee: input.addressee,
        actor: input.actor,
        playerText: playerLine,
      },
      appraisal,
    );
    appraisal = inputOverride.appraisal;
    turnCtx.appraisal = appraisal;
    if (inputOverride.drafts.length) {
      await append(inputOverride.drafts, { source: "rules:classify", because: [appraisalEventId] });
    }

    if (appraiseOut.safety) {
      let mode = k.policy.safety.response;
      if (mode.startsWith("hook:")) {
        const fn = mode.slice("hook:".length);
        const deps = rulesDeps(
          k,
          {
            self: input.speaker,
            other: input.addressee,
            actor: input.actor,
            event: appraisal,
            sceneId: input.sceneId,
          },
          playerLine,
        );
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
      k.m.fields.resolve(fieldQuery(k, sceneSnap, input.speaker, input.addressee, appraisal.type)),
    )) as ReturnType<Kernel["m"]["fields"]["resolve"]>;
    const fieldFx01 = mergeEffectsByLevel(l01.effects);
    await append(
      l01.events.map((d) => ({ ...d, because: d.because ?? [appraisalEventId] })),
      { source: "fields" },
    );

    const checkOut = await hooks.run("check", k, turnCtx, async () => {
      const deps = rulesDeps(
        k,
        {
          self: input.speaker,
          other: input.addressee,
          actor: input.actor,
          event: appraisal,
          sceneId: input.sceneId,
        },
        playerLine,
        fieldFx01,
      );
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
      const deps = rulesDeps(
        k,
        {
          self: input.speaker,
          other: input.addressee,
          actor: input.actor,
          event: appraisal,
          sceneId: input.sceneId,
        },
        playerLine,
        fieldFx01,
      );
      return adjudicate(deps, {
        appraisal,
        actor: input.actor,
        owner: input.speaker,
        turnId: input.turnId,
        sceneId: input.sceneId,
        fieldEffects: fieldFx01,
        l3Effects: l01.effects.L3,
        l3FieldRules: l01.l3FieldRules,
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

    const secretDrafts = secretUnlockDrafts(k, input.speaker, input.actor, input.sceneId);
    if (secretDrafts.length > 0) {
      await append(secretDrafts, { source: "rules:secrets", because: [appraisalEventId] });
    }

    const l2 = (await hooks.run("applyFields", k, turnCtx, async () =>
      k.m.fields.resolve(fieldQuery(k, sceneSnap, input.speaker, input.addressee, appraisal.type)),
    )) as ReturnType<Kernel["m"]["fields"]["resolve"]>;
    const fieldFxTurn = mergeEffectsByLevel(l2.effects);
    await append(
      l2.events.map((d) => ({ ...d, because: d.because ?? [appraisalEventId] })),
      { source: "fields" },
    );

    const intentOut = await hooks.run("decide", k, turnCtx, async () => {
      const deps = rulesDeps(
        k,
        {
          self: input.speaker,
          other: input.addressee,
          actor: input.actor,
          event: appraisal,
          sceneId: input.sceneId,
        },
        playerLine,
        fieldFxTurn,
      );
      return decideIntent(deps, {
        owner: input.speaker,
        actor: input.actor,
        appraisal,
        sceneId: input.sceneId,
        fieldEffects: l2.effects.L2,
      });
    });
    const intent = intentOut as ReturnType<typeof decideIntent>;
    if (inputOverride.forcedIntent) {
      intent.intent = inputOverride.forcedIntent;
      intent.forced = true;
    }
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
    const addresseeDef = k.catalog.character(input.addressee);
    const addresseeSt = k.timeline.state().characters[input.addressee];
    const lockedTags =
      addresseeDef && addresseeSt ? lockedSecretTags(addresseeDef, addresseeSt) : [];
    const secretTopic = isSecretTopic(appraisal.tags, lockedTags);
    const spikeTrack = routerTriggers(k.policy).mood_spike?.track ?? "mood";
    const spike = trackSpikeInputs(k, input.speaker, input.addressee, spikeTrack, adj.moodDelta);
    const routeOut = await hooks.run("route", k, turnCtx, async () =>
      k.m.router.decide({
        turn: turnCtx,
        appraisal,
        anchorNear: dirTick.anchorNear,
        fieldMaxLevel: l01.maxLevel,
        tierChanged: adj.tierChanged,
        moodDelta: adj.moodDelta,
        mood: speakerMood,
        spikeTrackValue: spike.value,
        spikeTrackDelta: spike.delta,
        sidenoteReceived,
        sceneFirstTurn: sceneSnap.firstTurn,
        secretTopic,
        contradiction,
        autonomous: turnCtx.autonomous,
        mode: plan.mode,
        appraise: appraiseOut.binding,
        planned: plan.degraded,
      }),
    );
    const route = routeOut as ReturnType<Kernel["m"]["router"]["decide"]>;
    await append(route.events);

    let extraDynamic = "";
    if (appraiseOut.safety && k.policy.safety.response === "in_character") {
      extraDynamic = getPromptSection(k.i18n.promptLocale, "safety_deescalate_dynamic");
    }

    const renderInput: RenderInput = {
      binding: route.decision.render,
      escalated: route.decision.escalated,
      inputEventId,
      input: { text: playerLine, ...(input.choiceId ? { choiceId: input.choiceId } : {}) },
      speaker: input.speaker,
      addressee: input.addressee,
      intent: { intent: intent.intent, scores: intent.scores, forced: intent.forced },
      appraisal,
      fieldEffects: fieldFxTurn,
      scene: sceneSnap,
      history,
      sidenotes,
      extraStatic: typeof turnCtx.promptExtraStatic === "string" ? turnCtx.promptExtraStatic : undefined,
      extraDynamic: joinPromptExtra(extraDynamic, turnCtx.promptExtraDynamic),
    };

    let renderResult: RenderResult | undefined;
    let firstRenderText = true;
    const chunkOf = (part: RenderPart): TurnChunk | undefined => {
      switch (part.type) {
        case "text": {
          const chunk: TurnChunk = {
            type: "text",
            text: part.text,
            speaker: input.speaker,
            autonomous: input.autonomous,
            ...(firstRenderText ? { newUtterance: true } : {}),
          };
          firstRenderText = false;
          return chunk;
        }
        case "narration":
          return {
            type: "narration",
            text: part.text,
            style: part.style,
            ...(part.newParagraph ? { newParagraph: true } : {}),
          };
        case "cue":
          return { type: "cue", cue: part.cue, at: part.at, speaker: input.speaker };
        case "reset":
          firstRenderText = true;
          return { type: "reset", reason: part.reason };
        default:
          return undefined;
      }
    };

    if (!hooks.has("render")) {
      // No hook can reshape the render: its text and narration reach the consumer while the model is still writing.
      const gen = renderStage(k, turnCtx, renderInput);
      while (true) {
        const step = await gen.next();
        if (step.done) {
          renderResult = step.value;
          break;
        }
        const chunk = chunkOf(step.value);
        if (chunk) yield chunk;
      }
    } else {
      // A render hook receives the finished render and may replace it, so nothing is shown before it has run.
      const runRenderDefault = async (): Promise<{ result: RenderResult; parts: RenderPart[] }> => {
        const gen = renderStage(k, turnCtx, renderInput);
        let parts: RenderPart[] = [];
        while (true) {
          const step = await gen.next();
          if (step.done) return { result: step.value, parts };
          // a reset retracts what the consumer would have seen; here nothing has been shown yet
          if (step.value.type === "reset") parts = [];
          else parts.push(step.value);
        }
      };
      const renderOut = (await hooks.run("render", k, turnCtx, runRenderDefault)) as {
        result: RenderResult;
        parts: RenderPart[];
      };
      renderResult = renderOut.result;
      for (const part of renderOut.parts) {
        const chunk = chunkOf(part);
        if (chunk) yield chunk;
      }
    }

    if (!renderResult) throw new AnimaeError("RENDER_FAILED", "Render stage produced no result");

    if (renderResult.fallbackDraft) await append([renderResult.fallbackDraft]);
    if (renderResult.choiceDrafts.length) await append(renderResult.choiceDrafts);
    if (renderResult.mismatchDraft) await append([renderResult.mismatchDraft]);
    if (renderResult.choices.length) {
      yield { type: "choices", choices: renderResult.choices };
    }

    await hooks.run("commit", k, turnCtx, async () => {
      // Narration precedes the utterance it sets up; it has no speaker, cues, choices or realized intent.
      const narrationEvents: { id: EventId; text: string; style: "normal" | "scene_break" }[] = [];
      for (const n of renderResult!.narrations) {
        const [ev] = await append([narrationDraft(n.text, n.style)]);
        if (ev) narrationEvents.push({ id: ev.id, text: n.text, style: n.style });
      }
      const retrieval =
        renderResult!.hits.length > 0 ? retrievalLogHits(renderResult!.hits, input.speaker) : undefined;
      const utteranceEvents = await append([
        {
          kind: "utterance",
          speaker: input.speaker,
          text: renderResult!.text,
          cues: renderResult!.cues,
          addressee: input.addressee,
          intent: intent.intent,
          autonomous: input.autonomous,
          ...(renderResult!.recording ? { recording: renderResult!.recording } : {}),
          ...(retrieval?.length ? { retrieval } : {}),
        },
      ]);
      await k.m.director.afterRender(input.speaker, renderResult!.text);

      await writeTurnMemory(k, turnCtx, {
        speaker: input.speaker,
        addressee: input.addressee,
        actor: input.actor,
        appraisal,
        text: renderResult!.text,
        moodDelta: adj.moodDelta ?? 0,
        src: utteranceEvents.at(-1)?.id ?? eventIds.at(-1),
        inputEventId,
        backend: appraiseOut.binding.backend,
      });
      await writeNarrationMemory(k, narrationEvents, { sceneId: input.sceneId });

      await k.m.entities.checkPromotions([input.speaker]);
      for (const ev of await k.m.fields.onTurnEnd()) eventIds.push(ev.id);
      const mins = k.authored.world.calendar.turnMinutes;
      if (mins > 0) {
        for (const ev of await k.m.world.advance(mins, "turn")) eventIds.push(ev.id);
      }
      const endTick = await k.m.director.tick("turn_end");
      for (const ev of endTick.events) eventIds.push(ev.id);
      const turnEvts = k.timeline.eventsByTurn(input.turnId);
      const turnKinds = turnEvts.map((e) => e.kind);
      const apprEv = turnEvts.find((e) => e.kind === "appraisal") as { appraisal?: import("../events.ts").Appraisal } | undefined;
      await k.m.gallery?.afterTurn?.(turnKinds, apprEv?.appraisal);
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
  const runtime = k.runtime;
  // The turn runs under the mode in force when it began; a switch requested meanwhile waits for the boundary.
  const startMode = runtime ? await runtime.beginTurn() : currentMode(k);
  try {
    yield* runTurnPipeline(k, hooks, input, startMode);
  } finally {
    if (runtime) await runtime.endTurn();
  }
}
