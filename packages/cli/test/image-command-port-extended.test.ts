import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AnimaeError } from "@animae/engine";
import { createCommandImagePort } from "../src/image-command-port.ts";

const MIN_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

const MIN_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const MIN_WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.alloc(4),
  Buffer.from("WEBP", "ascii"),
  Buffer.alloc(4),
]);

async function writeScript(dir: string, name: string, body: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, body);
  await chmod(path, 0o755);
  return path;
}

const req = {
  label: "cg",
  prompt: "test",
  width: 64,
  height: 64,
  rating: "general" as const,
};

describe("createCommandImagePort edge cases", () => {
  test("non-zero exit rejects with GALLERY_GENERATION_FAILED", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animae-img-fail-"));
    const script = await writeScript(
      dir,
      "fail.sh",
      `#!/bin/sh
cat >/dev/null
echo err >&2
exit 2
`,
    );
    const port = createCommandImagePort({ command: script });
    await expect(port.generate(req)).rejects.toMatchObject({ code: "GALLERY_GENERATION_FAILED" });
  });

  test("missing binary rejects", async () => {
    const port = createCommandImagePort({ command: join(tmpdir(), "animae-no-such-cmd-xyz") });
    await expect(port.generate(req)).rejects.toMatchObject({ code: "GALLERY_GENERATION_FAILED" });
  });

  test("timeout aborts long-running command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animae-img-timeout-"));
    const script = await writeScript(
      dir,
      "slow.sh",
      `#!/bin/sh
cat >/dev/null
sleep 5
`,
    );
    const port = createCommandImagePort({ command: script, timeoutMs: 50 });
    await expect(port.generate(req)).rejects.toMatchObject({ code: "GALLERY_GENERATION_FAILED" });
  });

  test("empty stdout rejects", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animae-img-empty-"));
    const script = await writeScript(
      dir,
      "empty.sh",
      `#!/bin/sh
cat >/dev/null
exit 0
`,
    );
    const port = createCommandImagePort({ command: script });
    await expect(port.generate(req)).rejects.toMatchObject({ code: "GALLERY_GENERATION_FAILED" });
  });

  test("unrecognized bytes reject", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animae-img-garbage-"));
    const script = await writeScript(
      dir,
      "garbage.sh",
      `#!/bin/sh
cat >/dev/null
printf 'not-an-image'
`,
    );
    const port = createCommandImagePort({ command: script });
    await expect(port.generate(req)).rejects.toMatchObject({ code: "GALLERY_GENERATION_FAILED" });
  });

  test("passes extra args and reads large stdout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animae-img-args-"));
    const marker = join(dir, "args.txt");
    const script = await writeScript(
      dir,
      "args.sh",
      `#!/bin/sh
echo "$@" > "${marker}"
cat >/dev/null
printf '\\211PNG\\015\\012\\032\\012'
dd if=/dev/zero bs=1024 count=32 2>/dev/null
`,
    );
    const port = createCommandImagePort({ command: script, args: ["--tier", "general"] });
    const result = await port.generate(req);
    expect(result.mime).toBe("image/png");
    expect(result.bytes.byteLength).toBeGreaterThan(1024);
    const argsText = await Bun.file(marker).text();
    expect(argsText).toContain("--tier");
  });

  test("sniffs jpeg and webp mime types", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animae-img-mime-"));
    const jpegScript = await writeScript(
      dir,
      "jpeg.sh",
      `#!/bin/sh
cat >/dev/null
bun -e 'process.stdout.write(Buffer.from(${JSON.stringify([...MIN_JPEG, ...MIN_PNG])}))'
`,
    );
    const jpegPort = createCommandImagePort({ command: jpegScript });
    expect((await jpegPort.generate(req)).mime).toBe("image/jpeg");

    const webpScript = await writeScript(
      dir,
      "webp.sh",
      `#!/bin/sh
cat >/dev/null
bun -e 'process.stdout.write(Buffer.from(${JSON.stringify([...MIN_WEBP, ...MIN_PNG])}))'
`,
    );
    const webpPort = createCommandImagePort({ command: webpScript });
    expect((await webpPort.generate(req)).mime).toBe("image/webp");
  });

  test("AbortSignal kills in-flight generation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animae-img-abort-"));
    const script = await writeScript(
      dir,
      "abort.sh",
      `#!/bin/sh
cat >/dev/null
sleep 10
printf '\\211PNG\\015\\012\\032\\012\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000'
`,
    );
    const port = createCommandImagePort({ command: script, timeoutMs: 60_000 });
    const ac = new AbortController();
    const pending = port.generate(req, { signal: ac.signal });
    ac.abort();
    await expect(pending).rejects.toBeInstanceOf(AnimaeError);
  });
});
