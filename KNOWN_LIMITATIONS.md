# Limiti noti e verifica manuale — Camilla Ride V1

Questa release passa i test unitari e la build di produzione, ma **non e' certificata su un rullo fisico**.

- **FTMS / BLE**: le routine e i pacchetti sono coperti da test automatici; le connessioni, il controllo ERG, la simulazione di pendenza e le disconnessioni devono essere provati con un rullo reale e Chrome/Edge su HTTPS. Alcuni modelli espongono solo un sottoinsieme dei comandi FTMS.
- **iPhone/iPad**: Safari non offre Web Bluetooth. Il simulatore, il diario e il sonno funzionano senza rullo; per Bluetooth serve un browser compatibile, per esempio Bluefy.
- **Garmin**: non e' presente un sync API; per ora si importano manualmente FIT, TCX, GPX e ZIP esportati da Garmin Connect. Il comportamento va provato con almeno un file reale e uno contenente dati mancanti.
- **Dati**: profilo e attivita' sono locali al browser (IndexedDB); cancellare dati del sito o usare un altro dispositivo non preserva automaticamente lo storico. Esportare i file prima di cancellare i dati.
- **Prestazioni**: il bundler segnala chunk JavaScript superiori a 500 kB; il mondo 3D potrebbe risultare pesante su cellulari meno potenti. Usare la qualita' grafica bassa se necessario.
- **PWA offline**: il service worker viene generato in produzione; verificare manualmente l'accesso offline *dopo* la prima visita online su dispositivo mobile.

## Collaudo su hardware (da fare)
1. Aprire https://micmer-git.github.io/camilla-ride/ da Chrome/Edge su HTTPS e verificare il profilo e l'avvio del simulatore.
2. Collegare un rullo FTMS e una fascia cardio; controllare potenza, frequenza, cadenza e disconnessione/riconnessione.
3. Avviare un allenamento ERG e verificare la risposta della resistenza e gli intervalli; ripetere in pedalata libera con cambio di pendenza.
4. Salvare la sessione, esportare FIT/TCX, reimportare un file ed esaminare diario e statistiche.
5. Verificare la navigazione su schermo 360 px e la PWA offline al secondo avvio.

La build di CI non sostituisce questi test fisici.
