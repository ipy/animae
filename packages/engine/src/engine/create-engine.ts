import type { CreateEngineOptions, Engine } from "../api.ts";
import type { Kernel, Stage, StageHook, ViewerDef } from "../contracts.ts";
import { createEngineModContext, type EngineModContext } from "./mod-context.ts";
import { modDrift } from "../mods/resolve.ts";
import { modRecordFromResolved, syncModTimelineRecord } from "./mod-sync.ts";
import { loadAuthored } from "../authored/load.ts";
import { createCatalog } from "../authored/catalog.ts";
import { createPresetRegistry } from "../policy/registry.ts";
import { loadPolicy } from "../policy/load.ts";
import { createRuleEngine } from "../rules/rule-engine.ts";
import { createCelEngine } from "../rules/cel.ts";
import { buildCelContext } from "../rules/cel-context.ts";
import { createTimeline } from "../timeline/timeline-store.ts";
import { FsStorage } from "../store/fs.ts";
import { withRecording } from "../model/recording.ts";
import { resolveEngineModels } from "../model/config.ts";
import { createFieldSystem } from "../fields/field-system.ts";
import { createDirector } from "../director/director.ts";
import { createWorldService } from "../world/service.ts";
import { createMemoryService } from "../memory/service.ts";
import { createIntrospect } from "../introspect/service.ts";
import { preflightPlayerCatchUp } from "../introspect/query-catchup.ts";
import { createEntityService } from "../entities/service.ts";
import { createRouter } from "../router/index.ts";
import { checkHotReload, createLiveAuthoredPolicy, seedAuthoredStatFingerprint } from "./hot-reload.ts";
import { rebuildModuleCaches } from "./rebuild-caches.ts";
import { HookRegistry } from "../pipeline/hooks.ts";
import { createSceneService } from "../scene/scene-service.ts";
import { createMutationGate } from "./mutation-gate.ts";
import { replayChunks } from "../timeline/replay.ts";
import type { EventId, TurnChunk } from "../types.ts";
import type { ModelMode } from "../ports.ts";

function sessionId(opts: CreateEngineOptions): string {
  return opts.sessionId ?? `sess_${Date.now().toString(36)}`;
}

export async function createEngine(opts: CreateEngineOptions): Promise<Engine> {
  const storage = opts.ports?.storage ?? FsStorage(opts.root);
  await storage.acquireLock();

  let modCtx = await createEngineModContext(storage, opts);

  const presets = createPresetRegistry(opts.presets ?? []);
  const authored = await loadAuthored(modCtx.readStorage, {
    presets,
    resolvedMods: modCtx.overlay.ordered,
    modProvenance: modCtx.overlay.provenance,
  });
  await seedAuthoredStatFingerprint(modCtx.readStorage, authored, storage);
  const seed = opts.seed ?? authored.config.seed ?? 1;

  const cel = createCelEngine();
  let timelineForRules: ReturnType<typeof createTimeline> | undefined;
  const rules = createRuleEngine(cel, () => ({
    seed,
    rootBranch: timelineForRules?.chain()[0]?.name ?? "main",
  }));
  const knownRuleFns = new Set<string>();
  for (const bundle of presets.list()) {
    bundle.rules?.({
      register: (name, fn) => {
        knownRuleFns.add(name);
        rules.register(name, fn);
      },
    });
  }

  const hooks = new HookRegistry();
  const pendingModHooks: { stage: Stage; fn: StageHook }[] = [];
  const pendingModViewers: ViewerDef[] = [];
  for (const bundle of modCtx.overlay.bundles) {
    bundle.setup?.({
      rules: {
        register: (name, fn) => {
          knownRuleFns.add(name);
          rules.register(name, fn);
        },
      },
      hooks: { register: (stage, fn) => pendingModHooks.push({ stage, fn }) },
      introspect: { registerViewer: (v) => pendingModViewers.push(v) },
    });
  }

  const policyResult = await loadPolicy(modCtx.readStorage, authored.config, presets, {
    knownRuleFns,
    authoredFields: Object.fromEntries(
      Object.entries(authored.fields).map(([id, f]) => [id, { level: f.level }]),
    ),
  });

  const live = createLiveAuthoredPolicy(authored, policyResult.policy);
  const modelMode: ModelMode = opts.modelMode ?? "record";

  const timeline = createTimeline({
    storage,
    authored: () => live.authored,
    policy: () => live.policy,
    cel,
    seed,
    sessionId: sessionId(opts),
    now: opts.now,
    modelMode,
    presetId: authored.config.preset,
  });
  timelineForRules = timeline;

  let kernel!: Kernel;
  const mutationGate = createMutationGate();
  const catalog = createCatalog(
    () => live.authored,
    () => timeline.state().generated,
  );

  const rawModels = resolveEngineModels(opts, live.authored.config);
  const models = {
    s1: withRecording(rawModels.s1, timeline.recordings),
    s2: withRecording(rawModels.s2, timeline.recordings),
  };

  const warn = (code: string, message: string, extra?: Record<string, unknown>) => {
    void kernel.emit([{ kind: "config.warning", code, message, ...extra }]);
  };

  kernel = {
    storage,
    get authored() {
      return live.authored;
    },
    get policy() {
      return live.policy;
    },
    rules,
    timeline,
    models,
    embedding: opts.ports?.embedding,
    catalog,
    emit: (drafts, ctx) => timeline.append(drafts, ctx),
    celContext: (p) =>
      buildCelContext(
        { state: timeline.state(), authored: live.authored, policy: live.policy, catalog },
        { ...p, check: p.check == null ? null : (p.check as Record<string, unknown>) },
      ),
    warn,
    runExclusive: (fn) => mutationGate.withLock(fn),
    acquireExclusive: () => mutationGate.acquire(),
    m: {} as Kernel["m"],
  };

  const director = createDirector(kernel);
  const fields = createFieldSystem(kernel, { bypassArmed: (w) => director.bypassArmed(w) });
  const world = createWorldService(kernel);
  const memory = createMemoryService(kernel);
  const introspect = createIntrospect(kernel);
  const router = createRouter(kernel);
  const entities = createEntityService(kernel);

  kernel.m = { fields, director, world, memory, introspect, router, entities };

  await timeline.open();

  const bootEvents = await timeline.events();
  if (bootEvents.length === 0) {
    await kernel.emit([
      {
        kind: "config.reloaded",
        hash: live.authored.hash,
        mods: modRecordFromResolved(modCtx.overlay.ordered),
      },
    ]);
  }

  for (const w of modCtx.overlay.warnings) {
    await kernel.emit([{ kind: "config.warning", code: "mod_engine", message: w }]);
  }
  await syncModTimelineRecord(kernel, modCtx.overlay.ordered, timeline.state().config.mods);

  for (const h of pendingModHooks) hooks.register(h.stage, h.fn);
  for (const v of pendingModViewers) introspect.registerViewer(v);

  const scene = createSceneService(kernel, hooks, {
    afterTurn: async () => {
      const r = await checkHotReload(kernel, live, presets, { knownRuleFns, modCtx });
      if (r.modCtx) modCtx = r.modCtx;
    },
  });

  async function afterTimelineMutation(): Promise<void> {
    rebuildModuleCaches(kernel);
  }

  const engine: Engine = {
    world: {
      now: () => world.now(),
      advance: (by) => mutationGate.withLock(() => world.advance(by)),
      set: (path, value) => mutationGate.withLock(() => world.set(path, value)),
      move: (who, location) => mutationGate.withLock(() => world.move(who, location)),
    },
    scene: {
      start: (s) => mutationGate.withLock(() => scene.start(s)),
      turn: async function* (t) {
        const release = await mutationGate.acquire();
        try {
          yield* scene.turn(t);
        } finally {
          release();
        }
      },
      end: (sceneId) => mutationGate.withLock(() => scene.end(sceneId)),
    },
    entities: {
      generate: (r) => mutationGate.withLock(() => entities.generate(r)),
      promote: (id, to) => mutationGate.withLock(() => entities.promote(id, to)),
      setAlias: (input) => mutationGate.withLock(() => entities.setAlias(input)),
      resolve: (ref, opts) => entities.resolve(ref, opts),
      spawn: (spec, opts) => mutationGate.withLock(() => entities.spawn(spec, opts)),
      retire: (ref, opts) => mutationGate.withLock(() => entities.retire(ref, opts)),
      generateFromBrief: (brief, opts) => mutationGate.withLock(() => entities.generateFromBrief(brief, opts)),
    },
    setAlias: (input) => mutationGate.withLock(() => entities.setAlias(input)),
    resolveEntity: (ref, opts) => entities.resolve(ref, opts),
    spawnEntity: (spec, opts) => mutationGate.withLock(() => entities.spawn(spec, opts)),
    fields: {
      declare: (f) => fields.declare(f),
      grant: (f) => fields.grant(f),
      revoke: (id) => fields.revoke(id),
    },
    director: {
      sidenote: (npc, text, o) => director.sidenote(npc, text, o),
      invokeException: (id, target) => director.invokeException(id, target),
    },
    timeline: {
      current: () => timeline.branch(),
      save: (label) => timeline.save(label),
      load: async (slot) =>
        mutationGate.withLock(async () => {
          await timeline.load(slot);
          await afterTimelineMutation();
        }),
      rewind: async (to) =>
        mutationGate.withLock(async () => {
          const b = await timeline.rewind(to);
          await afterTimelineMutation();
          return b;
        }),
      branches: () => timeline.branches(),
      switch: async (b) =>
        mutationGate.withLock(async () => {
          await timeline.switch(b);
          await afterTimelineMutation();
        }),
      diff: (a, b) => timeline.diff(a, b),
      prune: (b) => timeline.prune(b),
      export: (b, o) => timeline.exportBranch(b, o),
      import: async (file) =>
        mutationGate.withLock(async () => {
          const br = await timeline.importFile(file);
          await afterTimelineMutation();
          return br;
        }),
      replay: async function* (b, r) {
        const events = await timeline.readRange(b, r);
        for (const chunk of replayChunks(events)) yield chunk;
      },
      saves: () => timeline.saves(),
      events: (o) => {
        let ev = [...timeline.events()];
        if (o?.from) {
          const fromSeq = parseInt(o.from.replace("evt_", ""), 10);
          ev = ev.filter((e) => parseInt(e.id.replace("evt_", ""), 10) >= fromSeq);
        }
        if (o?.kinds) ev = ev.filter((e) => o.kinds!.includes(e.kind));
        if (o?.limit) ev = ev.slice(-o.limit);
        return Promise.resolve(ev);
      },
    },
    rules: { register: (name, fn) => rules.register(name, fn) },
    hooks: {
      register: (stage: Stage, fn: StageHook) => hooks.register(stage, fn),
    },
    introspect: {
      registerViewer: (v) => introspect.registerViewer(v),
    },
    query: (viewer, path) => introspect.query(viewer, path),
    queryAsync: async (viewer, path) => {
      await preflightPlayerCatchUp(kernel, viewer, path);
      return introspect.query(viewer, path);
    },
    grant: (viewer, path, ttl) => introspect.grant(viewer, path, ttl),
    explain: (turnId, viewer) => introspect.explain(turnId, viewer),
    on: (kind, h) => timeline.on(kind, h),
    purge: (scope) => timeline.purge(scope),
    importCard: (file) => entities.importCard(file),
    exportCard: (id) => entities.exportCard(id),
    reload: async () => {
      const r = await checkHotReload(kernel, live, presets, { knownRuleFns, modCtx });
      if (r.modCtx) modCtx = r.modCtx;
      return { ok: r.errors.length === 0, errors: r.errors, warnings: r.warnings };
    },
    mods: () => {
      const current = live.authored.mods ?? [];
      const { drift, message } = modDrift(timeline.state().config.mods, current);
      return {
        mods: current,
        drift,
        driftMessage: drift ? message : undefined,
        provenance: live.authored.modProvenance ?? {},
      };
    },
    info: () => ({
      preset: live.authored.config.preset,
      language: live.authored.world.language,
      branch: timeline.branch().name,
      sessionId: timeline.sessionId,
      models: { s1: models.s1.id, s2: models.s2.id },
      modelMode,
    }),
    close: async () => {
      await mutationGate.drain();
      await timeline.close();
      await storage.releaseLock();
    },
  };

  let engineClosed = false;

  const baseClose = engine.close.bind(engine);
  engine.close = async () => {
    if (engineClosed) return;
    engineClosed = true;
    await baseClose();
  };

  return engine;
}
