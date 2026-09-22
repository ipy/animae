import { expect, test } from "bun:test";
import { createMemoryAssetProvider } from "../src/assets/memory-provider.ts";

test("memory asset provider decodes base64 bodies", async () => {
  const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
  const provider = createMemoryAssetProvider({
    "img.bin": { body: payload, contentType: "image/webp; encoding=base64" },
  });
  const entry = await provider.get("img.bin");
  expect(entry).not.toBeNull();
  expect(entry!.contentType).toBe("image/webp");
  expect(entry!.body).toEqual(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
});
