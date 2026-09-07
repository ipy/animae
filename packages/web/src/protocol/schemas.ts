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

export const ClientPingSchema = z.object({
  ...envelope,
  type: z.literal("ping"),
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
  ClientOllamaModelsSchema,
  ClientContentPackNoticeSchema,
  ClientPingSchema,
]);

export const ServerHelloOkSchema = z.object({
  ...envelope,
  type: z.literal("hello_ok"),
  seq: z.number().int().nonnegative(),
  sessionId: z.string(),
  role: z.enum(["controller", "spectator"]),
  controllerPresent: z.boolean(),
  protocolVersion: z.number().int(),
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
  phase: z.enum(["start", "delta", "end"]),
  segment: z.enum(["narration", "dialogue", "thought", "system", "event"]),
  speaker: z.string().optional(),
  text: z.string().optional(),
  turnId: z.string().optional(),
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

export const ServerMessageSchema = z.discriminatedUnion("type", [
  ServerHelloOkSchema,
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
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
