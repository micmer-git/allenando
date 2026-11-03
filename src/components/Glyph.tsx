import type { Glyph as G } from '@/game/achievements';

/** Le icone dei traguardi: tratto da 1,8 su 24, come quelle della barra in basso. */
const PATHS: Record<G, string[]> = {
  km: ['M5 19c3-8 11-6 14-14', 'M5 19h3M19 5v3'],
  salita: ['M3 19 9.5 8l3.5 6 2.5-3.5L21 19Z'],
  volata: ['M4 12h10M4 7h7M4 17h7', 'M14 6l6 6-6 6'],
  gpm: ['M4 20 10 9l3 5 2-3 5 9Z', 'M10 9V3l5 2-5 2'],
  crono: ['M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'M12 9v4l3 2M10 2h4'],
  gruppo: ['M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M3 20c0-3 2.5-5 5-5s5 2 5 5M11 20c0-3 2.5-5 5-5s5 2 5 5'],
  luna: ['M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z'],
  pioggia: ['M7 15a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.4 1.6A3.5 3.5 0 0 1 17 15Z', 'M8 18l-1 3M12 18l-1 3M16 18l-1 3'],
  alba: ['M4 18h16M7 18a5 5 0 0 1 10 0', 'M12 7V4M5.6 10.6 4 9M18.4 10.6 20 9'],
  fiamma: ['M12 21c-4 0-6-2.8-6-6 0-4 4-6 4-10 3 2 5 4.5 5 7 1-1 1.5-2 1.5-3 1.6 1.6 1.5 3.6 1.5 6 0 3.2-2 6-6 6Z'],
  stella: ['m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z'],
  mappa: ['M3 6.5 8.5 4l7 2.5L21 4v13.5L15.5 20l-7-2.5L3 20Z', 'M8.5 4v13.5M15.5 6.5V20'],
  fulmine: ['M13 2 4 14h7l-1 8 9-12h-7Z'],
  coppa: ['M7 4h10v5a5 5 0 0 1-10 0Z', 'M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8'],
  goccia: ['M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11Z'],
  campana: ['M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15Z', 'M10 21h4M12 3v2'],
  maglia: ['M8.2 3.5 10 3q2 2 4 0l1.8.5L21 7.5 19 11l-2-1.4V21H7V9.6L5 11 3 7.5Z', 'M7 12.5h10'],
  ingranaggio: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1'],
};

export function Glyph({ name, className, size = 24 }: { name: G; className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

/** Una moneta d'oro, per i saldi e i prezzi. */
export function Coin({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="#ffc814" stroke="#b8860b" strokeWidth="1.2" />
      <path d="M5 10.5 7 6.5l1.4 2.2 1-1.4 1.6 3.2Z" fill="#16130a" />
    </svg>
  );
}
