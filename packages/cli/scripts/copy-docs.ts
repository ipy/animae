#!/usr/bin/env bun
import { cp, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const animaeRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const docsSrc = join(animaeRoot, "docs");
const docsDest = join(animaeRoot, "dist", "docs");

await mkdir(dirname(docsDest), { recursive: true });
await cp(docsSrc, docsDest, { recursive: true });
console.log(`Copied docs to ${docsDest}`);
