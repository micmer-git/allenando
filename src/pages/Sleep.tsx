import { useEffect, useState } from 'react';
import { Columns } from '@/components/Charts';
import { Button, Field, TextInput } from '@/components/ui';
import { formatDateTime, formatDayLabel, formatHours, toDatetimeLocalValue } from '@/domain/format';
import { localDateKey } from '@/domain/load';
import { sleepSecondsOnDay, sleepWeek } from '@/domain/sleep';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/useApp';

export function SleepPage() {
  const { t } = useI18n();
  const sleeps = useApp((s) => s.sleeps);
  const active = useApp((s) => s.settings.activeSleepStart);
  const startSleep = useApp((s) => s.startSleep);
  const stopSleep = useApp((s) => s.stopSleep);
  const addSleep = useApp((s) => s.addSleep);
  const deleteSleep = useApp((s) => s.deleteSleep);
  const [now, setNow] = useState(() => Date.now());
  const [note, setNote] = useState('');
  const [manualStart, setManualStart] = useState(() => toDatetimeLocalValue(new Date(Date.now() - 3 * 3600 * 1000)));
  const [manualEnd, setManualEnd] = useState(() => toDatetimeLocalValue(new Date()));
  const [manualNote, setManualNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  const today = sleepSecondsOnDay(sleeps, localDateKey(new Date())) + (active ? Math.max(0, (now - new Date(active).getTime()) / 1000) : 0);
  const week = sleepWeek(sleeps);
  if (active) {
    const key = localDateKey(new Date());
    const day = week.find((item) => item.date === key);
    if (day) day.seconds += Math.max(0, (now - new Date(active).getTime()) / 1000);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-nav pt-6 md:px-8 md:pt-10" data-testid="sleep-page">
      <h1 className="font-display text-5xl leading-none tracking-tight">{t('sleep.title')}</h1>
      <p className="mt-3 max-w-xl text-lg text-muted">{t('sleep.lead')}</p>
      <section className="mt-6 rounded-[2rem] bg-elev p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-camilla">{t('sleep.today')}</p>
        <p className="num mt-2 font-display text-6xl leading-none" data-testid="sleep-today">{formatHours(today)}</p>
        {active ? (
          <p className="num mt-3 text-lg text-muted">
            {t('sleep.running')} · {formatHours((now - new Date(active).getTime()) / 1000)}
          </p>
        ) : null}
        <div className="mt-5">
          {active ? (
            <Button data-testid="sleep-stop" className="w-full" onClick={() => void stopSleep(note).then(() => setNote(''))}>
              {t('sleep.stop')}
            </Button>
          ) : (
            <Button data-testid="sleep-start" className="w-full" onClick={() => void startSleep()}>
              {t('sleep.start')}
            </Button>
          )}
        </div>
        {active ? (
          <div className="mt-3">
            <TextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('sleep.notePlaceholder')} />
          </div>
        ) : null}
      </section>
      <section className="mt-6">
        <h2 className="font-display text-2xl">{t('sleep.week')}</h2>
        <div className="mt-3">
          <Columns values={week.map((day) => day.seconds / 3600)} labels={week.map((day) => formatDayLabel(day.date))} color="var(--camilla)" />
        </div>
      </section>
      <section className="mt-6 rounded-3xl border border-line bg-elev p-4">
        <h2 className="font-display text-2xl">{t('sleep.manual')}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t('sleep.from')}>
            <TextInput type="datetime-local" value={manualStart} onChange={(event) => setManualStart(event.target.value)} data-testid="sleep-from" />
          </Field>
          <Field label={t('sleep.to')}>
            <TextInput type="datetime-local" value={manualEnd} onChange={(event) => setManualEnd(event.target.value)} data-testid="sleep-to" />
          </Field>
        </div>
        <div className="mt-3">
          <Field label={t('sleep.note')}>
            <TextInput value={manualNote} onChange={(event) => setManualNote(event.target.value)} placeholder={t('sleep.notePlaceholder')} />
          </Field>
        </div>
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
        <Button
          className="mt-4"
          data-testid="sleep-save"
          onClick={() => {
            const start = new Date(manualStart);
            const end = new Date(manualEnd);
            if (!(end.getTime() > start.getTime())) {
              setError(t('sleep.invalid'));
              return;
            }
            setError('');
            void addSleep({
              id: crypto.randomUUID(),
              start: start.toISOString(),
              end: end.toISOString(),
              note: manualNote.trim() || undefined,
            });
            setManualNote('');
          }}
        >
          {t('actions.save')}
        </Button>
      </section>
      <section className="mt-6">
        <h2 className="font-display text-2xl">{t('sleep.recent')}</h2>
        {sleeps.length === 0 ? <p className="mt-3 text-muted">{t('sleep.empty')}</p> : null}
        <ul className="mt-3 flex flex-col gap-2">
          {sleeps.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-3 rounded-2xl bg-elev px-4 py-3">
              <span>
                <span className="block font-semibold">{formatHours((new Date(session.end).getTime() - new Date(session.start).getTime()) / 1000)}</span>
                <span className="text-sm text-muted">{formatDateTime(session.start)}{session.note ? ` · ${session.note}` : ''}</span>
              </span>
              <button type="button" className="text-sm font-semibold text-danger" onClick={() => void deleteSleep(session.id)}>
                {t('sleep.remove')}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
