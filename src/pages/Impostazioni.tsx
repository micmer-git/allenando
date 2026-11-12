import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BackLink, Button, Segmented, TextInput } from '@/components/ui';
import { Chevron } from '@/components/Glyph';
import { useWorldManifests } from '@/components/WorldPicker';
import { pesoLeggero, scaricaIntero, scaricaLeggero, togliIntero, usePacco } from '@/lib/rete';
import { parseNumberInput } from '@/domain/format';
import { PROFILE_LIMITS, type Quality, type Settings } from '@/domain/types';
import { formatBytes } from '@/open/offline';
import { WORLD_CATALOG, type WorldInfo, type WorldManifest } from '@/open/worlds';
import { PROVA_KEY, rullo, useRullo } from '@/sim/rullo';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';
import { cn } from '@/lib/cn';

/*
 * Impostazioni (piano U, A20; wireframe A4, G3): profilo e impostazioni in una pagina. Tu, Rullo e
 * sensori, Modalità prova (vive solo qui), Mondi senza rete, Grafica, Aspetto, Meteo e luce, Dati.
 * Ogni campo si salva quando lo lasci.
 */

const show = (value: number): string => String(value).replace('.', ',');

export function ImpostazioniPage() {
  const { t } = useI18n();
  const profile = useApp((s) => s.profile);
  const settings = useApp((s) => s.settings);
  const updateProfile = useApp((s) => s.updateProfile);
  const updateSettings = useApp((s) => s.updateSettings);
  const resetAll = useApp((s) => s.resetAll);
  const navigate = useNavigate();
  const r = useRullo();
  const manifests = useWorldManifests();
  const [name, setName] = useState(profile.name);
  const [weight, setWeight] = useState(show(profile.weightKg));
  const [ftp, setFtp] = useState(show(profile.ftp));
  const [maxHr, setMaxHr] = useState(show(profile.maxHr));
  const [resting, setResting] = useState(show(profile.restingHr));
  const [lthr, setLthr] = useState(profile.thresholdHr ? show(profile.thresholdHr) : '');
  const [bike, setBike] = useState(show(profile.bikeWeightKg));
  const [cda, setCda] = useState(show(profile.cda));
  const [crr, setCrr] = useState(show(profile.crr));
  const [saved, setSaved] = useState(false);
  const [armed, setArmed] = useState(false);
  const [usato, setUsato] = useState<number | null>(null);
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setUsato(e.usage ?? null)).catch(() => undefined);
  }, []);

  async function save() {
    const limit = (key: keyof typeof PROFILE_LIMITS, value: string, fallback: number) => parseNumberInput(value, PROFILE_LIMITS[key][0], PROFILE_LIMITS[key][1], fallback);
    const patch = {
      name: name.trim() || profile.name,
      weightKg: limit('weightKg', weight, profile.weightKg),
      ftp: Math.round(limit('ftp', ftp, profile.ftp)),
      maxHr: Math.round(limit('maxHr', maxHr, profile.maxHr)),
      restingHr: Math.round(limit('restingHr', resting, profile.restingHr)),
      thresholdHr: lthr.trim() ? Math.round(limit('thresholdHr', lthr, profile.maxHr)) : undefined,
      bikeWeightKg: limit('bikeWeightKg', bike, profile.bikeWeightKg),
      cda: limit('cda', cda, profile.cda),
      crr: limit('crr', crr, profile.crr),
    };
    await updateProfile(patch);
    // i campi mostrano il valore davvero salvato, anche se è stato riportato nei limiti
    setWeight(show(patch.weightKg));
    setFtp(show(patch.ftp));
    setMaxHr(show(patch.maxHr));
    setResting(show(patch.restingHr));
    setLthr(patch.thresholdHr != null ? show(patch.thresholdHr) : '');
    setBike(show(patch.bikeWeightKg));
    setCda(show(patch.cda));
    setCrr(show(patch.crr));
    setSaved(true);
  }
  const autosave = () => void save();
  const prova = settings.prova === true;
  const setProva = (on: boolean) => {
    if (!on) {
      try {
        sessionStorage.removeItem(PROVA_KEY);
      } catch {
        /* niente storage */
      }
    }
    void updateSettings({ prova: on });
  };
  const collegato = r.stato === 'collegato';
  const sa = [r.sa.pendenza && 'Pendenza', r.sa.erg && 'ERG', r.sa.potenza && 'Potenza', r.sa.cadenza && 'Cadenza', r.sa.cardio && 'Cardio'].filter(Boolean).join(' · ');

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-3 md:px-8 md:pt-8" data-testid="impostazioni">
      <header data-testid="page-header">
        <BackLink to="/tu" label="Tu" />
        <div className="mt-1 flex items-end justify-between gap-3">
          <h1 className="font-display text-4xl uppercase leading-[0.9]">Impostazioni</h1>
          {saved ? (
            <span className="text-sm font-semibold text-good" role="status" data-testid="profile-saved">
              {t('profile.saved')}
            </span>
          ) : null}
        </div>
      </header>

      <Sezione titolo="Tu">
        <div className="grid grid-cols-3 gap-2">
          <Numero label="Peso, kg" value={weight} onChange={setWeight} onBlur={autosave} mode="decimal" testId="impostazioni-peso" />
          <Numero label="FTP, W" value={ftp} onChange={setFtp} onBlur={autosave} mode="numeric" testId="impostazioni-ftp" />
          <Numero label="FC max" value={maxHr} onChange={setMaxHr} onBlur={autosave} mode="numeric" testId="impostazioni-fcmax" />
        </div>
        <details className="group mt-2 rounded-2xl border border-line px-3">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between font-semibold">
            Nome, cuore, fisica
            <Chevron className="shrink-0 text-muted transition group-open:rotate-180" />
          </summary>
          <div className="grid gap-2 pb-3 sm:grid-cols-2">
            <Numero label={t('onboarding.name')} value={name} onChange={setName} onBlur={autosave} mode="text" />
            <Numero label={t('profile.resting')} value={resting} onChange={setResting} onBlur={autosave} mode="numeric" />
            <Numero label={t('profile.lthr')} value={lthr} onChange={setLthr} onBlur={autosave} mode="numeric" />
            <Numero label={t('profile.bike')} value={bike} onChange={setBike} onBlur={autosave} mode="decimal" />
            <Numero label={t('profile.cda')} value={cda} onChange={setCda} onBlur={autosave} mode="decimal" />
            <Numero label={t('profile.crr')} value={crr} onChange={setCrr} onBlur={autosave} mode="decimal" />
          </div>
        </details>
      </Sezione>

      <Sezione titolo="Rullo e sensori">
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line" data-testid="impostazioni-rullo">
          <span className="min-w-0">
            <span className="flex items-center gap-2 font-semibold">
              <span aria-hidden="true" className={cn('h-2.5 w-2.5 shrink-0 rounded-full', collegato ? 'bg-good' : 'bg-line')} />
              {collegato ? r.nome ?? 'Rullo' : r.ricordato ?? 'Nessun rullo'}
            </span>
            <span className="block text-sm text-muted">{collegato ? sa || 'Collegato' : r.supporto === 'ios' ? 'Su iPhone passa da Bluefy' : r.supporto === 'manca' ? 'Questo browser non vede il Bluetooth' : 'Non collegato'}</span>
          </span>
          {collegato ? (
            <button type="button" className="h-11 shrink-0 rounded-full border border-line px-4 text-sm font-semibold" onClick={() => rullo.scollega()} data-testid="impostazioni-scollega">
              Scollega
            </button>
          ) : r.supporto === 'si' ? (
            <button type="button" className="h-11 shrink-0 rounded-full border border-line px-4 text-sm font-semibold" onClick={() => void (r.ricordato ? rullo.ricollega() : rullo.collega())} data-testid="impostazioni-collega">
              {r.ricordato ? 'Ricollega' : 'Collega'}
            </button>
          ) : null}
        </div>
        {collegato && !r.sa.cardio ? (
          <button type="button" className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-line text-left font-semibold" onClick={() => void rullo.aggiungiCardio()}>
            Aggiungi la fascia cardio <span aria-hidden="true" className="text-muted">›</span>
          </button>
        ) : null}
      </Sezione>

      <Sezione titolo="Modalità prova">
        <button type="button" role="switch" aria-checked={prova} onClick={() => setProva(!prova)} className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-line text-left" data-testid="impostazioni-prova">
          <span className="min-w-0">
            <span className="block font-semibold">Prova senza rullo</span>
            <span className="block text-sm text-muted">⚠ I giri di prova non vanno in classifica</span>
          </span>
          <Interruttore on={prova} />
        </button>
      </Sezione>

      <Sezione titolo="Mondi senza rete">
        {WORLD_CATALOG.map((w) => (
          <MondoRighe key={w.id} world={w} manifest={manifests[w.id]} />
        ))}
        {usato != null ? (
          <div className="flex min-h-12 items-center justify-between gap-3 text-sm">
            <span>Usato da OROBIA</span>
            <span className="num">{formatBytes(usato)}</span>
          </div>
        ) : null}
      </Sezione>

      <Sezione titolo="Grafica">
        <Segmented<Quality>
          label="Grafica"
          value={settings.quality}
          onChange={(quality) => void updateSettings({ quality })}
          options={[
            { value: 'low', label: t('quality.low') },
            { value: 'medium', label: t('quality.medium') },
            { value: 'high', label: t('quality.high') },
          ]}
          testId="impostazioni-grafica"
        />
      </Sezione>

      <Sezione titolo="Aspetto">
        <Segmented<'dark' | 'light'>
          label={t('profile.look')}
          value={settings.theme}
          onChange={(theme) => void updateSettings({ theme })}
          options={[
            { value: 'dark', label: t('theme.dark') },
            { value: 'light', label: t('theme.light') },
          ]}
        />
      </Sezione>

      <Sezione titolo="Meteo e luce">
        <Segmented<Settings['weather']>
          label="Meteo"
          value={settings.weather}
          onChange={(weather) => void updateSettings({ weather })}
          options={[
            { value: 'vero', label: 'Meteo vero' },
            { value: 'sereno', label: 'Sempre sereno' },
          ]}
        />
        <div className="mt-2">
          <Segmented<Settings['daytime']>
            label="Luce"
            value={settings.daytime}
            onChange={(daytime) => void updateSettings({ daytime })}
            options={[
              { value: 'vera', label: 'Ora vera' },
              { value: 'mattina', label: 'Mattina' },
              { value: 'mezzogiorno', label: 'Mezzodì' },
              { value: 'sera', label: 'Sera' },
            ]}
          />
        </div>
      </Sezione>

      <Sezione titolo="Dati">
        <details className="group rounded-2xl border border-danger/40 px-3" data-testid="profile-danger" onToggle={(e) => !(e.currentTarget as HTMLDetailsElement).open && setArmed(false)}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between font-semibold text-danger">
            {t('profile.danger')}
            <Chevron className="shrink-0 transition group-open:rotate-180" />
          </summary>
          <div className="pb-3">
            <p className="text-sm text-muted">{t('profile.resetHint')}</p>
            <Button
              variant={armed ? 'danger' : 'ghost'}
              className={cn('mt-3', !armed && 'text-danger!')}
              data-testid="profile-reset"
              onClick={() => {
                if (!armed) {
                  setArmed(true);
                  return;
                }
                void resetAll().then(() => navigate('/start'));
              }}
            >
              {armed ? t('profile.resetArmed') : t('profile.reset')}
            </Button>
          </div>
        </details>
      </Sezione>
    </main>
  );
}

function Sezione({ titolo, children }: { titolo: string; children: ReactNode }) {
  return (
    <section className="mt-6" data-testid={`sezione-${titolo}`}>
      <h2 className="eyebrow mb-2">{titolo}</h2>
      {children}
    </section>
  );
}

function Numero({ label, value, onChange, onBlur, mode, testId }: { label: string; value: string; onChange: (v: string) => void; onBlur: () => void; mode: 'decimal' | 'numeric' | 'text'; testId?: string }) {
  return (
    <label className="block rounded-2xl border border-line bg-elev px-3 pb-1 pt-2">
      <span className="block text-xs font-semibold text-muted">{label}</span>
      <TextInput inputMode={mode === 'text' ? undefined : mode} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} className="num h-10 border-0 bg-transparent px-0 font-semibold" data-testid={testId} />
    </label>
  );
}

function Interruttore({ on }: { on: boolean }) {
  return (
    <span className={cn('relative h-8 w-[52px] shrink-0 rounded-full transition', on ? 'bg-accent' : 'bg-elev2')} aria-hidden="true">
      <span className={cn('absolute top-1 h-6 w-6 rounded-full bg-white shadow transition', on ? 'left-[24px]' : 'left-1')} />
    </span>
  );
}

/** Un mondo: il pacco leggero e l'intero, con lo scarico che si ferma e riparte da dov'era (G3). */
function MondoRighe({ world, manifest }: { world: WorldInfo; manifest: WorldManifest | null | undefined }) {
  const pacco = usePacco(world.id);
  const ctrl = useRef<AbortController | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  if (manifest === null) return null;
  const leggeroB = manifest ? pesoLeggero(manifest) : 0;
  const tot = manifest ? formatBytes(manifest.bytes) : '';
  const scarico = pacco.stato === 'scarico';
  const pct = Math.round((pacco.progresso ?? 0) * 100);
  const avvia = (cosa: 'leggero' | 'intero') => {
    if (ctrl.current) return;
    const c = new AbortController();
    ctrl.current = c;
    setErrore(null);
    void (cosa === 'leggero' ? scaricaLeggero(world.id, c.signal) : scaricaIntero(world.id, c.signal))
      .catch((e: unknown) => !c.signal.aborted && setErrore(e instanceof Error ? e.message : 'Scarico interrotto'))
      .finally(() => {
        ctrl.current = null;
      });
  };
  const leggeroOk = pacco.stato === 'leggero' || pacco.stato === 'intero';
  const tasto = 'h-11 shrink-0 rounded-full border border-line px-4 text-sm font-semibold';
  return (
    <div className="border-b border-line py-1" data-testid={`impostazioni-mondo-${world.id}`} data-state={pacco.stato}>
      <p className="mt-1 font-semibold">{world.name}</p>
      <div className="flex min-h-12 items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[15px]">Leggero</span>
          <span className="num block text-sm text-muted">{`Strade, terreno lontano, nomi · ${formatBytes(leggeroB)}`}</span>
        </span>
        {leggeroOk ? (
          <span className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-xs font-semibold" data-testid={`impostazioni-leggero-${world.id}`}>
            ✓
          </span>
        ) : scarico ? null : (
          <button type="button" className={tasto} onClick={() => avvia('leggero')} disabled={!manifest} data-testid={`impostazioni-scarica-leggero-${world.id}`}>
            Scarica
          </button>
        )}
      </div>
      <div className="flex min-h-12 items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[15px]">Intero</span>
          <span className="num block text-sm text-muted">
            {errore ?? (scarico ? `Scarico · ${formatBytes((pacco.progresso ?? 0) * pacco.totale)} di ${tot}` : pacco.stato === 'intero' ? `Scaricato · ${tot}` : tot)}
          </span>
        </span>
        {scarico ? (
          <button type="button" className={tasto} onClick={() => ctrl.current?.abort()} data-testid={`impostazioni-ferma-${world.id}`}>
            Ferma
          </button>
        ) : pacco.stato === 'intero' ? (
          <button type="button" className={cn(tasto, 'text-muted')} onClick={() => void togliIntero(world.id)}>
            Togli
          </button>
        ) : (
          <button type="button" className={tasto} onClick={() => avvia('intero')} disabled={!manifest} data-testid={`impostazioni-scarica-${world.id}`}>
            Scarica
          </button>
        )}
      </div>
      {scarico ? (
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-elev2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Scarico di ${world.name}`}>
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}
