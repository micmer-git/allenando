// I percorsi del mondo di Bergamo e i luoghi da riconoscere lungo la strada.
//
// Qui non c'è nessuna coordinata scritta a mano: ogni tappa e ogni luogo è un NOME che si
// cerca nei dati OSM (paesi, cime, passi, chiese, porte, ponti, fiumi). Il navigatore del
// grafo (src/open/graph.ts) collega le tappe sulle strade vere. Poi si controlla che ogni
// luogo stia davvero vicino alla strada: se un nome non si trova, o il luogo cade lontano,
// la costruzione si ferma e lo dice.

import { stepSpeed, STANDARD_AIR } from '../../src/domain/physics';
import type { RoutePrefs, Leg, WorldGraph } from '../../src/open/graph';
import { CLS } from '../../src/open/graph';
import type { Landmark, LandmarkKind, RideDef } from '../../src/open/world';

type Tags = Record<string, string>;

interface Ctx {
  graph: WorldGraph;
  toLocal: (lat: number, lon: number) => [number, number];
  toGeo: (x: number, z: number) => { lat: number; lon: number };
  demAt: (x: number, z: number) => number;
  peaks: { name: string; x: number; z: number; ele: number; pass: boolean; id: number }[];
  places: { name: string; kind: string; x: number; z: number; y: number; id: number }[];
  pois: { type: string; id: number; center: { lat: number; lon: number }; tags: Tags }[];
  rivers: { name: string; kind: string; hw: number; xz: [number, number][]; ys: number[] }[];
  /** tutto quello che ha un nome: edifici, vie, piazze (per i luoghi che OSM non segna come «notevoli») */
  named: { name: string; x: number; z: number }[];
  log: (...a: unknown[]) => void;
}

/** Come si cerca un punto: per nome, nel tipo di dato giusto. `near` scioglie gli omonimi. */
type Q =
  | { place: string; near?: string }
  | { peak: string; near?: string }
  | { pass: string; near?: string }
  | { poi: string | RegExp; near?: string; tag?: [string, string] }
  | { name: string | RegExp; near?: string }
  | { river: string | RegExp };

interface LandmarkSpec {
  q: Q;
  kind: LandmarkKind;
  /** il nome da mostrare, se diverso da quello OSM */
  name?: string;
  note: string;
  /** distanza massima dal percorso: 350 m per ciò che si attraversa, km per ciò che si vede */
  within?: number;
}

interface RideSpec {
  id: string;
  name: string;
  side: string;
  area: RideDef['area'];
  kind: RideDef['kind'];
  blurb: string;
  via: Q[];
  prefs?: RoutePrefs;
  landmarks: LandmarkSpec[];
}

const BERGAMO = 'Bergamo';
const BREMBO = /^(Fiume )?Brembo$/;
const SERIO = /^(Fiume |Torrente )?Serio$/;

export const SPECS: RideSpec[] = [
  {
    id: 'citta-alta',
    name: 'Città Alta e San Vigilio',
    side: 'dalla stazione al castello',
    area: 'citta',
    kind: 'citta',
    blurb: 'Dalla stazione alla Torre dei Caduti, su fino a Porta Sant’Agostino e dentro le Mura: Rocca, Piazza Vecchia e la Corsarola, poi Colle Aperto e i tornanti di San Vigilio.',
    via: [
      { poi: 'Bergamo', tag: ['railway', 'station'] },
      { name: 'Torre dei Caduti' },
      { poi: "Porta Sant'Agostino" },
      { name: 'Piazza Vecchia' },
      { poi: "Porta Sant'Alessandro" },
      { poi: 'Castello di San Vigilio' },
    ],
    prefs: { avoidPedestrian: false },
    landmarks: [
      { q: { name: 'Torre dei Caduti' }, kind: 'torre', note: 'La torre del 1924 sul Sentierone, quarantacinque metri: il cuore di Città Bassa.' },
      { q: { poi: 'Teatro Donizetti' }, kind: 'luogo', note: 'Il teatro intitolato al compositore bergamasco, affacciato sul Sentierone.' },
      { q: { poi: "Porta Sant'Agostino" }, kind: 'porta', note: 'Una delle quattro porte delle Mura venete, col leone di San Marco sulla facciata.' },
      { q: { poi: 'Mura Venete' }, kind: 'mura', note: 'Sei chilometri di bastioni del Cinquecento, patrimonio UNESCO dal 2017: ci si pedala sopra.' },
      { q: { poi: 'Rocca' }, kind: 'castello', note: 'La fortezza trecentesca sul colle di Sant’Eufemia, col parco delle Rimembranze.' },
      { q: { name: 'Piazza Vecchia' }, kind: 'luogo', note: 'Il salotto di Città Alta: la fontana Contarini e il Palazzo della Ragione.' },
      { q: { poi: 'Campanone' }, kind: 'torre', note: 'La Torre Civica: ogni sera alle 22 batte cento rintocchi, l’antico coprifuoco.' },
      { q: { poi: 'Basilica di Santa Maria Maggiore' }, kind: 'chiesa', note: 'Romanica fuori, barocca dentro; accanto la Cappella Colleoni.' },
      { q: { poi: 'Torre del Gombito' }, kind: 'torre', note: 'La torre medievale di Via Gombito, cinquantadue metri, la più alta di Città Alta.' },
      { q: { poi: "Porta Sant'Alessandro" }, kind: 'porta', note: 'La porta verso Colle Aperto, da dove parte la strada per San Vigilio.' },
      { q: { poi: 'Castello di San Vigilio' }, kind: 'castello', note: 'In cima al colle: la vista su Città Alta e su tutta la pianura.' },
    ],
  },
  {
    id: 'maresana',
    name: 'Maresana',
    side: 'da Ponteranica',
    area: 'citta',
    kind: 'salita',
    blurb: 'La salita di casa dei ciclisti bergamaschi: da Ponteranica al colle della Maresana, fra i castagni, con Città Alta alle spalle.',
    via: [{ place: 'Ponteranica' }, { peak: 'Maresana' }],
    landmarks: [
      { q: { place: 'Ponteranica' }, kind: 'paese', note: 'Il paese della partenza, all’imbocco della Valle della Morla.' },
      { q: { river: 'Torrente Morla' }, kind: 'fiume', note: 'Il torrente che scende dalla Maresana e attraversa Bergamo sottoterra.', within: 1500 },
      { q: { peak: 'Maresana' }, kind: 'cima', note: 'Il colle a 546 metri: in cima il prato e la vista sulla città.', within: 700 },
      { q: { peak: 'Canto Alto' }, kind: 'cima', note: 'La montagna di Bergamo, 1146 metri, il primo rilievo sopra la città.', within: 4500 },
      { q: { place: 'Città Alta' }, kind: 'citta', note: 'Alle spalle, sul suo colle: le Mura, il Campanone, le cupole.', within: 4500 },
      { q: { place: 'Sorisole' }, kind: 'paese', note: 'Di là dalla valle, sotto il Canto Alto.', within: 3000 },
    ],
  },
  {
    id: 'selvino',
    name: 'Selvino',
    side: 'da Nembro',
    area: 'seriana',
    kind: 'salita',
    blurb: 'La salita classica della Val Seriana: venti tornanti dal fondovalle del Serio all’altopiano.',
    via: [{ place: 'Nembro' }, { place: 'Selvino' }],
    landmarks: [
      { q: { place: 'Nembro' }, kind: 'paese', note: 'Il paese della partenza, sul Serio.' },
      { q: { river: SERIO }, kind: 'fiume', note: 'Il fiume della valle: scende dal Pizzo Coca e arriva all’Adda.', within: 1500 },
      { q: { peak: 'Monte Podona - Cima Sud' }, name: 'Monte Podona', kind: 'cima', note: 'Il monte che chiude l’altopiano a ovest.', within: 4000 },
      { q: { peak: 'Monte Purito' }, kind: 'cima', note: 'Il dosso sopra Selvino, a destra salendo.', within: 2500 },
      { q: { peak: 'Monte Misma' }, kind: 'cima', note: 'Di là dalla valle: la montagna di Albino e Pradalunga.', within: 9000 },
      { q: { place: 'Selvino' }, kind: 'paese', note: 'L’altopiano di Selvino, quasi mille metri: si arriva in piazza.' },
    ],
  },
  {
    id: 'val-seriana',
    name: 'Val Seriana',
    side: 'da Ranica a Clusone',
    area: 'seriana',
    kind: 'valle',
    blurb: 'Tutta la bassa e media valle lungo il Serio, sulla ciclovia dove c’è: Alzano, Nembro, Albino, Gazzaniga, Ponte Nossa, poi la salita all’altopiano di Clusone.',
    via: [{ place: 'Ranica' }, { place: 'Alzano Lombardo' }, { place: 'Albino' }, { place: 'Gazzaniga' }, { place: 'Ponte Nossa' }, { place: 'Clusone' }],
    prefs: { preferCycleways: true },
    landmarks: [
      { q: { poi: 'Basilica di San Martino' }, kind: 'chiesa', note: 'La basilica di Alzano, con le sagrestie intagliate del Fantoni.', within: 600 },
      { q: { place: 'Nembro' }, kind: 'paese', note: 'Il paese dove comincia la salita di Selvino.', within: 900 },
      { q: { poi: 'Albino Stazione Funivia' }, name: 'Funivia Albino–Selvino', kind: 'funivia', note: 'La funivia che sale in pochi minuti all’altopiano di Selvino: la si vede sopra i tetti.', within: 1800 },
      { q: { river: SERIO }, kind: 'fiume', note: 'Il Serio, compagno di strada per tutta la valle.', within: 800 },
      { q: { place: 'Gazzaniga' }, kind: 'paese', note: 'Media valle: qui la valle si stringe.', within: 900 },
      { q: { place: 'Ponte Nossa' }, kind: 'paese', note: 'Il ponte sul Serio e la strada per la Val del Riso.', within: 700 },
      { q: { poi: 'Oratorio dei Disciplini' }, kind: 'chiesa', note: 'A Clusone: sulla facciata il Trionfo della Morte e la Danza Macabra del 1485.', within: 700 },
    ],
  },
  {
    id: 'colle-gallo',
    name: 'Colle Gallo',
    side: 'da Albino',
    area: 'seriana',
    kind: 'salita',
    blurb: 'Da Albino su per la valle del Lujo fino al colle e al santuario, il passaggio verso la Val Cavallina.',
    via: [{ place: 'Albino' }, { place: 'Abbazia' }, { pass: 'Colle Gallo' }],
    landmarks: [
      { q: { place: 'Albino' }, kind: 'paese', note: 'Il paese della partenza, sul Serio.' },
      { q: { river: SERIO }, kind: 'fiume', note: 'Si lascia il Serio e si risale il Lujo.', within: 1500 },
      { q: { place: 'Abbazia' }, kind: 'paese', note: 'Il borgo dell’abbazia benedettina di San Benedetto in Vall’Alta.' },
      { q: { peak: 'Monte Misma' }, kind: 'cima', note: 'Il monte a destra salendo, 1161 metri.', within: 4500 },
      { q: { peak: 'Monte Gallo' }, kind: 'cima', note: 'Il dosso che dà il nome al colle.', within: 900 },
      { q: { pass: 'Colle Gallo' }, kind: 'passo', note: 'Il colle a 754 metri, col santuario della Madonna del Colle Gallo.', within: 400 },
    ],
  },
  {
    id: 'presolana',
    name: 'Passo della Presolana',
    side: 'da Clusone',
    area: 'seriana',
    kind: 'salita',
    blurb: 'Dall’altopiano di Clusone per Rovetta e Castione, sotto la parete della Presolana, fino al passo verso la Val di Scalve.',
    via: [{ place: 'Clusone' }, { place: 'Rovetta' }, { place: 'Castione della Presolana' }, { place: 'Dorga' }, { pass: 'Passo della Presolana' }],
    landmarks: [
      { q: { place: 'Clusone' }, kind: 'paese', note: 'La capitale dell’altopiano, con la torre dell’orologio planetario.' },
      { q: { place: 'Rovetta' }, kind: 'paese', note: 'Il paese dei pittori Fantoni, sull’altopiano.' },
      { q: { place: 'Castione della Presolana' }, kind: 'paese', note: 'Comincia la salita vera: la Presolana davanti.' },
      { q: { place: 'Dorga' }, kind: 'paese', note: 'Ultimo paese prima dei tornanti finali.' },
      { q: { peak: 'Presolana Occidentale' }, name: 'Presolana', kind: 'cima', note: 'La «regina delle Orobie»: la parete calcarea a 2521 metri.', within: 6000 },
      { q: { peak: 'Monte Pora' }, kind: 'cima', note: 'Di fronte, il monte delle piste da sci.', within: 6000 },
      { q: { pass: 'Passo della Presolana' }, kind: 'passo', note: 'Il passo a 1297 metri: di là la Val di Scalve.', within: 400 },
    ],
  },
  {
    id: 'zambla-nossa',
    name: 'Colle di Zambla',
    side: 'da Ponte Nossa',
    area: 'valli',
    kind: 'salita',
    blurb: 'La Val del Riso dalla Val Seriana: Gorno e le sue miniere, Oneta, poi i prati di Zambla sotto il Pizzo Arera e l’Alben.',
    via: [{ place: 'Ponte Nossa' }, { place: 'Oneta' }, { pass: 'Colle di Zambla' }],
    landmarks: [
      { q: { place: 'Ponte Nossa' }, kind: 'paese', note: 'Il paese della partenza, sul Serio.' },
      { q: { river: 'Riso' }, kind: 'fiume', note: 'Il torrente che dà il nome alla valle.', within: 1500 },
      { q: { poi: 'Museo delle miniere di Gorno' }, name: 'Gorno e le miniere', kind: 'luogo', note: 'Per secoli si è scavato zinco: oggi le gallerie sono un museo.', within: 900 },
      { q: { place: 'Oneta' }, kind: 'paese', note: 'Il paese di Arlecchino, la maschera nata in queste valli.', within: 600 },
      { q: { peak: 'Pizzo Arera' }, kind: 'cima', note: 'La montagna dei fiori rari, 2512 metri.', within: 7000 },
      { q: { peak: 'Monte Alben' }, kind: 'cima', note: 'Il gruppo calcareo sopra Zambla, 2019 metri.', within: 4000 },
      { q: { pass: 'Colle di Zambla' }, kind: 'passo', note: 'Il colle a 1264 metri: di là la Val Serina e la Val Brembana.', within: 400 },
    ],
  },
  {
    id: 'zambla-zogno',
    name: 'Colle di Zambla',
    side: 'da Zogno per la Val Serina',
    area: 'valli',
    kind: 'salita',
    blurb: 'Dalla Val Brembana per la Val Serina: Ambria, Serina, Oltre il Colle, fino al colle che scende in Val Seriana.',
    via: [{ place: 'Zogno' }, { place: 'Ambria' }, { place: 'Serina' }, { place: 'Oltre il Colle' }, { pass: 'Colle di Zambla' }],
    landmarks: [
      { q: { place: 'Zogno' }, kind: 'paese', note: 'Il paese della partenza, in Val Brembana.' },
      { q: { river: BREMBO }, kind: 'fiume', note: 'Il Brembo, che si lascia a Zogno.', within: 1200 },
      { q: { place: 'Ambria' }, kind: 'paese', note: 'Il bivio della Val Serina, sul torrente Ambria.', within: 700 },
      { q: { place: 'Serina' }, kind: 'paese', note: 'Il paese di Palma il Vecchio, il pittore del Cinquecento.', within: 700 },
      { q: { place: 'Oltre il Colle' }, kind: 'paese', note: 'L’ultimo paese prima del colle.', within: 900 },
      { q: { peak: 'Monte Alben' }, kind: 'cima', note: 'Il massiccio che si gira attorno salendo.', within: 5000 },
      { q: { pass: 'Colle di Zambla' }, kind: 'passo', note: 'Il colle a 1264 metri: di là la Val del Riso e la Val Seriana.', within: 400 },
    ],
  },
  {
    id: 'val-brembana',
    name: 'Val Brembana',
    side: 'da Bergamo a San Pellegrino',
    area: 'brembana',
    kind: 'valle',
    blurb: 'Da Bergamo a Villa d’Almè, poi dentro la valle: la stretta di Sedrina, Zogno e le terme liberty di San Pellegrino.',
    via: [{ place: BERGAMO }, { place: "Villa d'Almè" }, { place: 'Sedrina' }, { place: 'Zogno' }, { place: 'San Pellegrino Terme' }],
    landmarks: [
      { q: { place: "Villa d'Almè" }, kind: 'paese', note: 'L’imbocco della Val Brembana.', within: 900 },
      { q: { river: BREMBO }, kind: 'fiume', note: 'Il Brembo: lo si segue fino in fondo alla valle.', within: 800 },
      { q: { place: 'Sedrina' }, kind: 'paese', note: 'La valle si stringe in una forra: i ponti uno sopra l’altro.', within: 900 },
      { q: { peak: 'Canto Alto' }, kind: 'cima', note: 'A destra all’uscita da Bergamo.', within: 6000 },
      { q: { place: 'Zogno' }, kind: 'paese', note: 'Il paese del Museo della Valle.', within: 800 },
      { q: { poi: 'Ex-Casinò Municipale' }, name: 'Casinò di San Pellegrino', kind: 'luogo', note: 'Il casinò liberty del 1906, simbolo delle terme.', within: 600 },
      { q: { name: 'Grand Hotel San Pellegrino' }, kind: 'luogo', note: 'Il grande albergo della Belle Époque, sulla riva del Brembo.', within: 600 },
    ],
  },
  {
    id: 'ciclovia-brembana',
    name: 'Ciclovia della Val Brembana',
    side: 'da San Pellegrino a Piazza Brembana',
    area: 'brembana',
    kind: 'valle',
    blurb: 'Sulla vecchia ferrovia della valle, fra gallerie e ponti sul Brembo: San Giovanni Bianco, il borgo del Cornello, Lenna e Piazza Brembana.',
    via: [{ place: 'San Pellegrino Terme' }, { place: 'San Giovanni Bianco' }, { place: 'Lenna' }, { place: 'Piazza Brembana' }],
    prefs: { preferCycleways: true },
    landmarks: [
      { q: { place: 'San Pellegrino Terme' }, kind: 'paese', note: 'La città delle terme e dell’acqua minerale.' },
      { q: { river: BREMBO }, kind: 'fiume', note: 'Il Brembo, sotto la vecchia ferrovia.', within: 600 },
      { q: { place: 'San Giovanni Bianco' }, kind: 'paese', note: 'Il paese dei ponti, dove arriva la Val Taleggio.', within: 700 },
      { q: { poi: 'Cornello dei Tasso' }, kind: 'luogo', note: 'Il borgo medievale dei Tasso, gli inventori della posta europea.', within: 1200 },
      { q: { place: 'Lenna' }, kind: 'paese', note: 'Alla confluenza dei due rami del Brembo.', within: 700 },
      { q: { place: 'Piazza Brembana' }, kind: 'paese', note: 'Il capolinea della ferrovia, il cuore dell’alta valle.', within: 700 },
    ],
  },
  {
    id: 'foppolo',
    name: 'Foppolo',
    side: 'da Piazza Brembana',
    area: 'brembana',
    kind: 'salita',
    blurb: 'Su per il ramo di Carona: Branzi e il suo formaggio, poi i tornanti di Valleve fino alla conca di Foppolo, arrivo del Giro d’Italia.',
    via: [{ place: 'Piazza Brembana' }, { place: 'Branzi' }, { place: 'Valleve' }, { place: 'Foppolo' }],
    landmarks: [
      { q: { place: 'Piazza Brembana' }, kind: 'paese', note: 'La partenza, a 536 metri.' },
      { q: { river: /^(Fiume )?Brembo( di Carona)?$/ }, kind: 'fiume', note: 'Il ramo del Brembo che scende da Carona.', within: 1200 },
      { q: { place: 'Branzi' }, kind: 'paese', note: 'Il paese del formaggio Branzi.', within: 700 },
      { q: { place: 'Valleve' }, kind: 'paese', note: 'Comincia la salita finale.', within: 700 },
      { q: { peak: 'Monte Toro' }, kind: 'cima', note: 'La cima sopra la conca di Foppolo, 2524 metri.', within: 6000 },
      { q: { place: 'Foppolo' }, kind: 'paese', note: 'La conca a 1500 metri: qui sono arrivate tappe del Giro d’Italia.' },
    ],
  },
  {
    id: 'san-marco',
    name: 'Passo San Marco',
    side: 'da Olmo al Brembo',
    area: 'brembana',
    kind: 'salita',
    blurb: 'La Via Priula dei veneziani: da Olmo per Averara e Mezzoldo fino alla Ca’ San Marco e al passo verso la Valtellina, quasi a duemila metri.',
    via: [{ place: 'Olmo al Brembo' }, { place: 'Averara' }, { place: 'Mezzoldo' }, { pass: 'Passo San Marco' }],
    landmarks: [
      { q: { place: 'Olmo al Brembo' }, kind: 'paese', note: 'La partenza, sul ramo di Mezzoldo del Brembo.' },
      { q: { place: 'Averara' }, kind: 'paese', note: 'Il borgo della dogana veneta, con la via porticata affrescata.', within: 900 },
      { q: { river: /^(Fiume )?Brembo( di Mezzoldo)?$/ }, kind: 'fiume', note: 'Il ramo del Brembo che scende dal passo.', within: 1200 },
      { q: { place: 'Mezzoldo' }, kind: 'paese', note: 'L’ultimo paese: poi solo tornanti e pascoli.', within: 700 },
      { q: { poi: 'Cantoniera di San Marco' }, name: 'Ca’ San Marco', kind: 'luogo', note: 'La casa cantoniera del 1593 sulla Via Priula, rifugio dei viandanti.', within: 600 },
      { q: { peak: 'Monte Ponteranica Orientale' }, name: 'Monte Ponteranica', kind: 'cima', note: 'La cima sopra il passo, 2378 metri.', within: 5000 },
      { q: { pass: 'Passo San Marco' }, kind: 'passo', note: 'Il passo a 1991 metri: di là la Valtellina.', within: 400 },
    ],
  },
  {
    // Michele, 04/11/2026: «ganda loop should be added»
    id: 'ganda',
    name: 'Il giro della Ganda',
    side: 'Nembro, Gazzaniga, Orezzo, Selvino',
    area: 'seriana',
    kind: 'giro',
    blurb: 'L’anello della media valle: su per il Serio fino a Gazzaniga, la salita di Orezzo fino al Passo di Ganda, l’altopiano di Aviatico e Selvino, poi giù per i tornanti fino a Nembro.',
    via: [{ place: 'Nembro' }, { place: 'Albino' }, { place: 'Gazzaniga' }, { place: 'Orezzo' }, { pass: 'Passo di Ganda' }, { place: 'Aviatico' }, { place: 'Selvino' }, { place: 'Nembro' }],
    landmarks: [
      { q: { place: 'Nembro' }, kind: 'paese', note: 'Partenza e arrivo, sul Serio.' },
      { q: { river: SERIO }, kind: 'fiume', note: 'Il Serio, fino a Gazzaniga.', within: 1500 },
      { q: { place: 'Gazzaniga' }, kind: 'paese', note: 'Media valle: qui si lascia il fondovalle e comincia la salita.', within: 900 },
      { q: { place: 'Orezzo' }, kind: 'paese', note: 'La frazione di Gazzaniga a metà salita, sopra la valle.', within: 700 },
      { q: { pass: 'Passo di Ganda' }, kind: 'passo', note: 'Il passo a 1056 metri fra la Val Seriana e l’altopiano di Selvino.', within: 500 },
      { q: { place: 'Aviatico' }, kind: 'paese', note: 'Il paese dell’altopiano, coi prati e il Monte Cornagera.', within: 900 },
      { q: { place: 'Selvino' }, kind: 'paese', note: 'L’altopiano a quasi mille metri: poi venti tornanti in discesa.', within: 900 },
      { q: { peak: 'Monte Misma' }, kind: 'cima', note: 'Di là dalla valle, salendo verso Orezzo.', within: 9000 },
    ],
  },
  {
    // Michele, 07/11/2026: «berghem mola mia percorsi as possible choices as well? find online paths?»
    // Il tracciato è quello raccontato dal servizio di Bergamo TV (L'Eco di Bergamo) sulla granfondo
    // di Gazzaniga: Nembro, la salita di Selvino col primo ristoro, Serina, Oltre il Colle, il Passo
    // di Zambla col secondo ristoro, la discesa su Ponte Nossa e il rientro. Il GPX ufficiale non è
    // in rete (cercato il 07/11/2026: trainerday, granfondobgy, ecodibergamo, komoot): fra una tappa
    // e l'altra la strada la sceglie il navigatore, come per gli altri percorsi.
    id: 'berghem-corto',
    name: 'Berghem MolaMia · corto',
    side: 'Gazzaniga, Selvino, Zambla, Ponte Nossa',
    area: 'seriana',
    kind: 'giro',
    blurb: 'Il percorso corto della granfondo di Gazzaniga: giù a Nembro, su per i tornanti di Selvino, la Val Serina fino a Oltre il Colle e al Colle di Zambla, poi la discesa della Val del Riso fino a Ponte Nossa e il rientro lungo il Serio.',
    via: [{ place: 'Gazzaniga' }, { place: 'Nembro' }, { place: 'Selvino' }, { place: 'Serina' }, { place: 'Oltre il Colle' }, { pass: 'Colle di Zambla' }, { place: 'Ponte Nossa' }, { place: 'Gazzaniga' }],
    landmarks: [
      { q: { place: 'Gazzaniga' }, kind: 'paese', note: 'Partenza e arrivo della granfondo, in media valle.', within: 900 },
      { q: { river: SERIO }, kind: 'fiume', note: 'Il Serio, all’andata verso Nembro e al ritorno da Ponte Nossa.', within: 1500 },
      { q: { place: 'Nembro' }, kind: 'paese', note: 'Qui si lascia il fondovalle: cominciano i venti tornanti di Selvino.', within: 900 },
      { q: { peak: 'Monte Purito' }, kind: 'cima', note: 'Il dosso sopra Selvino, a destra salendo.', within: 2500 },
      { q: { place: 'Selvino' }, kind: 'paese', note: 'L’altopiano a quasi mille metri: il primo ristoro.', within: 900 },
      { q: { place: 'Serina' }, kind: 'paese', note: 'Il paese di Palma il Vecchio, in fondo alla Val Serina.', within: 700 },
      { q: { place: 'Oltre il Colle' }, kind: 'paese', note: 'L’ultimo paese prima del colle.', within: 900 },
      { q: { peak: 'Monte Alben' }, kind: 'cima', note: 'Il massiccio calcareo che si gira attorno salendo a Zambla.', within: 5000 },
      { q: { pass: 'Colle di Zambla' }, kind: 'passo', note: 'Il colle a 1264 metri: il secondo ristoro, poi solo discesa.', within: 400 },
      { q: { peak: 'Pizzo Arera' }, kind: 'cima', note: 'La montagna dei fiori rari, 2512 metri, sopra la Val del Riso.', within: 7000 },
      { q: { place: 'Ponte Nossa' }, kind: 'paese', note: 'Dove i percorsi della granfondo si dividono: il corto torna a Gazzaniga.', within: 700 },
    ],
  },
  {
    // Il medio: da Ponte Nossa si prosegue per Clusone e si scende al Sebino (Lovere, Castro, Riva di
    // Solto, Solto Collina), poi la Val Cavallina (Endine, Ranzanico, Bianzano) e il colle verso Cene.
    // Stessa fonte del corto; anche qui le strade fra le tappe le sceglie il navigatore.
    id: 'berghem-medio',
    name: 'Berghem MolaMia · medio',
    side: 'Zambla, Clusone, il Sebino, la Val Cavallina',
    area: 'valli',
    kind: 'giro',
    blurb: 'Il percorso medio della granfondo di Gazzaniga: Selvino e il Colle di Zambla come il corto, poi Clusone, la discesa al lago d’Iseo con Lovere e Riva di Solto, la Val Cavallina lungo il lago di Endine e il colle di Bianzano che scende a Cene.',
    via: [
      { place: 'Gazzaniga' },
      { place: 'Nembro' },
      { place: 'Selvino' },
      { place: 'Serina' },
      { place: 'Oltre il Colle' },
      { pass: 'Colle di Zambla' },
      { place: 'Ponte Nossa' },
      { place: 'Clusone' },
      { place: 'Lovere' },
      { place: 'Castro' },
      { place: 'Riva di Solto' },
      { place: 'Solto Collina' },
      { place: 'Endine Gaiano' },
      { place: 'Ranzanico' },
      { place: 'Bianzano' },
      { place: 'Cene' },
      { place: 'Gazzaniga' },
    ],
    landmarks: [
      { q: { place: 'Nembro' }, kind: 'paese', note: 'Qui si lascia il fondovalle: cominciano i tornanti di Selvino.', within: 900 },
      { q: { place: 'Selvino' }, kind: 'paese', note: 'L’altopiano a quasi mille metri: il primo ristoro.', within: 900 },
      { q: { place: 'Serina' }, kind: 'paese', note: 'In fondo alla Val Serina.', within: 700 },
      { q: { pass: 'Colle di Zambla' }, kind: 'passo', note: 'Il colle a 1264 metri: il secondo ristoro.', within: 400 },
      { q: { place: 'Ponte Nossa' }, kind: 'paese', note: 'Il medio non torna indietro: si prosegue verso Clusone.', within: 700 },
      { q: { place: 'Clusone' }, kind: 'paese', note: 'La capitale dell’altopiano, poi giù per la Val Borlezza.', within: 900 },
      { q: { place: 'Lovere' }, kind: 'paese', note: 'Sul lago d’Iseo, uno dei borghi più belli d’Italia.', within: 900 },
      { q: { peak: 'Corna Trentapassi' }, kind: 'cima', note: 'Di là dal lago, la montagna che precipita nel Sebino.', within: 4500 },
      { q: { place: 'Riva di Solto' }, kind: 'paese', note: 'Lungo la riva, sotto gli orridi del Bögn.', within: 900 },
      { q: { place: 'Endine Gaiano' }, kind: 'paese', note: 'Il lago di Endine, in Val Cavallina.', within: 900 },
      { q: { place: 'Bianzano' }, kind: 'paese', note: 'Il borgo del castello: da qui il colle verso la Val Seriana.', within: 900 },
      { q: { place: 'Cene' }, kind: 'paese', note: 'Di nuovo sul Serio, a due passi dall’arrivo.', within: 900 },
    ],
  },
  {
    id: 'due-valli',
    name: 'Il giro delle due valli',
    side: 'Bergamo, Val Seriana, Zambla, Val Brembana',
    area: 'valli',
    kind: 'giro',
    blurb: 'Il grande anello: su per la Val Seriana fino a Ponte Nossa, il Colle di Zambla, giù per la Val Serina e la Val Brembana, ritorno a Bergamo.',
    via: [{ place: BERGAMO }, { place: 'Alzano Lombardo' }, { place: 'Albino' }, { place: 'Ponte Nossa' }, { pass: 'Colle di Zambla' }, { place: 'Serina' }, { place: 'Zogno' }, { place: "Villa d'Almè" }, { place: BERGAMO }],
    landmarks: [
      { q: { poi: 'Basilica di San Martino' }, kind: 'chiesa', note: 'La basilica di Alzano, all’inizio della Val Seriana.', within: 900 },
      { q: { river: SERIO }, kind: 'fiume', note: 'Il Serio, per tutta la prima metà del giro.', within: 800 },
      { q: { place: 'Albino' }, kind: 'paese', note: 'La città del Moroni, il pittore dei ritratti.', within: 900 },
      { q: { place: 'Ponte Nossa' }, kind: 'paese', note: 'Si lascia la Val Seriana per la Val del Riso.', within: 700 },
      { q: { pass: 'Colle di Zambla' }, kind: 'passo', note: 'Il colle a 1264 metri, il punto più alto del giro.', within: 400 },
      { q: { place: 'Serina' }, kind: 'paese', note: 'Giù per la Val Serina.', within: 700 },
      { q: { river: BREMBO }, kind: 'fiume', note: 'Il Brembo, compagno del ritorno.', within: 800 },
      { q: { place: 'Zogno' }, kind: 'paese', note: 'Di nuovo in Val Brembana.', within: 800 },
    ],
  },
];

// ---------- macchinario ----------

const norm = (s: string) => s.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();

function matches(name: string | undefined, want: string | RegExp): boolean {
  if (!name) return false;
  if (typeof want === 'string') return norm(name) === norm(want);
  return want.test(name.replace(/[’`]/g, "'"));
}

interface Pt {
  name: string;
  x: number;
  z: number;
}

function makeResolver(ctx: Omit<Ctx, 'graph'>) {
  const poiPts = ctx.pois.map((p) => {
    const [x, z] = ctx.toLocal(p.center.lat, p.center.lon);
    return { name: p.tags.name, x, z, tags: p.tags };
  });
  const placeByName = (n: string) => ctx.places.find((p) => norm(p.name) === norm(n) && (p.kind === 'city' || p.kind === 'town' || p.kind === 'village'));

  function anchor(near?: string): Pt | null {
    if (!near) return null;
    const p = placeByName(near);
    return p ? { name: p.name, x: p.x, z: p.z } : null;
  }

  /** Tutti i candidati di una ricerca; il chiamante sceglie il più vicino a qualcosa. */
  function candidates(q: Q): Pt[] {
    if ('place' in q) return ctx.places.filter((p) => matches(p.name, q.place)).map((p) => ({ name: p.name, x: p.x, z: p.z }));
    if ('peak' in q) return ctx.peaks.filter((p) => !p.pass && matches(p.name, q.peak)).map((p) => ({ name: p.name, x: p.x, z: p.z }));
    if ('pass' in q) return ctx.peaks.filter((p) => matches(p.name, q.pass)).map((p) => ({ name: p.name, x: p.x, z: p.z }));
    if ('poi' in q) {
      const list = poiPts.filter((p) => matches(p.name, q.poi) && (!q.tag || p.tags[q.tag[0]] === q.tag[1]));
      // una stessa cosa compare come nodo, come via e come edificio: si tengono i distinti
      const out: Pt[] = [];
      for (const p of list) if (!out.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 60)) out.push({ name: p.name, x: p.x, z: p.z });
      return out;
    }
    if ('name' in q) {
      const out: Pt[] = [];
      for (const p of [...poiPts, ...ctx.named]) if (matches(p.name, q.name) && !out.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 60)) out.push({ name: p.name, x: p.x, z: p.z });
      return out;
    }
    const want = q.river;
    const r = ctx.rivers.filter((rv) => matches(rv.name, want) || (typeof want === 'string' && matches(rv.name, `Fiume ${want}`)));
    return r.flatMap((rv) => rv.xz.filter((_, i) => i % 3 === 0).map(([x, z]) => ({ name: rv.name, x, z })));
  }

  function resolve(q: Q, ref: Pt | null): Pt {
    const list = candidates(q);
    if (list.length === 0) throw new Error(`non trovo ${JSON.stringify(q, (_, v) => (v instanceof RegExp ? String(v) : v))}`);
    const near = ('near' in q && q.near ? anchor(q.near) : null) ?? ref;
    if (!near) return list[0];
    return list.reduce((a, b) => (Math.hypot(a.x - near.x, a.z - near.z) <= Math.hypot(b.x - near.x, b.z - near.z) ? a : b));
  }

  return { candidates, resolve, anchor };
}

/** Le tappe di tutti i percorsi, risolte: il costruttore ci spezza le strade. */
export function resolveWaypoints(ctx: Omit<Ctx, 'graph'>): Pt[] {
  const { resolve, anchor } = makeResolver(ctx);
  const out: Pt[] = [];
  for (const spec of SPECS) {
    const pts: Pt[] = [];
    for (const q of spec.via) pts.push(resolve(q, pts[pts.length - 1] ?? anchor(BERGAMO)));
    out.push(...pts);
  }
  return out;
}

export function buildRides(ctx: Ctx): { rides: RideDef[]; landmarks: Landmark[]; limits: Record<string, { timedM: number; minSec: number }> } {
  const { graph } = ctx;
  const { candidates, resolve, anchor } = makeResolver(ctx);
  const landmarks = new Map<string, Landmark>();
  const rides: RideDef[] = [];
  const limits: Record<string, { timedM: number; minSec: number }> = {};

  for (const spec of SPECS) {
    // tappe: ognuna si scioglie vicino alla precedente (i paesi omonimi esistono)
    const pts: Pt[] = [];
    for (const q of spec.via) pts.push(resolve(q, pts[pts.length - 1] ?? anchor(BERGAMO)));
    // le piste solo per chi le vuole: a Nembro il punto del paese cade su un anellino di pista in
    // porfido, e Selvino e la Ganda partivano lì con un incrocio dopo 8 m
    const road = (e: { cls: number }) => e.cls !== CLS.trunk && e.cls !== CLS.pedestrian && (spec.prefs?.preferCycleways || e.cls !== CLS.cycleway);
    // all'incrocio scelto: niente piste (se il percorso non le cerca) e niente zone pedonali (se le evita)
    const fits = (e: { cls: number }) => (spec.prefs?.preferCycleways || e.cls !== CLS.cycleway) && (spec.prefs?.avoidPedestrian === false || e.cls !== CLS.pedestrian);
    const onlyRoads = (n: number) => graph.edgesAt(n).every((k) => fits(graph.edges[k]));
    /** il nodo più vicino che tocca solo strade (e non è un vicolo cieco) */
    const roadNode = (x: number, z: number): number | null => {
      let best: number | null = null;
      let bestD = Infinity;
      for (const id of graph.edgesNear(x, z, 350)) {
        if (!road(graph.edges[id])) continue;
        for (const n of [graph.edges[id].a, graph.edges[id].b]) {
          if (graph.edgesAt(n).length < 2 || !onlyRoads(n)) continue;
          const d = Math.hypot(graph.nodeX[n] - x, graph.nodeZ[n] - z);
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
      }
      return best;
    };
    const nodes = pts.map((p) => {
      // si aggancia a un incrocio vero di una strada percorribile, non al fondo di un vicolo
      let n =
        graph.nearestNode(p.x, p.z, 350, (e) => road(e) && graph.edgesAt(e.a).length > 1 && graph.edgesAt(e.b).length > 1) ??
        graph.nearestNode(p.x, p.z, 600, (e) => e.cls !== CLS.trunk);
      // se quell'incrocio tocca una pista o una zona pedonale, il navigatore ci passerebbe sopra
      if (n != null && !onlyRoads(n)) n = roadNode(p.x, p.z) ?? n;
      if (n == null) throw new Error(`${spec.id}: nessuna strada vicino a ${p.name}`);
      return n;
    });
    const legs: Leg[] = [];
    for (let i = 0; i + 1 < nodes.length; i++) {
      const part = graph.route(nodes[i], nodes[i + 1], spec.prefs);
      if (!part) throw new Error(`${spec.id}: non trovo la strada da ${pts[i].name} a ${pts[i + 1].name}`);
      legs.push(...part);
    }
    // campionamento a 10 m: quota, distanza, pianta
    const xs: number[] = [];
    const zs: number[] = [];
    const ys: number[] = [];
    const ds: number[] = [];
    let dist = 0;
    for (const l of legs) {
      const e = graph.edges[l.edge];
      const n = Math.max(1, Math.ceil(e.length / 10));
      for (let k = xs.length ? 1 : 0; k <= n; k++) {
        const s = l.dir > 0 ? (e.length * k) / n : e.length - (e.length * k) / n;
        const p = graph.pose(l.edge, s, l.dir);
        if (xs.length) dist += Math.hypot(p.x - xs[xs.length - 1], p.z - zs[zs.length - 1]);
        xs.push(p.x);
        zs.push(p.z);
        ys.push(p.y);
        ds.push(dist);
      }
    }
    const lengthM = dist;
    let gain = 0;
    for (let i = 1; i < ys.length; i++) if (ys[i] > ys[i - 1]) gain += ys[i] - ys[i - 1];
    let maxGrade = 0;
    let maxAt = 0;
    for (let i = 0, j = 0; i < ds.length; i++) {
      while (j < ds.length - 1 && ds[j] - ds[i] < 200) j++;
      if (ds[j] - ds[i] >= 190) {
        const g = (ys[j] - ys[i]) / (ds[j] - ds[i]);
        if (g > maxGrade) {
          maxGrade = g;
          maxAt = i;
        }
      }
    }
    if (process.env.WORLD_DEBUG) {
      const roads: string[] = [];
      let acc = 0;
      let last = '';
      for (const l of legs) {
        const e = graph.edges[l.edge];
        const label = e.name || e.ref || `(cls ${e.cls})`;
        if (label !== last) {
          if (last) roads.push(`${last} ${(acc / 1000).toFixed(1)}`);
          last = label;
          acc = 0;
        }
        acc += e.length;
      }
      roads.push(`${last} ${(acc / 1000).toFixed(1)}`);
      ctx.log(`    strade: ${roads.filter((r) => !r.endsWith(' 0.0')).join(' › ')}`);
      const hit = graph.nearest(xs[maxAt], zs[maxAt], 30);
      const geo = ctx.toGeo(xs[maxAt], zs[maxAt]);
      ctx.log(`    pendenza massima a km ${(ds[maxAt] / 1000).toFixed(2)} ${geo.lat.toFixed(5)},${geo.lon.toFixed(5)} ${hit ? graph.edges[hit.edge].name + ' cls ' + graph.edges[hit.edge].cls : ''}`);
    }
    const climb = longestClimb(ds, ys);

    const ride: RideDef = {
      id: spec.id,
      name: spec.name,
      side: spec.side,
      area: spec.area,
      kind: spec.kind,
      blurb: spec.blurb,
      legs: legs.map((l) => [l.edge, l.dir]),
      lengthM: Math.round(lengthM),
      gainM: Math.round(gain),
      startAlt: Math.round(ys[0]),
      endAlt: Math.round(ys[ys.length - 1]),
      maxAlt: Math.round(Math.max(...ys)),
      climbGrade: Math.round(climb.grade * 1000) / 1000,
      maxGrade: Math.round(maxGrade * 1000) / 1000,
      landmarks: [],
      timed: [0, Math.round(lengthM)],
    };

    // i luoghi, ognuno proiettato sul percorso
    for (const ls of spec.landmarks) {
      const list = candidates(ls.q);
      if (list.length === 0) throw new Error(`${spec.id}: non trovo il luogo ${JSON.stringify(ls.q, (_, v) => (v instanceof RegExp ? String(v) : v))}`);
      let best = { off: Infinity, at: 0, p: list[0] };
      for (const p of list) {
        for (let i = 0; i < xs.length; i++) {
          const off = Math.hypot(xs[i] - p.x, zs[i] - p.z);
          if (off < best.off) best = { off, at: ds[i], p };
        }
      }
      const within = ls.within ?? 350;
      if (best.off > within) throw new Error(`${spec.id}: «${ls.name ?? best.p.name}» è a ${Math.round(best.off)} m dal percorso (massimo ${within})`);
      const name = ls.name ?? best.p.name;
      const id = slug(name);
      if (!landmarks.has(id)) {
        landmarks.set(id, { id, name, kind: ls.kind, x: Math.round(best.p.x * 10) / 10, z: Math.round(best.p.z * 10) / 10, y: Math.round(ctx.demAt(best.p.x, best.p.z)), note: ls.note });
      }
      ride.landmarks.push({ id, at: Math.round(best.at), off: Math.round(best.off) });
    }
    if (ride.landmarks.length < 5) throw new Error(`${spec.id}: servono almeno 5 luoghi, ne ha ${ride.landmarks.length}`);
    ride.landmarks.sort((a, b) => a.at - b.at);

    limits[spec.id] = { timedM: ride.timed[1] - ride.timed[0], minSec: Math.floor(proTime(ds, ys) * 0.85) };
    rides.push(ride);
    ctx.log(
      `  ${spec.id.padEnd(16)} ${(lengthM / 1000).toFixed(1).padStart(5)} km  D+ ${String(Math.round(gain)).padStart(4)} m  ${ride.startAlt}→${ride.endAlt} m  salita ${(climb.grade * 100).toFixed(1)}% su ${(climb.len / 1000).toFixed(1)} km  max200 ${(maxGrade * 100).toFixed(1)}%  luoghi ${ride.landmarks.length}`,
    );
  }
  return { rides, landmarks: [...landmarks.values()], limits };
}

/** Il tratto in salita più lungo (dislivello), tollerando contropendenze di 15 m. */
function longestClimb(ds: number[], ys: number[]): { grade: number; len: number } {
  let best = { gain: 0, grade: 0, len: 0 };
  let start = 0;
  let low = 0;
  for (let i = 1; i < ys.length; i++) {
    if (ys[i] < ys[low]) low = i;
    let top = start;
    for (let k = start; k <= i; k++) if (ys[k] > ys[top]) top = k;
    if (ys[top] - ys[i] > 15) {
      start = i;
      low = i;
      continue;
    }
    const gain = ys[i] - ys[start];
    if (gain > best.gain && ds[i] > ds[start]) best = { gain, grade: gain / (ds[i] - ds[start]), len: ds[i] - ds[start] };
    if (ys[i] < ys[start]) start = i;
  }
  return best;
}

/** Il tempo di un professionista a potenza costante (6,8 W/kg, 70 kg): il limite sotto cui un tempo non è credibile. */
function proTime(ds: number[], ys: number[]): number {
  const p = { massKg: 77, cda: 0.26, crr: 0.0035, ...STANDARD_AIR };
  const watts = 6.8 * 70;
  let t = 0;
  let v = 8;
  let d = 0;
  let i = 0;
  const L = ds[ds.length - 1];
  while (d < L && t < 36000) {
    while (i < ds.length - 2 && ds[i + 1] < d) i++;
    const g = (ys[i + 1] - ys[i]) / (ds[i + 1] - ds[i] || 1);
    v = stepSpeed(watts, v, g, 0.5, p);
    // in discesa nessuno scende a 90 km/h in curva: tetto a 70
    v = Math.min(v, 19.5);
    d += v * 0.5;
    t += 0.5;
  }
  return t;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
