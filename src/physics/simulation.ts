import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type { BodyState, Input, Preset, Snapshot, Vec } from '../types';
import { emptyInput } from '../types';
import { ARENA, BALL_MASS, BALL_RADIUS, BOOST_ACCEL, CAR_MASS, DT, FLIP_WINDOW, GRAVITY, JUMP_HOLD_ACCEL, JUMP_SPEED, MAX_SPEED, WHEELS, steeringCurvature, throttleAcceleration } from './constants';
import { arenaBoxes } from './arena';

const v = (value: Vec) => new Vector3(value.x, value.y, value.z);
const plain = (value: Vec): Vec => ({ x: value.x, y: value.y, z: value.z });
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export class Simulation {
  readonly world: RAPIER.World;
  readonly car: RAPIER.RigidBody;
  readonly ball: RAPIER.RigidBody;
  readonly ballCollider: RAPIER.Collider;
  tick = 0;
  flipAvailable = true;
  jumpUsed = false;
  jumpHeld = 0;
  airborneTime = 0;
  flipTimer = 0;
  flipDirection = new Vector3();
  wasJump = false;
  resetLatched = false;
  flipFromReset = false;
  resetCount = 0;
  goals = 0;
  grounded = false;
  wheelContacts = [false, false, false, false];
  wheelBallContacts = [false, false, false, false];
  lastEvent: 'reset' | 'goal' | 'touch' | null = null;
  lastInput = emptyInput();
  private ballTouching = false;

  static async create() {
    await RAPIER.init();
    return new Simulation();
  }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = DT;
    this.world.numSolverIterations = 8;
    for (const box of arenaBoxes()) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(box.half.x, box.half.y, box.half.z)
        .setTranslation(box.position.x, box.position.y, box.position.z).setRotation(box.rotation)
        .setFriction(0.35).setRestitution(0.3));
    }
    this.car = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.38, 18)
      .setCanSleep(false).setCcdEnabled(true).setLinearDamping(0).setAngularDamping(0.4).setAdditionalSolverIterations(4));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.421, 0.181, 0.59).setMass(CAR_MASS).setFriction(0.15).setRestitution(0.1), this.car);
    this.ball = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, BALL_RADIUS, 0)
      .setCanSleep(false).setCcdEnabled(true).setLinearDamping(0.0305).setAngularDamping(0.15));
    this.ballCollider = this.world.createCollider(RAPIER.ColliderDesc.ball(BALL_RADIUS).setMass(BALL_MASS).setRestitution(0.6).setFriction(0.35), this.ball);
    this.reset('kickoff');
  }

  private bodyState(body: RAPIER.RigidBody): BodyState {
    return { position: plain(body.translation()), rotation: { ...body.rotation() }, velocity: plain(body.linvel()), angularVelocity: plain(body.angvel()) };
  }

  snapshot(): Snapshot {
    return {
      version: 1, tick: this.tick, car: this.bodyState(this.car), ball: this.bodyState(this.ball),
      flipAvailable: this.flipAvailable, jumpUsed: this.jumpUsed, jumpHeld: this.jumpHeld,
      airborneTime: this.airborneTime, flipTimer: this.flipTimer, flipDirection: plain(this.flipDirection),
      wasJump: this.wasJump, resetLatched: this.resetLatched, flipFromReset: this.flipFromReset, resetCount: this.resetCount, goals: this.goals, input: { ...this.lastInput },
    };
  }

  restore(state: Snapshot) {
    for (const [body, data] of [[this.car, state.car], [this.ball, state.ball]] as const) {
      body.setTranslation(data.position, true);
      body.setRotation(data.rotation, true);
      body.setLinvel(data.velocity, true);
      body.setAngvel(data.angularVelocity, true);
      body.resetForces(true);
      body.resetTorques(true);
    }
    this.tick = state.tick;
    this.flipAvailable = state.flipAvailable;
    this.jumpUsed = state.jumpUsed;
    this.jumpHeld = state.jumpHeld;
    this.airborneTime = state.airborneTime;
    this.flipTimer = state.flipTimer;
    this.flipDirection.copy(state.flipDirection);
    this.wasJump = state.wasJump;
    this.resetLatched = state.resetLatched;
    this.flipFromReset = state.flipFromReset;
    this.resetCount = state.resetCount;
    this.goals = state.goals;
    this.lastInput = { ...state.input };
    this.lastEvent = null;
    // A zero-time pipeline refresh updates ray queries without advancing the take.
    this.world.propagateModifiedBodyPositionsToColliders();
    this.refreshContacts();
  }

  reset(preset: Preset) {
    const state = this.snapshot();
    state.tick = 0;
    state.car = { position: { x: 0, y: 0.38, z: 16 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 } };
    state.ball = { position: { x: 0, y: BALL_RADIUS + 0.03, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 } };
    if (preset === 'aerial') {
      state.car.position = { x: 0, y: 3.5, z: 10 };
      state.car.rotation = { x: Math.sin(0.22), y: 0, z: 0, w: Math.cos(0.22) };
      state.car.velocity = { x: 0, y: 3, z: -5 };
      state.ball.position = { x: 0, y: 8, z: -1 };
      state.ball.velocity = { x: 0, y: 4, z: -2 };
    } else if (preset === 'reset') {
      state.car.position = { x: 0, y: 4.1, z: 1.3 };
      state.car.rotation = { x: 0, y: 0, z: 1, w: 0 };
      state.car.velocity = { x: 0, y: 4, z: -1.8 };
      state.ball.position = { x: 0, y: 6.4, z: 0 };
      state.ball.velocity = { x: 0, y: 1.2, z: 0 };
    } else if (preset === 'wall') {
      state.car.position = { x: ARENA.halfWidth - 6, y: 0.38, z: 20 };
      state.car.rotation = { x: 0, y: -Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) };
      state.car.velocity = { x: 5, y: 0, z: 0 };
      state.ball.position = { x: ARENA.halfWidth - 1.3, y: 7, z: 13 };
      state.ball.velocity = { x: 0, y: 2, z: -2 };
    }
    Object.assign(state, { flipAvailable: preset !== 'reset', jumpUsed: preset !== 'kickoff' && preset !== 'wall', jumpHeld: 0, airborneTime: preset === 'reset' ? 2 : 0, flipTimer: 0, flipDirection: { x: 0, y: 0, z: 0 }, wasJump: false, resetLatched: false, flipFromReset: false, input: emptyInput() });
    this.restore(state);
    this.world.step();
    this.refreshContacts();
    this.lastEvent = null;
    this.ballTouching = false;
  }

  private refreshContacts() {
    const q = new Quaternion().copy(this.car.rotation());
    const down = new Vector3(0, -1, 0).applyQuaternion(q);
    const pos = v(this.car.translation());
    this.wheelContacts = [];
    this.wheelBallContacts = [];
    const normals: Vector3[] = [];
    for (const wheel of WHEELS) {
      const origin = v(wheel).applyQuaternion(q).add(pos);
      const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(origin, down), 0.36, true, undefined, undefined, undefined, this.car);
      const isBall = hit?.collider.handle === this.ballCollider.handle;
      this.wheelBallContacts.push(Boolean(isBall));
      this.wheelContacts.push(Boolean(hit && !isBall));
      if (hit && !isBall) normals.push(v(hit.normal));
    }
    this.grounded = normals.length >= 2 && this.jumpHeld === 0;
    return { normals, q, down, pos };
  }

  step(input: Input) {
    this.lastEvent = null;
    this.lastInput = { ...input };
    const { normals, q, down, pos } = this.refreshContacts();
    const up = down.clone().negate();
    const forward = new Vector3(0, 0, -1).applyQuaternion(q);
    const right = new Vector3(1, 0, 0).applyQuaternion(q);
    let velocity = v(this.car.linvel());
    let angular = v(this.car.angvel());
    const forwardSpeed = velocity.dot(forward);

    if (this.wheelBallContacts.every(Boolean) && !this.resetLatched) {
      this.flipAvailable = true;
      this.jumpUsed = true;
      this.flipFromReset = true;
      this.airborneTime = 0;
      this.resetLatched = true;
      this.resetCount++;
      this.lastEvent = 'reset';
    }
    if (!this.wheelBallContacts.some(Boolean)) this.resetLatched = false;

    if (this.grounded) {
      this.flipAvailable = true;
      this.jumpUsed = false;
      this.flipFromReset = false;
      this.airborneTime = 0;
      const normal = normals.reduce((a, b) => a.add(b), new Vector3()).normalize();
      // Damped suspension plus grip; both follow the local surface normal.
      const surfaceDistance = this.surfaceDistance(pos, down);
      const springAcceleration = clamp((0.38 - surfaceDistance) * 220 - velocity.dot(normal) * 20, -22, 45);
      velocity.addScaledVector(normal, (springAcceleration + GRAVITY * normal.y) * DT);
      velocity.addScaledVector(right, -velocity.dot(right) * Math.min(1, (input.powerslide ? 1.2 : 16) * DT));
      let accel = input.throttle * throttleAcceleration(forwardSpeed);
      if (input.throttle && forwardSpeed * input.throttle < -0.2) accel = input.throttle * 35;
      if (!input.throttle) accel = -Math.sign(forwardSpeed) * Math.min(Math.abs(forwardSpeed) / DT, 5.25);
      velocity.addScaledVector(forward, accel * DT);
      const yawSpeed = -input.steer * forwardSpeed * steeringCurvature(forwardSpeed) * (input.powerslide ? 1.5 : 1);
      const alignment = up.clone().cross(normal).multiplyScalar(12);
      angular.lerp(normal.clone().multiplyScalar(yawSpeed).add(alignment), 1 - Math.exp(-18 * DT));
      // Maintain contact on walls without pinning the chassis through the surface.
      if (normal.y < 0.7 && velocity.length() > 2) velocity.addScaledVector(normal, -3 * DT);
    } else {
      this.airborneTime += DT;
      if (this.jumpUsed && !this.flipFromReset && this.airborneTime > FLIP_WINDOW && this.flipTimer <= 0) this.flipAvailable = false;
      const localAngular = angular.clone().applyQuaternion(q.clone().invert());
      localAngular.x += (input.pitch * 12.46 - localAngular.x * (input.pitch ? 0.65 : 2.8)) * DT;
      localAngular.y += (input.yaw * 9.11 - localAngular.y * (input.yaw ? 0.65 : 2.5)) * DT;
      localAngular.z += (-input.roll * 38.34 - localAngular.z * (input.roll ? 3 : 5)) * DT;
      localAngular.clampLength(0, 5.5);
      angular = localAngular.applyQuaternion(q);
      velocity.addScaledVector(forward, input.throttle * 0.667 * DT);
    }

    const jumpPressed = input.jump && !this.wasJump;
    if (jumpPressed && (this.grounded || (!this.jumpUsed && this.flipAvailable))) {
      velocity.addScaledVector(up, JUMP_SPEED);
      this.jumpUsed = true;
      this.jumpHeld = DT;
      this.airborneTime = 0;
      this.grounded = false;
    } else if (jumpPressed && this.flipAvailable) {
      const direction = new Vector3(input.steer, 0, input.pitch);
      if (direction.length() > 0.2) {
        direction.normalize();
        const dodge = direction.clone().applyQuaternion(q);
        // The dodge impulse is horizontal in world space, like a car-soccer flip.
        dodge.y *= 0.3;
        velocity.addScaledVector(dodge.normalize(), 5);
        this.flipTimer = 0.65;
        this.flipDirection.set(direction.z * 9, 0, -direction.x * 9);
      } else {
        velocity.addScaledVector(up, JUMP_SPEED);
      }
      this.flipAvailable = false;
      this.flipFromReset = false;
      this.jumpHeld = 0;
    }
    if (this.jumpHeld > 0) {
      if (input.jump && this.jumpHeld < 0.2) {
        velocity.addScaledVector(up, JUMP_HOLD_ACCEL * DT);
        this.jumpHeld += DT;
      } else this.jumpHeld = 0;
    }
    if (this.flipTimer > 0) {
      this.flipTimer = Math.max(0, this.flipTimer - DT);
      const spin = this.flipDirection.clone();
      if (Math.abs(input.pitch) > 0.1 && Math.sign(input.pitch) !== Math.sign(spin.x)) spin.x *= 0.18;
      angular = spin.applyQuaternion(q);
      if (this.flipTimer > 0.3) velocity.y *= 0.97;
    }
    if (input.boost) velocity.addScaledVector(forward, BOOST_ACCEL * DT);
    velocity.clampLength(0, MAX_SPEED);
    this.car.setLinvel(velocity, true);
    this.car.setAngvel(angular, true);
    this.wasJump = input.jump;
    this.world.step();
    this.tick++;
    this.refreshContacts();

    const bp = v(this.ball.translation());
    const cp = v(this.car.translation());
    const touching = bp.distanceTo(cp) < BALL_RADIUS + 0.82;
    if (touching && !this.ballTouching && this.lastEvent !== 'reset') this.lastEvent = 'touch';
    this.ballTouching = touching;
    const bv = v(this.ball.linvel()).clampLength(0, 60);
    this.ball.setLinvel(bv, true);
    if (Math.abs(bp.z) > ARENA.halfLength + BALL_RADIUS && Math.abs(bp.x) < ARENA.goalHalfWidth - BALL_RADIUS && bp.y < ARENA.goalHeight - BALL_RADIUS) {
      // Count a goal once, then return the ball to centre without teleporting the car.
      this.goals++;
      this.lastEvent = 'goal';
      this.ball.setTranslation({ x: 0, y: BALL_RADIUS + 0.05, z: 0 }, true);
      this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    if (cp.y < -5 || !Number.isFinite(cp.x)) this.reset('kickoff');
  }

  private surfaceDistance(origin: Vector3, direction: Vector3) {
    const hit = this.world.castRay(new RAPIER.Ray(origin, direction), 1, true, undefined, undefined, undefined, this.car,
      collider => collider.handle !== this.ballCollider.handle);
    return hit?.timeOfImpact ?? 0.38;
  }

  placeBall() {
    const q = new Quaternion().copy(this.car.rotation());
    const forward = new Vector3(0, 0, -1).applyQuaternion(q);
    forward.y = 0;
    forward.normalize();
    const position = v(this.car.translation()).addScaledVector(forward, 3.5);
    position.x = clamp(position.x, -ARENA.halfWidth + 4, ARENA.halfWidth - 4);
    position.z = clamp(position.z, -ARENA.halfLength + 4, ARENA.halfLength - 4);
    position.y = BALL_RADIUS + 0.05;
    this.ball.setTranslation(position, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  get speed() { return v(this.car.linvel()).length(); }
  get distanceToBall() { return v(this.car.translation()).distanceTo(v(this.ball.translation())); }
  dispose() { this.world.free(); }
}
