import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Field, PageHeader, Segmented, TextInput } from '@/components/ui';
import { cn } from '@/lib/cn';
import { parseNumberInput } from '@/domain/format';
import { PROFILE_LIMITS, type Quality } from '@/domain/types';
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

  async function save() {
    const limit = (key: keyof typeof PROFILE_LIMITS, value: string, fallback: number) =>
      parseNumberInput(value, PROFILE_LIMITS[key][0], PROFILE_LIMITS[key][1], fallback);
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

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-5 md:px-8 md:pt-10" data-testid="profile">
      <PageHeader
        back={{ to: '/tu', label: 'Tu' }}
        title={t('profile.title')}
        aside={saved ? <span className="text-sm font-semibold text-good" role="status" data-testid="profile-saved">{t('profile.saved')}</span> : null}
      />
      <section className="mt-6">
        <h2 className="font-display text-2xl uppercase">{t('profile.look')}</h2>
        <div className="mt-3">
          <Segmented<'dark' | 'light'>
            label={t('profile.look')}
            value={settings.theme}
            onChange={(theme) => void updateSettings({ theme })}
            options={[
              { value: 'dark', label: t('theme.dark') },
              { value: 'light', label: t('theme.light') },
            ]}
          />
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
        <h2 className="font-display text-2xl uppercase">{t('profile.body')}</h2>
        {/* ogni campo si salva quando lo lasci: niente «Salva» in fondo da ricordarsi */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t('onboarding.name')}><TextInput value={name} onChange={(event) => setName(event.target.value)} onBlur={autosave} /></Field>
          <Field label={t('onboarding.weight')}><TextInput inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} onBlur={autosave} /></Field>
          <Field label={t('onboarding.ftp')}><TextInput inputMode="numeric" value={ftp} onChange={(event) => setFtp(event.target.value)} onBlur={autosave} /></Field>
          <Field label={t('onboarding.maxHr')}><TextInput inputMode="numeric" value={maxHr} onChange={(event) => setMaxHr(event.target.value)} onBlur={autosave} /></Field>
          <Field label={t('profile.resting')}><TextInput inputMode="numeric" value={resting} onChange={(event) => setResting(event.target.value)} onBlur={autosave} /></Field>
          <Field label={t('profile.lthr')} hint={t('profile.lthrHint')}><TextInput inputMode="numeric" value={lthr} onChange={(event) => setLthr(event.target.value)} onBlur={autosave} /></Field>
        </div>
      </section>
      <details className="group mt-6 rounded-3xl border border-line bg-elev px-4">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between font-semibold">
          {t('profile.physics')}
          <span aria-hidden="true" className="text-muted transition group-open:rotate-180">⌄</span>
        </summary>
        <div className="grid gap-3 pb-4 sm:grid-cols-3">
          <Field label={t('profile.bike')}><TextInput inputMode="decimal" value={bike} onChange={(event) => setBike(event.target.value)} onBlur={autosave} /></Field>
          <Field label={t('profile.cda')}><TextInput inputMode="decimal" value={cda} onChange={(event) => setCda(event.target.value)} onBlur={autosave} /></Field>
          <Field label={t('profile.crr')}><TextInput inputMode="decimal" value={crr} onChange={(event) => setCrr(event.target.value)} onBlur={autosave} /></Field>
        </div>
      </details>
      <details className="group mt-10 rounded-3xl border border-danger/40 px-4" data-testid="profile-danger" onToggle={(e) => !(e.currentTarget as HTMLDetailsElement).open && setArmed(false)}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between font-semibold text-danger">
          {t('profile.danger')}
          <span aria-hidden="true" className="transition group-open:rotate-180">⌄</span>
        </summary>
        <div className="pb-4">
          <p className="text-sm text-muted">{t('profile.resetHint')}</p>
          <Button
            variant={armed ? 'danger' : 'ghost'}
            className={cn('mt-3', !armed && 'text-danger')}
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
    </main>
  );
}

/** Numero nel campo, con la virgola decimale come lo si scrive. */
function show(value: number): string {
  return String(value).replace('.', ',');
}
