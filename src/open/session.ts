import type { TrackPose } from '@/domain/track';
import type { RideEngine } from '@/sim/engine';
import type { WorldClient, WorldRemote } from '@/multiplayer/world-client';
import { CLS, FLAG, type Dir, type Leg, type TurnOption, type WorldGraph } from './graph';
import { WorldPath } from './path';
import { draftFactor, NpcCrowd } from './npc';
import type { Landmark, Place, RideDef, WorldData } from './world';
import { headwind, type WeatherNow } from './weather';

/**
 * Una pedalata nel mondo aperto: tiene il percorso vivo (WorldPath) davanti alle ruote,
 * propone le svolte agli incroci, sa se si è sul percorso scelto o fuori, conta i luoghi
 * passati, fa vivere i ciclisti virtuali e mette la scia e il fondo nella fisica.
 */

/**
 * Un'uscita proposta all'incrocio. In una rotatoria ci sono anche `exit` (1 = la prima uscita),
 * `roundabout: true` e `via` (il pezzo d'anello da fare): l'HUD scrive «2ª uscita».
 */
export type JunctionOption = TurnOption & { toward: string; onRoute: boolean };

export interface JunctionView {
  /** indice del tratto che finisce all'incrocio (in una rotatoria: all'ingresso nell'anello) */
  leg: number;
  /** metri all'incrocio */
  dist: number;
  /**
   * Da sinistra a destra, come le strade davanti. In una rotatoria (si gira in senso antiorario)
   * vuol dire dall'ultima uscita alla prima: il numero è in `exit`.
   */
  options: JunctionOption[];
  selected: number;
  /** la scelta è una rotatoria: una domanda sola, poi l'anello si segue da solo */
  roundabout?: true;
}

export interface Toast {
  id: number;
  title: string;
  sub: string;
  kind: 'luogo' | 'paese' | 'svolta' | 'info';
  at: number;
}

const LOOKAHEAD = 1600;
/** quanti tratti indietro si guarda per non rifare la stessa strada nel giro libero */
const RECENT_LEGS = 160;
/** a che distanza da un luogo lo si considera «passato», per tipo */
const PASS_RANGE: Record<string, number> = { cima: 2600, fiume: 450, paese: 350, citta: 900, passo: 200, lago: 600, mura: 200 };

export class WorldSession {
  readonly path: WorldPath;
  readonly graph: WorldGraph;
  readonly ride: RideDef | null;
  readonly crowd: NpcCrowd;
  /** true dal primo momento in cui si lascia il percorso scelto */
  offRoute = false;
  /** per ogni tratto del percorso vivo: l'indice nel percorso scelto, o -1 */
  private routeIndex: number[] = [];
  private routeLegs: Leg[];
  junction: JunctionView | null = null;
  passed = new Set<string>();
  toasts: Toast[] = [];
  private toastId = 0;
  private lastPlace: string | null = null;
  private landmarkClock = 0;
  private towns: Place[];
  private landmarks: Landmark[];
  /** distanza percorsa in salita, per i punti */
  gainM = 0;
  private lastAlt: number | null = null;
  private lane = -1.6;
  private towardCache = new Map<string, string>();
  client: WorldClient | null = null;
  /** meteo vero sopra Bergamo: se c'è, il vento entra nella fisica e nel rullo */
  weather: WeatherNow | null = null;
  private windClock = 0;

  constructor(
    readonly data: WorldData,
    start: { ride: RideDef } | { legs: Leg[]; name: string } | { edge: number; dir: Dir; s: number },
    npcs: number,
  ) {
    this.graph = data.graph;
    this.towns = data.features.places.filter((p) => p.kind !== 'hamlet');
    this.landmarks = data.features.landmarks;
    if ('ride' in start || 'legs' in start) {
      this.ride = 'ride' in start ? start.ride : null;
      this.planName = 'legs' in start ? start.name : '';
      this.routeLegs = 'ride' in start ? start.ride.legs.map(([edge, dir]) => ({ edge, dir })) : start.legs;
      const first = this.routeLegs[0];
      this.path = new WorldPath(this.graph, { edge: first.edge, dir: first.dir, s: first.dir > 0 ? 0 : this.graph.edges[first.edge].length });
      this.routeIndex.push(0);
      for (let i = 1; i < this.routeLegs.length; i++) {
        this.path.append(this.routeLegs[i].edge, this.routeLegs[i].dir);
        this.routeIndex.push(i);
      }
    } else {
      this.ride = null;
      this.routeLegs = [];
      this.path = new WorldPath(this.graph, start);
      this.routeIndex.push(-1);
      this.extend(0);
    }
    this.crowd = new NpcCrowd(this.graph, npcs);
  }

  /** nome dell'anello suggerito, se si pedala uno di quelli */
  planName = '';
  /** posa del giocatore in questo fotogramma (con la corsia) */
  pose: TrackPose = { x: 0, y: 0, z: 0, heading: 0, grade: 0, altitude: 0, distance: 0 };
  /** posizioni stimate dei ciclisti veri in questo fotogramma */
  remoteNow = new Map<string, WorldRemote & { x: number; y: number; z: number; heading: number; grade: number }>();

  /** c'è un percorso da seguire (scelto o suggerito) */
  /** il percorso scelto, intero (vuoto nel giro libero) */
  get plannedLegs(): Leg[] {
    return this.routeLegs;
  }

  get planned(): boolean {
    return this.routeLegs.length > 0;
  }

  get onRoute(): boolean {
    return this.planned && !this.offRoute;
  }

  /** Il giro vale per la classifica: un percorso del mondo, fatto tutto senza uscirne. */
  get rankable(): boolean {
    return this.ride != null && !this.offRoute && !this.rejoined;
  }

  /** Un fotogramma: posa, poi tutto il resto. */
  step(engine: RideEngine, dt: number): void {
    this.pose = this.playerPose(engine.distance);
    this.remoteNow.clear();
    for (const r of this.remotePoses()) this.remoteNow.set(r.id, r);
    this.tick(engine, dt, this.pose);
  }

  /** Il pezzo del percorso scelto che resta, se si è sul percorso: per l'altimetria. */
  routeRemaining(distance: number): number {
    if (!this.ride) return 0;
    return Math.max(0, this.path.length - distance);
  }

  /** Allunga il percorso libero con la strada più dritta, fino a LOOKAHEAD metri avanti. */
  private extend(distance: number): void {
    // sul percorso scelto non si allunga: finisce dove finisce
    if (this.onRoute) return;
    let guard = 0;
    // le strade fatte negli ultimi km: «dritto» non ci torna, se c'è un'altra via
    const legs = this.path.legs;
    const recent = new Map<number, number>();
    const use = (edge: number) => recent.set(edge, (recent.get(edge) ?? 0) + 1);
    for (let i = Math.max(0, legs.length - RECENT_LEGS); i < legs.length; i++) use(legs[i].edge);
    while (this.path.length - distance < LOOKAHEAD && guard++ < 200) {
      const last = legs[legs.length - 1];
      // in una rotatoria si fa l'anello fino all'uscita più dritta, non si esce al primo ramo
      const exits = this.graph.roundaboutExits(last.edge, last.dir);
      const next = exits ? this.graph.straightestExit(last.edge, exits, recent) : this.graph.straightest(last.edge, last.dir, recent);
      for (const l of next.via ?? []) {
        this.path.append(l.edge, l.dir);
        this.routeIndex.push(-1);
      }
      this.path.append(next.edge, next.dir);
      this.routeIndex.push(-1);
      use(next.edge);
    }
  }

  /** La posa del giocatore, spostata a destra nella sua corsia (si tiene la destra). */
  playerPose(distance: number): TrackPose {
    const p = this.path.poseAt(distance);
    const at = this.path.edgeAt(distance);
    const hw = this.graph.edges[at.edge].hw;
    const want = -Math.max(0.15, hw - 1.15);
    this.lane += (want - this.lane) * 0.04;
    return { ...p, x: p.x + Math.cos(p.heading) * this.lane, z: p.z - Math.sin(p.heading) * this.lane };
  }

  tick(engine: RideEngine, dt: number, pose: TrackPose): void {
    const d = engine.distance;
    this.extend(d);
    const at = this.path.edgeAt(d);
    // fisica: fondo e scia
    const e = this.graph.edges[at.edge];
    engine.rolling = e.flags & FLAG.cobbles ? 1.8 : e.flags & FLAG.unpaved ? 2.2 : 1;
    const others: { x: number; z: number; heading: number }[] = [];
    for (const n of this.crowd.npcs) if (n.active) others.push(n);
    for (const r of this.remoteNow.values()) others.push(r);
    const target = draftFactor(pose, others);
    engine.aero += (target - engine.aero) * Math.min(1, dt * 2);
    // vento vero: contro o a favore secondo la direzione di marcia, meno fra case e boschi, a raffiche
    this.windClock += dt;
    const shelter = e.cls >= CLS.residential || e.flags & FLAG.tunnel ? (e.flags & FLAG.tunnel ? 0 : 0.35) : 0.6;
    const gust = 1 + 0.22 * Math.sin(this.windClock * 0.31) + 0.1 * Math.sin(this.windClock * 1.7 + 1.3);
    const wind = this.weather ? headwind(this.weather, pose.heading, shelter) * gust : 0;
    engine.wind += (wind - engine.wind) * Math.min(1, dt * 0.8);
    // dislivello per i punti
    if (this.lastAlt != null && engine.phase === 'riding') {
      const dy = pose.altitude - this.lastAlt;
      if (dy > 0 && dy < 5) this.gainM += dy;
    }
    this.lastAlt = pose.altitude;
    this.crowd.update(engine.phase === 'riding' ? dt : dt * 0.5, { x: pose.x, z: pose.z, edge: at.edge, dir: at.dir, s: at.s });
    this.updateJunction(d);
    this.landmarkClock -= dt;
    if (this.landmarkClock <= 0) {
      this.landmarkClock = 0.5;
      this.checkPlaces(pose);
    }
    const now = performance.now();
    this.toasts = this.toasts.filter((t) => now - t.at < 7000);
    this.client?.update({ edge: at.edge, s: at.s, dir: at.dir, power: engine.power3s, speed: engine.speed, idle: engine.phase !== 'riding', ride: this.onRoute ? this.ride?.id : undefined });
  }

  private updateJunction(d: number): void {
    const k = this.path.legAt(d);
    if (k >= this.path.legs.length - 1 && this.onRoute) {
      this.junction = null;
      return;
    }
    const leg = this.path.legs[k];
    // sull'anello di una rotatoria non si chiede niente: l'uscita è già stata scelta all'ingresso
    if (this.graph.isRing(leg.edge)) {
      this.junction = null;
      return;
    }
    const dist = this.path.legEnd(k) - d;
    if (dist > 220) {
      this.junction = null;
      return;
    }
    if (this.junction && this.junction.leg === k) {
      this.junction.dist = dist;
      return;
    }
    const exits = this.graph.roundaboutExits(leg.edge, leg.dir);
    const opts: TurnOption[] = exits ? [...exits].reverse() : this.graph.options(leg.edge, leg.dir);
    if (opts.length < 2) {
      this.junction = null;
      return;
    }
    // un'uscita coincide con il percorso se ne coincidono l'anello e la strada dopo
    const matches = (o: TurnOption, legs: (Leg | undefined)[]) => {
      const seq = [...(o.via ?? []), { edge: o.edge, dir: o.dir }];
      return seq.every((l, i) => legs[i] != null && legs[i]!.edge === l.edge && legs[i]!.dir === l.dir);
    };
    const ahead = (from: number, n: number): (Leg | undefined)[] => Array.from({ length: n }, (_, i) => this.path.legs[from + i]);
    const ri = this.onRoute ? this.routeIndex[k] : -1;
    const routeAhead = (n: number): (Leg | undefined)[] => (ri >= 0 ? Array.from({ length: n }, (_, i) => this.routeLegs[ri + 1 + i]) : []);
    const options: JunctionOption[] = opts.map((o) => {
      const n = (o.via?.length ?? 0) + 1;
      return { ...o, toward: this.toward(o.edge, o.dir), onRoute: ri >= 0 && matches(o, routeAhead(n)) };
    });
    const selected = Math.max(
      0,
      options.findIndex((o) => matches(o, ahead(k + 1, (o.via?.length ?? 0) + 1))),
    );
    this.junction = exits ? { leg: k, dist, options, selected, roundabout: true } : { leg: k, dist, options, selected };
  }

  /** Verso dove porta una strada: il primo paese a 1-6 km seguendo la via più dritta. */
  private toward(edge: number, dir: Dir): string {
    const key = `${edge}:${dir}`;
    const have = this.towardCache.get(key);
    if (have != null) return have;
    let cur = { edge, dir };
    let run = 0;
    let found = '';
    const startX = this.graph.pose(edge, dir > 0 ? 0 : this.graph.edges[edge].length).x;
    const startZ = this.graph.pose(edge, dir > 0 ? 0 : this.graph.edges[edge].length).z;
    for (let i = 0; i < 60 && run < 6000; i++) {
      const e = this.graph.edges[cur.edge];
      run += e.length;
      const end = this.graph.endNode(cur.edge, cur.dir);
      const x = this.graph.nodeX[end];
      const z = this.graph.nodeZ[end];
      if (run > 900) {
        for (const t of this.towns) {
          if ((t.kind === 'suburb' || t.kind === 'quarter') && run > 2500) continue;
          if (Math.hypot(t.x - x, t.z - z) < 450 && Math.hypot(t.x - startX, t.z - startZ) > 700) {
            found = t.name;
            break;
          }
        }
      }
      if (found) break;
      const nx = this.graph.straightest(cur.edge, cur.dir);
      if (nx.uTurn) break;
      cur = nx;
    }
    this.towardCache.set(key, found);
    return found;
  }

  /** Sceglie un'uscita all'incrocio che si sta per raggiungere. */
  choose(index: number): void {
    const j = this.junction;
    if (!j) return;
    const o = j.options[index];
    if (!o) return;
    if (j.selected === index && this.path.legs[j.leg + 1]) return;
    this.path.truncateAfter(j.leg);
    this.routeIndex.length = j.leg + 1;
    const ri0 = this.routeIndex[j.leg];
    // in una rotatoria: prima il pezzo d'anello, poi l'uscita
    const seq = [...(o.via ?? []), { edge: o.edge, dir: o.dir }];
    seq.forEach((l, i) => {
      this.path.append(l.edge, l.dir);
      this.routeIndex.push(o.onRoute ? ri0 + 1 + i : -1);
    });
    if (o.onRoute) {
      // si resta sul percorso: si rimette il resto
      const ri = ri0 + seq.length;
      for (let i = ri + 1; i < this.routeLegs.length; i++) {
        this.path.append(this.routeLegs[i].edge, this.routeLegs[i].dir);
        this.routeIndex.push(i);
      }
    } else {
      if (this.planned && !this.offRoute) this.toast('Fuori dal percorso', this.ride ? 'Il tempo non va in classifica. «Torna sul percorso» ti riporta sulla strada.' : '«Torna sul percorso» ti riporta sull’anello.', 'info');
      this.offRoute = this.planned;
      this.extend(this.path.legs[j.leg].from);
    }
    j.selected = index;
    this.junction = null;
  }

  /** Sposta la scelta a sinistra (-1) o a destra (+1) fra le uscite. */
  nudge(step: -1 | 1): void {
    const j = this.junction;
    if (!j) return;
    const i = Math.min(j.options.length - 1, Math.max(0, j.selected + step));
    this.choose(i);
  }

  /** Dal prossimo incrocio, la strada più breve verso il percorso scelto, e poi il percorso. */
  rejoin(distance: number): boolean {
    if (!this.planned || !this.offRoute) return false;
    const k = this.path.legAt(distance);
    const from = this.graph.endNode(this.path.legs[k].edge, this.path.legs[k].dir);
    // il punto del percorso più conveniente da raggiungere, fra quelli ancora da fare
    const done = Math.max(0, ...this.routeIndex.filter((i) => i >= 0));
    const reach = this.graph.reach(from, 15000);
    let best = -1;
    let bestCost = Infinity;
    for (let i = done; i < this.routeLegs.length; i++) {
      const node = this.graph.startNode(this.routeLegs[i].edge, this.routeLegs[i].dir);
      // a parità di strada, meglio un punto più avanti: non si torna indietro a rifare un pezzo
      const c = reach.cost[node] - (i - done) * 2;
      if (c < bestCost) {
        bestCost = c;
        best = i;
      }
    }
    if (best < 0 || !Number.isFinite(bestCost)) return false;
    const target = this.graph.startNode(this.routeLegs[best].edge, this.routeLegs[best].dir);
    const way = this.graph.route(from, target) ?? [];
    this.path.truncateAfter(k);
    this.routeIndex.length = k + 1;
    for (const l of way) {
      this.path.append(l.edge, l.dir);
      this.routeIndex.push(-1);
    }
    for (let i = best; i < this.routeLegs.length; i++) {
      this.path.append(this.routeLegs[i].edge, this.routeLegs[i].dir);
      this.routeIndex.push(i);
    }
    this.offRoute = false;
    // si torna in strada, ma il giro non vale per la classifica: lo si è accorciato o allungato
    this.toast('Torni sul percorso', `${Math.round(this.graph.legsLength(way))} m per rientrare`, 'svolta');
    this.junction = null;
    this.rejoined = true;
    return true;
  }

  /** dopo un rientro il percorso finisce di nuovo, ma il tempo resta fuori classifica */
  rejoined = false;

  /** quanto è già stato contato nei punti: «Continua» dopo il riepilogo non conta due volte */
  committedM = 0;
  committedGain = 0;
  committedLandmarks = new Set<string>();

  markCommitted(distance: number): void {
    this.committedM = distance;
    this.committedGain = this.gainM;
    for (const id of this.passed) this.committedLandmarks.add(id);
  }

  /** Lascia il percorso libero e segue da qui un anello suggerito. */
  followLegs(distance: number, legs: Leg[]): void {
    const k = this.path.legAt(distance);
    const from = this.graph.endNode(this.path.legs[k].edge, this.path.legs[k].dir);
    if (legs.length && this.graph.startNode(legs[0].edge, legs[0].dir) !== from) return;
    this.path.truncateAfter(k);
    this.routeIndex.length = k + 1;
    for (const l of legs) {
      this.path.append(l.edge, l.dir);
      this.routeIndex.push(-1);
    }
    this.junction = null;
  }

  /** dove finiva il percorso scelto, se lo si è passato proseguendo libero (allenamento più lungo del percorso) */
  routeEnd: number | null = null;

  /**
   * Il percorso finisce ma l'allenamento no: da qui si prosegue libero, la strada si allunga
   * da sola come nel giro libero. Il percorso conta come fatto quando si passa `routeEnd`.
   */
  continueFree(distance: number): void {
    // fuori dal percorso la strada si allunga già da sola
    if (!this.onRoute || this.routeEnd != null) return;
    this.routeEnd = this.path.length;
    this.routeLegs = [];
    this.toast('Fine del percorso', 'L’allenamento continua: prosegui libero, agli incroci scegli tu.', 'info');
    this.extend(distance);
  }

  /** Il nodo da cui partirebbe un anello: il prossimo incrocio. */
  nextNode(distance: number): number {
    const k = this.path.legAt(distance);
    return this.graph.endNode(this.path.legs[k].edge, this.path.legs[k].dir);
  }

  /** Dove sta la freccia della svolta: sopra il nodo, rivolta lungo la strada scelta. */
  arrow(distance: number): { x: number; y: number; z: number; heading: number } | null {
    const j = this.junction;
    if (!j || j.dist > 160) return null;
    const o = j.options[j.selected];
    // in una rotatoria la freccia sta sempre sull'uscita scelta, anche se è «dritto»
    if (!o || (Math.abs(o.turn) < 25 && !o.roundabout)) return null;
    const node = this.graph.startNode(o.edge, o.dir);
    void distance;
    return { x: this.graph.nodeX[node], y: this.graph.nodeY[node], z: this.graph.nodeZ[node], heading: this.graph.entryHeading(o.edge, o.dir) };
  }

  private toast(title: string, sub: string, kind: Toast['kind']): void {
    this.toasts.push({ id: ++this.toastId, title, sub, kind, at: performance.now() });
    if (this.toasts.length > 3) this.toasts.shift();
  }

  private checkPlaces(pose: TrackPose): void {
    for (const l of this.landmarks) {
      if (this.passed.has(l.id)) continue;
      const range = PASS_RANGE[l.kind] ?? 160;
      if (Math.hypot(l.x - pose.x, l.z - pose.z) < range) {
        this.passed.add(l.id);
        this.toast(l.name, l.note, 'luogo');
      }
    }
    let best: Place | null = null;
    let bestD = 700;
    for (const t of this.towns) {
      if (t.kind === 'quarter' && bestD < 400) continue;
      const d = Math.hypot(t.x - pose.x, t.z - pose.z);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (best && best.name !== this.lastPlace) {
      if (this.lastPlace != null) this.toast(best.name, `${Math.round(pose.altitude)} m`, 'paese');
      this.lastPlace = best.name;
    }
  }

  /** Il paese più vicino, per la barra in alto. */
  placeName(): string {
    return this.lastPlace ?? '';
  }

  // ---------- persone vere ----------

  /** Le posizioni stimate adesso dei ciclisti veri, sul grafo, con la loro corsia. */
  remotePoses(): (WorldRemote & { x: number; y: number; z: number; heading: number; grade: number })[] {
    const c = this.client;
    if (!c) return [];
    const out: (WorldRemote & { x: number; y: number; z: number; heading: number; grade: number })[] = [];
    const now = Date.now();
    for (const r of c.remote().values()) {
      if (!r.at || r.e < 0 || r.e >= this.graph.edges.length) continue;
      const e = this.graph.edges[r.e];
      const ahead = r.idle ? 0 : r.v * Math.min(3, Math.max(0, (now - r.seenAt) / 1000));
      const s = Math.min(e.length, Math.max(0, r.s + r.r * ahead));
      const p = this.graph.pose(r.e, s, r.r);
      const lane = -Math.max(0.15, e.hw - 1.4);
      out.push({ ...r, x: p.x + Math.cos(p.heading) * lane, y: p.y, z: p.z - Math.sin(p.heading) * lane, heading: p.heading, grade: p.grade });
    }
    return out;
  }

  /** Chi c'è intorno, vero o virtuale, con la distanza lungo la strada (positiva = davanti). */
  nearby(pose: TrackPose): { name: string; real: boolean; ahead: number; w: number; color?: number }[] {
    const fx = Math.sin(pose.heading);
    const fz = Math.cos(pose.heading);
    const list: { name: string; real: boolean; ahead: number; w: number; color?: number; d: number }[] = [];
    for (const r of this.remoteNow.values()) {
      const d = Math.hypot(r.x - pose.x, r.z - pose.z);
      list.push({ name: r.nick, real: true, ahead: (r.x - pose.x) * fx + (r.z - pose.z) * fz, w: r.w, color: r.color, d });
    }
    for (const n of this.crowd.npcs) {
      if (!n.active) continue;
      const d = Math.hypot(n.x - pose.x, n.z - pose.z);
      if (d > 400) continue;
      list.push({ name: 'ciclista virtuale', real: false, ahead: (n.x - pose.x) * fx + (n.z - pose.z) * fz, w: Math.round(n.wkg * n.mass), d });
    }
    list.sort((a, b) => Number(b.real) - Number(a.real) || a.d - b.d);
    return list.slice(0, 6);
  }

  /** Classe della strada corrente, per l'HUD. */
  roadLabel(distance: number): string {
    const at = this.path.edgeAt(distance);
    const e = this.graph.edges[at.edge];
    const parts = [e.name, e.ref].filter(Boolean);
    if (parts.length === 0) return e.cls === CLS.cycleway ? 'pista ciclabile' : '';
    return parts.join(' · ');
  }
}
