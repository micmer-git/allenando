import { useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Field, TextInput, Wordmark } from '@/components/ui';
import { MountainIcon, RideIcon, WorldIcon } from '@/components/Nav';
import { parseNumberInput } from '@/domain/format';
import { DEFAULT_PROFILE, PROFILE_LIMITS as LIMITS } from '@/domain/types';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';
import { WorldArt } from '@/components/WorldPicker';
import { lastWorld, rememberWorld, WORLD_CATALOG } from '@/open/worlds';
import { cn } from '@/lib/cn';

export function OnboardingPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const complete = useApp((s) => s.completeOnboarding);
  const [name, setName] = useState('');
  const [weight, setWeight] = useState(String(DEFAULT_PROFILE.weightKg));
  const [ftp, setFtp] = useState(String(DEFAULT_PROFILE.ftp));
  const [maxHr, setMaxHr] = useState(String(DEFAULT_PROFILE.maxHr));
  const [world, setWorld] = useState(lastWorld);

  async function submit(event: FormEvent) {
    event.preventDefault();
    rememberWorld(world);
    await complete({
        ...DEFAULT_PROFILE,
        name: name.trim() || 'Atleta',
        weightKg: parseNumberInput(weight, LIMITS.weightKg[0], LIMITS.weightKg[1], DEFAULT_PROFILE.weightKg),
        ftp: Math.round(parseNumberInput(ftp, LIMITS.ftp[0], LIMITS.ftp[1], DEFAULT_PROFILE.ftp)),
        maxHr: Math.round(parseNumberInput(maxHr, LIMITS.maxHr[0], LIMITS.maxHr[1], DEFAULT_PROFILE.maxHr)),
        onboarded: true,
      });
    const next = (location.state as { next?: string } | null)?.next;
    navigate(next && next.startsWith('/') && next !== '/start' ? next : '/', { replace: true });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.75rem,env(safe-area-inset-top))]" data-testid="onboarding">
      <Wordmark />
      <h1 className="mt-8 font-display text-[52px] leading-[0.92] tracking-tight">{t('onboarding.title')}</h1>
      {/* cosa c'è dentro, in tre righe: è tutto quello che serve sapere per entrare */}
      {/* da dove si comincia: due mondi, una figura ciascuno; si cambia quando si vuole da Mondo */}
      <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-muted">Da dove cominci</p>
      <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Mondo" data-testid="onboarding-worlds">
        {WORLD_CATALOG.map((w) => (
          <button
            key={w.id}
            type="button"
            role="radio"
            aria-checked={world === w.id}
            onClick={() => setWorld(w.id)}
            className={cn('overflow-hidden rounded-2xl border text-left', world === w.id ? 'border-accent bg-elev2' : 'border-line bg-elev')}
            data-testid={`onboarding-world-${w.id}`}
          >
            <WorldArt id={w.id} className="block aspect-[16/9] w-full" />
            <span className="block px-3 py-2">
              <span className="block font-display text-lg leading-tight">{w.name}</span>
              <span className="block text-xs leading-snug text-muted">{w.blurb}</span>
            </span>
          </button>
        ))}
      </div>
      <ul className="mt-4 divide-y divide-line border-y border-line">
        <Feature icon={<WorldIcon />} title="Due mondi in 3D" sub="Bergamo e le valli, il Sellaronda: incrocio per incrocio, passo per passo" />
        <Feature icon={<MountainIcon />} title="Salite vere" sub="Selvino, Mortirolo, Stelvio: tornanti e pendenze della strada" />
        <Feature icon={<RideIcon />} title="Col rullo o senza" sub="Rullo smart Bluetooth, o il simulatore" />
      </ul>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <Field label={t('onboarding.name')}>
          <TextInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('onboarding.namePlaceholder')}
            autoComplete="given-name"
            enterKeyHint="go"
            data-testid="onboarding-name"
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('onboarding.weight')}>
            <TextInput inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} data-testid="onboarding-weight" />
          </Field>
          <Field label={t('onboarding.ftp')}>
            <TextInput inputMode="numeric" value={ftp} onChange={(event) => setFtp(event.target.value)} data-testid="onboarding-ftp" />
          </Field>
          <Field label={t('onboarding.maxHr')}>
            <TextInput inputMode="numeric" value={maxHr} onChange={(event) => setMaxHr(event.target.value)} data-testid="onboarding-hr" />
          </Field>
        </div>
        <p className="-mt-2 text-sm text-muted">{t('onboarding.ftpHint')}</p>
        <Button type="submit" data-testid="onboarding-start" className="mt-1 w-full">
          {t('onboarding.enter')}
        </Button>
      </form>
    </main>
  );
}

function Feature({ icon, title, sub }: { icon: ReactNode; title: string; sub: string }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-elev2 text-accent">{icon}</span>
      <span className="min-w-0">
        <span className="block font-semibold leading-tight">{title}</span>
        <span className="block text-sm leading-snug text-muted">{sub}</span>
      </span>
    </li>
  );
}
