// SEGNAPOSTO: lo sostituisce l'anteprima 3D del ramo del ciclista (claude/allenando-ciclista-03-11-26).
import { BikeArt, HelmetArt, JerseyArt } from './KitArt';
import type { Look } from '@/game/look';

export function RiderPreview({ look, className }: { look: Look; className?: string; spin?: boolean; pedaling?: boolean }) {
  return (
    <div className={`grid grid-cols-[1fr_1.3fr_1.6fr] items-center gap-1 px-3 ${className ?? ''}`}>
      <HelmetArt look={look} className="w-full" />
      <JerseyArt look={look} className="w-full" />
      <BikeArt look={look} className="w-full" />
    </div>
  );
}
