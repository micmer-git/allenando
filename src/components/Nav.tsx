import type { ReactElement } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { Mark, Wordmark } from '@/components/ui';
import { sezioneDi, type Sezione } from '@/lib/redirect';
import { cn } from '@/lib/cn';

/** Tre voci (piano U, A1): Mondo, Salite, Sessioni e Allenamenti stanno in Pedala, il resto in Tu. */
const items: { to: string; key: string; sezione: Sezione; icon: () => ReactElement }[] = [
  { to: '/', key: 'nav.ride', sezione: 'pedala', icon: RideIcon },
  { to: '/history', key: 'nav.history', sezione: 'diario', icon: BookIcon },
  { to: '/tu', key: 'nav.me', sezione: 'tu', icon: MeIcon },
];

/** Sul computer, sotto «Tu», le sue sezioni: un clic invece di due. */
const subTu = [
  { to: '/garage', label: 'Garage' },
  { to: '/traguardi', label: 'Traguardi' },
  { to: '/classifiche', label: 'Classifiche' },
  { to: '/workouts', label: 'Allenamenti' },
  { to: '/impostazioni', label: 'Impostazioni' },
] as const;

/**
 * Il menu a sinistra. Sul computer (wide) le tre voci col nome e, sotto «Tu», le sue sezioni; sul
 * telefono in orizzontale (rail) una colonna di sole icone, le tre della barra in basso.
 */
export function SideNav() {
  const { t } = useI18n();
  const here = sezioneDi(useLocation().pathname);
  return (
    <aside
      className="sticky top-0 hidden h-dvh flex-col border-r border-line rail:flex rail:items-center rail:gap-1 rail:px-1.5 rail:py-[max(0.5rem,env(safe-area-inset-top))] wide:flex wide:gap-2 wide:px-4 wide:py-6"
      data-testid="side-nav"
    >
      <p className="px-3 rail:hidden">
        <Wordmark />
      </p>
      <p className="hidden rail:grid rail:h-11 rail:place-items-center" aria-label="OROBIA">
        <Mark size={30} />
      </p>
      <nav aria-label={t('nav.primary')} className="flex flex-col gap-1 rail:gap-0.5 wide:mt-6">
        {items.map((item) => {
          const on = here === item.sezione;
          return (
            <div key={item.to} className="contents">
              <NavLink
                to={item.to}
                end={item.to === '/'}
                aria-label={t(item.key)}
                aria-current={on ? 'page' : undefined}
                data-testid={`nav-${item.sezione}`}
                className={cn(
                  'hidden items-center rounded-xl text-[15px] font-semibold rail:grid rail:h-12 rail:w-14 rail:place-items-center wide:flex wide:h-11 wide:gap-3 wide:px-3',
                  on ? 'bg-elev2 text-ink rail:text-accent' : 'text-muted hover:bg-elev',
                )}
              >
                <span className={cn('grid place-items-center', on && 'wide:text-accent')}>
                  <item.icon />
                </span>
                <span className="rail:sr-only">{t(item.key)}</span>
              </NavLink>
              {item.sezione === 'tu'
                ? subTu.map((s) => (
                    <NavLink
                      key={s.to}
                      to={s.to}
                      className={({ isActive }) => cn('hidden h-10 items-center rounded-xl pl-12 pr-3 text-sm font-semibold wide:flex', isActive ? 'bg-elev2 text-ink' : 'text-muted hover:bg-elev')}
                      data-testid={`nav-tu-${s.to.slice(1)}`}
                    >
                      {s.label}
                    </NavLink>
                  ))
                : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

export function BottomNav() {
  const { t } = useI18n();
  const here = sezioneDi(useLocation().pathname);
  return (
    <nav
      aria-label={t('nav.primary')}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 px-2 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur-xl rail:hidden wide:hidden"
      data-testid="bottom-nav"
    >
      <ul className="grid grid-cols-3">
        {items.map((item) => {
          const on = here === item.sezione;
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                aria-current={on ? 'page' : undefined}
                data-testid={`tab-${item.sezione}`}
                className={cn('flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold', on ? 'text-accent' : 'text-muted')}
              >
                <item.icon />
                {t(item.key)}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function WorldIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 6.5 8.5 4l7 2.5L21 4v13.5L15.5 20l-7-2.5L3 20V6.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8.5 4v13.5M15.5 6.5V20" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function RideIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="6.5" cy="16.5" r="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.5" cy="16.5" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6.5 16.5 10 9h4l3.5 7.5M10 9l2 7.5M14 9l-1.2-2.5H9" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
function BookIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H20v16H7.5A2.5 2.5 0 0 0 5 21.5V5.5Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 19.5A2.5 2.5 0 0 1 7.5 17H20" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
function MeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8.5" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
export function MountainIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2.5 19.5 9 8l3.6 6 2.4-3.6 6.5 9.1H2.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M7.4 10.8 9 12.3l1.4-1.3" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
