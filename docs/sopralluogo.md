# Sopralluogo 3D

`/confronto?world=bergamo&ride=citta-alta&punto=14` apre il km 1,40 senza profilo o rullo. Anche in **Pedala → Dove** c'è il link. Il selettore percorre gli archi della salita nel verso effettivo, da zero all’arrivo, compresa l’ultima frazione di 100 m. Il mondo è quello della pedalata; qui la camera sta a 1,65 m sulla strada e l'orologio di gara non parte. Il link a [Street View](https://developers.google.com/maps/documentation/urls/get-started#street-view-action) usa la proiezione e la direzione della camera. Google sceglie il panorama disponibile più vicino; il link non certifica la copertura.

| Dati | Bergamo e valli | Sellaronda |
|---|---:|---:|
| Percorsi selezionabili | 16 | 9 |
| Alberi OSM vicino alle strade | 4.387 | 117 |
| Lampioni OSM vicino alle strade | 518 | 50 |
| Colore del paesaggio (2048²) | ~43 m/pixel | ~21 m/pixel |

Il colore proviene dal composito mediano annuo [ESA WorldCover Sentinel-2 RGBNIR 2021](https://esa-worldcover.org/en/data-access), bande rosso, verde e blu. Contiene dati Copernicus Sentinel modificati (2021), elaborati dal consorzio ESA WorldCover, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Il ritaglio usa i confini del terreno lontano e la proiezione del grafo. La texture si combina con la grana, le stagioni e la luce del mondo. Dove non ci sono osservazioni resta il materiale preesistente. Non cambia la risoluzione altimetrica e non è una fotografia alla quota del ciclista.

Posizioni degli arredi: [© OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright). Per Bergamo: estratto Geofabrik Italia nord-ovest, replica del 1 novembre 2026 alle 21:21 UTC; per Sellaronda: estrazione Overpass del 12 novembre 2026. Esclusi i punti sull'asfalto del modello e lontani dalla rete: massimo 22 m dall'asse per un lampione, 65 m per un albero. Le posizioni censite prevalgono sulle istanze procedurali circostanti. Chiome, lampade, altezze non censite e facciate restano approssimazioni.

## Rigenerazione (dalla radice)

1. `python scripts/world/paesaggio.py` (rasterio, numpy, pillow, certifi): legge finestre dei GeoTIFF pubblici senza scaricare i file interi. Il WebP con trasparenza si rigenera se cambia l'estensione del mondo.
2. `python scripts/world/punti-osm.py bergamo <estratto.osm.pbf> <grezzo.json>` (osmium). Per Sellaronda: `python scripts/world/punti-osm.py sellaronda overpass <grezzo.json>` (requests).
3. `npx vite-node scripts/world/punti-strada.ts <mondo> <grezzo.json>`: ricontrolla le distanze rispetto al grafo corrente. I punti grezzi non entrano nella PWA.
4. `node scripts/world-manifest.mjs` aggiorna i file scaricabili offline. La modalità leggera continua a funzionare senza texture.
5. `npm run build`, `npx vite preview --host 127.0.0.1 --port 4199`, poi `node scripts/sopralluogo-check.mjs http://127.0.0.1:4199/allenando shots`: due strade reali, cambio di punto e ritorno, caricamento dei materiali, errori WebGL/JS, due schermate.
