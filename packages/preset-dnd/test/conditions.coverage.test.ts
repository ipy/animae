import { expect, test, describe } from "bun:test";
import { conditionField } from "../src/conditions.ts";

describe("SRD condition fields", () => {
  test("charmed grants social advantage and forbids hostile intent", () => {
    const f = conditionField("charmed", { charmer: "npc1" });
    expect(f.id).toBe("dnd-charmed-npc1");
    expect(f.level).toBe("L2");
    expect(f.effects.intent_forbid).toEqual(["hostile"]);
    expect(f.effects.check_mod?.persuasion).toEqual({ bonus: 0, advantage: "advantage" });
    expect(f.effects.check_mod?.deception).toEqual({ bonus: 0, advantage: "advantage" });
  });

  test("frightened belongs to the frightened subject, keyed by source, and applies blanket disadvantage", () => {
    const fr = conditionField("frightened", { subject: "player", source: "dragon" });
    expect(fr.id).toBe("dnd-frightened-player-dragon");
    expect(fr.holder).toEqual({ kind: "character", ref: "player" });
    expect(fr.level).toBe("L1");
    expect(fr.effects.check_mod?.["*"]).toEqual({ bonus: 0, advantage: "disadvantage" });
    expect(conditionField("frightened", { subject: "player" }).id).toBe("dnd-frightened-player");
    expect(conditionField("frightened", { subject: "player", source: "wolf" }).id).not.toBe(fr.id);
    const po = conditionField("poisoned", { subject: "player" });
    expect(po.holder).toEqual({ kind: "character", ref: "player" });
    expect(po.effects.check_mod?.["*"]?.advantage).toBe("disadvantage");
  });

  test("exhaustion clamps level and applies −2 per level bonus", () => {
    expect(conditionField("exhaustion", { level: 0, subject: "p" }).effects.check_mod?.["*"]?.bonus).toBe(-2);
    expect(conditionField("exhaustion", { level: 9, subject: "p" }).effects.check_mod?.["*"]?.bonus).toBe(-12);
    expect(conditionField("exhaustion", { level: 3 }).description).toBe("Exhaustion level 3");
  });
});
