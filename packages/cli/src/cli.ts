import { runExportCard, runImportCard } from "./commands/cards.ts";
import { runInit } from "./commands/init.ts";
import { runInspect } from "./commands/inspect.ts";
import { runRunCommand } from "./commands/run-cmd.ts";
import { runServe } from "./commands/serve.ts";
import { runTimeline } from "./commands/timeline.ts";
import { runValidate } from "./commands/validate.ts";
import { runModsExplain, runModsList, runModsValidate } from "./commands/mods.ts";
import { printError } from "./errors.ts";
import { helpText, parseCli, type GlobalCliOptions } from "./args.ts";
import { readPackageVersion } from "./version.ts";
import { runI18n } from "./commands/i18n.ts";
import { runGallery } from "./commands/gallery.ts";

function engineOpts(global: GlobalCliOptions) {
  return {
    root: global.root,
    modelMode: global.modelMode,
    mode: global.mode,
    seed: global.seed,
    lang: global.lang,
    imageCommand: global.imageCommand,
    imageCommandArgs: global.imageCommandArgs,
  };
}

export async function runCli(argv: string[], _env: Record<string, string | undefined> = process.env): Promise<number> {
  try {
    const parsed = parseCli(argv);

    switch (parsed.kind) {
      case "help":
        process.stdout.write(helpText());
        return 0;
      case "version":
        process.stdout.write(`${readPackageVersion()}\n`);
        return 0;
      case "init":
        return runInit({ dir: parsed.dir, preset: parsed.preset });
      case "validate":
        return runValidate(parsed.global.root, parsed.mods, parsed.locale, parsed.mode);
      case "mods":
        if (parsed.sub === "list") return runModsList(parsed.global.root);
        if (parsed.sub === "validate") return runModsValidate(parsed.global.root, parsed.mods);
        return runModsExplain(parsed.global.root, parsed.path!, parsed.mods);
      case "run":
        return runRunCommand({
          ...engineOpts(parsed.global),
          scene: parsed.scene,
          withIds: parsed.withIds,
          viewer: parsed.viewer,
          theme: parsed.theme,
          plain: parsed.plain,
        });
      case "inspect":
        return runInspect({
          ...engineOpts(parsed.global),
          path: parsed.path,
          viewer: parsed.viewer,
          eventKind: parsed.eventKind,
        });
      case "timeline":
        return runTimeline(parsed.sub, parsed.rest, engineOpts(parsed.global));
      case "import-card":
        return runImportCard(parsed.file, engineOpts(parsed.global));
      case "export-card":
        return runExportCard(parsed.id, engineOpts(parsed.global));
      case "serve":
        return runServe({ ...engineOpts(parsed.global), stdio: parsed.stdio });
      case "gallery":
        return runGallery(parsed.sub, parsed.rest, {
          ...engineOpts(parsed.global),
          json: parsed.json,
        });
      case "i18n":
        return runI18n(parsed.sub, parsed.rest);
      default:
        return 1;
    }
  } catch (err) {
    printError(err);
    return 1;
  }
}
