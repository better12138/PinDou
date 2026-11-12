// 新老算法对比回归：node --expose-gc scripts/regression/algorithm-comparison.mjs
// 样例覆盖低饱和、高饱和、暗部渐变、肤色、卡通线稿、人像、宠物、风景。
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng } from './lib/png.mjs';
import { baselineRevision, loadNewImpl, loadOldImpl, prepareBaseline } from './lib/impls.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7);

function image(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a = 255] = pixel(x, y);
      const index = (y * width + x) * 4;
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = a;
    }
  }
  return data;
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function inEllipse(x, y, cx, cy, rx, ry) {
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
}

// —— 合成样例：每组只突出一种色彩特征，便于解释指标变化 ——
const lowSaturation = image(240, 180, (x, y) => {
  const shade = (x / 239) * 26 + (y / 179) * 18;
  if (inEllipse(x, y, 168, 62, 36, 36)) return [clamp(150 + shade), clamp(136 + shade), clamp(130 + shade)];
  return [clamp(138 + shade), clamp(146 + shade), clamp(134 + shade)];
});

const highSaturation = image(240, 180, (x, y) => {
  if (inEllipse(x, y, 72, 118, 40, 40)) return [231, 0, 47];
  if (inEllipse(x, y, 168, 54, 30, 30)) return [255, 214, 0];
  if (x < 120) return [clamp(90 + x), 20, clamp(220 - y)];
  return [clamp(40 + y / 3), clamp(90 + x / 2), clamp(200 - x / 2)];
});

const darkGradient = image(240, 180, (x, y) => {
  const base = 14 + (x / 239) * 46 + (y / 179) * 16;
  if (inEllipse(x, y, 190, 40, 16, 16)) return [clamp(196 + (x / 239) * 40), clamp(198 + (y / 179) * 40), 206];
  return [clamp(base * 0.72), clamp(base * 0.85), clamp(base * 1.18)];
});

const skinTone = image(240, 180, (x, y) => {
  const face = inEllipse(x, y, 120, 96, 62, 76);
  if (face) {
    const light = 1 - Math.hypot(x - 104, y - 74) / 118;
    const t = Math.max(0, Math.min(1, light));
    return [clamp(198 + 52 * t), clamp(142 + 54 * t), clamp(112 + 50 * t)];
  }
  if (y < 58 || Math.hypot(x - 120, y - 60) < 66 && y < 74) return [46, 32, 28];
  if (inEllipse(x, y, 120, 140, 26, 10)) return [188, 84, 92];
  return [244, 241, 236];
});

const lineArt = readPng(path.join(here, 'fixtures', 'cartoon-line.png'));
const portrait = readPng(path.join(here, 'fixtures', 'portrait.png'));
const pet = readPng(path.join(here, 'fixtures', 'pet.png'));
const landscape = readPng(path.join(here, 'fixtures', 'landscape.png'));

const cases = [
  { name: 'low-saturation', data: lowSaturation, width: 240, height: 180, options: { width: 48, maxColors: 16 } },
  { name: 'high-saturation', data: highSaturation, width: 240, height: 180, options: { width: 48, maxColors: 16 } },
  { name: 'dark-gradient', data: darkGradient, width: 240, height: 180, options: { width: 48, maxColors: 16 } },
  { name: 'skin-tone', data: skinTone, width: 240, height: 180, options: { width: 48, maxColors: 16 } },
  { name: 'cartoon-line', data: lineArt.data, width: lineArt.width, height: lineArt.height, options: { width: 52, maxColors: 20 } },
  { name: 'photo-portrait', data: portrait.data, width: portrait.width, height: portrait.height, options: { width: 52, maxColors: 24 } },
  { name: 'photo-pet', data: pet.data, width: pet.width, height: pet.height, options: { width: 52, maxColors: 24 } },
  { name: 'photo-landscape', data: landscape.data, width: landscape.width, height: landscape.height, options: { width: 52, maxColors: 24 } },
].filter((item) => !only || item.name === only);

function cellAverages(data, sourceWidth, sourceHeight, result) {
  const averages = new Array(result.width * result.height).fill(null);
  for (let y = 0; y < result.height; y += 1) {
    const startY = Math.floor((y * sourceHeight) / result.height);
    const endY = Math.max(startY + 1, Math.ceil(((y + 1) * sourceHeight) / result.height));
    for (let x = 0; x < result.width; x += 1) {
      const startX = Math.floor((x * sourceWidth) / result.width);
      const endX = Math.max(startX + 1, Math.ceil(((x + 1) * sourceWidth) / result.width));
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let sy = startY; sy < Math.min(endY, sourceHeight); sy += 1) {
        for (let sx = startX; sx < Math.min(endX, sourceWidth); sx += 1) {
          const index = (sy * sourceWidth + sx) * 4;
          if (data[index + 3] < 24) continue;
          r += data[index];
          g += data[index + 1];
          b += data[index + 2];
          count += 1;
        }
      }
      if (count) averages[y * result.width + x] = [r / count, g / count, b / count];
    }
  }
  return averages;
}

function isolatedCount(result) {
  let count = 0;
  for (let y = 0; y < result.height; y += 1) {
    for (let x = 0; x < result.width; x += 1) {
      const id = result.cells[y * result.width + x];
      if (!id) continue;
      let same = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < result.width && ny < result.height && result.cells[ny * result.width + nx] === id) same += 1;
      }
      if (same === 0) count += 1;
    }
  }
  return count;
}

/** 暗色源格是否落到深色豆上：线稿/暗部保护的关键指标。 */
function darkEdgeHitRatio(data, sourceWidth, sourceHeight, result, byId) {
  const averages = cellAverages(data, sourceWidth, sourceHeight, result);
  let total = 0;
  let hit = 0;
  averages.forEach((average, index) => {
    if (!average) return;
    const luminance = 0.299 * average[0] + 0.587 * average[1] + 0.114 * average[2];
    if (luminance >= 70) return;
    total += 1;
    const color = byId.get(result.cells[index]);
    if (color && 0.299 * color.rgb[0] + 0.587 * color.rgb[1] + 0.114 * color.rgb[2] < 100) hit += 1;
  });
  return total ? hit / total : null;
}

function measure(impl, testCase, style, tag) {
  const options = {
    generationStyle: style,
    palette: impl.palette,
    backgroundMode: 'keep',
    backgroundColor: [255, 255, 255],
    tolerance: 32,
    speckleReduction: 0,
    ...testCase.options,
  };
  const byId = new Map(impl.palette.map((color) => [color.id, color]));
  const durations = [];
  const before = process.memoryUsage();
  let peakHeap = before.heapUsed;
  let peakRss = before.rss;
  let result;
  for (let run = 0; run < 4; run += 1) {
    const start = performance.now();
    const next = impl.convertImageData(testCase.data, testCase.width, testCase.height, options);
    durations.push(performance.now() - start);
    const usage = process.memoryUsage();
    peakHeap = Math.max(peakHeap, usage.heapUsed);
    peakRss = Math.max(peakRss, usage.rss);
    if (run > 0) {
      const same = JSON.stringify(next.cells) === JSON.stringify(result.cells);
      if (!same) throw new Error(`${tag} 第 ${run} 次生成结果不一致`);
    }
    result = next;
  }
  const after = process.memoryUsage();
  durations.shift();
  durations.sort((a, b) => a - b);

  const averages = cellAverages(testCase.data, testCase.width, testCase.height, result);
  const errors = [];
  averages.forEach((average, index) => {
    if (!average) return;
    const color = byId.get(result.cells[index]);
    if (color) errors.push(impl.colorDistanceLab(average, color.rgb));
  });
  errors.sort((a, b) => a - b);

  return {
    colorsUsed: result.colorsUsed,
    totalBeads: result.totalBeads,
    meanDeltaE00: errors.length ? Number((errors.reduce((sum, value) => sum + value, 0) / errors.length).toFixed(3)) : 0,
    p95DeltaE00: errors.length ? Number(errors[Math.min(errors.length - 1, Math.floor(errors.length * 0.95))].toFixed(3)) : 0,
    isolated: isolatedCount(result),
    darkEdgeHit: darkEdgeHitRatio(testCase.data, testCase.width, testCase.height, result, byId),
    medianMs: Number(durations[1].toFixed(1)),
    peakHeapMb: Number(((peakHeap - before.heapUsed) / 1048576).toFixed(1)),
    peakRssMb: Number(((peakRss - before.rss) / 1048576).toFixed(1)),
    heapDeltaMb: Number(((after.heapUsed - before.heapUsed) / 1048576).toFixed(1)),
    rssDeltaMb: Number(((after.rss - before.rss) / 1048576).toFixed(1)),
  };
}

function pct(before, after) {
  if (!before) return '—';
  return `${(((after - before) / before) * 100).toFixed(1)}%`;
}

const outDir = prepareBaseline();
const revision = baselineRevision();
const rows = [];
const failures = [];

for (let index = 0; index < cases.length; index += 1) {
  const testCase = cases[index];
  for (const style of ['cartoon', 'realistic']) {
    if (global.gc) global.gc();
    const oldImpl = loadOldImpl(outDir, `${testCase.name}-${style}-old-${index}`);
    const oldMetrics = measure(oldImpl, testCase, style, `old/${testCase.name}/${style}`);
    if (global.gc) global.gc();
    const newImpl = await loadNewImpl(`${testCase.name}-${style}-new-${index}`);
    const newMetrics = measure(newImpl, testCase, style, `new/${testCase.name}/${style}`);

    const row = { case: testCase.name, style, old: oldMetrics, new: newMetrics };
    rows.push(row);

    if (newMetrics.colorsUsed > testCase.options.maxColors) {
      failures.push(`${testCase.name}/${style} 色数超上限：${newMetrics.colorsUsed} > ${testCase.options.maxColors}`);
    }
    const deltaMean = newMetrics.meanDeltaE00 - oldMetrics.meanDeltaE00;
    const deltaP95 = newMetrics.p95DeltaE00 - oldMetrics.p95DeltaE00;
    if (deltaMean > 0.6) failures.push(`${testCase.name}/${style} 平均 ΔE00 退化 ${deltaMean.toFixed(3)}`);
    if (deltaP95 > 1.5) failures.push(`${testCase.name}/${style} p95 ΔE00 退化 ${deltaP95.toFixed(3)}`);
    if (oldMetrics.darkEdgeHit !== null && newMetrics.darkEdgeHit !== null && newMetrics.darkEdgeHit + 0.02 < oldMetrics.darkEdgeHit) {
      failures.push(`${testCase.name}/${style} 暗部命中率下降 ${pct(oldMetrics.darkEdgeHit, newMetrics.darkEdgeHit)}`);
    }
  }
}

const header = ['样例', '风格', '色数(旧→新)', '豆数(旧→新)', '平均ΔE00(旧→新)', 'p95ΔE00(旧→新)', '孤豆(旧→新)', '耗时ms(旧→新)', '峰值堆MB(旧→新)', 'RSS增量MB(旧→新)'];
const lines = [header.join(' | '), header.map(() => '---').join(' | ')];
for (const row of rows) {
  lines.push(
    [
      row.case,
      row.style,
      `${row.old.colorsUsed}→${row.new.colorsUsed}`,
      `${row.old.totalBeads}→${row.new.totalBeads}`,
      `${row.old.meanDeltaE00}→${row.new.meanDeltaE00} (${pct(row.old.meanDeltaE00, row.new.meanDeltaE00)})`,
      `${row.old.p95DeltaE00}→${row.new.p95DeltaE00}`,
      `${row.old.isolated}→${row.new.isolated}`,
      `${row.old.medianMs}→${row.new.medianMs} (${pct(row.old.medianMs, row.new.medianMs)})`,
      `${row.old.peakHeapMb}→${row.new.peakHeapMb}`,
      `${row.old.rssDeltaMb}→${row.new.rssDeltaMb}`,
    ].join(' | '),
  );
}
console.log(`\n基线版本：${revision}\n`);
console.log(lines.join('\n'));
const darkRows = rows.filter((row) => row.old.darkEdgeHit !== null);
if (darkRows.length) {
  console.log('\n暗部命中率：' + darkRows.map((row) => `${row.case}/${row.style} ${(row.old.darkEdgeHit * 100).toFixed(1)}%→${(row.new.darkEdgeHit * 100).toFixed(1)}%`).join('；'));
}
console.log(`\n断言失败：${failures.length ? '\n' + failures.join('\n') : '无'}`);
if (failures.length) assert.fail('对比回归失败');
