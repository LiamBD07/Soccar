export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private boostGain: GainNode | null = null;
  enabled = false;
  async setEnabled(enabled: boolean) {
    if (enabled && !this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain(); this.master.gain.value = 0.2;
      this.destination = this.context.createMediaStreamDestination();
      this.master.connect(this.context.destination); this.master.connect(this.destination);
      const boost = this.context.createOscillator(); boost.type = 'sawtooth'; boost.frequency.value = 59;
      const filter = this.context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 180;
      this.boostGain = this.context.createGain(); this.boostGain.gain.value = 0;
      boost.connect(filter).connect(this.boostGain).connect(this.master); boost.start();
    }
    if (enabled) await this.context?.resume();
    this.enabled = enabled;
    if (!enabled && this.boostGain) this.boostGain.gain.value = 0;
  }
  get recordTrack() { return this.enabled ? this.destination?.stream.getAudioTracks()[0]?.clone() : undefined; }
  update(boost: boolean) {
    if (this.boostGain && this.context) this.boostGain.gain.setTargetAtTime(boost && this.enabled ? 0.12 : 0, this.context.currentTime, 0.05);
  }
  effect(event: 'jump' | 'reset' | 'goal' | 'touch') {
    if (!this.enabled || !this.context || !this.master) return;
    const c = this.context, oscillator = c.createOscillator(), gain = c.createGain();
    const notes = { jump: [190, 300, 0.12], reset: [600, 1100, 0.28], goal: [440, 880, 0.5], touch: [160, 45, 0.17] };
    const [start, end, duration] = notes[event];
    oscillator.type = event === 'touch' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(start, c.currentTime); oscillator.frequency.exponentialRampToValueAtTime(end, c.currentTime + duration);
    gain.gain.setValueAtTime(event === 'touch' ? 0.9 : 0.3, c.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    oscillator.connect(gain).connect(this.master); oscillator.start(); oscillator.stop(c.currentTime + duration);
  }
}
