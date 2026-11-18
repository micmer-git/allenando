# Dettaglio voxel per tutto Orobia

Richiesta: migliorare profondità e dettagli del 3D, applicare lo stile a tutti i percorsi e pubblicare il gioco. Deploy autorizzato in chat il 18 novembre 2026.

## Scena e lettura

La struttura delle schermate resta quella verificata nell'anteprima isometrica: scena e ciclista, poi percorso e comando di partenza. Il lavoro riguarda i volumi e la luce. La sagoma del ciclista deve restare leggibile su desktop e telefono; ombre locali, chiome articolate e materiali fini devono dare profondità senza aumentare il numero di oggetti disegnati per ogni albero.

## Copertura e file

I due renderer condivisi coprono 29 percorsi predefiniti: 16 a Bergamo, 9 nel Sellaronda e 4 salite singole. Il mondo libero, i tragitti A→B e gli anelli usano WorldScene; salite, replay GPS e strada neutra usano RideScene. Gli allenamenti ereditano il renderer della strada scelta. Street View mantiene le fotografie.

- `world/isometric.ts`: vegetazione voxel a livelli, rami, radici e rocce stratificate, colori per faccia, geometrie condivise.
- `open/WorldScene.tsx`, `world/Scene.tsx`: ombre locali più precise, superfici che ricevono ombre, asfalto con riflesso tenue e materiali delle chiome.
- `world/builders.ts`, `open/textures.ts`, `open/paesaggio.ts`: graniglia, coppi/ardesia, grana del suolo e tessere geografiche più fini; neve, roccia e stagioni conservate.
- `components/RiderPreview.tsx`: il Garage mostra lo stesso modello voxel usato in corsa.
- `open/buildingCamera.ts`: nei vicoli la camera cerca una linea di vista libera dagli edifici; rispetta l'orientamento manuale e le gallerie. Regressione individuata nel sopralluogo di Via Pignolo a 1,5 km.
- `world/propWindow.ts`: sulle salite si disegnano gli oggetti entro 110 m, massimo 800 istanze compresi i tronchi; la selezione cambia ogni cella di 16 m. Nel mondo aperto la vista isometrica usa celle da 200 m.
- `tests/isometric-routes.test.ts`, `tests/voxel-nature.test.ts`: dati reali e inquadrature di tutti i percorsi; limiti e integrità della vegetazione.

## Verifica e rilascio

Build, test di regressione, controlli visuali su Bergamo e Dolomiti e avvio di una salita singola; flusso mobile con pausa, ripresa e Diario. Controllo Garage e console WebGL. Poi PR, merge, GitHub Pages, controllo del commit pubblicato, asset aggiornati e URL del registry. Nessuna modifica al Worker o alla fisica del rullo.

La revisione ha identificato e corretto due problemi: le ombre devono aggiornarsi quando termina l'entrata degli oggetti, e le salite singole non devono disegnare la vegetazione dell'intero percorso. Misura in processo alla partenza, qualità media: vegetazione Stelvio da Prato da 1.057.488 a 11.016 triangoli, Selvino da 546.024 a 6.792. Questi numeri riguardano la vegetazione, non il totale del fotogramma né gli FPS.

Suite generale prima dell'ultima correzione della camera: 57 file, 758 test passati. La regressione della camera aggiunge tre test su vicolo, cortile e orientamento manuale. Le catture locali sono in `anteprime/voxel`, fuori dal repository.
