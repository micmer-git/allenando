# Limiti noti — OROBIA (già ALLENANDO)

## Il gioco

- Oro, guardaroba, traguardi e record stanno sul dispositivo: cancellare i dati del sito li perde, e non passano da un telefono all’altro.
- Le classifiche non sono un’autenticazione: il server scarta i tempi impossibili ma non può sapere se un tempo è stato fatto davvero. Il rullo e il simulatore stanno in classifiche separate.
- I tratti dei percorsi si ricavano dal profilo con una regola: un GPM, una volata, una crono. Se il mondo viene ricostruito con dati OSM diversi, un tratto può spostarsi di qualche metro e cambiare record.
- Il gruppo delle sessioni è virtuale e non aspetta nessuno: chi si stacca resta staccato. Le sessioni dipendono dall’orologio del telefono; un orologio sbagliato di minuti fa partire in un momento diverso dagli altri.

Passa i test (geometria, terreno sotto la strada, replay, Intervals con API simulata, parser) e la build di produzione. Il mondo 3D è stato visto in Chrome headless (WebGL software) su viewport 390×844. **Non è certificato su un rullo fisico.**

## Geometria e quota

- La strada è ricostruita da dati aperti: precisione di qualche metro, non di centimetri. La quota è livellata entro ±8–11 m dal DEM a 25 m; le pendenze di picco su 100 m (fino a ~24%) possono contenere ancora rumore del DEM nei tornanti.
- Partenza e arrivo sono i nodi OSM del paese e del passo: lunghezza e dislivello differiscono di qualche centinaio di metri dalle schede ufficiali.
- Il percorso è calcolato da OSRM (profilo auto) sulle strade OSM. Per il Mortirolo da Mazzo segue la Strada del Mortirolo e l’ultimo tratto sulla SS42 dir/A fino al passo: va confrontato con un GPX di riferimento.
- Larghezza della carreggiata stimata (6 m, 4,8 m al Mortirolo): OSM raramente ha il tag `width`.
- Terreno lontano a 100–180 m di passo: le montagne in distanza sono morbide. Nelle tracce importate (GPX, giri con GPS) non c’è DEM: il terreno intorno è indicativo.
- Alberi, rocce e neve seguono la quota, non un censimento. Non ci sono edifici, gallerie né i muretti specifici delle strade vere.

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
- Il bundle del mondo 3D è ~1 MB (260 kB gzip). Su telefoni modesti usare la grafica **Bassa**.
- Il ciclista 3D è costruito a mano in proporzione (bici taglia 54-56, pedivelle 172,5 mm, gambe a cinematica inversa sui pedali), una dozzina di chiamate di disegno a testa: non è un modello anatomico né un rig animato. Braccia ferme sulle leve, busto fermo.
- Il prompt di installazione esiste solo su Chrome/Edge; su iPhone si installa a mano da Safari, come spiega il riquadro in Oggi.
- Safari/iPhone: niente Web Bluetooth, serve Bluefy.

## Collaudo da fare

1. Aprire una salita, pedalare col simulatore a 10× fino in cima: arrivo, riepilogo, salvataggio, poi «Contro il fantasma».
2. Import Intervals.icu con una chiave vera, un’attività con potenza e GPS: power replay e grade replay.
3. Rullo FTMS: ERG nel power replay, simulazione nel grade replay, nessun comando misto.
4. Pedala insieme con due telefoni veri su reti diverse: invito via chat, ingresso, distacchi, una caduta di rete e il rientro.
5. Installazione da Chrome Android e da Safari iPhone, poi un giro in modalità aereo.
