import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { installTerminalShutdown, type TerminalShutdownReason } from "../src/terminal/shutdown.ts";

function ttyPair() {
  const stdin = new PassThrough() as PassThrough & EventEmitter;
  const stdout = new PassThrough() as PassThrough & EventEmitter;
  const stderr = new PassThrough() as PassThrough & EventEmitter;
  return { stdin, stdout, stderr };
}

describe("installTerminalShutdown", () => {
  test("fires once on stdin end and uninstall prevents duplicate handlers", () => {
    const { stdin, stdout, stderr } = ttyPair();
    const reasons: TerminalShutdownReason[] = [];
    const uninstall = installTerminalShutdown({
      stdin,
      stdout,
      stderr,
      onShutdown: (r) => reasons.push(r),
      hardExitMs: 60_000,
    });
    stdin.emit("end");
    stdin.emit("end");
    expect(reasons).toEqual(["stdin-end"]);
    uninstall();
    reasons.length = 0;
    stdin.emit("close");
    expect(reasons).toEqual([]);
  });

  test("stdin close triggers shutdown", () => {
    const { stdin, stdout, stderr } = ttyPair();
    const reasons: TerminalShutdownReason[] = [];
    const uninstall = installTerminalShutdown({
      stdin,
      stdout,
      stderr,
      onShutdown: (r) => reasons.push(r),
      hardExitMs: 60_000,
    });
    stdin.emit("close");
    expect(reasons).toEqual(["stdin-close"]);
    uninstall();
  });

  test("broken pipe on stdout and stderr trigger shutdown", () => {
    const outReasons: TerminalShutdownReason[] = [];
    const outPair = ttyPair();
    const uninstallOut = installTerminalShutdown({
      stdin: outPair.stdin,
      stdout: outPair.stdout,
      stderr: outPair.stderr,
      onShutdown: (r) => outReasons.push(r),
      hardExitMs: 60_000,
    });
    outPair.stdout.emit("error", Object.assign(new Error("pipe"), { code: "EPIPE" }));
    expect(outReasons).toEqual(["stdout-error"]);
    uninstallOut();

    const errReasons: TerminalShutdownReason[] = [];
    const errPair = ttyPair();
    const uninstallErr = installTerminalShutdown({
      stdin: errPair.stdin,
      stdout: errPair.stdout,
      stderr: errPair.stderr,
      onShutdown: (r) => errReasons.push(r),
      hardExitMs: 60_000,
    });
    errPair.stderr.emit("error", Object.assign(new Error("io"), { code: "EIO" }));
    expect(errReasons).toEqual(["stderr-error"]);
    uninstallErr();
  });

  test("SIGHUP invokes onShutdown", () => {
    const { stdin, stdout, stderr } = ttyPair();
    let reason: TerminalShutdownReason | undefined;
    const uninstall = installTerminalShutdown({
      stdin,
      stdout,
      stderr,
      onShutdown: (r) => {
        reason = r;
      },
      hardExitMs: 60_000,
    });
    process.emit("SIGHUP");
    expect(reason).toBe("SIGHUP");
    uninstall();
  });
});
