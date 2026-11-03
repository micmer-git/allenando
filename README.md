# ALLENANDO

Rullo indoor sulle salite vere, nel browser. Tre salite, quattro versanti, con la forma vera della strada: tornanti, curve, quota e pendenza georeferenziate. E i tuoi giri veri, rifatti sul rullo.

Sito: [https://micmer-git.github.io/allenando/](https://micmer-git.github.io/allenando/)

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

`scripts/shot.mjs` apre Chrome headless come un telefono 390×844 (DevTools Protocol, nessuna dipendenza): schermate di Oggi, Salite e Pedalata, errori di pagina, overflow orizzontale, bersagli tattili sotto 44 px, manifest, service worker e installabilità secondo Chrome. Con `--room` apre due telefoni in due profili separati nella stessa stanza e controlla che si vedano.

Il deploy su GitHub Pages parte da `.github/workflows/pages.yml` a ogni push su `main`. La base è `/allenando/`.

## Rapporto con Camilla Ride

ALLENANDO nasce da un fork di [Camilla Ride](https://github.com/micmer-git/camilla-ride), che resta l’app di Luca e Camilla con il carrellino e il diario del sonno. Qui quelle parti non ci sono. Le due app stanno sulla stessa origine (`micmer-git.github.io`) ma usano database locali diversi (`allenando` e `camilla-ride`).

## Licenze dei dati

© OpenStreetMap contributors, ODbL 1.0 · EU-DEM © Copernicus Land Monitoring Service. Vedi `KNOWN_LIMITATIONS.md` per cosa non è ancora verificato.
