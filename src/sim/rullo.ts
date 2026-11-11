import { useSyncExternalStore } from 'react';
import { bluetoothSupport } from '@/bluetooth/support';
import { BluetoothTrainer, type Collaudo } from '@/bluetooth/trainer';
import { loadKv, saveKv } from '@/db/db';
import type { Capacita, Rullo, StatoRullo, Supporto, Tipo } from '@/ride/contract';
import { useApp } from '@/store/useApp';
import type { TrainerSnapshot } from './source';

/**
 * Il rullo dell'app (A6 del piano U): uno solo, non uno per corsa. Si collega da Pedala prima di
 * scegliere, resta fra una corsa e l'altra, e dopo un riavvio si ricollega in un tocco (o da solo,
 * se il browser ha `bluetooth.getDevices()`).
 *
 * Il simulatore non parte più da solo: è la Modalità prova, accesa in Impostazioni
 * (`settings.prova`) o per la scheda con `?prova=1`. Il rullo collegato vince sempre sulla prova.
 *
 * Il rullo finto dei collaudi (A23) si accende SOLO da `localStorage['orobia.collaudo']`
 * (`rullo`, `potenza`, `cardio`), che gli script mettono prima di caricare. Nessun link lo accende.
 */

export const COLLAUDO_KEY = 'orobia.collaudo';
/** la prova accesa per la scheda (sessionStorage), da `?prova=1` */
export const PROVA_KEY = 'orobia.prova';
/** il rullo ricordato, nel kv del database `allenando` */
export const RICORDATO_KEY = 'rullo';

type Lettore = Pick<Storage, 'getItem'>;

/** Il tipo di rullo finto dei collaudi, letto da uno storage (localStorage). */
export function collaudoDa(storage: Lettore | null | undefined): Collaudo | null {
  try {
    const v = storage?.getItem(COLLAUDO_KEY);
    return v === 'rullo' || v === 'potenza' || v === 'cardio' ? v : null;
  } catch {
    return null;
  }
}

/** Il rullo finto, se acceso: solo da localStorage, mai dal link. */
export function collaudoAttivo(): Collaudo | null {
  try {
    return typeof localStorage === 'undefined' ? null : collaudoDa(localStorage);
  } catch {
    return null;
  }
}

/** `?prova=1` accende la prova per la scheda, `?prova=0` la spegne. */
export function provaDaLink(search: string, session: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined): void {
  const v = new URLSearchParams(search).get('prova');
  if (v == null || !session) return;
  try {
    if (v === '1') session.setItem(PROVA_KEY, '1');
    else if (v === '0') session.removeItem(PROVA_KEY);
  } catch {
    /* niente storage: la prova resta quella delle Impostazioni */
  }
}

function provaDellaScheda(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(PROVA_KEY) === '1';
  } catch {
    return false;
  }
}

/** La Modalità prova: Impostazioni, o la scheda. */
export function provaAccesa(): boolean {
  return useApp.getState().settings.prova === true || provaDellaScheda();
}

/** Cosa sa fare quello che è collegato davvero (il simulatore non conta). */
export function capacitaDa(snap: TrainerSnapshot): Capacita {
  const on = snap.mode === 'bluetooth' && snap.status === 'connected';
  if (!on) return { pendenza: false, erg: false, potenza: false, cardio: false, cadenza: false };
  const s = snap.services;
  return {
    pendenza: !!snap.can?.sim,
    erg: !!snap.can?.erg,
    potenza: s.ftms || s.power,
    cardio: s.hr,
    cadenza: s.csc || s.power || s.ftms,
  };
}

export function statoDa(snap: TrainerSnapshot): StatoRullo {
  if (snap.mode === 'simulator') return 'mai';
  switch (snap.status) {
    case 'connecting':
      return 'cerco';
    case 'connected':
      return 'collegato';
    case 'disconnected':
      return 'perso';
    case 'failed':
      return 'fallito';
    default:
      return 'mai';
  }
}

export function supportoDa(collaudo: Collaudo | null): Supporto {
  if (collaudo) return 'si';
  const s = bluetoothSupport();
  return s.available ? 'si' : s.reason === 'ios' ? 'ios' : 'manca';
}

/** Lo stato del rullo come lo legge l'interfaccia. */
export function rulloDa(snap: TrainerSnapshot, extra: { supporto: Supporto; ricordato: string | null; prova: boolean }): Rullo {
  const sa = capacitaDa(snap);
  return {
    stato: statoDa(snap),
    supporto: extra.supporto,
    nome: snap.mode === 'bluetooth' && snap.status === 'connected' ? snap.deviceName : null,
    ricordato: extra.ricordato,
    sa,
    // A5: il rullo collegato vince sempre sulla prova
    prova: extra.prova && !sa.potenza,
  };
}

const TUTTI: Tipo[] = ['libera', 'fissa', 'allenamento', 'allora'];

/**
 * I tipi di attività che quello che è collegato permette (A8). `[]` = nessuna corsa.
 * Rullo con controllo: tutti. Misuratore di potenza o rullo senza controllo: Libera (senza
 * pendenza) e Allenamento a bersaglio (anche i watt di allora, a bersaglio). Solo cardio o
 * cadenza: niente. Prova: tutti.
 */
export function tipiAmmessi(r: Rullo): Tipo[] {
  if (r.sa.potenza) return r.sa.erg ? [...TUTTI] : ['libera', 'allenamento', 'allora'];
  if (r.prova) return [...TUTTI];
  return [];
}

export function puoPedalare(r: Rullo): boolean {
  return tipiAmmessi(r).length > 0;
}

// ---------- il rullo dell'app ----------

interface Ricordato {
  nome: string;
  id?: string;
}

let trainer: BluetoothTrainer | null = null;
let ricordato: Ricordato | null = null;
let started = false;
const listeners = new Set<() => void>();
let cache: { key: string; value: Rullo } | null = null;

function realPower(t: BluetoothTrainer): boolean {
  return capacitaDa(t.snapshot()).potenza;
}

function theTrainer(): BluetoothTrainer {
  if (!trainer) {
    // il simulatore solo con la prova accesa, e mai al posto di un rullo vero (A5)
    const t = new BluetoothTrainer({ simulatore: () => provaAccesa() && !realPower(t) });
    trainer = t;
  }
  return trainer;
}

function emit(): void {
  for (const l of listeners) l();
}

function start(): void {
  if (started) return;
  started = true;
  const t = theTrainer();
  t.subscribe(emit);
  let prova = provaAccesa();
  useApp.subscribe(() => {
    const now = provaAccesa();
    if (now !== prova) {
      prova = now;
      emit();
    }
  });
  if (typeof window !== 'undefined') {
    try {
      provaDaLink(window.location.search, sessionStorage);
    } catch {
      /* niente storage */
    }
  }
  void loadKv<Ricordato>(RICORDATO_KEY)
    .then((r) => {
      if (r && typeof r.nome === 'string' && r.nome) {
        ricordato = { nome: r.nome, id: typeof r.id === 'string' ? r.id : undefined };
        emit();
        void ricollegaDaSolo();
      }
    })
    .catch(() => undefined);
}

/** Lo stato del rullo adesso, fuori da React (le corse, le prove). */
export function rulloAdesso(): Rullo {
  start();
  const snap = theTrainer().snapshot();
  const value = rulloDa(snap, { supporto: supportoDa(collaudoAttivo()), ricordato: ricordato?.nome ?? null, prova: provaAccesa() });
  const key = JSON.stringify(value);
  if (cache && cache.key === key) return cache.value;
  cache = { key, value };
  return value;
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Lo stato del rullo, vivo, per l'interfaccia. */
export function useRullo(): Rullo {
  return useSyncExternalStore(subscribe, rulloAdesso, rulloAdesso);
}

async function ricorda(): Promise<void> {
  const t = theTrainer();
  const first = t.known[0];
  const nome = t.collaudo ? (t.snapshot().deviceName ?? 'Rullo di collaudo') : first?.name;
  if (!nome) return;
  ricordato = { nome, id: t.collaudo ? 'collaudo' : first?.id };
  emit();
  await saveKv(RICORDATO_KEY, ricordato).catch(() => undefined);
}

type ConDispositivi = Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> };

async function dispositivoNoto(): Promise<BluetoothDevice | null> {
  const bt = (typeof navigator === 'undefined' ? undefined : navigator.bluetooth) as ConDispositivi | undefined;
  if (!bt?.getDevices || !ricordato) return null;
  try {
    const list = await bt.getDevices();
    return list.find((d) => (ricordato?.id ? d.id === ricordato.id : d.name === ricordato?.nome)) ?? null;
  } catch {
    return null;
  }
}

/** All'avvio, se il browser ricorda il permesso: il rullo di ieri si ricollega senza tocchi. */
async function ricollegaDaSolo(): Promise<void> {
  if (collaudoAttivo()) return;
  const t = theTrainer();
  if (t.snapshot().status === 'connected' || t.snapshot().busy) return;
  const device = await dispositivoNoto();
  if (!device) return;
  try {
    await Promise.race([t.connectKnown(device), new Promise((_, reject) => setTimeout(() => reject(new Error('tempo')), 12_000))]);
  } catch {
    // in silenzio: resta «Ricollega», un tocco
    if (t.snapshot().status !== 'connected') t.release();
  }
}

export const rullo = {
  /** Da un tocco: il selettore del browser. `tutti`: ogni dispositivo, non solo i rulli. */
  async collega(tutti = false): Promise<void> {
    start();
    const t = theTrainer();
    const fake = collaudoAttivo();
    if (fake) {
      t.connectFake(fake);
      await ricorda();
      return;
    }
    try {
      await t.choose(tutti ? 'tutti' : 'sensori');
      await ricorda();
    } catch {
      // annullato o fallito: lo dice lo stato del rullo
    }
  },
  /** «Ricollega»: il dispositivo noto senza selettore, o il selettore filtrato sul nome. */
  async ricollega(): Promise<void> {
    start();
    const t = theTrainer();
    const fake = collaudoAttivo();
    if (fake) {
      t.connectFake(fake);
      await ricorda();
      return;
    }
    try {
      const device = await dispositivoNoto();
      if (device) {
        try {
          await t.connectKnown(device);
          return;
        } catch {
          /* fuori portata o permesso scaduto: il selettore */
        }
      }
      await t.choose(ricordato ? { nome: ricordato.nome } : 'sensori');
      await ricorda();
    } catch {
      // annullato o fallito: lo dice lo stato del rullo
    }
  },
  /** Una fascia cardio accanto al rullo. */
  async aggiungiCardio(): Promise<void> {
    start();
    if (collaudoAttivo()) return;
    try {
      await theTrainer().choose('cardio');
    } catch {
      // il rullo resta collegato; la fascia no
    }
  },
  scollega(): void {
    start();
    theTrainer().release();
  },
  /**
   * La sorgente della corsa: il rullo unico. Senza potenza vera e con la prova accesa diventa il
   * simulatore; con la prova spenta non lo è mai.
   */
  sorgente(): BluetoothTrainer {
    start();
    const t = theTrainer();
    if (!realPower(t) && provaAccesa()) {
      if (t.snapshot().mode !== 'simulator') void t.useSimulator();
    } else {
      t.stopSimulator();
    }
    return t;
  },
  /** Fine corsa: il rullo resta collegato e torna in piano; il simulatore si spegne. */
  riposa(): void {
    const t = theTrainer();
    t.rest();
    t.stopSimulator();
  },
};
