# Perler Beads Generator（拼豆图纸生成器）

当前版本 v1.1.0 · 基于 [Jett-Wu/Perler_Beads_Generator](https://github.com/Jett-Wu/Perler_Beads_Generator) 二次开发 · 本仓库可通过下方 GitHub Pages 工作流自行部署

上传一张照片，自动量化成真实拼豆色号，再像绘图软件一样逐格修改、分层、看 3D 成品效果，最后导出带色号与坐标的高清图纸和按色分包的采购清单。转换、编辑、导出全部在浏览器本地完成，图片不上传服务器。

相比上游，本仓库主要做了三件事：

- **重新设计的配色算法**：最近色统一用 CIEDE2000 感知色差（精确 24bit RGB 缓存），限色用固定种子的 Lab 聚类，保证同一张图、同一组参数每次生成结果完全一致；配套一套可复现的新旧对比回归（8 组样例 × 2 种风格）。
- **面向真实拼豆流程的功能**：库存模式（只用手上有的色，买不到的色自动替代并标注 ΔE00 色差）、按色号打卡进度、成图与原图对比。
- **现代化的深色工作台界面**：跟随拼豆板宽度、渐变主题、更紧凑的左右面板。

![Perler Beads Generator workspace](docs/realistic-workspace.png)

## 功能亮点

- **图片生成图纸**：按每个拼豆格覆盖的原图区域采样取色，支持卡通 / 写实两种风格、色数上限、容差和背景去除；卡通模式会保留眼睛、轮廓等深色小特征，竖构图按画板比例收缩，避免生成后再缩放导致糊边。
- **拼豆板与成品尺寸**：内置 29×29 / 52×52 / 78×78 / 104×104 等常用尺寸并直接标注要几块板，也可自定义板规格与豆子直径（2.6mm 迷你豆 / 5mm 中豆）并按格子数换算出成品厘米尺寸；改画板尺寸时，只要有原图就用与导入完全相同的算法按新尺寸重算，而不是把已经量化好的格子拉伸。
- **三套真实色卡**：MARD 基础版 221 色、MARD 完整版 291 色、Artkal S 系列 176 色（5mm 中豆），支持品牌切换、色号分组、最近使用和快速选色。
- **专业编辑工具**：画笔、橡皮、填充、消除（同色 / 连续块）、换色、吸管、移动、复制、粘贴、镜像、形状和文字工具；文字支持横排 / 竖排、字号和间距。
- **多图层工作流**：新建、隐藏、锁定、重命名、复制、拖拽排序、只看当前图层，以及按图层统计用量。
- **人像辅助**：智能抠图去背景、人脸自动取景（头顶留白 / 取景范围 / 水平位置可调），以及可调透明度、位置和缩放的参考图临摹。
- **当前图层调整**：亮度、对比度、饱和度、色温、色相、反色、灰阶、黑白、相近色整理和色数上限，随时可撤销。
- **实时 3D 预览**：带中孔豆、清漆高光和柔和阴影的成品效果，跟随圆形 / 方形豆显示，可放大查看。
- **用量统计**：按颜色统计颗数，可设置每包数量并估算包数，附带 +10% 备货建议抵消掉豆与熨烫损耗；支持只统计当前图层或全部图层，导出 Excel / CSV 直接照着买豆。
- **库存模式与缺色替代**：只勾选手上已有的色号生成，缺色时自动改用最接近的库存色，并在用量清单里标注理想色号与 ΔE00 色差等级（≤2 几乎看不出，>12 建议补货）。
- **按色号打卡**：用量清单可逐色记录已完成颗数，做一半关掉页面也不丢，配合高亮未完成区域继续拼。
- **原图对比**：生成后把成图与原图并排或半透明叠加对比，随时检查还原度和走形的位置。
- **高清导出**：PNG / PDF 图纸（PDF 可按拼豆板自动分页，每页标注板号并附该页色号与颗数）、Excel 用量清单，以及可再次导入继续编辑的 JSON 编辑记录。
- **本地与离线**：转换、编辑、导出全部在浏览器完成；原图存入 IndexedDB、草稿自动保存，刷新不丢；构建产物自带依赖、不依赖 CDN，可离线运行；导出额度由纯前端兑换码控制。

## 效果展示

### 写实风格

| 原图 | 工作台 | 导出图纸 |
| --- | --- | --- |
| <img src="docs/realistic-source.jpg" alt="写实风格原图" width="150"> | <img src="docs/realistic-workspace.png" alt="写实风格工作台" width="390"> | <img src="docs/realistic-pattern.png" alt="写实风格导出图纸" width="390"> |

### 卡通风格

| 原图 | 工作台 | 导出图纸 |
| --- | --- | --- |
| <img src="docs/cartoon-source.png" alt="卡通风格原图" width="150"> | <img src="docs/cartoon-workspace.png" alt="卡通风格工作台" width="390"> | <img src="docs/cartoon-pattern.png" alt="卡通风格导出图纸" width="390"> |

### 空白工作区

![Blank workspace](docs/blank-workspace.png)

## 本地运行

```bash
npm install
npm run dev
```

默认预览地址：

```text
http://127.0.0.1:5174/
```

## 构建

```bash
npm run build
```

构建产物会输出到：

```text
generated/dist/
```

## 回归测试

配色与生成的改动都有脚本兜底，不依赖浏览器：

```bash
node --expose-gc scripts/regression/algorithm-comparison.mjs   # 8 组样例 × 2 风格，新旧算法逐项对比
node --expose-gc scripts/regression/robustness.mjs             # 大图、极端参数、边界输入、重复生成、导出
node scripts/regression/image-to-beads.mjs                     # 生成结果快照
node scripts/regression/lab-thresholds.mjs                     # CIEDE2000 阈值标定
```

对比脚本会从固定基线提交（`24307d7`，可用 `PERLER_BASELINE_REV` 覆盖）还原旧算法，输出色数、豆数、平均 / p95 ΔE00、孤豆数、暗部命中率、耗时中位数与峰值内存，指标退化超阈值即失败。

## GitHub Pages 部署

项目已包含 GitHub Pages 自动部署工作流：

```text
.github/workflows/deploy.yml
```

部署方式：

1. 推送代码到 `main` 分支。
2. 打开 GitHub 仓库的 `Settings -> Pages`。
3. 将 `Build and deployment` 设置为 `GitHub Actions`。
4. 之后每次推送到 `main` 都会自动构建并部署到 GitHub Pages。

## 阿里云服务器部署

```bash
npm run build
```

把 `generated/dist/` 整个目录上传到服务器（例如 `/var/www/pindou`），用 Nginx 托管：

```nginx
server {
  listen 80;
  server_name 你的域名;
  root /var/www/pindou;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location ~* \.(js|css|png|jpg|svg|woff2)$ {
    expires 7d;
  }
}
```

访问根路径先看到落地页，点「开始制作」进入编辑器（地址带 `#app`）。

### 兑换码

```bash
node scripts/generate-codes.cjs 50   # 生成 50 个兑换码，每行一个
```

- 每个兑换码兑换 1 次高清导出，兑换记录保存在用户浏览器本地。
- 购买渠道与价格文案在 `src/product.ts` 里修改，上线前记得替换成自己的账号。
- 校验逻辑是纯前端的，能防随手乱填，但挡不住刻意破解；需要强校验时再接后端。

## 文件结构

```text
.github/workflows/
  deploy.yml              # GitHub Pages 自动构建和部署

docs/
  realistic-workspace.png # README 首图，写实风格工作台
  realistic-pattern.png   # 写实风格导出图纸
  realistic-source.jpg    # 写实风格原图
  cartoon-workspace.png   # 卡通风格工作台
  cartoon-pattern.png     # 卡通风格导出图纸
  cartoon-source.png      # 卡通风格原图
  blank-workspace.png     # 空白工作区预览
  gap-analysis.md         # 与同类拼豆工具的差距与机会清单

scripts/
  clean-dist.cjs          # 清理 generated/dist
  post-build.cjs          # 拷贝样式和 vendor 文件，修正构建产物引用
  write-html.cjs          # 写入 GitHub Pages 使用的静态 HTML
  dev-server.cjs          # 本地静态预览服务
  generate-codes.cjs      # 生成兑换码
  regression/
    algorithm-comparison.mjs # 新旧算法对比（8 组样例 × 2 风格）
    robustness.mjs           # 大图 / 极端参数 / 边界输入 / 导出回归
    image-to-beads.mjs       # 生成结果快照
    lab-thresholds.mjs       # CIEDE2000 阈值标定
    fixtures/                # 回归样例图（低饱和 / 高饱和 / 暗部 / 肤色 / 线稿 / 照片）
    lib/                     # 极简 PNG 解码与基线版本加载

src/
  App.tsx                 # 应用状态、布局、顶部栏、左右面板和主要交互
  LandingPage.tsx         # 落地页：介绍、功能、价格、常见问题
  ProductShell.tsx        # 落地页与编辑器之间的切换
  UnlockDialog.tsx        # 兑换码弹窗
  license.ts              # 兑换码校验与导出次数
  product.ts              # 价格与购买渠道文案
  WorkspaceCanvas.tsx     # 2D 画布、绘制工具、参考图、复制、移动和文字逻辑
  CompareDialog.tsx       # 成图与原图并排 / 叠加对比
  ThreePreview.tsx        # 3D 拼豆预览
  imageToBeads.ts         # 图片转拼豆图纸算法（采样、限色聚类、抖动、深色特征保护）
  palette.ts              # MARD / Artkal 色卡、色号分组和 CIEDE2000 颜色匹配
  project.ts              # 项目数据、图层、自动保存和兼容导入
  sourceImage.ts          # 用 IndexedDB 保存原图，支持改画板尺寸后按原图重算
  cutout.ts               # 人像智能抠图（MediaPipe，本地运行）
  autoframe.ts            # 人脸检测与自动取景
  exporters.ts            # PNG / PDF 图纸（含按板分页）、Excel 用量和 JSON 编辑记录导出
  stock.ts                # 库存色号、缺色替代等级与本地存储
  usage.ts                # 用量统计、替代记录和无相邻拼豆检测
  types.ts                # 共享类型定义
  styles.css              # 全局样式
  main.tsx                # React 入口

generated/
  .gitkeep                # 保留目录；构建产物和本地缓存会被忽略

index.html                # 开发入口 HTML
package.json              # 项目脚本和依赖
tsconfig.json             # TypeScript 配置
tsconfig.build.json       # 构建输出配置
```

## 技术栈

- React
- TypeScript
- Three.js
- Canvas API

## 说明

- MARD 色卡用于颜色匹配和界面显示，实际拼豆颜色可能受批次、光线和屏幕显示影响。
- 最近色匹配与色差标注统一使用 CIEDE2000（带 Lab 与精确 24bit RGB 缓存）；限色用固定种子的 k-means++ Lab 聚类，因此同一张图、同一组参数每次生成结果完全一致。
- 生成流程：整幅图统计背景与主色 → 限色出候选色 → 卡通平涂 / 写实蛇形误差扩散 → 相近色合并、小连通域与散点清理；卡通模式额外保护眼睛、描边等小面积深色特征。
- Artkal S 系列色号与色值来自 [Bitbead 公开色卡](https://www.bitbead.app/zh/colors/artkal)（CC BY 4.0）；切换品牌时，跨品牌色号按加权 RGB 最近色匹配，仅供参考。
- 图片生成图纸时，应用会按每个拼豆格对应的原图区域采样，而不是只读取单个像素。
- JSON 编辑记录用于恢复可编辑项目，不是通用图片格式。
- 应用以桌面端使用为主，并针对不同屏幕比例、分辨率和浏览器缩放做了响应式布局处理。

## 贡献者

感谢每一位让这个项目变得更好的人：

- [@RunicBean](https://github.com/RunicBean)：编辑器快捷键、独立操作工具栏、画布已用色号面板（[PR #1](https://github.com/Jett-Wu/Perler_Beads_Generator/pull/1)）

欢迎提交 Issue 或 Pull Request 一起改进。

---

# Perler Beads Generator

Version 1.1.0 · Forked from [Jett-Wu/Perler_Beads_Generator](https://github.com/Jett-Wu/Perler_Beads_Generator) · this repo can deploy itself with the GitHub Pages workflow below

Upload a photo, get it quantized to real bead color codes, then keep editing cell by cell like a drawing app, organize layers, preview the finished piece in 3D, and export high-resolution charts plus a per-color shopping list. Conversion, editing, and export all run locally in the browser; images are never uploaded.

What this fork adds on top of upstream:

- **A reworked color pipeline**: nearest-color matching and delta reporting go through CIEDE2000 with an exact 24-bit RGB cache, and color limiting uses fixed-seed Lab clustering, so the same image with the same settings always produces the same pattern. It ships with a reproducible old-vs-new regression suite (8 samples × 2 styles).
- **Features for the real bead workflow**: stock mode (generate only with colors you own, substitute the closest available one and show its ΔE00), per-color build progress, and a source-vs-pattern compare view.
- **A redesigned dark workspace**: board-width-aware layout, gradient theme, and tighter side panels.

![Perler Beads Generator workspace](docs/realistic-workspace.png)

## Highlights

- **Image-to-pattern conversion** that samples the source area covered by each bead cell, with cartoon / realistic styles, color limits, tolerance, and background removal. Cartoon mode keeps small dark features such as eyes and outlines, and tall images are shrunk to the board ratio up front so they never have to be resampled afterwards.
- **Pegboard and finished size** with presets such as 29×29 / 52×52 / 78×78 / 104×104, each labeled with how many boards it needs, plus custom board specs and bead diameter (2.6mm mini / 5mm midi) that convert the grid into a finished size in centimeters. When the board size changes, any available source image is re-run through the exact same conversion pipeline instead of stretching already-quantized cells.
- **Three real palettes**: MARD Basic 221, MARD Complete 291, and Artkal S-series 176 (5mm midi), with brand switching, color groups, recent colors, and fast selection.
- **Editing tools**: pencil, eraser, fill, clear (same color / connected block), recolor, eyedropper, move, copy, paste, mirror, shapes, and text, including horizontal / vertical text with size and spacing controls.
- **Layer workflow**: add, hide, lock, rename, duplicate, drag to reorder, current-layer-only view, and per-layer usage counting.
- **Portrait helpers**: automatic background removal, face-based auto framing with headroom / zoom / offset controls, plus a reference image layer with opacity, position, and scale for tracing.
- **Active-layer adjustments**: brightness, contrast, saturation, temperature, hue, invert, grayscale, black-white, similar-color cleanup, and color limits, all undoable.
- **Live 3D preview** with midi beads, varnish highlights, and soft shadows, following the round / square bead display mode, with an enlarged viewer.
- **Usage statistics** by color with custom beads-per-pack and estimated packs, plus a +10% stock suggestion to cover dropped beads and ironing loss, scoped to the current layer or all layers, exportable to Excel / CSV for shopping.
- **Stock mode and substitutions**: generate using only the colors you own; missing ones are replaced by the closest bead in stock, with the ideal code and its ΔE00 grade listed in the usage table (≤2 is barely visible, >12 is worth restocking).
- **Per-color progress**: tick off finished beads color by color; progress survives a refresh so you can resume a half-built piece.
- **Compare with the source**: view the pattern side by side with the original or as a translucent overlay to check fidelity.
- **High-resolution exports**: PNG / PDF charts (PDF can paginate automatically per pegboard, each page labeled with its board position and that page's color codes and bead counts), Excel usage workbooks, and JSON edit records that can be imported back for further editing.
- **Local and offline**: conversion, editing, and export all happen in the browser; source images are kept in IndexedDB and drafts autosave across refreshes; the build ships its own dependencies with no CDN, so it runs offline; export credits are handled by a client-side redemption code.

## Gallery

### Realistic Style

| Source | Workspace | Exported Pattern |
| --- | --- | --- |
| <img src="docs/realistic-source.jpg" alt="Realistic source image" width="150"> | <img src="docs/realistic-workspace.png" alt="Realistic style workspace" width="390"> | <img src="docs/realistic-pattern.png" alt="Realistic exported pattern" width="390"> |

### Cartoon Style

| Source | Workspace | Exported Pattern |
| --- | --- | --- |
| <img src="docs/cartoon-source.png" alt="Cartoon source image" width="150"> | <img src="docs/cartoon-workspace.png" alt="Cartoon style workspace" width="390"> | <img src="docs/cartoon-pattern.png" alt="Cartoon exported pattern" width="390"> |

### Blank Workspace

![Blank workspace](docs/blank-workspace.png)

## Local Development

```bash
npm install
npm run dev
```

Default preview URL:

```text
http://127.0.0.1:5174/
```

## Build

```bash
npm run build
```

Build output:

```text
generated/dist/
```

## Regression Tests

Color and conversion changes are covered by headless scripts:

```bash
node --expose-gc scripts/regression/algorithm-comparison.mjs   # 8 samples × 2 styles, old vs new
node --expose-gc scripts/regression/robustness.mjs             # large images, extreme options, edge inputs, exports
node scripts/regression/image-to-beads.mjs                     # conversion snapshot
node scripts/regression/lab-thresholds.mjs                     # CIEDE2000 threshold calibration
```

The comparison script rebuilds the previous algorithm from a pinned baseline commit (`24307d7`, override with `PERLER_BASELINE_REV`) and reports color count, bead count, mean / p95 ΔE00, isolated beads, dark-feature hit rate, median time, and peak heap; a metric that regresses past its threshold fails the run.

## GitHub Pages Deployment

This project includes a GitHub Pages deployment workflow:

```text
.github/workflows/deploy.yml
```

Deployment steps:

1. Push to the `main` branch.
2. Open `Settings -> Pages` in the GitHub repository.
3. Set `Build and deployment` to `GitHub Actions`.
4. Every push to `main` will build and deploy the site automatically.

## Alibaba Cloud Deployment

```bash
npm run build
```

Upload `generated/dist/` (for example to `/var/www/pindou`) and serve it with Nginx:

```nginx
server {
  listen 80;
  server_name your.domain;
  root /var/www/pindou;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location ~* \.(js|css|png|jpg|svg|woff2)$ {
    expires 7d;
  }
}
```

The root path shows the landing page; "开始制作" opens the editor at `#app`.

### Redemption codes

```bash
node scripts/generate-codes.cjs 50   # 50 codes, one per line
```

- Each code unlocks one high-resolution export; redeemed codes are stored in the buyer's browser.
- Edit the sales channel and price copy in `src/product.ts` before going live.
- Validation is client-side only: it stops typos and casual guessing, not a determined attacker. Add a backend if you need stronger enforcement.

## Project Structure

```text
.github/workflows/
  deploy.yml              # GitHub Pages build and deployment workflow

docs/
  realistic-workspace.png # README hero image, realistic workspace
  realistic-pattern.png   # Realistic exported pattern
  realistic-source.jpg    # Realistic source image
  cartoon-workspace.png   # Cartoon workspace
  cartoon-pattern.png     # Cartoon exported pattern
  cartoon-source.png      # Cartoon source image
  blank-workspace.png     # Blank workspace preview
  gap-analysis.md         # Gap and opportunity list vs other bead tools

scripts/
  clean-dist.cjs          # Cleans generated/dist
  post-build.cjs          # Copies styles/vendor files and fixes built imports
  write-html.cjs          # Writes the static HTML used by GitHub Pages
  dev-server.cjs          # Local static preview server
  generate-codes.cjs      # Generates redemption codes
  regression/
    algorithm-comparison.mjs # Old vs new algorithm, 8 samples × 2 styles
    robustness.mjs           # Large images, extreme options, edge inputs, exports
    image-to-beads.mjs       # Conversion snapshot
    lab-thresholds.mjs       # CIEDE2000 threshold calibration
    fixtures/                # Sample images (low/high saturation, shadows, skin, line art, photos)
    lib/                     # Minimal PNG decoder and baseline loader

src/
  App.tsx                 # App state, layout, panels, and main interactions
  LandingPage.tsx         # Landing page: intro, features, pricing, FAQ
  ProductShell.tsx        # Switches between landing page and editor
  UnlockDialog.tsx        # Redemption code dialog
  license.ts              # Code validation and export credits
  product.ts              # Price and sales channel copy
  WorkspaceCanvas.tsx     # 2D editor canvas, tools, reference image, copy/move/text logic
  CompareDialog.tsx       # Side-by-side / overlay compare with the source image
  ThreePreview.tsx        # 3D bead preview
  imageToBeads.ts         # Image-to-bead conversion (sampling, clustering, dithering, dark-feature protection)
  palette.ts              # MARD / Artkal palettes, groups, and CIEDE2000 color matching
  project.ts              # Project data, layers, autosave, and import compatibility
  sourceImage.ts          # Keeps the source image in IndexedDB so a resize can re-run the conversion
  cutout.ts               # Portrait background removal (MediaPipe, fully local)
  autoframe.ts            # Face detection and automatic portrait framing
  exporters.ts            # PNG / PDF charts (with optional per-board pagination), Excel usage, and JSON export
  stock.ts                # Owned colors, substitution grades, and local storage
  usage.ts                # Usage summary, substitutions, and isolated bead detection
  types.ts                # Shared TypeScript types
  styles.css              # Global styles
  main.tsx                # React entry

generated/
  .gitkeep                # Keeps the folder; build output and local caches are ignored

index.html                # Development HTML entry
package.json              # Scripts and dependencies
tsconfig.json             # TypeScript config
tsconfig.build.json       # Build output config
```

## Stack

- React
- TypeScript
- Three.js
- Canvas API

## Notes

- MARD palette colors are used for matching and display. Real bead colors may vary by batch, lighting, and screen calibration.
- Nearest-color matching and delta reporting use CIEDE2000 with a Lab cache and an exact 24-bit RGB cache; color limiting uses fixed-seed k-means++ clustering in Lab, so the same image and settings always yield the same pattern.
- Conversion pipeline: whole-image background and dominant-color statistics → color limiting → cartoon flat fill or serpentine Floyd–Steinberg for realistic → similar-color merge, tiny-region and speckle cleanup; cartoon mode additionally protects small dark features such as eyes and outlines.
- Artkal S-series codes and hex values come from the [public Bitbead color chart](https://www.bitbead.app/en/colors/artkal) (CC BY 4.0). Cross-brand codes are matched to the nearest color in the other palette and are reference-only.
- Image conversion samples the image area covered by each bead cell instead of reading only a single pixel.
- JSON edit records are for restoring editable projects, not for general image exchange.
- The app is desktop-first and includes responsive layout handling for different screen ratios, resolutions, and browser zoom levels.

## Contributors

Thanks to everyone who makes this project better:

- [@RunicBean](https://github.com/RunicBean): editor keyboard shortcuts, a separate action toolbar, and the on-canvas color usage panel ([PR #1](https://github.com/Jett-Wu/Perler_Beads_Generator/pull/1))

Issues and pull requests are welcome.
