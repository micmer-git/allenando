import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Field, TextInput, Wordmark } from '@/components/ui';
import { parseNumberInput } from '@/domain/format';
import { DEFAULT_PROFILE, PROFILE_LIMITS as LIMITS } from '@/domain/types';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';
import { useWorldManifests, WorldArt } from '@/components/WorldPicker';
import { lastWorld, rememberWorld, WORLD_CATALOG } from '@/open/worlds';

/** La schermata vera del 3D per la carta del mondo (R9); chi non ce l'ha ancora (il Sellaronda, finché S2 non consegna) usa la sagoma. */
const WORLD_PHOTO: Record<string, string> = { bergamo: `${import.meta.env.BASE_URL}mondi/bergamo.jpg` };
import { cn } from '@/lib/cn';

export function OnboardingPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const complete = useApp((s) => s.completeOnboarding);
  const [name, setName] = useState('');
  const [weight, setWeight] = useState(String(DEFAULT_PROFILE.weightKg));
  const [ftp, setFtp] = useState(String(DEFAULT_PROFILE.ftp));
  const [world, setWorld] = useState(lastWorld);
  const manifests = useWorldManifests();
  // un mondo che non c'è non si sceglie (R6): se era l'ultimo ricordato si torna a Bergamo
  const missing = (id: string) => manifests[id] === null;
  const chosen = missing(world) ? 'bergamo' : world;

  async function submit(event: FormEvent) {
    event.preventDefault();
    rememberWorld(chosen);
    await complete({
        ...DEFAULT_PROFILE,
        name: name.trim() || 'Atleta',
        weightKg: parseNumberInput(weight, LIMITS.weightKg[0], LIMITS.weightKg[1], DEFAULT_PROFILE.weightKg),
        ftp: Math.round(parseNumberInput(ftp, LIMITS.ftp[0], LIMITS.ftp[1], DEFAULT_PROFILE.ftp)),
        onboarded: true,
      });
    const next = (location.state as { next?: string } | null)?.next;
    navigate(next && next.startsWith('/') && next !== '/start' ? next : '/', { replace: true });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.75rem,env(safe-area-inset-top))]" data-testid="onboarding">
      <Wordmark />
      <h1 className="mt-8 font-display text-[52px] leading-[0.92] tracking-tight">{t('onboarding.title')}</h1>
      {/* da dove si comincia: due mondi, una figura ciascuno; si cambia quando si vuole da Dove */}
      <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-muted">Da dove cominci</p>
      <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Mondo" data-testid="onboarding-worlds">
        {WORLD_CATALOG.map((w) => (
          <button
            key={w.id}
            type="button"
            role="radio"
            aria-checked={chosen === w.id}
            aria-disabled={missing(w.id) || undefined}
            onClick={() => !missing(w.id) && setWorld(w.id)}
            className={cn('overflow-hidden rounded-2xl border text-left', chosen === w.id ? 'border-accent bg-elev2' : 'border-line bg-elev', missing(w.id) && 'opacity-70')}
            data-testid={`onboarding-world-${w.id}`}
            data-state={missing(w.id) ? 'presto' : 'pronto'}
          >
            {WORLD_PHOTO[w.id] ? <img src={WORLD_PHOTO[w.id]} alt="" className="block aspect-[16/9] w-full object-cover" width={640} height={360} /> : <WorldArt id={w.id} className="block aspect-[16/9] w-full" />}
            <span className="block px-3 py-2">
              <span className="flex items-baseline gap-1.5">
                <span className="min-w-0 font-display text-lg leading-tight">{w.name}</span>
                {missing(w.id) ? <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-muted">Presto</span> : null}
              </span>
              <span className="block text-xs leading-snug text-muted">{w.blurb}</span>
            </span>
          </button>
        ))}
      </div>
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
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('onboarding.weight')}>
            <TextInput inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} data-testid="onboarding-weight" />
          </Field>
          <Field label={t('onboarding.ftp')}>
            <TextInput inputMode="numeric" value={ftp} onChange={(event) => setFtp(event.target.value)} data-testid="onboarding-ftp" />
          </Field>
        </div>
        <Button type="submit" data-testid="onboarding-start" className="mt-1 w-full">
          {t('onboarding.enter')}
        </Button>
      </form>
    </main>
  );
}
