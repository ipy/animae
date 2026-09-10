import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { e2ePreset, seedE2eAuthored } from "../e2e/fixture.ts";

function scriptedModels() {
  const handler = () => ({ type: "chat", intensity: 0.5, sincerity: 0.5, claims: [], search_terms: [], tags: [], input_class: "normal" });
  return {
    s1: createScriptedModel("e2e/s1", handler),
    s2: createScriptedModel("e2e/s2", handler),
  };
}

test("setUiLocale updates engine.info().locale without restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "animae-ui-locale-"));
  try {
    const storage = FsStorage(root);
    await seedE2eAuthored(storage);
    const engine = await createEngine({
      root,
      ports: { storage },
      presets: [e2ePreset],
      models: scriptedModels(),
      sessionId: "ui_loc",
      i18n: { locale: "en", promptLocale: "zh-CN", outputLocale: "en", contentLocale: "zh-CN", fallbackLocale: "en" },
    });
    expect(engine.info().locale).toBe("en");
    engine.setUiLocale("zh-CN");
    expect(engine.info().locale).toBe("zh-CN");
    expect(engine.info().contentLocale).toBe("zh-CN");
    await engine.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
