export type BrandId = 'MARD' | 'ARTKAL';

export type ToolId = 'pencil' | 'eraser' | 'fill' | 'remove' | 'recolor' | 'eyedropper' | 'move' | 'copy' | 'paste' | 'mirror' | 'shape' | 'text' | 'pan';

export type ClipboardPattern = {
  width: number;
  height: number;
  cells: Array<string | null>;
};

export type DisplayMode = 'pixel' | 'bead' | 'print';
export type RightClickAction = 'pan' | 'erase';
export type MoveMode = 'layer' | 'partial';
export type RemoveMode = 'same-connected' | 'all-same-color' | 'connected';
export type CopyMode = 'connected' | 'selection';
export type MirrorDirection = 'horizontal' | 'vertical';
export type ShapeKind = 'line' | 'rectangle' | 'square' | 'ellipse' | 'circle' | 'triangle' | 'arrow';
export type ShapeFillMode = 'outline' | 'filled';
export type ArrowKind = 'single' | 'double' | 'block';
export type TextDirection = 'horizontal' | 'vertical';

export type PaletteColor = {
  id: string;
  primaryBrand: BrandId;
  primaryCode: string;
  hex: string;
  rgb: [number, number, number];
  codes: Partial<Record<BrandId, string>>;
  group: string;
  name: string;
};

export type ProjectSettings = {
  showGrid: boolean;
  showCoordinates: boolean;
  showPegboardBoundaries: boolean;
  showLayerOverlap: boolean;
  showActiveLayerOnly: boolean;
  showColorCodes: boolean;
  beadDisplayMode: DisplayMode;
  /** 画布预览底色：hex 颜色，或 'transparent' 表示透明底（棋盘格） */
  previewBackdrop: string;
  beadsPerPack: number;
  rightClickAction: RightClickAction;
};

export type BeadLayer = {
  id: string;
  name: string;
  customName?: boolean;
  visible: boolean;
  locked: boolean;
  includeInUsage: boolean;
  opacity: number;
  cells: Array<string | null>;
};

export type BoardSettings = {
  boardWidth: number;
  boardHeight: number;
  showBoardIds: boolean;
  /** 单颗拼豆直径（毫米），用于换算成品物理尺寸。 */
  beadSizeMm: number;
};

export type BeadProject = {
  version: string;
  name: string;
  width: number;
  height: number;
  activeBrand: BrandId;
  paletteVersion: string;
  cells: Array<string | null>;
  layers: BeadLayer[];
  activeLayerId: string;
  settings: ProjectSettings;
  boardSettings: BoardSettings;
  /** 生成时因库存缺色而使用的替代记录：实际色号 → 理想色号与色差(ΔE00)。 */
  substitutions?: Record<string, { idealId: string; deltaE: number }>;
  /** 分色打卡进度：色号 → 已完成颗数。 */
  progress?: Record<string, number>;
  createdAt: string;
  updatedAt: string;
};

export type UsageRow = {
  color: PaletteColor;
  count: number;
  packs: number;
  /** 该色号是库存缺色后的替代色时，记录本来最接近的理想色与色差。 */
  substitution?: { ideal: PaletteColor; deltaE: number };
  /** 分色打卡：该色号已完成的颗数。 */
  done?: number;
};

export type BackgroundMode = 'keep' | 'remove-white';
export type GenerationStyle = 'cartoon' | 'realistic';

export type ConvertOptions = {
  width: number;
  /** 生成结果必须完整放进的画板尺寸；超出时按比例缩小，避免生成后再缩放导致糊边。 */
  bounds?: { width: number; height: number };
  maxColors: number;
  palette?: PaletteColor[];
  /** 色卡全量（不受库存限制）。传入后会统计“库存缺色 → 用了哪个替代色”。 */
  idealPalette?: PaletteColor[];
  backgroundMode: BackgroundMode;
  backgroundColor: [number, number, number];
  tolerance: number;
  speckleReduction: number;
  generationStyle: GenerationStyle;
};

export type ColorSubstitution = {
  /** 实际使用的色号（在库存里） */
  colorId: string;
  /** 色卡里最接近、但不在库存里的理想色号 */
  idealId: string;
  /** 实际色与理想色的 CIEDE2000 色差 */
  deltaE: number;
  /** 受影响格子数 */
  cells: number;
};

export type ConvertResult = {
  width: number;
  height: number;
  cells: Array<string | null>;
  colorsUsed: number;
  totalBeads: number;
  substitutions?: ColorSubstitution[];
};
