/** Split an async byte/string stream into newline-delimited JSON lines (no trailing empty). */
export async function* readLines(read: AsyncIterable<string | Uint8Array>): AsyncGenerator<string> {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of read) {
    buf += typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const trimmed = line.trim();
      if (trimmed) yield trimmed;
    }
  }
  const tail = buf.trim();
  if (tail) yield tail;
}
