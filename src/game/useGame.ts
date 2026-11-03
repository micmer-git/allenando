import { create } from 'zustand';
import { EMPTY_PROGRESS, levelOf, loadProgress, saveProgress, type WorldProgress } from '@/open/progress';
import { buy as buyItem, equip as equipItem, loadCareer, normalize, saveCareer, EMPTY_CAREER, type Career } from './career';
import { lookOf } from './kit';
import type { Look } from './look';

/**
 * Lo stato del gioco per le pagine: carriera (oro, guardaroba, traguardi) e progressi del
 * mondo (punti e livello). Si carica una volta, alla prima pagina che lo chiede.
 */
interface GameState {
  ready: boolean;
  career: Career;
  progress: WorldProgress;
  hydrate: () => Promise<void>;
  /** compra: ritorna il motivo se non si può */
  buy: (id: string) => Promise<string | null>;
  equip: (id: string) => Promise<void>;
  setCareer: (c: Career) => Promise<void>;
  setProgress: (p: WorldProgress) => Promise<void>;
}

let loading: Promise<void> | null = null;

export const useGame = create<GameState>((set, get) => ({
  ready: false,
  career: normalize(EMPTY_CAREER),
  progress: EMPTY_PROGRESS,
  hydrate() {
    if (!loading) {
      loading = Promise.all([loadCareer(), loadProgress()])
        .then(([career, progress]) => set({ career, progress, ready: true }))
        .catch(() => set({ ready: true }));
    }
    return loading;
  },
  async buy(id) {
    const { career, progress } = get();
    const r = buyItem(career, id, levelOf(progress.xp).level);
    if (!r.ok) return r.why;
    const next = equipItem(r.next, id);
    set({ career: next });
    await saveCareer(next);
    return null;
  },
  async equip(id) {
    const next = equipItem(get().career, id);
    set({ career: next });
    await saveCareer(next);
  },
  async setCareer(c) {
    set({ career: c });
    await saveCareer(c);
  },
  async setProgress(p) {
    set({ progress: p });
    await saveProgress(p);
  },
}));

/** L'aspetto del ciclista con quello che indossa adesso. */
export function useLook(): Look {
  const equipped = useGame((s) => s.career.equipped);
  return lookOf(equipped);
}
