// 算法之外的薄弱环节回归：大图、极端参数、边界输入、重复生成、导出数据。
// 运行：node --expose-gc scripts/regression/robustness.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng } from './lib/png.mjs';
import { loadNewImpl } from './lib/impls.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { convertImageData, palette } = await loadNewImpl('robustness');
const { createProject, withCells, normalizeProject } = await import(
  new URL('../../generated/dist/src/project.js', import.meta.url).href
);
const { summarizeUsage, findIsolatedBeads, suggestStock } = await import(
  new URL('../../generated/dist/src/usage.js', import.meta.url).href
);

const reports = [];
const failures = [];
function check(name, condition, detail) {
  if (condition) reports.push(`PASS ${name}${detail ? `：${detail}` : ''}`);
  else failures.push(`FAIL ${name}${detail ? `：${detail}` : ''}`);
}

function baseOptions(overrides = {}) {
  return {
    generationStyle: 'cartoon',
    palette,
    backgroundMode: 'keep',
    backgroundColor: [255, 255, 255],
    tolerance: 32,
    speckleReduction: 0,
    width: 52,
    maxColors: 24,
    ...overrides,
  };
}

function assertResultShape(name, result, options) {
  check(`${name} 输出尺寸`, result.cells.length === result.width * result.height, `${result.width}x${result.height}`);
  check(`${name} 豆数一致`, result.totalBeads === result.cells.filter(Boolean).length, `${result.totalBeads}`);
  check(`${name} 色数不超上限`, result.colorsUsed <= Math.max(2, options.maxColors), `${result.colorsUsed}/${options.maxColors}`);
  check(`${name} 色数统计一致`, result.colorsUsed === new Set(result.cells.filter(Boolean)).size, `${result.colorsUsed}`);
}

function run(name, data, width, height, overrides) {
  const options = baseOptions(overrides);
  const start = performance.now();
  const result = convertImageData(data, width, height, options);
  const elapsed = performance.now() - start;
  assertResultShape(name, result, options);
  const repeat = convertImageData(data, width, height, options);
  check(`${name} 重复生成一致`, JSON.stringify(repeat.cells) === JSON.stringify(result.cells));
  return { result, elapsed };
}

function photoLike(width, height, seed = 7) {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const noise = (random() - 0.5) * 18;
      const sky = y < height * 0.45;
      const r = sky ? 120 + (x / width) * 120 + noise : 60 + (y / height) * 90 + noise;
      const g = sky ? 110 + (x / width) * 80 + noise : 90 + (x / width) * 70 + noise;
      const b = sky ? 160 + (x / width) * 70 + noise : 50 + (y / height) * 60 + noise;
      const index = (y * width + x) * 4;
      data[index] = Math.max(0, Math.min(255, Math.round(r)));
      data[index + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[index + 2] = Math.max(0, Math.min(255, Math.round(b)));
      data[index + 3] = 255;
    }
  }
  return data;
}

function solid(width, height, rgb, alpha = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = alpha;
  }
  return data;
}

// —— 1. 大图导入：1200 万像素手机照片级别 ——
for (const style of ['cartoon', 'realistic']) {
  const bigWidth = 4032;
  const bigHeight = 3024;
  const data = photoLike(bigWidth, bigHeight, style === 'cartoon' ? 11 : 13);
  if (global.gc) global.gc();
  const before = process.memoryUsage();
  let peak = before.heapUsed;
  const start = performance.now();
  const result = convertImageData(data, bigWidth, bigHeight, baseOptions({ width: 104, maxColors: 24, generationStyle: style }));
  const elapsed = performance.now() - start;
  const usage = process.memoryUsage();
  peak = Math.max(peak, usage.heapUsed);
  check(`大图 ${style} 完成`, result.cells.length === result.width * result.height, `${result.width}x${result.height}`);
  check(`大图 ${style} 耗时可控`, elapsed < 15000, `${elapsed.toFixed(0)}ms`);
  reports.push(`INFO 大图 ${style}：${result.width}x${result.height}，${result.totalBeads} 颗，${result.colorsUsed} 色，耗时 ${elapsed.toFixed(0)}ms，峰值堆增量 ${((peak - before.heapUsed) / 1048576).toFixed(1)}MB`);
}

// —— 2. 极端参数 ——
const pet = readPng(path.join(here, 'fixtures', 'pet.png'));
const extreme = [
  { width: 1, maxColors: 2 },
  { width: 2, maxColors: 2, generationStyle: 'realistic' },
  { width: 300, maxColors: 291 },
  { width: 52, maxColors: 1 },
  { width: 52, maxColors: 999 },
  { width: 52, maxColors: 24, tolerance: 0, backgroundMode: 'remove-white' },
  { width: 52, maxColors: 24, tolerance: 255, backgroundMode: 'remove-white' },
  { width: 52, maxColors: 24, speckleReduction: 4 },
  { width: 52, maxColors: 24, speckleReduction: 4, generationStyle: 'realistic' },
  { width: 0, maxColors: 24 },
  { width: -8, maxColors: 24 },
];
extreme.forEach((overrides, index) => {
  try {
    run(`极端参数#${index}(${JSON.stringify(overrides)})`, pet.data, pet.width, pet.height, overrides);
  } catch (error) {
    failures.push(`FAIL 极端参数#${index} 抛错：${error.message}`);
  }
});

// —— 3. 边界输入 ——
const boundaries = [
  ['1x1 不透明', solid(1, 1, [200, 60, 60]), 1, 1, {}],
  ['1x1 透明', solid(1, 1, [0, 0, 0], 0), 1, 1, {}],
  ['全透明 64x64', solid(64, 64, [0, 0, 0], 0), 64, 64, {}],
  ['纯白去背景', solid(64, 64, [255, 255, 255]), 64, 64, { backgroundMode: 'remove-white' }],
  ['1x4000 细长条', photoLike(1, 4000, 3), 1, 4000, { width: 8 }],
  ['4000x1 细长条', photoLike(4000, 1, 5), 4000, 1, { width: 40 }],
  ['源图 1x1 放大到 52', solid(1, 1, [30, 120, 200]), 1, 1, { width: 52, maxColors: 6 }],
];
boundaries.forEach(([name, data, width, height, overrides]) => {
  try {
    const { result } = run(name, data, width, height, overrides);
    if (name === '全透明 64x64' || name === '1x1 透明' || name === '纯白去背景') {
      check(`${name} 无豆`, result.totalBeads === 0, `${result.totalBeads}`);
    }
    if (name.includes('放大')) {
      check(`${name} 平涂一致`, new Set(result.cells.filter(Boolean)).size === 1, `${result.colorsUsed} 色`);
    }
  } catch (error) {
    failures.push(`FAIL ${name} 抛错：${error.message}`);
  }
});

// —— 4. 重复生成一致性：A → B → A ——
const petCartoon = () => convertImageData(pet.data, pet.width, pet.height, baseOptions({ generationStyle: 'cartoon' }));
const petRealistic = () => convertImageData(pet.data, pet.width, pet.height, baseOptions({ generationStyle: 'realistic' }));
const line = readPng(path.join(here, 'fixtures', 'cartoon-line.png'));
const firstCartoon = petCartoon();
const firstRealistic = petRealistic();
convertImageData(line.data, line.width, line.height, baseOptions({ generationStyle: 'realistic', width: 40 }));
const secondCartoon = petCartoon();
const secondRealistic = petRealistic();
check('交叉生成后卡通结果一致', JSON.stringify(firstCartoon.cells) === JSON.stringify(secondCartoon.cells));
check('交叉生成后写实结果一致', JSON.stringify(firstRealistic.cells) === JSON.stringify(secondRealistic.cells));

// —— 5. 导出数据：用量、孤立豆、项目序列化 ——
const project = withCells(createProject(firstCartoon.width, firstCartoon.height), firstCartoon.cells);
const usage = summarizeUsage(project);
const usageTotal = usage.reduce((sum, row) => sum + row.count, 0);
check('用量总数等于豆数', usageTotal === firstCartoon.totalBeads, `${usageTotal}/${firstCartoon.totalBeads}`);
check('用量行数与色数一致', usage.length === firstCartoon.colorsUsed, `${usage.length}/${firstCartoon.colorsUsed}`);
const perColorOk = usage.every((row) => row.count === firstCartoon.cells.filter((id) => id === row.color.id).length);
check('逐色用量正确', perColorOk);
check('备货数量公式', usage.every((row) => row.packs === Math.ceil(row.count / project.settings.beadsPerPack)));
check('建议备货 +10%', usage.every((row) => suggestStock(row.count) === Math.ceil(row.count * 1.1)));

const isolated = findIsolatedBeads(project);
const manualIsolated = firstCartoon.cells.filter((id, index) => {
  if (!id) return false;
  const x = index % firstCartoon.width;
  const y = Math.floor(index / firstCartoon.width);
  const neighbors = [
    x > 0 ? firstCartoon.cells[index - 1] : null,
    x < firstCartoon.width - 1 ? firstCartoon.cells[index + 1] : null,
    y > 0 ? firstCartoon.cells[index - firstCartoon.width] : null,
    y < firstCartoon.height - 1 ? firstCartoon.cells[index + firstCartoon.width] : null,
  ];
  return !neighbors.some(Boolean);
}).length;
check('孤立豆统计正确', isolated.length === manualIsolated, `${isolated.length}/${manualIsolated}`);

const dotProject = withCells(createProject(5, 5), [null, null, null, null, null, null, null, null, null, null, null, null, palette[0].id, null, null, null, null, null, null, null, null, null, null, null, null]);
check('孤立豆示例可检出', findIsolatedBeads(dotProject).length === 1, `${findIsolatedBeads(dotProject).length}`);

const roundTrip = normalizeProject(JSON.parse(JSON.stringify(project)));
check('项目 JSON 往返稳定', JSON.stringify(roundTrip.cells) === JSON.stringify(project.cells));

console.log(reports.join('\n'));
console.log(`\n失败：${failures.length ? '\n' + failures.join('\n') : '无'}`);
if (failures.length) assert.fail('健壮性回归失败');
