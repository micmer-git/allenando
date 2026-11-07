# OROBIA

Le strade vere di Bergamo, sul rullo, nel browser. Un mondo aperto (Bergamo, Val Brembana, Val Seriana) con volate, GPM, cronometro e sessioni di gruppo; quattro salite verificate (Selvino, Mortirolo, Stelvio da Prato e da Bormio); i tuoi giri veri, rifatti sul rullo.

Sito: [https://micmer-git.github.io/allenando/](https://micmer-git.github.io/allenando/)

**Il nome.** Fino al 3 novembre 2026 si chiamava ALLENANDO. OROBIA: «oro» come il giallo del marchio, le Orobie come le montagne di Bergamo. L’indirizzo `/allenando/`, il repo e il database locale (`allenando`) restano quelli: cambiarli farebbe perdere i giri salvati e le app già installate. Il marchio sta in `src/brand.ts` (nome, colori, geometria del simbolo) e in `public/favicon.svg`.

## Il gioco

Tutto sul dispositivo (IndexedDB, chiave `career`), come i giri; in rete vanno solo i tempi e i punti delle classifiche.

- **Oro**: si guadagna pedalando (km, metri di dislivello, tratti, record, missioni, traguardi, serie di giorni). Le regole stanno in `src/game/career.ts` (`ORO_RULES`) e si leggono nel riepilogo a fine giro.
- **Garage**: maglie (dieci disegni), caschi, bici e ruote. Si comprano con l’oro, alcuni dopo un livello, altri solo con un traguardo. **Solo estetica**: nessun pezzo cambia la fisica.
- **Traguardi**: km, dislivello, salite, volate, GPM, crono, luoghi, pioggia e notte vere, serie di giorni, potenza. Quelli a soglia mostrano a che punto sei.
- **Missioni del giorno**: tre, le stesse per tutti in quel giorno (dipendono solo dalla data). Dal 7 novembre 2026 ci sono anche le **serie** a tappe (`SERIES` in `src/game/missions.ts`): la prima è il Sellaronda — Passo Sella, Passo Pordoi, Passo Gardena, poi il giro intero — e alla fine arriva la maglia **Sella**. Le tappe restano fatte da un giorno all'altro (`career.series`) e si leggono in Traguardi.
- **Traguardi del Sellaronda**: «I quattro passi» (Sella, Pordoi, Gardena, Campolongo nello stesso giro), «Sellaronda» (il giro intero, in un verso o nell'altro), «Marmolada» (il Fedaia da Canazei), «Berghem MolaMia» (il corto della granfondo). Gli id dei percorsi e dei passi stanno in `src/game/passes.ts`.
- **Tratti cronometrati** (`src/game/segments.ts`): nei percorsi del mondo si ricavano dal profilo — il GPM sulla salita con più dislivello, una volata da 300 m piatti prima dell’arrivo, una crono regolare da 3–8 km — e si ancorano agli archi del grafo: valgono anche nel giro libero, per chiunque ci passi nel verso giusto. Dal 7 novembre 2026 **ogni salita che finisce su un passo ha il suo GPM** (`derivePassGpm`: sul Sellaronda quattro, non due), con gli id che continuano la numerazione (`gpm3`…) così i record di prima non cambiano. Sulle salite verificate il GPM è la salita intera, più gli ultimi 3 km. Il tempo parte sotto l’arco e si ferma sotto l’arco d’arrivo, interpolato fra due fotogrammi; chi svolta fuori dal tratto lo annulla.
- **Sessioni** (`src/game/sessions.ts`): ogni mezz’ora, a :00 e :30, una sessione (gruppo, crono, volate, salita) su un percorso del mondo. Il calendario dipende solo dall’orologio, quindi è lo stesso su tutti i telefoni senza un server. Si entra da 15 minuti prima a 5 minuti dopo il via; in griglia si aspetta il via, tutti insieme. Nelle uscite di gruppo pedala un gruppo virtuale a W/kg dichiarati, con la fisica vera, e la sua scia abbassa il CdA fino al 35%.
- **Classifiche**: salite, percorsi, tratti, sessioni e punti, col tempo del rullo separato da quello del simulatore. Il server rifiuta i tempi sotto quello credibile di un professionista (`boardLimit` in `src/multiplayer/world-protocol.ts`).
- **Volate del cassonetto**: volate da 150–300 m in piano all’ingresso dei paesi, al massimo due per percorso, col traguardo su tre bidoni della differenziata. Si ricavano dai dati (`deriveCassonetti`), sono ancorate al grafo come gli altri tratti e hanno la loro classifica (`w:<percorso>:cassonetto1|2`).
- **Archi dei km**: sulle salite un portale a ogni km, col numero e la pendenza del km che viene; fuori dalle salite uno ogni 5 km; «Ultimo km» rosso prima dell’arrivo (`kmArchSpecs` in `src/game/arches.ts`).
- **Allenamenti** (`src/domain/workouts.ts`): 27 nuovi da 30 minuti a 2 ore (fondo, tempo, sweet spot, soglia, over-under, VO2max, sprint, cadenza, rifinitura, recupero), da filtrare per durata e tipo e da pedalare dove si vuole: una salita verificata, un percorso del mondo, il giro libero da un paese o un anello lungo quanto l’allenamento. Se il percorso finisce prima, si prosegue libero. In ERG un arco sulla strada segna l’inizio e la fine di ogni intervallo di lavoro (`src/game/ergArches.ts`): la distanza è la velocità per il tempo che manca.
- **Carta**: nella scheda Percorsi del Mondo si tocca una linea e si apre quel percorso.
- **Il tuo fantasma** (`src/game/ghosts.ts`): il giro migliore su ognuno dei 14 percorsi, su ogni tratto e sulle salite verificate si salva da solo (secondi al metro, in IndexedDB `kv` → `ghosts`). Al giro dopo pedala accanto a te un ciclista trasparente, e una pillola dice «Dietro al fantasma · 3 s» o «Davanti al fantasma · 12 s».
- **Cartolina** (`src/io/share-image.ts`): un'immagine 1080×1350 del giro, con la traccia d'oro sulla carta del mondo, i monumenti passati, il profilo e i numeri; la riga sopra il titolo dice il mondo, una riga dice il punto più alto toccato («Passo di Ganda · 1.053 m») e lo sfondo cambia col mondo (notte calda a Bergamo, notte fredda al Sella). Dal riepilogo e dal diario; si condivide dal telefono o si scarica.
- **Diario e file**: ogni giro nel mondo ricorda il suo mondo (`ride.world`; i giri di prima si riconoscono dal GPS); il diario si filtra per mondo quando ce n'è più d'uno, e la carta del dettaglio è quella del mondo giusto. Il FIT porta il nome del percorso e del mondo in un messaggio `WORKOUT`, il GPX in `<desc>`.
- **Ripeti l'ultimo giro**: in Oggi, una riga sotto la carta del mondo riapre l'ultima pedalata cominciata (percorso, anello, giro libero o salita).
- **Allenamenti**: dove pedalarli si sceglie anche per mondo, e «La salita giusta per la durata» prende dal mondo attivo il percorso in salita lungo quanto l'allenamento (`climbForMinutes`). Le sessioni di gruppo hanno il mondo esplicito nel link e, senza rete, dicono se il mondo non è scaricato invece di far entrare in una stanza vuota.
- **Programmi** (`src/domain/plans.ts`, pagina `/programmi`): «Primo Selvino» (4 settimane), «Base d'inverno» (6) e «Pronti per la Ganda» (4), fatti con gli allenamenti della libreria, ognuno col suo percorso. In Oggi la carta «L'allenamento di oggi» apre la corsa con allenamento e percorso; una seduta saltata si recupera entro due giorni.
- **File `.zwo`** (`src/io/zwo.ts`): gli allenamenti di Zwift si importano (Allenamenti › «Importa .zwo») e ognuno si esporta.
- **Il giro non si perde** (`src/sim/recovery.ts`): al «Termina» va nel diario da solo. Mentre si pedala si mette da parte ogni 15 s, in pausa e quando l'app va in secondo piano; riaprendo dopo un crash compare «Hai un giro a metà» con Riprendi, Salva com'è e Scarta. «Termina» si tiene premuto 0,8 s, così un tocco per sbaglio non chiude il giro.

## Il mondo

- **Due mondi** (dal 7 novembre 2026): **Bergamo e le valli** e il **Sellaronda** (Sella, Pordoi, Gardena, Campolongo, la Marmolada dal Fedaia). Il catalogo sta in `src/open/worlds.ts`; i dati di ogni mondo in `public/world/<id>/` con un `manifest.json` (`node scripts/world-manifest.mjs`, da rilanciare dopo ogni `world:build`) che dice i file col loro peso, i km di strade e i percorsi. La pagina Mondo comincia con la scelta del mondo (una riga ciascuno: km di strade, percorsi, «Scaricato» o «Da scaricare · 20 MB»); l'ultimo scelto si ricorda e Oggi propone i giri di quello. Tutti i link della corsa portano `?world=`.
- **Senza rete**: in Mondo, «Senza rete · Scarica» mette tutto il mondo (grafo, percorsi, luoghi, monumenti, terreno lontano, mattonelle del terreno e delle case) nella cache del service worker (`allenando-world-v1`), con l'avanzamento in MB; «Togli» la svuota. Lo stato si legge dalla cache, non da una spunta salvata.
- **In montagna**: sopra i 1000 m la quota resta nel pannello della corsa; quando il prossimo passo è entro 5 km una pillola dice «Passo di Ganda fra 3,2 km · +210 m»; i passi e le cime sono segnati sopra il profilo; la scheda del percorso elenca le salite col passo in cima (km, D+, media, quota) e, per i giri, il verso (orario o antiorario) con il rimando al giro nell'altro verso se c'è. Le quote si scrivono sempre col separatore («2.240 m»). Il meteo è quello del centro del mondo in cui si pedala.
- **14 percorsi** (`scripts/world/rides.ts`), dal 4 novembre 2026 anche **il giro della Ganda**: Nembro, Albino, Gazzaniga, Orezzo, Passo di Ganda, Aviatico, Selvino, giù per i tornanti fino a Nembro (38,5 km, D+ 897 m, la salita da Gazzaniga 9,8 km al 6,9%).
- **40 monumenti veri** (`scripts/world/monumenti.ts`, modelli in `src/world/monumenti/`): le quattro porte delle Mura, Campanone, Gombito, Santa Maria Maggiore con la Cappella Colleoni, il Duomo, la Rocca, la Torre dei Caduti, il Donizetti, le statue, il Mausoleo Briolini di Gazzaniga, San Martino ad Alzano, Clusone, il Casinò e il Grand Hotel di San Pellegrino, il Cornello e altri. Impronta e id da OSM, forma per archetipo; prendono il posto dell’edificio generico e sono punti caldi. Il laboratorio `lab/monumenti.html` li mostra tutti (solo in sviluppo).
- **Strada**: rotatorie tonde coi raccordi, i cordoli e le isole spartitraffico (`src/open/rings.ts`); gallerie chiuse e illuminate, con il portale nel pendio (`src/open/tunnels.ts`); case sul pendio col muro di sostegno; sotto le porte delle Mura si passa nel fornice.
- **Giro libero**: «dritto» non rifà le strade appena fatte e non entra nei vicoli ciechi (guarda due incroci avanti); dai paesi si parte sulla strada che li attraversa.
- **Pronto vuol dire pronto** (`src/open/pronto.ts`): la corsa parte quando il terreno lontano e tutte le mattonelle entro 400 m sono in scena col loro arredo; fino ad allora c'è il velo col nome del percorso e l'avanzamento. Si arrende solo per un errore o dopo 60 s.
- **Nomi dei luoghi** (`src/open/WorldLabels.tsx`): al massimo tre insieme, spenti dietro il terreno, le case e i monumenti vicini, mai tagliati e mai sopra l'HUD.
- **Paesaggio**: suolo pavimentato in città (`src/open/urban.ts`), boschi fitti a due specie vicino alla strada, niente pareti di terreno lungo le strade, capannoni con le finestre a nastro.
- **Misure**: con `?stats=1` la pagina della corsa espone `window.__orobiaStats` (chiamate di disegno, triangoli, fotogrammi p50/p95, mattonelle, pop-in).
- **Peso**: three.js e r3f stanno in un pezzo a parte (`riderRig-*.js`), scaricato solo per la corsa e il garage: l'app si apre con ~270 kB gzip.

## Esporta con il GPS vero

Ogni giro sulle strade del mondo o sulle salite registra latitudine, longitudine e quota della strada, campione per campione: la posa sul percorso riproiettata sull’origine del mondo (la stessa proiezione con cui il mondo è costruito). Il FIT esportato ha la traccia e si dichiara **giro virtuale** (`sub_sport = virtual_activity`): Strava lo mette sulla mappa vera di Bergamo ma lo tiene fuori dai segmenti all’aperto, come fa con Zwift. La quota sta in ogni punto (anche nei campi `enhanced_altitude` che Strava legge per primi), con salita, discesa e quote estreme nel riepilogo. C’è anche il GPX. I giri senza strada (la strada neutra dei replay senza GPS) restano senza coordinate: non se ne inventano.

Tutto resta sul dispositivo. Non c’è account. Le uniche chiamate esterne sono quelle che fai tu: verso Intervals.icu con la tua chiave, e verso il server delle stanze solo se entri in una stanza «Pedala insieme».

## Le salite

| Salita | Versante | Lunghezza | Quota | Media | Tornanti rilevati |
|---|---|---|---|---|---|
| Selvino | da Nembro | 11,6 km | 328 → 945 m | 5,3% | 20 |
| Mortirolo | da Mazzo di Valtellina | 11,3 km | 562 → 1850 m | 11,4% | 24 |
| Stelvio | da Prato allo Stelvio | 25,2 km | 908 → 2750 m | 7,3% | 48 |
| Stelvio | da Bormio | 21,6 km | 1216 → 2751 m | 7,1% | 30 |

I numeri sono **calcolati dalle tracce** (`npm run climbs:stats`), non copiati da una scheda: possono scostarsi di qualche metro dai valori ufficiali, perché partenza e arrivo sono i nodi OSM del paese e del passo.

Da dove vengono:

- **Strada**: OpenStreetMap, percorso calcolato con OSRM (`routing.openstreetmap.de`, profilo auto) tra il nodo OSM del paese di partenza e quello del passo. La pianta è nodo per nodo, con gli spigoli arrotondati di al massimo 3,5 m.
- **Quota**: EU-DEM v1.1 a 25 m (Copernicus) via l’API pubblica di OpenTopoData. Il profilo è livellato dentro un “tubo” di ±8 m dalla quota del DEM (la strada a mezza costa non pesca più il pendio), e la pendenza è mediata su circa 40 m.
- **Terreno**: griglia DEM da 100–180 m intorno alla strada, raccordata alla carreggiata: vicino alla strada il terreno scende alla sua quota e sta sempre sotto l’asfalto (lo verifica un test su ogni punto delle quattro tracce).
- **Tornanti**: curve oltre 150° in 70 m. Sono quelli che la geometria mostra, non il conteggio dei cartelli.
- **Guardrail**: dove il DEM indica un salto di oltre 3 m a 7 m dal bordo (file di almeno tre paletti). Lama a doppia onda, paletti ogni 4 m, catadiottri, terminali interrati; dove non c'è, delineatori ogni 40 m (20 in curva).
- **Cartelli dei tornanti**: «TORNANTE N» con la quota, contati dall'alto come sullo Stelvio. Il numero è quello dei tornanti trovati dalla geometria, non quello dei cartelli ufficiali.
- **Mondo di Bergamo**: semafori (sempre verdi: sono un punto di riferimento, non fermano nessuno), strisce pedonali, stop e dare precedenza, mini rotatorie e i luoghi da passare (fontanelle, belvederi, edicole, chiese, campanili, negozi di bici, bar di paese) vengono dai nodi OSM (`python scripts/world/extract-pbf.py --points`, una dozzina di secondi). Le rotatorie sono `junction=roundabout` di OSM; aiuole, cespugli e sculture nel mezzo sono disegnati, non rilevati.
- **Vegetazione**: per fascia di quota (latifoglie, abete rosso, larice, rocce), non da un censimento.

Street View non è una fonte: l’app ne mette solo il link ufficiale a Google Maps, come riferimento visivo. Nessuna geometria o texture viene ricavata da lì.

**Guarda la strada vera.** Durante la pedalata, in «Grafica e strada vera», due link aprono in una scheda nuova il visore ufficiale di **Google Street View** (Maps URLs, `map_action=pano`) e quello di **Mapillary** nel punto in cui sei, con la direzione di marcia. Sono solo collegamenti: l’app non scarica, non copia, non ricalca e non usa quelle immagini nel mondo 3D, né ne ricava video (i termini di Google Maps Platform per lo Spazio economico europeo lo vietano). Le foto di Mapillary sono dei loro autori, con licenza CC BY-SA. Un replay fotografico con un video proprio non c’è.

Le tracce si rigenerano con `npm run climbs` (scrive `public/routes/*.json`, circa sei minuti per il limite di una richiesta al secondo di OpenTopoData).

Il **catalogo** elenca altre sedici grandi salite italiane senza numeri: sono segnate «traccia da acquisire» finché non arriva una traccia verificata. Nel frattempo si può importare il GPX di un proprio giro e pedalarlo.

## I tuoi giri: power replay, grade replay, fantasma

**Giri** importa un’attività in due modi:

- **Intervals.icu** con la chiave API personale (Settings → Developer). La chiave resta nello stato della pagina: non va in localStorage, in IndexedDB, nei log o nel repo. L’API di Intervals.icu risponde alle chiamate dal browser (CORS verificato il 02/11/2026). Le attività sincronizzate da Strava arrivano senza dati per i termini di Strava: l’app le segna e propone il file.
- **File** FIT, TCX, GPX o lo ZIP di Garmin Connect, letti sul dispositivo.

Poi si sceglie il pezzo (tutto, da minuto a minuto, da km a km, o un lap del file) e il modo:

- **Power replay**: il rullo va in ERG con i watt del giro originale, allineati sul tempo trascorso. La pendenza non viene inviata.
- **Grade replay**: il rullo riceve la pendenza della strada del giro (simulazione FTMS); i watt li metti tu.
- **Fantasma**: pendenza al rullo e, accanto, il giro di allora alla sua velocità, con il distacco in secondi calcolato sul tempo al metro.

ERG (`0x05`) e simulazione (`0x11`) non vengono mai inviati insieme. Se il giro non ha GPS si pedala su una **strada neutra**, dritta, e lo si dice; se non ha potenza il power replay è disattivato.

Sulle salite del pacchetto, al primo arrivo in cima il tempo diventa il fantasma da battere.

## Pedala insieme

Due o più telefoni (fino a 8) sulla **stessa salita**, ognuno con il suo rullo o con il simulatore: ci si vede sulla strada (ciclisti con colori diversi e il nome sopra), con un pannello dei distacchi in metri e dei watt, e lo stato del collegamento.

1. In una salita verificata tocca l’icona delle persone in alto, scegli il nome e **Crea la stanza e invita**.
2. Manda il link (condivisione del telefono o «Copia link»). Il link contiene la salita e un id di stanza di 128 bit casuali: non si indovina.
3. Chi lo apre sceglie il nome ed entra. Se non ha ancora un profilo lo crea e torna alla stanza.

Ognuno parte quando vuole: la posizione è la distanza percorsa sulla salita, la stessa per tutti. Se cade la rete il telefono rientra da solo (attese crescenti fino a 15 s); da offline aspetta che la rete torni.

**Il server.** Un Worker Cloudflare, `allenando-rooms` ([`/health`](https://allenando-rooms.micmer-recastello.workers.dev/health)), con un Durable Object per stanza (backend SQLite, piano gratuito) e WebSocket in ibernazione. Il codice è in `server/allenando-room/`; le regole di validazione stanno in `src/multiplayer/protocol.ts`, lo stesso file per app e server.

- Accetta solo le origini `https://micmer-git.github.io` e localhost (sviluppo), solo le quattro salite verificate, nomi fino a 24 caratteri ripuliti dai caratteri invisibili, al massimo 8 persone per stanza.
- Un aggiornamento ogni 500 ms dal client; il server scarta quelli più fitti di 350 ms e chiude chi insiste.
- Una stanza è legata alla salita con cui è nata: un link con una salita diversa viene rifiutato.
- Chi non dà segni di vita per 90 s esce; una stanza dura al massimo 6 ore.

**Cosa vede il server, e basta**: il nome che scegli, i metri fatti sulla salita, i watt (media 3 s), la velocità di adesso e se sei in pausa. Niente frequenza cardiaca, niente coordinate GPS, niente storico, niente account. Lo stato di ognuno vive nella memoria del socket; nella memoria della stanza restano solo la salita e l’ora di apertura, cancellate quando l’ultimo esce. Il Worker non ha log attivi né segreti.

```bash
cd server/allenando-room
npx wrangler deploy              # pubblica allenando-rooms.<account>.workers.dev
node ../../scripts/room-smoke.mjs https://allenando-rooms.micmer-recastello.workers.dev
```

`room-smoke.mjs` apre WebSocket veri: due ciclisti nella stessa stanza che si scambiano lo stato nei due versi, rientro con lo stesso id, salita sbagliata, raffica oltre il limite, stanza piena, origine estranea. L’indirizzo del server nell’app si cambia al build con `VITE_ROOMS_URL`.

## Sul telefono

È una PWA: si installa e si apre a schermo intero, e salite, giri salvati e simulatore funzionano senza rete (il service worker tiene in cache app e tracce). In **Oggi** c’è il riquadro «Mettila sul telefono»: su Chrome Android usa il prompt di installazione del sistema, su iPhone spiega Condividi → Aggiungi alla schermata Home. Una fascia avvisa quando sei offline.

## Rullo e sensori

Web Bluetooth (Chrome/Edge su Android, Mac, Windows, Linux; Bluefy su iPhone). Profili: FTMS (dati, potenza obiettivo, simulazione), Cycling Power, Heart Rate, Cycling Speed and Cadence. Senza rullo c’è il simulatore.

## Avvio

```bash
npm install
npm test
npm run dev        # http://localhost:5173/allenando/
npm run build
npx vite preview --host 127.0.0.1 --port 5173
node scripts/shot.mjs http://127.0.0.1:5173/allenando shots --room
```

`scripts/pagine-check.mjs` (usato da `ui-shot.mjs` e `game-shot.mjs`) controlla anche la scelta del mondo, «Senza rete», le salite e le fonti nella scheda del percorso, i traguardi e la serie del Sellaronda, il filtro del diario e le due carte dell'onboarding (`onboardingMondi`).

`scripts/shot.mjs` apre Chrome headless come un telefono 390×844 (DevTools Protocol, nessuna dipendenza): schermate di Oggi, Salite e Pedalata, errori di pagina, overflow orizzontale, bersagli tattili sotto 44 px, manifest, service worker e installabilità secondo Chrome. Con `--room` apre due telefoni in due profili separati nella stessa stanza e controlla che si vedano.

Il deploy su GitHub Pages parte da `.github/workflows/pages.yml` a ogni push su `main`. La base è `/allenando/`.

## Rapporto con Camilla Ride

ALLENANDO nasce da un fork di [Camilla Ride](https://github.com/micmer-git/camilla-ride), che resta l’app di Luca e Camilla con il carrellino e il diario del sonno. Qui quelle parti non ci sono. Le due app stanno sulla stessa origine (`micmer-git.github.io`) ma usano database locali diversi (`allenando` e `camilla-ride`).

## Licenze dei dati

© OpenStreetMap contributors, ODbL 1.0 · EU-DEM © Copernicus Land Monitoring Service. Vedi `KNOWN_LIMITATIONS.md` per cosa non è ancora verificato.
