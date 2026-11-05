import { z } from "zod";
import { WEB_PROTOCOL_VERSION } from "./version.ts";

const envelope = {
  v: z.literal(WEB_PROTOCOL_VERSION),
};

const requestId = z.string().min(1).max(64);

export const ClientHelloSchema = z.object({
  ...envelope,
  type: z.literal("hello"),
  role: z.enum(["controller", "spectator"]).optional(),
  resumeSeq: z.number().int().nonnegative().optional(),
  token: z.string().optional(),
  /** Stable browser tab identity — survives reconnect for controller seat. */
  clientId: z.string().min(8).max(128).optional(),
  /** BCP-47 UI locale for localized snapshots and errors. */
  locale: z.string().min(2).max(32).optional(),
});

export const ClientSetLocaleSchema = z.object({
  ...envelope,
  type: z.literal("set_locale"),
  id: requestId,
  locale: z.string().min(2).max(32),
});

export const ClientClaimControllerSchema = z.object({
  ...envelope,
  type: z.literal("claim_controller"),
  id: requestId,
  force: z.boolean().optional(),
});

export const ClientReleaseControlSchema = z.object({
  ...envelope,
  type: z.literal("release_control"),
  id: requestId,
});

export const ClientInputSchema = z.object({
  ...envelope,
  type: z.literal("input"),
  id: requestId,
  text: z.string().max(16_000),
  choiceId: z.string().optional(),
});

export const ClientCommandSchema = z.object({
  ...envelope,
  type: z.literal("command"),
  id: requestId,
  name: z.string().min(1).max(64),
  args: z.array(z.string()).default([]),
});

export const ClientActionSchema = z.object({
  ...envelope,
  type: z.literal("action"),
  id: requestId,
  actionId: z.string().min(1),
  entityId: z.string().optional(),
  args: z.record(z.string(), z.string()).default({}),
});

export const ClientChooseSchema = z.object({
  ...envelope,
  type: z.literal("choose"),
  id: requestId,
  choiceId: z.string().min(1),
});

export const ClientSelectFocusSchema = z.object({
  ...envelope,
  type: z.literal("select_focus"),
  id: requestId.optional(),
  entityId: z.string().optional(),
});

export const ClientRewindSchema = z.object({
  ...envelope,
  type: z.literal("rewind"),
  id: requestId,
  eventId: z.string().min(1),
});

export const ClientBranchSchema = z.object({
  ...envelope,
  type: z.literal("branch"),
  id: requestId,
  name: z.string().optional(),
});

export const ClientSaveSchema = z.object({
  ...envelope,
  type: z.literal("save"),
  id: requestId,
  label: z.string().optional(),
});

export const ClientLoadSchema = z.object({
  ...envelope,
  type: z.literal("load"),
  id: requestId,
  slot: z.string().optional(),
});

export const ClientListSavesSchema = z.object({
  ...envelope,
  type: z.literal("list_saves"),
  id: requestId,
});

export const ClientGetStateSchema = z.object({
  ...envelope,
  type: z.literal("get_state"),
  id: requestId,
});

export const ClientQuerySchema = z.object({
  ...envelope,
  type: z.literal("query"),
  id: requestId,
  path: z.string().min(1),
  viewer: z.string().optional(),
});

export const ClientConfigGetSchema = z.object({
  ...envelope,
  type: z.literal("config_get"),
  id: requestId,
  keys: z.array(z.string()).optional(),
});

export const ClientConfigSetSchema = z.object({
  ...envelope,
  type: z.literal("config_set"),
  id: requestId,
  patch: z.record(z.string(), z.unknown()),
  consent: z
    .object({
      packId: z.string(),
      phrase: z.string(),
      noticeVersion: z.string(),
    })
    .optional(),
});

/** Optional `result.data` payload for `config_set` (host-defined; embedding app may restart the session). */
export const ConfigSetResultSchema = z.object({
  reloadRecommended: z.boolean().optional(),
  /** When true, the embedding application is restarting the session in-process (not a browser reload). */
  restarting: z.boolean().optional(),
  message: z.string().optional(),
});

export const ClientCancelSchema = z.object({
  ...envelope,
  type: z.literal("cancel"),
  id: requestId,
  targetId: requestId.optional(),
});

export const ClientModelsProbeSchema = z.object({
  ...envelope,
  type: z.literal("models_probe"),
  id: requestId,
  slot: z.enum(["s1", "s2"]).optional(),
  /** Unsaved slot fields; server merges with stored config (apiKey omitted = use stored key). */
  draft: z
    .object({
      provider: z.string().optional(),
      model: z.string().optional(),
      baseURL: z.string().optional(),
      name: z.string().optional(),
      apiKey: z.string().optional(),
      clearApiKey: z.boolean().optional(),
      apiKeyEnv: z.string().optional(),
    })
    .optional(),
});

export const ClientImagesProbeSchema = z.object({
  ...envelope,
  type: z.literal("images_probe"),
  id: requestId,
  /** Unsaved image settings; the host merges them with the stored configuration (host-defined shape). */
  draft: z.record(z.string(), z.unknown()).optional(),
});

export const ClientOllamaModelsSchema = z.object({
  ...envelope,
  type: z.literal("ollama_models"),
  id: requestId,
  baseURL: z.string().optional(),
});

export const ClientContentPackNoticeSchema = z.object({
  ...envelope,
  type: z.literal("content_pack_notice"),
  id: requestId,
  packId: z.string().min(1).max(64),
});

export const ClientProtagonistSetSchema = z.object({
  ...envelope,
  type: z.literal("protagonist_set"),
  id: requestId,
  name: z.string().min(1).max(64),
});

export const ClientPingSchema = z.object({
  ...envelope,
  type: z.literal("ping"),
  id: requestId,
});

export const ClientLlmLogSchema = z.object({
  ...envelope,
  type: z.literal("llm_log"),
  id: requestId,
  since: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  label: z.string().max(64).optional(),
  slot: z.enum(["s1", "s2"]).optional(),
  errorsOnly: z.boolean().optional(),
});

export const ClientLlmLogClearSchema = z.object({
  ...envelope,
  type: z.literal("llm_log_clear"),
  id: requestId,
});

const galleryListOpts = {
  includeLocked: z.boolean().optional(),
  includeUnavailable: z.boolean().optional(),
  debug: z.boolean().optional(),
};

export const ClientGalleryListSchema = z.object({
  ...envelope,
  type: z.literal("gallery_list"),
  id: requestId,
  ...galleryListOpts,
});

export const ClientGalleryGetSchema = z.object({
  ...envelope,
  type: z.literal("gallery_get"),
  id: requestId,
  entryId: z.string().min(1).max(128),
  ...galleryListOpts,
});

export const ClientGalleryRatingsSchema = z.object({
  ...envelope,
  type: z.literal("gallery_ratings"),
  id: requestId,
});

export const ClientGalleryCaptureSchema = z.object({
  ...envelope,
  type: z.literal("gallery_capture"),
  id: requestId,
  req: z
    .object({
      focus: z.string().max(512).optional(),
      rating: z.string().max(64).optional(),
      characters: z.array(z.string()).optional(),
      tier: z.enum(["s1", "s2"]).optional(),
      title: z.string().max(256).optional(),
      seed: z.number().int().optional(),
    })
    .optional(),
});

export const ClientGalleryRenderSchema = z.object({
  ...envelope,
  type: z.literal("gallery_render"),
  id: requestId,
  entryId: z.string().min(1).max(128),
  reroll: z.boolean().optional(),
  seed: z.number().int().optional(),
});

export const ClientGalleryCancelSchema = z.object({
  ...envelope,
  type: z.literal("gallery_cancel"),
  id: requestId,
  job: z.string().min(1).max(64),
});

export const ClientGalleryRemoveSchema = z.object({
  ...envelope,
  type: z.literal("gallery_remove"),
  id: requestId,
  entryId: z.string().min(1).max(128),
});

export const ClientGalleryPinSchema = z.object({
  ...envelope,
  type: z.literal("gallery_pin"),
  id: requestId,
  entryId: z.string().min(1).max(128),
  pinned: z.boolean(),
});

export const ClientGalleryUnlockSchema = z.object({
  ...envelope,
  type: z.literal("gallery_unlock"),
  id: requestId,
  entryId: z.string().min(1).max(128),
  source: z.string().max(64).optional(),
});

export const ClientGalleryJobsSchema = z.object({
  ...envelope,
  type: z.literal("gallery_jobs"),
  id: requestId,
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  ClientHelloSchema,
  ClientInputSchema,
  ClientCommandSchema,
  ClientActionSchema,
  ClientChooseSchema,
  ClientSelectFocusSchema,
  ClientRewindSchema,
  ClientBranchSchema,
  ClientSaveSchema,
  ClientLoadSchema,
  ClientListSavesSchema,
  ClientGetStateSchema,
  ClientQuerySchema,
  ClientConfigGetSchema,
  ClientConfigSetSchema,
  ClientCancelSchema,
  ClientModelsProbeSchema,
  ClientImagesProbeSchema,
  ClientOllamaModelsSchema,
  ClientContentPackNoticeSchema,
  ClientProtagonistSetSchema,
  ClientClaimControllerSchema,
  ClientReleaseControlSchema,
  ClientPingSchema,
  ClientSetLocaleSchema,
  ClientLlmLogSchema,
  ClientLlmLogClearSchema,
  ClientGalleryListSchema,
  ClientGalleryGetSchema,
  ClientGalleryRatingsSchema,
  ClientGalleryCaptureSchema,
  ClientGalleryRenderSchema,
  ClientGalleryCancelSchema,
  ClientGalleryRemoveSchema,
  ClientGalleryPinSchema,
  ClientGalleryUnlockSchema,
  ClientGalleryJobsSchema,
]);

export const ServerLocaleSchema = z.object({
  ...envelope,
  type: z.literal("locale"),
  seq: z.number().int().nonnegative(),
  locale: z.string(),
});

export const ServerHelloOkSchema = z.object({
  ...envelope,
  type: z.literal("hello_ok"),
  seq: z.number().int().nonnegative(),
  sessionId: z.string(),
  role: z.enum(["controller", "spectator"]),
  controllerPresent: z.boolean(),
  protocolVersion: z.number().int(),
  clientId: z.string().optional(),
  locale: z.string(),
  locales: z.array(z.object({ tag: z.string(), name: z.string() })),
});

export const ServerRoleSchema = z.object({
  ...envelope,
  type: z.literal("role"),
  seq: z.number().int().nonnegative(),
  role: z.enum(["controller", "spectator"]),
  message: z.string().optional(),
});

export const ServerSnapshotSchema = z.object({
  ...envelope,
  type: z.literal("snapshot"),
  seq: z.number().int().nonnegative(),
  state: z.record(z.string(), z.unknown()),
});

export const ServerPatchSchema = z.object({
  ...envelope,
  type: z.literal("patch"),
  seq: z.number().int().nonnegative(),
  ops: z.array(
    z.object({
      op: z.enum(["replace", "add", "remove"]),
      path: z.string(),
      value: z.unknown().optional(),
    }),
  ),
});

export const ServerStreamSchema = z.object({
  ...envelope,
  type: z.literal("stream"),
  seq: z.number().int().nonnegative(),
  requestId: requestId,
  /** `reset`: the engine replaced the output of the turn in flight; every segment streamed since the player's own line is void. */
  phase: z.enum(["start", "delta", "end", "reset"]),
  segment: z.enum(["narration", "dialogue", "thought", "system", "event"]),
  speaker: z.string().optional(),
  text: z.string().optional(),
  turnId: z.string().optional(),
  /** `narration` segments, phase `start`: how the paragraph is presented (`scene_break` is a divider). */
  style: z.enum(["normal", "scene_break"]).optional(),
  /** phase `reset`: why the output was replaced. */
  reason: z.enum(["fallback", "retry"]).optional(),
});

export const ServerEventSchema = z.object({
  ...envelope,
  type: z.literal("event"),
  seq: z.number().int().nonnegative(),
  kind: z.string(),
  payload: z.unknown(),
});

export const ServerErrorSchema = z.object({
  ...envelope,
  type: z.literal("error"),
  seq: z.number().int().nonnegative().optional(),
  id: requestId.optional(),
  code: z.string(),
  message: z.string(),
  /**
   * True when `message` was rendered from a catalog in the client's locale and is fit to show as-is. When absent or
   * false, `message` is a developer diagnostic and clients should present their own copy for `code`.
   */
  localized: z.boolean().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const ServerToastSchema = z.object({
  ...envelope,
  type: z.literal("toast"),
  seq: z.number().int().nonnegative(),
  level: z.enum(["info", "warn", "error"]),
  text: z.string(),
});

export const ServerBusySchema = z.object({
  ...envelope,
  type: z.literal("busy"),
  seq: z.number().int().nonnegative(),
  active: z.boolean(),
  requestId: requestId.optional(),
  progress: z.number().min(0).max(1).optional(),
});

export const ServerResultSchema = z.object({
  ...envelope,
  type: z.literal("result"),
  seq: z.number().int().nonnegative(),
  id: requestId,
  ok: z.literal(true),
  data: z.unknown().optional(),
});

export const ServerHeartbeatSchema = z.object({
  ...envelope,
  type: z.literal("heartbeat"),
  seq: z.number().int().nonnegative(),
});

export const ServerPongSchema = z.object({
  ...envelope,
  type: z.literal("pong"),
  seq: z.number().int().nonnegative(),
  id: requestId,
});

export const ServerGalleryNoticeSchema = z.object({
  ...envelope,
  type: z.literal("gallery_notice"),
  seq: z.number().int().nonnegative(),
  notice: z.union([
    z.object({ type: z.literal("unlocked"), item: z.string() }),
    z.object({
      type: z.literal("job"),
      job: z.object({
        id: z.string(),
        item: z.string(),
        state: z.string(),
        progress: z.number().optional(),
        error: z.object({ code: z.string(), message: z.string() }).optional(),
        startedAt: z.string().optional(),
        finishedAt: z.string().optional(),
      }),
    }),
    z.object({ type: z.literal("changed"), item: z.string() }),
  ]),
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
  ServerHelloOkSchema,
  ServerLocaleSchema,
  ServerRoleSchema,
  ServerSnapshotSchema,
  ServerPatchSchema,
  ServerStreamSchema,
  ServerEventSchema,
  ServerErrorSchema,
  ServerToastSchema,
  ServerBusySchema,
  ServerResultSchema,
  ServerPongSchema,
  ServerHeartbeatSchema,
  ServerGalleryNoticeSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
