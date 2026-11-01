import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Field, TextInput, Toggle, Wordmark } from '@/components/ui';
import { DEFAULT_PROFILE } from '@/domain/types';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';

export function OnboardingPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const complete = useApp((s) => s.completeOnboarding);
  const [name, setName] = useState('');
  const [weight, setWeight] = useState(String(DEFAULT_PROFILE.weightKg));
  const [ftp, setFtp] = useState(String(DEFAULT_PROFILE.ftp));
  const [maxHr, setMaxHr] = useState(String(DEFAULT_PROFILE.maxHr));
  const [camilla, setCamilla] = useState(true);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await complete(
      {
        ...DEFAULT_PROFILE,
        name: name.trim() || 'Atleta',
        weightKg: clamp(Number(weight), 35, 180, DEFAULT_PROFILE.weightKg),
        ftp: clamp(Number(ftp), 50, 550, DEFAULT_PROFILE.ftp),
        maxHr: clamp(Number(maxHr), 120, 230, DEFAULT_PROFILE.maxHr),
        onboarded: true,
      },
      camilla,
    );
    navigate('/');
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 py-8" data-testid="onboarding">
      <Wordmark />
      <p className="mt-10 text-sm font-semibold uppercase tracking-[0.18em] text-muted">{t('onboarding.kicker')}</p>
      <h1 className="mt-2 font-display text-6xl leading-none tracking-tight">{t('onboarding.title')}</h1>
      <p className="mt-4 text-lg leading-relaxed text-muted">{t('onboarding.lead')}</p>
      <BikeMark />
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <Field label={t('onboarding.name')}>
          <TextInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('onboarding.namePlaceholder')}
            autoComplete="given-name"
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
        <Toggle
          checked={camilla}
          onChange={setCamilla}
          label={t('onboarding.camilla')}
          hint={t('onboarding.camillaHint')}
          testId="onboarding-camilla"
        />
        <Button type="submit" data-testid="onboarding-start" className="mt-2 w-full">
          {t('onboarding.enter')}
        </Button>
      </form>
    </main>
  );
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function BikeMark() {
  return (
    <svg viewBox="0 0 280 92" className="mt-6 h-24 w-full" aria-hidden="true">
      <circle cx="58" cy="62" r="22" fill="none" stroke="currentColor" strokeWidth="4" />
      <circle cx="168" cy="62" r="22" fill="none" stroke="currentColor" strokeWidth="4" />
      <path d="M58 62 92 32h46l30 30M92 32l18 30M138 32l28-16h-36" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <rect x="188" y="40" width="62" height="28" rx="8" fill="var(--camilla)" />
      <circle cx="206" cy="70" r="8" fill="currentColor" />
      <circle cx="236" cy="70" r="8" fill="currentColor" />
      <circle cx="220" cy="50" r="7" fill="#f3c3a8" />
    </svg>
  );
}
