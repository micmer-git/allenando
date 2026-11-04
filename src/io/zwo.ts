import { XMLParser } from 'fast-xml-parser';
import type { Workout, WorkoutStep } from '@/domain/types';
import { downloadText, safeFileName } from '@/lib/download';

/**
 * Gli allenamenti di Zwift (.zwo): si importano come schemi tuoi e si esportano per Zwift.
 *
 * Un .zwo è XML: `<workout_file>` con nome, descrizione e un `<workout>` di blocchi in ordine.
 * Potenze in frazione della FTP (0.88 = 88%). I blocchi che si leggono:
 * - `Warmup`, `Cooldown`, `Ramp`: da `PowerLow` a `PowerHigh` (anche in discesa, come Zwift);
 * - `SteadyState` (e `SolidState`): `Power`, o la media di `PowerLow` e `PowerHigh`;
 * - `IntervalsT`: `Repeat` volte `OnDuration` a `OnPower` e `OffDuration` a `OffPower`;
 * - `FreeRide` e `MaxEffort`: in Zwift si pedala a sensazione, qui l'ERG vuole un numero:
 *   diventano un tratto facile al 55% e uno scatto al 150%.
 * `Cadence` (e `CadenceResting` nel recupero) diventa la cadenza consigliata. Le scritte a tempo
 * (`textevent`) si lasciano fuori.
 */

export const FREE_RIDE_PCT = 55;
export const MAX_EFFORT_PCT = 150;

type Node = Record<string, unknown> & { ':@'?: Record<string, string> };

const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', trimValues: true, parseAttributeValue: false });

function tagOf(n: Node): string | null {
  return Object.keys(n).find((k) => k !== ':@' && k !== '#text') ?? null;
}

function childrenOf(n: Node | undefined): Node[] {
  const tag = n ? tagOf(n) : null;
  const v = tag ? n![tag] : null;
  return Array.isArray(v) ? (v as Node[]) : [];
}

function textOf(list: Node[], tag: string): string {
  const n = list.find((x) => tagOf(x)?.toLowerCase() === tag);
  const t = childrenOf(n).find((x) => '#text' in x)?.['#text'];
  return t == null ? '' : String(t).trim();
}

/** Un numero dagli attributi, ignorando le maiuscole (i file a mano scrivono «power» o «Power»). */
function num(attrs: Record<string, string>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const hit = Object.keys(attrs).find((a) => a.toLowerCase() === k.toLowerCase());
    if (hit == null) continue;
    const v = Number(attrs[hit]);
    if (Number.isFinite(v)) return v;
  }
  return undefined;
}

/** Frazione della FTP → percento; sopra 5 è già in watt (qualche file lo fa). */
function power(v: number | undefined): { pct?: number; watts?: number } {
  if (v == null) return {};
  return v > 5 ? { watts: Math.round(v) } : { pct: Math.round(v * 1000) / 10 };
}

function labelFor(pct: number | undefined): string {
  if (pct == null) return 'work';
  if (pct < 60) return 'rec';
  if (pct < 76) return 'z2';
  return 'work';
}

export class ZwoError extends Error {}

/** Da testo .zwo a un allenamento tuo. Lancia ZwoError se il file non è un allenamento. */
export function parseZwo(text: string, id = `zwo-${crypto.randomUUID()}`): Workout {
  let doc: Node[];
  try {
    doc = parser.parse(text.replace(/^﻿/, '')) as Node[];
  } catch {
    throw new ZwoError('xml');
  }
  const root = doc.find((n) => tagOf(n)?.toLowerCase() === 'workout_file');
  if (!root) throw new ZwoError('root');
  const head = childrenOf(root);
  const sport = textOf(head, 'sporttype');
  if (sport && sport.toLowerCase() !== 'bike') throw new ZwoError('sport');
  const body = childrenOf(head.find((n) => tagOf(n)?.toLowerCase() === 'workout'));
  const steps: WorkoutStep[] = [];
  const used = new Map<string, number>();
  const push = (base: string, s: Omit<WorkoutStep, 'id' | 'name'>) => {
    if (!(s.durationSec >= 1)) return;
    const k = used.get(base) ?? 0;
    used.set(base, k + 1);
    const name = k ? `${base}-${k}` : base;
    const step: WorkoutStep = { id: name, name, durationSec: s.durationSec };
    if (s.powerPct != null) step.powerPct = s.powerPct;
    if (s.powerEndPct != null && s.powerEndPct !== s.powerPct) step.powerEndPct = s.powerEndPct;
    if (s.powerWatts != null) step.powerWatts = s.powerWatts;
    if (s.powerEndWatts != null && s.powerEndWatts !== s.powerWatts) step.powerEndWatts = s.powerEndWatts;
    if (s.cadence) step.cadence = Math.round(s.cadence);
    steps.push(step);
  };
  for (const n of body) {
    const tag = tagOf(n)?.toLowerCase();
    const a = n[':@'] ?? {};
    const dur = Math.round(num(a, 'Duration') ?? 0);
    const cadence = num(a, 'Cadence');
    if (tag === 'warmup' || tag === 'cooldown' || tag === 'ramp') {
      const lo = power(num(a, 'PowerLow', 'Power'));
      const hi = power(num(a, 'PowerHigh', 'PowerLow', 'Power'));
      push(tag === 'warmup' ? 'warmup' : tag === 'cooldown' ? 'cooldown' : 'ramp', { durationSec: dur, powerPct: lo.pct, powerEndPct: hi.pct, powerWatts: lo.watts, powerEndWatts: hi.watts, cadence });
    } else if (tag === 'steadystate' || tag === 'solidstate') {
      const lo = num(a, 'PowerLow');
      const hi = num(a, 'PowerHigh');
      const p = power(num(a, 'Power') ?? (lo != null && hi != null ? (lo + hi) / 2 : (lo ?? hi)));
      push(labelFor(p.pct), { durationSec: dur, powerPct: p.pct, powerWatts: p.watts, cadence });
    } else if (tag === 'intervalst') {
      const reps = Math.max(1, Math.round(num(a, 'Repeat') ?? 1));
      const on = power(num(a, 'OnPower', 'PowerOnHigh', 'PowerOnLow'));
      const off = power(num(a, 'OffPower', 'PowerOffHigh', 'PowerOffLow'));
      const onDur = Math.round(num(a, 'OnDuration') ?? 0);
      const offDur = Math.round(num(a, 'OffDuration') ?? 0);
      for (let r = 0; r < reps; r++) {
        push('work', { durationSec: onDur, powerPct: on.pct, powerWatts: on.watts, cadence });
        push('rec', { durationSec: offDur, powerPct: off.pct, powerWatts: off.watts, cadence: num(a, 'CadenceResting') });
      }
    } else if (tag === 'freeride' || tag === 'freeridenoerg') {
      push('rec-libero', { durationSec: dur, powerPct: FREE_RIDE_PCT, cadence });
    } else if (tag === 'maxeffort') {
      push('work-max', { durationSec: dur, powerPct: MAX_EFFORT_PCT });
    }
  }
  if (steps.length === 0) throw new ZwoError('vuoto');
  const name = textOf(head, 'name') || 'Allenamento da Zwift';
  // la descrizione di un .zwo è il copione dei blocchi, quasi sempre in inglese: si dice da dove viene
  const author = textOf(head, 'author');
  const description = author ? `Da un file .zwo · ${author}` : 'Da un file .zwo';
  return { id, builtin: false, kind: 'custom', name, description, steps };
}

// ---------- esportare ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Percento o watt di un passo → frazione della FTP per Zwift. */
function frac(pct: number | undefined, watts: number | undefined, ftp: number): number {
  const v = watts != null ? watts / ftp : (pct ?? 0) / 100;
  return Math.round(v * 1000) / 1000;
}

/** Un allenamento come file .zwo per Zwift (le potenze in frazione della FTP data). */
export function workoutToZwo(workout: Workout, title: string, ftp: number, description = workout.description ?? ''): string {
  const s = workout.steps;
  const lines: string[] = [];
  const cad = (c?: number) => (c ? ` Cadence="${c}"` : '');
  let i = 0;
  while (i < s.length) {
    const st = s[i];
    const a = frac(st.powerPct, st.powerWatts, ftp);
    const ramps = st.powerEndPct != null || st.powerEndWatts != null;
    if (ramps) {
      const b = frac(st.powerEndPct ?? st.powerPct, st.powerEndWatts ?? (st.powerEndPct == null ? st.powerWatts : undefined), ftp);
      const tag = i === 0 && b > a ? 'Warmup' : i === s.length - 1 && b < a ? 'Cooldown' : 'Ramp';
      lines.push(`<${tag} Duration="${st.durationSec}" PowerLow="${a}" PowerHigh="${b}"${cad(st.cadence)}/>`);
      i++;
      continue;
    }
    // coppie lavoro/recupero uguali, di fila: un IntervalsT
    const nx = s[i + 1];
    if (nx && nx.powerEndPct == null && nx.powerEndWatts == null) {
      let reps = 1;
      const same = (x: WorkoutStep | undefined, y: WorkoutStep) =>
        !!x && x.durationSec === y.durationSec && x.powerPct === y.powerPct && x.powerWatts === y.powerWatts && x.cadence === y.cadence && x.powerEndPct == null && x.powerEndWatts == null;
      while (same(s[i + reps * 2], st) && same(s[i + reps * 2 + 1], nx)) reps++;
      if (reps >= 2 && frac(nx.powerPct, nx.powerWatts, ftp) < a) {
        lines.push(
          `<IntervalsT Repeat="${reps}" OnDuration="${st.durationSec}" OffDuration="${nx.durationSec}" OnPower="${a}" OffPower="${frac(nx.powerPct, nx.powerWatts, ftp)}"${cad(st.cadence)}${nx.cadence ? ` CadenceResting="${nx.cadence}"` : ''}/>`,
        );
        i += reps * 2;
        continue;
      }
    }
    lines.push(`<SteadyState Duration="${st.durationSec}" Power="${a}"${cad(st.cadence)}/>`);
    i++;
  }
  return [
    '<workout_file>',
    '    <author>OROBIA</author>',
    `    <name>${esc(title)}</name>`,
    `    <description>${esc(description)}</description>`,
    '    <sportType>bike</sportType>',
    '    <tags/>',
    '    <workout>',
    ...lines.map((l) => `        ${l}`),
    '    </workout>',
    '</workout_file>',
    '',
  ].join('\n');
}

export function downloadZwo(workout: Workout, title: string, ftp: number): void {
  downloadText(safeFileName(title, 'zwo'), workoutToZwo(workout, title, ftp), 'application/xml');
}

/** Importa i file scelti: ognuno buono diventa uno schema tuo. Torna la riga da mostrare. */
export async function importZwoFiles(files: FileList | readonly File[] | null, save: (w: Workout) => Promise<void>): Promise<string> {
  const list = files ? [...files] : [];
  const ok: string[] = [];
  const bad: string[] = [];
  for (const f of list) {
    try {
      const w = parseZwo(await f.text());
      await save(w);
      ok.push(w.name ?? f.name);
    } catch {
      bad.push(f.name);
    }
  }
  const parts: string[] = [];
  if (ok.length === 1) parts.push(`Importato «${ok[0]}»: è fra i tuoi.`);
  else if (ok.length > 1) parts.push(`Importati ${ok.length} allenamenti: sono fra i tuoi.`);
  if (bad.length) parts.push(`${bad.length === 1 ? `«${bad[0]}» non è` : `${bad.length} file non sono`} un allenamento .zwo per la bici.`);
  return parts.join(' ') || 'Nessun file scelto.';
}
