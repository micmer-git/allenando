# ALLENANDO

Rullo indoor sulle salite vere, nel browser. Tre salite, quattro versanti, con la forma vera della strada: tornanti, curve, quota e pendenza georeferenziate. E i tuoi giri veri, rifatti sul rullo.

Sito: [https://micmer-git.github.io/allenando/](https://micmer-git.github.io/allenando/)

Tutto resta sul dispositivo. Non c’è account. Le uniche chiamate esterne sono quelle che fai tu verso Intervals.icu, con la tua chiave.

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
- **Guardrail**: dove il DEM indica un salto di oltre 3 m a 7 m dal bordo.
- **Vegetazione**: per fascia di quota (latifoglie, abete rosso, larice, rocce), non da un censimento.

Street View non è una fonte: l’app ne mette solo il link ufficiale a Google Maps, come riferimento visivo. Nessuna geometria o texture viene ricavata da lì.

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

## Rullo e sensori

Web Bluetooth (Chrome/Edge su Android, Mac, Windows, Linux; Bluefy su iPhone). Profili: FTMS (dati, potenza obiettivo, simulazione), Cycling Power, Heart Rate, Cycling Speed and Cadence. Senza rullo c’è il simulatore.

## Avvio

```bash
npm install
npm test
npm run dev        # http://localhost:5173/allenando/
npm run build
```

Il deploy su GitHub Pages parte da `.github/workflows/pages.yml` a ogni push su `main`. La base è `/allenando/`.

## Rapporto con Camilla Ride

ALLENANDO nasce da un fork di [Camilla Ride](https://github.com/micmer-git/camilla-ride), che resta l’app di Luca e Camilla con il carrellino e il diario del sonno. Qui quelle parti non ci sono. Le due app stanno sulla stessa origine (`micmer-git.github.io`) ma usano database locali diversi (`allenando` e `camilla-ride`).

## Licenze dei dati

© OpenStreetMap contributors, ODbL 1.0 · EU-DEM © Copernicus Land Monitoring Service. Vedi `KNOWN_LIMITATIONS.md` per cosa non è ancora verificato.
