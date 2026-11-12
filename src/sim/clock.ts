/** Fotogrammi, notifiche Bluetooth e timer condividono una sola origine monotona. I passi più
 * brevi di un secondo tengono aggiornate anche svolte, tratti cronometrati e bersagli. */
export class RideClock {
  private busy = false;

  constructor(private last: number, private advance: (seconds: number, atMs: number) => void, private idle: () => boolean) {}

  pulse(now: number, budgetMs = Infinity): void {
    if (this.busy || !Number.isFinite(now) || now <= this.last) return;
    this.busy = true;
    const until = Number.isFinite(budgetMs) ? performance.now()+budgetMs : Infinity;
    try {
      while (this.last < now) {
        const next = this.idle() ? now : Math.min(now, this.last + 1000);
        const dt = (next - this.last) / 1000;
        this.last = next;
        this.advance(dt, next);
        // Una prova lasciata sospesa a lungo recupera il ritardo nei prossimi fotogrammi.
        if (this.last < now && performance.now() >= until) break;
      }
    } finally {
      this.busy = false;
    }
  }
}
