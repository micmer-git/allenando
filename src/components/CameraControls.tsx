import { ISO_ZOOM, type RideView } from '@/world/isometric';

export function CameraControls({
  view,
  change,
  zoom,
  setZoom,
  survey = false,
}: {
  view: RideView | 'strada';
  change: (v: RideView | 'strada') => void;
  zoom: number;
  setZoom: (z: number) => void;
  survey?: boolean;
}) {
  return (
    <div className="camera-controls" role="group" aria-label="Inquadratura">
      <div className="flex flex-wrap">
        <button type="button" aria-pressed={view === 'iso'} onClick={() => change('iso')}>
          Isometrica
        </button>
        <button type="button" aria-pressed={view === 'chase'} onClick={() => change('chase')}>
          Terza persona
        </button>
        {survey && (
          <button type="button" aria-pressed={view === 'strada'} onClick={() => change('strada')}>
            Strada
          </button>
        )}
      </div>
      {view === 'iso' && (
        <div className="flex items-center justify-center border-t border-line">
          <button type="button" aria-label="Riduci zoom" disabled={zoom === 0} onClick={() => setZoom(zoom - 1)}>
            −
          </button>
          <output aria-label="Zoom isometrico" className="num min-w-14 text-center">
            {Math.round(ISO_ZOOM[zoom] * 100)}%
          </output>
          <button
            type="button"
            aria-label="Aumenta zoom"
            disabled={zoom === ISO_ZOOM.length - 1}
            onClick={() => setZoom(zoom + 1)}
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}
