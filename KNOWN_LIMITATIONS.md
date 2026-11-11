# Limiti noti — OROBIA (già ALLENANDO)

## Il gioco

- Oro, guardaroba, traguardi e record stanno sul dispositivo: cancellare i dati del sito li perde, e non passano da un telefono all’altro.
- Le classifiche non sono un’autenticazione: il server scarta i tempi impossibili ma non può sapere se un tempo è stato fatto davvero. Il rullo e il simulatore stanno in classifiche separate.
- I tratti dei percorsi si ricavano dal profilo con una regola: un GPM, una volata, una crono. Se il mondo viene ricostruito con dati OSM diversi, un tratto può spostarsi di qualche metro e cambiare record.
- Le volate del cassonetto si ricavano dove la strada entra in piano in un paese: citta-alta, maresana, selvino, colle-gallo e zambla-nossa non ne hanno.
- Gli archi in ERG trasformano il tempo in distanza con la velocità del momento: se si cambia ritmo all’ultimo, l’arco e il cambio di passo possono distare qualche secondo. Sulle salite verificate il giro finisce in cima anche se l’allenamento no.
- I monumenti sono procedurali, per archetipo: impronta e posizione sono quelle vere di OSM, altezze e dettagli a occhio (OSM dà l’altezza solo per Campanone, Grand Hotel e Mausoleo Briolini). Le pose delle statue sono generiche. Mancano i propilei di Porta Nuova e la statua del Colleoni, che in OSM non ci sono come servirebbe.
- Il giro libero, al bordo del mondo, trova strade tagliate: lì «dritto» può fare qualche inversione.
- Il gruppo delle sessioni è virtuale e non aspetta nessuno: chi si stacca resta staccato. Le sessioni dipendono dall’orologio del telefono; un orologio sbagliato di minuti fa partire in un momento diverso dagli altri.
- Salvataggio e ripresa: il giro si mette da parte ogni 15 s, in pausa e alla chiusura della scheda; se il telefono la uccide di colpo si perdono al massimo quei 15 s. Un giro libero ripreso riparte dal punto in cui era, e la carta del riepilogo mostra solo il tratto dopo la ripresa. «Salva com’è» mette il giro nel diario ma non assegna né oro né punti. Aprendo un altro giro mentre ce n’è uno a metà, quello vecchio va nel diario da solo. Anche un giro di pochi secondi finisce nel diario: si scarta dal riepilogo.
- La pausa automatica (3 s a 0 W e 0 rpm col rullo) è provata solo dalle prove sul motore, non con un rullo vero.
- Il fantasma del record si registra solo con un giro intero dal via, restando sul percorso, senza allenamento né replay. Se ci sono quello del percorso e quello di un tratto, vince il percorso.
- I `.zwo` di Zwift: FreeRide e MaxEffort, che lì si pedalano a sensazione, in ERG diventano 55% e 150% dell’FTP; le scritte a tempo si scartano.

## Due mondi (pista F del 07/11/2026)

- I traguardi e la serie del Sellaronda contano sugli id dei percorsi e dei passi (`src/game/passes.ts`): `sellaronda`, `sellaronda-orario`, `sella-canazei`, `pordoi-arabba`, `pordoi-canazei`, `gardena-corvara`, `gardena-selva`, `campolongo-corvara`, `fedaia-canazei`, luoghi `passo-sella`, `passo-pordoi`, `passo-gardena`, `passo-campolongo`. «Berghem MolaMia» cerca `berghem-molamia` o `berghem-molamia-corto`, che nei percorsi di Bergamo non ci sono: il traguardo resta muto.
- Il catalogo (`src/open/worlds.ts`) legge nomi, zone e paesi da `WORLDS` (`src/open/world-table.ts`) e ci aggiunge centro e riquadro. L'ultimo mondo si ricorda in localStorage (`orobia.world`) con una copia in kv (`mondo`).
- Le sessioni ogni mezz'ora restano sui percorsi di Bergamo: `SESSION_WORLD` è vuoto e la rotazione non include ancora i percorsi del Sellaronda. Il codice del Worker accetta `bergamo` e `sellaronda`, ma GitHub Pages non ripubblica il Worker: finché non si fa `npx wrangler deploy` da `server/allenando-room`, il mondo condiviso e la classifica del Sellaronda sul server in onda rispondono «world».
- «Senza rete» scrive nella cache del service worker senza passare da Workbox: l'espirazione di Workbox (60 giorni, 1500 voci) non conta quei file, e un mondo scaricato resta finché non si preme «Togli» o il browser non libera spazio. Su un browser senza Cache API il riquadro lo dice e non offre lo scarico. Un mondo scaricato a metà (rete caduta) riparte da dove era.
- Il manifesto (`manifest.json`) è un file in più da rigenerare dopo ogni `world:build` (`node scripts/world-manifest.mjs`): se manca, la riga del mondo non dice i km né il peso e lo scarico non si offre.
- Il «mondo» di un giro salvato prima del 07/11/2026 si deduce dal GPS (riquadri in `WORLD_CATALOG`): un giro importato da fuori che cade dentro il riquadro di Bergamo finisce nel filtro «Bergamo».
- La neve del 3D segue il calendario (`snowLine` in `src/open/look.ts`). `snowLine` in `src/open/weather.ts` calcola la quota dal meteo del giorno ma non sposta ancora il terreno.
- La figura dei mondi nell'onboarding è una sagoma disegnata (`WorldArt`), non una schermata del 3D.
- Il nome del percorso nel FIT sta nel messaggio `WORKOUT` (`wkt_name`): Garmin Connect lo mostra, Strava lo ignora e prende il titolo dall'orario.

Passa i test (geometria, terreno sotto la strada, replay, Intervals con API simulata, parser) e la build di produzione. Il mondo 3D è stato visto in Chrome headless (WebGL software) su viewport 390×844. **Non è certificato su un rullo fisico.**

## Il mondo Sellaronda (7 novembre 2026)

- **S1.1** Due mondi, una scelta: la pagina Mondo ricorda l’ultimo mondo scelto (kv `mondo`); le altre pagine (Allenamenti, Classifiche, Diario, cartolina) usano quello, o il prefisso del giro salvato (`sellaronda:pordoi-arabba`). Un giro salvato prima del 7 novembre non ha il prefisso: la cartolina lo mette sulla carta del mondo scelto per ultimo.
- **S1.2** I dati vengono da Overpass, non dall’estratto Geofabrik: il download dipende dalle istanze pubbliche (il 7 novembre overpass-api.de era «at capacity» per ore, lo script ruota su quattro istanze e riprova). L’ossario del Pordoi (il sacrario militare germanico) non è in OSM con un nome né come `historic`, `military` o `cemetery` dentro il mondo: non c’è fra i monumenti, e l’archetipo `ossario` di S2 resta senza un’impronta finché qualcuno non lo disegna in OSM. Il «Lupo Bianco» è il nodo `place=locality` «Pian Schiavaneis», a 165 m dalla strada.
- **S1.3** La roccia per pendenza viene dal DEM a 25 m (Terrain Tiles z13, ~19 m a questa latitudine): le pareti verticali risultano meno ripide di quanto sono, e le cenge larghe meno di 25 m non si vedono. Il bosco sotto i 2100 m è quello di OSM, che in alta Val Badia è incompleto. La neve non è nei dati: la decide S2 per quota e stagione.
- **S1.4** Partenza e arrivo dei percorsi sono i nodi OSM del paese (il centro) e del passo: le salite sono più corte di 300–700 m delle schede che partono dal cartello del paese (Sella da Canazei 11,1 km contro 11,8; Pordoi da Arabba 9,0 contro 9,4). Il giro intero fa 61,5 km contro i 63,7 di BRouter: i due chilometri stanno fra Corvara e il Campolongo, dove BRouter allunga per la frazione e il mondo prende la statale. Le pendenze massime su 200 m (fino al 12%) possono contenere rumore del DEM nei tornanti del Pordoi.
- **S1.5** La scelta del mondo è una riga per mondo, con i km e «Scarica per usarlo senza rete». Il service worker tiene in cache i file di tutti i mondi sotto `allenando-world-v1`. L’app installata attiva il pacchetto nuovo da sola (`skipWaiting`): se la pagina è aperta da meno di 15 secondi si ricarica, altrimenti il nuovo pacchetto arriva alla visita dopo, senza svuotare i dati del sito. I file del mondo già in cache restano (CacheFirst, 60 giorni) finché l’indirizzo non cambia.
- **S1.6** Il Worker accetta `bergamo|sellaronda` dal codice condiviso, ma **non è ripubblicato da questa PR**: fino al `wrangler deploy` del coordinatore il mondo condiviso e la classifica del Sellaronda rispondono «world» (rifiuto) sul server in onda.
- **S1.7** La prova «terreno sotto la strada» confronta il dato (strada livellata contro DEM a 25 m: entro 15 m nel 92% dei punti, mai oltre 40 fuori da ponti e gallerie), non il raccordo del browser.
- **S1.8** Il mondo pesa 2,5 MB (contro i 22 di Bergamo: un ottavo dell’area, 279 km di strade): 1043 cime nell’orizzonte (ogni cima oltre i 900 m) e 1345 piloni stanno in `features.json`; se S2 non li usa tutti si possono sfoltire.

## Geometria e quota

- La strada è ricostruita da dati aperti: precisione di qualche metro, non di centimetri. La quota è livellata entro ±8–11 m dal DEM a 25 m; le pendenze di picco su 100 m (fino a ~24%) possono contenere ancora rumore del DEM nei tornanti.
- Partenza e arrivo sono i nodi OSM del paese e del passo: lunghezza e dislivello differiscono di qualche centinaio di metri dalle schede ufficiali.
- Il percorso è calcolato da OSRM (profilo auto) sulle strade OSM. Per il Mortirolo da Mazzo segue la Strada del Mortirolo e l’ultimo tratto sulla SS42 dir/A fino al passo: va confrontato con un GPX di riferimento.
- Larghezza della carreggiata stimata (6 m, 4,8 m al Mortirolo): OSM raramente ha il tag `width`.
- Terreno lontano a 100–180 m di passo: le montagne in distanza sono morbide. Nelle tracce importate (GPX, giri con GPS) non c’è DEM: il terreno intorno è indicativo.
- Alberi, rocce e neve seguono la quota, non un censimento. Non ci sono edifici, gallerie né i muretti specifici delle strade vere.

## Strade del mondo aperto

- Rotatorie: l’anello si ridisegna tondo dai vertici OSM, con raccordi alle bocche di raggio fisso (4–10 m, non quello vero) e l’isola spartitraffico solo fra due rami vicini. Circa il 2% (turbo-rotatorie, anelli attorno a un isolato) resta disegnato arco per arco. Agli incroci normali non ci sono raccordi.
- Gallerie: una sezione sola (marciapiedi di servizio, niente corsie d’emergenza né nicchie) e 12 m di galleria artificiale davanti a ogni imbocco, anche dove il portale vero è a filo del monte. Il nome non è scritto sul portale. La luce dentro è fissa: non cambia con l’ora.
- Case sul pendio: il piano terra sta sul punto più alto della pianta e sotto c’è un muro di sostegno fino al più basso. Oltre 12 m di dislivello la casa resta un po’ interrata a monte.
- Entrata delle mattonelle: salgono da sotto il terreno lontano in 300 ms, non sfumano (una dissolvenza vera voleva un programma shader in più per materiale). Il pop-in a 40 km/h per 10 s non è dimostrato nel collaudo: con la grafica software (swiftshader) il simulatore va a un fotogramma al secondo e non avanza. Nei giri misurati, dopo il «pronto», nessuna mattonella né arredo è comparso entro 150 m.
- «Pronto»: aspetta tutte le mattonelle entro 400 m col loro arredo; si arrende solo per un errore (DEM o terreno lontano che non arrivano) o dopo 60 s.
- Nomi nel cielo: si spengono dietro il terreno (DEM), le case e i monumenti entro 120 m; dietro alberi, mura e case più lontane restano accesi.
- Marciapiedi: lo scivolo di 4 m c’è solo alle fini vere (incroci, cambio d’uso del suolo), e i pezzi isolati sotto i 15 m non si disegnano. Dove il terreno accanto è più basso, il fianco esterno del marciapiede resta un piccolo gradino laterale, visibile solo dalle camere di lato.

## Il paesaggio di montagna (pista S2, 07/11/2026, giro 2 l'11/11/2026)

- **Le forme delle Dolomiti sono quelle del DEM a 25 m (EU-DEM), che smussa le torri** (11/11/2026, viste del Sella accanto alle foto). Anche col rilievo ridato da `rilievo.ts` i picchi restano bassi e tondi: Sassolungo 3142 m invece di 3181, Gran Cir 2495 invece di 2592, Sassongher 2538 invece di 2665, la Forcella del Sassolungo riempita (2737 invece di 2685). Si riconoscono la piramide del Sassongher sopra Corvara, le pareti nord del Sella dal Gardena, il tavolato del Sass Pordoi; il Sassolungo dal Sella e il Cir dal Gardena sono masse arrotondate, non torri. Il rimedio è un DTM più fine nel build di S1 (il LiDAR di Alto Adige e Trentino, 2,5 m, ricampionato a 10 m), non altro shader.
- La Marmolada dal Pordoi spunta appena sopra la cresta del Padon: nel DEM Punta Penia è 3238 m invece di 3343.
- I colori di `LOOKS.sellaronda` sono ritoccati a occhio contro dodici foto (`s2\sellaronda\confronto.jpg` nel collaudo del rilascio), quasi tutte d'estate: a novembre i prati sono ocra e sopra i ~2250 m c'è neve, quindi il confronto è di forme e di roccia, non di stagione.
- Le bande della roccia hanno un passo fisso (3,5 m, uno strato su sei più spesso): la dolomia vera ha strati da 2 a 6 m e pareti con cenge larghe che qui non ci sono. Il ghiaione è un colore sui pendii di 22–34°, non un ventaglio dalla parete.
- La neve segue il calendario, non il meteo del giorno: la linea di neve dal meteo «vero» di F.12 (`snowLine` in `weather.ts`) non è ancora saldata alle mattonelle, perché il colore è cotto nei vertici e arriva prima del meteo (andrebbero ricostruite le mattonelle quando il meteo cambia la linea di più di 100 m). Il ghiacciaio della Marmolada arriva da `COVER.glacier` del build; la grotta di neve dei canaloni a nord sopra i 2800 è solo la regola dell'esposizione.
- Il muro di sostegno a monte regge il primo tratto del taglio (da 0,75 a 2,4 m); la scarpata sopra resta quella del raccordo del campo (`field.ts`), non un muro alto quanto il taglio. I paracarri dei tornanti sono i delineatori già presenti (uno ogni 20 m in curva), non i cippi bianchi e neri di pietra.
- Gli impianti di risalita hanno i piloni ai vertici della linea OSM (dove mancano, uno ogni 160 m con la quota del terreno lontano, che può essere di qualche metro sopra o sotto il suolo vicino), altezze per tipo (13, 9, 5,5 m), niente seggiole sulle seggiovie, niente animazione, e si costruiscono entro 6 km dal ciclista.
- Il cartello del passo sta a 1,6 m dal ciglio della strada più vicina al nodo `mountain_pass` di OSM (entro 60 m); se il nodo è lontano dalla strada il cartello sta sul valico, in mezzo al prato. Il nome è quello di OSM.
- Le case ladine sono un archetipo di colori, tetto (14°, gronda di 1,1 m, scandole scure) e facciata (balconi di legno a tutta facciata nella trama): le impronte restano quelle di OSM, quindi un hotel a L resta un volume a L col tetto piano se la pianta non regge le falde (oltre 2200 m²).
- `chiesetta` e `rifugio` sono usati dai monumenti del Sellaronda. `ossario` è disegnato ma non ha un'impronta: il sacrario del Pordoi non è in OSM.
- Il cielo d'alta quota cambia con la quota della camera (ogni 30 s o ogni 250 m di dislivello); la foschia resta una nebbia per distanza, non una coltre nelle valli lontane.
- **Il Sellaronda pesa il triplo di Bergamo in triangoli** (misura dell'11/11/2026, stessa build, stessi minuti: al Sella 1,8 milioni e al Pordoi 2,25 contro 0,68 alla Presolana e a San Marco; p95 2,7 s contro 1,2-1,7 s in swiftshader, oltre il 20% di S2.12). Le cause sono l'anello in più (81 mattonelle invece di 49) e il terreno lontano a 120 m (246 mila triangoli in una mesh sola, senza esclusione fuori vista); i piloni a traliccio sono 168 triangoli l'uno. Da fare: il lontano a pezzi con la loro esclusione, o a due passi (120 m vicino, 240 oltre i 6 km).
- Il terreno lontano si abbassa fino a 45 m dove il posto è ruvido (R1): le cime lontane stanno 20-40 m sotto il vero. Intorno a Foppolo resta sopra il DEM nel 3% dei punti fra 1 e 3 km (era il 50%).
- La Cappella del Passo Sella ha il nome nel cielo ma nella vista dal piazzale dell'albergo (`sella-cappella`) l'edificio non si vede: da verificare in `MonumentiScene`.
- `scripts/world/misure.mjs` su Windows lascia vivo il Chrome di prova (`allenando-shot`): va chiuso a mano dopo la misura.
- `__orobiaLook` e `__orobiaDate` (look.ts) sono ganci di collaudo per `world-shot.mjs`: nell'app non li scrive nessuno.
- Le misure FPS sono con la grafica software (swiftshader) e ballano da un giro all'altro (p50 da 26 a 450 ms nello stesso punto): valgono solo come confronto fra due build misurate una dopo l'altra. L'anello in più delle mattonelle (`ringExtra`) vale solo per i mondi di montagna, quindi su Bergamo non costa niente.

## Replay e Intervals.icu

- Il client Intervals.icu è provato con risposte simulate e con le intestazioni CORS reali (preflight e 401), **non con una chiave vera**: il primo import reale va controllato.
- `latlng` degli stream è letto come `data` = latitudini, `data2` = longitudini (gestiti anche altri formati).
- Gli import da file vengono ricampionati a 1 Hz dal codice esistente: nelle pause il fantasma avanza piano invece di fermarsi.
- La traccia del giro importato è decimata a ≥ 5 m e arrotondata: il fantasma è scalato sulla lunghezza della traccia ricostruita.

## Pedala insieme

- Provato con WebSocket veri contro il Worker pubblicato (`scripts/room-smoke.mjs`, 18 controlli) e con due Chrome headless in profili separati nella stessa stanza (`scripts/shot.mjs --room`). **Non ancora con due telefoni veri su due reti mobili diverse**: è il primo collaudo da fare.
- La posizione degli altri arriva due volte al secondo e in mezzo è stimata con la loro velocità (al massimo 3 s): con una rete lenta un compagno può scivolare di qualche metro quando arriva l’aggiornamento.
- Le stanze ci sono solo sulle quattro salite verificate, non sui replay dei giri importati.
- Nessuna partenza sincronizzata: ognuno parte quando preme. Il pannello dà il distacco in metri, non in secondi.
- Il server rifiuta le origini estranee, ma fuori dal browser l’intestazione Origin si può falsificare: non è un’autenticazione. Chi ha il link entra; il nome è libero e non verificato.
- Piano gratuito Cloudflare: 100.000 richieste al giorno per account, e i messaggi WebSocket in entrata contano 1 su 20. Due persone per un’ora fanno circa 14.400 messaggi, cioè ~720 richieste.
- Su iPhone una scheda in background sospende il WebSocket: tornando in primo piano il client rientra da solo.

## Strada vera

- I link a Google Street View e Mapillary aprono il visore ufficiale in una scheda nuova; dove non c’è copertura lo dice il visore. L’app non mostra, non scarica e non usa quelle immagini: il mondo 3D resta quello ricostruito da OSM e DEM.
- Il replay fotografico (un video girato dall’utente, sincronizzato con la salita) non c’è.

## Rullo e mobile

- FTMS/BLE coperti da test su pacchetti, non provati su hardware in questa versione.
- Il motore 3D (three.js e r3f, ~260 kB gzip) si scarica solo quando parte una corsa o si apre il garage: l’app si apre con ~270 kB gzip. Su telefoni modesti usare la grafica **Bassa**.
- Il ciclista 3D è costruito in codice, non scolpito: una maglia con 23 ossa (una chiamata di disegno a testa), gambe e braccia a cinematica inversa su pedali e leve, tre dettagli (alta ≤ 11,8k triangoli, media ≤ 3,9k, bassa ≤ 1,2k). Si alza sui pedali sulle rampe e negli scatti, si raccoglie in aero, piega in curva. Non ha dita articolate né stoffa che si muove; i ciclisti degli altri in rete hanno una divisa semplice dal loro colore, perché la stanza non trasmette ancora l'aspetto completo. Laboratorio visivo: `lab/rider.html` (solo `vite dev`).
- Il prompt di installazione esiste solo su Chrome/Edge; su iPhone si installa a mano da Safari, come spiega il riquadro in Oggi.
- Safari/iPhone: niente Web Bluetooth, serve Bluefy.

## Collaudo da fare

1. Aprire una salita, pedalare col simulatore a 10× fino in cima: arrivo, riepilogo, salvataggio, poi «Contro il fantasma».
2. Import Intervals.icu con una chiave vera, un’attività con potenza e GPS: power replay e grade replay.
3. Rullo FTMS: ERG nel power replay, simulazione nel grade replay, nessun comando misto.
4. Pedala insieme con due telefoni veri su reti diverse: invito via chat, ingresso, distacchi, una caduta di rete e il rientro.
5. Installazione da Chrome Android e da Safari iPhone, poi un giro in modalità aereo.
