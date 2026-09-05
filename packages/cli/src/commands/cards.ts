import { printError } from "../errors.ts";
import { openEngine, type OpenEngineOptions } from "../engine-open.ts";

export async function runImportCard(file: string, opts: OpenEngineOptions): Promise<number> {
  let engine;
  try {
    engine = await openEngine(opts);
  } catch (err) {
    printError(err);
    return 1;
  }
  try {
    const id = await engine.importCard(file);
    process.stdout.write(`Imported character ${id}\n`);
    return 0;
  } catch (err) {
    printError(err);
    return 1;
  } finally {
    await engine.close();
  }
}

export async function runExportCard(id: string, opts: OpenEngineOptions): Promise<number> {
  let engine;
  try {
    engine = await openEngine(opts);
  } catch (err) {
    printError(err);
    return 1;
  }
  try {
    const path = await engine.exportCard(id);
    process.stdout.write(`${path}\n`);
    return 0;
  } catch (err) {
    printError(err);
    return 1;
  } finally {
    await engine.close();
  }
}
