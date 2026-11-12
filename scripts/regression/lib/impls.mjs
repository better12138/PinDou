// 从 git HEAD 还原“优化前”的算法并编译，用于新老对比；产物只落在系统临时目录。
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const require = createRequire(import.meta.url);

const baselineSources = ['src/imageToBeads.ts', 'src/palette.ts', 'src/types.ts'];

/**
 * HEAD 版本只有 imageFileToBeads（依赖 canvas 解码），这里把“解码”部分换成
 * 直接接收像素的入口，其余算法代码原样保留，保证基线就是旧实现本身。
 */
function makeHeadlessSource(source) {
  const start = source.indexOf('export async function imageFileToBeads');
  const marker = 'const data = context.getImageData(0, 0, sourceWidth, sourceHeight).data;';
  const end = source.indexOf(marker);
  if (start < 0 || end < 0) throw new Error('无法从 HEAD 版本提取纯像素入口，基线构建需更新');
  const replacement = [
    'export function convertImageData(data: Uint8ClampedArray, sourceWidth: number, sourceHeight: number, options: ConvertOptions): ConvertResult {',
    '  const image = { naturalWidth: sourceWidth, naturalHeight: sourceHeight } as HTMLImageElement;',
    '  const { width, height } = resolveGridSize(image, options);',
  ].join('\n');
  return source.slice(0, start) + replacement + source.slice(end + marker.length);
}

// 基线固定在 v1.0.0，而不是 HEAD：否则优化提交之后基线会变成"新算法自己"，
// 对比失去意义。需要换基线时设 PERLER_BASELINE_REV=<commit>。
const pinnedBaselineRevision = '24307d7';

export function prepareBaseline() {
  const revision = baselineRevision();
  const dir = path.join(os.tmpdir(), `perler-baseline-${revision}`);
  const outDir = path.join(dir, 'out');
  const ready = path.join(outDir, 'imageToBeads.js');
  const marker = path.join(dir, 'baseline.version');
  if (existsSync(ready) && existsSync(marker) && readFileSync(marker, 'utf8') === '2') return outDir;
  rmSync(outDir, { recursive: true, force: true });

  mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (const file of baselineSources) {
    let source = execFileSync('git', ['show', `HEAD:${file}`], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 }).toString();
    if (file === 'src/imageToBeads.ts') source = makeHeadlessSource(source);
    writeFileSync(path.join(dir, file), source);
  }
  writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'CommonJS',
          moduleResolution: 'node',
          lib: ['ES2020', 'DOM'],
          outDir: 'out',
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
          types: [],
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    ),
  );
  const tsc = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [tsc, '-p', dir], { stdio: 'inherit' });
  if (!existsSync(ready)) throw new Error(`基线编译失败：${ready}`);
  writeFileSync(marker, '2');
  return outDir;
}

export function baselineRevision() {
  const override = process.env.PERLER_BASELINE_REV;
  if (override) return override;
  try {
    execFileSync('git', ['cat-file', '-t', pinnedBaselineRevision], { cwd: repoRoot, stdio: 'pipe' });
  } catch {
    throw new Error(`基线提交 ${pinnedBaselineRevision} 不在当前仓库里，请用 PERLER_BASELINE_REV 指定`);
  }
  return pinnedBaselineRevision;
}

/** 每次取一份全新的模块实例，避免上一样例的缓存影响内存与耗时对比。 */
export function loadOldImpl(outDir, tag) {
  const modules = [path.join(outDir, 'imageToBeads.js'), path.join(outDir, 'palette.js')];
  for (const file of modules) delete require.cache[require.resolve(file)];
  const convertModule = require(modules[0]);
  const paletteModule = require(modules[1]);
  return {
    convertImageData: convertModule.convertImageData,
    palette: paletteModule.basicPalette,
    colorDistanceLab: paletteModule.colorDistanceLab,
  };
}

export async function loadNewImpl(tag) {
  const root = path.join(repoRoot, 'generated', 'dist', 'src');
  const [convertModule, paletteModule] = await Promise.all([
    import(`${pathToFileURL(path.join(root, 'imageToBeads.js')).href}?case=${tag}`),
    import(`${pathToFileURL(path.join(root, 'palette.js')).href}?case=${tag}`),
  ]);
  return {
    convertImageData: convertModule.convertImageData,
    palette: paletteModule.basicPalette,
    colorDistanceLab: paletteModule.colorDistanceLab,
  };
}
