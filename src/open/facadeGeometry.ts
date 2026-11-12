import type { Architecture } from './architettura';
import type { Rgb, Tris, V } from './buildings';
import { FACADE_COLUMNS, finishUV, PLASTER_UV, type WallFinish } from './facadeLayout';

type Bounds = [number, number, number, number];
const blank: Bounds = [PLASTER_UV, PLASTER_UV, PLASTER_UV, PLASTER_UV];
const timber: Rgb = { r: 0.24, g: 0.15, b: 0.085 };
const limestone: Rgb = { r: 0.44, g: 0.42, b: 0.37 };

function patch(finish: WallFinish): Bounds {
  const [u0, v0] = finishUV(finish, 0, 0);
  const [u1, v1] = finishUV(finish, 1, 1);
  return [u0, v0, u1, v1];
}

interface Side {
  ax: number; az: number; bx: number; bz: number; out: [number, number, number];
  foot: number; face: number; bottom: number; top: number;
  wall: Rgb; base: Rgb; stone: Rgb; blind: boolean; ribbon?: Rgb;
  alpine: boolean; family: number; shift: number; edge: number; architecture?: Architecture;
  groundAt?: (x: number, z: number) => number;
}

export function facadeSide(walls: Tris, s: Side): void {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const len = Math.hypot(dx,dz);
  const nx = s.out[0]/len, nz = s.out[2]/len;
  const kind = s.architecture?.kind;
  const shed = kind === 'garage' || kind === 'rimessa' || kind === 'fienile';
  const bays = Math.max(1, Math.round(len / (kind === 'baita' ? 4.8 : 3.2)));
  const quad = (a: number, b: number, y: number, h: number, uv: Bounds, col: Rgb, depth = 0) => {
    if (b-a < .0001 || h-y < .005) return;
    const point = (t: number, elev: number, u: number, v: number): V => ({
      x:s.ax+dx*t+nx*depth, y:elev, z:s.az+dz*t+nz*depth, u,v,
    });
    const p = point(a,y,uv[0],uv[1]), q = point(b,y,uv[2],uv[1]);
    const r = point(b,h,uv[2],uv[3]), t = point(a,h,uv[0],uv[3]);
    walls.facing(p,q,t,s.out,col); walls.facing(q,r,t,s.out,col);
  };
  // Sotto le case sul pendio affiora la pietra del basamento. I giunti hanno una scala in metri.
  const finishStrip = (y: number, top: number, finish: WallFinish, color: Rgb) => {
    const count = Math.min(16,Math.max(1,Math.round(len / 5)));
    const uv = patch(finish);
    for (let k=0;k<count;k++) quad(k/count,(k+1)/count,y,top,uv,color);
  };
  if (s.face > s.foot + .01) finishStrip(s.foot,s.face,'pietra',s.stone);
  let start = s.face;
  if (s.face < s.bottom - .05) {
    finishStrip(s.face,s.bottom,'pietra',s.stone);
    start = s.bottom;
  }
  const doors = (s.architecture?.entrances ?? []).filter(([edge]) => edge === s.edge)
    .map(([,position,garage]) => {
      const t = position / 1000;
      const half = Math.min((garage ? 1.22 : .48)/len,t-.01,1-t-.01);
      // La soglia segue il lato su cui si entra, anche se la strada passa a valle del piano terra.
      const y = Math.max(s.foot, s.groundAt?.(s.ax+dx*t,s.az+dz*t) ?? s.bottom);
      return {a:t-half, b:t+half, y, top:Math.min(y+(garage ? 2.24 : 2.12),s.top-.12), garage};
    }).filter(d => d.b-d.a > .3/len && d.top-d.y > 1.5).sort((a,b) => a.a-b.a);
  if (shed) {
    if (kind === 'fienile' || kind === 'rimessa') {
      const sill = Math.min(s.top,start + .68);
      finishStrip(start,sill,'pietra',limestone);
      finishStrip(sill,s.top,'assi',timber);
    } else quad(0,1,start,s.top,blank,s.wall);
  } else if (s.blind) {
    const baseTop = Math.min(s.top,start+3);
    quad(0,1,start,baseTop,blank,s.base);
    const glass = !!s.ribbon && len>=6 && s.top-baseTop>2.2;
    quad(0,1,baseTop,glass ? s.top-1.9 : s.top,blank,s.wall);
    if (glass) {
      quad(0,1,s.top-1.9,s.top-.7,blank,s.ribbon!);
      quad(0,1,s.top-.7,s.top,blank,s.base);
    }
  } else {
    let row = 0;
    const height = s.top-start;
    // Ripartire l'altezza fra piani interi evita mezze finestre alla gronda.
    const floors = Math.max(1,Math.round(height/3));
    for (;row<floors;row++) {
      const y = start+height*row/floors, h=start+height*(row+1)/floors;
      const family = s.alpine && s.family===2 && row===0 ? 1 : s.family;
      const v0 = (3-family+.02)/4, v1 = (4-family-.02)/4;
      const col = row===0 ? s.base : s.wall;
      const windowStrip = (a: number,b: number) => quad(a,b,y,h,[(a*bays+s.shift)/FACADE_COLUMNS,v0,(b*bays+s.shift)/FACADE_COLUMNS,v1],col);
      // Un ingresso occupa la sua campata; le altre conservano il ritmo delle finestre.
      let at = 0;
      for (const d of doors) {
        if (d.top < y+.3 || d.y > h-.3) continue;
        const a = Math.max(at,Math.floor(d.a*bays)/bays);
        const b = Math.min(1,Math.ceil(d.b*bays)/bays);
        if (b<=at) continue;
        windowStrip(at,a);
        quad(a,b,y,h,blank,col);
        at=b;
      }
      windowStrip(at,1);
    }
  }
  for (const d of doors) {
    const trim = .095/len;
    quad(d.a-trim,d.b+trim,d.y,d.top+.11,blank,limestone,.035);
    quad(d.a,d.b,d.y+.055,d.top,patch(d.garage ? 'serranda' : 'porta'),d.garage ? {r:.51,g:.49,b:.45} : timber,.055);
    quad(d.a-trim,d.b+trim,d.y,d.y+.075,blank,s.stone,.095);
  }
}
