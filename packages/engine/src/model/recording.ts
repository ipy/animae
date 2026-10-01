import { AnimaeError } from "../types.ts";
import type { ModelPort, ModelRequestBase, StreamPart } from "../ports.ts";
import type { ZodType } from "zod";
import type { RecordingStore } from "../contracts.ts";
import { recordingKey } from "./recording-key.ts";
import type { RecordedObjectResponse, RecordedStreamResponse } from "./types.ts";
import { replayStreamParts, slimStreamPartsForRecord } from "./recording-stream.ts";

type ObjectReq<T = unknown> = ModelRequestBase & { schema: ZodType<T> };

export function withRecording(port: ModelPort, rec: RecordingStore): ModelPort {
  const wrapped = {
    id: port.id,
    usage: port.usage?.bind(port),
    async object<T>(req: ObjectReq<T>): Promise<T> {
      const key = recordingKey(port.id, req);
      if (rec.mode === "replay") {
        const hit = rec.lookup(key) as RecordedObjectResponse | null | undefined;
        if (hit === undefined || hit === null) {
          throw new AnimaeError("RECORDING_MISSING", `No recording for ${req.label}`, { key, label: req.label });
        }
        return hit as T;
      }
      const value = await port.object(req);
      if (rec.mode === "record") await rec.record(key, value);
      return value;
    },
    stream(req: ModelRequestBase & { schema: ZodType<unknown> }) {
      const key = recordingKey(port.id, req);
      if (rec.mode === "replay") {
        const hit = rec.lookup(key) as RecordedStreamResponse | undefined;
        if (hit === undefined) {
          throw new AnimaeError("RECORDING_MISSING", `No recording for ${req.label}`, { key, label: req.label });
        }
        return replayStream(hit);
      }
      return recordStream(port, rec, key, req);
    },
  };
  Object.defineProperty(wrapped, "tags", {
    get(): readonly string[] | undefined {
      return port.tags;
    },
    set(v: readonly string[] | undefined) {
      (port as { tags?: string[] }).tags = v ? [...v] : undefined;
    },
    enumerable: true,
    configurable: true,
  });
  return wrapped as ModelPort;
}

async function* recordStream(
  port: ModelPort,
  rec: RecordingStore,
  key: string,
  req: Parameters<ModelPort["stream"]>[0],
): AsyncGenerator<StreamPart> {
  const parts: StreamPart[] = [];
  for await (const part of port.stream(req)) {
    parts.push(part);
    yield part;
  }
  if (rec.mode === "record") await rec.record(key, slimStreamPartsForRecord(parts));
}

async function* replayStream(parts: StreamPart[]): AsyncGenerator<StreamPart> {
  yield* replayStreamParts(parts);
}
