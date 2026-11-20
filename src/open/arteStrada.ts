import { projector } from '@/domain/geo';
import type { WorldGraph } from './graph';
import { ringsIn } from './rings';
import type { WorldData } from './world';

export const GIMONDI = {id:'valico-felice-gimondi', name:'Valico Felice Gimondi', place:'Passo di Ganda',
  lat:45.793294, lon:9.793659, node:0,
  note:'Sotto le due insegne in legno, Gimondi pedala con la maglia Bianchi iridata. L’effige è stata inaugurata nel luglio 2026.',
  source:'https://comune.aviatico.bg.it/notizie/3611296/inaugurazione-effige-dedicato-grande-corridore'};
export const OBELISCO = {id:'obelisco-marmo-nero', name:'Obelisco al marmo nero', place:'Rotatoria di via Marconi',
  lat:45.7966506, lon:9.8379038, node:0,
  note:'L’obelisco sulla rotatoria ricorda il marmo nero estratto e lavorato a Gazzaniga.',
  source:'https://www.comune.gazzaniga.bg.it/vivere-il-comune/luoghi/monumento-o-complesso-monumentale/il-marmo-nero-di-gazzaniga'};

const works = [GIMONDI, OBELISCO,
  {id:'palazzo-roncalli',name:'Gli affreschi di Palazzo Roncalli',place:'Piazza Mascheroni',lat:45.7051685,lon:9.6597170,
    note:'Le figure attribuite a Giovanni Busi, detto il Cariani, ornano la facciata cinquecentesca su piazza Mascheroni.',
    source:'https://lombardiarchivi.servizirl.it/fonds/102306/units/1193129',node:0},
  {id:'selvino-benvenuto', name:'Murale di benvenuto a Selvino', place:'Ingresso di Selvino', lat:45.7772030, lon:9.7430825,
    note:'Wiz Art ha dipinto il muro vicino al cartello di Selvino per il passaggio del Giro 2017. Il punto indica l’ingresso del paese.',
    source:'https://cosedibergamo.com/2019/08/06/nembro-selvino-la-salita-dei-campioni-bergamaschi/', node:6414785939},
  {id:'lonno-murales', name:'I murales di Lonno', place:'Bivio per Lonno', lat:45.7573288, lon:9.7551877,
    note:'Al bivio per Lonno, sedici soggetti dipinti da Wiz Art raccontano la frazione di Nembro. Il punto indica l’imbocco di via Moroni.',
    source:'https://www.comune.nembro.bg.it/.galleries/documenti/notiziari/2020-10_NI.pdf', node:387416730},
];
export function marconiIsland(graph: WorldGraph) {
  if (graph.id !== 'bergamo') return undefined;
  const p = projector(graph.origin).toLocal(OBELISCO);
  return ringsIn(graph,p.x-20,p.z-20,p.x+20,p.z+20).find(r => Math.hypot(r.cx-p.x,r.cz-p.z) < r.meanR);
}

export function arteStrada(data:WorldData) {
  if(data.graph.id !== 'bergamo') return [];
  return works.flatMap(work=>{
    const island = work === OBELISCO ? marconiIsland(data.graph) : undefined;
    const p = island ? {x:island.cx,z:island.cz} : data.proj.toLocal(work);
    const hit=data.graph.nearest(p.x,p.z,65);
    if(!hit) return [];
    const road=data.graph.pose(hit.edge,hit.s,1);
    return [{...work,...p,y:road.y}];
  });
}

