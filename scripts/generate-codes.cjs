#!/usr/bin/env node
/**
 * 生成兑换码，与 src/license.ts 的算法保持一致。
 *
 * 用法：
 *   node scripts/generate-codes.cjs         # 生成 20 个
 *   node scripts/generate-codes.cjs 100     # 生成 100 个
 *
 * 每行一个码，可直接复制发给买家；一个码兑换 1 次高清导出。
 */

const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const secret = 'pindou-xhs-2026';
const payloadLength = 8;
const signatureLength = 4;

function hash32(text, seed) {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function signatureOf(payload) {
  let result = '';
  for (let index = 0; index < signatureLength; index += 1) {
    const value = hash32(`${secret}|${payload}|${index}`, (index + 1) * 0x9e3779b1);
    result += alphabet[value % alphabet.length];
  }
  return result;
}

function randomPayload() {
  let payload = '';
  for (let index = 0; index < payloadLength; index += 1) {
    payload += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return payload;
}

const count = Math.max(1, Number.parseInt(process.argv[2] ?? '20', 10) || 20);
const codes = [];
const seen = new Set();
while (codes.length < count) {
  const payload = randomPayload();
  if (seen.has(payload)) continue;
  seen.add(payload);
  const code = payload + signatureOf(payload);
  codes.push(`${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`);
}

console.log(codes.join('\n'));
