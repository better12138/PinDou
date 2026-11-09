// 人像自动取景：用 MediaPipe Face Detection（Apache-2.0）定位人脸，再按头像构图规则
//（头顶留白 + 肩部）算出裁剪框，全程在浏览器本地运行，不上传图片。

export type FrameRect = { x: number; y: number; width: number; height: number };

export type FrameTuning = {
  /** 头顶留白，按脸高的倍数计算（0 ~ 1） */
  headroom: number;
  /** 取景范围系数，1 表示默认构图 */
  scale: number;
  /** 水平偏移，按裁剪框宽度的比例计算（-0.3 ~ 0.3） */
  offsetX: number;
};

export type PortraitFrame = {
  face: FrameRect;
};

type DetectedRect = { xCenter: number; yCenter: number; width: number; height: number };

type FaceDetectionInstance = {
  setOptions(options: Record<string, unknown>): void;
  onResults(callback: (results: { detections: Array<{ boundingBox: DetectedRect }> }) => void): void;
  send(inputs: { image: HTMLCanvasElement }): Promise<void>;
};

type FaceDetectionConstructor = new (config: { locateFile: (file: string) => string }) => FaceDetectionInstance;

declare const FaceDetection: FaceDetectionConstructor;

const VENDOR_DIR = 'vendor/face_detection/';
const MAX_DETECT_SIDE = 1024;
const MAX_OUTPUT_SIDE = 1400;
/** 裁剪框宽高比，固定 3:4 竖构图，最终拼豆图纸更适合人像 */
const FRAME_ASPECT = 3 / 4;
/** 裁剪框高度约为脸高的 2.6 倍，即头部占画面 38% 左右，接近常见人像构图 */
const CROP_FACE_HEIGHT = 2.6;

let enginePromise: Promise<FaceDetectionInstance> | null = null;
let queue: Promise<unknown> = Promise.resolve();
const imageCache = new WeakMap<File, Promise<HTMLImageElement>>();

function vendorLocate(file: string): string {
  return new URL(`${VENDOR_DIR}${file}`, document.baseURI).href;
}

function getEngine(): Promise<FaceDetectionInstance> {
  if (!enginePromise) {
    if (typeof FaceDetection === 'undefined') {
      enginePromise = Promise.reject(new Error('人脸检测引擎未加载，请刷新页面后重试。'));
    } else {
      enginePromise = Promise.resolve(new FaceDetection({ locateFile: vendorLocate }));
    }
  }
  return enginePromise;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  const cached = imageCache.get(file);
  if (cached) return cached;
  const task = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      imageCache.delete(file);
      reject(new Error('无法读取这张图片。'));
    };
    image.src = url;
  });
  imageCache.set(file, task);
  return task;
}

function detect(engine: FaceDetectionInstance, input: HTMLCanvasElement): Promise<DetectedRect[]> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('人脸检测超时，请刷新页面后重试。')), 30_000);
    engine.onResults((results) => {
      window.clearTimeout(timeout);
      resolve(
        (results.detections ?? [])
          .map((item) => item.boundingBox)
          .filter((box) => box && box.width > 0 && box.height > 0),
      );
    });
    engine.send({ image: input }).catch((error) => {
      window.clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error('人脸检测失败。'));
    });
  });
}

export async function detectPortraitFrame(file: File): Promise<PortraitFrame> {
  // MediaPipe 实例内部持有 wasm 状态，串行调用避免回调互相覆盖。
  const task = queue.then(async () => {
    const image = await loadImage(file);
    const scale = Math.min(1, MAX_DETECT_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器不支持 Canvas。');
    context.drawImage(image, 0, 0, width, height);

    const engine = await getEngine();
    engine.setOptions({ model: 'short', minDetectionConfidence: 0.5, selfieMode: false });
    const detections = await detect(engine, canvas);
    if (detections.length === 0) {
      throw new Error('没有检测到人脸，请换一张正脸清晰的照片，或先用「智能抠图」再手动调整。');
    }
    // 多张脸时取面积最大的一张，通常就是照片主体。
    const largest = detections.reduce((best, item) =>
      item.width * item.height > best.width * best.height ? item : best,
    );
    return {
      // MediaPipe 给出的是归一化中心点 + 宽高，这里统一换成左上角坐标。
      face: {
        x: largest.xCenter - largest.width / 2,
        y: largest.yCenter - largest.height / 2,
        width: largest.width,
        height: largest.height,
      },
    };
  });
  queue = task.catch(() => undefined);
  return task;
}

/** 按人脸位置和微调参数算出归一化裁剪框（0~1），自动收进图片范围内。 */
export function buildFrameRect(face: FrameRect, tuning: FrameTuning): FrameRect {
  const cropHeight = face.height * CROP_FACE_HEIGHT * tuning.scale;
  const cropWidth = cropHeight * FRAME_ASPECT;
  const centerX = face.x + face.width / 2 + tuning.offsetX * cropWidth;
  return clampRect({
    x: centerX - cropWidth / 2,
    y: face.y - face.height * tuning.headroom,
    width: cropWidth,
    height: cropHeight,
  });
}

function clampRect(rect: FrameRect): FrameRect {
  let { x, y, width, height } = rect;
  if (width > 1 || height > 1) {
    const shrink = Math.min(1 / width, 1 / height);
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    width *= shrink;
    height *= shrink;
    x = centerX - width / 2;
    y = centerY - height / 2;
  }
  return {
    x: Math.min(1 - width, Math.max(0, x)),
    y: Math.min(1 - height, Math.max(0, y)),
    width,
    height,
  };
}

export async function drawFramePreview(canvas: HTMLCanvasElement, file: File, rect: FrameRect): Promise<void> {
  const image = await loadImage(file);
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  canvas.width = 240;
  canvas.height = Math.max(1, Math.round((240 * rect.height) / rect.width));
  const context = canvas.getContext('2d');
  if (!context) return;
  context.imageSmoothingEnabled = true;
  context.drawImage(
    image,
    rect.x * sourceWidth,
    rect.y * sourceHeight,
    rect.width * sourceWidth,
    rect.height * sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
}

/** 按裁剪框裁出新图片，输出 PNG，供后续转换使用。 */
export async function cropImageFile(file: File, rect: FrameRect): Promise<File> {
  const image = await loadImage(file);
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const cropWidth = Math.max(1, rect.width * sourceWidth);
  const cropHeight = Math.max(1, rect.height * sourceHeight);
  const scale = Math.min(1, MAX_OUTPUT_SIDE / Math.max(cropWidth, cropHeight));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持 Canvas。');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    rect.x * sourceWidth,
    rect.y * sourceHeight,
    cropWidth,
    cropHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('导出取景结果失败。');
  const name = file.name.replace(/\.[^.]+$/, '') || 'image';
  return new File([blob], `${name}-framed.png`, { type: 'image/png' });
}
