# Rilievo di Ganda

L'asset `public/world/bergamo/rilievo-ganda-v1.json` contiene una selezione del Database Geo-Topografico della Regione Lombardia, elaborata per il mondo 3D di Orobia. Rilievi comunali di Gazzaniga (2007) e Aviatico (2011), distribuiti da Regione Lombardia con licenza [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). [Metadati del DBGT](https://geodati.gov.it/geoportale/visualizzazione-metadati/scheda-metadati?metadataid=r_lombar%3A0092b7ba-c697-433b-b5f2-9f9d9b8694e3) · [specifiche regionali](https://www.geoportale.regione.lombardia.it/specifiche-tecniche).

I record con identificatore `w<id>` sono geometrie ritagliate di © OpenStreetMap contributors, licenza [ODbL](https://www.openstreetmap.org/copyright). La data dello snapshot è in `dateOSM`. Gli identificatori comunali conservano la classe e l'OBJECTID della geometria originale. Il sottoinsieme elaborato è distribuito insieme all'app.

Il corridoio segue il giro da Gazzaniga al Passo di Ganda e ad Aviatico, con una diramazione nel borgo di Ganda. Comprende le geometrie entro 55 metri dal tracciato, i volumi entro 110 metri e un intorno del borgo. Le parti sopra l'asfalto attuale sono escluse. Nei due metri adiacenti a un confine OSM si dà precedenza a OSM. I punti albero del DBGT entrano nell'indice comune dopo aver tolto i doppioni OSM entro quattro metri. Altezza, specie e aspetto delle chiome sono illustrativi.

Le cancellate e le recinzioni provengono dalla classe EL_DIV. I muri di sostegno provengono dalle impronte MU_SOS con tipo 04. Per ciascun muro del DBGT si usa il poligono di sedime, mentre altezza, materiale e colore sono stimati. Le altezze degli edifici provengono da UN_VOL_AV per i volumi appoggiati al suolo. Per associarle al mondo servono almeno l'85% di sovrapposizione su entrambe le impronte e centroidi entro quattro metri. Più volumi di uno stesso edificio richiedono altezze simili. Restano escluse le impronte ambigue, le categorie speciali e gli edifici con altezza o numero di piani espliciti in OSM. Per conservare le modifiche successive dei dati stradali, le correzioni si applicano solo a una corrispondenza esatta con la riga d'origine del mondo. I tetti restano modellati.

Per rigenerare il ritaglio dalla radice del repository, preparare l'estratto OSM del mondo con la pipeline esistente e usare Python con numpy, rasterio, shapely 2 e requests.

```sh
python scripts/world/ganda-rilievo.py --fetch --osm-buildings scripts/world/cache/osm/buildings.json
```

I due GeoPackage e la risposta di Overpass restano nella cache di lavoro. Per aggiornare il rilievo si possono rigenerare separatamente. L'output conserva coordinate locali in decimetri e identificatori sorgente per consentire il controllo di ogni tratto.
