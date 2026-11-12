import type { BrandId, PaletteColor } from './types';

const stockKey = 'perler-beads-generator:stock-v1';

export type StockState = {
  /** 生成时是否只用库存内的色号 */
  enabled: boolean;
  /** 已拥有的色号 id（带品牌前缀，如 mard-a1 / artkal-s01） */
  ids: string[];
};

export const emptyStock: StockState = { enabled: false, ids: [] };

/** 色差等级：按 CIEDE2000 的人眼可辨距离分段（2 为刚可察觉，6 为同色族边界）。 */
export type SubstitutionGrade = 'fine' | 'slight' | 'noticeable' | 'far';

export function substitutionGrade(deltaE: number): SubstitutionGrade {
  if (deltaE <= 2) return 'fine';
  if (deltaE <= 6) return 'slight';
  if (deltaE <= 12) return 'noticeable';
  return 'far';
}

export function loadStock(): StockState {
  try {
    const raw = localStorage.getItem(stockKey);
    if (!raw) return emptyStock;
    const parsed = JSON.parse(raw) as Partial<StockState>;
    const ids = Array.isArray(parsed.ids) ? [...new Set(parsed.ids.filter((id): id is string => typeof id === 'string'))] : [];
    return { enabled: Boolean(parsed.enabled) && ids.length > 0, ids };
  } catch {
    return emptyStock;
  }
}

export function saveStock(state: StockState): void {
  try {
    localStorage.setItem(stockKey, JSON.stringify(state));
  } catch {
    // 隐私模式下写入失败不影响本次使用。
  }
}

/**
 * 批量导入色号：支持 A1 / mard-a1 / #A1 混排，逗号、空格、换行分隔。
 * 返回能匹配到的色号 id 和无法识别的原始输入（用于提示）。
 */
export function parseStockText(
  text: string,
  colors: PaletteColor[],
  brand: BrandId,
): { ids: string[]; unknown: string[] } {
  const tokens = text
    .split(/[\s,;，、]+/)
    .map((token) => token.trim().replace(/^#/, ''))
    .filter(Boolean);
  const byCode = new Map<string, PaletteColor>();
  const byId = new Map<string, PaletteColor>();
  for (const color of colors) {
    byCode.set(color.primaryCode.toUpperCase(), color);
    byId.set(color.id.toUpperCase(), color);
  }
  const ids = new Set<string>();
  const unknown: string[] = [];
  for (const token of tokens) {
    const upper = token.toUpperCase();
    const color = byCode.get(upper) ?? byId.get(upper) ?? byId.get(`${brand}-${upper}`);
    if (color) ids.add(color.id);
    else if (!unknown.includes(token)) unknown.push(token);
  }
  return { ids: [...ids], unknown };
}
