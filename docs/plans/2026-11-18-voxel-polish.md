# Rifinitura della corsa isometrica

Richiesta: un ulteriore salto di qualità visiva, esteso al gioco già pubblicato.
Base: main 874dfd8, screenshot `anteprime/voxel/release-worlds` nel workspace.

## Composizione e decisione

Chi prepara o percorre una salita deve riconoscere subito il proprio ciclista,
leggere la strada davanti e mantenere l'orientamento. Il canvas resta il centro;
profilo, dati e pulsante di partenza mantengono la posizione già verificata.
Nessuna modifica strutturale: non serve un nuovo wireframe.

Nel Ganda a km 24 il ciclista occupa pochi pixel e le superfici in ombra sono molto
scure. Nei paesi la camera evita i tetti ma cambia vista bruscamente. Fuori paese
il terreno vicino alla carreggiata è piatto fino ai primi alberi.

Scelte: inquadratura circa 20% più vicina; ritorno alla diagonale con isteresi e
transizioni solo quando la visuale è libera; luce diffusa e riflessi sul kit;
piccoli ciuffi e sassi stagionali lungo la strada, con istanze limitate.

## File e responsabilità

- `src/open/buildingCamera.ts`, funzioni camera di `src/world/isometric.ts` e test:
  camera e sicurezza della visuale (agente camera).
- Nuovi `src/world/VergeDetail.tsx`, `vergePlacement.ts` e test: dettaglio del terreno
  con adapter dei due renderer (agente ambiente).
- `src/world/RiderLighting.tsx`, `src/world/Scene.tsx`, `src/open/WorldScene.tsx`:
  luce e integrazione condivisa (root).

## Accettazione e prove

- Tutti i 29 percorsi restano inquadrati in tre viewport nei test di geometria.
- Visuale libera, niente passaggi della camera dentro gli edifici durante il cambio.
- Dettagli deterministici, massimo 320 istanze e due draw call, senza nuovi asset
  remoti; niente dettagli su asfalto, acqua, edifici o superfici non adatte.
- Screenshot comparabili desktop e mobile di Ganda, Città Alta, Dolomiti e salite
  classiche. Giro manuale completo: avvio, pausa, salvataggio, diario.
- TypeScript, test pertinenti, build; revisione indipendente prima della PR.
- CI completa e GitHub Pages: hash asset pubblicato uguale al build verificato,
  risorse del registry HTTP 200 e prova della scena pubblica.

Non si deducono FPS hardware dal browser software di collaudo; trainer fisico fuori
dalla verifica disponibile. Non cambiano Street View, dati geografici o fisica.
