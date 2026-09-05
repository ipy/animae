import { inflateSync } from "node:zlib";

/** Extract SillyTavern character JSON from PNG tEXt/iTXt chunks (`chara` v2, `ccv3` v3). Prefers ccv3 when both exist. */
export function extractSillyTavernJsonFromPng(bytes: Uint8Array): string | undefined {
  if (bytes.length < 8) return undefined;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return undefined;

  let offset = 8;
  let v2: string | undefined;
  let v3: string | undefined;

  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;
    const data = bytes.subarray(dataStart, dataEnd);
    offset = dataEnd + 4;

    if (type === "tEXt") {
      const parsed = parseTexChunk(data);
      if (parsed?.keyword === "chara") v2 = parsed.text;
      if (parsed?.keyword === "ccv3") v3 = parsed.text;
    } else if (type === "iTXt") {
      const parsed = parseItxtChunk(data);
      if (parsed?.keyword === "chara") v2 = parsed.text;
      if (parsed?.keyword === "ccv3") v3 = parsed.text;
    } else if (type === "IEND") break;
  }

  const raw = v3 ?? v2;
  if (!raw) return undefined;
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

function readU32(buf: Uint8Array, off: number): number {
  return ((buf[off]! << 24) | (buf[off + 1]! << 16) | (buf[off + 2]! << 8) | buf[off + 3]!) >>> 0;
}

function parseTexChunk(data: Uint8Array): { keyword: string; text: string } | undefined {
  const nul = data.indexOf(0);
  if (nul < 0) return undefined;
  const keyword = new TextDecoder().decode(data.subarray(0, nul));
  const text = new TextDecoder().decode(data.subarray(nul + 1));
  return { keyword, text };
}

function parseItxtChunk(data: Uint8Array): { keyword: string; text: string } | undefined {
  const nul = data.indexOf(0);
  if (nul < 0) return undefined;
  const keyword = new TextDecoder().decode(data.subarray(0, nul));
  let i = nul + 1;
  if (i >= data.length) return undefined;
  const compFlag = data[i]!;
  i++;
  if (i >= data.length) return undefined;
  i++; // comp method
  while (i < data.length && data[i] !== 0) i++;
  if (i >= data.length) return undefined;
  i++; // lang term
  while (i < data.length && data[i] !== 0) i++;
  if (i >= data.length) return undefined;
  i++; // trans term
  const payload = data.subarray(i);
  const textBytes = compFlag === 1 ? inflateSync(payload) : payload;
  const text = new TextDecoder().decode(textBytes);
  return { keyword, text };
}

/** Build a minimal PNG with a tEXt `chara` chunk (for tests). */
export function buildPngWithCharaChunk(base64Payload: string): Uint8Array {
  const ihdr = chunk("IHDR", new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]));
  const text = new TextEncoder().encode(`chara\0${base64Payload}`);
  const textChunk = chunk("tEXt", text);
  const iend = chunk("IEND", new Uint8Array(0));
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const out = new Uint8Array(sig.length + ihdr.length + textChunk.length + iend.length);
  let o = 0;
  out.set(sig, o);
  o += sig.length;
  out.set(ihdr, o);
  o += ihdr.length;
  out.set(textChunk, o);
  o += textChunk.length;
  out.set(iend, o);
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length, false);
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(4 + 4 + data.length + 4);
  body.set(len, 0);
  body.set(typeBytes, 4);
  body.set(data, 8);
  const crc = crc32(body.subarray(4, 8 + data.length));
  new DataView(body.buffer).setUint32(8 + data.length, crc, false);
  return body;
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
