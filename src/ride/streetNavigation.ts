import { haversine, type LatLon } from '@/domain/geo';

export interface Exit { id: string; heading: number }
export interface Panorama extends LatLon { id: string; links: Exit[] }
export const turnAngle = (from: number, to: number) => (to - from + 540) % 360 - 180;

/** Il contachilometri appartiene al rullo. Questo cursore sposta solo la fotografia. */
export class StreetRide {
  current: Panorama | null = null;
  heading = 0;
  private previous = '';
  private atMetres = 0;

  get exits(): Exit[] {
    return (this.current?.links ?? [])
      .filter(link => link.id !== this.previous && link.id !== this.current?.id)
      .sort((a, b) => Math.abs(turnAngle(this.heading, a.heading)) - Math.abs(turnAngle(this.heading, b.heading)));
  }

  jump(place: Panorama, odometer: number, heading: number): boolean {
    if (!place.links.some(link => link.id !== place.id)) return false;
    this.current = place;
    this.heading = heading;
    this.previous = '';
    this.atMetres = odometer;
    return true;
  }

  advance(target: Panorama, odometer: number): boolean {
    const exit = this.exits.find(link => link.id === target.id);
    if (!this.current || !exit) return false;
    const metres = Math.max(1, haversine(this.current, target));
    if (odometer - this.atMetres < metres) return false;
    this.previous = this.current.id;
    this.current = target;
    this.heading = exit.heading;
    this.atMetres += metres;
    return true;
  }
}
