import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Field, Segmented, TextInput, Toggle } from '@/components/ui';
import type { Quality } from '@/domain/types';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';

export function ProfilePage() {
  const { t } = useI18n();
  const profile = useApp((s) => s.profile);
  const settings = useApp((s) => s.settings);
  const updateProfile = useApp((s) => s.updateProfile);
  const updateSettings = useApp((s) => s.updateSettings);
  const resetAll = useApp((s) => s.resetAll);
  const navigate = useNavigate();
  const [name, setName] = useState(profile.name);
  const [weight, setWeight] = useState(String(profile.weightKg));
  const [ftp, setFtp] = useState(String(profile.ftp));
  const [maxHr, setMaxHr] = useState(String(profile.maxHr));
  const [resting, setResting] = useState(String(profile.restingHr));
  const [lthr, setLthr] = useState(profile.thresholdHr ? String(profile.thresholdHr) : '');
  const [bike, setBike] = useState(String(profile.bikeWeightKg));
  const [cda, setCda] = useState(String(profile.cda));
  const [crr, setCrr] = useState(String(profile.crr));
  const [saved, setSaved] = useState(false);
  const [armed, setArmed] = useState(false);

  async function save() {
    await updateProfile({
      name: name.trim() || profile.name,
      weightKg: num(weight, profile.weightKg),
      ftp: num(ftp, profile.ftp),
      maxHr: num(maxHr, profile.maxHr),
      restingHr: num(resting, profile.restingHr),
      thresholdHr: lthr.trim() ? num(lthr, profile.maxHr) : undefined,
      bikeWeightKg: num(bike, profile.bikeWeightKg),
      cda: num(cda, profile.cda),
      crr: num(crr, profile.crr),
    });
    setSaved(true);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-6 md:px-8 md:pt-10">
      <h1 className="font-display text-5xl tracking-tight">{t('profile.title')}</h1>
      <section className="mt-6">
        <h2 className="font-display text-2xl">{t('profile.look')}</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant={settings.theme === 'dark' ? 'primary' : 'ghost'} onClick={() => void updateSettings({ theme: 'dark' })}>
            {t('theme.dark')}
          </Button>
          <Button variant={settings.theme === 'light' ? 'primary' : 'ghost'} onClick={() => void updateSettings({ theme: 'light' })}>
            {t('theme.light')}
          </Button>
        </div>
        <div className="mt-3">
          <Toggle checked={settings.camilla} onChange={(camilla) => void updateSettings({ camilla })} label={t('profile.camilla')} hint={t('profile.camillaHint')} />
        </div>
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-muted">{t('profile.quality')}</p>
          <Segmented<Quality>
            label={t('profile.quality')}
            value={settings.quality}
            onChange={(quality) => void updateSettings({ quality })}
            options={[
              { value: 'low', label: t('quality.low') },
              { value: 'medium', label: t('quality.medium') },
              { value: 'high', label: t('quality.high') },
            ]}
          />
          <p className="mt-2 text-sm text-muted">{t('profile.qualityHint')}</p>
        </div>
      </section>
      <section className="mt-8">
        <h2 className="font-display text-2xl">{t('profile.body')}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t('onboarding.name')}><TextInput value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Field label={t('onboarding.weight')}><TextInput inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} /></Field>
          <Field label={t('onboarding.ftp')}><TextInput inputMode="numeric" value={ftp} onChange={(event) => setFtp(event.target.value)} /></Field>
          <Field label={t('onboarding.maxHr')}><TextInput inputMode="numeric" value={maxHr} onChange={(event) => setMaxHr(event.target.value)} /></Field>
          <Field label={t('profile.resting')}><TextInput inputMode="numeric" value={resting} onChange={(event) => setResting(event.target.value)} /></Field>
          <Field label={t('profile.lthr')} hint={t('profile.lthrHint')}><TextInput inputMode="numeric" value={lthr} onChange={(event) => setLthr(event.target.value)} /></Field>
        </div>
      </section>
      <details className="mt-6 rounded-3xl border border-line bg-elev p-4">
        <summary className="cursor-pointer font-semibold">{t('profile.physics')}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label={t('profile.bike')}><TextInput inputMode="decimal" value={bike} onChange={(event) => setBike(event.target.value)} /></Field>
          <Field label={t('profile.cda')}><TextInput inputMode="decimal" value={cda} onChange={(event) => setCda(event.target.value)} /></Field>
          <Field label={t('profile.crr')}><TextInput inputMode="decimal" value={crr} onChange={(event) => setCrr(event.target.value)} /></Field>
        </div>
      </details>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()}>{t('actions.save')}</Button>
        {saved ? <span className="text-sm text-good">{t('profile.saved')}</span> : null}
      </div>
      <section className="mt-10">
        <Button
          variant="danger"
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
        <p className="mt-2 text-sm text-muted">{t('profile.resetHint')}</p>
      </section>
    </main>
  );
}

function num(value: string, fallback: number): number {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}
