export function captureStreams(): {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  outText: () => string;
  errText: () => string;
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    stdout: { write: (s: string | Uint8Array) => (out.push(String(s)), true) } as NodeJS.WritableStream,
    stderr: { write: (s: string | Uint8Array) => (err.push(String(s)), true) } as NodeJS.WritableStream,
    outText: () => out.join(""),
    errText: () => err.join(""),
  };
}

export async function withCapturedStdout(
  run: () => Promise<number>,
): Promise<{ code: number; out: string; err: string }> {
  const io = captureStreams();
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = io.stdout.write.bind(io.stdout) as typeof process.stdout.write;
  process.stderr.write = io.stderr.write.bind(io.stderr) as typeof process.stderr.write;
  try {
    const code = await run();
    return { code, out: io.outText(), err: io.errText() };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}
