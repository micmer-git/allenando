import { useId } from 'react';
import type { Item } from '@/game/kit';
import type { Look, Pattern } from '@/game/look';

/**
 * I disegni 2D del guardaroba, per le carte del negozio: maglia vista di fronte coi suoi dieci
 * disegni, casco di profilo con le lenti, bici di profilo col telaio e i cerchi. Sono SVG
 * piccoli e senza 3D, così una griglia di trenta pezzi scorre liscia anche sul telefono.
 */

const JERSEY = 'M31 13 43 9q7 7 14 0l12 4 19 15-8 15-8-6v51q-22 5-44 0V37l-8 6-8-15Z';

function PatternFill({ pattern, color, id }: { pattern: Pattern; color: string; id: string }) {
  switch (pattern) {
    case 'fascia':
      return <rect x="0" y="44" width="100" height="13" fill={color} />;
    case 'righe':
      return (
        <g fill={color}>
          {Array.from({ length: 12 }, (_, i) => (
            <rect key={i} x="0" y={12 + i * 7.5} width="100" height="3" />
          ))}
        </g>
      );
    case 'cerchi':
      return (
        <g fill={color}>
          {Array.from({ length: 5 }, (_, i) => (
            <rect key={i} x="0" y={20 + i * 18} width="100" height="9" />
          ))}
        </g>
      );
    case 'pois':
      return (
        <g fill={color}>
          {Array.from({ length: 9 }, (_, r) =>
            Array.from({ length: 9 }, (_, c) => <circle key={`${r}-${c}`} cx={8 + c * 11 + (r % 2) * 5.5} cy={14 + r * 10} r="3.3" />),
          )}
        </g>
      );
    case 'chevron':
      return <path d="M20 30 50 56 80 30v12L50 68 20 42Z" fill={color} />;
    case 'sfumato':
      return (
        <>
          <defs>
            <linearGradient id={`${id}g`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor={color} />
              <stop offset="0.75" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="100" height="100" fill={`url(#${id}g)`} />
        </>
      );
    case 'spalle':
      return <path d="M0 0h100v34H72v4L80 43 88 28 69 13 57 9q-7 7-14 0L31 13 12 28l8 15 8-6v-3H0Z" fill={color} />;
    case 'diagonale':
      return <path d="M10 8h22l60 84H70Z" fill={color} />;
    case 'quadri':
      return (
        <g fill={color}>
          {Array.from({ length: 12 }, (_, r) =>
            Array.from({ length: 12 }, (_, c) => ((r + c) % 2 ? <rect key={`${r}-${c}`} x={c * 8.5} y={r * 8.5} width="8.5" height="8.5" /> : null)),
          )}
        </g>
      );
    default:
      return null;
  }
}

export function JerseyArt({ look, className }: { look: Pick<Look, 'jersey' | 'accent' | 'pattern'>; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <clipPath id={`${id}c`}>
          <path d={JERSEY} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        <rect width="100" height="100" fill={look.jersey} />
        <PatternFill pattern={look.pattern} color={look.accent} id={id} />
        {/* ombra laterale: la maglia ha un volume */}
        <path d="M28 37v51q-3-1-4-1V44Z" fill="#000" opacity="0.18" />
        <path d="M72 37v51q3-1 4-1V44Z" fill="#000" opacity="0.18" />
      </g>
      <path d={JERSEY} fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="1.2" />
      {/* collo e zip */}
      <path d="M43 9q7 7 14 0" fill="none" stroke="#000" strokeOpacity="0.4" strokeWidth="1.6" />
      <path d="M50 16v40" stroke="#000" strokeOpacity="0.28" strokeWidth="1.2" />
    </svg>
  );
}

export function HelmetArt({ look, className }: { look: Pick<Look, 'helmet' | 'glasses'>; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path d="M14 58c0-22 18-36 40-36 18 0 32 10 34 28l-2 8c-6-3-14-4-22-2l-8 4H22c-5 0-8-1-8-2Z" fill={look.helmet} stroke="#000" strokeOpacity="0.35" strokeWidth="1.2" />
      {/* prese d'aria */}
      <g fill="#000" opacity="0.28">
        <path d="M30 34q6-5 12-6l-2 9q-5 1-10 4Z" />
        <path d="M48 27q8-1 14 1l-3 9q-5-2-11-1Z" />
        <path d="M67 31q7 3 11 9l-7 4q-3-4-8-6Z" />
      </g>
      <path d="M22 62h34" stroke="#16130a" strokeWidth="3" strokeLinecap="round" />
      {look.glasses ? <path d="M30 66c6-3 22-3 30 0l-2 7c-8 2-18 2-26 0Z" fill={look.glasses} stroke="#000" strokeOpacity="0.5" strokeWidth="1" /> : null}
      <path d="M34 62q4 14 14 18" fill="none" stroke="#16130a" strokeWidth="2" opacity="0.6" />
    </svg>
  );
}

function Wheel({ cx, rim, rear }: { cx: number; rim: Look['rim']; rear: boolean }) {
  const disc = rim === 'lenticolare' && rear;
  const deep = rim === 'alto' || (rim === 'lenticolare' && !rear);
  return (
    <g>
      <circle cx={cx} cy="66" r="21" fill={disc ? '#24252a' : 'none'} stroke="#16130a" strokeWidth="4" />
      {!disc ? <circle cx={cx} cy="66" r={deep ? 15 : 18} fill="none" stroke="#3a3b40" strokeWidth={deep ? 7 : 2} /> : <circle cx={cx} cy="66" r="12" fill="none" stroke="#3a3b40" strokeWidth="1" />}
      {!disc && !deep
        ? Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2;
            return <path key={i} d={`M${cx} 66l${Math.cos(a) * 17} ${Math.sin(a) * 17}`} stroke="#6b6c70" strokeWidth="0.6" />;
          })
        : null}
      <circle cx={cx} cy="66" r="2.2" fill="#6b6c70" />
    </g>
  );
}

export function BikeArt({ look, className }: { look: Pick<Look, 'frame' | 'frameAccent' | 'rim'>; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <Wheel cx={24} rim={look.rim} rear />
      <Wheel cx={78} rim={look.rim} rear={false} />
      {/* telaio: carro, piantone, obliquo, orizzontale, sterzo, forcella */}
      <g stroke={look.frame} strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M24 66 44 67 38 36 24 66" />
        <path d="M44 67 70 38 38 36" />
        <path d="M70 38 72 32M70 38l8 28" />
      </g>
      <path d="M41 51 60 49" stroke={look.frameAccent} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M38 36 36 30" stroke="#2a2b30" strokeWidth="2.4" />
      <path d="M30 29h11" stroke="#16130a" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M72 32h7q4 0 4 4 0 4-4 5" fill="none" stroke="#16130a" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="44" cy="67" r="5" fill="none" stroke="#3a3b40" strokeWidth="1.8" />
    </svg>
  );
}

export function ItemArt({ item, base, className }: { item: Item; base: Look; className?: string }) {
  const look = { ...base, ...item.look };
  if (item.slot === 'maglia') return <JerseyArt look={look} className={className} />;
  if (item.slot === 'casco') return <HelmetArt look={look} className={className} />;
  return <BikeArt look={look} className={className} />;
}
