import { getColor } from './palette';
import { loadSourceImage } from './sourceImage';
import type { BeadProject } from './types';

const { useEffect, useRef, useState } = React;

type CompareLabels = {
  title: string;
  hint: string;
  side: string;
  overlay: string;
  opacity: string;
  close: string;
  missing: string;
  original: string;
  pattern: string;
};

type Props = {
  /** 刚导入的图片文件；没有时回退到 IndexedDB 里保存的生成原图。 */
  file: File | null;
  project: BeadProject;
  labels: CompareLabels;
  onClose: () => void;
};

/** 原图与生成图对比：并排看构图/配色差异，叠加看每一格的偏差。 */
export default function CompareDialog({ file, project, labels, onClose }: Props) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<'side' | 'overlay'>('side');
  const [opacity, setOpacity] = useState(0.55);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    const load = async () => {
      if (file) {
        objectUrl = URL.createObjectURL(file);
        if (!cancelled) setImageUrl(objectUrl);
        return;
      }
      const stored = await loadSourceImage();
      if (!stored || cancelled) return;
      objectUrl = URL.createObjectURL(stored.blob);
      setImageUrl(objectUrl);
    };
    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  const beadCount = project.cells.filter(Boolean).length;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="compare-backdrop" role="dialog" aria-modal="true" aria-label={labels.title} onClick={onClose}>
      <div className="compare-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="compare-header">
          <div>
            <strong>{labels.title}</strong>
            <small>{labels.hint}</small>
          </div>
          <button type="button" className="compare-close" onClick={onClose} aria-label={labels.close}>
            ×
          </button>
        </header>

        <div className="compare-toolbar">
          <div className="compare-modes">
            <button type="button" className={mode === 'side' ? 'active' : ''} onClick={() => setMode('side')}>
              {labels.side}
            </button>
            <button type="button" className={mode === 'overlay' ? 'active' : ''} onClick={() => setMode('overlay')}>
              {labels.overlay}
            </button>
          </div>
          {mode === 'overlay' && (
            <label className="compare-opacity">
              <span>{labels.opacity}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(opacity * 100)}
                onChange={(event) => setOpacity(Number(event.target.value) / 100)}
              />
              <strong>{Math.round(opacity * 100)}%</strong>
            </label>
          )}
        </div>

        {!imageUrl ? (
          <p className="compare-empty">{labels.missing}</p>
        ) : mode === 'side' ? (
          <div className="compare-side">
            <figure>
              <figcaption>{labels.original}</figcaption>
              <div className="compare-pane">
                <img src={imageUrl} alt={labels.original} />
              </div>
            </figure>
            <figure>
              <figcaption>
                {labels.pattern} · {project.width}×{project.height}
              </figcaption>
              <div className="compare-pane">
                <PatternCanvas project={project} />
              </div>
            </figure>
          </div>
        ) : (
          <figure className="compare-overlay">
            <div className="compare-pane compare-pane-overlay">
              <img src={imageUrl} alt={labels.original} />
              <div className="compare-layer" style={{ opacity }}>
                <PatternCanvas project={project} />
              </div>
            </div>
            <figcaption>
              {labels.pattern} · {beadCount} beads
            </figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}

function PatternCanvas({ project }: { project: BeadProject }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = project.width;
    canvas.height = project.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, project.width, project.height);
    for (let index = 0; index < project.cells.length; index += 1) {
      const id = project.cells[index];
      if (!id) continue;
      const color = getColor(id);
      if (!color) continue;
      context.fillStyle = color.hex;
      context.fillRect(index % project.width, Math.floor(index / project.width), 1, 1);
    }
  }, [project.cells, project.width, project.height]);

  return <canvas ref={canvasRef} className="compare-canvas" />;
}
