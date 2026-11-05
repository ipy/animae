import { describe, expect, test } from "bun:test";
import { writeFile, chmod, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCommandImagePort } from "../src/image-command-port.ts";

const MIN_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

describe("createCommandImagePort", () => {
  test("reads JSON stdin and returns stdout bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animae-img-cmd-"));
    const script = join(dir, "fake-image.sh");
    await writeFile(
      script,
      `#!/bin/sh
cat >/dev/null
printf '\\211PNG\\015\\012\\032\\012\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000'
`,
    );
    await chmod(script, 0o755);
    const port = createCommandImagePort({ command: script });
    const result = await port.generate({
      label: "cg",
      prompt: "test",
      width: 64,
      height: 64,
      rating: "general",
    });
    expect(result.mime).toBe("image/png");
    expect(result.bytes.byteLength).toBeGreaterThan(10);
  });
});
