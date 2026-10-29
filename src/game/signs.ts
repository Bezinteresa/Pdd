import { forwardOf, type Point } from './roads.ts';

// Road signs as data: the same placement feeds the 3D scene, the HUD panel and, later, the judge.
export type SignCode = '1.5' | '2.1' | '2.4' | '2.5' | '3.24' | '4.3' | '5.19.1';
export interface SignInfo { code: SignCode; name: string; hint: string; ruleId?: string; }
export interface PlacedSign { id: string; code: SignCode; value?: number; at: Point; facing: Point; }

export const signCatalog: Record<SignCode, SignInfo> = {
  '1.5': { code: '1.5', name: 'Пересечение с трамвайной линией', hint: 'Впереди трамвайные пути — смотрите, нет ли трамвая.' },
  '2.1': { code: '2.1', name: 'Главная дорога', hint: 'Вы на главной: на перекрёстках с второстепенными у вас преимущество.' },
  '2.4': { code: '2.4', name: 'Уступите дорогу', hint: 'Пропустите транспорт на пересекаемой дороге.', ruleId: 'sign-2.4' },
  '2.5': { code: '2.5', name: 'Движение без остановки запрещено', hint: 'Полная остановка у стоп-линии, затем уступите дорогу.', ruleId: 'sign-2.5' },
  '3.24': { code: '3.24', name: 'Ограничение максимальной скорости', hint: 'Не быстрее указанного — до ближайшего перекрёстка.', ruleId: '10.2' },
  '4.3': { code: '4.3', name: 'Круговое движение', hint: 'Уступите тем, кто уже на кольце; по кругу — против часовой стрелки.', ruleId: '13.11(1)' },
  '5.19.1': { code: '5.19.1', name: 'Пешеходный переход', hint: 'Будьте готовы пропустить пешеходов.', ruleId: '14.1' },
};

/** A sign counts as seen within this distance ahead (m). */
export const SIGN_RANGE = 50;
/** Lateral reach: signs further to the side stand on another road and do not address this driver. */
const SIGN_LATERAL = 11;

/**
 * Signs that address a driver at this pose: ahead, within range, close to the driver's road,
 * and with the face turned towards the driver (a sign for oncoming or crossing traffic is ignored, DRV-034).
 */
export function signsAhead(signs: PlacedSign[], pose: Point & { heading: number }, range = SIGN_RANGE): { sign: PlacedSign; distance: number }[] {
  const f = forwardOf(pose.heading);
  const out: { sign: PlacedSign; distance: number }[] = [];
  for (const sign of signs) {
    const dx = sign.at.x - pose.x, dz = sign.at.z - pose.z;
    const ahead = dx * f.x + dz * f.z, lateral = Math.abs(dx * f.z - dz * f.x);
    const facesDriver = sign.facing.x * f.x + sign.facing.z * f.z < -.7;
    if (ahead > 0 && ahead < range && lateral < SIGN_LATERAL && facesDriver) out.push({ sign, distance: ahead });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/** Signs placed by the map's speed zones: the 3.24 plate stands at the zone start facing its traffic. */
export function zoneSigns(zones: { id: string; dir?: Point; limit: number; signAt: Point }[]): PlacedSign[] {
  return zones.filter(z => z.dir).map(z => ({ id: `zone-${z.id}`, code: '3.24', value: z.limit, at: z.signAt, facing: { x: -z.dir!.x, z: -z.dir!.z } }));
}

/** Keeps each seen sign on the HUD while it is ahead and for `hold` seconds after passing it. */
export class SignWatch {
  private seen = new Map<string, { sign: PlacedSign; first: number; last: number }>();
  private hold: number;
  constructor(hold = 6) { this.hold = hold; }
  update(signs: PlacedSign[], pose: Point & { heading: number }, time: number) {
    for (const { sign } of signsAhead(signs, pose)) {
      const entry = this.seen.get(sign.id);
      if (entry) entry.last = time; else this.seen.set(sign.id, { sign, first: time, last: time });
    }
    for (const [id, entry] of this.seen) if (time - entry.last > this.hold) this.seen.delete(id);
  }
  /** Most recently noticed first. */
  current(): PlacedSign[] { return [...this.seen.values()].sort((a, b) => b.first - a.first).map(e => e.sign); }
  clear() { this.seen.clear(); }
}
