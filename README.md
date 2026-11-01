# Camilla Ride

Ciclismo indoor in un mondo 3D, nel browser. Pensata per il rullo: potenza, zone, allenamenti in ERG, diario e, se ti va, Camilla nel carrellino.

Tutto resta sul dispositivo. Non c’è account e non partono dati verso un server.

Sito: [https://micmer-git.github.io/camilla-ride/](https://micmer-git.github.io/camilla-ride/)

## Cosa fa

- Anello 3D generato in modo procedurale, con salite, alberi e un lago. La velocità arriva dalla potenza, con un modello fisico (massa, CdA, Crr, pendenza, inerzia). Niente scia.
- Sensori Bluetooth: rulli FTMS (dati indoor bike, potenza obiettivo per l’ERG, simulazione di pendenza in pedalata libera), misuratori di potenza, fascia cardio, sensore di cadenza.
- Simulatore integrato, così l’app si usa anche senza rullo.
- Profilo con FTP, peso e FC. Zone di potenza di Coggan (7) e zone di frequenza di Friel sulla soglia cardiaca.
- Libreria: fondo, sweet spot, VO2max 5×4′, soglia 2×20′, test a rampa (FTP ≈ 75% del miglior minuto) e un risveglio corto per provare l’ERG. Si possono creare schemi propri.
- Diario locale (IndexedDB) con media, NP, IF, TSS e tempo nelle zone. Esportazione FIT e TCX.
- Importazione di FIT, TCX, GPX e di uno ZIP di Garmin Connect. Il carico (CTL 42 giorni, ATL 7, TSB) mette insieme giri indoor e attività importate.
- PWA: dopo la prima apertura funziona senza rete.
- Tema Camilla, spegnibile: carrellino nel mondo 3D, chilometri fatti insieme, traguardi, e il diario del sonno.

L’interfaccia è in italiano. Le stringhe stanno in `src/i18n/it.ts`: per aggiungere una lingua si esporta un oggetto con la stessa forma e lo si registra in `src/i18n/index.ts`.

## Avvio

```bash
npm install
npm test
npm run dev
```

In sviluppo l’app è su `http://localhost:5173/camilla-ride/`.

```bash
npm run build
npm run preview
```

I file di esempio in `public/samples/` si rigenerano con `npm run samples`.

## Uso

1. Al primo avvio inserisci nome, peso, FTP e FC massima. Se non conosci la FTP, lascia 220 W e fai il test a rampa.
2. **Pedala libero** apre il mondo. Lo sforzo del simulatore è il cursore in basso. Con un rullo vero, apri **Sensori**.
3. **Allenamenti** avvia l’ERG: il bersaglio di watt cambia a ogni intervallo. Sul simulatore la potenza lo insegue con un po’ di inerzia. Su un rullo FTMS l’app chiede il controllo e invia la potenza obiettivo.
4. **Termina** mostra NP, IF e TSS. Puoi salvare il giro ed esportarlo in FIT o TCX dal diario.
5. **Importa** accetta più file insieme, o lo ZIP che scarichi da Garmin Connect (Attività → Esporta).
6. **Sonno di Camilla** ha un timer e l’inserimento a mano. Il totale del giorno divide le sessioni a cavallo della mezzanotte.

In pedalata libera, se il rullo supporta la simulazione FTMS, la pendenza del mondo viene inviata al rullo (grado, Crr, coefficiente aerodinamico). Il peso usato dal rullo per la resistenza è quello salvato nella sua app: allinealo al tuo.

La grafica ha tre livelli. Su un telefono modesto usa **Bassa**.

## Rulli e sensori

Serve un browser con Web Bluetooth, in un contesto sicuro (HTTPS o localhost): Chrome o Edge su Android, Mac, Windows e Linux, oppure Bluefy su iPhone e iPad.

Funzionano i rulli che espongono il profilo Bluetooth **FTMS** (Fitness Machine Service), tra cui molti modelli recenti di Wahoo KICKR, Garmin Tacx, Elite, Saris, JetBlack e altri, quando il FTMS è attivo. In più:

- Cycling Power Service, per la potenza (e la cadenza, se il misuratore la manda)
- Heart Rate Service
- Cycling Speed and Cadence, per la cadenza

L’ERG richiede il Fitness Machine Control Point con “target power”. La pendenza in libertà richiede “indoor bike simulation parameters”. Se il rullo manda solo la potenza, il mondo si muove lo stesso, ma la resistenza non cambia da sola: l’app lo dice.

Comandi usati:

- `0x00` richiesta di controllo
- `0x05` potenza obiettivo, in watt
- `0x11` simulazione: vento in millesimi di m/s, pendenza in centesimi di percento, Crr in decimillesimi, Cw in centesimi di kg/m

## iPhone e iPad

Safari non implementa il Web Bluetooth. L’app come pagina (o aggiunta alla schermata Home) funziona per simulatore, diario, import e sonno. Per parlare con il rullo apri il sito in **Bluefy – Web BLE Browser**.

Su Android e desktop, Chrome propone l’installazione della PWA.

## Modello fisico

La potenza del ciclista e la velocità di regime sono legate da

```
P · η = (Crr · m · g · cosθ + ½ · CdA · ρ · v² + m · g · sinθ) · v
```

con θ = arctan(pendenza), η = 0,975, ρ = 1,225 kg/m³. L’integrazione tiene conto dell’inerzia, con un fattore di massa rotante 1,03, e limita la forza a bassa velocità. I valori di partenza sono CdA 0,32 e Crr 0,004: si cambiano nel profilo.

Il TSS con la potenza è quello di Coggan: `(durata · NP · IF) / (FTP · 3600) · 100`. Senza potenza si usa una stima dalla FC media e dalla soglia (`hrTSS`), ed è segnata come stima. La soglia cardiaca, se non la inserisci, è l’89% della FC massima.

Il TSS delle attività importate che hanno una traccia di potenza variabile è ricalcolato sulla tua FTP.

## Dove stanno i dati

IndexedDB, in questo browser. Cancellarli dal profilo li toglie solo da qui. L’esportazione FIT usa il produttore `development`, accettato da Garmin Connect e Strava.

Un futuro collegamento a un’API (per esempio Garmin Connect) può implementare `ActivitySource` in `src/io/sources.ts` e restituire gli stessi oggetti `Ride`. Oggi l’unica sorgente è il file.

## Sviluppo

```bash
npm test
npm run build
```

I test coprono fisica, zone, NP/TSS, CTL/ATL/TSB, parsing FTMS e dei sensori BLE, FIT (andata e ritorno), TCX, GPX e ZIP.

Il deploy su GitHub Pages parte da `.github/workflows/pages.yml` a ogni push su `main`. La base dell’app è `/camilla-ride/`.
