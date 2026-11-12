import { createContext } from 'react';
import type { RideEngine } from '@/sim/engine';

export interface ActiveRide {
  search: string;
  title: string;
  engine: RideEngine;
  finish: () => Promise<void>;
}

/** Entrare in una stanza o riprendere lo stesso giro conserva il motore. */
export function rideKey(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('room');
  params.delete('resume');
  params.sort();
  return params.toString();
}

export const RideView = createContext<{
  visible: boolean;
  setActive: (ride: ActiveRide | null) => void;
}>({ visible: true, setActive: () => {} });
