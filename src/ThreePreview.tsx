import * as THREE from 'three';
import { getColor } from './palette';
import type { BeadProject } from './types';

const { useEffect, useMemo, useRef, useState } = React;

// 实物拼豆尺寸：直径略大于间距，熨烫后豆子彼此贴近、边缘圆润。
const BEAD_RADIUS = 0.31;
const BEAD_HEIGHT = BEAD_RADIUS * 1.45;
const BEAD_HOLE_RADIUS = BEAD_RADIUS * 0.3;
const BEAD_SPACING = BEAD_RADIUS * 2 + 0.012;
const LAYER_LIFT = BEAD_HEIGHT;
const PREVIEW_BACKGROUND = 0x242422;

type PreviewRefs = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  root: THREE.Group;
  beads: THREE.Group;
  keyLight: THREE.DirectionalLight;
  frame: number;
  dragging: boolean;
  lastX: number;
  lastY: number;
};

type Props = {
  project: BeadProject;
  title: string;
  emptyLabel: string;
  closeLabel: string;
  expandLabel: string;
};

export default function ThreePreview({ project, title, emptyLabel, closeLabel, expandLabel }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const modalHostRef = useRef<HTMLDivElement | null>(null);
  const refs = useRef<PreviewRefs | null>(null);
  const controlsRef = useRef({
    yaw: -0.12,
    pitch: 0.86,
    distance: 18,
    minDistance: 4,
    maxDistance: 80,
    targetY: 0,
  });
  const [expanded, setExpanded] = useState(false);
  const beadCount = useMemo(
    () =>
      (project.layers ?? [])
        .filter((layer) => layer.visible)
        .reduce((sum, layer) => sum + (layer.cells ?? []).filter(Boolean).length, 0),
    [project.layers],
  );

  useEffect(() => {
    const host = expanded ? modalHostRef.current : hostRef.current;
    if (!host) return;
    const container = host;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 1000);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (error) {
      console.warn('3D preview could not start.', error);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(PREVIEW_BACKGROUND, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);

    // 柔和环境光：上方偏暖、下方偏冷，模拟室内漫反射。
    scene.add(new THREE.HemisphereLight(0xfff6e8, 0x2c2f36, 1.35));

    // 主光负责高光与投影，让豆子的塑料质感和中孔阴影更明显。
    const keyLight = new THREE.DirectionalLight(0xfff2e0, 2.5);
    keyLight.position.set(6, 13, 9);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.bias = -0.0006;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);
    scene.add(keyLight.target);

    // 侧后方补光，勾出豆子的轮廓与边缘高光。
    const rimLight = new THREE.DirectionalLight(0xa9c8ff, 1.15);
    rimLight.position.set(-9, 6, -10);
    scene.add(rimLight);

    // 正面弱填充光，避免孔洞与底边过黑。
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
    fillLight.position.set(-4, 5, 11);
    scene.add(fillLight);

    const root = new THREE.Group();
    scene.add(root);

    const beads = new THREE.Group();
    root.add(beads);

    const preview: PreviewRefs = {
      scene,
      camera,
      renderer,
      root,
      beads,
      keyLight,
      frame: 0,
      dragging: false,
      lastX: 0,
      lastY: 0,
    };
    refs.current = preview;

    function resize() {
      const width = Math.max(180, container.clientWidth);
      const height = Math.max(160, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      updateCamera(preview, controlsRef.current);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    function animate() {
      renderer.render(scene, camera);
      preview.frame = window.requestAnimationFrame(animate);
    }
    animate();

    function pointerDown(event: PointerEvent) {
      event.preventDefault();
      preview.dragging = true;
      preview.lastX = event.clientX;
      preview.lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    }

    function pointerMove(event: PointerEvent) {
      if (!preview.dragging) return;
      const dx = event.clientX - preview.lastX;
      const dy = event.clientY - preview.lastY;
      const controls = controlsRef.current;
      controls.yaw -= dx * 0.01;
      controls.pitch = wrapAngle(controls.pitch + dy * 0.008);
      preview.lastX = event.clientX;
      preview.lastY = event.clientY;
      updateCamera(preview, controls);
    }

    function pointerUp(event: PointerEvent) {
      preview.dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    }

    function wheel(event: WheelEvent) {
      event.preventDefault();
      const controls = controlsRef.current;
      const zoomFactor = event.deltaY > 0 ? 1.1 : 0.9;
      controls.distance = clamp(controls.distance * zoomFactor, controls.minDistance, controls.maxDistance);
      updateCamera(preview, controls);
    }

    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', pointerUp);
    renderer.domElement.addEventListener('wheel', wheel, { passive: false });

    return () => {
      window.cancelAnimationFrame(preview.frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerUp);
      renderer.domElement.removeEventListener('wheel', wheel);
      container.removeChild(renderer.domElement);
      disposeGroup(beads);
      renderer.dispose();
      refs.current = null;
    };
  }, [expanded]);

  useEffect(() => {
    const preview = refs.current;
    if (!preview) return;

    disposeGroup(preview.beads);
    preview.beads.clear();

    const spacing = BEAD_SPACING;
    const byColor = new Map<string, Array<[number, number, number]>>();
    const visibleLayers = (project.layers ?? []).filter((layer) => layer.visible);
    visibleLayers.forEach((layer, layerIndex) => {
      (layer.cells ?? []).forEach((colorId, index) => {
        if (!colorId) return;
        const x = index % project.width;
        const y = Math.floor(index / project.width);
        const items = byColor.get(colorId) ?? [];
        items.push([x, y, layerIndex]);
        byColor.set(colorId, items);
      });
    });

    const beadGeometry = createBeadGeometry(project.settings.beadDisplayMode === 'pixel' ? 'square' : 'round');
    const matrix = new THREE.Matrix4();
    const instanceColor = new THREE.Color();
    byColor.forEach((items, colorId) => {
      const color = getColor(colorId);
      if (!color) return;
      // 塑料质感的拼豆：低粗糙度 + 清漆层，配合灯光形成柔和的高光；颜色由实例色控制。
      const material = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.42,
        metalness: 0,
        clearcoat: 0.55,
        clearcoatRoughness: 0.35,
        ior: 1.5,
      });
      const mesh = new THREE.InstancedMesh(beadGeometry, material, items.length);
      // 实例散布整个画布，关闭视锥裁剪避免被误裁。
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const baseColor = new THREE.Color(color.hex);
      items.forEach(([x, y, layerIndex], itemIndex) => {
        matrix.makeTranslation(
          (x - (project.width - 1) / 2) * spacing,
          layerIndex * LAYER_LIFT,
          (y - (project.height - 1) / 2) * spacing,
        );
        mesh.setMatrixAt(itemIndex, matrix);
        // 每颗豆子做极轻微的明暗差异，避免整片颜色像贴图一样死板。
        const shade = 0.95 + hashNoise(x, y, layerIndex) * 0.1;
        instanceColor.copy(baseColor).multiplyScalar(shade);
        mesh.setColorAt(itemIndex, instanceColor);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      preview.beads.add(mesh);
    });
    if (byColor.size === 0) beadGeometry.dispose();

    const span = Math.max(project.width, project.height, 8) * spacing;

    // 底板：圆角、微光泽的拼豆板，接住豆子的投影。
    const plate = createPegboard(project.width * spacing, project.height * spacing);
    plate.position.y = -BEAD_HEIGHT / 2 - 0.02;
    preview.beads.add(plate);

    // 根据画布尺寸更新阴影相机范围，保证投影不丢。
    const reach = Math.max(span * 0.75, 6);
    const shadowCamera = preview.keyLight.shadow.camera;
    shadowCamera.left = -reach;
    shadowCamera.right = reach;
    shadowCamera.top = reach;
    shadowCamera.bottom = -reach;
    shadowCamera.near = 0.5;
    shadowCamera.far = reach * 4 + 30;
    shadowCamera.updateProjectionMatrix();

    const layerSpan = Math.max(0, visibleLayers.length - 1) * LAYER_LIFT;
    preview.keyLight.target.position.set(0, layerSpan / 2, 0);

    controlsRef.current.minDistance = Math.max(3.5, span * 0.35);
    controlsRef.current.maxDistance = Math.max(12, span * 3.8);
    controlsRef.current.distance = clamp(span * 1.25, controlsRef.current.minDistance, controlsRef.current.maxDistance);
    controlsRef.current.targetY = layerSpan / 2;
    updateCamera(preview, controlsRef.current);
  }, [project, expanded]);

  return (
    <>
      <div className="three-preview" ref={hostRef} aria-label="Live 3D bead preview">
        {beadCount === 0 && (
          <div className="three-preview-empty" aria-hidden="true">
            <div className="three-preview-empty-icon">
              <span />
              <span />
              <span />
              <span />
            </div>
            <p>{emptyLabel}</p>
          </div>
        )}
        <button className="preview-expand-button" title={expandLabel} onClick={() => setExpanded(true)}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M7.5 3.5H3.5v4M12.5 3.5h4v4M7.5 16.5H3.5v-4M12.5 16.5h4v-4" />
            <path d="M3.8 3.8l4.4 4.4M16.2 3.8l-4.4 4.4M3.8 16.2l4.4-4.4M16.2 16.2l-4.4-4.4" />
          </svg>
        </button>
      </div>
      {expanded && (
        <div className="three-preview-modal" role="dialog" aria-modal="true" aria-label={title}>
          <div className="three-preview-modal-panel">
            <div className="three-preview-modal-bar">
              <strong>{title}</strong>
              <button onClick={() => setExpanded(false)}>{closeLabel}</button>
            </div>
            <div className="three-preview-modal-stage" ref={modalHostRef}>
              {beadCount === 0 && (
                <div className="three-preview-empty modal-empty" aria-hidden="true">
                  <div className="three-preview-empty-icon">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <p>{emptyLabel}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function updateCamera(preview: PreviewRefs, controls: { yaw: number; pitch: number; distance: number; targetY: number }) {
  const horizontal = Math.cos(controls.pitch) * controls.distance;
  preview.camera.up.set(0, horizontal >= 0 ? 1 : -1, 0);
  preview.camera.position.set(
    Math.sin(controls.yaw) * horizontal,
    controls.targetY + Math.sin(controls.pitch) * controls.distance,
    Math.cos(controls.yaw) * horizontal,
  );
  preview.camera.lookAt(0, controls.targetY, 0);
}

function wrapAngle(value: number): number {
  const fullTurn = Math.PI * 2;
  return ((((value + Math.PI) % fullTurn) + fullTurn) % fullTurn) - Math.PI;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 稳定的小范围伪随机，让同一颗豆子每次渲染的明暗一致。 */
function hashNoise(x: number, y: number, layerIndex: number): number {
  let hash = (x * 73856093) ^ (y * 19349663) ^ (layerIndex * 83492791);
  hash = (hash ^ (hash >>> 13)) * 1274126177;
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
}

/** 带中孔的立体豆子：外形挤出 + 倒角，熨烫后边缘圆润的观感。 */
function createBeadGeometry(shapeMode: 'round' | 'square') {
  const outer = new THREE.Shape();
  if (shapeMode === 'square') {
    const half = BEAD_RADIUS * 0.94;
    const radius = BEAD_RADIUS * 0.24;
    outer.moveTo(-half + radius, -half);
    outer.lineTo(half - radius, -half);
    outer.quadraticCurveTo(half, -half, half, -half + radius);
    outer.lineTo(half, half - radius);
    outer.quadraticCurveTo(half, half, half - radius, half);
    outer.lineTo(-half + radius, half);
    outer.quadraticCurveTo(-half, half, -half, half - radius);
    outer.lineTo(-half, -half + radius);
    outer.quadraticCurveTo(-half, -half, -half + radius, -half);
  } else {
    outer.absarc(0, 0, BEAD_RADIUS, 0, Math.PI * 2, false);
  }

  const hole = new THREE.Path();
  hole.absarc(0, 0, BEAD_HOLE_RADIUS, 0, Math.PI * 2, true);
  outer.holes.push(hole);

  const bevelThickness = BEAD_HEIGHT * 0.14;
  const geometry = new THREE.ExtrudeGeometry(outer, {
    depth: Math.max(0.01, BEAD_HEIGHT - bevelThickness * 2),
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.035,
    bevelThickness,
    curveSegments: shapeMode === 'square' ? 6 : 24,
  });
  geometry.center();
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** 圆角拼豆底板，尺寸略大于图案，四周留出一点边。 */
function createPegboard(contentWidth: number, contentHeight: number): THREE.Mesh {
  const width = contentWidth + 1.5;
  const height = contentHeight + 1.5;
  const radius = 0.55;
  const halfW = width / 2;
  const halfH = height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-halfW + radius, -halfH);
  shape.lineTo(halfW - radius, -halfH);
  shape.quadraticCurveTo(halfW, -halfH, halfW, -halfH + radius);
  shape.lineTo(halfW, halfH - radius);
  shape.quadraticCurveTo(halfW, halfH, halfW - radius, halfH);
  shape.lineTo(-halfW + radius, halfH);
  shape.quadraticCurveTo(-halfW, halfH, -halfW, halfH - radius);
  shape.lineTo(-halfW, -halfH + radius);
  shape.quadraticCurveTo(-halfW, -halfH, -halfW + radius, -halfH);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.28,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.05,
    bevelThickness: 0.05,
    curveSegments: 10,
  });
  geometry.center();
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    color: 0xcfc9bd,
    roughness: 0.88,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function disposeGroup(group: THREE.Group) {
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (!disposedGeometries.has(object.geometry)) {
      object.geometry.dispose();
      disposedGeometries.add(object.geometry);
    }
    disposeMaterial(object.material);
  });
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose());
    return;
  }
  material.dispose();
}
