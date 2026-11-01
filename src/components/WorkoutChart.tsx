import { powerZone } from '@/domain/zones';
import type { Workout } from '@/domain/types';
import { stepPower, workoutDuration } from '@/domain/workouts';

export function WorkoutChart({
  workout,
  ftp,
  elapsed,
}: {
  workout: Workout;
  ftp: number;
  elapsed?: number;
}) {
  const total = Math.max(1, workoutDuration(workout));
  const ceiling = Math.max(ftp * 1.5, 50);
  let x = 0;
  const shapes = workout.steps.map((step) => {
    const width = (step.durationSec / total) * 100;
    const p0 = stepPower(step, 0, ftp);
    const p1 = stepPower(step, step.durationSec, ftp);
    const y0 = 100 - (p0 / ceiling) * 100;
    const y1 = 100 - (p1 / ceiling) * 100;
    const color = powerZone(Math.max(p0, p1), ftp).color;
    const shape = { x, width, y0, y1, color, id: step.id };
    x += width;
    return shape;
  });
  const play = elapsed != null ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : null;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-16 w-full overflow-hidden rounded-2xl bg-elev2" data-testid="workout-chart">
      {shapes.map((shape) => (
        <polygon
          key={shape.id}
          points={`${shape.x},${100} ${shape.x},${shape.y0} ${shape.x + shape.width},${shape.y1} ${shape.x + shape.width},${100}`}
          fill={shape.color}
          opacity="0.9"
        />
      ))}
      {play != null ? <line x1={play} x2={play} y1="0" y2="100" stroke="white" strokeWidth="0.8" /> : null}
    </svg>
  );
}
