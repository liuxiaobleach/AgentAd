import jsQR from "jsqr";
import sharp from "sharp";

export interface QrDecodeResult {
  found: boolean;
  payloads: string[];
  urls: string[];
}

export async function decodeQr(imageBuffer: Buffer): Promise<QrDecodeResult> {
  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const imageData = new Uint8ClampedArray(data);
  const code = jsQR(imageData, info.width, info.height);

  if (!code) {
    return { found: false, payloads: [], urls: [] };
  }

  const payload = code.data;
  const urls = payload.match(/https?:\/\/[^\s]+/gi) || [];

  return {
    found: true,
    payloads: [payload],
    urls,
  };
}
