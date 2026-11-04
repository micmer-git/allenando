import { NavLink } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { Mark, Wordmark } from '@/components/ui';
import { cn } from '@/lib/cn';

const items = [
  { to: '/', key: 'nav.home', icon: HomeIcon, end: true },
  { to: '/mondo', key: 'nav.world', icon: WorldIcon, end: false },
  { to: '/salite', key: 'nav.climbs', icon: MountainIcon, end: false },
  { to: '/sessioni', key: 'nav.sessions', icon: SessionIcon, end: false },
  { to: '/garage', key: 'nav.garage', icon: JerseyIcon, end: false },
  { to: '/tu', key: 'nav.me', icon: MeIcon, end: false },
] as const;

/** Sul computer c'è posto: anche le sezioni che sul telefono stanno dentro «Tu». */
const more = [
  { to: '/traguardi', key: 'nav.achievements', icon: CupIcon, end: false },
  { to: '/classifiche', key: 'nav.boards', icon: PodiumIcon, end: false },
  { to: '/giri', key: 'nav.rides', icon: RideIcon, end: false },
  { to: '/workouts', key: 'nav.workouts', icon: PlanIcon, end: false },
  { to: '/history', key: 'nav.history', icon: BookIcon, end: false },
] as const;

/**
 * Il menu a sinistra. Sul computer (wide) con le voci e anche le sezioni che sul telefono stanno
 * dentro «Tu»; sul telefono in orizzontale (rail) una colonna di sole icone, le sei della barra
 * in basso, che stanno tutte in 390 px di altezza.
 */
export function SideNav() {
  const { t } = useI18n();
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
        {[...items, ...more].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            aria-label={t(item.key)}
            className={({ isActive }) =>
              cn(
                'items-center rounded-xl text-[15px] font-semibold wide:h-11 wide:gap-3 wide:px-3',
                more.some((m) => m.to === item.to) ? 'hidden wide:flex' : 'hidden rail:grid rail:h-12 rail:w-14 rail:place-items-center wide:flex',
                isActive ? 'bg-elev2 text-ink rail:text-accent' : 'text-muted hover:bg-elev',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className={cn('grid place-items-center', isActive && 'wide:text-accent')}>
                  <item.icon />
                </span>
                <span className="rail:sr-only">{t(item.key)}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

export function BottomNav() {
  const { t } = useI18n();
  return (
    <nav
      aria-label={t('nav.primary')}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 px-2 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur-xl rail:hidden wide:hidden"
      data-testid="bottom-nav"
    >
      <ul className="grid grid-cols-6">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold',
                  isActive ? 'text-accent' : 'text-muted',
                )
              }
            >
              <item.icon />
              {t(item.key)}
            </NavLink>
          </li>
        ))}
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

function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeWidth="1.8" />
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
function PlanIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 18V8M10 18V5M15 18v-6M20 18V9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
function SessionIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4M12 13v3l2 1.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function JerseyIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8.2 3.5 10 3q2 2 4 0l1.8.5L21 7.5 19 11l-2-1.4V21H7V9.6L5 11 3 7.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M7 12.5h10" stroke="currentColor" strokeWidth="1.6" />
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
function CupIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 4h10v5a5 5 0 0 1-10 0Z M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function PodiumIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 20V9h6v11M3 20v-6h6M15 20v-8h6v8M2 20h20" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
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
