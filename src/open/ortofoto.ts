import * as THREE from 'three';
import type { landscapeUniforms } from './paesaggio';

export const ORTHO_M = 1000;
type Uniforms = ReturnType<typeof landscapeUniforms>;

/** A 3 × 3 km moving sheet; the always-resident satellite image covers the horizon and gaps. */
export function photoWindow(x: number, z: number) {
  const left = Math.floor(x / ORTHO_M) - 1, top = Math.floor(z / ORTHO_M) - 1;
  return {left, top, key: left + ':' + top};
}

async function bitmap(url: string, signal: AbortSignal) {
  const res = await fetch(url, {signal});
  if (!res.ok) throw Error('Ortofoto ' + res.status);
  return createImageBitmap(await res.blob());
}

export class OrthoWindow {
  private index: Set<string> | null = null;
  private stopped = false;
  private root = new AbortController();
  private work?: AbortController;
  private cache = new Map<string, ImageBitmap>();
  get sheets() { return this.u.uOrthoReady.value ? this.cache.size : 0; }
  private displayed = '';
  private requested = '';
  private wanted = '';
  private retryAfter = 0;
  private since = 0;
  private canvas: HTMLCanvasElement;
  private tex: THREE.CanvasTexture;

  constructor(private base: string, private cellPx: number, private u: Uniforms) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 3 * cellPx;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    // Do not send an empty sheet to the GPU; the sampler is bound only once a window is ready.
    void fetch(base + 'index.json', {signal:this.root.signal}).then(async res => {
      if (res.ok && !this.stopped) this.index = new Set(await res.json() as string[]);
    }).catch(() => {});
  }

  tick(x: number, z: number, now: number) {
    if (!this.index || this.stopped) return;
    const window = photoWindow(x,z);
    if (this.wanted !== window.key) {
      this.wanted = window.key;
      this.since = now;
      this.work?.abort();
      this.requested = '';
      this.retryAfter = 0;
    }
    if (this.displayed === window.key || this.requested === window.key || now < this.retryAfter || now - this.since < 180) return;
    const work = new AbortController();
    this.work = work;
    this.requested = window.key;
    void this.load(window,work.signal);
  }

  private async load(window: ReturnType<typeof photoWindow>, signal: AbortSignal) {
    const entries: {name:string; i:number; j:number; image:ImageBitmap}[] = [];
    let failed = false;
    const loads: Promise<void>[] = [];
    for (let j=0; j<3; j++) for (let i=0; i<3; i++) {
      const name = (window.left+i) + '_' + (window.top+j);
      if (!this.index!.has(name)) continue;
      loads.push((async () => {
        const cached = this.cache.get(name);
        const im = cached ?? await bitmap(this.base + name + '.webp', signal);
        if (signal.aborted || this.stopped) { if (!cached) im.close(); return; }
        this.cache.set(name, im);
        entries.push({name,i,j,image:im});
      })().catch(() => { failed = true; }));
    }
    await Promise.all(loads);
    if (signal.aborted || this.stopped) return;
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    const visible = new Set(entries.map(e => e.name));
    for (const {i,j,image} of entries) ctx.drawImage(image,i*this.cellPx,j*this.cellPx,this.cellPx,this.cellPx);
    // The GPU holds one atlas, the CPU only the nine images needed for reuse on crossing a boundary.
    for (const [k,im] of this.cache) if (!visible.has(k)) { im.close(); this.cache.delete(k); }
    this.tex.needsUpdate = true;
    this.u.uOrtho.value = this.tex;
    this.u.uOrthoBox.value.set(window.left*ORTHO_M,window.top*ORTHO_M,1/(3*ORTHO_M),1/(3*ORTHO_M));
    this.u.uOrthoReady.value = entries.length ? 1 : 0;
    this.requested = '';
    this.displayed = failed ? '' : window.key;
    if (failed) this.retryAfter = performance.now()+60000;
  }

  dispose() {
    this.stopped = true;
    this.root.abort();
    this.work?.abort();
    this.u.uOrthoReady.value = 0;
    this.u.uOrtho.value = null;
    this.tex.dispose();
    for (const im of this.cache.values()) im.close();
    this.cache.clear();
    this.canvas.width = this.canvas.height = 1;
  }
}
