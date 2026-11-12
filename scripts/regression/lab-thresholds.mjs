// 阈值标定复算脚本：node scripts/regression/lab-thresholds.mjs
// 说明：去噪/合并阈值统一到 CIEDE2000 后，阈值不再是"拍脑袋的 RGB 数字"，
// 而是按下表标定——色卡最近邻间距决定"多近算同色"，RGB→ΔE00 的实测比值用于平移老阈值。
import fs from 'node:fs';
import path from 'node:path';

const paletteFile = path.join(process.cwd(), 'src/palette.ts');
const source = fs.readFileSync(paletteFile, 'utf8');

function readCsv(name) {
  const match = source.match(new RegExp('const raw' + name + 'Csv = `([\\s\\S]*?)`;'));
  if (!match) throw new Error(`未找到 raw${name}Csv`);
  return match[1]
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [code, hex] = line.split(',');
      return {
        code: code.trim(),
        rgb: [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)),
      };
    });
}

const mard = [...readCsv('Colors'), ...readCsv('ExtendedColors')];
const artkal = readCsv('Artkal');

const srgbToLinear = (channel) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const labPivot = (value) => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);

function rgbToLab([r, g, b]) {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const x = labPivot((rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047);
  const y = labPivot(rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175);
  const z = labPivot((rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function hueAngle(b, a) {
  if (a === 0 && b === 0) return 0;
  const angle = (Math.atan2(b, a) * 180) / Math.PI;
  return angle >= 0 ? angle : angle + 360;
}

function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const h1p = hueAngle(b1, a1p);
  const h2p = hueAngle(b2, a2p);
  const dLp = L2 - L1;
  const dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp * Math.PI) / 360);
  const lBarP = (L1 + L2) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBarP = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hBarP = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hBarP = (h1p + h2p + 360) / 2;
    else hBarP = (h1p + h2p - 360) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos(((hBarP - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hBarP * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hBarP + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hBarP - 63) * Math.PI) / 180);
  const dTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2);
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt = -Math.sin((2 * dTheta * Math.PI) / 180) * rc;
  return Math.sqrt((dLp / sl) ** 2 + (dCp / sc) ** 2 + (dHp / sh) ** 2 + rt * (dCp / sc) * (dHp / sh));
}

function rgbDistance(a, b) {
  const redMean = (a[0] + b[0]) / 2;
  const r = a[0] - b[0];
  const g = a[1] - b[1];
  const bl = a[2] - b[2];
  return Math.sqrt((2 + redMean / 256) * r * r + 4 * g * g + (2 + (255 - redMean) / 256) * bl * bl);
}

const quantile = (rows, q) => rows[Math.min(rows.length - 1, Math.floor(rows.length * q))];

function reportGaps(label, colors) {
  const labs = colors.map((color) => rgbToLab(color.rgb));
  const nearest = colors.map((_, index) => {
    let best = Infinity;
    for (let other = 0; other < colors.length; other += 1) {
      if (other === index) continue;
      best = Math.min(best, deltaE2000(labs[index], labs[other]));
    }
    return best;
  }).sort((a, b) => a - b);
  console.log(
    `${label.padEnd(10)} 最近邻色差 ΔE00：p10 ${quantile(nearest, 0.1).toFixed(2)} / p25 ${quantile(nearest, 0.25).toFixed(2)} / ` +
      `中位数 ${quantile(nearest, 0.5).toFixed(2)} / p75 ${quantile(nearest, 0.75).toFixed(2)}`,
  );
}

console.log('一、色卡自身间距（决定"多近算同色"）');
reportGaps('MARD 291', mard);
reportGaps('Artkal 176', artkal);
console.log('');

console.log('二、RGB 欧氏距离 → ΔE00 的实测比值（用于平移旧阈值）');
const all = [...mard, ...artkal];
const labs = all.map((color) => rgbToLab(color.rgb));
const bands = [[5, 15], [15, 30], [30, 50], [50, 80], [80, 120], [120, 200], [200, 400]];
for (const [low, high] of bands) {
  const ratios = [];
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const rgb = rgbDistance(all[i].rgb, all[j].rgb);
      if (rgb < low || rgb >= high) continue;
      ratios.push(deltaE2000(labs[i], labs[j]) / rgb);
    }
  }
  ratios.sort((a, b) => a - b);
  if (!ratios.length) continue;
  console.log(`  RGB ${String(low).padStart(3)}-${String(high).padStart(3)}：中位比值 ${quantile(ratios, 0.5).toFixed(3)}（样本 ${ratios.length} 对）`);
}
console.log('');

console.log('三、合并阈值表（src/palette.ts: mergeThresholdByLevel）');
[0, 1, 2, 3, 4].forEach((level) => {
  const rgbLegacy = [0, 26, 42, 62, 84][level];
  const deltaE = [0, 3, 5, 7.5, 10][level];
  console.log(`  强度 ${level}：旧 RGB ${String(rgbLegacy).padStart(2)} → 新 ΔE00 ${String(deltaE).padStart(4)}`);
});
