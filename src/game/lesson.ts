import type { VehicleState } from './vehicle.ts';

export interface LessonContext { passedLegally: ReadonlySet<string>; }
export interface Lesson {
  id: string; title: string; summary: string; tags: string[]; heading: string;
  steps: string[]; hints: string[];
  /** Target parking zone, shown once the car is moving. */
  goal: { x: number; z: number };
  next(current: number, vehicle: VehicleState, context: LessonContext): number;
}
const inGoal = (v: VehicleState, goal: Lesson['goal']) => Math.abs(v.x - goal.x) < 1.5 && Math.abs(v.z - goal.z) < 1.4;

export function nextLessonStep(current: number, vehicle: VehicleState): number {
  if (current >= 5) return 5;
  if (!vehicle.belt) return 0;
  const inZone = inGoal(vehicle, { x: 4, z: 69 });
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

const crossingGoal = { x: 4.5, z: -45 };
/** Regulated intersection: obey the signal at the stop line, drive straight across, park beyond it. */
export function nextCrossingStep(current: number, vehicle: VehicleState, context: LessonContext): number {
  if (current >= 6) return 6;
  if (!vehicle.belt) return 0;
  const inZone = inGoal(vehicle, crossingGoal);
  if (current === 0) return 1;
  if (current === 1 && !vehicle.handbrake && vehicle.gear === 'D') return 2;
  if (current === 2 && context.passedLegally.has('central-n')) return 3;
  if (current === 3 && vehicle.z < -12 && Math.abs(vehicle.x) < 9) return 4;
  if (current === 4 && inZone && Math.abs(vehicle.speed) < .12) return 5;
  if (current === 5) {
    if (!inZone || Math.abs(vehicle.speed) >= .4) return 4;
    if (vehicle.handbrake && vehicle.gear === 'P') return 6;
  }
  return current;
}

export const lessons: Lesson[] = [
  {
    id: 'first-meters', title: 'Знакомство с автомобилем', heading: 'Первые метры', summary: 'Освойтесь за рулём и сделайте первую безопасную остановку.', tags: ['Начальный', 'АКПП', '~3 мин'],
    steps: ['Пристегните ремень', 'Тормоз → D → снимите ручник', 'Плавно начните движение', 'Остановитесь в зелёной зоне', 'Включите ручник и выберите P'],
    hints: ['Сначала пристегнитесь. Затем нажмите тормоз и выберите D.', 'Удерживайте тормоз на экране или S, выберите D и снимите ручник.', 'Плавно отпустите тормоз и слегка нажмите газ.', 'Зелёная зона расположена прямо по ходу движения, после въездной арки.', 'Остановились? Включите ручник и переведите селектор в P.'],
    goal: { x: 4, z: 69 }, next: (current, vehicle) => nextLessonStep(current, vehicle),
  },
  {
    id: 'signal-crossing', title: 'Регулируемый перекрёсток', heading: 'Сигнал светофора', summary: 'Выполните требование светофора у стоп-линии и проедьте перекрёсток прямо.', tags: ['Базовый', 'Светофор', '~4 мин'],
    steps: ['Пристегните ремень', 'Тормоз → D → снимите ручник', 'Подъедьте к стоп-линии по сигналу', 'Проедьте перекрёсток прямо', 'Остановитесь в зелёной зоне', 'Включите ручник и выберите P'],
    hints: ['Пристегнитесь до начала движения: судья проверяет ремень.', 'Удерживайте тормоз, выберите D и снимите ручник.', 'Выезжайте с площадки прямо. До перекрёстка действует знак 30. На красный или жёлтый остановитесь перед стоп-линией; на зелёный проезжайте.', 'Держитесь своей правой полосы, не меняйте направление.', 'Зона — в правой полосе за перекрёстком. Плавно снижайте скорость.', 'Включите ручник и переведите селектор в P.'],
    goal: crossingGoal, next: nextCrossingStep,
  },
];
