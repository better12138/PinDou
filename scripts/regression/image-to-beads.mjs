// 图片生成回归：先 npm run build，再 node scripts/regression/image-to-beads.mjs
// 记录旧算法基线时使用 --report-only（只报告断言失败，不中断指标输出）。
import assert from 'node:assert/strict';
import { convertImageData } from '../../generated/dist/src/imageToBeads.js';
import { colorDistanceLab, nearestPaletteColor, palette } from '../../generated/dist/src/palette.js';

const reportOnly = process.argv.includes('--report-only');
const failures = [];
const report = { cases: {}, cache: {}, failures };
const rgb = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
const bead = (id, hex) => ({ id, hex, rgb: rgb(hex), primaryCode: id, primaryBrand: 'MARD', codes: {}, group: 'test', name: id });
const testPalette = [
  bead('black', '#000000'), bead('white', '#FFFFFF'), bead('red', '#E7002F'),
  bead('blue', '#3677D2'), bead('skin', '#F4C3A5'), bead('yellow', '#F4D738'),
  bead('green', '#1C9C4F'), bead('gray', '#89858C'), bead('navy', '#1D3344'),
  bead('pink', '#F551A2'), bead('cyan', '#41CCFF'), bead('brown', '#753832'),
];

function image(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a = 255] = pixel(x, y);
      const index = (y * width + x) * 4;
      data[index] = r; data[index + 1] = g; data[index + 2] = b; data[index + 3] = a;
    }
  }
  return data;
}

function options(overrides = {}) {
  return {
    width: 24, maxColors: 8, palette: testPalette, backgroundMode: 'keep',
    backgroundColor: [255, 255, 255], tolerance: 32, speckleReduction: 0,
    generationStyle: 'cartoon', ...overrides,
  };
}

function convert(data, width, height, overrides = {}) {
  return convertImageData(data, width, height, options(overrides));
}

function check(name, condition, detail = '') {
  if (condition) return;
  failures.push(detail ? `${name}: ${detail}` : name);
}

function isolatedCount(result) {
  let count = 0;
  for (let y = 0; y < result.height; y += 1) {
    for (let x = 0; x < result.width; x += 1) {
      const index = y * result.width + x;
      const id = result.cells[index];
      if (!id) continue;
      let same = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < result.width && ny < result.height && result.cells[ny * result.width + nx] === id) same += 1;
      }
      if (same === 0) count += 1;
    }
  }
  return count;
}

function errorMetrics(data, sourceWidth, sourceHeight, result) {
  const byId = new Map(testPalette.map((color) => [color.id, color]));
  const errors = [];
  for (let y = 0; y < result.height; y += 1) {
    for (let x = 0; x < result.width; x += 1) {
      const id = result.cells[y * result.width + x];
      if (!id) continue;
      const startX = Math.floor((x * sourceWidth) / result.width);
      const endX = Math.max(startX + 1, Math.ceil(((x + 1) * sourceWidth) / result.width));
      const startY = Math.floor((y * sourceHeight) / result.height);
      const endY = Math.max(startY + 1, Math.ceil(((y + 1) * sourceHeight) / result.height));
      let r = 0, g = 0, b = 0, count = 0;
      for (let sy = startY; sy < Math.min(endY, sourceHeight); sy += 1) {
        for (let sx = startX; sx < Math.min(endX, sourceWidth); sx += 1) {
          const index = (sy * sourceWidth + sx) * 4;
          if (data[index + 3] < 24) continue;
          r += data[index]; g += data[index + 1]; b += data[index + 2]; count += 1;
        }
      }
      if (!count) continue;
      const color = byId.get(id);
      if (color) errors.push(colorDistanceLab([r / count, g / count, b / count], color.rgb));
    }
  }
  errors.sort((a, b) => a - b);
  return {
    mean: errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : 0,
    p95: errors.length ? errors[Math.min(errors.length - 1, Math.floor(errors.length * 0.95))] : 0,
  };
}

function metrics(name, data, width, height, result) {
  const colorError = errorMetrics(data, width, height, result);
  report.cases[name] = {
    colorsUsed: result.colorsUsed, totalBeads: result.totalBeads,
    isolated: isolatedCount(result), meanDeltaE00: Number(colorError.mean.toFixed(3)),
    p95DeltaE00: Number(colorError.p95.toFixed(3)),
  };
}

const gradient = image(160, 120, (x, y) => [
  Math.round((x / 159) * 255), Math.round((y / 119) * 180 + 35), Math.round(220 - (x / 159) * 150),
]);
const gradientResult = convert(gradient, 160, 120);
check('渐变色数上限', gradientResult.colorsUsed <= 8);
check('渐变确定性', JSON.stringify(gradientResult.cells) === JSON.stringify(convert(gradient, 160, 120).cells));
metrics('gradient-cartoon', gradient, 160, 120, gradientResult);
check('渐变平均色差', report.cases['gradient-cartoon'].meanDeltaE00 < 28);
check('渐变 p95 色差', report.cases['gradient-cartoon'].p95DeltaE00 < 48);

const realisticResult = convert(gradient, 160, 120, { generationStyle: 'realistic' });
check('写实色数上限', realisticResult.colorsUsed <= 8);
check('写实确定性', JSON.stringify(realisticResult.cells) === JSON.stringify(convert(gradient, 160, 120, { generationStyle: 'realistic' }).cells));
metrics('gradient-realistic', gradient, 160, 120, realisticResult);

const darkLine = image(100, 40, (x) => x >= 49 && x <= 50 ? [0, 0, 0] : [255, 255, 255]);
const darkResult = convert(darkLine, 100, 40, { width: 20, maxColors: 4 });
const darkRoi = darkResult.cells.some((id, index) => id === 'black' && Math.abs((index % darkResult.width) - 10) <= 1);
check('跨格暗线保留', darkRoi);
report.cases['dark-line'] = { roiHit: darkRoi, isolated: isolatedCount(darkResult), colorsUsed: darkResult.colorsUsed };

const accent = image(80, 80, (x, y) => x >= 37 && x < 43 && y >= 37 && y < 43 ? [231, 0, 47] : [65, 204, 255]);
const accentResult = convert(accent, 80, 80, { width: 16, maxColors: 4 });
const accentRoi = accentResult.cells.some((id, index) => {
  const x = index % 16, y = Math.floor(index / 16);
  return id === 'red' && x >= 7 && x <= 8 && y >= 7 && y <= 8;
});
check('小面积高彩度保留', accentRoi);
report.cases.accent = { roiHit: accentRoi, isolated: isolatedCount(accentResult), colorsUsed: accentResult.colorsUsed };

const empty = image(24, 24, () => [0, 0, 0, 0]);
const emptyResult = convert(empty, 24, 24, { width: 8 });
check('全空图片', emptyResult.cells.every((id) => id === null));

const background = image(40, 40, (x, y) => x >= 15 && x < 25 && y >= 15 && y < 25 ? [231, 0, 47] : [255, 255, 255]);
const backgroundResult = convert(background, 40, 40, { width: 12, maxColors: 4, backgroundMode: 'remove-white', tolerance: 20 });
check('背景角落移除', backgroundResult.cells[0] === null);
check('背景主体保留', backgroundResult.cells.some((id) => id === 'red'));
metrics('background', background, 40, 40, backgroundResult);

// 25% 前景恰好落在 7x7 分层点的 16 个位置上：旧抽样会误判为保留，全区域统计应正确移除。
const backgroundBoundary = image(10, 10, (x, y) => x >= 2 && x <= 6 && y >= 2 && y <= 6 ? [231, 0, 47] : [255, 255, 255]);
const boundaryResult = convert(backgroundBoundary, 10, 10, { width: 1, maxColors: 2, backgroundMode: 'remove-white', tolerance: 20 });
check('全区域背景占比', boundaryResult.cells[0] === null);
report.cases['background-boundary'] = { empty: boundaryResult.cells[0] === null };

function bruteNearest(target, candidates) {
  return candidates.reduce((best, color) => colorDistanceLab(target, color.rgb) < colorDistanceLab(target, best.rgb) ? color : best, candidates[0]);
}

const cacheTargets = [];
for (const color of palette.slice(0, 120)) {
  for (const offset of [-7, -3, -1, 0, 1, 3, 7]) {
    cacheTargets.push(color.rgb.map((channel, index) => Math.max(0, Math.min(255, channel + (index === 1 ? -offset : offset)))));
  }
}
const cacheGroups = new Map();
for (const target of cacheTargets) {
  const key = ((target[0] >> 3) << 10) | ((target[1] >> 3) << 5) | (target[2] >> 3);
  const group = cacheGroups.get(key) ?? [];
  group.push(target); cacheGroups.set(key, group);
}
let cachePair;
for (const group of cacheGroups.values()) {
  for (let i = 0; i < group.length && !cachePair; i += 1) {
    for (let j = i + 1; j < group.length; j += 1) {
      if (bruteNearest(group[i], palette).id !== bruteNearest(group[j], palette).id) {
        cachePair = [group[i], group[j]]; break;
      }
    }
  }
}
check('找到缓存边界样例', Boolean(cachePair));
if (cachePair) {
  const expected = cachePair.map((target) => bruteNearest(target, palette).id);
  const actual = cachePair.map((target) => nearestPaletteColor(target, palette).id);
  report.cache = { targets: cachePair, expected, actual };
  check('最近色精确缓存', expected[0] === actual[0] && expected[1] === actual[1], JSON.stringify(report.cache));
}

convert(gradient, 160, 120, { width: 40, generationStyle: 'realistic' });
const durations = [];
let performanceResult;
for (let i = 0; i < 3; i += 1) {
  const start = performance.now();
  performanceResult = convert(gradient, 160, 120, { width: 40, generationStyle: 'realistic' });
  durations.push(performance.now() - start);
}
durations.sort((a, b) => a - b);
report.performance = { medianMs: Number(durations[1].toFixed(2)), samplesMs: durations.map((value) => Number(value.toFixed(2))) };
metrics('performance-realistic', gradient, 160, 120, performanceResult);

const largeGradient = image(640, 480, (x, y) => [
  Math.round((x / 639) * 255), Math.round((y / 479) * 180 + 35), Math.round(220 - (x / 639) * 150),
]);
convert(largeGradient, 640, 480, { width: 52, generationStyle: 'realistic' });
const largeDurations = [];
let largeResult;
for (let i = 0; i < 3; i += 1) {
  const start = performance.now();
  largeResult = convert(largeGradient, 640, 480, { width: 52, generationStyle: 'realistic' });
  largeDurations.push(performance.now() - start);
}
largeDurations.sort((a, b) => a - b);
report.performanceLarge = { medianMs: Number(largeDurations[1].toFixed(2)), samplesMs: largeDurations.map((value) => Number(value.toFixed(2))) };
metrics('performance-large-realistic', largeGradient, 640, 480, largeResult);

console.log(JSON.stringify(report, null, 2));
if (!reportOnly && failures.length) assert.fail(`回归失败：\n${failures.join('\n')}`);
