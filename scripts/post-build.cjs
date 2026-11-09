const fs = require('fs');
const path = require('path');

const root = process.cwd();
const dist = path.join(root, 'generated', 'dist');
const outSrc = path.join(dist, 'src');
const vendor = path.join(dist, 'vendor');

fs.mkdirSync(vendor, { recursive: true });
fs.copyFileSync(path.join(root, 'src', 'styles.css'), path.join(dist, 'styles.css'));
fs.copyFileSync(path.join(root, 'node_modules', 'react', 'umd', 'react.production.min.js'), path.join(vendor, 'react.production.min.js'));
fs.copyFileSync(path.join(root, 'node_modules', 'react-dom', 'umd', 'react-dom.production.min.js'), path.join(vendor, 'react-dom.production.min.js'));
fs.copyFileSync(path.join(root, 'node_modules', 'three', 'build', 'three.module.js'), path.join(vendor, 'three.module.js'));
fs.copyFileSync(path.join(root, 'node_modules', 'three', 'build', 'three.core.js'), path.join(vendor, 'three.core.js'));

// 人像相关模型（MediaPipe）资源全部本地自托管，避免运行时依赖境外 CDN。
copyMediaPipePackage('selfie_segmentation'); // 人像抠图
copyMediaPipePackage('face_detection'); // 人像自动取景

function copyMediaPipePackage(name) {
  const sourceDir = path.join(root, 'node_modules', '@mediapipe', name);
  const targetDir = path.join(vendor, name);
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of fs.readdirSync(sourceDir)) {
    if (!/\.(js|wasm|data|binarypb|tflite)$/.test(file)) continue;
    fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
  }
}

for (const filePath of walk(outSrc)) {
  if (!filePath.endsWith('.js')) continue;
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/from "(\.\/[^"]+)"|from '(\.\/[^']+)'/g, (match, doublePath, singlePath) => {
    const importPath = doublePath || singlePath;
    if (/\.(js|json|css)$/.test(importPath)) return match;
    const quote = doublePath ? '"' : "'";
    return `from ${quote}${importPath}.js${quote}`;
  });
  fs.writeFileSync(filePath, source);
}

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(filePath));
    else files.push(filePath);
  }
  return files;
}
