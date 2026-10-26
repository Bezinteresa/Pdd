// Fixed-time two-group controller. State is a pure function of simulation time,
// so the 3D lamps, AI traffic and the judge always agree and replays are reproducible.
export type SignalGroup = 'ns' | 'ew';
export type Lamp = 'green' | 'greenFlash' | 'yellow' | 'red' | 'redYellow';
export type Lamps = Record<SignalGroup, Lamp>;
export interface SignalPlan { redYellow: number; green: number; greenFlash: number; yellow: number; allRed: number; }

export const defaultPlan: SignalPlan = { redYellow: 1.5, green: 13, greenFlash: 3, yellow: 3, allRed: 2.5 };
export const cycleLength = (plan: SignalPlan) => 2 * (plan.redYellow + plan.green + plan.greenFlash + plan.yellow + plan.allRed);

/** At t = 0 the cross street (ew) starts its green, so a learner arriving early meets red first. */
export function lampAt(group: SignalGroup, t: number, plan: SignalPlan = defaultPlan): Lamp {
  const cycle = cycleLength(plan);
  const local = (((t - (group === 'ns' ? cycle / 2 : 0) + plan.redYellow) % cycle) + cycle) % cycle;
  let edge = plan.redYellow; if (local < edge) return 'redYellow';
  edge += plan.green; if (local < edge) return 'green';
  edge += plan.greenFlash; if (local < edge) return 'greenFlash';
  edge += plan.yellow; if (local < edge) return 'yellow';
  return 'red';
}
/** Signals that permit entering past the stop line (PDD 6.2). */
export const permits = (lamp: Lamp) => lamp === 'green' || lamp === 'greenFlash';
export const lampLabel: Record<Lamp, string> = { green: 'зелёный', greenFlash: 'мигающий зелёный', yellow: 'жёлтый', red: 'красный', redYellow: 'красный и жёлтый' };
export const lampsAt = (t: number, plan: SignalPlan = defaultPlan): Lamps => ({ ns: lampAt('ns', t, plan), ew: lampAt('ew', t, plan) });
