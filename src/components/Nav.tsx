import { NavLink } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';

const items = [
  { to: '/', key: 'nav.home', icon: HomeIcon, end: true },
  { to: '/ride', key: 'nav.ride', icon: RideIcon, end: false },
  { to: '/workouts', key: 'nav.workouts', icon: PlanIcon, end: false },
  { to: '/history', key: 'nav.history', icon: BookIcon, end: false },
  { to: '/sleep', key: 'nav.sleep', icon: MoonIcon, end: false },
] as const;

export function SideNav() {
  const { t } = useI18n();
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col gap-2 border-r border-line px-4 py-6 md:flex">
      <p className="font-display px-3 text-2xl tracking-tight">
        Camilla <span className="text-accent">Ride</span>
      </p>
      <nav aria-label={t('nav.primary')} className="mt-6 flex flex-col gap-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex h-12 items-center gap-3 rounded-2xl px-3 text-base font-semibold',
                isActive ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-elev',
              )
            }
          >
            <item.icon />
            {t(item.key)}
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
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 px-2 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur-xl md:hidden"
    >
      <ul className="grid grid-cols-5">
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

function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
function RideIcon() {
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
function MoonIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 3.5A8 8 0 1 0 20.5 14 6.5 6.5 0 0 1 15 3.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
