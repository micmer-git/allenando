# OROBIA: piano del prossimo rilascio

Base: `origin/main` 52178bd (PR #5, #6 e #7 in onda). Audit del 04/11/2026, build di produzione servita con `vite preview` su `localhost:5280`, Chrome headless con WebGL software (swiftshader), dati finti (profilo «Anna» appena creato, nessun giro salvato).
Schermate: `C:\Users\micme\AppData\Local\Temp\orobia-rilascio\audit\` (`p-*` pagine 390×844, `c-*` corsa 390×844, `w-*` telefono in orizzontale 844×390, `d-*` desktop 1280×800, `spot-*` punti del mondo). Script: `...\orobia-rilascio\script\` (`pagine.mjs`, `corsa.mjs`, `largo.mjs`).

⚠️ Il Worker accetta solo le porte 4173 e 5173 (`server/allenando-room/wrangler.jsonc`, `ALLOWED_ORIGINS`). Su 5280 «in rete: –», le classifiche vuote e i 403 del WebSocket sono colpa della porta, non dell'app. **Classifiche, stanze e sessioni si collaudano su 4173.**

## Le misure di partenza

| Misura | Oggi | Come |
|---|---|---|
| Pacchetto iniziale `index-*.js` | **2,19 MB, 588 kB gzip** | `npm run build` |
| Pacchetto `Ride-*.js` | 105 kB, 33 kB gzip | idem |
| Mondo pronto, Città Alta / libero / Selvino / Val Seriana / Ganda | 6,8 / 5,4 / 2,0 / 5,7 / 6,1 s | `corsa.mjs`, `world-shot.mjs` (headless, locale) |
| FPS swiftshader: percorso / libero / salita | 3,6 / 1,1 / 5,1 | `corsa.mjs`. Contano solo come confronto, non sono un telefono |
| Heap JS dopo tre corse | 331 MB | `performance.memory` |
| Altezza del 3D in verticale | 577 px su 844 | `corsa.mjs` |
| 3D in orizzontale 844×390 | **444×390** | `largo.mjs` |
| Pagine più lunghe | Allenamenti 10 505 px, Traguardi 5 217, Garage 4 120 | `pagine.mjs` |
| Test | 22 file vitest | `npm test` |

Non c'è modo di leggere chiamate di disegno e triangoli: manca un aggancio (vedi 3.1).

## Audit, in ordine di costo per chi pedala

Formato: stato · prova · costo · correzione più piccola · verifica.

**A1. Il giro non si salva da solo.** Fine giro → riepilogo con «Salva» (`Ride.tsx:1062`, `saveRide` solo al tocco). · `c-25-riepilogo.png` · Chiudere la scheda, tornare indietro o un crash di Safari dopo due ore = giro perso, niente FIT per Strava. · Salvare in IndexedDB al «Termina»; nel riepilogo «Fatto» e «Scarta» (con conferma). · Prova vitest: `finish()` → il giro è nel db senza tocchi; collaudo: Termina, ricarica, il giro è in `/history`.

**A2. La corsa parte prima del mondo.** A 1,2 s dall'apertura il 3D è un vuoto grigio, il ciclista e l'arco galleggiano, ma il cronometro del GPM corre (0:00,1) e arriva l'oro di «Fontanella +4». · `c-20-corsa-caricamento.png` · Primo impatto da gioco rotto; sul telefono lento il vuoto dura di più e il tempo del tratto conta anche il caricamento. · Velo di caricamento sul 3D (marchio, nome del percorso, avanzamento) fino a `world-ready`; orologio, tratti e punti caldi fermi fino ad allora. · Schermata a 1,2 s con il velo; `ride-km` a 00:00, niente `segment-live` né `poi-toast` prima di `data-ready=yes`.

**A3. «Termina» è il tasto primario della corsa.** Giallo pieno, grande quanto «Pausa», un tocco chiude il giro. · `c-22-corsa-10x.png` · Il dito sudato sul telefono al manubrio chiude l'allenamento; e il colore più forte dello schermo va all'azione che si vuole meno. · «Pausa» e «Termina» fantasma; «Termina» si tiene premuto 0,8 s (anello che si riempie) oppure sta nel foglio della pausa. · Un clic su `ride-finish` non apre il riepilogo; nella corsa nessun tasto giallo pieno tranne la velocità scelta.

**A4. La pausa non si vede.** Cambia solo la scritta in «Riprendi»; watt e velocità restano a schermo come se si pedalasse. · `c-24-pausa.png` · Sul rullo non sai se il tempo corre. · Velo sul 3D con «In pausa», tempo fermo, numeri spenti; «Riprendi» primario, «Termina e salva», «Impostazioni». · Schermata; i numeri non cambiano per 5 s.

**A5. In orizzontale e sul computer il 3D è mezzo schermo.** A 844×390 il 3D è 444×390 e a destra c'è un pannello; a 1280×800 la colonna destra è vuota dai 260 px in giù e i testi sono da 10–11 px. · `w-30-corsa-orizzontale.png`, `d-44-corsa.png` · Il rullo si usa col tablet o lo schermo in orizzontale a un metro e mezzo: metà vista persa, numeri illeggibili. · 3D a tutto schermo, dati in una striscia di vetro sopra il 3D, numeri principali ≥ 32 px sul largo. · Canvas ≥ 840×390 e 1280×800; schermate.

**A6. 588 kB gzip prima di vedere «Oggi».** `World.tsx:16` importa `kindLabel` da `@/open/WorldScene`: three.js e r3f finiscono nel pacchetto iniziale. · build · Primo avvio della PWA lento su rete mobile, 2,2 MB di JS da leggere su un telefono medio. · Spostare `kindLabel` in un modulo senza 3D. · `index-*.js` ≤ 300 kB gzip; `WebGLRenderer` assente da `index-*.js`.

**A7. La scelta all'incrocio non si legge.** Quattro riquadri con nomi troncati («San To…», «Borgo P…», «Viale Pa…») a 67 m; alla partenza due scelte entrambe «Città Alta»; «destra» minuscolo. · `c-24-pausa.png`, `c-21-corsa-pronta.png`, `w-30-corsa-orizzontale.png` · A 30 km/h 67 m sono 8 s: non si sceglie, si tira a indovinare. · Al massimo tre frecce grandi, un nome solo per freccia e senza troncare; sul percorso la freccia del percorso dice «Percorso». · Nessun testo con ellissi in `turn-picker`; etichette diverse fra loro (prova unitaria).

**A8. L'HUD in verticale non ha gerarchia.** Tempo e km a 15 px in una riga sotto i riquadri; «Sforzo» e 1×/4×/10× sempre a schermo; il pannello basso è 267 px su 844; il banner del GPM sta in mezzo alla strada (128–198 px) sopra due pillole. · `c-22-corsa-10x.png` · Le tre cifre che si guardano (watt, tempo, km) non stanno insieme; la strada davanti è coperta. · Watt, tempo e km grandi; velocità, pendenza, cadenza, FC secondari; i comandi del simulatore in una riga sola e solo col simulatore; banner del tratto compatto sotto il titolo. · Tempo e km ≥ 28 px calcolati; 3D ≥ 620 px su 844; nessun elemento dell'HUD nella fascia 35–65% dell'altezza del 3D tranne la scelta all'incrocio.

**A9. Scheda della salita: l'azione sta al terzo schermo.** «Pedala · pendenza al rullo» a ~1070 px; la quota «328→94!» esce dal riquadro; la legenda dice «punti verdi: tornanti» ma i punti sono gialli; «Km più duro» va a capo e disallinea. · `p-05-salita-selvino.png`, `p-05-salita-selvino-tutta.png` · Si apre la salita per pedalarla e bisogna scorrere due volte. · Tasto fisso sopra la barra; quota «328 → 945 m» su due righe; legenda corretta. · A 390×844 il tasto è nel primo schermo; nessun riquadro con `scrollWidth > clientWidth`.

**A10. Testi che cominciano in minuscolo** (regola di Michele, vale dieci volte). «in rete: –», «nel mondo», «da Nembro», «fino a 455 m», «media 6,9%», «dalla stazione al castello», «apre 11:45», «nessun tempo», «la partenza / l'arrivo», «livello 1 · …», «punti ·», «non collegato», «file DEMO», «percorsi · Città Alta…», e nel 3D «destra», «paese», «passo», «città», «porfido», «sterrato», «pista ciclabile». · `p-report.json` (campo `min`), `w-30`, `spot-m-60` · «Very AI slop». · Maiuscola ovunque, e il controllo automatico nei collaudi. · Il controllo `minuscole` di `pagine.mjs` dà zero su tutte le pagine e nei pannelli della corsa.

**A11. Testi troncati dove contano.** Sessioni «Uscita di gruppo A · 2,9 W…» (i W/kg tagliati); Oggi «Uscita di gruppo A · …», «Ciclovia della Val Bremb…»; Tu «Maglie, caschi, b…», «ERG e test a ra…», «Forma, fatica, e…»; Classifiche «Mortirolo da Mazzo di Va…»; titolo della corsa «dalla stazio…». · `p-06`, `p-02`, `p-08`, `p-10`, `c-22` · Il dato che decide (quanto va forte il gruppo) è quello che sparisce. · Due righe o un dato in meno, non l'ellissi. · Zero elementi con ellissi nel primo schermo di Oggi, Sessioni, Tu, Classifiche.

**A12. Il telefono in orizzontale prende il menu del computer.** A 844×390 compare il menu laterale da 240 px, le voci escono dallo schermo, del contenuto si vede un saluto e mezza carta. · `w-31-oggi-orizzontale.png` · Il telefono sul manubrio in orizzontale non naviga. · Menu laterale solo da 1024 px di larghezza e 600 di altezza; sotto, barra bassa o colonna di sole icone. · A 844×390 tutte le voci di navigazione dentro lo schermo e la prima carta intera.

**A13. Mondo: la carta comincia a 280 px.** Sopra le schede ci sono il livello (doppione di Oggi e Tu) e «in rete: –». · `p-03-mondo.png` · Il compito della pagina è scegliere dove pedalare; il livello spinge giù la carta. · Togliere la carta del livello; «In strada ora: N» solo se N > 0; via le righe di istruzioni. · Cima della carta ≤ 220 px a 390×844.

**A14. Dettaglio del giro: grafici sovrapposti, TSS diverso, niente carta.** «Quota» scritta sopra il grafico della FC, «Tempo nelle zone di FC» sopra quello della quota; TSS 0 nel dettaglio e 0,3 nel riepilogo; il giro ha la traccia GPS vera ma non c'è una carta. · `c-29-dettaglio-giro-tutta.png`, `c-25-riepilogo.png` · È la pagina che si guarda dopo; Bergamo vera è il differenziatore e qui non si vede. · Spazi fra i grafici; un solo formattatore del TSS; la carta con la traccia (`WorldMap` o `RouteViz`). · Le scatole delle etichette non si intersecano; prova unitaria sul TSS; schermata con la traccia.

**A15. La barretta d'accento sul lato delle carte** (stampo vietato, `core/70-design.md` §8). Carta della sessione in Oggi e tutte le carte di Sessioni. · `p-02-oggi.png`, `p-06-sessioni.png` · Firma da pagina generata; il colore da solo non dice il tipo. · Gettone col tipo (Gruppo, Crono, Volate, Salita) e il suo segno. · Schermate.

**A16. Tre nomi per i punti.** Mondo «0 XP», Tu «0 punti · 500 al livello 2», riepilogo «+31 XP», più l'oro. · `p-03`, `p-08`, `c-25` · Non si capisce cosa compra cosa. · «Punti» per il livello, «Oro» per il negozio, ovunque. · Nessun «XP» nei testi visibili.

**A17. Oggi: due azioni gialle nel primo schermo, e riquadri vuoti.** «Installa OROBIA» pieno come la freccia del mondo; «KM · 7 GG –», «TSS –», «FORMA 0» per chi non ha giri; l'anello col «1» senza etichetta. · `p-02-oggi.png`, `p-02-oggi-tutta.png` · La prossima mossa non è una. · Installa diventa una riga leggera (o compare dopo il primo giro); i riquadri dei 7 giorni compaiono col primo giro; «Liv. 1» scritto. · Un solo tasto giallo pieno nel primo schermo.

**A18. Prosa che spiega quello che si vede.** Salite «Tre salite, quattro versanti. La pianta è…» e l'occhiello «OSM + EU-DEM»; Selvino «Da dove vengono i dati» e il paragrafo su FTMS ed ERG; Anello, nota in fondo; Allenamenti «Libreria pronta e i tuoi schemi…»; Mondo «Tocca una linea sulla carta…». · `p-04`, `p-05-tutta`, `p-03-mondo-tab2-Anello`, `p-11` · «Troppo sbobbo». · Via; le fonti in un «Fonti» chiuso. · Parole nel primo schermo di Salite ≤ 60.

**A19. Bersagli sotto 44 px.** «← Salite» 51×18, «Indietro» 50×18 (editor, dettaglio giro), «Togli» 30×20, «Carico» 42×20, «Importa» 59×24, «Torna al diario» 91×18, «Fisica del mondo» 324×24, casella «Rampa fino a». · `p-report.json` · Mancati col dito. · Area di tocco ≥ 44 px anche quando il testo resta leggero. · `audit().small` vuoto su tutte le pagine.

**A20. Traguardi.** Barra di scorrimento grigia sotto i filtri, quarto filtro tagliato, la stessa icona per 50 voci, 5 217 px di lista. · `p-09-traguardi.png` · Non si trova il prossimo traguardo. · Barra nascosta, un segno per categoria, «Quasi tuoi» (i tre più vicini) in cima. · Schermata.

**A21. Titoli e ritorni incoerenti.** SALITE, SESSIONI, GARAGE in maiuscolo; «Allenamenti», «Profilo», «Schema», «Bergamo e le valli» no; Allenamenti, Profilo e Diario, aperti da Tu, non hanno il ritorno. · `p-11`, `p-15`, `p-12`, `p-13` · Sembrano pagine di app diverse. · Un componente di testata unico. · Schermate.

**A22. Profilo: «Cancella tutti i dati» rosso pieno sotto «Salva».** «Salva» solo in fondo. · `p-15-profilo-tutta.png` · Un tocco sbagliato costa tutto. · Salvataggio al cambio del campo; cancellazione in un «Zona pericolosa» chiuso, con conferma. · Schermata.

**A23. Sessioni: dalla lista non si entra.** Nessuna carta dice «Aperta ora · Entra» (c'è solo in Oggi, `w-31`). · `p-06-sessioni.png` · Chi apre Sessioni deve tornare in Oggi. · Stato e tasto sulla sessione aperta. · Schermata a 12 minuti dal via.

### Il mondo 3D

**M1. Etichette dei luoghi nel cielo:** tagliate al bordo («do Petello», «pas…»), sopra i pannelli, visibili attraverso le montagne, tipo in minuscolo. · `spot-m-60-valseriana.png`, `c-26-libero-dopo.png`, `c-22` («onizetti») · Rumore sulla vista, sembra un errore. · Dissolvenza oltre 1,5 km, nascoste dietro il terreno, mai tagliate dal bordo né nella fascia alta dell'HUD, al massimo 3 a schermo.

**M2. Pareti di terreno verticali lungo la strada.** La ciclabile della Val Seriana corre in un canyon grigio. · `spot-m-60-valseriana.png` · Il paesaggio vero (il fiume, i prati) non si vede.

**M3. In città il suolo è prato.** Il piazzale della stazione di Bergamo è un prato verde uniforme. · `c-21-corsa-pronta.png` · La prima schermata del primo percorso.

**M4. Vegetazione rada e tutta uguale.** Icosaedri grandi, tre alberi sul versante boscoso della Ganda. · `spot-m-61-ganda.png`, `c-27-salita.png`

**M5. Marciapiede che finisce a gradino.** · `c-26-libero-dopo.png`

**M6. Texture del pendio a quadretti.** · `c-27-salita.png`

**M7. Capannoni e case di valle come scatole grigie.** · `spot-m-60-valseriana.png`

**M8. Luce piatta:** cielo grigio uniforme, nebbia scura, nessuna ombra del ciclista sulla strada. · `c-22`, `spot-m-61`

**M9. Pop-in:** a 1,2 s il mondo non c'è (`c-20`); «pronto» oggi non vuol dire «intorno a me c'è tutto».

Non ricontrollati qui, e da non far regredire: rotatorie, gallerie, case sul pendio, monumenti, semafori, archi. I punti sono quelli della pagina prima/dopo del 4/11.

### I «packet» delle schermate che cambiano

| Schermata | Chi, stato | Risposta in 2–3 s | Azione primaria |
|---|---|---|---|
| Oggi | Chi apre l'app per pedalare | Cosa c'è adesso: sessione aperta, missioni, dove ho lasciato | Pedala (sessione o mondo) |
| Mondo | Chi sceglie dove | La carta con i percorsi | Tocca un percorso → Pedala |
| Salita | Chi ha scelto la salita | Quanto è dura, dove sono i tornanti | Pedala |
| Corsa | In sella, a un metro e mezzo | Watt, tempo, km; cosa arriva (incrocio, tratto, arco) | Nessuna: pedalare. Pausa a portata |
| Pausa | Fermo | Il tempo è fermo | Riprendi |
| Riepilogo | Appena finito | Cosa ho fatto, cosa ho guadagnato, è salvato | Fatto (già salvato), poi FIT e Cartolina |
| Sessioni | Chi cerca compagnia | Quale si apre ora, a che ritmo | Entra |

## Il confronto

**Quello che manca rispetto a Zwift e MyWhoosh**, in ordine di peso:
1. La sicurezza del giro: salvataggio automatico e ripresa dopo un crash (A1).
2. La corsa a tutto schermo in orizzontale, coi numeri leggibili da lontano (A5).
3. Il fantasma del proprio record su percorsi e tratti (holoreplay di Zwift, PR di MyWhoosh).
4. I programmi di allenamento a settimane, con «l'allenamento di oggi».
5. L'importazione dei file `.zwo`: chi viene da Zwift porta i suoi allenamenti.
6. Un caricamento che non mostra il mondo vuoto (A2).
Corse vere con altre persone, chat e «Ride On» restano fuori: chiederebbero server e moderazione.

**Quello che rende OROBIA diversa, e va messo davanti**: Bergamo e le valli vere, coi 40 monumenti; le salite verificate dalla traccia; il FIT col GPS vero che Strava mette sulla mappa di Bergamo; nessun account, offline, gratis; le sessioni ogni mezz'ora senza server; le volate del cassonetto. Oggi il differenziatore si vede poco fuori dalla corsa: il dettaglio del giro non ha la carta (A14), il riepilogo neppure.

## Le quattro piste

Ognuna parte da `origin/main` 52178bd in un worktree suo, ramo `claude/orobia-<pista>-04-11`, apre una PR quando i P0 sono fatti (prima revisione), poi continua. Ordine di merge: **3 → 2 → 1 → 4**. Chi viene dopo fa rebase su `main` prima della PR.

### File condivisi: chi li tocca

| File | Padrone | Gli altri |
|---|---|---|
| `src/index.css`, `src/brand.ts` | Pista 1 | Chiedono il gettone al PM, la pista 1 lo aggiunge. Oro `#ffc814` e caratteri non si cambiano |
| `src/components/ui.tsx` | Pista 1 | Lo usano com'è; una variante serve solo a loro → resta nel loro file |
| `src/i18n/it.ts` | Pista 1 | Aggiungono chiavi solo in fondo al proprio blocco: `ride.*` (2), `world3d.*` (3), `nuovo.*` (4) |
| `src/App.tsx` | Pista 1 | Pista 4 aggiunge una riga (`/programmi`) dopo il merge della 1 |
| `src/pages/World.tsx` | Pista 1 | Pista 3 cambia solo la riga dell'import di `kindLabel` (3.2) |
| `src/pages/Home.tsx` | Pista 1 | Pista 4 aggiunge una riga (l'allenamento di oggi) dopo il merge della 1 |
| `src/pages/Ride.tsx` | Pista 2 | Pista 4: ≤ 20 righe nel riepilogo (cartolina) e per il fantasma, dopo il merge della 2 |
| `src/open/WorldScene.tsx` | Pista 3 | Pista 2 gli chiede `onProgress(0..1)` per il velo (3.3 lo consegna); pista 4 una prop per il fantasma |
| `src/store/useApp.ts` | Pista 2 per il salvataggio dei giri | Pista 1 non lo tocca |
| `scripts/ui-shot.mjs`, `scripts/game-shot.mjs` | Si aggiungono controlli in coda, non si riscrivono | Ognuno aggiorna i `data-testid` che cambia, e lo dice nella PR |

Prove nuove: un file per pista (`src/**/<pista>-*.test.ts`), così non si pestano.

### Pista 1: pagine e navigazione

**Possiede**: `src/pages/` tranne `Ride`, `WorldHud`, `RideGameHud`, `RideRoom`; `src/components/` tranne `RiderPreview.tsx`; `src/index.css`, `src/brand.ts`, `src/i18n/it.ts`, `src/App.tsx`, `src/domain/format.ts`.

P0
- **1.1 Scheda salita** (A9). Fatto: a 390×844 il tasto «Pedala» è nel primo schermo a `scrollY=0`; nessun riquadro dei numeri con `scrollWidth > clientWidth`; legenda del colore dei punti.
- **1.2 Maiuscole** (A10, pagine). Fatto: il controllo `minuscole` di `pagine.mjs` portato dentro `ui-shot.mjs` e `game-shot.mjs`, che falliscono se trova una stringa; zero su tutte le 20 pagine e le 5 schede del Mondo, eccezioni solo per le unità (km, m, W, rpm).
- **1.3 Bersagli** (A19). Fatto: `audit().small` vuoto su tutte le pagine a 390×844.
- **1.4 Telefono in orizzontale** (A12). Fatto: a 844×390 nessuna voce di navigazione fuori schermo e la prima carta di Oggi intera; a 1280×800 il menu laterale resta.

P1
- **1.5 Mondo** (A13). Fatto: cima della carta ≤ 220 px a 390×844; niente «in rete: –».
- **1.6 Troncature** (A11). Fatto: zero ellissi nel primo schermo di Oggi, Sessioni, Tu, Classifiche.
- **1.7 Sessioni** (A15, A23). Fatto: nessun `border-left` colorato sulle carte; gettone del tipo; «Aperta ora · Entra» sulla sessione aperta (schermata fra −15 e +5 min dal via).
- **1.8 Dettaglio del giro** (A14). Fatto: etichette dei grafici che non si intersecano (controllo coi rettangoli); TSS uguale nel riepilogo e nel dettaglio (prova unitaria sul formattatore); carta con la traccia per i giri con GPS.
- **1.9 Oggi** (A17). Fatto: un solo tasto giallo pieno nel primo schermo; riquadri dei 7 giorni solo con almeno un giro.
- **1.10 Un nome per i punti** (A16). Fatto: nessun «XP» nei testi visibili.

P2
- **1.11 Prosa** (A18). Fatto: ≤ 60 parole nel primo schermo di Salite; «Fonti» chiuso nella scheda della salita.
- **1.12 Traguardi** (A20). Fatto: niente barra di scorrimento visibile; «Quasi tuoi» in cima.
- **1.13 Testata unica** (A21), con il ritorno a Tu da Allenamenti, Profilo, Diario, Traguardi, Classifiche.
- **1.14 Profilo** (A22). Fatto: «Cancella» solo dentro un blocco chiuso e con conferma.
- **1.15 Allenamenti ed editor.** Fatto: il primo allenamento della lista entro 450 px a 390×844 (i filtri in una riga, il resto in un foglio); nell'editor il grafico in cima e «Blocco 1».

### Pista 2: la corsa

**Possiede**: `src/pages/Ride.tsx`, `WorldHud.tsx`, `RideGameHud.tsx`, `RideRoom.tsx`; `src/sim/*`; `src/game/rideGame.ts`, `arches.ts`, `ergArches.ts`, `segments.ts`, `pacers.ts`; le azioni dei giri in `src/store/useApp.ts`; nuovo `src/sim/recovery.ts`.

P0
- **2.1 Il giro si salva da solo, e riprende** (A1, novità N1). Salvataggio al «Termina»; ogni 15 s un punto di ripresa in IndexedDB; riaprendo, «Hai un giro a metà: Riprendi / Salva com'è». Fatto: prova vitest (salvataggio senza tocchi, ripresa con km e tempo uguali entro 1 s); collaudo: chiudere la scheda a 60 s, riaprire, riprendere.
- **2.2 Niente corsa prima del mondo** (A2). Fatto: schermata a 1,2 s col velo e il nome del percorso; nessun `segment-live` né `poi-toast` e tempo 00:00 prima di `world-ready`; prova sul gioco.
- **2.3 Termina** (A3). Fatto: un clic non apre il riepilogo; tenendo premuto 0,8 s sì (prova nel collaudo con eventi touch); nessun tasto giallo pieno nella corsa tranne la velocità scelta.
- **2.4 Pausa** (A4). Fatto: schermata col velo «In pausa»; tempo e km fermi per 5 s.
- **2.5 Orizzontale e computer** (A5). Fatto: canvas ≥ 840×390 a 844×390 e 1280×800 a 1280×800; watt, tempo e km ≥ 32 px a 1280.

P1
- **2.6 Gerarchia dell'HUD in verticale** (A8). Fatto: watt, tempo, km ≥ 28 px; 3D ≥ 620 px su 844; «Sforzo» e 1×/4×/10× solo col simulatore.
- **2.7 L'incrocio** (A7). Fatto: al massimo 3 scelte; nessuna ellissi in `turn-picker`; etichette diverse; schermate a Città Alta `at=130` e `at=1500`.
- **2.8 Banner dei tratti** (A8). Fatto: nessun pannello nella fascia 35–65% dell'altezza del 3D tranne l'incrocio.
- **2.9 Riepilogo.** Fatto: carta con la traccia e profilo; prima tempo, km, D+, watt medi, poi oro e punti; maiuscole.

P2
- **2.10 Pausa automatica col rullo**: 0 W e 0 rpm per 3 s → pausa, riparte alla prima pedalata. Fatto: prova sul motore; mai col simulatore.

### Pista 3: il mondo 3D

**Possiede**: `src/open/` (`WorldScene.tsx`, `tiles`, `streets`, `rings`, `tunnels`, `buildings`, `textures`, `sky`, `weather`, `farMask`, `field`, `npc`, `monumenti`); `src/world/*`; `src/components/RiderPreview.tsx`; nuovo `src/open/labels.ts`; `scripts/world/*` solo se rigenera i dati e li ha in locale.

P0
- **3.1 Le misure.** `?stats=1` espone `window.__orobiaStats`: chiamate di disegno, triangoli, geometrie, texture, tempo per fotogramma p50/p95, mattonelle caricate e in attesa. Fatto: tabella delle misure ai sei punti standard (sotto) **prima** di ogni modifica, nella PR.
- **3.2 Il pacchetto** (A6). `kindLabel` in `src/open/labels.ts`. Fatto: `index-*.js` ≤ 300 kB gzip; `WebGLRenderer` assente da `index-*.js`.
- **3.3 Pronto vuol dire pronto** (M9). `world-ready` solo quando le mattonelle entro 400 m sono in scena; `onProgress(0..1)` per il velo della pista 2. Fatto: alla prima schermata dopo `ready` suolo, strada e case intorno.
- **3.4 Le etichette** (M1). Fatto: schermate `spot-m-60` e `c-26` rifatte senza etichette tagliate né sopra l'HUD; tipi con la maiuscola o tolti.

P1
- **3.5 Suolo di città** (M3). Fatto: schermata Città Alta `at=0` con pavimentazione al posto del prato.
- **3.6 Niente pareti di terreno** (M2). Fatto: schermata Val Seriana `at=9000`; prova sul campo: pendenza del terreno fra 6 e 20 m dal bordo della strada ≤ 1:1, gallerie e muri di sostegno esclusi.
- **3.7 Vegetazione** (M4). Boschi più fitti dove il versante è boscoso, tre specie, scala e colore variati, istanziati. Fatto: schermata Ganda `at=16000`; chiamate di disegno +10 al massimo, triangoli entro il tetto della qualità.
- **3.8 Marciapiedi** (M5). Fatto: rampa o raccordo alla fine; schermata libero `edge=0&s=0`.
- **3.9 Pop-in** (M9). Mattonelle e dettagli entrano in dissolvenza (300 ms), il terreno lontano per primo. Fatto: tre schermate a 1,5 / 3 / 6 s; con le misure, nessun oggetto che compare entro 150 m in 10 s a 40 km/h.

P2
- **3.10 Luce e cielo** (M8): cielo a gradiente con la direzione del sole, nebbia del colore del cielo, ombra di contatto del ciclista. Fatto: schermate; tempo per fotogramma p95 non più alto del 10%.
- **3.11 Texture del pendio** (M6) e **3.12 case di valle** (M7).

**Punti standard del mondo** (per 3.1 e per la revisione): Città Alta `ride=citta-alta&at=0` e `at=1500`; giro libero `edge=0&s=0&dir=1`; Selvino `route=selvino-nembro&at=5200`; Val Seriana `ride=val-seriana&at=9000`; Ganda `ride=ganda&at=16000`. Più quelli della pagina prima/dopo del 4/11.

### Pista 4: novità

**Possiede**: solo file nuovi: `src/game/ghosts.ts`, `src/io/share-image.ts`, `src/components/ShareCard.tsx`, `src/domain/plans.ts`, `src/pages/Plans.tsx`, `src/io/zwo.ts`, e le loro prove. I punti d'aggancio nei file delle altre piste, ≤ 20 righe ciascuno, li fa dopo il loro merge e li elenca nella PR.

P0
- **N2. Il tuo fantasma su percorsi e tratti.** Il giro migliore su ognuno dei 14 percorsi (e sui tratti) diventa un ciclista trasparente in strada, col distacco in secondi. Perché: è il motivo per rifare un percorso, e oggi c'è solo sulle 4 salite. Fatto: prova vitest (record salvato e letto al metro); collaudo: due giri su Maresana, al secondo il fantasma si vede e `ghost-gap` dice i secondi.
- **N3. La cartolina del giro.** Un'immagine 1080×1350 con la traccia sulla carta di Bergamo, il profilo, tempo, km, D+, i monumenti passati e il marchio, condivisa col pannello del telefono (Web Share con file) o scaricata. Perché: porta Bergamo vera fuori dall'app, senza login. Fatto: prova sul disegno (dimensioni, nessun testo fuori dal riquadro); il tasto «Cartolina» nel riepilogo e nel dettaglio; schermata del PNG.

P1
- **N4. Programmi di allenamento.** Tre programmi coi 33 allenamenti che ci sono («Primo Selvino» 4 settimane, «Base d'inverno» 6, «Sotto l'ora alla Ganda» 4), il posto dove pedalarli già scelto, e in Oggi «L'allenamento di oggi» con un tocco per partire. Perché: è la ragione per tornare tutti i giorni. Fatto: prova sul calendario (giorni, recupero, avanzamento salvato); Oggi mostra la riga giusta per la data; partire apre la corsa con allenamento e percorso.

P2
- **N5. Allenamenti `.zwo`.** Importare (e esportare) i file di allenamento di Zwift. Perché: chi passa da Zwift porta i suoi schemi. Fatto: prova del parser su tre file veri (SteadyState, IntervalsT, Ramp, FreeRide); l'allenamento importato va in ERG con gli archi.

N1 (il giro che riprende dopo un crash) è nella pista 2, voce 2.1.

## Quando il rilascio è «fatto»

1. `npm test` verde, con le prove nuove di ogni pista; `npm run build` verde (con `tsc`).
2. Collaudi verdi su `vite preview --port 4173`: `ui-shot.mjs`, `game-shot.mjs` con `RIDE=1 GIOCO=1`, `world-shot.mjs` ai punti standard, e `pagine.mjs`, `corsa.mjs`, `largo.mjs` di questo audit: zero errori di pagina, zero overflow, zero bersagli sotto 44 px, zero minuscole, a 390×844, 844×390 e 1280×800.
3. Numeri: `index-*.js` ≤ 300 kB gzip (da 588); mondo pronto entro +10% ai punti standard; tempo per fotogramma p95 e chiamate di disegno non oltre +10% (o il guadagno visivo dichiarato e accettato); heap dopo tre corse ≤ 331 MB.
4. Schermate prima/dopo con gli stessi nomi di `audit\`, stesse dimensioni, in `public/prima-dopo/<data>/`, fuori dalla cache dell'app come quella del 4/11.
5. `README.md` e `KNOWN_LIMITATIONS.md` aggiornati.
6. PR fuse, Pages in onda, e il collaudo rifatto su `https://micmer-git.github.io/allenando/`.
7. Nulla perso dalle richieste di prima: carta e pallino sull'altimetria, archi, cassonetti, crono, sessioni, negozio, FIT con quota e GPS, rotatorie, gallerie, monumenti, giro della Ganda.

## Come rivedo ogni consegna

1. **Confini.** `git diff --stat origin/main...` contiene solo i file della pista e i punti d'aggancio dichiarati. Altrimenti torna indietro senza guardare il resto.
2. **Build e prove** nel suo worktree, poi `vite preview` su 4173.
3. **Le stesse schermate** di `audit\`, agli stessi stati e dimensioni, messe accanto: guardo le immagini prima del codice.
4. **Ogni voce P0 e P1 contro il suo «fatto»**, alla lettera: un numero misurato, una schermata, il nome di una prova. Senza la prova la voce è «non fatta», anche se il codice c'è.
5. **Il canone**: un solo accento pieno per schermata, niente barretta laterale, niente prosa che spiega, maiuscola iniziale, accenti giusti, nessuna parola inglese a schermo, marchio e caratteri invariati.
6. **Bocciata** se: un collaudo diventa rosso; un errore di pagina; overflow; un bersaglio sotto 44 px; una minuscola; testo troncato nell'area toccata; `index-*.js` oltre 300 kB gzip o `Ride-*.js` +5% senza motivo; mondo pronto +20%; tempo per fotogramma o chiamate di disegno +15% senza guadagno visibile; una regressione ai punti della pagina prima/dopo del 4/11; una funzione delle richieste di prima che sparisce.
7. **Il riscontro** in un messaggio solo, voce per voce: PASSA, oppure RIFARE con stato, prova, costo, correzione, verifica.
