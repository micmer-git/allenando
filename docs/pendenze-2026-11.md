# Pendenze del mondo contro la realtà — 7 novembre 2026 (rivista l’11)

Michele, 07/11/2026: «not sure % are correct precisely like in gazzaniga maybe better % gain check all vs reality?».

Per ogni salita del mondo di Bergamo: i numeri del mondo (`node scripts/world/pendenze.mjs`, dal
grafo livellato `public/world/bergamo/graph.json`) accanto a due schede online. I numeri del mondo
non sono stati ritoccati: dove lo scarto superava il 10% si è corretto il **livellamento**
(`scripts/world/build-world.ts`) e si è ricostruito il mondo, oppure lo scarto è spiegato qui sotto.

Le massime online sono «i 100 m più ripidi» (climbfinder) o «la massima» senza finestra
(cols-cyclisme, bikeclimbs, Strava): si confrontano con la nostra massima su 100 m. Le schede
partono e arrivano in punti diversi dai nostri (il nodo OSM del paese e del passo): lunghezza e
dislivello si confrontano con quel margine.

## La tabella

| Percorso | Salita (km) | D+ (m) | Quote | Media | Max 100 m | Max 500 m | Da km |
|---|---|---|---|---|---|---|---|
| `citta-alta` Città Alta e San Vigilio (dalla stazione al castello) | 4.8 | 207 | 248 → 455 m | 4.3% | 19.6% | 13.9% | 0.0 |
| `maresana` Maresana (da Ponteranica) | 3.1 | 213 | 326 → 539 m | 6.9% | 20.4% | 14.0% | 0.0 |
| `selvino` Selvino (da Nembro) | 12.3 | 636 | 312 → 948 m | 5.2% | 11.6% | 10.6% | 0.3 |
| `val-seriana` Val Seriana (da Ranica a Clusone) | 7.3 | 169 | 448 → 616 m | 2.3% | 6.4% | 5.2% | 24.5 |
| `colle-gallo` Colle Gallo (da Albino) | 5.6 | 361 | 396 → 758 m | 6.4% | 17.7% | 11.4% | 5.3 |
| `presolana` Passo della Presolana (da Clusone) | 12.8 | 661 | 642 → 1303 m | 5.2% | 10.8% | 9.1% | 3.9 |
| `zambla-nossa` Colle di Zambla (da Ponte Nossa) | 13.9 | 800 | 453 → 1252 m | 5.7% | 12.1% | 10.4% | 0.8 |
| `zambla-zogno` Colle di Zambla (da Zogno per la Val Serina) | 11.3 | 488 | 330 → 818 m | 4.3% | 12.0% | 10.9% | 2.5 |
| `val-brembana` Val Brembana (da Bergamo a San Pellegrino) | 5.1 | 64 | 298 → 361 m | 1.2% | 6.7% | 4.8% | 16.4 |
| `ciclovia-brembana` Ciclovia della Val Brembana (da San Pellegrino a Piazza Brembana) | 8.6 | 118 | 358 → 475 m | 1.4% | 11.9% | 6.4% | 0.2 |
| `foppolo` Foppolo (da Piazza Brembana) | 20.3 | 988 | 532 → 1520 m | 4.9% | 12.1% | 10.9% | 0.0 |
| `san-marco` Passo San Marco (da Olmo al Brembo) | 19.2 | 1410 | 570 → 1980 m | 7.3% | 12.2% | 12.0% | 5.2 |
| `ganda` Il giro della Ganda (Nembro, Gazzaniga, Orezzo, Selvino) | 9.8 | 671 | 382 → 1053 m | 6.8% | 15.5% | 14.1% | 9.4 |
| `berghem-corto` Berghem MolaMia · corto (Gazzaniga, Selvino, Zambla, Ponte Nossa) | 16.3 | 707 | 312 → 1018 m | 4.3% | 14.1% | 11.6% | 8.7 |
| `berghem-medio` Berghem MolaMia · medio (Zambla, Clusone, il Sebino, la Val Cavallina) | 16.3 | 707 | 312 → 1018 m | 4.3% | 14.1% | 11.6% | 8.7 |
| `due-valli` Il giro delle due valli (Bergamo, Val Seriana, Zambla, Val Brembana) | 15.6 | 804 | 448 → 1252 m | 5.1% | 12.1% | 10.4% | 27.2 |


I tratti che le schede misurano, dove non coincidono con la salita più lunga:

| Tratto | km | D+ (m) | Quote | Media | Max 100 m | Max 500 m |
|---|---|---|---|---|---|---|
| Selvino, gli ultimi 10,5 km (la scheda climbfinder) | 10.5 | 586 | 363 → 948 m | 5.6% | 11.6% | 10.6% |
| Colle Gallo, gli ultimi 8,1 km (climbfinder da Gramelduro) | 8.1 | 401 | 356 → 757 m | 5.0% | 17.7% | 11.3% |
| Colle Gallo, gli ultimi 5 km (bikeclimbs «by Piazza») | 5.0 | 339 | 418 → 757 m | 6.8% | 17.7% | 11.3% |
| Presolana, gli ultimi 10,9 km (climbfinder da Fino del Monte) | 10.9 | 559 | 738 → 1298 m | 5.1% | 10.8% | 9.1% |
| Zambla da Ambria (climbfinder, SP27) | 24.0 | 922 | 330 → 1252 m | 3.8% | 13.0% | 11.9% |
| Foppolo, gli ultimi 10,9 km (climbfinder da Branzi) | 10.9 | 707 | 814 → 1521 m | 6.5% | 12.0% | 10.9% |
| San Vigilio, gli ultimi 750 m (climbfinder da Porta Sant’Alessandro) | 0.8 | 26 | 427 → 453 m | 3.5% | 14.3% | 3.7% |
| Maresana da Ponteranica, tutta (bikeclimbs «Crono salita Maresana» 4,16 km) | 3.1 | 213 | 326 → 539 m | 6.9% | 20.4% | 14.0% |

## Confronto con le fonti

Scarto = (mondo − scheda) / scheda. In grassetto gli scarti oltre il 10%.

| Salita | Mondo | Scheda 1 | Scheda 2 | Scarti (km · D+ · media · max 100 m) |
|---|---|---|---|---|
| Passo di Ganda da Gazzaniga | 9,8 km · 671 m · 6,8% · 15,5% | climbfinder 9,6 km · 683 m · 7,1% · 18,3% | cols-cyclisme 9,80 km · 675 m · 6,89% · max 9,1% (Michele: 9,1–9,8 km, 6,9–7,4%, 100 m più duri 19%) | +2% · −2% · −4% · **−15%** sui 100 m più duri |
| Selvino da Nembro (ultimi 10,5 km) | 10,5 km · 586 m · 5,6% · 11,6% | climbfinder 10,5 km · 594 m · 5,6% · 12,4% | komoot/kinomap: 10 km, poco sotto il 6% | 0 · −1% · 0 · −6% |
| Colle Gallo da Albino (ultimi 8,1 km) | 8,1 km · 401 m · 5,0% · 17,7% | climbfinder da Gramelduro 8,1 km · 411 m · 5,1% · 11,3% | bikeclimbs «by Piazza» 4,99 km · 316 m · 6,3% (mondo, ultimi 5 km: 5,0 km · 339 m · 6,8%) | 0 · −2% · −2% · **+57%** sui 100 m più duri (Via Ponte Lujo, vedi sotto); sui 5 km: +7% D+, +8% media |
| Passo della Presolana da Clusone (la salita intera) | 12,8 km · 661 m · 5,2% · 10,8% | climbfinder da Clusone 13,9 km · 711 m · 5,1% | climbfinder da Fino del Monte 10,9 km · 658 m · 6,0% · 10% (mondo, ultimi 10,9 km: 559 m · 5,1%) | −8% · −7% · +2% · +8% su Fino del Monte; sugli ultimi 10,9 km **−15%** di dislivello e media (vedi sotto: il tratto della scheda non è il nostro) |
| Colle di Zambla da Ponte Nossa | 13,9 km · 798 m · 5,7% · 12,1% | climbfinder 14,1 km · 811 m · 5,7% · 12,2% | komoot 14 km · 800 m; bikeclimbs 783 m | −1% · −2% · 0 · −1% |
| Colle di Zambla da Ambria (Zogno) | 24,0 km · 922 m · 3,8% · 13,0% | climbfinder 22,8 km · 970 m · 4,2% · 10,6% | — (nessuna seconda scheda in rete per questo versante: komoot e bikemap lo danno solo dentro giri ad anello) | +5% · −5% · −10% · **+23%** (vedi sotto) |
| Foppolo (ultimi 10,9 km, da Branzi) | 10,9 km · 707 m · 6,5% · 12,0% | climbfinder da Branzi 10,9 km · 792 m · 7,2% · 10,9% | bikeclimbs «branzi foppolo» 10,76 km · 753 m · 7% (mondo −6% sul dislivello) | 0 · **−11%** · −10% · +10% (vedi sotto: la scheda arriva agli impianti, 1635 m; il nodo di Foppolo è a 1521) |
| Passo San Marco da Olmo al Brembo | 19,2 km · 1410 m · 7,3% · 12,2% | climbfinder 19,2 km · 1436 m · 7,5% · 15,4% | cols-cyclisme 18,2 km · 1429 m · 7,85% · max 11% | 0 · −2% · −3% (−7% su cols) · **−21%** su climbfinder, +11% su cols |
| Maresana da Ponteranica | 3,1 km · 213 m · 6,9% · 20,4% | bikeclimbs «Crono salita Maresana» 4,16 km · 8,4% · max 30,6% | bikeclimbs «300 m finali» 0,33 km · 21,6% · max 31,1% | tratti diversi: media **−18%**, max **−33%** (vedi sotto) |
| Città Alta e San Vigilio | 4,8 km · 207 m · 4,3% · 19,6% | climbfinder San Vigilio via Fontana 2,3 km · 168 m · 7,3% · 12,1% | climbfinder da Porta Sant'Alessandro 0,7 km · 91 m · 13% · 16,9% | non confrontabili: il percorso sale per la città e il castello è il nodo OSM a 453 m, la scheda arriva al colle a 496 |
| Berghem MolaMia corto / medio | 72,5 km · D+ 1535 / 122,8 km · D+ 2468 | Eco di Bergamo: 72 km / 115 km | trainerday (edizione del 14/06/2026): medio 115 km · D+ 1148 m | +1% / **+7%** sulla lunghezza (il medio: Castro e Riva di Solto per la riva, poi la Val Cavallina; la cronaca non dice le strade); D+ del medio **+115%** (vedi sotto) |

## Cosa si è corretto nel livellamento

- **Ponti e sottopassi** (M.1): il DEM a 25 m non vede un cavalcavia né una trincea, e in fondovalle nei paesi (Gazzaniga) il livellamento appiattiva tutto alla quota del terrapieno. Adesso dove due strade si incrociano in pianta quella sopra passa con la luce, con rampe al 5% (al 3% sulla Ciclovia della Val Brembana, che ha il tetto al 3,5%). Cambia il profilo di 130 punti del mondo; sulle salite della tabella non cambia nulla (nessuna le attraversa).
- **Tetto di pendenza delle comunali** da 15% a 20%: i 100 m più duri della Ganda (SP41, tornanti di Orezzo) sono al 18–19% nelle schede e il mondo li fermava al 15,0%. Con il tetto al 20% salgono solo al 15,5%: il resto dello scarto è il DEM (vedi sotto). Lo stesso tetto vale per tutte le strade comunali: nessun'altra salita della tabella ha cambiato la media di più dello 0,1%.
- **Vie di montagna** (`unclassified`) da 20% a 24%: la Maresana (Via Casnidelli) resta sotto il vero (vedi sotto).

## Scarti oltre il 10%, spiegati

- **Ganda, i 100 m più duri (15,5% contro 18–19%)**: il tetto delle comunali era al 15% e lo si è alzato al 20%, ma il mondo è salito solo dal 15,0 al 15,5. Il resto è il DEM a 25 m e il livellamento: la quota è una media su un dischetto di 12 m e la penalità sulla variazione di pendenza (`MU`, rigidità 9 per le comunali) smussa un tornante di 100 m. La media (6,8% contro 6,9–7,1) e i 500 m più duri (14,1%) sono giusti: la salita è quella, ma i picchi brevi sono arrotondati. Lungo la salita il DEM grezzo, campionato ogni 5 m sulla pianta, dà il 16,6% sui 500 m più duri (il mondo 14,1%) ma anche un 32,6% su 100 m in Via Don Bossetti, che è il pendio a monte e non la strada: un livellamento che seguisse il DEM a 100 m seguirebbe anche quel rumore. Un DEM a 10 m (Lombardia, DTM 5 m) risolverebbe; non è in questo rilascio.
- **Colle Gallo, 17,7% sui 100 m (contro 11,3%)**: il picco sta su Via Ponte Lujo, una via di montagna (`unclassified`, tetto 24%) dove la strada scavalca il torrente Lujo senza il tag `bridge` in OSM: il DEM scende nella forra e il livellamento fa una gobba. È lo stesso difetto dei ponti non taggati: si corregge in OSM (o con un tag `bridge` dedotto dall'acqua), non qui. La media e il dislivello sono entro il 2%.
- **Presolana, −15% su dislivello e media**: la scheda di climbfinder parte da Fino del Monte (quota di partenza ~640 m) e misura 10,9 km; i nostri ultimi 10,9 km partono dopo Rovetta (738 m), più in alto. Dal bivio di Rovetta (12,9 km) il mondo dà 655 m e 5,1%: lo stesso dislivello della scheda su 2 km in più. Il tracciato OSRM/OSM da Clusone passa per Rovetta e Fino del Monte con un tratto in falsopiano in più.
- **Zambla da Ambria, +23% sui 100 m**: il picco (13%) è dentro Serina, su una via di paese (`residential`, tetto 24%) dove il DEM a 25 m pesca i tetti; sulla SP27 il massimo è l'11,9% dei 500 m. La media (3,8 contro 4,2) risente dei 1,2 km in più del tratto nostro (fino a Zogno il bivio di Ambria è un nodo diverso).
- **Foppolo, −11% sul dislivello**: la scheda arriva agli impianti di Foppolo (1635 m), il nostro percorso finisce al nodo OSM del paese (1521 m): gli ultimi 114 m di dislivello non sono nel percorso. Sui 10,9 km la media è 6,5 contro 7,2 per lo stesso motivo.
- **San Marco, −21% sui 100 m contro climbfinder (15,4%), +11% contro cols-cyclisme (11%)**: le due schede non concordano fra loro; il mondo sta in mezzo (12,2%). Lunghezza, dislivello e media sono entro il 3% con climbfinder.
- **Maresana**: Strava la misura a tratti e dà un muro al 30% negli ultimi 300 m; il DEM a 25 m non vede un muro di 300 m, e il tetto delle vie di montagna (alzato dal 20 al 24%) non è il limite: il mondo arriva al 20,4% sui 100 m e al 14% sui 500. La media della salita intera (6,9%) è sotto quella della crono (8,4%) perché la crono parte più in alto, dove la strada è già ripida.
- **Berghem MolaMia medio, D+ più che doppio**: 1148 m su 115 km (trainerday) non stanno con Selvino e Zambla nel tracciato, che da soli fanno più di 1300 m. O il medio vero non sale a Selvino, o il numero del calendario è sbagliato (dà 1358 m anche al lungo di 183 km); senza il GPX non si decide e il percorso resta quello della cronaca di Bergamo TV.
- **Berghem MolaMia medio, +7%**: la cronaca dice i paesi, non le strade; fra Lovere e Castro il navigatore segue la riva, e da Bianzano a Cene la Val Rossa. Il corto è a +1%.

## Le fonti

- climbfinder.com: [Passo di Ganda da Gazzaniga](https://climbfinder.com/en/climbs/passo-di-ganda-gazzaniga) (9,6 km, 683 m, 7,1%, 100 m più duri 18,3%), [Selvino da Nembro](https://climbfinder.com/en/climbs/selvino-nembro) (10,5 km, 594 m, 5,6%, 12,4%), [Passo della Presolana da Fino del Monte](https://climbfinder.com/en/climbs/passo-della-presolana-clusone) (10,9 km, 658 m, 6,0%, 10%), [Passo di Zambla da Ponte Nossa](https://climbfinder.com/en/climbs/passo-di-zambla-ponte-nossa) (14,1 km, 811 m, 5,7%, 12,2%), [Passo di Zambla da Ambria](https://climbfinder.com/en/climbs/passo-di-zambla-ambria) (22,8 km, 970 m, 4,2%, 10,6%), [Foppolo da Branzi](https://climbfinder.com/en/climbs/foppolo-branzi) (10,9 km, 792 m, 7,2%, 10,9%), [Passo di San Marco da Olmo al Brembo](https://climbfinder.com/en/climbs/passo-di-san-marco-olmo-al-brembo) (19,2 km, 1436 m, 7,5%, 15,4%), [Colle Gallo da Gramelduro](https://climbfinder.com/en/climbs/colle-gallo-gramelduro) (8,1 km, 411 m, 5,1%, 11,3%), [Colle di San Vigilio da Porta Sant'Alessandro](https://climbfinder.com/en/climbs/colle-di-san-vigilio-porta-sant-alessandro) (0,7 km, 91 m, 13%, 16,9%).
- cols-cyclisme.com: [Passo di Ganda depuis Gazzaniga](https://en.cols-cyclisme.com/massif-de-l-ortles/italie/passo-di-ganda-depuis-gazzaniga-c1624.htm) (9,80 km, 675 m, 6,89%, max 9,1%), [Passo di San Marco depuis Olmo al Brembo](https://www.cols-cyclisme.com/massif-de-l-ortles/italie/passo-di-san-marco-depuis-olmo-al-brembo-c1935.htm) (18,20 km, 1429 m, 7,85%, max 11%).
- bikeclimbs.com (segmenti Strava): [Colle Gallo by Piazza](https://bikeclimbs.com/climb/italy/lombardy/bergamo/albino/colle-gallo-by-piazza) (4,99 km, 316 m, 6,3%), [Colle Gallo da bivio Cene](https://bikeclimbs.com/climb/italy/lombardy/bergamo/albino/colle-gallo-da-bivio-cene) (8,9 km, 4,6%), [Crono salita Maresana](https://bikeclimbs.com/climb/italy/lombardy/bergamo/ponteranica/crono-salita-maresana) (4,16 km, 8,4%, max 30,6%), [Passo Zambla da Ponte Nossa](https://bikeclimbs.com/climb/italy/lombardy/bergamo/ponte-nossa/passo-zambla) (782,8 m), [Passo San Marco da Mezzoldo](https://bikeclimbs.com/climb/italy/lombardy/bergamo/mezzoldo/passo-san-marco-da-mezzoldo).
- Altre: [watts2win, Passo di Ganda](https://watts2win.eu/en/segment/373) (9,35 km, 7,07%); [tour-magazin, Passo San Marco](https://www.tour-magazin.de/en/tours/italy/passo-san-marco-the-pass-you-don-t-know-yet/) (18,5 km, 8,3%, punte oltre il 12%); komoot, Selvino da Nembro (10 km, poco sotto il 6%) e Zambla da Ponte Nossa (14 km, 800 m); [Eco di Bergamo / Bergamo TV sulla Berghem MolaMia](https://ecodibergamo.it/videos/bergamo-tv/tg/gazzaniga-granfondo-berghem-mola-mia-o_1067282_44) (percorsi 72, 115 e 183 km; Nembro, Selvino, Serina, Oltre il Colle, Zambla, Ponte Nossa; il medio per Clusone, Lovere, Castro, Riva di Solto, Solto Collina, Endine, Ranzanico, Bianzano, Passo Forcella, Cene). quaeldich.de e salite.ch non rispondono alle richieste automatiche (403): non sono stati usati.
