# Orobia isometrica

Il sopralluogo e la corsa mostrano il ciclista dall’alto, con una camera ortografica orientata lungo la strada, ciclista e vegetazione voxel sul terreno reale. Il percorso reale, la posizione e la prossima azione devono essere riconoscibili sul telefono.

## Composizione

Il sopralluogo apre sulla scena e sul ciclista. Il selettore Isometrica/Strada e la pianta orientano, mentre distanza, quota, pendenza e profilo accompagnano lo spostamento lungo il percorso. L’azione principale prepara il giro dal punto scelto. Fonti e foto rimangono raggiungibili sotto gli strumenti.

In corsa il movimento mantiene il ciclista al centro della lettura. Watt, tempo e chilometri occupano il pannello inferiore. Pausa e fine giro mantengono il flusso di salvataggio.

## Scelte visive

Ardesia scura, oro Orobia e verde menta, pannelli compatti e bordi netti. Ciclista e bici usano volumi a blocchi con scheletro animato e kit personalizzabili. Alberi e rocce sono geometrie condivise. Texture a pixel per strada, tetti e paesaggio.

## Verifica

Build TypeScript/Vite e suite esistente. Confronto visuale della Ganda a 1200×760 e 390×844, controllo a 320 px, selettori Isometrica/Strada, spostamento ±100 m, salto a un luogo, ingresso nella corsa, pausa, ripresa e salvataggio. Le immagini di verifica sono nella cartella di lavoro anteprime/voxel.

Esito: build finale riuscita; suite di 54 file / 721 test passata prima della correzione dei cordoli. Dopo la correzione, 29 test di rifiniture e ciclista passati, inclusi due nuovi casi per cordoli e normali. Conservato il contorno originale degli incroci per non invadere gli edifici.

Browser: 1200, 390 e 320 px senza overflow orizzontale o errori applicativi rilevati. Flusso mobile con watt manuali verificato in sette passaggi, dalla scelta della camera al giro salvato nel Diario dopo una ricarica. Anteprima locale sulla porta 4173. Rullo fisico e multiplayer non collaudati in questo intervento; nessun deploy pubblico.
