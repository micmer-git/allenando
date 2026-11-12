# OROBIA · piano U: Pedala, Diario, Tu

Base: `main` dopo il merge della pista F (oggi `f2b38b3` + lavoro aperto in `orobia-funzioni`). Audit: `audit.md`. Wireframe: `wireframe.html` (le sigle B1, C3, H2… sono le sue schermate).
Due piste: **U-flusso** (interfaccia) e **U-motore** (motore, rullo, rete). Due worktree, due PR, un'integrazione.

---

## 0. Assunzioni (decise qui, Michele ha detto «camon»)

| # | decisione |
|---|---|
| A1 | Navigazione: **Pedala · Diario · Tu**. Tre voci, non quattro: Mondo, Salite, Sessioni e Allenamenti stanno in Pedala. |
| A2 | Pedala è la home (`/`). Oggi sparisce come pagina: sessione, programma e missioni diventano righe di Pedala; livello e oro vanno in Tu; settimana e ultimi giri nel Diario. |
| A3 | Il simulatore diventa **Modalità prova**: spenta di serie, si accende solo in Impostazioni (`settings.prova`). `?prova=1` la accende per la scheda (sessionStorage), per i collaudi e i link di prova. |
| A4 | Senza sensore di potenza e senza prova: **nessuna opzione**, un tasto «Collega il rullo». Un link diretto a `/ride` torna a `/`. |
| A5 | Il rullo collegato vince sempre sulla prova. |
| A6 | Un rullo per l'app, non per la corsa. Resta fra una corsa e l'altra; dopo un riavvio «Ricollega» in un tocco (selettore filtrato sul nome). Se il browser ha `bluetooth.getDevices()`, ricollega da solo. |
| A7 | Tipi di attività: **Libera** (SIM: pendenza al rullo), **Potenza fissa** (ERG costante, − + di 5 W, tenuto premuto 25 W; parte dall'ultimo valore, la prima volta dal 75 % FTP arrotondato a 5), **Allenamento** (ERG a blocchi). Su un tuo giro con potenza, **Watt di allora** prende il posto di Allenamento. |
| A8 | Cosa sa fare il sensore decide i tipi: rullo con controllo → tutti; misuratore di potenza o rullo senza controllo → Libera (senza pendenza) e Allenamento **a bersaglio** (nessun comando ERG); solo cardio o cadenza → nessuna corsa; prova → tutti. |
| A9 | Fantasma: un interruttore in Pedala, visibile solo dove c'è un record (o sul tuo giro), acceso di serie, mai con Allenamento. |
| A10 | Classifica e record: Libera e Potenza fissa sì (i watt sono veri), Allenamento no (come oggi), Prova mai. |
| A11 | Prova: Diario sì (gettone «Prova»); classifiche, record, fantasma registrato, oro, punti, missioni, traguardi no; esportazione FIT/TCX/GPX no. L'interruttore «Rullo / Simulatore» sparisce da tutte le classifiche (i tempi «sim» sul server restano, non si mostrano). |
| A12 | Giri. Su un anello (strada che si chiude su sé stessa): `giri` proposti = ⌈durata ÷ stima del giro⌉, si correggono con − +; se l'allenamento non è finito al traguardo dell'ultimo giro, **un giro in più da solo**; se finisce prima, il rullo torna Libera e si chiude al traguardo dell'ultimo giro. Anche Libera e Potenza fissa hanno i giri (default 1). |
| A13 | Percorso aperto con un allenamento: **va e torna** sulla stessa strada (passaggi: 1 andata, 2 andata e ritorno, …), proposto se la durata supera l'andata; più una riga «Anello da <partenza> per N min». Senza allenamento il percorso aperto finisce all'arrivo, come oggi. Giro libero: nessuna fine. Grande salita fuori dal mondo (Mortirolo, Stelvio): finisce in cima, con «⚠ Finisce in cima · 38 di 54 min». |
| A14 | Stima del giro: fisica del motore (`stepSpeed`) sul profilo, ai watt medi del tipo (Allenamento: media pesata dei bersagli; Libera: 75 % FTP; Fissa: i watt), senza scia né vento. |
| A15 | Mondo leggero = `manifest.json`, `graph.json`, `rides.json`, `features.json`, `far.bin`, `monumenti.json` (Bergamo: 6,8 MB in cache, 2,4 MB scaricati). Strade sulle loro quote, terreno lontano usato anche vicino, nomi, monumenti; niente case (`b/`) né terreno a 25 m (`dem/`) né l'arredo che ne viene. Scende da solo dopo il primo avvio per il mondo scelto, se non c'è `saveData`. |
| A16 | Offline si dice con una parola: «Offline». Classifiche e «In strada ora»: «Offline»; stanze: tasto nascosto; meteo vero → sereno; il tempo del percorso va in una coda e parte quando torna la rete. Le sessioni si pedalano (il gruppo è virtuale), la loro classifica no. |
| A17 | Dove: un foglio (sul computer una colonna) con carta, tre strumenti (Giro libero, Crea un anello, A → B), filtri Tutti · Anelli · Salite · Tuoi giri, lista per gruppo. Un tocco su una riga sceglie e chiude. Le quattro salite verificate diventano «Grandi salite»; la Selvino verificata esce dalla lista (resta la Selvino del mondo; la rotta e la sua classifica restano). Il catalogo «Traccia da acquisire» esce. |
| A18 | Un generatore di anelli solo: quello di Mondo (`suggestLoops`, con le strade). Quello di Allenamenti a 27 km/h esce. |
| A19 | Primo avvio: mondo, nome, peso, FTP, «Entra». FC max va in Impostazioni (default 186). |
| A20 | Profilo e impostazioni in una pagina, `/impostazioni`: Tu, Rullo e sensori, Modalità prova, Mondi senza rete, Grafica, Aspetto, Meteo e luce, Dati. |
| A21 | Il tasto pieno di Pedala si chiama «Via». La scelta (Dove + Come) si ricorda in kv `pedala`: ripetere l'ultimo giro è un tocco. |
| A22 | Database: IndexedDB `allenando`, versione invariata. Campi nuovi tutti facoltativi: `Ride.prova?`, `Ride.tipo?`, `Ride.giri?`, `Settings.prova`, kv `pedala`, kv `coda`. |
| A23 | Collaudo senza Bluetooth vero: un rullo finto **solo** con `localStorage['orobia.collaudo']='rullo'` (o `cardio`, `potenza`), che gli script mettono prima di caricare. In produzione non si accende da nessun link. |

---

## 1. Tocchi: oggi → dopo

App aperta, mondo in cache. «Oggi col rullo» = collegamento dentro la corsa, +4 a ogni giro. «Dopo» = rullo già collegato; il collegamento costa 2 tocchi **una volta per apertura dell'app**, 0 alla seconda corsa.

| caso | oggi, simulatore | oggi, rullo | dopo | dopo, tocchi |
|---|---|---|---|---|
| Ripeti l'ultimo giro | 1 | 5 | Via | **1** |
| Giro libero | 2 | 6 | Dove → Giro libero → Via | **3** |
| Percorso del mondo | 3 + 2 scorrimenti | 7 | Dove → riga → Via | **3** |
| Salita | 2 | 6 | Dove → riga → Via | **3** |
| Allenamento su un anello | 5–7 | 9–11 | Allenamento → riga → Via | **3** (4 con «Anello per N min») |
| Fantasma di un giro salvato | 5 | 9 | Dove → riga in Tuoi giri → Via | **3** (4 se non è fra gli ultimi tre) |
| Fantasma del record | 2 | 6 | Dove → riga → Via (interruttore già acceso) | **3** |

---

## 2. Contratti fra le due piste

### 2.1 `src/ride/contract.ts` — solo tipi, identico nelle due piste

Lo scrive U-motore nel primo commit (M0). U-flusso può crearlo uguale prima di averlo: due aggiunte identiche dello stesso file si uniscono senza conflitto. Niente funzioni qui dentro: stanno nei moduli del § 2.3.

```ts
/** Come si pedala. 'allora' = i watt di un giro rifatto (ERG dal file). */
export type Tipo = 'libera' | 'fissa' | 'allenamento' | 'allora';

/** Dove si pedala: uno solo. */
export type Dove =
  | { kind: 'percorso'; world: string; ride: string }
  | { kind: 'piano'; world: string; plan: string }        // anello suggerito o A → B (savePlan)
  | { kind: 'libero'; world: string; edge: number; dir: 1 | -1; s: number }
  | { kind: 'salita'; route: string }                      // grande salita fuori dal mondo
  | { kind: 'giro'; replay: string; sec?: string };       // un tuo giro

export interface Intento {
  dove: Dove;
  tipo: Tipo;
  /** 'fissa': 50–1000 W, passi di 5 */
  watt?: number;
  /** 'allenamento': id */
  workout?: string;
  /** passaggi: giri su un anello, tratte su un percorso aperto (2 = andata e ritorno). Default 1. */
  giri?: number;
  /** default: true dove c'è un fantasma */
  fantasma?: boolean;
  session?: string;
  room?: string;
}

/** Cosa sa fare quello che è collegato. */
export interface Capacita { pendenza: boolean; erg: boolean; potenza: boolean; cardio: boolean; cadenza: boolean }

export type StatoRullo = 'mai' | 'cerco' | 'collegato' | 'perso' | 'fallito';
export type Supporto = 'si' | 'ios' | 'manca';

export interface Rullo {
  stato: StatoRullo;
  supporto: Supporto;
  /** «Wahoo KICKR», «KICKR + HRM-Pro» */
  nome: string | null;
  /** l'ultimo collegato, per «Ricollega» */
  ricordato: string | null;
  sa: Capacita;
  /** prova accesa e nessuna potenza vera collegata */
  prova: boolean;
}

export type PaccoMondo = 'intero' | 'leggero' | 'scarico' | 'niente';
export type Rete = 'online' | 'offline';
```

### 2.2 Il link della corsa

Nuovi: `tipo=libera|fissa|allenamento|allora`, `watt=165`, `giri=2`, `fantasma=0`. Tutti i vecchi restano validi:

| URL di oggi | Intento |
|---|---|
| `?world=W&ride=R` | percorso, libera |
| `?world=W&plan=K` | piano, libera |
| `?world=W&edge=E&dir=D&s=S` | libero, libera |
| `?route=R` | salita, libera |
| `…&workout=X` | tipo allenamento |
| `?replay=R&mode=grade` | giro, libera, fantasma 0 |
| `?replay=R&mode=ghost` | giro, libera, fantasma 1 |
| `?replay=R&mode=power` | giro, allora |
| `?route=R&ghost=ID` | salita, libera, fantasma del giro ID |
| `&session=`, `&room=`, `&resume=1`, `&at=`, `&sec=` | invariati |

### 2.3 Moduli che U-motore espone e U-flusso usa

```ts
// src/ride/intento.ts
export function intentoInSearch(i: Intento): string;
export function intentoDaSearch(p: URLSearchParams): Intento | null;

// src/sim/rullo.ts
export function tipiAmmessi(r: Rullo): Tipo[];                  // [] = nessuna corsa
export function puoPedalare(r: Rullo): boolean;
export function useRullo(): Rullo;
export const rullo: {
  collega(tutti?: boolean): Promise<void>;   // da un tocco: il selettore del browser
  ricollega(): Promise<void>;
  aggiungiCardio(): Promise<void>;
  scollega(): void;
  sorgente(): TelemetrySource;               // il BluetoothTrainer unico; il simulatore solo se prova
};

// src/domain/stima.ts
export function stimaSecondi(profilo: { distance: number; altitude: number }[], watt: number, fisica: PhysicsParams): number;
export function wattMedi(w: Workout, ftp: number): number;
export function giriPer(durataSec: number, giroSec: number): number;   // ceil, 1..20

// src/open/passaggi.ts
export function chiuso(graph: WorldGraph, legs: Leg[]): boolean;
export function passaggi(legs: Leg[], n: number, chiuso: boolean): Leg[];   // ripete o va e torna

// src/lib/rete.ts
export function useRete(): Rete;
export function usePacco(world: string): { stato: PaccoMondo; progresso?: number; bytes: number; totale: number };
export function scaricaIntero(world: string, signal?: AbortSignal): Promise<void>;
export function togliIntero(world: string): Promise<void>;
```

### 2.4 Campi nuovi che l'HUD legge (U-motore li scrive, U-flusso li disegna)

| oggetto | campo | |
|---|---|---|
| `RideSetup` | `intento: Intento`, `prova: boolean`, `pacco: PaccoMondo` | |
| `RideEngine` | `tipo: Tipo`, `wattFissi: number \| null`, `setWattFissi(w)` | `targetPower` e `mode` come oggi |
| `WorldSession` | `giro: number` (da 1), `giri: number`, `traguardoFra(d): number \| null`, `giriFatti: { sec: number }[]` | |
| `Ride` (salvato) | `prova?: true`, `tipo?: Tipo`, `giri?: number` | |

### 2.5 `data-testid` (gli script li usano tutti e due)

`pedala-collega`, `pedala-ricollega`, `pedala-dove`, `pedala-scheda`, `pedala-giri-meno`, `pedala-giri-piu`, `pedala-come-libera|fissa|allenamento|allora`, `pedala-watt-meno`, `pedala-watt-piu`, `pedala-fantasma`, `pedala-via`, `pedala-sessione`, `pedala-programma`, `dove-libero`, `dove-anello`, `dove-ab`, `dove-filtro-{tutti|anelli|salite|giri}`, `dove-riga-{id}`, `allenamento-riga-{id}`, `rullo-chip`, `rete-offline`, `ride-prova`, `ride-bersaglio`, `ride-bersaglio-meno`, `ride-bersaglio-piu`, `ride-giro`, `ride-leggero`; `world-ready` acquista `data-reason="tutto|leggero|errore|tetto"`.

### 2.6 Rotte vecchie

| vecchia | va a |
|---|---|
| `/` | Pedala |
| `/mondo?world=W` (scheda percorsi) | `/?dove=1&world=W` |
| `/mondo?tab=libero` · `anello` · `ab` | `/?dove=libero` · `anello` · `ab` |
| `/mondo?tab=classifiche` | `/classifiche` |
| `/salite` | `/?dove=salite` |
| `/giri` | `/history` |
| `/giri/:id` | `/?dove=giro&replay=:id` |
| `/profile` | `/impostazioni` |
| `/salite/:id`, `/sessioni`, `/load`, `/import`, `/workouts`, `/workouts/edit/:id`, `/programmi`, `/garage`, `/traguardi`, `/classifiche`, `/tu`, `/history`, `/history/:id`, `/start`, `/ride` | restano |

---

## 3. U-flusso — navigazione, pagine, flusso

### Allowlist

| nuovi | `src/pages/Pedala.tsx`, `src/pages/pedala/{Dove,Come,Rullo,Allenamento,CreaAnello,scelta,vista}.tsx\|ts`, `src/pages/Impostazioni.tsx`, `src/lib/redirect.ts`, `src/components/ride/{RulloChip,Bersaglio,ProvaBar,GiroBadge}.tsx`, `tests/{pedala,rotte}.test.ts` |
|---|---|
| modifica | `src/App.tsx`, `src/components/Nav.tsx`, `src/pages/{Home,Me,History,RideDetail,Onboarding,Profile,World,Climbs,ClimbDetail,Workouts,Sessions,Leaderboards}.tsx`, `src/components/{Board,Install}.tsx`, `src/i18n/it.ts`, `src/index.css` (solo classi nuove), `tests/pagine.test.ts`, `scripts/{pagine-check,ui-shot,game-shot,corsa-checks}.mjs` |
| `src/pages/Ride.tsx` | **solo** da `function RideScreen` a `function LoadingVeil`, più `PauseVeil`, `RideSummary`, `SensorSheet` (si toglie) e le icone in fondo. Mai sopra `function RideScreen`. |
| vietati | tutto `src/sim/`, `src/bluetooth/`, `src/open/` (tranne import), `src/domain/`, `src/game/`, `src/db/`, `src/store/`, `vite.config.ts` |

### Passi (un commit ciascuno, ognuno verificabile da solo)

| # | cosa | wireframe |
|---|---|---|
| F1 | Barra a 3 voci; colonna sul computer con le sezioni di Tu sotto; `redirectFor()` e le rotte del § 2.6 | 1 |
| F2 | Pedala: stati senza rullo (B1–B5, C5) da `useRullo()`; chip del rullo e foglio C6 | 2, C6 |
| F3 | Dove: foglio (colonna sul computer) coi pezzi di `World.tsx` (carta, `RidesTab`, `FreeTab`, `LoopTab`, `AbTab`) ripresi come contenuto; filtri; Tuoi giri; Grandi salite; Scheda da Pedala; `/mondo` e `/salite` → redirect | D1, D2, P1 |
| F4 | Come: segmento dai `tipiAmmessi()`, bersaglio − +, foglio Allenamento (E1), giri − + con `stimaSecondi`/`giriPer`, va e torna (E2), riga «Anello per N min», fantasma, «Via» → `/ride?${intentoInSearch()}`; `scelta.ts` in kv `pedala` | C1–C4, E1, E2 |
| F5 | Righe sessione, programma, missioni in Pedala; Tu a righe; Diario con gettoni, Importa, «Rifai» nel giro | I3, A2, A3 |
| F6 | Impostazioni (Profilo + Rullo + Prova + Mondi con `usePacco`/`scaricaIntero` + Grafica…); Primo avvio a 4 campi | A4, G3, I1 |
| F7 | Pulizia: via «Rullo/Simulatore» da `Board` e `World`; Allenamenti senza foglio «Dove e quanto» né «Inizia» (Duplica, Esporta, Nuovo, Importa .zwo, Programmi restano); ClimbDetail senza «In ERG»; Catalogo fuori da Salite; `OfflineBanner` → chip «Offline»; Install in Tu | — |
| F8 | HUD: `RulloChip` al posto del foglio sensori (ricollega se perso), `Bersaglio`, `ProvaBar` (sforzo e 1×4×10× solo in prova), `GiroBadge`, gettone «Leggero»; riepilogo in prova (F4) | H1–H6, O1–O4, G4 |
| F9 | Script: controlli nuovi in `pagine-check`, il percorso dei tocchi in `ui-shot`, i quattro HUD in `corsa-checks`, `game-shot` sulle rotte nuove | — |

### Prove

- `tests/rotte.test.ts`: le 21 rotte vecchie → destinazione del § 2.6 (pura, `redirectFor`).
- `tests/pedala.test.ts`: `vistaPedala(rullo, rete, scelta)` → blocchi visibili per gli 8 stati (mai, cerco, fallito, ios, ricordato, cardio, potenza, rullo) × prova on/off; `giriProposti(workout, profilo)`.
- `tests/pagine.test.ts`: maiuscole e niente «Simulatore» nei testi di `it.ts`.

---

## 4. U-motore — rullo, tipi, giri, rete

### Allowlist

| nuovi | `src/ride/{contract,intento,setup}.ts`, `src/sim/rullo.ts`, `src/domain/stima.ts`, `src/open/passaggi.ts`, `src/lib/rete.ts`, `src/open/coda.ts`, `src/game/commit.ts`, `scripts/offline-check.mjs`, `tests/{rullo,intento,stima,passaggi,prova,offline,coda}.test.ts` |
|---|---|
| modifica | `src/bluetooth/{trainer,support}.ts`, `src/sim/{source,engine,simulator,recovery}.ts`, `src/open/{session,world,offline,pronto,tiles,progress,lastRide,WorldScene}.ts\|tsx`, `src/game/{rideGame,ghosts}.ts`, `src/domain/{types,workouts,plans}.ts`, `src/store/useApp.ts`, `vite.config.ts`, `tests/{engine,trainer,world}.test.ts` |
| `src/pages/Ride.tsx` | **solo** sopra `function RideScreen` (setup, `RidePage`, `RideSession`, hook), più lo spostamento del corpo di `commitProgress` in `src/game/commit.ts` lasciando una chiamata. |
| vietati | `src/pages/*` (tranne la riga sopra), `src/components/*`, `src/App.tsx`, `src/i18n/*`, gli script di U-flusso |

### Passi

| # | cosa |
|---|---|
| M0 | **Prima di tutto, ≤ 2 h**: `contract.ts`, `intento.ts`; `rullo.ts` attorno a un `BluetoothTrainer` unico (stato, capacità, ricordato in kv, rullo finto per A23); `useRideSetup` → `src/ride/setup.ts` con `intentoDaSearch`; `commitProgress` → `src/game/commit.ts`. Senza `puoPedalare` la corsa torna a `/`. `BluetoothTrainer.mode` non parte più `'simulator'`. Push sul ramo condiviso: U-flusso tocca `Ride.tsx` solo dopo. |
| M1 | Tipi: `engine.tipo`, `setWattFissi` (ERG costante), `allora` (= `powerTarget` di oggi), allenamento **a bersaglio** quando `!sa.erg` (nessun `SetTargetPower`); il punto di ripresa salva tipo, watt, giri. |
| M2 | Giri: `chiuso()`, `passaggi()`; `WorldSession` con `giri`, `giro`, `traguardoFra`, tempo per giro; giro in più se l'allenamento continua (avviso «Giro in più»); va e torna con l'inversione; regole di fine del § 0 A12–A13; classifica per tipo (A10). |
| M3 | Stima: `stimaSecondi`, `wattMedi`, `giriPer`. |
| M4 | Prova: `settings.prova`, `?prova=1`; `RideGame.ranked=false`; `commit.ts` salta `postResult`, `postXp`, carriera, fantasma; `Ride.prova=true`; `esportabile(ride)`. |
| M5 | Rete: `useRete`, `usePacco`, scarico automatico del leggero dopo il primo avvio; `WorldScene` in modo leggero (terreno lontano anche vicino, la strada lo spiana sotto di sé, niente `b/` né `dem/`); `pronto` dice `leggero` subito; meteo sereno offline; `coda.ts` per i tempi; `vite.config.ts`: `manifest.json` del mondo `NetworkFirst`, il resto `/world/` resta `CacheFirst`. |
| M6 | Link: `workoutRideLink`, `plans.ts`, `lastRide.ts`, `recovery.ts` passano da `intentoInSearch`. |

### Prove

- `rullo.test.ts`: `tipiAmmessi` sui 7 stati di A8 + prova; il rullo vince sulla prova; `sorgente()` non è mai il simulatore con prova spenta.
- `intento.test.ts`: andata e ritorno di `intentoInSearch`/`intentoDaSearch`; le 9 righe di compatibilità del § 2.2.
- `stima.test.ts`: `stimaSecondi` contro il motore con `SimulatorSource` in ERG agli stessi watt, sulla Ganda e su 10 km piatti: scarto ≤ 10 %.
- `passaggi.test.ts`: `chiuso()` vero per `ganda`, falso per `selvino`; 3 passaggi su un anello = 3 × lunghezza ± 1 m; va e torna alterna i tratti rovesciati; giro in più con l'allenamento non finito; fine al traguardo con l'allenamento finito prima.
- `engine.test.ts`: `setWattFissi` → `mode='erg'`, `targetPower`; `trainer.test.ts`: un `SetTargetPower` coi watt nuovi entro 1 s; nessun comando SIM in ERG; con `!erg` nessun comando di potenza.
- `prova.test.ts`: con prova zero chiamate a `postResult` e `postXp`, carriera invariata, `Ride.prova === true`.
- `offline.test.ts`: lo stato `leggero` coi soli file di A15; `readyReason` → `leggero` subito; pacco di Bergamo ≤ 7 MB dal manifesto.
- `coda.test.ts`: tempo offline in coda, spedito una volta sola al ritorno della rete.

---

## 5. Collaudi e soglie

Macchina da 8 GB: un `vite preview` alla volta, Chrome e server chiusi a fine giro (`taskkill /PID`). Classifiche e stanze si collaudano sulla porta 4173 (il Worker accetta solo 4173 e 5173).

| cosa | soglia | chi | come |
|---|---|---|---|
| Voci della barra | 3, bersagli ≥ 44 px | U-flusso | `pagine-check` |
| Tocchi, 7 casi del § 1 | ≤ 3; allenamento con anello nuovo ≤ 4; ripeti = 1 | U-flusso | `ui-shot`, rullo finto: clic contati da `/` a `world-ready=yes` |
| Collegamento | 2 tocchi per apertura, 0 alla seconda corsa | U-flusso | `ui-shot` |
| Senza rullo, prova spenta | Pedala: solo `pedala-collega`; nessun `pedala-dove/come/via`; `/ride?world=bergamo&ride=ganda` → `/` | U-flusso + U-motore | `pagine-check` |
| «Simulatore» a schermo | 0 su tutte le pagine | U-flusso | `pagine-check` |
| Primo schermo di Pedala, 390×844 | un tasto pieno; `pedala-via` finisce ≤ 780 px | U-flusso | `ui-shot` |
| Testi | maiuscola iniziale, niente ellissi nel primo schermo, niente «XP» | U-flusso | `pagine-check` (controlli già esistenti) |
| HUD per tipo | 4 schermate 390×844 + 4 a 844×390; nessun tasto pieno in corsa; `sim-controls` solo in prova | U-flusso | `corsa-checks` |
| Bersaglio | «+» → `ride-bersaglio` +5 W entro 150 ms; comando al rullo entro 1 s | tutte e due | `corsa-checks`, `trainer.test` |
| Giri | «Giro 1 di 2» → «Giro 2 di 2» al traguardo; riepilogo coi due tempi | tutte e due | `corsa-checks` in prova a 10× su un anello corto |
| Stima | ±10 % | U-motore | `stima.test` |
| Offline, apertura | Pedala visibile ≤ 1,5 s dal service worker | U-motore | `offline-check` (`setOffline(true)`, ricarica) |
| Offline, corsa nel leggero | `world-ready` ≤ 8 s, `data-reason=leggero`; nessuna richiesta a `/dem/` o `/b/` | U-motore | `offline-check` |
| Pacco leggero | ≤ 2,6 MB scaricati, ≤ 7 MB in cache (Bergamo) | U-motore | `offline-check` |
| JS iniziale | `index-*.js` ≤ base + 15 kB gzip (base misurata al primo commit) | tutte e due | `npm run build` |
| Prova | 0 `postResult`/`postXp`; gettone nel Diario; niente «Esporta» | U-motore + U-flusso | `prova.test`, `pagine-check` |
| Dati | db `allenando`, versione invariata; un giro salvato prima del rilascio si apre nel Diario dopo | U-motore | collaudo con un profilo pieno, ricarica |
| Rotte vecchie | 21 → destinazione del § 2.6, nessuna pagina bianca | U-flusso | `rotte.test` + `pagine-check` |
| Prove | `npm test` verde, `npm run build` verde | tutte e due | |

---

## 6. Ordine, rischi

**Ordine.** M0 (U-motore) → push. U-flusso intanto fa F1, F2 (con `useRullo` finto), F3, F5, F6, che non toccano `Ride.tsx`. Poi le due piste vanno avanti insieme. Integrazione: ramo `claude/u-rilascio` con le due PR; `KNOWN_LIMITATIONS.md` e `README.md` li scrive chi integra, dalle righe che ogni PR mette nella sua descrizione. Collaudi completi una volta sola, sull'integrazione.

| rischio | effetto | cosa si fa |
|---|---|---|
| Strada sopra il terreno lontano (passo 100–180 m) nel leggero | strada che galleggia o entra nel pendio | la strada spiana il terreno nel suo corridoio; schermata della Ganda e di Città Alta offline, confronto con l'intero |
| `getDevices()` non c'è su tutti i Chrome | il rullo non ricollega da solo | «Ricollega» resta il percorso normale (B5) |
| Bluefy e link profondi | su iPhone due passaggi a mano | «Copia il link» + «Scarica Bluefy»; nessuna promessa in più |
| `World.tsx` e `WorldPicker.tsx` toccati dal lavoro aperto della pista F | conflitti | U-flusso parte da `main` dopo il merge di F |
| Rullo finto (A23) che scappa in produzione | il simulatore torna dalla porta di servizio | acceso solo da `localStorage['orobia.collaudo']`, mai da URL; una prova lo verifica |
| Giro in più all'infinito con un allenamento lunghissimo su un anello corto | conta dei giri senza fine | tetto di 20 giri; oltre, si prosegue libero (`continueFree` di oggi) |
| Un rullo FTMS vero non è mai stato collaudato (limite noto) | ERG fisso e passaggi SIM ↔ ERG non provati sul ferro | resta il punto 3 del «Collaudo da fare» in `KNOWN_LIMITATIONS.md` |
