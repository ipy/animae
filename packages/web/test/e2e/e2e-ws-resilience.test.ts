import { afterEach, describe, expect, test } from "bun:test";
import { SessionHost } from "@animae/host";
import { createFakeImagePort } from "../../../engine/test/gallery/fake-image-port.ts";
import { resolveSecurityConfig } from "../../src/server/security.ts";
import { E2E_DEADLINE_MS, helloController, openE2eStack, pollUntil, WsSession } from "./e2e-fixture.ts";

const stacks: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (stacks.length) await stacks.pop()!();
});

describe("web e2e websocket resilience", () => {
  test(
    "malformed JSON and invalid frames yield errors; session stays usable",
    async () => {
      const stack = await openE2eStack();
      stacks.push(() => stack.dispose());
      const client = await helloController(stack.wsUrl);
      const before = client.frames.length;

      const parseAt = client.frames.length;
      client.ws.send("{not-json");
      await pollUntil(() => {
        const err = client.frames.slice(parseAt).find((m) => m.type === "error");
        return err?.code === "PARSE" ? err : undefined;
      });

      const invalidAt = client.frames.length;
      client.ws.send(JSON.stringify({ v: 1, type: "not_a_protocol_frame", id: "x" }));
      await pollUntil(() => {
        const err = client.frames.slice(invalidAt).find((m) => m.type === "error");
        return err?.code === "INVALID_MESSAGE" ? err : undefined;
      });

      const longText = "x".repeat(SessionHost.maxPlayerInputChars + 1);
      client.send({ v: 1, type: "input", id: "too-long", text: longText });
      await client.wait((m) => m.type === "error" && m.id === "too-long" && m.code === "INPUT_TOO_LONG");

      client.send({ v: 1, type: "ping", id: "ping-ok" });
      await client.wait((m) => m.type === "pong" && m.id === "ping-ok");
      expect(client.frames.length).toBeGreaterThan(before);
      client.close();
    },
    { timeout: 10_000 },
  );

  test(
    "back-to-back inputs are serialized without interleaved stream requestIds",
    async () => {
      const stack = await openE2eStack();
      stacks.push(() => stack.dispose());
      const client = await helloController(stack.wsUrl);
      const start = client.frames.length;

      client.send({ v: 1, type: "input", id: "q1", text: "One" });
      client.send({ v: 1, type: "input", id: "q2", text: "Two" });
      await client.wait((m) => m.type === "result" && m.id === "q1");
      await client.wait((m) => m.type === "result" && m.id === "q2");

      const streams = client.frames.slice(start).filter((m) => m.type === "stream");
      const ids = streams.map((m) => m.requestId);
      expect(new Set(ids)).toEqual(new Set(["q1", "q2"]));
      // Serialized, not interleaved: every q1 frame comes before the first q2 frame.
      expect(ids.lastIndexOf("q1")).toBeLessThan(ids.indexOf("q2"));
      client.close();
    },
    { timeout: 10_000 },
  );

  test(
    "disconnect during gallery job does not wedge the room",
    async () => {
      const stack = await openE2eStack({
        seedGallery: true,
        ports: { image: createFakeImagePort("web-e2e/delay", { kind: "delay", ms: 4_000 }) },
      });
      stacks.push(() => stack.dispose());
      const client = await helloController(stack.wsUrl);
      client.send({ v: 1, type: "gallery_capture", id: "cap-1" });
      await client.wait(
        (m) => m.type === "gallery_notice" || (m.type === "result" && m.id === "cap-1"),
        E2E_DEADLINE_MS,
      );
      client.close();

      const next = await helloController(stack.wsUrl, { clientId: "e2e-after-drop" });
      next.send({ v: 1, type: "ping", id: "ping-after" });
      await next.wait((m) => m.type === "pong" && m.id === "ping-after");
      next.send({ v: 1, type: "input", id: "after-drop", text: "Still playable" });
      await next.wait((m) => m.type === "result" && m.id === "after-drop");
      next.close();
    },
    { timeout: 10_000 },
  );

  test(
    "oversized websocket payload closes client; room stays usable",
    async () => {
      const stack = await openE2eStack();
      stacks.push(() => stack.dispose());
      const victim = await helloController(stack.wsUrl, { clientId: "e2e-oversize-victim" });
      const maxBytes = resolveSecurityConfig({ host: "127.0.0.1", port: 1 }).maxMessageBytes;
      victim.ws.send("x".repeat(maxBytes + 1));
      await pollUntil(() => (victim.ws.readyState === WebSocket.CLOSED ? true : undefined));

      const peer = await helloController(stack.wsUrl, { clientId: "e2e-oversize-peer" });
      peer.send({ v: 1, type: "input", id: "after-oversize", text: "Recover" });
      await peer.wait((m) => m.type === "result" && m.id === "after-oversize");
      peer.close();
    },
    { timeout: 10_000 },
  );

  test(
    "disconnect mid-turn stream does not wedge the room",
    async () => {
      const stack = await openE2eStack();
      stacks.push(() => stack.dispose());
      const flaky = await helloController(stack.wsUrl, { clientId: "e2e-midstream-drop" });
      flaky.send({ v: 1, type: "input", id: "mid-drop", text: "Drop mid stream" });
      await flaky.wait((m) => m.type === "busy" && m.active === true && m.requestId === "mid-drop");
      await flaky.wait((m) => m.type === "stream" && m.requestId === "mid-drop");
      flaky.close();

      const next = await helloController(stack.wsUrl, { clientId: "e2e-after-midstream" });
      next.send({ v: 1, type: "input", id: "after-mid", text: "Still works" });
      await next.wait((m) => m.type === "result" && m.id === "after-mid");
      next.close();
    },
    { timeout: 10_000 },
  );

  test(
    "resumeSeq after partial turn replay matches missed stream frames",
    async () => {
      const stack = await openE2eStack();
      stacks.push(() => stack.dispose());
      const first = await helloController(stack.wsUrl, { clientId: "e2e-partial-resume" });
      first.send({ v: 1, type: "input", id: "turn-partial", text: "Partial" });
      const firstStream = await first.wait((m) => m.type === "stream");
      if (firstStream.type !== "stream") throw new Error("expected stream frame");
      const resumeSeq = firstStream.seq - 1;
      const missed = first.frames.filter(
        (m) => (m.type === "busy" || m.type === "stream") && "seq" in m && m.seq > resumeSeq,
      );
      first.close();

      const again = new WsSession(stack.wsUrl);
      await again.ready();
      again.send({
        v: 1,
        type: "hello",
        role: "controller",
        clientId: "e2e-partial-resume",
        resumeSeq,
      });
      await again.wait((m) => m.type === "hello_ok");
      await pollUntil(() => (again.frames.some((m) => m.type === "snapshot") ? true : undefined));
      const replayed = again.frames.filter(
        (m) => (m.type === "busy" || m.type === "stream") && "seq" in m && m.seq > resumeSeq,
      );
      expect(replayed.map((m) => m.seq)).toEqual(missed.map((m) => m.seq));
      again.close();
    },
    { timeout: 10_000 },
  );
});
