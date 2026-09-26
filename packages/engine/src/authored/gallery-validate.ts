import type { Authored } from "../schema/authored.ts";
import { GalleryConfigSchema } from "../schema/gallery.ts";
import type { ConfigIssue } from "./errors.ts";
import { createCelEngine } from "../rules/cel.ts";

export function validateGalleryAuthored(authored: Authored, storageExists: (path: string) => Promise<boolean>): Promise<ConfigIssue[]> {
  return validateGalleryAuthoredSync(authored, storageExists);
}

async function validateGalleryAuthoredSync(
  authored: Authored,
  storageExists: (path: string) => Promise<boolean>,
): Promise<ConfigIssue[]> {
  const issues: ConfigIssue[] = [];
  const raw = authored.config.gallery;
  if (!raw) return issues;
  const parsed = GalleryConfigSchema.safeParse(raw);
  if (!parsed.success) {
    for (const iss of parsed.error.issues) {
      issues.push({
        file: "animae.yaml",
        path: `gallery.${iss.path.join(".")}`,
        message: iss.message,
      });
    }
    return issues;
  }
  const cfg = parsed.data;
  const cel = createCelEngine();
  const characterIds = new Set(Object.keys(authored.characters));
  const locationIds = new Set(Object.keys(authored.locations));
  const ratingIds = new Set(Object.keys(cfg.ratings));
  ratingIds.add(cfg.defaultRating);

  for (const [rid, rdef] of Object.entries(cfg.ratings)) {
    const err = cel.check(rdef.when);
    if (err) {
      issues.push({
        file: "animae.yaml",
        path: `gallery.ratings.${rid}.when`,
        message: err,
      });
    }
  }

  const seen = new Set<string>();
  for (const [id, entry] of Object.entries(cfg.entries)) {
    if (seen.has(id)) {
      issues.push({ file: "animae.yaml", path: `gallery.entries.${id}`, message: "duplicate entry id" });
    }
    seen.add(id);
    if (!ratingIds.has(entry.rating) && !cfg.ratings[entry.rating]) {
      issues.push({
        file: "animae.yaml",
        path: `gallery.entries.${id}.rating`,
        message: `unknown rating "${entry.rating}"`,
      });
    }
    for (const [i, cid] of entry.characters.entries()) {
      if (!characterIds.has(cid)) {
        issues.push({
          file: "animae.yaml",
          path: `gallery.entries.${id}.characters[${i}]`,
          message: `unknown character "${cid}"`,
        });
      }
    }
    if (entry.location && !locationIds.has(entry.location)) {
      issues.push({
        file: "animae.yaml",
        path: `gallery.entries.${id}.location`,
        message: `unknown location "${entry.location}"`,
      });
    }
    if (entry.unlock?.when) {
      const err = cel.check(entry.unlock.when);
      if (err) {
        issues.push({
          file: "animae.yaml",
          path: `gallery.entries.${id}.unlock.when`,
          message: err,
        });
      }
    }
    if (entry.unlock?.when && !entry.hint) {
      issues.push({
        file: "animae.yaml",
        path: `gallery.entries.${id}.hint`,
        message: "hint is required when unlock.when is set",
      });
    }
    if (entry.image?.src) {
      if (entry.image.src.includes("..") || entry.image.src.startsWith("/") || entry.image.src.includes("\\")) {
        issues.push({
          file: "animae.yaml",
          path: `gallery.entries.${id}.image.src`,
          message: "image.src must be a relative path under the authored root (no .. or absolute paths)",
        });
      } else if (!(await storageExists(entry.image.src))) {
        issues.push({
          file: "animae.yaml",
          path: `gallery.entries.${id}.image.src`,
          message: `missing shipped art file "${entry.image.src}"`,
        });
      }
    }
  }
  return issues;
}
