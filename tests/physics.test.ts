import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Simulation } from '../src/physics/simulation';
import { ARENA, BALL_RADIUS, DT, MAX_SPEED, steeringCurvature, throttleAcceleration } from '../src/physics/constants';
import { emptyInput } from '../src/types';

describe('car-soccer simulation', () => {
  let sim: Simulation;
  beforeEach(async () => { sim = await Simulation.create(); });
  afterEach(() => sim.dispose());
  const steps = (sim: Simulation, count: number, input = emptyInput()) => { for (let i = 0; i < count; i++) sim.step(input); };

  test('car suspension settles and ball rests on the floor', () => {
    steps(sim, 360);
    expect(sim.car.translation().y).toBeCloseTo(0.38, 1);
    expect(sim.ball.translation().y).toBeCloseTo(BALL_RADIUS, 1);
    expect(sim.wheelContacts).toEqual([true, true, true, true]);
    expect(sim.grounded).toBe(true);
    expect(sim.speed).toBeLessThan(0.1);
  });

  test('throttle moves forward and boost reaches the speed cap with unlimited use', () => {
    const initialZ = sim.car.translation().z;
    steps(sim, 120, { ...emptyInput(), throttle: 1 });
    expect(sim.car.translation().z).toBeLessThan(initialZ - 3);
    expect(sim.speed).toBeGreaterThan(7);
    sim.car.setTranslation({ x: 0, y: 8, z: 25 }, true);
    sim.car.setLinvel({ x: 0, y: 0, z: -22 }, true);
    steps(sim, 40, { ...emptyInput(), throttle: 1, boost: true });
    expect(sim.speed).toBeGreaterThan(22.7);
    expect(sim.speed).toBeLessThanOrEqual(MAX_SPEED + 0.1);
  });

  test('a held jump rises, a second jump consumes the flip, and landing replenishes it', () => {
    steps(sim, 30);
    steps(sim, 24, { ...emptyInput(), jump: true });
    expect(sim.car.translation().y).toBeGreaterThan(1);
    sim.step(emptyInput());
    sim.step({ ...emptyInput(), jump: true });
    expect(sim.flipAvailable).toBe(false);
    steps(sim, 360);
    expect(sim.grounded).toBe(true);
    expect(sim.flipAvailable).toBe(true);
  });

  test('four wheels under the ball earn a flip that can be used immediately', () => {
    const state = sim.snapshot();
    state.ball.position = { x: 0, y: 6, z: 0 };
    state.car.position = { x: 0, y: 4.85, z: 0 };
    state.car.rotation = { x: 0, y: 0, z: 1, w: 0 };
    state.flipAvailable = false; state.jumpUsed = true; state.airborneTime = 2;
    sim.restore(state);
    steps(sim, 2);
    expect(sim.resetCount).toBe(1);
    expect(sim.flipAvailable).toBe(true);
    expect(sim.flipFromReset).toBe(true);
    sim.car.setTranslation({ x: 0, y: 3, z: 0 }, true);
    sim.step({ ...emptyInput(), jump: true, pitch: -1 });
    expect(sim.flipAvailable).toBe(false);
    expect(sim.flipTimer).toBeGreaterThan(0);
  });

  test('partial wheel or chassis contact does not award a reset', () => {
    const state = sim.snapshot();
    state.ball.position = { x: 0, y: 6, z: 0 };
    state.car.position = { x: 0.7, y: 4.85, z: 0 };
    state.car.rotation = { x: 0, y: 0, z: 1, w: 0 };
    state.flipAvailable = false; state.jumpUsed = true; state.airborneTime = 2;
    sim.restore(state); steps(sim, 2);
    expect(sim.resetCount).toBe(0);
    expect(sim.flipAvailable).toBe(false);
  });

  test('ordinary air flips expire after the dodge window', () => {
    sim.reset('aerial'); steps(sim, 160);
    expect(sim.grounded).toBe(false);
    expect(sim.flipAvailable).toBe(false);
  });

  test('the ball passes through the goal opening and scores once', () => {
    sim.ball.setTranslation({ x: 0, y: 2, z: -ARENA.halfLength + 2 }, true);
    sim.ball.setLinvel({ x: 0, y: 0, z: -12 }, true);
    steps(sim, 80);
    expect(sim.goals).toBe(1);
    expect(Math.abs(sim.ball.translation().z)).toBeLessThan(1);
  });

  test('a saved airborne state can be restored and continued', () => {
    sim.reset('aerial'); steps(sim, 20);
    const state = sim.snapshot();
    const input = { ...emptyInput(), boost: true, roll: 0.2, pitch: 0.15 };
    steps(sim, 30, input); const result = sim.snapshot();
    sim.restore(state); steps(sim, 30, input);
    expect(sim.car.translation().x).toBeCloseTo(result.car.position.x, 3);
    expect(sim.car.translation().y).toBeCloseTo(result.car.position.y, 3);
    expect(sim.car.translation().z).toBeCloseTo(result.car.position.z, 3);
    expect(sim.tick).toBe(state.tick + 30);
  });

  test('wall setup stays inside the arena and follows the side ramp', () => {
    sim.reset('wall'); steps(sim, 160, { ...emptyInput(), throttle: 1, boost: true });
    expect(Math.abs(sim.car.translation().x)).toBeLessThan(ARENA.halfWidth + 0.3);
    expect(sim.car.translation().y).toBeGreaterThan(1.5);
  });
});

test('reference acceleration and steering curves have sensible limits', () => {
  expect(DT).toBe(1 / 120);
  expect(throttleAcceleration(0)).toBe(16);
  expect(throttleAcceleration(14.1)).toBe(0);
  expect(steeringCurvature(23)).toBeLessThan(steeringCurvature(5));
});
