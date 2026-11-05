import { afterEach, test, expect } from "bun:test";
import { clearLocalePacks } from "@animae/i18n";
import { formatTierLabel, formatTrackLabel } from "../src/utils/tier-display.ts";
import { registerFrenchTuiLocalePack } from "./helpers/locale-packs.ts";

afterEach(() => clearLocalePacks());

test("formatTierLabel uses registered locale pack labels", () => {
  const off = registerFrenchTuiLocalePack();
  try {
    expect(formatTierLabel("close", "fr")).toBe("proche");
    expect(formatTierLabel("accepting", "en")).toBe("accepting");
  } finally {
    off();
  }
});

test("formatTrackLabel uses catalog when present", () => {
  const off = registerFrenchTuiLocalePack();
  try {
    expect(formatTrackLabel("bond", "fr")).toBe("lien");
    expect(formatTrackLabel("unknown_track", "en")).toBe("unknown_track");
  } finally {
    off();
  }
});
