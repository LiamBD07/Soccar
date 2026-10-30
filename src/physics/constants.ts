// Metres, kilograms, seconds; 100 Unreal units = 1 metre.
// These constants are reference targets, not a claim of full Rocket League parity.
export const PHYSICS_VERSION = 'soccar-0.1';
export const HZ = 120;
export const DT = 1 / HZ;
export const GRAVITY = 6.5;
export const CAR_MASS = 180;
export const BALL_MASS = 30;
export const BALL_RADIUS = 0.9275;
export const MAX_SPEED = 23;
export const BOOST_ACCEL = 9.9167;
export const JUMP_SPEED = 2.92;
export const JUMP_HOLD_ACCEL = 14.58;
export const FLIP_WINDOW = 1.25;
export const ARENA = { halfWidth: 40.96, halfLength: 51.2, height: 20.44, goalHalfWidth: 8.928, goalHeight: 6.428, goalDepth: 8.8 };
export const WHEELS = [
  { x: -0.36, y: -0.1, z: -0.40 }, { x: 0.36, y: -0.1, z: -0.40 },
  { x: -0.36, y: -0.1, z: 0.37 }, { x: 0.36, y: -0.1, z: 0.37 },
];

export function throttleAcceleration(speed: number): number {
  const v = Math.abs(speed);
  if (v >= 14.1) return 0;
  if (v > 14) return 1.6 * (14.1 - v) / 0.1;
  return 16 - (14.4 / 14) * v;
}

export function steeringCurvature(speed: number): number {
  const v = Math.abs(speed) * 100;
  if (v < 500) return (0.0069 - 0.00000584 * v) * 100;
  if (v < 1000) return (0.00561 - 0.00000326 * v) * 100;
  if (v < 1500) return (0.0043 - 0.00000195 * v) * 100;
  if (v < 1750) return (0.003025 - 0.0000011 * v) * 100;
  return Math.max(0.00088, 0.0018 - 0.0000004 * v) * 100;
}
