# OROBIA · audit dell'interfaccia e delle opzioni

Base: worktree `orobia-funzioni`, `f2b38b3` + lavoro non committato di un'altra sessione (letto, non toccato). 11/11/2026.
Schermate (nessun lancio nuovo, bastavano queste):

| sigla | cartella |
|---|---|
| `F/` | `C:\Users\micme\AppData\Local\Temp\orobia-sellaronda\f\dopo\` (ramo con la scelta del mondo) |
| `F2/` | `...\orobia-sellaronda\f\pagine2\` (pagine + `report.txt`, 278 controlli) |
| `PM/` | `...\orobia-sellaronda\pm\F\` (corsa senza rete) |
| `U/` | `C:\Users\micme\AppData\Local\Temp\orobia-rilascio\unione\dopo\` (audit 04/11: `p-*`, `c-*`, `d-*`) |

Formato di ogni voce: **stato · prova · costo per chi pedala · correzione**.

---

## 1. Le misure di partenza

| misura | oggi | dove |
|---|---|---|
| Rotte | **21** + `*` (non 17) | `src/App.tsx:43-64` |
| Voci di navigazione | **6** in basso, **11** sul computer | `src/components/Nav.tsx:6-22` |
| Tappe per arrivare a un'opzione della corsa | 4 pagine diverse (Oggi, Mondo, Salite, Allenamenti) + Tu → Rifai un giro | sotto |
| Tasti in una pagina Allenamenti | 33 carte × 3 (Inizia, Duplica, Esporta .zwo) = **99**, 10 505 px | `U/p-11-allenamenti-tutta.png` |
| Posti dove si sceglie «Rullo / Simulatore» | **5** (classifica in Mondo, scheda percorso, salita ×2, sessioni) + pagina Classifiche | `src/components/Board.tsx:26-32`, `src/pages/World.tsx:363-369` |
| Generatori di anelli | **2**, diversi (Mondo › Anello con «strade»; Allenamenti › Anello a 27 km/h fissi) | `World.tsx:497`, `Workouts.tsx:125-139` |
| Liste dei giri salvati | **2** (Diario `/history`, Rifai un giro `/giri`) | `History.tsx`, `Rides.tsx` |
| Mondo leggibile senza rete | solo dopo lo scarico intero, **20 MB** (19,6 MB, 1 135 file) | `public/world/bergamo/manifest.json` |

Peso del mondo di Bergamo, misurato sui file:

| pezzo | crudo | gzip | serve a |
|---|---|---|---|
| `graph.json` | 4,49 MB | 1,56 MB | le strade, le quote della strada |
| `features.json` | 2,11 MB | 0,64 MB | paesi, passi, luoghi, fiumi |
| `rides.json` + `monumenti.json` + `far.bin` | 0,18 MB | 0,15 MB | percorsi, monumenti, terreno lontano |
| **leggero** (somma sopra) | **6,8 MB** | **2,4 MB** | |
| `dem/` 576 mattonelle | 4,89 MB | 4,9 MB | terreno a 25 m, uso del suolo, alberi |
| `b/` 554 mattonelle | 7,91 MB | 2,86 MB | case |
| **intero** | **19,6 MB** | **≈ 10 MB** | |

---

## 2. Quanti tocchi oggi, da app aperta a «sto pedalando»

App aperta su **Oggi**, profilo fatto, mondo già in cache. «Col rullo» = il rullo si collega **dentro** la corsa, ogni volta: icona in alto a destra → «Cerca il rullo» → scelta nel selettore del browser → «Chiudi» = **+4** (`Ride.tsx:1139-1148`, `1905-1978`).

| caso | percorso dei tocchi | simulatore | col rullo |
|---|---|---|---|
| Giro libero | «Giro libero» nella carta del mondo → Mondo, scheda Libero → un paese | **2** | **6** |
| Percorso del mondo | Carta del mondo → (scorri) percorso nella lista → (scorri) «Pedala Il giro della Ganda» | **3** + 2 scorrimenti | **7** |
| Salita | «Selvino» nella griglia di Oggi → «Pedala» | **2** | **6** |
| Allenamento su un anello | (scorri) «Allenamenti» → chip del posto → «Anello» → «Parti da» → paese → «Fatto» → «Inizia» | **7** (5 se il paese va bene) | **11** |
| Allenamento sul posto di default (Selvino) | «Allenamenti» → «Inizia» | 2 | 6 |
| Fantasma di un giro salvato | Tu → «Rifai un giro» → giro → «Fantasma» → «Pedala» | **5** | **9** |
| Fantasma del record su una salita | «Selvino» → «Contro il fantasma» (solo se c'è un record) | 2 | 6 |

Sui percorsi del mondo il fantasma del record parte da solo (`src/game/ghosts.ts`), senza scelta.

---

## 3. Inventario: ogni schermata, ogni opzione

### Fuori dalla corsa

| rotta | schermata | opzioni e comandi | nota |
|---|---|---|---|
| `/start` | Primo avvio | 2 carte mondo · 3 righe «cosa c'è» · Nome · Peso · FTP · FC max · «Entra» | `F/01-onboarding.png` |
| `/` | Oggi | Oro (→ Garage) · Livello (→ Tu) · Programma di oggi · Sessione (Entra / Tutte) · Missioni · Carta del mondo (→) · Giro libero · Anello · A → B · Ripeti l'ultimo giro · 4 salite · «Tutte le salite» · Rifai un giro · Allenamenti guidati · Km/TSS/Forma 7 gg · Ultimi giri · «Vedi tutti» · Installa | 18 bersagli prima dei giri; `F/02-oggi.png`, `F2/p1-oggi-ripeti.png` |
| `/mondo` | Mondo | 2 righe mondo · Senza rete (Scarica/Ferma/Togli) · 5 schede (Percorsi, Libero, Anello, A → B, Classifica) · carta ± · 14 percorsi | `F/03-mondo-tutta.png` |
| `/mondo` › percorso | Scheda percorso | Chiudi · verso · «Pedala …» · salita · 8 luoghi · tratti · Classifica Rullo/Simulatore · Fonti | `F/04-percorso-tutta.png` (8 000 px) |
| `/mondo?tab=libero` | Libero | carta (tocca → «Parti da …») · 6 paesi | |
| `/mondo?tab=anello` | Anello | Partenza · Lunghezza 10–120 km · Strade (Pianeggiante/Misto/In salita) · «Suggeriscimi un anello» · 3 proposte · «Pedala questo anello» | 2 tasti pieni in sequenza |
| `/mondo?tab=ab` | A → B | Da · A · ritorno · «Pedala» | |
| `/mondo?tab=classifiche` | Classifica | doppione di `/classifiche` | |
| `/salite` | Salite | 4 salite verificate · Catalogo (≈ 30 righe, quasi tutte «Traccia da acquisire») | |
| `/salite/:id` | Salita | 6 numeri · carta · «Pedala» · altimetria · In ERG (select + Parti) · 2 classifiche Rullo/Simulatore · km per km · Fonti | `U/p-05-salita-selvino-tutta.png` |
| `/sessioni` | Sessioni | 8 sessioni · Entra · ultima sessione con classifica Rullo/Simulatore · 4 righe che spiegano i tipi | `U/p-06-sessioni-tutta.png` |
| `/garage` | Garage | negozio maglie/bici/caschi · qualità del 3D | voce di navigazione |
| `/tu` | Tu | livello · 4 riquadri · 8 voci: Traguardi, Classifiche, Garage, Diario, Allenamenti, Rifai un giro, Carico, Profilo | `U/p-08-tu-tutta.png` |
| `/traguardi` | Traguardi | filtri · Quasi tuoi · 50 voci | |
| `/classifiche` | Classifiche | Salite/Percorsi/Tratti/Punti · Settimana/Sempre · Rullo/Simulatore | |
| `/workouts` | Allenamenti | Nuovo · Programmi a settimane · chip posto · Durata · 8 tipi · 33 carte × (Inizia, Duplica, Esporta .zwo) · I tuoi · Importa .zwo · foglio «Dove e quanto» (Salita/Percorso/Libero/Anello + select + Durata) | `F2/p1-allenamenti-foglio.png` |
| `/workouts/edit/:id` | Editor | nome · blocchi · % o W · rampa · Salva · Elimina | |
| `/programmi` | Programmi | settimane · Fatto/Oggi/Saltato/Riposo | |
| `/history` | Diario | Importa · Carico · filtro mondo · giri | |
| `/history/:id` | Giro | numeri · zone · 4 grafici · FIT/TCX/GPX · Elimina | |
| `/giri` | Rifai un giro | **gli stessi giri del Diario** · Importa | doppione |
| `/giri/:id` | Rifai | Tutto/Tempo/Km/Giri · I watt di allora / La pendenza di allora / Fantasma · «Pedala» | |
| `/load` | Carico | CTL/ATL/TSB · Importa | |
| `/import` | Importa | file · esempi · Intervals.icu | |
| `/profile` | Profilo | tema · qualità · nome, peso, FTP, FC max, FC riposo, soglia · fisica · cancella | |

### In corsa (`/ride`)

| elemento | comandi | nota |
|---|---|---|
| Testata | ‹ (pausa) · titolo · Pedala insieme (solo salite) · **icona del rullo** (bici = simulatore) | `U/c-22-corsa-10x.png` |
| Foglio sensori | Cerca il rullo · Cerca tutti i dispositivi · **Usa il simulatore** · 4 gettoni servizi · 3 righe di prosa | `Ride.tsx:1905-1978`, `i18n/it.ts:125-129` |
| Basso | Pausa · Termina (tieni) · col simulatore: Sforzo 0–160 % · 1× 4× 10× | `Ride.tsx:1347-1393` |
| ERG | solo con `?workout=` o «I watt di allora» | `engine.ts:138-146` |
| Pausa | Riprendi · Termina e salva · Impostazioni (mostrami, qualità, meteo, luce) | `U/c-24-pausa.png` |
| Carta, Anello al volo, Pedala insieme | 3 fogli | |

---

## 4. I difetti, in ordine di costo per chi pedala

**U1. Il simulatore parte da solo.** `BluetoothTrainer.mode = 'simulator'` (`src/bluetooth/trainer.ts:37`); ogni corsa nasce col simulatore che pedala al 62 % dell'FTP (`engine.ts:78`). · `U/c-21-corsa-pronta.png` (8 W, «Recupero attivo», nessun rullo) · Chi ha il rullo vede il ciclista partire senza pedalare; i giri finti finiscono nel Diario, nelle missioni e nell'oro. · Il simulatore diventa **Modalità prova**, spenta di serie, accesa solo in Impostazioni. · Senza rullo e senza Prova nessuna corsa parte: `/ride?…` torna a Pedala con «Collega il rullo».

**U2. Il rullo si collega dentro la corsa, e si perde alla corsa dopo.** Un `new BluetoothTrainer()` per ogni `RideSession` (`Ride.tsx:408`). · `Ride.tsx:1139-1148` · +4 tocchi a ogni giro, e si scopre che il rullo non risponde dopo aver caricato 10 s di mondo. · Un rullo solo per l'app (`trainerStore`), collegato da Pedala prima di scegliere; resta fra una corsa e l'altra; dopo un riavvio «Ricollega KICKR» in un tocco. · Due corse di fila: zero tocchi di collegamento alla seconda.

**U3. Le opzioni ci sono anche senza rullo.** Allenamenti in ERG, «In ERG» sulla salita, «I watt di allora»: tutto si avvia col simulatore. · `ClimbDetail.tsx:124-137`, `Workouts.tsx:263` · Si sceglie un allenamento ERG che nessun rullo terrà. · Senza rullo Pedala ha un tasto solo. Con un misuratore di potenza (senza controllo) «Potenza fissa» sparisce e l'allenamento diventa a bersaglio. · Prove sul calcolo `tipiAmmessi()` per i 5 stati.

**U4. Il tipo di attività non si sceglie.** Libera è implicita, l'ERG arriva solo con un allenamento, la potenza fissa non esiste, i watt di allora stanno in un'altra pagina. · `engine.ts:74,138`, `ReplaySetup.tsx:150-155` · Michele: «select type of activity (power defined or free…)». · Un selettore «Come» con **Libera · Potenza fissa · Allenamento** (e «Watt di allora» al posto di Allenamento su un giro rifatto).

**U5. Sei voci di navigazione, e il Diario non c'è.** Oggi, Mondo, Salite, Sessioni, Garage, Tu (`Nav.tsx:6-13`); Diario, Allenamenti, Classifiche, Traguardi, Giri solo sul computer (`Nav.tsx:16-22`) o dentro Tu. · `F/02-oggi.png` · Il negozio ha una voce, lo storico dei giri no; voci da 65 px di larghezza. · **Pedala · Diario · Tu**. · `bottom-nav li` = 3.

**U6. Quattro porte per cominciare, nessuna completa.** Oggi (carta del mondo + 3 scorciatoie + 4 salite + 2 carte), Mondo (5 schede), Salite, Allenamenti (foglio «Dove e quanto»). · `F/02-oggi.png`, `F2/p1-allenamenti-foglio.png` · Il «dove» si sceglie in 4 modi diversi e il «come» in 2 pagine; 2–7 tocchi + 4 per il rullo. · Una schermata, **Dove → Come → Via**. · Tabella del § 2 rifatta dallo script.

**U7. Allenamento su un posto: niente giri.** L'anello si calcola a 27 km/h fissi (`Workouts.tsx:131`) e finisce dopo un giro; sul percorso si prosegue libero (`session.ts:434-440`); sulla salita il giro finisce in cima «anche se l'allenamento no» (`Workouts.tsx:73`). · `F2/p1-allenamenti-foglio.png` · Uno sweet spot da 54' su un anello da 25' finisce fuori strada o in cima a metà. · Giri proposti con una stima fisica (watt medi dell'allenamento × profilo), giro in più se l'allenamento non è finito, va e torna sui percorsi aperti. · Prove su `stimaGiro` e `passaggi`.

**U8. Doppioni.**

| cosa | dove sta due volte (o più) | resta in |
|---|---|---|
| Classifiche | `/classifiche`, Mondo › Classifica, scheda percorso, salita ×2, Sessioni | Tu › Classifiche + scheda del percorso |
| Giri salvati | `/history`, `/giri` | Diario |
| Importa | Diario, Rifai un giro, Carico | Diario (+) |
| Garage | barra, Tu, chip dell'oro in Oggi | Tu |
| Livello e oro | Oggi, Tu, Mondo (prima del 04/11) | Tu |
| Anello | Mondo › Anello, Allenamenti › Anello | Dove › Crea un anello |
| Sessioni | voce di navigazione, carta in Oggi | riga in Pedala |
| Selvino | salita verificata `selvino-nembro` e percorso del mondo `selvino`, due classifiche | il percorso del mondo; la salita verificata resta per chi non ha il mondo |
| Fantasma | scheda salita, Rifai un giro, automatico nel mondo | interruttore in Pedala |

**U9. Rullo / Simulatore in ogni classifica.** 5 interruttori (`Board.tsx:26-32`, `World.tsx:363-369`). · `U/p-05-salita-selvino-tutta.png`, `U/p-06-sessioni-tutta.png` · Un comando che non serve a chi pedala sul rullo. · La Prova non va in classifica: l'interruttore sparisce. · `Simulatore` assente da tutte le pagine (`pagine-check`).

**U10. Senza rete: una frase, e il mondo che aspetta.** «Sei offline: salite, giri salvati e simulatore funzionano; le stanze «Pedala insieme» no.» (`Install.tsx:170`). Un mondo non scaricato non parte; uno scaricato a metà aspetta le mattonelle fino a 20 s («Parti lo stesso») o 60 s (`Ride.tsx:67`, `pronto.ts`). · `PM/f-06-corsa-offline-20s.png` · Senza rete si pedala solo dopo 20 MB scaricati prima. · Un gettone «Offline»; il **mondo leggero** (2,4 MB, scaricato da solo al primo avvio) basta per pedalare ogni percorso; «Intero» si scarica in Impostazioni. · Corsa offline col solo leggero: pronta in ≤ 8 s.

**U11. Oggi: il primo schermo non dice cosa fare.** Saluto da 90 px, sessione, missioni, carta del mondo con 4 uscite, salite. · `F/02-oggi.png` · Quattro carte in gara; «Via» non esiste. · Oggi diventa **Pedala**: Dove, Come, Via; sessione e missioni in una riga ciascuna. · Primo schermo a 390×844: un solo tasto pieno, «Via» sopra la barra.

**U12. Il collegamento parla troppo.** Il foglio sensori ha tre paragrafi («Il simulatore genera potenza…», nota sul peso) e tre tasti, uno è «Usa il simulatore». · `i18n/it.ts:125-129` · «Troppo sbobbo», e propone la scorciatoia che non deve esserci. · Stati con una parola e un tasto. · Zero frasi oltre i 6 gettoni di stato.

**U13. Salite: un catalogo di vicoli ciechi.** ≈ 30 righe «Traccia da acquisire» portano a `/giri` (`Climbs.tsx:28`). · `F2/report.txt` riga 85 · Si tocca il Gavia e si finisce nella lista dei propri giri. · Il catalogo esce; le 4 salite verificate entrano in Dove come «Grandi salite».

**U14. Primo avvio che promette il simulatore.** «Col rullo o senza · Rullo smart Bluetooth, o il simulatore» e tre righe di presentazione; FC max chiesta subito. · `Onboarding.tsx:78-81` · Prosa e una promessa che il nuovo flusso non mantiene. · Mondo, nome, peso, FTP, «Entra»; poi Pedala chiede il rullo.

**U15. Allenamenti: 99 tasti in una pagina.** · `U/p-11-allenamenti-tutta.png` · Per partire si scorre fra «Duplica» ed «Esporta .zwo». · La scelta dell'allenamento è un foglio con una riga per allenamento (tocco = scelto); Duplica, Esporta, Importa, Editor e Programmi stanno in Tu › Allenamenti.

**U16. Il mondo intero si scarica solo da Mondo.** La riga «Senza rete · Scarica · 20 MB» sta in testa a Mondo, sopra la carta. · `F/03-mondo.png`, `F/15-mondo-scarico.png` · Occupa il primo schermo di chi vuole scegliere un percorso. · Impostazioni › Mondi; in Dove solo il gettone «Intero» / «Leggero».

---

## 5. Cosa non cambia

- Le rotte vecchie: tutte con un redirect (`piano.md`, § Contratti).
- IndexedDB `allenando` (`src/db/db.ts:21`), giri, allenamenti, kv: i campi nuovi sono facoltativi.
- La corsa: velo, Pausa, «Termina» da tenere, giro salvato da solo, ripresa (A1–A4 del 04/11).
- Il link della corsa: i parametri vecchi (`workout`, `replay`, `mode`, `ghost`, `plan`, `route`) continuano a valere.
