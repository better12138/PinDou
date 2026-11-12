// 回归专用的极简 PNG 解码：只支持 8bit、非交错、灰度/RGB/RGBA，够读取测试照片。
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const channelCount = { 0: 1, 2: 3, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function readPng(filePath) {
  const buffer = readFileSync(filePath);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    if (type === 'IHDR') {
      width = buffer.readUInt32BE(start);
      height = buffer.readUInt32BE(start + 4);
      bitDepth = buffer[start + 8];
      colorType = buffer[start + 9];
      interlace = buffer[start + 12];
    } else if (type === 'IDAT') {
      idat.push(buffer.subarray(start, start + length));
    } else if (type === 'IEND') {
      break;
    }
    offset = start + length + 4;
  }
  if (bitDepth !== 8) throw new Error(`${filePath}: only 8-bit PNG is supported, got ${bitDepth}`);
  if (interlace !== 0) throw new Error(`${filePath}: interlaced PNG is not supported`);
  const channels = channelCount[colorType];
  if (!channels) throw new Error(`${filePath}: unsupported PNG color type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const target = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[rowStart + x];
      const left = x >= channels ? pixels[target + x - channels] : 0;
      const up = y > 0 ? pixels[target + x - stride] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[target + x - stride - channels] : 0;
      let result;
      if (filter === 0) result = value;
      else if (filter === 1) result = value + left;
      else if (filter === 2) result = value + up;
      else if (filter === 3) result = value + ((left + up) >> 1);
      else if (filter === 4) result = value + paeth(left, up, upLeft);
      else throw new Error(`${filePath}: unknown PNG filter ${filter}`);
      pixels[target + x] = result & 255;
    }
  }

  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const source = index * channels;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 255;
    if (colorType === 0) {
      r = g = b = pixels[source];
    } else if (colorType === 2) {
      r = pixels[source];
      g = pixels[source + 1];
      b = pixels[source + 2];
    } else if (colorType === 4) {
      r = g = b = pixels[source];
      a = pixels[source + 1];
    } else {
      r = pixels[source];
      g = pixels[source + 1];
      b = pixels[source + 2];
      a = pixels[source + 3];
    }
    const target = index * 4;
    data[target] = r;
    data[target + 1] = g;
    data[target + 2] = b;
    data[target + 3] = a;
  }
  return { width, height, data };
}
