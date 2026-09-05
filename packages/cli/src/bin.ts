#!/usr/bin/env node
import "./presets.ts";
import { runCli } from "./cli.ts";

const code = await runCli(process.argv.slice(2), process.env);
process.exitCode = code;
