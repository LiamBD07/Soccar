import { Quaternion, Vector3 } from 'three';
import { ARENA } from './constants';
import type { Quat, Vec } from '../types';

export type ArenaBox = { position: Vec; half: Vec; rotation: Quat; kind: 'floor' | 'wall' | 'ramp' | 'goal' };
export function arenaBoxes(): ArenaBox[] {
  const a = ARENA;
  const boxes: ArenaBox[] = [];
  const add = (x: number, y: number, z: number, hx: number, hy: number, hz: number, kind: ArenaBox['kind'], axis?: Vec, angle = 0) => {
    const q = axis ? new Quaternion().setFromAxisAngle(new Vector3(axis.x, axis.y, axis.z), angle) : new Quaternion();
    boxes.push({ position: { x, y, z }, half: { x: hx, y: hy, z: hz }, rotation: { x: q.x, y: q.y, z: q.z, w: q.w }, kind });
  };
  add(0, -0.5, 0, a.halfWidth + 1, 0.5, a.halfLength + a.goalDepth, 'floor');
  add(0, a.height + 0.5, 0, a.halfWidth + 1, 0.5, a.halfLength + 1, 'wall');
  for (const s of [-1, 1]) {
    add(s * (a.halfWidth + 0.5), a.height / 2, 0, 0.5, a.height / 2, a.halfLength, 'wall');
    const sideWidth = (a.halfWidth - a.goalHalfWidth) / 2;
    for (const side of [-1, 1]) {
      add(side * (a.goalHalfWidth + sideWidth), a.height / 2, s * (a.halfLength + 0.5), sideWidth, a.height / 2, 0.5, 'wall');
      add(side * (a.goalHalfWidth + 0.3), a.goalHeight / 2, s * (a.halfLength + a.goalDepth / 2), 0.3, a.goalHeight / 2, a.goalDepth / 2, 'goal');
    }
    add(0, a.goalHeight + (a.height - a.goalHeight) / 2, s * (a.halfLength + 0.5), a.goalHalfWidth, (a.height - a.goalHeight) / 2, 0.5, 'wall');
    add(0, a.goalHeight / 2, s * (a.halfLength + a.goalDepth + 0.3), a.goalHalfWidth, a.goalHeight / 2, 0.3, 'goal');
    add(0, a.goalHeight + 0.3, s * (a.halfLength + a.goalDepth / 2), a.goalHalfWidth, 0.3, a.goalDepth / 2, 'goal');
    // Segmented quarter-pipe transitions let the wheels follow the walls.
    const radius = 3;
    for (let i = 0; i < 12; i++) {
      const t = (i + 0.5) / 12 * Math.PI / 2;
      const halfSegment = radius * Math.PI / 24 / 2 + 0.025;
      const y = radius - radius * Math.cos(t) - 0.15 * Math.cos(t);
      add(s * (a.halfWidth - radius + radius * Math.sin(t) + 0.15 * Math.sin(t)), y, 0, halfSegment, 0.15, a.halfLength, 'ramp', { x: 0, y: 0, z: 1 }, s * t);
      for (const side of [-1, 1]) {
        add(side * (a.goalHalfWidth + sideWidth), y, s * (a.halfLength - radius + radius * Math.sin(t) + 0.15 * Math.sin(t)), sideWidth, 0.15, halfSegment, 'ramp', { x: 1, y: 0, z: 0 }, -s * t);
      }
    }
  }
  return boxes;
}
