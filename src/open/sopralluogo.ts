import type { TrackPose } from '@/domain/track';
import type { RideDef, WorldData } from './world';

export interface SurveyAngles { yaw: number; pitch: number }
export const FORWARD: SurveyAngles = {yaw:0,pitch:0};
export function wrapYaw(d: number) { return ((d+180)%360+360)%360-180; }
export function sightLine(pose: Pick<TrackPose,'heading'|'grade'>, a: SurveyAngles) {
  const rad = Math.PI/180;
  return { heading: pose.heading - a.yaw*rad,
    pitch: Math.max(-80,Math.min(80,Math.atan(pose.grade)/rad+a.pitch))*rad };
}

/** Nearby landmarks only; a mountain kilometres to the side is not a stop on the road. */
export function surveyStops(ride: RideDef, data: Pick<WorldData,'features'>) {
  const byId = new Map(data.features.landmarks.map(l => [l.id,l.name]));
  return ride.landmarks.flatMap(l => l.off <= 250 && byId.has(l.id)
    ? [{id:l.id,name:byId.get(l.id)!,station:Math.round(l.at/100)}] : []).sort((a,b) => a.station-b.station);
}
