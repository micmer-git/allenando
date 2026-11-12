import type { WorldData } from './world';

const works = [
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
export function arteStrada(data:WorldData) {
  if(data.graph.id !== 'bergamo') return [];
  return works.flatMap(work=>{
    const p=data.proj.toLocal(work);
    const hit=data.graph.nearest(p.x,p.z,65);
    if(!hit) return [];
    const road=data.graph.pose(hit.edge,hit.s,1);
    return [{...work,...p,y:road.y}];
  });
}

