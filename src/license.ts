/**
 * 兑换码与导出次数。
 *
 * 纯前端校验：兑换码 = 8 位随机码 + 4 位签名，签名用内置密钥做哈希。
 * 密钥在前端可见，挡不住刻意破解，但足以防止随手乱填和误用，适合 0.5 元/次的小额付费。
 * 兑换记录与剩余次数存在 localStorage，按浏览器计算。
 */

const storageKey = 'perler-beads-generator:credits';
// 不含 0/1/I/O，避免抄码时认错
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const secret = 'pindou-xhs-2026';
const payloadLength = 8;
const signatureLength = 4;
const codeLength = payloadLength + signatureLength;

type CreditState = {
  credits: number;
  usedCodes: string[];
};

const listeners = new Set<() => void>();

function loadState(): CreditState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { credits: 0, usedCodes: [] };
    const parsed = JSON.parse(raw) as Partial<CreditState>;
    return {
      credits: Number.isFinite(parsed.credits) ? Math.max(0, Math.floor(Number(parsed.credits))) : 0,
      usedCodes: Array.isArray(parsed.usedCodes) ? parsed.usedCodes.filter((code): code is string => typeof code === 'string') : [],
    };
  } catch {
    return { credits: 0, usedCodes: [] };
  }
}

function saveState(state: CreditState): void {
  localStorage.setItem(storageKey, JSON.stringify(state));
  for (const listener of listeners) listener();
}

export function getCredits(): number {
  return loadState().credits;
}

export function subscribeCredits(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function hash32(text: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function signatureOf(payload: string): string {
  let result = '';
  for (let index = 0; index < signatureLength; index += 1) {
    const value = hash32(`${secret}|${payload}|${index}`, (index + 1) * 0x9e3779b1);
    result += alphabet[value % alphabet.length];
  }
  return result;
}

export function normalizeCode(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.startsWith('PD') ? cleaned.slice(2) : cleaned;
}

export function formatCode(raw: string): string {
  const code = normalizeCode(raw);
  return code ? code.replace(/(.{4})/g, '$1-').replace(/-$/, '') : '';
}

export type RedeemResult = { ok: true; credits: number } | { ok: false; reason: 'format' | 'invalid' | 'used' };

export function redeemCode(raw: string): RedeemResult {
  const code = normalizeCode(raw);
  const validChars = [...code].every((char) => alphabet.includes(char));
  if (code.length !== codeLength || !validChars) return { ok: false, reason: 'format' };
  const payload = code.slice(0, payloadLength);
  if (signatureOf(payload) !== code.slice(payloadLength)) return { ok: false, reason: 'invalid' };
  const state = loadState();
  if (state.usedCodes.includes(code)) return { ok: false, reason: 'used' };
  const next: CreditState = { credits: state.credits + 1, usedCodes: [...state.usedCodes, code] };
  saveState(next);
  return { ok: true, credits: next.credits };
}

/** 导出前调用：有次数则扣 1 次并返回 true。 */
export function consumeCredit(): boolean {
  const state = loadState();
  if (state.credits <= 0) return false;
  saveState({ ...state, credits: state.credits - 1 });
  return true;
}
