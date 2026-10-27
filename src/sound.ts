// Small synthesised sound set (no audio files): engine hum by rpm, turn-signal tick, success chime, error buzz.
// The AudioContext starts on the first user gesture, as browsers require.
export class SoundBoard {
  enabled = true;
  private ctx: AudioContext | null = null;
  private engineGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;

  /** Call from a user gesture (tap, key). Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx(), osc = ctx.createOscillator(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.value = 420; gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(ctx.destination); osc.start();
      this.ctx = ctx; this.engineOsc = osc; this.engineGain = gain;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Engine note follows rpm (firing frequency of a four-cylinder engine); silent when stopped or muted. */
  engine(rpm: number, throttle: number, running: boolean) {
    if (!this.ctx || !this.engineOsc || !this.engineGain) return;
    const t = this.ctx.currentTime, on = running && this.enabled;
    this.engineOsc.frequency.setTargetAtTime(Math.max(20, rpm / 30), t, .08);
    this.engineGain.gain.setTargetAtTime(on ? .025 + throttle * .03 : 0, t, .12);
  }

  private beep(freq: number, duration: number, volume: number, type: OscillatorType = 'sine', delay = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + delay, osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(.0001, t + duration);
    osc.connect(gain).connect(this.ctx.destination); osc.start(t); osc.stop(t + duration + .02);
  }
  tick() { this.beep(1900, .03, .05, 'square'); }
  success() { this.beep(660, .16, .09); this.beep(880, .22, .09, 'sine', .13); this.beep(1320, .3, .06, 'sine', .26); }
  error() { this.beep(170, .28, .07, 'square'); this.beep(130, .3, .05, 'square', .12); }
}
