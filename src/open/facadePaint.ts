import type { WallFinish } from './facadeLayout';

type Brush = CanvasRenderingContext2D;
type Rand = () => number;

/** La luce sui vani, le ombre di davanzali e scuri e il colore dei vetri stanno nell'atlante.
 * Un piano usa sempre una sola famiglia di serramenti. Il colore dell'intonaco viene dalla casa. */
function bay(g: Brush, family: number, col: number, alpine: boolean, rnd: Rand) {
  const c = 256, x = c * col, y = c * family;
  // L'ultima famiglia ladina Ã¨ rivestita di tavole verticali, come il piano alto della Ciasa Vedla.
  if (alpine && family === 2) boarding(g, x, y, c, true, rnd);
  const hw = family === 2 && !alpine ? 55 : family === 1 ? 41 : 45;
  const wx = x + 128 - hw, wy = y + 49 + (family === 1 ? 3 : 0);
  const width = 2 * hw, height = family === 2 && !alpine ? 118 : 132;
  const shadow = g.createLinearGradient(0, wy + height + 6, 0, wy + height + 23);
  shadow.addColorStop(0, 'rgba(46,39,31,.32)'); shadow.addColorStop(1, 'rgba(46,39,31,0)');
  g.fillStyle = shadow; g.fillRect(wx - 7, wy + height + 6, width + 14, 17);
  // La spalletta chiara e le due facce in ombra danno profonditÃ  anche al primo piano.
  g.fillStyle = family === 1 && !alpine ? '#eeeae0' : '#e1d9c8';
  g.fillRect(wx - 7, wy - 7, width + 14, height + 14);
  g.fillStyle = '#59564f'; g.fillRect(wx - 2, wy - 1, width + 4, height + 2);
  const sky = g.createLinearGradient(0, wy + 2, 0, wy + height);
  sky.addColorStop(0, '#8d9ca2'); sky.addColorStop(.50, '#798a91'); sky.addColorStop(.53, '#59685f'); sky.addColorStop(1, '#414942');
  g.fillStyle = sky; g.fillRect(wx + 3, wy + 5, width - 6, height - 8);
  // Tende diverse dietro alcune finestre, una sola porzione di cielo riflesso per vetro.
  if ((col + family) % 3 === 1) {
    g.fillStyle = 'rgba(230,224,203,.53)';
    g.beginPath(); g.moveTo(wx + 4, wy + 5); g.lineTo(wx + width * .42, wy + 5);
    g.quadraticCurveTo(wx + width * .18, wy + height * .43, wx + 10, wy + height - 3); g.lineTo(wx + 4, wy + height - 3); g.fill();
  }
  const frame = alpine ? (family === 2 ? '#c1ad86' : '#6e5540') : (family === 1 ? '#746858' : '#ded9c8');
  g.fillStyle = frame; g.fillRect(wx + hw - 2, wy + 4, 4, height - 7);
  if (family !== 2 || alpine) g.fillRect(wx + 2, wy + height * .38, width - 4, 3);
  const shutters = family !== 2;
  if (shutters) {
    const closed = col === 3 && family === 1;
    const slatW = hw - 2;
    const shutter = alpine ? '#826448' : family === 0 ? '#69765a' : '#846b51';
    for (const sx of closed ? [wx, wx+hw] : [wx - hw - 7, wx + width + 7]) {
      g.fillStyle = 'rgba(45,39,33,.23)'; g.fillRect(sx+3,wy+3,slatW+3,height+3);
      g.fillStyle = shutter; g.fillRect(sx,wy-2,slatW,height+4);
      g.fillStyle = 'rgba(30,26,19,.28)';
      for (let i = 0; i < (family===0 ? 16 : 4); i++) {
        if (family === 0) g.fillRect(sx+3,wy+5+i*8,slatW-6,2);
        else g.fillRect(sx+4+i*9,wy+1,1.6,height-2);
      }
      if (family === 1) {
        g.fillStyle = 'rgba(43,34,23,.42)';
        g.fillRect(sx+1,wy+18,slatW-2,4); g.fillRect(sx+1,wy+height-20,slatW-2,4);
      }
    }
  }
  g.fillStyle = '#bcb5a5'; g.fillRect(wx-8,wy+height+3,width+16,5);
  g.fillStyle = '#ebe6d8'; g.fillRect(wx-9,wy+height+1,width+18,3);
}

function boarding(g: Brush, x: number, y: number, c: number, tinted: boolean, rnd: Rand) {
  const count = 15;
  for (let i=0;i<count;i++) {
    const at=x+c*i/count, w=c/count;
    const lum = Math.round((tinted ? 113 : 215) + rnd()*28);
    g.fillStyle = tinted ? `rgb(${lum},${Math.round(lum*.76)},${Math.round(lum*.55)})` : `rgb(${lum},${lum-3},${lum-10})`;
    g.fillRect(at,y,w+1,c);
    g.fillStyle = 'rgba(41,35,24,.26)'; g.fillRect(at,y,1.7,c);
    for (let k=0;k<5;k++) {
      g.fillStyle = 'rgba(50,38,24,.10)'; g.fillRect(at+2+rnd()*(w-4),y+c*rnd(),.8,15+rnd()*65);
    }
  }
}

function patch(g: Brush, finish: WallFinish, x: number, y: number, c: number, rnd: Rand) {
  if (finish === 'assi') { boarding(g,x,y,c,false,rnd); return; }
  if (finish === 'pietra') {
    g.fillStyle = '#b5b2a8'; g.fillRect(x,y,c,c);
    for (let j=0;j<9;j++) {
      let left = j%2 ? -20 : -4;
      while (left<c) {
        const w = 32+rnd()*48, h=c/9;
        const a = Math.round(192+rnd()*43);
        g.fillStyle = `rgb(${a},${a-3},${a-9})`;
        g.beginPath(); g.moveTo(x+left+2,y+j*h+4); g.lineTo(x+left+w-5,y+j*h+2); g.lineTo(x+left+w-1,y+(j+1)*h-5);
        g.lineTo(x+left+w-5,y+(j+1)*h-2); g.lineTo(x+left+2,y+(j+1)*h-3); g.closePath(); g.fill();
        left+=w;
      }
    }
    return;
  }
  if (finish === 'porta') {
    boarding(g,x,y,c,false,rnd);
    g.strokeStyle = '#aba292'; g.lineWidth=5;
    for (const dx of [21,135]) for (const dy of [18,132]) g.strokeRect(x+dx,y+dy,91,103);
    g.fillStyle='#d3c6a8'; g.fillRect(x+208,y+126,16,4);
    return;
  }
  g.fillStyle='#dddcd7'; g.fillRect(x,y,c,c);
  for (let i=17;i<c;i+=23) {
    g.fillStyle='#a4a39f'; g.fillRect(x,y+i,c,2);
    g.fillStyle='#f6f5f0'; g.fillRect(x,y+i+2,c,2);
  }
}

export function paintFacade(g: Brush, alpine: boolean, rnd: Rand) {
  g.save();
  // 1024Ã—512 come l'atlante precedente; le coordinate di disegno sono in celle di 256Ã—256.
  g.scale(1,.5); g.fillStyle='#fffdfa'; g.fillRect(0,0,1024,1024);
  for (let i=0;i<600;i++) {
    const x=rnd()*1024,y=rnd()*768,r=3+rnd()*22;
    const veil=g.createRadialGradient(x,y,0,x,y,r);
    veil.addColorStop(0,'rgba(132,116,84,.085)'); veil.addColorStop(1,'rgba(132,116,84,0)');
    g.fillStyle=veil; g.fillRect(x-r,y-r,2*r,2*r);
  }
  for (let row=0;row<3;row++) for (let col=0;col<4;col++) bay(g,row,col,alpine,rnd);
  const finishes: WallFinish[]=['pietra','assi','porta','serranda'];
  finishes.forEach((f,i) => {
    g.save();g.beginPath();g.rect(i*256,768,256,256);g.clip();patch(g,f,i*256,768,256,rnd);g.restore();
  });
  g.restore();
}

