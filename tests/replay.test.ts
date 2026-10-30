import { afterAll, beforeAll, expect, test } from 'vitest';
import { Simulation } from '../src/physics/simulation';
import { editorInput, parseReplay, Timeline, validateSnapshot } from '../src/replay';
import { emptyInput } from '../src/types';

let sim: Simulation;
beforeAll(async () => { sim = await Simulation.create(); });
afterAll(() => sim.dispose());

test('exported takes validate and preserve physics state and input', () => {
  const timeline = new Timeline(); timeline.reset(sim.snapshot());
  sim.step({ ...emptyInput(), boost: true }); timeline.append(sim.snapshot());
  const restored = parseReplay(JSON.stringify(timeline.export()));
  expect(restored.frames).toHaveLength(2);
  expect(restored.frames[1].input.boost).toBe(true);
  expect(restored.frames[1].car).toEqual(sim.snapshot().car);
});

test('rewinding then applying inputs truncates the old future', () => {
  const timeline = new Timeline(); timeline.reset(sim.snapshot());
  for (let i = 0; i < 10; i++) { sim.step(emptyInput()); timeline.append(sim.snapshot()); }
  const earlier = timeline.seek(3);
  sim.restore(earlier); sim.step({ ...emptyInput(), jump: true }); timeline.append(sim.snapshot());
  expect(timeline.frames).toHaveLength(5);
  expect(timeline.cursor).toBe(4);
  expect(timeline.frames[4].input.jump).toBe(true);
});

test('invalid or incompatible imports are rejected before touching the simulation', () => {
  expect(() => parseReplay('not json')).toThrow('valid JSON');
  expect(() => parseReplay(JSON.stringify({ format: 'other' }))).toThrow('compatible');
  const timeline = new Timeline(); timeline.reset(sim.snapshot());
  const take = timeline.export();
  take.frames[0].car.position.y = Infinity;
  expect(() => parseReplay(JSON.stringify(take))).toThrow('invalid physics');
  const state = sim.snapshot(); state.car.rotation.w = 5;
  expect(validateSnapshot(state)).toBe(false);
});

test('TAS toggles produce signed axes and explicit boost/jump state', () => {
  expect(editorInput(new Set(['forward', 'left', 'boost', 'jump']))).toEqual({ throttle: 1, pitch: -1, steer: -1, yaw: 1, roll: 0, boost: true, jump: true, powerslide: false });
});
