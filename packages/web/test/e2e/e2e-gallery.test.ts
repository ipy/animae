import { afterEach, describe, expect, test } from "bun:test";
import { createFakeImagePort } from "../../../engine/test/gallery/fake-image-port.ts";
import { E2E_DEADLINE_MS, helloController, openE2eStack, pollUntil } from "./e2e-fixture.ts";

const stacks: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (stacks.length) await stacks.pop()!();
});

describe("web e2e gallery", () => {
  test(
    "capture over socket, job notices, HTTP image bytes",
    async () => {
      const image = createFakeImagePort("web-e2e/gallery", { kind: "instant" });
      const stack = await openE2eStack({ seedGallery: true, ports: { image } });
      stacks.push(() => stack.dispose());
      const client = await helloController(stack.wsUrl);

      client.send({ v: 1, type: "gallery_capture", id: "g-cap", req: { focus: "table" } });
      const result = await client.wait((m) => m.type === "result" && m.id === "g-cap");
      const data = (result as { data?: { item?: string; job?: string } }).data;
      expect(data?.item).toMatch(/^cap-/);
      expect(data?.job).toBeTruthy();

      await pollUntil(() => {
        const job = stack.engine.gallery.jobs().find((j) => j.id === data!.job);
        return job?.state === "done" ? job : undefined;
      });

      await client.wait((m) => m.type === "gallery_notice", E2E_DEADLINE_MS);

      const entry = await stack.engine.gallery.get(data!.item!);
      expect(entry?.image?.id).toBeTruthy();
      const imgUrl = `${stack.baseUrl}/api/gallery/image/${encodeURIComponent(data!.item!)}?v=${entry!.image!.id}`;
      const imgRes = await fetch(imgUrl);
      expect(imgRes.status).toBe(200);
      expect(imgRes.headers.get("content-type")).toBe("image/png");
      const bytes = new Uint8Array(await imgRes.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(8);
      expect(bytes[0]).toBe(0x89);
      client.close();
    },
    { timeout: 10_000 },
  );

  test(
    "gallery capture without ImagePort returns error frame",
    async () => {
      const stack = await openE2eStack({ seedGallery: true });
      stacks.push(() => stack.dispose());
      const client = await helloController(stack.wsUrl);
      client.send({ v: 1, type: "gallery_capture", id: "g-no-gen" });
      const err = await client.wait((m) => m.type === "error" && m.id === "g-no-gen");
      expect(err).toMatchObject({ type: "error", code: "GALLERY_NO_GENERATOR" });
      client.close();
    },
    { timeout: 10_000 },
  );
});
