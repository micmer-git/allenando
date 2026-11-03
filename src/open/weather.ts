import type { WeatherLook } from './sky';

/*
 * Il meteo di adesso sopra Bergamo, da Open-Meteo (gratuito, senza chiave, CORS aperto).
 * Serve al cielo (nuvole, foschia, pioggia) e alla fisica (il vento). Se la rete non risponde
 * il mondo resta sereno e senza vento: niente si blocca per il meteo.
 */

export interface WeatherNow extends WeatherLook {
  /** vento a 10 m, m/s */
  windMs: number;
  /** da dove soffia, radianti dal nord in senso orario (convenzione meteo) */
  windFrom: number;
  tempC: number;
  /** codice WMO del tempo */
  code: number;
  /** quando l'ha misurato Open-Meteo, ISO */
  at: string;
}

const CACHE_KEY = 'allenando-meteo-v1';
const FRESH_MS = 15 * 60 * 1000;

export function weatherUrl(lat: number, lon: number): string {
  const p = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    current: 'temperature_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility',
    wind_speed_unit: 'ms',
    timezone: 'UTC',
  });
  return `https://api.open-meteo.com/v1/forecast?${p.toString()}`;
}

/** Dalla risposta di Open-Meteo ai numeri che servono. Null se la risposta non ha quello che serve. */
export function parseWeather(json: unknown): WeatherNow | null {
  const c = (json as { current?: Record<string, unknown> } | null)?.current;
  if (!c) return null;
  const num = (k: string, d: number) => (typeof c[k] === 'number' && Number.isFinite(c[k]) ? (c[k] as number) : d);
  if (typeof c.wind_speed_10m !== 'number' && typeof c.cloud_cover !== 'number') return null;
  return {
    cloud: Math.min(1, Math.max(0, num('cloud_cover', 10) / 100)),
    rain: Math.max(0, num('precipitation', 0)),
    visibility: Math.max(200, num('visibility', 40000)),
    windMs: Math.max(0, num('wind_speed_10m', 0)),
    windFrom: (num('wind_direction_10m', 0) * Math.PI) / 180,
    tempC: num('temperature_2m', 15),
    code: Math.round(num('weather_code', 0)),
    at: typeof c.time === 'string' ? c.time : new Date().toISOString(),
  };
}

export async function fetchWeather(lat: number, lon: number, fetcher: typeof fetch = fetch): Promise<WeatherNow | null> {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) {
      const hit = JSON.parse(raw) as { t: number; w: WeatherNow };
      if (Date.now() - hit.t < FRESH_MS) return hit.w;
    }
  } catch {
    // niente cache: si chiede
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetcher(weatherUrl(lat, lon), { signal: ctrl.signal });
    if (!res.ok) return null;
    const w = parseWeather(await res.json());
    if (w) {
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), w }));
      } catch {
        // la cache è un di più
      }
    }
    return w;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Vento contro (positivo) o a favore (negativo), m/s, per chi va nella direzione `heading`
 * (convenzione del mondo: avanti = (sin h, cos h) con x a est e z a sud). Il vento misurato
 * a 10 m si riduce all'altezza del ciclista e fra case e alberi: `shelter` 0–1.
 */
export function headwind(w: Pick<WeatherNow, 'windMs' | 'windFrom'>, heading: number, shelter = 0.6): number {
  return -Math.cos(w.windFrom + heading) * w.windMs * shelter;
}

/** Il tempo in due parole, dal codice WMO. */
export function weatherLabel(code: number): string {
  if (code === 0) return 'sereno';
  if (code <= 2) return 'poco nuvoloso';
  if (code === 3) return 'coperto';
  if (code === 45 || code === 48) return 'nebbia';
  if (code >= 51 && code <= 57) return 'pioviggine';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'pioggia';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'neve';
  if (code >= 95) return 'temporale';
  return 'variabile';
}
