// 人像智能抠图：基于 MediaPipe Selfie Segmentation（Apache-2.0），全程在浏览器本地运行。
// 产物是同名 PNG（带透明通道），后续转换时 alpha < 24 的像素会被当作空豆处理。

type SelfieSegmentationInstance = {
  setOptions(options: Record<string, unknown>): void;
  onResults(callback: (results: { segmentationMask: CanvasImageSource }) => void): void;
  send(inputs: { image: HTMLCanvasElement }): Promise<void>;
  close(): void;
};

type SelfieSegmentationConstructor = new (config: { locateFile: (file: string) => string }) => SelfieSegmentationInstance;

declare const SelfieSegmentation: SelfieSegmentationConstructor;

const VENDOR_DIR = 'vendor/selfie_segmentation/';
const MAX_SEGMENT_SIDE = 1024;

let enginePromise: Promise<SelfieSegmentationInstance> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function vendorLocate(file: string): string {
  return new URL(`${VENDOR_DIR}${file}`, document.baseURI).href;
}

function getEngine(): Promise<SelfieSegmentationInstance> {
  if (!enginePromise) {
    if (typeof SelfieSegmentation === 'undefined') {
      enginePromise = Promise.reject(new Error('抠图引擎未加载，请刷新页面后重试。'));
    } else {
      enginePromise = Promise.resolve(new SelfieSegmentation({ locateFile: vendorLocate }));
    }
  }
  return enginePromise;
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
      reject(new Error('无法读取这张图片。'));
    };
    image.src = url;
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smootherstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function segment(engine: SelfieSegmentationInstance, input: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('抠图超时，请刷新页面后重试。')), 60_000);
    engine.onResults((results) => {
      window.clearTimeout(timeout);
      const mask = document.createElement('canvas');
      mask.width = input.width;
      mask.height = input.height;
      const context = mask.getContext('2d', { willReadFrequently: true });
      if (!context) {
        reject(new Error('当前浏览器不支持 Canvas。'));
        return;
      }
      context.drawImage(results.segmentationMask, 0, 0, input.width, input.height);
      resolve(mask);
    });
    engine.send({ image: input }).catch((error) => {
      window.clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error('抠图失败。'));
    });
  });
}

export async function cutoutPortrait(file: File): Promise<File> {
  // MediaPipe 的实例内部持有 wasm 状态，这里串行执行，避免并发调用互相覆盖回调。
  const task = queue.then(async () => {
    const image = await loadImage(file);
    const scale = Math.min(1, MAX_SEGMENT_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const sourceContext = source.getContext('2d', { willReadFrequently: true });
    if (!sourceContext) throw new Error('当前浏览器不支持 Canvas。');
    sourceContext.drawImage(image, 0, 0, width, height);

    const engine = await getEngine();
    engine.setOptions({ modelSelection: 1, selfieMode: false });
    const maskCanvas = await segment(engine, source);
    const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!maskContext) throw new Error('当前浏览器不支持 Canvas。');

    const sourceData = sourceContext.getImageData(0, 0, width, height);
    const maskData = maskContext.getImageData(0, 0, width, height).data;
    let kept = 0;
    for (let index = 0; index < maskData.length; index += 4) {
      // 分割结果写在红色通道；用 smootherstep 软化边缘，避免锯齿和半透明脏边。
      const coverage = smootherstep(0.18, 0.82, maskData[index] / 255);
      const alpha = Math.round(sourceData.data[index + 3] * coverage);
      sourceData.data[index + 3] = alpha;
      if (alpha > 128) kept += 1;
    }
    if (kept / (width * height) < 0.004) {
      throw new Error('没有识别到清晰人像，请换一张主体居中的照片，或改用「去除背景 + 手动画笔擦拭」。');
    }
    sourceContext.putImageData(sourceData, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => source.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('导出抠图结果失败。');
    const name = file.name.replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${name}-cutout.png`, { type: 'image/png' });
  });
  queue = task.catch(() => undefined);
  return task;
}
