import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import { e2ePreset } from "../e2e/fixture.ts";
import { seedGalleryEngineRoot } from "./fixture.ts";
import { createFakeImagePort } from "./fake-image-port.ts";

describe("gallery text shown in another language than the cards are written in", () => {
  test("name references use that language's spelling, the card name stays the fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-gallery-names-"));
    try {
      const storage = FsStorage(root);
      await seedGalleryEngineRoot(storage);
      // The authored entry mentions a character through a name reference.
      const cfg = (await storage.readText("animae.yaml")) ?? "";
      await storage.writeAtomic(
        "animae.yaml",
        cfg.replace(
          "      title: Dawn greenhouse\n",
          '      title: Dawn greenhouse\n      caption: "{{name:npc1}} waters the seedlings."\n',
        ),
      );
      await storage.writeAtomic("locales/xx/strings.yaml", "character:\n  npc1:\n    name: Aria-xx\n");
      const model = createScriptedModel("m/s1", () => ({ text: "x" }));
      const image = createFakeImagePort("fake/test", { kind: "instant" }, ["tier:general"]);
      const engine = await createEngine({
        root,
        ports: { storage, image },
        presets: [e2ePreset],
        models: { s1: model, s2: model },
      });
      try {
        await engine.gallery.unlock("dawn-greenhouse", { source: "test" });
        const cardLanguage = await engine.gallery.get("dawn-greenhouse");
        expect(cardLanguage?.caption).toBe("Aria waters the seedlings.");

        const other = await engine.gallery.get("dawn-greenhouse", { locale: "xx" });
        expect(other?.caption).toBe("Aria-xx waters the seedlings.");

        // A language without its own spelling keeps the card name (no marker syntax, no other language's string).
        const unknown = await engine.gallery.get("dawn-greenhouse", { locale: "yy" });
        expect(unknown?.caption).toBe("Aria waters the seedlings.");
      } finally {
        await engine.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
