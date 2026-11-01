import { useApp } from '@/store/useApp';
import { it, type Dictionary } from './it';

export const dictionaries: Record<string, Dictionary> = { it };

export type Locale = keyof typeof dictionaries;
export type Translate = (path: string, vars?: Record<string, string | number>) => string;

export function translate(locale: string, path: string, vars?: Record<string, string | number>): string {
  const parts = path.split('.');
  let cur: unknown = dictionaries[locale] ?? dictionaries.it;
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return path;
    }
  }
  if (typeof cur !== 'string') return path;
  if (!vars) return cur;
  return cur.replace(/\{(\w+)\}/g, (_, key: string) => (vars[key] != null ? String(vars[key]) : `{${key}}`));
}

export function useI18n(): { t: Translate; locale: string } {
  const locale = useApp((s) => s.settings.locale);
  return {
    locale,
    t: (path, vars) => translate(locale, path, vars),
  };
}
