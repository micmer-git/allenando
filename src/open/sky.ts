import * as THREE from 'three';

/*
 * Il cielo del mondo aperto: dove sta il sole a Bergamo in un istante dato, e che luce fa
 * con le nuvole e la pioggia di quel momento. Niente DOM: si prova in Node.
 */

const RAD = Math.PI / 180;

export interface SunPos {
  /** gradi dal nord in senso orario (90 = est), in radianti */
  azimuth: number;
  /** sopra l'orizzonte, radianti (negativo di notte) */
  elevation: number;
}

/** Posizione del sole (formule NOAA semplificate, errore sotto il mezzo grado). */
export function sunPosition(date: Date, lat: number, lon: number): SunPos {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const g = (((357.529 + 0.98560028 * d) % 360) + 360) % 360;
  const q = (((280.459 + 0.98564736 * d) % 360) + 360) % 360;
  const L = q + 1.915 * Math.sin(g * RAD) + 0.02 * Math.sin(2 * g * RAD);
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L * RAD), Math.cos(L * RAD));
  const dec = Math.asin(Math.sin(e) * Math.sin(L * RAD));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const H = (gmst * 15 + lon) * RAD - ra;
  const phi = lat * RAD;
  const elevation = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  let azimuth = Math.atan2(-Math.cos(dec) * Math.sin(H), Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.cos(H) * Math.sin(phi));
  if (azimuth < 0) azimuth += Math.PI * 2;
  return { azimuth, elevation };
}

export type Daytime = 'vera' | 'mattina' | 'mezzogiorno' | 'sera';

/**
 * Il sole per l'ora scelta. «vera» è adesso; di notte si resta all'ora blu (il mondo non ha
 * lampioni accesi per pedalare al buio). Le altre cercano nel giorno di oggi il momento giusto.
 */
export function sunFor(daytime: Daytime, now: Date, lat: number, lon: number): SunPos & { night: boolean } {
  if (daytime === 'vera') {
    const s = sunPosition(now, lat, lon);
    if (s.elevation < -4 * RAD) return { ...s, elevation: -3 * RAD, night: true };
    return { ...s, night: false };
  }
  const day0 = new Date(now);
  day0.setUTCHours(0, 0, 0, 0);
  const path: { t: number; s: SunPos }[] = [];
  for (let m = 0; m < 24 * 60; m += 5) path.push({ t: m, s: sunPosition(new Date(day0.getTime() + m * 60000), lat, lon) });
  const noon = path.reduce((a, b) => (b.s.elevation > a.s.elevation ? b : a));
  if (daytime === 'mezzogiorno') return { ...noon.s, night: false };
  // mattina: il sole a 18° a est; sera: a 4° a ovest, la luce calda prima del tramonto
  const target = (daytime === 'mattina' ? 18 : 4) * RAD;
  const half = daytime === 'mattina' ? path.filter((p) => p.t < noon.t) : path.filter((p) => p.t > noon.t);
  let best = half[0] ?? noon;
  for (const p of half) if (Math.abs(p.s.elevation - target) < Math.abs(best.s.elevation - target)) best = p;
  return { ...best.s, night: false };
}

/** Direzione del sole nel mondo: x est, y su, z sud. */
export function sunVector(s: SunPos, out = new THREE.Vector3()): THREE.Vector3 {
  const c = Math.cos(s.elevation);
  return out.set(Math.sin(s.azimuth) * c, Math.sin(s.elevation), -Math.cos(s.azimuth) * c);
}

export interface WeatherLook {
  /** copertura nuvolosa, 0–1 */
  cloud: number;
  /** pioggia, mm/h */
  rain: number;
  /** visibilità, metri */
  visibility: number;
}

export interface Atmosphere {
  zenith: THREE.Color;
  mid: THREE.Color;
  horizon: THREE.Color;
  /** alone intorno al sole */
  glow: THREE.Color;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  fogNear: number;
  /** frazione della distanza di vista massima */
  fogFar: number;
  exposure: number;
}

const DAY = { zenith: '#4f88c6', mid: '#a3c4e2', horizon: '#cfdbe5', glow: '#fff4dc', sun: '#fff0d6' };
const GOLD = { zenith: '#3f6497', mid: '#c4b3a6', horizon: '#f1bf8c', glow: '#ffd29a', sun: '#ffb46e' };
const BLUE = { zenith: '#1e2d52', mid: '#59608a', horizon: '#c98d74', glow: '#f2a07a', sun: '#ff9c72' };
// coperto: lo zenit resta più scuro e un filo più azzurro dell'orizzonte, che è chiaro (la nebbia
// prende quel colore: col grigio medio di prima sembrava fumo)
const OVERCAST = { zenith: '#8794a3', mid: '#b0b8c1', horizon: '#d3d7da' };
const RAINY = { zenith: '#6c747c', mid: '#848b92', horizon: '#9ea4a8' };

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Il cielo d'alta quota: lo zenit blu scuro e saturo, l'aria più tersa (meno foschia). */
const HIGH = { zenith: '#1f4f94', mid: '#7fa9d6' };

/**
 * Colori e luci del cielo per l'altezza del sole, il meteo e la quota di chi guarda (`alt`,
 * metri): a 2000 m il blu è più scuro e saturo e la foschia comincia più lontano.
 */
export function atmosphere(sun: SunPos, w: WeatherLook, alt = 300): Atmosphere {
  const el = sun.elevation / RAD;
  const kDay = smooth(4, 22, el);
  const kGold = smooth(-4, 3, el);
  const kAlt = smooth(700, 2300, alt);
  const mix = (key: 'zenith' | 'mid' | 'horizon' | 'glow' | 'sun') => new THREE.Color(BLUE[key]).lerp(new THREE.Color(GOLD[key]), kGold).lerp(new THREE.Color(DAY[key]), kDay);
  const zenith = mix('zenith');
  const mid = mix('mid');
  const horizon = mix('horizon');
  // in quota, di giorno: lo zenit si scurisce e si satura, il cielo medio resta azzurro
  zenith.lerp(new THREE.Color(HIGH.zenith), kAlt * kDay * 0.75);
  mid.lerp(new THREE.Color(HIGH.mid), kAlt * kDay * 0.5);
  const glow = mix('glow');
  const sunColor = mix('sun');
  const cloud = Math.min(1, Math.max(0, w.cloud));
  const wet = smooth(0.1, 2.5, w.rain);
  // le nuvole spengono i colori: verso il grigio, più scuro con il sole basso e con la pioggia
  const light = 0.45 + 0.55 * smooth(-4, 15, el);
  const grey = (key: 'zenith' | 'mid' | 'horizon') => new THREE.Color(OVERCAST[key]).lerp(new THREE.Color(RAINY[key]), wet).multiplyScalar(light);
  const kc = cloud * 0.85 + wet * 0.15;
  zenith.lerp(grey('zenith'), kc);
  mid.lerp(grey('mid'), kc);
  horizon.lerp(grey('horizon'), kc);
  // anche col cielo coperto si capisce da che parte sta il sole
  glow.lerp(horizon, cloud * 0.6);
  // col coperto il sole sparisce ma la luce diffusa resta forte: la si sposta sul cielo
  const sunIntensity = (0.35 + 1.5 * smooth(-3, 25, el)) * (1 - 0.6 * cloud) * (1 - 0.3 * wet);
  const hemiIntensity = (0.42 + 0.3 * smooth(-4, 20, el)) * (1 + 0.85 * cloud);
  const hemiSky = new THREE.Color('#e6f0fb').lerp(zenith, 0.35);
  const hemiGround = new THREE.Color('#4f5a3c').multiplyScalar(0.6 + 0.4 * light);
  // l'aria d'alta quota è più tersa: la foschia si tiene nelle valli lontane
  const fogFar = Math.max(0.18, Math.min(1, (1 - 0.45 * cloud - 0.3 * wet) * Math.min(1, w.visibility / 30000) * (1 + 0.3 * kAlt)));
  const fogNear = 350 * fogFar * (1 + 1.2 * kAlt);
  const exposure = 1.05 + 0.25 * (1 - kDay) + 0.12 * cloud;
  return { zenith, mid, horizon, glow, sunColor, sunIntensity, hemiSky, hemiGround, hemiIntensity, fogNear, fogFar, exposure };
}

export const CLEAR: WeatherLook = { cloud: 0.1, rain: 0, visibility: 40000 };
