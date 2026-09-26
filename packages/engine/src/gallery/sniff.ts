import type { ImageMime } from "../ports.ts";

export function imageMimeFromBytes(bytes: Uint8Array): ImageMime | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

export function sniffImageDimensions(bytes: Uint8Array, mime?: ImageMime): { width: number; height: number; mime: ImageMime } | undefined {
  const detected = mime ?? imageMimeFromBytes(bytes);
  if (!detected) return undefined;
  if (detected === "image/png") return sniffPng(bytes, detected);
  if (detected === "image/jpeg") return sniffJpeg(bytes, detected);
  if (detected === "image/webp") return sniffWebp(bytes, detected);
  return undefined;
}

function sniffPng(bytes: Uint8Array, mime: ImageMime): { width: number; height: number; mime: ImageMime } | undefined {
  if (bytes.length < 24) return undefined;
  const width = (bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!;
  const height = (bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!;
  if (width <= 0 || height <= 0 || width > 65535 || height > 65535) return undefined;
  return { width, height, mime };
}

function sniffJpeg(bytes: Uint8Array, mime: ImageMime): { width: number; height: number; mime: ImageMime } | undefined {
  let i = 2;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1]!;
    i += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (i + 1 >= bytes.length) break;
    const len = (bytes[i]! << 8) | bytes[i + 1]!;
    if (len < 2) break;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 7 >= bytes.length) return undefined;
      const height = (bytes[i + 3]! << 8) | bytes[i + 4]!;
      const width = (bytes[i + 5]! << 8) | bytes[i + 6]!;
      if (width > 0 && height > 0) return { width, height, mime };
      return undefined;
    }
    i += len;
  }
  return undefined;
}

function sniffWebp(bytes: Uint8Array, mime: ImageMime): { width: number; height: number; mime: ImageMime } | undefined {
  if (bytes.length < 30) return undefined;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === "VP8 ") {
    if (bytes.length < 30) return undefined;
    const width = bytes[26]! | (bytes[27]! << 8);
    const height = bytes[28]! | (bytes[29]! << 8);
    if (width > 0 && height > 0) return { width: width & 0x3fff, height: height & 0x3fff, mime };
  }
  if (chunk === "VP8L" && bytes.length >= 25) {
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height, mime };
  }
  if (chunk === "VP8X" && bytes.length >= 30) {
    const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
    const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
    return { width, height, mime };
  }
  return undefined;
}
