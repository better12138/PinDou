import { colorDistanceLab, mergeThresholdByLevel, nearestPaletteColor, palette, rgbThresholdToDeltaE, rgbToLab, type Lab } from './palette';
import type { ColorSubstitution, ConvertOptions, ConvertResult, GenerationStyle, PaletteColor } from './types';

type StyleProfile = {
  sampleSide: number;
  backgroundThreshold: number;
  dominanceThreshold: number;
  candidateTargetRatio: number;
  candidateDistanceFactor: number;
  postStrengthBias: number;
  useAverageFallback: boolean;
  /** 写实风格用误差扩散抖动还原渐变，卡通风格保持平涂。 */
  useErrorDiffusion: boolean;
};

type SampledCell = {
  samples: Array<[number, number, number]>;
  average: [number, number, number] | null;
  backgroundShare: number;
};

const styleProfiles: Record<GenerationStyle, StyleProfile> = {
  cartoon: {
    sampleSide: 7,
    backgroundThreshold: 0.72,
    dominanceThreshold: 0.34,
    candidateTargetRatio: 0.58,
    candidateDistanceFactor: 1.35,
    postStrengthBias: 1,
    useAverageFallback: false,
    useErrorDiffusion: false,
  },
  realistic: {
    sampleSide: 5,
    backgroundThreshold: 0.58,
    dominanceThreshold: 0.26,
    candidateTargetRatio: 0.95,
    candidateDistanceFactor: 0.65,
    postStrengthBias: -1,
    useAverageFallback: true,
    useErrorDiffusion: true,
  },
};

// ΔE00 比 RGB 距离贵得多，而合并/去噪会对同一批色号反复比较：按色号对缓存感知距离。
const colorPairDistanceCache = new Map<string, number>();

function paletteColorDistance(a: PaletteColor, b: PaletteColor): number {
  if (a.id === b.id) return 0;
  const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
  const cached = colorPairDistanceCache.get(key);
  if (cached !== undefined) return cached;
  const distance = colorDistanceLab(a.rgb, b.rgb);
  colorPairDistanceCache.set(key, distance);
  return distance;
}

// 误差扩散/双色聚类会在相邻格之间反复比较同一批整数 RGB 对：再缓存一层 ΔE00 结果。
const rgbPairDeltaECache = new Map<number, number>();

function perceptualDistance(a: [number, number, number], b: [number, number, number]): number {
  const keyA = (a[0] << 16) | (a[1] << 8) | a[2];
  const keyB = (b[0] << 16) | (b[1] << 8) | b[2];
  if (keyA === keyB) return 0;
  const key = keyA < keyB ? keyA * 16777216 + keyB : keyB * 16777216 + keyA;
  const cached = rgbPairDeltaECache.get(key);
  if (cached !== undefined) return cached;
  const distance = colorDistanceLab(a, b);
  if (rgbPairDeltaECache.size >= 400000) rgbPairDeltaECache.clear();
  rgbPairDeltaECache.set(key, distance);
  return distance;
}

/**
 * 选色时“算不算同一个色族”的阈值（CIEDE2000，下标 = 0~4 档强度）。
 * 由旧版 RGB 阈值（高彩度/暗色 18+3*档、其它 34+7*档）按实测映射换算而来，
 * 换算系数见 palette.ts 的 `rgbThresholdToDeltaE`：中间色区 ΔE00 ≈ RGB × 0.19~0.20。
 */
const distinctVividThreshold: readonly number[] = [3.8, 4.4, 4.9, 5.4, 6.0];
const distinctThreshold: readonly number[] = [6.7, 7.8, 9.0, 10.2, 11.5];

// 误差扩散里的“边缘 / 跨色块”判定，由旧 RGB 40 / 72 换算（ΔE00 ≈ 7.6 / 13.4）。
const ditherEdgeThreshold = rgbThresholdToDeltaE(40);
const ditherSpreadThreshold = rgbThresholdToDeltaE(72);
// 小面积深色特征与主色的最小差异（旧 RGB 70 → ΔE00 ≈ 12.9）。
const darkFeatureContrastThreshold = rgbThresholdToDeltaE(70);
// 双色聚类的分离度下限（旧 RGB 60 → ΔE00 ≈ 10.9）。
const clusterSeparationThreshold = rgbThresholdToDeltaE(60);

export async function imageFileToBeads(file: File, options: ConvertOptions): Promise<ConvertResult> {
  const image = await loadImage(file);
  const sourceWidth = Math.max(1, image.naturalWidth);
  const sourceHeight = Math.max(1, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is not available.');
  context.imageSmoothingEnabled = true;
  context.drawImage(image, 0, 0, sourceWidth, sourceHeight);
  const data = context.getImageData(0, 0, sourceWidth, sourceHeight).data;
  return convertImageData(data, sourceWidth, sourceHeight, options);
}

/**
 * 纯像素入口：不依赖 DOM，便于回归脚本直接喂样例图数据。
 * `imageFileToBeads` 只负责解码图片，算法全部在这里。
 */
export function convertImageData(
  data: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  options: ConvertOptions,
): ConvertResult {
  const { width, height } = resolveGridSize(sourceWidth, sourceHeight, options);
  const activePalette = options.palette ?? palette;
  const profile = styleProfiles[options.generationStyle ?? 'cartoon'];
  const requestedSpeckleStrength = options.speckleReduction ?? 0;
  const speckleStrength = requestedSpeckleStrength > 0 ? clampStrength(requestedSpeckleStrength + profile.postStrengthBias) : 0;
  const backgroundColor = estimateBackgroundColor(data, sourceWidth, sourceHeight);
  const sampledCells = sampleGridCells(data, sourceWidth, sourceHeight, width, height, options, backgroundColor, profile, speckleStrength);
  const ranked = rankPaletteColors(sampledCells, options, activePalette, profile);
  const clustered = clusterPaletteCandidates(sampledCells, Math.max(2, options.maxColors), activePalette, profile);
  const candidates = selectCandidateColors(ranked, Math.max(2, options.maxColors), activePalette, speckleStrength, profile, clustered);
  const cells = profile.useErrorDiffusion
    ? ditherCellColors(sampledCells, width, height, candidates, profile)
    : sampledCells.map((cell) => chooseCellColor(cell, candidates, profile));

  const mergedCells = mergeSimilarColors(cells, speckleStrength, candidates);
  const compactCells = reduceTinyRegions(mergedCells, width, height, speckleStrength, candidates);
  const reducedCells = reduceSpeckles(compactCells, width, height, speckleStrength, candidates);
  const colorsUsed = new Set(reducedCells.filter(Boolean)).size;
  const totalBeads = reducedCells.filter(Boolean).length;
  const substitutions = options.idealPalette
    ? summarizeSubstitutions(reducedCells, sampledCells, activePalette, options.idealPalette)
    : [];
  return { width, height, cells: reducedCells, colorsUsed, totalBeads, substitutions };
}

/**
 * 库存缺色替代统计：对照色卡全量，看每个实际用到的色号“本来最该用哪颗豆”。
 * 只有理想色不在库存里、且两颗豆肉眼可辨（ΔE00 > 2）时才算替代，避免把重复色号报成缺色。
 */
function summarizeSubstitutions(
  cells: Array<string | null>,
  sampledCells: SampledCell[],
  activePalette: PaletteColor[],
  idealPalette: PaletteColor[],
): ColorSubstitution[] {
  const usedById = new Map(activePalette.map((color) => [color.id, color]));
  const cellCounts = new Map<string, number>();
  // 同一个库存色可能覆盖多种原图颜色，按格数投票决定它"本来最该代表"哪个理想色。
  const idealVotes = new Map<string, Map<string, number>>();
  cells.forEach((id, index) => {
    if (!id) return;
    cellCounts.set(id, (cellCounts.get(id) ?? 0) + 1);
    const average = sampledCells[index]?.average;
    if (!average) return;
    const idealId = nearestPaletteColor(average, idealPalette).id;
    const votes = idealVotes.get(id) ?? new Map<string, number>();
    votes.set(idealId, (votes.get(idealId) ?? 0) + 1);
    idealVotes.set(id, votes);
  });
  const rows: ColorSubstitution[] = [];
  cellCounts.forEach((count, id) => {
    const used = usedById.get(id);
    const votes = idealVotes.get(id);
    if (!used || !votes) return;
    let idealId = '';
    let best = 0;
    votes.forEach((vote, candidate) => {
      if (vote > best) {
        best = vote;
        idealId = candidate;
      }
    });
    if (!idealId || idealId === id) return;
    const ideal = idealPalette.find((color) => color.id === idealId);
    if (!ideal) return;
    const deltaE = colorDistanceLab(used.rgb, ideal.rgb);
    if (deltaE <= 2) return;
    rows.push({ colorId: id, idealId, deltaE, cells: count });
  });
  return rows.sort((a, b) => b.deltaE - a.deltaE || b.cells - a.cells);
}

/**
 * 采样网格尺寸。宽度由用户给定，高度按原图比例；如果结果超出了画板边界
 * （例如竖构图照片按画板宽度生成会高出画板），就按比例整体缩小到刚好放得下。
 * 直接在缩小的目标尺寸上采样，比先生成大图再缩放清晰得多。
 */
function resolveGridSize(
  naturalWidth: number,
  naturalHeight: number,
  options: ConvertOptions,
): { width: number; height: number } {
  const sourceWidth = Math.max(1, naturalWidth);
  const sourceHeight = Math.max(1, naturalHeight);
  let width = Math.max(1, Math.round(options.width));
  let height = Math.max(1, Math.round((sourceHeight / sourceWidth) * width));
  const bounds = options.bounds;
  if (bounds) {
    const fitScale = Math.min(1, Math.max(1, bounds.width) / width, Math.max(1, bounds.height) / height);
    if (fitScale < 1) {
      width = Math.max(1, Math.floor(width * fitScale));
      height = Math.max(1, Math.floor(height * fitScale));
    }
  }
  return { width, height };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load this image.'));
    };
    image.src = url;
  });
}

function sampleGridCells(
  data: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  options: ConvertOptions,
  detectedBackgroundColor: [number, number, number],
  profile: StyleProfile,
  speckleStrength: number,
): SampledCell[] {
  const strengthLevel = clampStrength(speckleStrength);
  const channelStep = [1, 5, 9, 14, 20][strengthLevel];
  const neutralThreshold = [0, 8, 14, 20, 28][strengthLevel];
  const toleranceSquared = options.tolerance * options.tolerance;
  const cells: SampledCell[] = [];
  for (let y = 0; y < height; y += 1) {
    const startY = Math.floor((y * sourceHeight) / height);
    const endY = Math.min(sourceHeight, Math.max(startY + 1, Math.ceil(((y + 1) * sourceHeight) / height)));
    for (let x = 0; x < width; x += 1) {
      const startX = Math.floor((x * sourceWidth) / width);
      const endX = Math.min(sourceWidth, Math.max(startX + 1, Math.ceil(((x + 1) * sourceWidth) / width)));
      const samples: Array<[number, number, number]> = [];
      const cellWidth = endX - startX;
      const cellHeight = endY - startY;
      const sampleRepeats = new Uint8Array(cellWidth * cellHeight);
      // 主色/暗线仍使用固定数量的分层样本；平均色与背景占比则统计格内全部像素。
      for (let sy = 0; sy < profile.sampleSide; sy += 1) {
        const localY = Math.floor(((sy + 0.5) / profile.sampleSide) * cellHeight);
        for (let sx = 0; sx < profile.sampleSide; sx += 1) {
          const localX = Math.floor(((sx + 0.5) / profile.sampleSide) * cellWidth);
          sampleRepeats[localY * cellWidth + localX] += 1;
        }
      }

      let backgroundCount = 0;
      let foregroundCount = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sourceY = startY; sourceY < endY; sourceY += 1) {
        for (let sourceX = startX; sourceX < endX; sourceX += 1) {
          const pixelIndex = sourceY * sourceWidth + sourceX;
          const index = pixelIndex * 4;
          if (data[index + 3] < 24) {
            backgroundCount += 1;
            continue;
          }
          if (options.backgroundMode !== 'keep') {
            const dr = data[index] - detectedBackgroundColor[0];
            const dg = data[index + 1] - detectedBackgroundColor[1];
            const db = data[index + 2] - detectedBackgroundColor[2];
            if (dr * dr + dg * dg + db * db <= toleranceSquared) {
              backgroundCount += 1;
              continue;
            }
          }
          let rr = data[index];
          let gg = data[index + 1];
          let bb = data[index + 2];
          if (strengthLevel > 0) {
            // 与 simplifySourceRgb 等价，但按标量计算，避免为格内每个像素分配数组。
            const chroma = Math.max(rr, gg, bb) - Math.min(rr, gg, bb);
            if (chroma <= neutralThreshold) {
              const value = quantizeChannel(0.299 * rr + 0.587 * gg + 0.114 * bb, channelStep);
              rr = value;
              gg = value;
              bb = value;
            } else {
              rr = quantizeChannel(rr, channelStep);
              gg = quantizeChannel(gg, channelStep);
              bb = quantizeChannel(bb, channelStep);
            }
          }
          foregroundCount += 1;
          r += rr;
          g += gg;
          b += bb;
          const repeat = sampleRepeats[(sourceY - startY) * cellWidth + (sourceX - startX)];
          if (repeat > 0) {
            const sample: [number, number, number] = [rr, gg, bb];
            for (let count = 0; count < repeat; count += 1) samples.push(sample);
          }
        }
      }

      const area = Math.max(1, (endX - startX) * (endY - startY));
      cells.push({
        samples,
        average:
          foregroundCount > 0
            ? [Math.round(r / foregroundCount), Math.round(g / foregroundCount), Math.round(b / foregroundCount)]
            : null,
        backgroundShare: backgroundCount / area,
      });
    }
  }
  return cells;
}

function rankPaletteColors(
  sampledCells: SampledCell[],
  options: ConvertOptions,
  activePalette: PaletteColor[],
  profile: StyleProfile,
): Array<{ color: PaletteColor; count: number; score: number }> {
  // 频次统计先按 5bit/通道聚合：照片每格的采样点几乎两两不同，逐点做全色卡
  // CIEDE2000 会把生成时间放大数倍；聚合只影响“谁排前面”的频次精度，
  // 逐格选色、抖动和合并仍走精确最近豆色。
  const buckets = new Map<number, { r: number; g: number; b: number; count: number }>();
  sampledCells.forEach((cell) => {
    if (cell.backgroundShare >= profile.backgroundThreshold || cell.samples.length === 0) return;
    cell.samples.forEach((rgb) => {
      const key = ((rgb[0] >> 3) << 10) | ((rgb[1] >> 3) << 5) | (rgb[2] >> 3);
      const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
      bucket.r += rgb[0];
      bucket.g += rgb[1];
      bucket.b += rgb[2];
      bucket.count += 1;
      buckets.set(key, bucket);
    });
  });
  const counts = new Map<string, { color: PaletteColor; count: number }>();
  let total = 0;
  buckets.forEach((bucket) => {
    total += bucket.count;
    const average: [number, number, number] = [
      Math.round(bucket.r / bucket.count),
      Math.round(bucket.g / bucket.count),
      Math.round(bucket.b / bucket.count),
    ];
    const color = nearestPaletteColor(average, activePalette);
    const entry = counts.get(color.id) ?? { color, count: 0 };
    entry.count += bucket.count;
    counts.set(color.id, entry);
  });
  const rows = [...counts.values()]
    .map((entry) => {
      const chroma = colorChroma(entry.color.rgb);
      const share = total > 0 ? entry.count / total : 0;
      const lightness = luminance(entry.color.rgb);
      const accentBoost = chroma > 48 ? 2.25 : chroma > 28 ? 1.4 : 1;
      const minorityAccentBoost = chroma > 58 && share < 0.018 ? 2.45 : 1;
      const darkLineBoost = lightness < 48 ? 1.55 : 1;
      const lightNeutralPenalty = lightness > 210 && chroma < 22 ? 0.82 : 1;
      return {
        ...entry,
        score: entry.count * accentBoost * minorityAccentBoost * darkLineBoost * lightNeutralPenalty,
      };
    })
    .sort((a, b) => b.score - a.score || b.count - a.count);
  return rows.length > 0
    ? rows
    : activePalette.slice(0, options.maxColors).map((color) => ({ color, count: 1, score: 1 }));
}

/** 用确定性的 Lab 聚类补足全局色彩覆盖；最终映射真实豆色仍统一使用 CIEDE2000。 */
function clusterPaletteCandidates(
  sampledCells: SampledCell[],
  maxColors: number,
  activePalette: PaletteColor[],
  profile: StyleProfile,
): Array<{ color: PaletteColor; count: number; score: number }> {
  const representatives = sampledCells.flatMap((cell) =>
    cell.backgroundShare < profile.backgroundThreshold && cell.average ? [cell.average] : [],
  );
  if (representatives.length < 2) return [];
  const stride = Math.max(1, Math.ceil(representatives.length / 8192));
  const points: Array<{ rgb: [number, number, number]; lab: Lab }> = [];
  for (let index = 0; index < representatives.length; index += stride) {
    const rgb = representatives[index];
    points.push({ rgb, lab: rgbToLab(rgb) });
  }
  const centers = kmeansLab(points.map((point) => point.lab), Math.min(maxColors, points.length));
  const counts = new Int32Array(centers.length);
  const sums = new Float64Array(centers.length * 3);
  points.forEach((point) => {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    centers.forEach((center, index) => {
      const distance = labDistanceSquared(point.lab, center);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    counts[best] += 1;
    sums[best * 3] += point.rgb[0];
    sums[best * 3 + 1] += point.rgb[1];
    sums[best * 3 + 2] += point.rgb[2];
  });

  const sampleScale = profile.sampleSide * profile.sampleSide;
  const byId = new Map<string, { color: PaletteColor; count: number; score: number }>();
  centers.forEach((_, index) => {
    if (counts[index] === 0) return;
    const count = counts[index];
    const average: [number, number, number] = [
      Math.round(sums[index * 3] / count),
      Math.round(sums[index * 3 + 1] / count),
      Math.round(sums[index * 3 + 2] / count),
    ];
    const color = nearestPaletteColor(average, activePalette);
    const bucket = byId.get(color.id) ?? { color, count: 0, score: 0 };
    bucket.count += count * sampleScale;
    bucket.score = bucket.count;
    byId.set(color.id, bucket);
  });
  return [...byId.values()].sort((a, b) => b.count - a.count);
}

/** 固定种子的 k-means++ 初始化 + Lloyd 迭代，避免刷新后同一图片换一套颜色。 */
function kmeansLab(points: Lab[], requestedClusters: number): Lab[] {
  let seed = 0x9e3779b9;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const centers: Lab[] = [points[Math.floor(random() * points.length)].slice() as Lab];
  const minDistances = new Float64Array(points.length).fill(Number.POSITIVE_INFINITY);
  while (centers.length < requestedClusters) {
    const last = centers[centers.length - 1];
    let sum = 0;
    points.forEach((point, index) => {
      const distance = labDistanceSquared(point, last);
      if (distance < minDistances[index]) minDistances[index] = distance;
      sum += minDistances[index];
    });
    if (sum <= 1e-9) break;
    let target = random() * sum;
    let pick = points.length - 1;
    for (let index = 0; index < points.length; index += 1) {
      target -= minDistances[index];
      if (target <= 0) {
        pick = index;
        break;
      }
    }
    centers.push(points[pick].slice() as Lab);
  }

  const assignments = new Int32Array(points.length).fill(-1);
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const sums = new Float64Array(centers.length * 3);
    const counts = new Int32Array(centers.length);
    let moved = false;
    points.forEach((point, pointIndex) => {
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      centers.forEach((center, centerIndex) => {
        const distance = labDistanceSquared(point, center);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = centerIndex;
        }
      });
      if (assignments[pointIndex] !== best) {
        assignments[pointIndex] = best;
        moved = true;
      }
      counts[best] += 1;
      sums[best * 3] += point[0];
      sums[best * 3 + 1] += point[1];
      sums[best * 3 + 2] += point[2];
    });
    centers.forEach((center, centerIndex) => {
      if (counts[centerIndex] > 0) {
        centers[centerIndex] = [
          sums[centerIndex * 3] / counts[centerIndex],
          sums[centerIndex * 3 + 1] / counts[centerIndex],
          sums[centerIndex * 3 + 2] / counts[centerIndex],
        ];
        return;
      }
      let farthest = 0;
      let farthestDistance = -1;
      points.forEach((point, pointIndex) => {
        const distance = labDistanceSquared(point, centers[assignments[pointIndex]]);
        if (distance > farthestDistance) {
          farthestDistance = distance;
          farthest = pointIndex;
        }
      });
      centers[centerIndex] = points[farthest].slice() as Lab;
      moved = true;
    });
    if (!moved && iteration > 0) break;
  }
  return centers;
}

function labDistanceSquared(a: Lab, b: Lab): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

function selectCandidateColors(
  ranked: Array<{ color: PaletteColor; count: number; score: number }>,
  maxColors: number,
  activePalette: PaletteColor[],
  strength: number,
  profile: StyleProfile,
  clustered: Array<{ color: PaletteColor; count: number; score: number }>,
): PaletteColor[] {
  const level = Math.max(0, Math.min(4, Math.round(strength)));
  const selected: PaletteColor[] = [];
  const selectedIds = new Set<string>();
  const add = (color: PaletteColor, allowSimilar = false) => {
    if (selectedIds.has(color.id) || selected.length >= maxColors) return false;
    if (!allowSimilar && selected.length > 0) {
      const chroma = colorChroma(color.rgb);
      const vivid = luminance(color.rgb) < 48 || chroma > 58;
      const threshold = (vivid ? distinctVividThreshold : distinctThreshold)[level] * profile.candidateDistanceFactor;
      const nearestDistance = Math.min(...selected.map((item) => paletteColorDistance(color, item)));
      if (nearestDistance < threshold) return false;
    }
    selected.push(color);
    selectedIds.add(color.id);
    return true;
  };

  const rankedIds = new Set(ranked.map((entry) => entry.color.id));
  const diversityCandidates = [...ranked, ...clustered.filter((entry) => !rankedIds.has(entry.color.id))];
  const chooseDiverseUntil = (targetCount: number) => {
    while (selected.length < Math.min(maxColors, targetCount)) {
      const choices = diversityCandidates
        .filter((entry) => !selectedIds.has(entry.color.id))
        .map((entry) => ({
          entry,
          diversityScore: candidateDiversityScore(entry, selected),
        }))
        .sort((a, b) => b.diversityScore - a.diversityScore);
      const added = choices.some((choice) => add(choice.entry.color));
      if (!added) break;
    }
  };

  const sortedByCount = [...ranked].sort((a, b) => b.count - a.count);
  sortedByCount.forEach((entry) => {
    if (selected.length < Math.ceil(maxColors * 0.28)) add(entry.color);
  });

  const protectedFeatureSlots = Math.max(2, Math.ceil(maxColors * (profile.useAverageFallback ? 0.28 : 0.22)));
  const featureCandidates = ranked
    .filter((entry) => isFeatureColor(entry.color, entry.count, ranked))
    .map((entry) => ({
      entry,
      featureScore: featureColorScore(entry, selected),
    }))
    .sort((a, b) => b.featureScore - a.featureScore);

  featureCandidates.forEach((choice) => {
    if (selected.length < maxColors && selected.filter((color) => isFeaturePaletteColor(color)).length < protectedFeatureSlots) {
      add(choice.entry.color, shouldAllowFeatureSimilarity(choice.entry.color, selected));
    }
  });

  ranked
    .filter((entry) => isFeaturePaletteColor(entry.color))
    .forEach((entry) => add(entry.color, shouldAllowFeatureSimilarity(entry.color, selected)));
  chooseDiverseUntil(Math.ceil(maxColors * profile.candidateTargetRatio));
  clustered.forEach((entry) => add(entry.color));
  ranked.forEach((entry) => add(entry.color));
  if (profile.useAverageFallback || selected.length < Math.min(6, maxColors)) {
    ranked.forEach((entry) => add(entry.color, true));
  }

  return selected.length > 0 ? selected : activePalette.slice(0, maxColors);
}

function isFeatureColor(
  color: PaletteColor,
  count: number,
  ranked: Array<{ color: PaletteColor; count: number; score: number }>,
): boolean {
  const maxCount = Math.max(1, ranked[0]?.count ?? 1);
  const shareOfLargest = count / maxCount;
  const chroma = colorChroma(color.rgb);
  const lightness = luminance(color.rgb);
  if (chroma > 70 && shareOfLargest > 0.002) return true;
  if (chroma > 52 && shareOfLargest > 0.006) return true;
  if (lightness < 36 && shareOfLargest > 0.003) return true;
  return false;
}

function isFeaturePaletteColor(color: PaletteColor): boolean {
  return colorChroma(color.rgb) > 48 || luminance(color.rgb) < 45;
}

function shouldAllowFeatureSimilarity(color: PaletteColor, selected: PaletteColor[]): boolean {
  if (selected.length === 0) return false;
  const nearestDistance = Math.min(...selected.map((item) => paletteColorDistance(color, item)));
  const chroma = colorChroma(color.rgb);
  // 高彩度特征色允许跨过同色族阈值（旧 RGB 14 → ΔE00 ≈ 2.8）。
  return chroma > 68 && nearestDistance > rgbThresholdToDeltaE(14);
}

function featureColorScore(
  entry: { color: PaletteColor; count: number; score: number },
  selected: PaletteColor[],
): number {
  const chroma = colorChroma(entry.color.rgb);
  const lightness = luminance(entry.color.rgb);
  // 旧 RGB 90 / 22 换算后的感知尺度：默认 17.9，1 分差异约 4.4 ΔE00。
  const selectedDistance = selected.length > 0
    ? Math.min(...selected.map((color) => paletteColorDistance(entry.color, color)))
    : rgbThresholdToDeltaE(90);
  const saturationBoost = 1 + Math.min(3.2, chroma / 34);
  const contrastBoost = lightness < 42 ? 1.8 : 1;
  const differenceBoost = Math.max(0.8, Math.min(4.5, selectedDistance / rgbThresholdToDeltaE(22)));
  return Math.sqrt(Math.max(1, entry.count)) * saturationBoost * contrastBoost * differenceBoost;
}

function candidateDiversityScore(
  entry: { color: PaletteColor; count: number; score: number },
  selected: PaletteColor[],
): number {
  if (selected.length === 0) return entry.score;
  const distance = Math.min(...selected.map((color) => paletteColorDistance(entry.color, color)));
  const chroma = colorChroma(entry.color.rgb);
  const lightness = luminance(entry.color.rgb);
  // 旧 RGB 26 作为“1 分差异”的基准，换算成 ΔE00 ≈ 5.2。
  const distinctBoost = Math.max(0.35, Math.min(5.4, (distance / rgbThresholdToDeltaE(26)) ** 1.55));
  const featureBoost = chroma > 58 || lightness < 48 ? 2.15 : chroma > 34 ? 1.36 : 1;
  const countSignal = Math.sqrt(Math.max(1, entry.count));
  return countSignal * distinctBoost * featureBoost;
}

function chooseCellColor(cell: SampledCell, candidates: PaletteColor[], profile: StyleProfile): string | null {
  if (cell.backgroundShare >= profile.backgroundThreshold || cell.samples.length === 0) return null;
  const featureRgb = minorityDarkFeatureRgb(cell.samples);
  if (featureRgb) return nearestPaletteColor(featureRgb, candidates).id;
  // 先按 5bit/通道找格内主色，再对主色找一次最近豆：照片的采样点几乎两两不同，
  // 逐点找最近色会让卡通生成慢数倍，而主色本身用色桶统计已经足够稳定。
  const buckets = new Map<number, { r: number; g: number; b: number; count: number }>();
  cell.samples.forEach((sample) => {
    const key = ((sample[0] >> 3) << 10) | ((sample[1] >> 3) << 5) | (sample[2] >> 3);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
    bucket.r += sample[0];
    bucket.g += sample[1];
    bucket.b += sample[2];
    bucket.count += 1;
    buckets.set(key, bucket);
  });
  // 每个色桶只找一次最近豆，再按桶内样本数投票；比逐样本找最近快一个量级，
  // 又保留了“按豆色多数表决”的稳定性，不会因为主色桶取均值而选到中间色。
  const votes = new Map<string, { color: PaletteColor; count: number }>();
  buckets.forEach((bucket) => {
    // 色桶均值再落到 5bit 网格上，让同一色域复用精确缓存；误差不超过桶宽，
    // 却能把每个格子的最近色查询从几十次降到个位数。
    const mean: [number, number, number] = [
      quantizeToBucket(bucket.r / bucket.count),
      quantizeToBucket(bucket.g / bucket.count),
      quantizeToBucket(bucket.b / bucket.count),
    ];
    const color = nearestPaletteColor(mean, candidates);
    const vote = votes.get(color.id) ?? { color, count: 0 };
    vote.count += bucket.count;
    votes.set(color.id, vote);
  });
  let primary: { color: PaletteColor; count: number } | null = null;
  for (const vote of votes.values()) {
    if (!primary || vote.count > primary.count) primary = vote;
  }
  if (!primary) return null;
  const primaryShare = primary.count / cell.samples.length;
  if (primaryShare >= profile.dominanceThreshold || !profile.useAverageFallback || !cell.average) {
    return primary.color.id;
  }
  return nearestPaletteColor(cell.average, candidates).id;
}

/**
 * 写实风格的量化：先为每个格子确定「目标色」——双色交界处取主导色块以保持边缘锐利，
 * 纯色/渐变区域取平均色；再用蛇形 Floyd–Steinberg 误差扩散把平均色映射到受限色板，
 * 让渐变用同一套色板也能呈现细腻的过渡。
 */
function ditherCellColors(
  cells: SampledCell[],
  width: number,
  height: number,
  candidates: PaletteColor[],
  profile: StyleProfile,
): Array<string | null> {
  const targets = cells.map((cell) => cellTargetColor(cell, profile));
  const work: Array<[number, number, number] | null> = targets.map((rgb): [number, number, number] | null =>
    rgb ? [rgb[0], rgb[1], rgb[2]] : null,
  );
  const base: Array<[number, number, number] | null> = targets.map((rgb): [number, number, number] | null =>
    rgb ? [rgb[0], rgb[1], rgb[2]] : null,
  );
  const result: Array<string | null> = new Array(cells.length).fill(null);
  // 拼豆是实体颗粒，抖动要克制：弱扩散 + 限制单次误差，只在平滑区域内生效。
  const strength = 0.4;
  const maxError = 12;
  // 与相邻格子色差大的位置属于边缘/细节，保持平涂，不参与抖动。
  const smooth = new Uint8Array(cells.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const own = base[index];
      if (!own) continue;
      let isSmooth = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighborBase = base[ny * width + nx];
        if (!neighborBase) continue;
        if (perceptualDistance(own, neighborBase) > ditherEdgeThreshold) {
          isSmooth = false;
          break;
        }
      }
      if (isSmooth) smooth[index] = 1;
    }
  }

  const spread = (x: number, y: number, error: [number, number, number], weight: number, from: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    const target = work[index];
    const neighborBase = base[index];
    if (!target || !neighborBase || !smooth[index]) return;
    // 跨色块边界不扩散，避免噪点渗进相邻区域。
    if (perceptualDistance(from, neighborBase) > ditherSpreadThreshold) return;
    target[0] += error[0] * weight;
    target[1] += error[1] * weight;
    target[2] += error[2] * weight;
  };

  for (let y = 0; y < height; y += 1) {
    const reverse = y % 2 === 1;
    for (let step = 0; step < width; step += 1) {
      const x = reverse ? width - 1 - step : step;
      const index = y * width + x;
      const target = work[index];
      const own = base[index];
      if (!target || !own) continue;
      const color = nearestPaletteColor(
        [clampChannel(target[0]), clampChannel(target[1]), clampChannel(target[2])],
        candidates,
      );
      result[index] = color.id;
      if (!smooth[index]) continue;
      const error: [number, number, number] = [
        clampError((target[0] - color.rgb[0]) * strength, maxError),
        clampError((target[1] - color.rgb[1]) * strength, maxError),
        clampError((target[2] - color.rgb[2]) * strength, maxError),
      ];
      const direction = reverse ? -1 : 1;
      spread(x + direction, y, error, 7 / 16, own);
      spread(x - direction, y + 1, error, 3 / 16, own);
      spread(x, y + 1, error, 5 / 16, own);
      spread(x + direction, y + 1, error, 1 / 16, own);
    }
  }

  return result;
}

function cellTargetColor(cell: SampledCell, profile: StyleProfile): [number, number, number] | null {
  if (cell.backgroundShare >= profile.backgroundThreshold || !cell.average) return null;
  // 双色交界：用主导色块的颜色，避免平均后产生中间色把边缘糊掉。
  return minorityDarkFeatureRgb(cell.samples) ?? dominantClusterColor(cell.samples) ?? cell.average;
}

/**
 * 小面积深色特征保护。
 *
 * 眼睛、嘴角、细描边在一个格子里往往只占 10% 左右，取主导色或平均色都会被背景色吞掉。
 * 这里把样本按色桶聚合，若存在一个「占比不高、但明显比主色暗」的色桶，就直接用它，
 * 让黑色线条和小五官在受限色板下也能留下来。
 */
function minorityDarkFeatureRgb(samples: Array<[number, number, number]>): [number, number, number] | null {
  if (samples.length < 8) return null;
  const buckets = new Map<number, { sum: [number, number, number]; count: number }>();
  samples.forEach((sample) => {
    const key =
      (Math.round(sample[0] / 24) << 8) | (Math.round(sample[1] / 24) << 4) | Math.round(sample[2] / 24);
    const bucket = buckets.get(key) ?? { sum: [0, 0, 0], count: 0 };
    bucket.sum[0] += sample[0];
    bucket.sum[1] += sample[1];
    bucket.sum[2] += sample[2];
    bucket.count += 1;
    buckets.set(key, bucket);
  });

  const rows = [...buckets.values()]
    .map((bucket) => ({
      rgb: bucket.sum.map((channel) => Math.round(channel / bucket.count)) as [number, number, number],
      count: bucket.count,
    }))
    .sort((a, b) => b.count - a.count);
  const primary = rows[0];
  if (!primary) return null;
  const primaryLuminance = luminance(primary.rgb);

  let best: { rgb: [number, number, number]; count: number } | null = null;
  for (const row of rows.slice(1)) {
    const share = row.count / samples.length;
    // 8% 太容易把“浅底 + 一点点抗锯齿”的格子整格染黑，12% 仍能覆盖 1~2 像素宽的描边。
    if (share < 0.12) continue;
    const featureLuminance = luminance(row.rgb);
    // 只保深色线条和五官，不让背景色/亮色块反过来侵入主体。
    if (featureLuminance > 96) continue;
    if (featureLuminance + 50 > primaryLuminance) continue;
    if (perceptualDistance(row.rgb, primary.rgb) < darkFeatureContrastThreshold) continue;
    if (!best || row.count > best.count) best = row;
  }
  return best ? best.rgb : null;
}

/** 把格子内的采样分成两组；只有明显双色且其中一组占多数时，才返回主导色块的平均色。 */
function dominantClusterColor(samples: Array<[number, number, number]>): [number, number, number] | null {
  if (samples.length < 6) return null;
  const average = meanColor(samples);
  let seedA = samples[0];
  let farthest = -1;
  samples.forEach((sample) => {
    const distance = perceptualDistance(sample, average);
    if (distance > farthest) {
      farthest = distance;
      seedA = sample;
    }
  });
  let seedB = samples[0];
  let separation = -1;
  samples.forEach((sample) => {
    const distance = perceptualDistance(sample, seedA);
    if (distance > separation) {
      separation = distance;
      seedB = sample;
    }
  });
  // 颜色差异不够大，说明是平滑渐变或同色噪点，交给平均色 + 抖动处理。
  if (separation < clusterSeparationThreshold) return null;

  let groupA: Array<[number, number, number]> = [];
  let groupB: Array<[number, number, number]> = [];
  for (let iteration = 0; iteration < 3; iteration += 1) {
    groupA = [];
    groupB = [];
    samples.forEach((sample) => {
      if (perceptualDistance(sample, seedA) <= perceptualDistance(sample, seedB)) groupA.push(sample);
      else groupB.push(sample);
    });
    if (groupA.length === 0 || groupB.length === 0) return null;
    seedA = meanColor(groupA);
    seedB = meanColor(groupB);
  }

  const dominant = groupA.length >= groupB.length ? groupA : groupB;
  if (dominant.length / samples.length < 0.32) return null;
  return meanColor(dominant);
}

function meanColor(samples: Array<[number, number, number]>): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  samples.forEach((sample) => {
    r += sample[0];
    g += sample[1];
    b += sample[2];
  });
  return [Math.round(r / samples.length), Math.round(g / samples.length), Math.round(b / samples.length)];
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampError(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

function reduceSpeckles(
  cells: Array<string | null>,
  width: number,
  height: number,
  strength: number,
  candidates: PaletteColor[],
): Array<string | null> {
  const iterations = Math.max(0, Math.min(4, Math.round(strength)));
  if (iterations === 0) return cells;
  const colorMap = new Map(candidates.map((color) => [color.id, color]));
  let next = cells.slice();
  for (let pass = 0; pass < iterations; pass += 1) {
    const current = next;
    next = current.slice();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const colorId = current[index];
        if (!colorId) continue;
        const neighbors = neighborColorIds(current, width, height, x, y);
        const sameCount = neighbors.filter((item) => item === colorId).length;
        const majority = majorityColor(neighbors);
        if (!majority.colorId) continue;
        if (!areSimilarColors(colorMap.get(colorId), colorMap.get(majority.colorId), strength, false)) continue;
        const requiredMajority = iterations >= 4 ? (pass === 0 ? 3 : 4) : pass === 0 ? 4 : 5;
        const sameLimit = iterations >= 4 ? (pass === 0 ? 2 : 1) : pass === 0 ? 1 : 0;
        if (sameCount <= sameLimit && majority.count >= requiredMajority) {
          next[index] = majority.colorId;
        }
      }
    }
  }
  return next;
}

function reduceTinyRegions(
  cells: Array<string | null>,
  width: number,
  height: number,
  strength: number,
  candidates: PaletteColor[],
): Array<string | null> {
  const level = Math.max(0, Math.min(4, Math.round(strength)));
  const maxRegionSize = [0, 1, 2, 5, 9][level];
  if (maxRegionSize <= 0) return cells;
  const colorMap = new Map(candidates.map((color) => [color.id, color]));
  const next = cells.slice();
  const visited = new Uint8Array(cells.length);
  const offsets = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  for (let start = 0; start < cells.length; start += 1) {
    const colorId = cells[start];
    if (!colorId || visited[start]) continue;
    const region: number[] = [];
    const borderCounts = new Map<string, number>();
    const queue = [start];
    visited[start] = 1;

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      region.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      offsets.forEach(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const neighborIndex = ny * width + nx;
        const neighborColorId = cells[neighborIndex];
        if (neighborColorId === colorId && !visited[neighborIndex]) {
          visited[neighborIndex] = 1;
          queue.push(neighborIndex);
          return;
        }
        if (neighborColorId && neighborColorId !== colorId) {
          borderCounts.set(neighborColorId, (borderCounts.get(neighborColorId) ?? 0) + 1);
        }
      });
    }

    if (region.length > maxRegionSize || borderCounts.size === 0) continue;
    const replacement = [...borderCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .find(([neighborColorId]) =>
        areSimilarColors(colorMap.get(colorId), colorMap.get(neighborColorId), strength, true),
      )?.[0];
    if (!replacement) continue;
    region.forEach((index) => {
      next[index] = replacement;
    });
  }

  return next;
}

function mergeSimilarColors(
  cells: Array<string | null>,
  strength: number,
  candidates: PaletteColor[],
): Array<string | null> {
  const level = Math.max(0, Math.min(4, Math.round(strength)));
  if (level === 0) return cells;
  const colorMap = new Map(candidates.map((color) => [color.id, color]));
  const counts = new Map<string, number>();
  cells.forEach((colorId) => {
    if (!colorId) return;
    counts.set(colorId, (counts.get(colorId) ?? 0) + 1);
  });
  const rows = [...counts.entries()]
    .flatMap(([colorId, count]) => {
      const color = colorMap.get(colorId);
      return color ? [{ colorId, color, count }] : [];
    })
    .sort((a, b) => b.count - a.count);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const replacements = new Map<string, string>();

  rows.forEach((row, index) => {
    const rare = row.count <= Math.max(3, total * (0.006 + level * 0.003));
    const target = rows.slice(0, index).find((candidate) =>
      areSimilarColors(row.color, candidate.color, level, rare),
    );
    if (target) replacements.set(row.colorId, replacements.get(target.colorId) ?? target.colorId);
  });

  if (replacements.size === 0) return cells;
  return cells.map((colorId) => (colorId ? replacements.get(colorId) ?? colorId : null));
}

function areSimilarColors(
  from: PaletteColor | undefined,
  to: PaletteColor | undefined,
  strength: number,
  rare: boolean,
): boolean {
  if (!from || !to || from.id === to.id) return false;
  const level = Math.max(0, Math.min(4, Math.round(strength)));
  // 合并阈值统一按 CIEDE2000 标定（见 palette.ts 的 mergeThresholdByLevel）。
  const baseThreshold = mergeThresholdByLevel[level];
  if (baseThreshold <= 0) return false;
  const fromChroma = colorChroma(from.rgb);
  const toChroma = colorChroma(to.rgb);
  const fromLuminance = luminance(from.rgb);
  const toLuminance = luminance(to.rgb);
  const distance = paletteColorDistance(from, to);
  const saturationMismatch = Math.abs(fromChroma - toChroma);
  const luminanceMismatch = Math.abs(fromLuminance - toLuminance);
  const bothDark = fromLuminance < 84 && toLuminance < 84;
  const bothLightNeutral = fromLuminance > 188 && toLuminance > 188 && fromChroma < 46 && toChroma < 46;
  const bothMuted = fromLuminance > 96 && toLuminance > 96 && fromChroma < 82 && toChroma < 82;
  let threshold = baseThreshold * (rare ? 1.45 : 1);
  if (bothDark || bothLightNeutral || bothMuted) threshold *= 1.15;
  if (fromChroma > 78 || toChroma > 78) threshold *= 0.7;
  if (saturationMismatch > 56) threshold *= 0.58;
  if (luminanceMismatch > 86 && !bothDark) threshold *= 0.55;
  return distance <= threshold;
}

function neighborColorIds(cells: Array<string | null>, width: number, height: number, x: number, y: number): Array<string | null> {
  const result: Array<string | null> = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      result.push(cells[ny * width + nx]);
    }
  }
  return result;
}

function majorityColor(colors: Array<string | null>): { colorId: string | null; count: number } {
  const counts = new Map<string, number>();
  colors.forEach((colorId) => {
    if (!colorId) return;
    counts.set(colorId, (counts.get(colorId) ?? 0) + 1);
  });
  return [...counts.entries()]
    .map(([colorId, count]) => ({ colorId, count }))
    .sort((a, b) => b.count - a.count)[0] ?? { colorId: null, count: 0 };
}

function luminance(rgb: [number, number, number]): number {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

function colorChroma(rgb: [number, number, number]): number {
  return Math.max(...rgb) - Math.min(...rgb);
}

function quantizeChannel(value: number, step: number): number {
  return Math.max(0, Math.min(255, Math.round(value / step) * step));
}

/** 5bit/通道网格中心，用于复用最近色缓存。 */
function quantizeToBucket(value: number): number {
  return Math.min(255, ((Math.round(value) >> 3) << 3) + 4);
}

function clampStrength(value: number): number {
  return Math.max(0, Math.min(4, Math.round(value)));
}

function estimateBackgroundColor(data: Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const samples: Array<[number, number, number]> = [];
  const maxSamplesPerEdge = 80;
  const xStep = Math.max(1, Math.floor(width / maxSamplesPerEdge));
  const yStep = Math.max(1, Math.floor(height / maxSamplesPerEdge));

  for (let x = 0; x < width; x += xStep) {
    pushOpaqueSample(samples, data, width, x, 0);
    pushOpaqueSample(samples, data, width, x, height - 1);
  }
  for (let y = 0; y < height; y += yStep) {
    pushOpaqueSample(samples, data, width, 0, y);
    pushOpaqueSample(samples, data, width, width - 1, y);
  }

  if (samples.length === 0) return [255, 255, 255];

  const buckets = new Map<string, { rgb: [number, number, number]; count: number }>();
  samples.forEach((rgb) => {
    const key = rgb.map((channel) => Math.round(channel / 16) * 16).join(',');
    const bucket = buckets.get(key) ?? { rgb: [0, 0, 0], count: 0 };
    bucket.rgb[0] += rgb[0];
    bucket.rgb[1] += rgb[1];
    bucket.rgb[2] += rgb[2];
    bucket.count += 1;
    buckets.set(key, bucket);
  });

  const best = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
  return [
    Math.round(best.rgb[0] / best.count),
    Math.round(best.rgb[1] / best.count),
    Math.round(best.rgb[2] / best.count),
  ];
}

function pushOpaqueSample(
  samples: Array<[number, number, number]>,
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): void {
  const index = (y * width + x) * 4;
  if (data[index + 3] < 24) return;
  samples.push([data[index], data[index + 1], data[index + 2]]);
}
