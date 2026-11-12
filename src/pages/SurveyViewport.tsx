import { useRef, type ReactNode } from 'react';
import { FORWARD, wrapYaw, type SurveyAngles } from '@/open/sopralluogo';

interface Props {
  children: ReactNode;
  orientation: {current:SurveyAngles};
  changed: () => void;
}

/** Pointer movement only updates the camera ref. React updates the Maps link on release. */
export function SurveyViewport({children,orientation,changed}:Props) {
  const drag = useRef<{id:number;x:number;y:number;from:SurveyAngles} | null>(null);
  const set = (yaw:number,pitch:number) => { orientation.current = {yaw:wrapYaw(yaw),pitch:Math.max(-65,Math.min(65,pitch))}; };
  return <div className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent"
    tabIndex={0} role="group" aria-label="Vista 3D. Trascina per guardarti intorno, oppure usa le frecce. Home riallinea la vista."
    onPointerDown={e=>{
      if (!e.isPrimary || e.button!==0) return;
      drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,from:orientation.current};
      e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerMove={e=>{
      const d=drag.current;if(!d || e.pointerId!==d.id)return;
      const scale=70/Math.max(200,e.currentTarget.clientHeight);
      set(d.from.yaw-(e.clientX-d.x)*scale,d.from.pitch+(e.clientY-d.y)*scale);
    }}
    onLostPointerCapture={()=>{if(drag.current){drag.current=null;changed();}}}
    onKeyDown={e=>{
      const a=orientation.current;
      if(e.key==='ArrowLeft') set(a.yaw-10,a.pitch);
      else if(e.key==='ArrowRight') set(a.yaw+10,a.pitch);
      else if(e.key==='ArrowUp') set(a.yaw,a.pitch+5);
      else if(e.key==='ArrowDown') set(a.yaw,a.pitch-5);
      else if(e.key==='Home') orientation.current=FORWARD;
      else return;
      e.preventDefault();changed();
    }}>
    {children}
  </div>;
}
