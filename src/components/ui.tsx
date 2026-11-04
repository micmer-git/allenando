import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BRAND, MARK } from '@/brand';
import { cn } from '@/lib/cn';

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'soft' }) {
  return (
    <button
      className={cn(
        'inline-flex h-12 items-center justify-center gap-2 rounded-full px-5 text-base font-semibold transition active:scale-[0.98] disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-accent-ink',
        variant === 'ghost' && 'border border-line bg-elev/70 text-ink',
        variant === 'soft' && 'bg-elev2 text-ink',
        variant === 'danger' && 'bg-danger text-white',
        className,
      )}
      {...props}
    />
  );
}

/** Il ritorno alla pagina madre: testo leggero, ma alto 44 px per il dito. */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="-ml-2 inline-flex h-11 min-w-11 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-muted transition hover:text-ink" data-testid="back-link">
      <span aria-hidden="true">←</span>
      {label}
    </Link>
  );
}

/**
 * La testata di ogni pagina: il ritorno (se la pagina sta dentro un'altra), l'occhiello, il
 * titolo in maiuscolo nel carattere del marchio e, a destra, un numero o un tasto.
 */
export function PageHeader({
  title,
  eyebrow,
  back,
  aside,
  sub,
  size = 'lg',
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  back?: { to: string; label: string };
  aside?: ReactNode;
  sub?: ReactNode;
  size?: 'lg' | 'md';
}) {
  return (
    <header data-testid="page-header">
      {back ? <BackLink to={back.to} label={back.label} /> : null}
      <div className={cn('flex items-end justify-between gap-3', back ? 'mt-1' : '')}>
        <div className="min-w-0">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1 className={cn('font-display uppercase leading-[0.9]', size === 'lg' ? 'text-5xl' : 'text-4xl', eyebrow ? 'mt-1' : '')}>{title}</h1>
        </div>
        {aside ? <div className="shrink-0 pb-0.5">{aside}</div> : null}
      </div>
      {sub ? <p className="mt-1.5 text-lg text-muted">{sub}</p> : null}
    </header>
  );
}

/**
 * Un foglio che sale dal basso (al centro sul computer). Resta montato anche chiuso, nascosto:
 * i controlli dentro tengono il loro stato e la pagina non salta quando si apre.
 */
export function Sheet({ open, onClose, title, children, testId }: { open: boolean; onClose: () => void; title: string; children: ReactNode; testId?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);
  return (
    <div className={cn('fixed inset-0 z-40', open ? '' : 'hidden')} role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <div className="absolute inset-0 bg-black/55" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 mx-auto max-h-[88dvh] w-full max-w-lg overflow-auto rounded-t-3xl border border-line bg-elev px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 outline-none wide:bottom-auto wide:top-1/2 wide:-translate-y-1/2 wide:rounded-3xl"
      >
        <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-line" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl uppercase">{title}</h2>
          <button type="button" className="-mr-2 h-11 rounded-full px-4 font-semibold text-accent" onClick={onClose}>
            Fatto
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('rounded-3xl border border-line bg-elev/85 p-4 shadow-[0_24px_50px_-36px_rgba(0,0,0,0.7)]', className)}>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-sm leading-snug text-muted">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'h-12 w-full rounded-2xl border border-line bg-elev2 px-3 text-lg text-ink outline-none',
        props.className,
      )}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  testId,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-3xl border border-line bg-elev/80 p-4 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        {hint ? <span className="mt-1 block text-sm leading-snug text-muted">{hint}</span> : null}
      </span>
      <span className={cn('relative h-8 w-14 shrink-0 rounded-full transition', checked ? 'bg-accent' : 'bg-elev2')}>
        <span
          className={cn(
            'absolute top-1 h-6 w-6 rounded-full bg-white shadow transition',
            checked ? 'left-7' : 'left-1',
          )}
        />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  testId,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label?: string;
  testId?: string;
}) {
  return (
    // una riga sola: ogni voce prende la sua parola più una parte uguale dello spazio che avanza,
    // così con due opzioni non resta un buco e con cinque nessuna si tronca
    <div role="group" aria-label={label} data-testid={testId} className="flex gap-1 rounded-full bg-elev2 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-11 min-w-0 flex-auto truncate whitespace-nowrap rounded-full px-2 text-sm font-semibold',
            option.value === value ? 'bg-[var(--thumb)] text-ink shadow-[0_1px_2px_rgba(0,0,0,0.35)]' : 'text-muted',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Pill({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-elev2 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide"
    >
      {color ? <span className="h-2 w-2 rounded-full" style={{ background: color }} /> : null}
      {children}
    </span>
  );
}

/** Il medaglione del marchio: sole d'oro, cresta delle Orobie, strada a tornanti fino al passo. */
export function Mark({ size = 28, className, title }: { size?: number; className?: string; title?: string }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="8 8 48 48" className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <clipPath id={`m${id}`}>
          <circle cx={MARK.disc.cx} cy={MARK.disc.cy} r={MARK.disc.r} />
        </clipPath>
      </defs>
      <circle cx={MARK.disc.cx} cy={MARK.disc.cy} r={MARK.disc.r} fill="var(--accent)" />
      <g clipPath={`url(#m${id})`}>
        <path d={MARK.ridge} fill="var(--mark-ink)" />
        <path d={MARK.road} fill="none" stroke="var(--accent)" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-[0.32em] font-display text-2xl font-extrabold uppercase leading-none tracking-[0.08em]', className)}>
      <Mark size={26} className="h-[1.05em] w-[1.05em] shrink-0" />
      <span className="translate-y-[0.03em]">{BRAND.name}</span>
    </span>
  );
}
