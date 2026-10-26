import type { VehicleState } from './vehicle.ts';
export function nextLessonStep(current: number, vehicle: VehicleState): number {
  if (current >= 5) return 5;
  if (!vehicle.belt) return 0;
  const inZone = Math.abs(vehicle.x - 4) < 1.5 && Math.abs(vehicle.z - 69) < 1.4;
  if (current === 0) return 1;
  if (current === 1 && !vehicle.handbrake && vehicle.gear === 'D') return 2;
  if (current === 2 && vehicle.distance > 15) return 3;
  if (current === 3 && inZone && Math.abs(vehicle.speed) < .12) return 4;
  if (current === 4) {
    if (!inZone || Math.abs(vehicle.speed) >= .4) return 3;
    if (vehicle.handbrake && vehicle.gear === 'P') return 5;
  }
  return current;
}
