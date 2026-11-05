import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { extractSillyTavernJsonFromPng, buildPngWithCharaChunk } from "../../src/entities/png-chunks.ts";

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length, false);
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(4 + 4 + data.length + 4);
  body.set(len, 0);
  body.set(typeBytes, 4);
  body.set(data, 8);
  new DataView(body.buffer).setUint32(8 + data.length, crc32(body.subarray(4, 8 + data.length)), false);
  return body;
}

function buildPngWithItxtChunk(keyword: string, base64Payload: string, compressed: boolean): Uint8Array {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = pngChunk("IHDR", new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]));
  const textBytes = new TextEncoder().encode(base64Payload);
  const payload = compressed ? deflateSync(textBytes) : textBytes;
  const keywordBytes = new TextEncoder().encode(keyword);
  const data = new Uint8Array(keywordBytes.length + 1 + 1 + 1 + 1 + 1 + payload.length);
  let o = 0;
  data.set(keywordBytes, o);
  o += keywordBytes.length;
  data[o++] = 0;
  data[o++] = compressed ? 1 : 0;
  data[o++] = 0;
  data[o++] = 0;
  data[o++] = 0;
  data.set(payload, o);
  const itxt = pngChunk("iTXt", data);
  const iend = pngChunk("IEND", new Uint8Array(0));
  const out = new Uint8Array(sig.length + ihdr.length + itxt.length + iend.length);
  o = 0;
  out.set(sig, o);
  o += sig.length;
  out.set(ihdr, o);
  o += ihdr.length;
  out.set(itxt, o);
  o += itxt.length;
  out.set(iend, o);
  return out;
}

describe("extractSillyTavernJsonFromPng iTXt", () => {
  test("reads ccv3 from compressed iTXt preferring v3 over v2 tEXt", () => {
    const v2Payload = Buffer.from(JSON.stringify({ name: "v2" })).toString("base64");
    const v3Payload = Buffer.from(JSON.stringify({ name: "v3" })).toString("base64");
    const pngV2 = buildPngWithCharaChunk(v2Payload);
    const pngV3 = buildPngWithItxtChunk("ccv3", v3Payload, true);
    expect(JSON.parse(extractSillyTavernJsonFromPng(pngV2)!).name).toBe("v2");
    expect(JSON.parse(extractSillyTavernJsonFromPng(pngV3)!).name).toBe("v3");
  });

  test("returns decoded utf8 payload from chara chunk", () => {
    const png = buildPngWithCharaChunk(Buffer.from("not-json", "utf8").toString("base64"));
    expect(extractSillyTavernJsonFromPng(png)).toBe("not-json");
  });

  test("truncated chunk stops scan without throwing", () => {
    const png = buildPngWithCharaChunk("YQ==");
    const truncated = png.subarray(0, png.length - 20);
    expect(extractSillyTavernJsonFromPng(truncated)).toBeUndefined();
  });
});
