import { afterEach, describe, expect, test } from "bun:test";
import { clearLocalePacks } from "@animae/i18n";
import { assertLogInvariants } from "../../../engine/test/e2e/session-invariants.ts";
import { registerFrenchSessionLocalePack } from "../helpers/locale-packs.ts";
import type { ServerMessage } from "../../src/protocol/schemas.ts";
import { E2E_DEADLINE_MS, helloController, openE2eStack, pollUntil, WsSession } from "./e2e-fixture.ts";

function snapshotState(m: ServerMessage): Record<string, unknown> | undefined {
  return m.type === "snapshot" ? m.state : undefined;
}

const stacks: Array<() => Promise<void>> = [];
afterEach(async () => {
  clearLocalePacks();
  while (stacks.length) await stacks.pop()!();
});

describe("web e2e websocket session", () => {
  test(
    "controller journey: hello, turn stream, result, snapshot transcript",
    async () => {
      const stack = await openE2eStack();
      stacks.push(() => stack.dispose());
      const client = await helloController(stack.wsUrl);

      const before = client.frames.filter((m) => m.type === "snapshot").length;
      client.send({ v: 1, type: "input", id: "turn-a", text: "Hello tavern" });
      await client.wait((m) => m.type === "result" && m.id === "turn-a");
      await client.wait((m) => {
        if (m.type !== "snapshot") return false;
        const t = JSON.stringify((m.state as { transcript?: unknown }).transcript ?? "");
        return t.includes("Hello from NPC");
      });

      const turnFrames = client.frames.slice(before);
      const busyIdx = turnFrames.findIndex((m) => m.type === "busy" && m.active === true);
      const streamIdx = turnFrames.findIndex((m) => m.type === "stream");
      const resultIdx = turnFrames.findIndex((m) => m.type === "result" && m.id === "turn-a");
      expect(busyIdx).toBeGreaterThanOrEqual(0);
      expect(streamIdx).toBeGreaterThan(busyIdx);
      expect(resultIdx).toBeGreaterThan(streamIdx);

      const dialogueStreams = turnFrames.filter(
        (m): m is Extract<ServerMessage, { type: "stream" }> =>
          m.type === "stream" && m.segment === "dialogue" && m.requestId === "turn-a",
      );
      expect(dialogueStreams.length).toBeGreaterThan(0);
      expect(dialogueStreams[0]!.phase).toBe("start");
      const phases = dialogueStreams.map((m) => m.phase);
      expect(phases).toContain("delta");
      expect(phases.at(-1)).toBe("end");

      const events = await stack.engine.timeline.events();
      assertLogInvariants(events);
      expect(events.some((e) => e.kind === "input.received")).toBe(true);
      client.close();
    },
    { timeout: 10_000 },
  );

  test(
    "spectator receives broadcast stream from controller turn",
    async () => {
      const stack = await openE2eStack();
      stacks.push(() => stack.dispose());
      const ctrl = await helloController(stack.wsUrl, { clientId: "e2e-broadcast-ctrl" });
      const spec = new WsSession(stack.wsUrl);
      await spec.ready();
      spec.send({
        v: 1,
        type: "hello",
        role: "spectator",
        clientId: "e2e-broadcast-spec",
      });
      await spec.wait((m) => m.type === "snapshot");
      const specStart = spec.frames.length;

      ctrl.send({ v: 1, type: "input", id: "turn-b", text: "Wave" });
      await ctrl.wait((m) => m.type === "result" && m.id === "turn-b");
      await spec.wait(
        (m) => m.type === "stream" && spec.frames.indexOf(m) >= specStart,
        E2E_DEADLINE_MS,
      );
      expect(spec.frames.slice(specStart).some((m) => m.type === "busy")).toBe(true);
      ctrl.close();
      spec.close();
    },
    { timeout: 10_000 },
  );

  test(
    "late joiner snapshot matches live get_state",
    async () => {
      const stack = await openE2eStack();
      stacks.push(() => stack.dispose());
      const ctrl = await helloController(stack.wsUrl);
      ctrl.send({ v: 1, type: "input", id: "turn-c", text: "Sync check" });
      await ctrl.wait((m) => m.type === "result" && m.id === "turn-c");

      ctrl.send({ v: 1, type: "get_state", id: "state-1" });
      const live = await ctrl.wait((m) => m.type === "result" && m.id === "state-1");
      const liveState = (live as { data?: { state?: Record<string, unknown> } }).data?.state;

      const joiner = new WsSession(stack.wsUrl);
      await joiner.ready();
      joiner.send({ v: 1, type: "hello", role: "spectator", clientId: "e2e-late-joiner" });
      const snap = await joiner.wait((m) => m.type === "snapshot");
      expect(JSON.stringify(snapshotState(snap))).toBe(JSON.stringify(liveState));
      ctrl.close();
      joiner.close();
    },
    { timeout: 10_000 },
  );

  test(
    "resumeSeq replays only missed busy/stream frames",
    async () => {
      const stack = await openE2eStack();
      stacks.push(() => stack.dispose());
      const first = await helloController(stack.wsUrl, { clientId: "e2e-resume-client" });
      first.send({ v: 1, type: "input", id: "turn-d", text: "Replay me" });
      await first.wait((m) => m.type === "result" && m.id === "turn-d");
      const resumeSeq = first.maxSeq();
      first.close();

      const again = new WsSession(stack.wsUrl);
      await again.ready();
      again.send({
        v: 1,
        type: "hello",
        role: "controller",
        clientId: "e2e-resume-client",
        resumeSeq,
      });
      await again.wait((m) => m.type === "hello_ok");
      await pollUntil(() => (again.frames.some((m) => m.type === "snapshot") ? true : undefined));
      const replayed = again.frames.filter(
        (m) => (m.type === "busy" || m.type === "stream") && "seq" in m && m.seq > resumeSeq,
      );
      expect(replayed.length).toBe(0);
      again.close();
    },
    { timeout: 10_000 },
  );

  test(
    "help and set_locale commands; unknown command returns error",
    async () => {
      const off = registerFrenchSessionLocalePack();
      try {
        const stack = await openE2eStack();
        stacks.push(() => stack.dispose());
        const client = await helloController(stack.wsUrl);

        client.send({ v: 1, type: "command", id: "cmd-help", name: "help", args: [] });
        await client.wait((m) => m.type === "result" && m.id === "cmd-help");

        const enHeader =
          (client.frames.filter((m) => m.type === "snapshot").at(-1)?.state as { header?: { time?: { label?: string } } })
            ?.header?.time?.label ?? "";
        expect(enHeader).toContain("Day");

        client.send({ v: 1, type: "set_locale", id: "loc-fr", locale: "fr" });
        await client.wait((m) => m.type === "result" && m.id === "loc-fr");
        const frHeader =
          (client.frames.filter((m) => m.type === "snapshot").at(-1)?.state as { header?: { time?: { label?: string } } })
            ?.header?.time?.label ?? "";
        expect(frHeader).toContain("Jour");

        client.send({ v: 1, type: "action", id: "act-bad", actionId: "no-such-action" });
        const err = await client.wait((m) => m.type === "error" && m.id === "act-bad");
        expect(err).toMatchObject({ type: "error", code: "UNKNOWN_ACTION" });
        client.close();
      } finally {
        off();
      }
    },
    { timeout: 10_000 },
  );
});
