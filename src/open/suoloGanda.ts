import bounds from './suolo-ganda-bounds.json';

/** DBGT Gazzaniga + Aviatico. Classe dedicata alle superfici edificate o carrabili, dove gli alberi
 * procedurali sono esclusi. Il suolo visibile sotto queste superfici conserva la classe del DEM. */
export const BUILT_SURFACE = 250;
const STEP = 5;

export function intersectsGanda(x: number, z: number, size: number): boolean {
  return x < bounds[2] && z < bounds[3] && x+size > bounds[0] && z+size > bounds[1];
}

/** Una riga contiene solo gli intervalli rilevati. La ricerca legge direttamente i byte scaricati. */
export class LandSurvey {
  private constructor(private data: DataView, private x0: number, private z0: number,
    private width: number, private height: number, private runs: number) {}

  static decode(bytes: ArrayBuffer): LandSurvey | null {
    const data = new DataView(bytes);
    if (data.byteLength < 20 || data.getUint32(0) !== 0x47435631) return null;
    const width = data.getUint16(12,true), height = data.getUint16(14,true);
    const runs = 16 + (height+1)*4;
    if (!width || !height || runs > data.byteLength || data.getUint32(16,true) !== 0) return null;
    const count = data.getUint32(16+height*4,true);
    if (runs+count*5 !== data.byteLength) return null;
    let previous = 0;
    for (let j=1; j<=height; j++) {
      const end = data.getUint32(16+j*4,true);
      if (end<previous || end>count) return null;
      previous = end;
    }
    return new LandSurvey(data,data.getInt32(4,true),data.getInt32(8,true),width,height,runs);
  }

  at(x: number, z: number): number {
    const i = Math.floor((x-this.x0)/STEP), j = Math.floor((z-this.z0)/STEP);
    if (i < 0 || i >= this.width || j < 0 || j >= this.height) return 0;
    let lo = this.data.getUint32(16+j*4,true);
    let hi = this.data.getUint32(20+j*4,true);
    while (lo<hi) {
      const mid = Math.floor((lo+hi)/2);
      const p = this.runs+mid*5;
      if (i < this.data.getUint16(p,true)) hi = mid;
      else if (i >= this.data.getUint16(p+2,true)) lo = mid+1;
      else return this.data.getUint8(p+4);
    }
    return 0;
  }
}
