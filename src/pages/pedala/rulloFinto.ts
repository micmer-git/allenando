import { useSyncExternalStore } from 'react';
import { bluetoothSupport } from '@/bluetooth/support';
import type { Capacita, Rullo, Tipo } from '@/ride/contract';
import { useApp } from '@/store/useApp';

/*
 * PONTE PROVVISORIO, finché la pista U-motore non consegna `src/sim/rullo.ts` (M0): la stessa
 * forma (`useRullo`, `rullo`, `tipiAmmessi`, `puoPedalare`), niente Bluetooth vero. Il rullo
 * finto si accende solo con localStorage['orobia.collaudo'] = 'rullo' | 'potenza' | 'cardio'
 * (piano U, A23). Si toglie al merge di M0.
 */

const NIENTE: Capacita = { pendenza: false, erg: false, potenza: false, cardio: false, cadenza: false };

const FINTI: Record<string, { nome: string; sa: Capacita }> = {
  rullo: { nome: 'Wahoo KICKR', sa: { pendenza: true, erg: true, potenza: true, cardio: false, cadenza: true } },
  potenza: { nome: 'Assioma DUO', sa: { pendenza: false, erg: false, potenza: true, cardio: false, cadenza: true } },
  cardio: { nome: 'HRM-Pro', sa: { pendenza: false, erg: false, potenza: false, cardio: true, cadenza: false } },
};

function collaudo(): string | null {
  try {
    return localStorage.getItem('orobia.collaudo');
  } catch {
    return null;
  }
}

function supporto(): Rullo['supporto'] {
  const s = bluetoothSupport();
  return s.available ? 'si' : s.reason === 'ios' ? 'ios' : 'manca';
}

let stato: Omit<Rullo, 'prova'> = { stato: 'mai', supporto: 'si', nome: null, ricordato: null, sa: NIENTE };
let pronto = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
function set(next: Partial<typeof stato>) {
  stato = { ...stato, ...next };
  emit();
}
function init() {
  if (pronto) return;
  pronto = true;
  const finto = FINTI[collaudo() ?? ''];
  stato = finto ? { stato: 'collegato', supporto: 'si', nome: finto.nome, ricordato: finto.nome, sa: finto.sa } : { ...stato, supporto: supporto() };
}

function provaDiScheda(): boolean {
  try {
    if (new URLSearchParams(location.search).get('prova') === '1') sessionStorage.setItem('orobia.prova', '1');
    return sessionStorage.getItem('orobia.prova') === '1';
  } catch {
    return false;
  }
}

export function useRullo(): Rullo {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => {
      init();
      return stato;
    },
  );
  const provaAccesa = useApp((a) => (a.settings as { prova?: boolean }).prova === true) || provaDiScheda();
  return { ...s, prova: provaAccesa && !s.sa.potenza };
}

export const rullo = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async collega(_tutti?: boolean): Promise<void> {
    init();
    const finto = FINTI[collaudo() ?? ''];
    if (finto) {
      set({ stato: 'collegato', nome: finto.nome, ricordato: finto.nome, sa: finto.sa });
      return;
    }
    set({ stato: 'cerco' });
    try {
      const bt = (navigator as Navigator & { bluetooth?: { requestDevice(o: unknown): Promise<{ name?: string }> } }).bluetooth;
      if (!bt) throw new Error('niente Bluetooth');
      const dev = await bt.requestDevice({ acceptAllDevices: true });
      set({ stato: 'collegato', nome: dev.name ?? 'Rullo', ricordato: dev.name ?? 'Rullo', sa: FINTI.rullo.sa });
    } catch (e) {
      set({ stato: e instanceof DOMException && e.name === 'NotFoundError' ? 'mai' : 'fallito' });
    }
  },
  ricollega(): Promise<void> {
    return rullo.collega();
  },
  async aggiungiCardio(): Promise<void> {
    set({ sa: { ...stato.sa, cardio: true } });
  },
  scollega(): void {
    set({ stato: 'mai', nome: null, sa: NIENTE });
  },
};

/** Piano U, A8: cosa sa fare quello che è collegato decide i tipi. */
export function tipiAmmessi(r: Rullo): Tipo[] {
  if (r.sa.erg) return ['libera', 'fissa', 'allenamento'];
  if (r.sa.potenza) return ['libera', 'allenamento'];
  if (r.prova) return ['libera', 'fissa', 'allenamento'];
  return [];
}

export function puoPedalare(r: Rullo): boolean {
  return tipiAmmessi(r).length > 0;
}
