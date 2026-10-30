import type { Input, Replay, Snapshot } from './types';
import { PHYSICS_VERSION } from './physics/constants';

export const MAX_FRAMES = 7201;
const vecKeys = ['x', 'y', 'z'] as const;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e8;
const vector = (o: unknown) => o !== null && typeof o === 'object' && vecKeys.every(k => finite((o as Record<string, unknown>)[k]));
export function validateSnapshot(data: unknown): data is Snapshot {
  if (!data || typeof data !== 'object') return false;
  const s = data as Snapshot;
  if (s.version !== 1 || !Number.isInteger(s.tick) || s.tick < 0 || !finite(s.tick)) return false;
  for (const body of [s.car, s.ball]) {
    if (!body || !vector(body.position) || !vector(body.rotation) || !finite(body.rotation.w) || !vector(body.velocity) || !vector(body.angularVelocity)) return false;
    const q = body.rotation; const length = Math.hypot(q.x, q.y, q.z, q.w);
    if (Math.abs(length - 1) > 0.02) return false;
  }
  for (const key of ['flipAvailable', 'jumpUsed', 'wasJump', 'resetLatched', 'flipFromReset'] as const) if (typeof s[key] !== 'boolean') return false;
  for (const key of ['jumpHeld', 'airborneTime', 'flipTimer', 'resetCount', 'goals'] as const) if (!finite(s[key]) || s[key] < 0) return false;
  if (!vector(s.flipDirection) || !s.input) return false;
  for (const key of ['throttle', 'steer', 'pitch', 'yaw', 'roll'] as const) if (!finite(s.input[key]) || Math.abs(s.input[key]) > 1) return false;
  for (const key of ['boost', 'jump', 'powerslide'] as const) if (typeof s.input[key] !== 'boolean') return false;
  return true;
}

export function parseReplay(text: string): Replay {
  if (text.length > 32_000_000) throw new Error('Take files must be smaller than 32 MB.');
  let r: Replay;
  try { r = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (!r || r.format !== 'soccar-take' || r.version !== 1 || r.hz !== 120 || r.physicsVersion !== PHYSICS_VERSION) throw new Error('This is not a compatible Soccar take (v0.1, 120 Hz).');
  if (typeof r.title !== 'string' || typeof r.createdAt !== 'string' || !Array.isArray(r.frames) || r.frames.length < 1 || r.frames.length > MAX_FRAMES) throw new Error('The take must contain 1–7,201 frames.');
  if (!r.frames.every(validateSnapshot)) throw new Error('The take contains invalid physics or input data.');
  return r;
}

export class Timeline {
  frames: Snapshot[] = [];
  cursor = 0;
  checkpoint: Snapshot | null = null;
  reset(state: Snapshot) { this.frames = [structuredClone(state)]; this.cursor = 0; }
  append(state: Snapshot) {
    this.frames.length = this.cursor + 1;
    this.frames.push(state);
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
    this.cursor = this.frames.length - 1;
  }
  seek(index: number) {
    this.cursor = Math.max(0, Math.min(this.frames.length - 1, Math.round(index)));
    return this.frames[this.cursor];
  }
  export(): Replay {
    return { format: 'soccar-take', version: 1, physicsVersion: PHYSICS_VERSION, title: 'Soccar training take', createdAt: new Date().toISOString(), hz: 120, frames: this.frames };
  }
  load(replay: Replay) { this.frames = replay.frames; this.cursor = 0; this.checkpoint = null; return this.frames[0]; }
}

export function editorInput(toggles: Set<string>): Input {
  const throttle = Number(toggles.has('forward')) - Number(toggles.has('reverse'));
  const steer = Number(toggles.has('right')) - Number(toggles.has('left'));
  return { throttle, pitch: -throttle, steer, yaw: -steer, roll: Number(toggles.has('rollRight')) - Number(toggles.has('rollLeft')), boost: toggles.has('boost'), jump: toggles.has('jump'), powerslide: toggles.has('slide') };
}
