import * as THREE from 'three';
import type { Input } from '../types';
import type { Simulation } from '../physics/simulation';
import { ARENA, BALL_RADIUS, DT, GRAVITY, WHEELS } from '../physics/constants';
import { arenaBoxes } from '../physics/arena';

const colors = { lime: 0xbcf46b, blue: 0x64c9ed, orange: 0xf5a15e };

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function makeFieldTexture() {
  return canvasTexture(1536, 2048, ctx => {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.fillStyle = '#243c35'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = i % 2 ? '#284138' : '#243c35'; ctx.fillRect(0, i * h / 16, w, h / 16);
    }
    ctx.strokeStyle = 'rgba(183,216,195,.35)'; ctx.lineWidth = 4;
    const mx = 60, my = 65;
    ctx.strokeRect(mx, my, w - mx * 2, h - my * 2);
    ctx.beginPath(); ctx.moveTo(mx, h / 2); ctx.lineTo(w - mx, h / 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(w / 2, h / 2, 175, 190, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 7, 0, Math.PI * 2); ctx.fillStyle = '#a6c1ac'; ctx.fill();
    for (const y of [my, h - my - 290]) ctx.strokeRect(w / 2 - 270, y, 540, 290);
    for (const y of [my, h - my]) {
      ctx.beginPath(); ctx.moveTo(w / 2 - 170, y); ctx.lineTo(w / 2 + 170, y); ctx.strokeStyle = y === my ? '#f5a15e' : '#64c9ed'; ctx.lineWidth = 10; ctx.stroke();
    }
    ctx.save(); ctx.translate(w - 110, h / 2 + 220); ctx.rotate(-Math.PI / 2);
    ctx.font = 'bold 43px sans-serif'; ctx.fillStyle = 'rgba(189,225,198,.17)'; ctx.letterSpacing = '14px'; ctx.fillText('SOCCAR / FREEPLAY LAB', 0, 0); ctx.restore();
    // A deterministic grain gives the turf some texture without external assets.
    let seed = 31;
    for (let i = 0; i < 40000; i++) {
      seed = (seed * 16807) % 2147483647; const x = seed % w;
      seed = (seed * 16807) % 2147483647; const y = seed % h;
      ctx.fillStyle = i % 2 ? 'rgba(150,190,157,.045)' : 'rgba(0,0,0,.06)'; ctx.fillRect(x, y, 1, 3);
    }
  });
}

function meshBox(group: THREE.Group | THREE.Scene, size: [number, number, number], pos: [number, number, number], material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...pos); group.add(mesh); return mesh;
}

function makeCar() {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: colors.lime, roughness: 0.32, metalness: 0.35 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x151d1d, roughness: 0.65, metalness: 0.25 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1e3a3d, roughness: 0.1, metalness: 0.6 });
  const white = new THREE.MeshBasicMaterial({ color: 0xddfff0 });
  const rear = new THREE.MeshBasicMaterial({ color: 0xff563d });
  meshBox(group, [0.83, 0.23, 1.15], [0, -0.02, 0], paint);
  meshBox(group, [0.77, 0.09, 0.36], [0, 0.12, -0.37], paint);
  const cabin = meshBox(group, [0.69, 0.28, 0.56], [0, 0.19, 0.1], paint);
  cabin.rotation.x = -0.08;
  const windshield = meshBox(group, [0.60, 0.22, 0.025], [0, 0.2, -0.197], glass); windshield.rotation.x = -0.24;
  for (const s of [-1, 1]) {
    meshBox(group, [0.016, 0.18, 0.38], [s * 0.353, 0.2, 0.08], glass);
    meshBox(group, [0.13, 0.035, 0.46], [s * 0.25, 0.105, -0.35], trim);
    meshBox(group, [0.21, 0.055, 0.018], [s * 0.245, 0.015, -0.586], white);
    meshBox(group, [0.12, 0.055, 0.018], [s * 0.295, 0.015, 0.586], rear);
    meshBox(group, [0.10, 0.06, 0.11], [s * 0.23, -0.08, 0.63], trim);
  }
  meshBox(group, [0.88, 0.09, 0.09], [0, -0.09, -0.58], trim);
  meshBox(group, [0.83, 0.06, 0.16], [0, 0.30, 0.40], trim);
  meshBox(group, [0.025, 0.025, 0.5], [0, 0.345, 0.03], trim);
  const wheels: THREE.Group[] = [];
  for (const p of WHEELS) {
    const wheel = new THREE.Group();
    wheel.position.set(p.x * 1.2, -0.17, p.z);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.13, 20), trim); tire.rotation.z = Math.PI / 2; wheel.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.103, 0.103, 0.134, 8), new THREE.MeshStandardMaterial({ color: 0x85938e, metalness: 0.9, roughness: 0.3 }));
    hub.rotation.z = Math.PI / 2; wheel.add(hub);
    for (let j = 0; j < 5; j++) {
      const spoke = meshBox(wheel, [0.14, 0.022, 0.17], [0, 0, 0], trim); spoke.rotation.x = j * Math.PI / 5;
    }
    wheels.push(wheel); group.add(wheel);
  }
  group.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
  return { group, wheels };
}

function makeBall() {
  const group = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 32, 24), new THREE.MeshStandardMaterial({ color: 0xe2e4d6, roughness: 0.52, metalness: 0.2 }));
  shell.castShadow = true; group.add(shell);
  const ico = new THREE.IcosahedronGeometry(BALL_RADIUS * 1.007, 1);
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(ico), new THREE.LineBasicMaterial({ color: 0x596860, transparent: true, opacity: 0.7 })); group.add(wire); ico.dispose();
  for (const dir of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)]) {
    const panel = new THREE.Mesh(new THREE.CircleGeometry(0.28, 5), new THREE.MeshStandardMaterial({ color: 0x3a4944, roughness: 0.7 }));
    panel.position.copy(dir).multiplyScalar(BALL_RADIUS * 0.98); panel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir); group.add(panel);
    const light = new THREE.Mesh(new THREE.CircleGeometry(0.05, 8), new THREE.MeshBasicMaterial({ color: 0xc4f699 })); light.position.copy(dir).multiplyScalar(BALL_RADIUS * 1.005); light.quaternion.copy(panel.quaternion); group.add(light);
  }
  return group;
}

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.06, 240);
  readonly car = makeCar();
  readonly ball = makeBall();
  cameraMode: 'ball' | 'car' | 'orbit' = 'ball';
  trajectory = false;
  wheelGuide = true;
  private followReady = false;
  private trajectoryLine: THREE.Line;
  private wheelMarkers: THREE.Mesh[] = [];
  private ballRing: THREE.Mesh;
  private boost: THREE.Group;
  private spark: THREE.Points;
  private sparkPositions = new Float32Array(80 * 3);
  private sparkLife = new Float32Array(80);
  private resize: ResizeObserver;
  private cameraTarget = new THREE.Vector3();
  private elapsed = 0;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', 'Soccar 3D arena. Click to drive; press H for controls.');
    container.prepend(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x15272b);
    this.scene.fog = new THREE.FogExp2(0x15272b, 0.0045);
    this.scene.add(new THREE.HemisphereLight(0xe2f4ef, 0x587260, 2.1));
    const sun = new THREE.DirectionalLight(0xf6ffe8, 3.2);
    sun.position.set(-24, 65, 18); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -65; sun.shadow.camera.right = 65; sun.shadow.camera.top = 65; sun.shadow.camera.bottom = -65; sun.shadow.camera.far = 160;
    sun.shadow.normalBias = 0.035; this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x87c9e0, 1); fill.position.set(30, 20, -40); this.scene.add(fill);
    this.buildArena();
    this.scene.add(this.car.group, this.ball);
    const ringGeo = new THREE.RingGeometry(1.18, 1.25, 64);
    this.ballRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: colors.lime, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false }));
    this.ballRing.rotation.x = -Math.PI / 2; this.scene.add(this.ballRing);
    const trajectoryGeo = new THREE.BufferGeometry(); trajectoryGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(100 * 3), 3));
    this.trajectoryLine = new THREE.Line(trajectoryGeo, new THREE.LineDashedMaterial({ color: 0xd0fca3, dashSize: 0.25, gapSize: 0.15, transparent: true, opacity: 0.65 })); this.scene.add(this.trajectoryLine);
    for (const p of WHEELS) {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshBasicMaterial({ color: 0x799086, depthTest: false, transparent: true, opacity: 0.9 }));
      marker.position.set(p.x * 1.25, -0.30, p.z); marker.renderOrder = 5; this.car.group.add(marker); this.wheelMarkers.push(marker);
    }
    this.boost = new THREE.Group();
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.8, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xc6ff82, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    core.rotation.x = Math.PI / 2; core.position.z = 1.3; this.boost.add(core);
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.32, 2.3, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x85eaa5, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    outer.rotation.x = Math.PI / 2; outer.position.z = 1.5; this.boost.add(outer); this.car.group.add(this.boost);
    const pointGeo = new THREE.BufferGeometry(); pointGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));
    this.spark = new THREE.Points(pointGeo, new THREE.PointsMaterial({ color: colors.lime, size: 0.065, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.spark.frustumCulled = false; this.scene.add(this.spark);
    this.resize = new ResizeObserver(() => this.resizeCanvas()); this.resize.observe(container); this.resizeCanvas();
  }

  private resizeCanvas() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (w < 1 || h < 1) return;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h);
  }

  private buildArena() {
    const a = ARENA;
    const field = new THREE.Mesh(new THREE.PlaneGeometry(a.halfWidth * 2, a.halfLength * 2), new THREE.MeshStandardMaterial({ map: makeFieldTexture(), roughness: 0.95, metalness: 0 }));
    field.rotation.x = -Math.PI / 2; field.position.y = 0.008; field.receiveShadow = true; this.scene.add(field);
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x283e3e, roughness: 0.65, metalness: 0.3, side: THREE.DoubleSide });
    const rampMaterial = new THREE.MeshStandardMaterial({ color: 0x344c42, roughness: 0.8, metalness: 0.1 });
    for (const box of arenaBoxes()) {
      if (box.kind === 'floor' || box.position.y > a.height) continue;
      if (box.kind === 'ramp') {
        const mesh = meshBox(this.scene, [box.half.x * 2, box.half.y * 2, box.half.z * 2], [box.position.x, box.position.y, box.position.z], rampMaterial); mesh.quaternion.copy(box.rotation); mesh.receiveShadow = true;
      }
    }
    // Low boards, wire mesh, and open roof keep the playing space legible.
    for (const side of [-1, 1]) {
      meshBox(this.scene, [0.35, 1.9, a.halfLength * 2], [side * (a.halfWidth + 0.25), 3.95, 0], wallMaterial);
      meshBox(this.scene, [0.12, 0.10, a.halfLength * 2], [side * a.halfWidth, 5, 0], new THREE.MeshBasicMaterial({ color: side > 0 ? colors.blue : colors.orange }));
      for (let z = -a.halfLength; z <= a.halfLength; z += 8.5) {
        meshBox(this.scene, [0.15, a.height - 4, 0.15], [side * (a.halfWidth + 0.3), (a.height + 4) / 2, z], wallMaterial);
      }
      const grid = new THREE.GridHelper(a.halfLength * 2, 44, 0x52716c, 0x3a5754); grid.rotation.z = Math.PI / 2; grid.position.set(side * (a.halfWidth + 0.2), a.height / 2, 0); grid.scale.z = a.height / (a.halfLength * 2); this.scene.add(grid);
      meshBox(this.scene, [7, 3, a.halfLength * 2 + 12], [side * (a.halfWidth + 7), 5, 0], new THREE.MeshStandardMaterial({ color: 0x1c3032, roughness: 0.9 }));
      for (let row = 0; row < 5; row++) {
        meshBox(this.scene, [1.1, 0.6, a.halfLength * 2 + 8], [side * (a.halfWidth + 4 + row * 1.5), 5 + row * 1.05, 0], new THREE.MeshStandardMaterial({ color: row % 2 ? 0x2e4946 : 0x3a5550, roughness: 1 }));
      }
      meshBox(this.scene, [0.45, 0.45, a.halfLength * 2 + 12], [side * (a.halfWidth + 4), 22, 0], wallMaterial);
      for (let z = -40; z <= 40; z += 20) {
        meshBox(this.scene, [1, 0.08, 7], [side * (a.halfWidth - 4), 21, z], new THREE.MeshBasicMaterial({ color: 0xe8fff0 }));
      }
    }
    for (const s of [-1, 1]) {
      const goalColor = s < 0 ? colors.orange : colors.blue;
      const glow = new THREE.MeshBasicMaterial({ color: goalColor });
      const net = new THREE.LineBasicMaterial({ color: goalColor, transparent: true, opacity: 0.17 });
      for (const x of [-a.goalHalfWidth, a.goalHalfWidth]) meshBox(this.scene, [0.19, a.goalHeight, 0.19], [x, a.goalHeight / 2, s * a.halfLength], glow);
      meshBox(this.scene, [a.goalHalfWidth * 2, 0.19, 0.19], [0, a.goalHeight, s * a.halfLength], glow);
      meshBox(this.scene, [a.halfWidth * 2 + 16, 10, 1.5], [0, 11, s * (a.halfLength + 10)], wallMaterial);
      const goalFloor = meshBox(this.scene, [a.goalHalfWidth * 2, 0.08, a.goalDepth], [0, -0.01, s * (a.halfLength + a.goalDepth / 2)], new THREE.MeshStandardMaterial({ color: s < 0 ? 0x65462c : 0x244d5b, roughness: 0.85 })); goalFloor.receiveShadow = true;
      for (let x = -a.goalHalfWidth; x < a.goalHalfWidth; x += 0.8) {
        const points = [new THREE.Vector3(x, 0, s * (a.halfLength + a.goalDepth)), new THREE.Vector3(x, a.goalHeight, s * (a.halfLength + a.goalDepth))];
        this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), net));
      }
      for (let y = 0; y <= a.goalHeight; y += 0.8) {
        this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-a.goalHalfWidth, y, s * (a.halfLength + a.goalDepth)), new THREE.Vector3(a.goalHalfWidth, y, s * (a.halfLength + a.goalDepth))]), net));
      }
      const boardTexture = canvasTexture(1024, 128, ctx => {
        ctx.fillStyle = '#203532'; ctx.fillRect(0, 0, 1024, 128);
        ctx.fillStyle = s < 0 ? '#f5a15e' : '#64c9ed'; ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('S O C C A R   /   F R E E P L A Y   L A B', 512, 77);
      });
      const board = new THREE.Mesh(new THREE.PlaneGeometry(35, 4.375), new THREE.MeshBasicMaterial({ map: boardTexture }));
      board.position.set(0, 11.5, s * (a.halfLength + 9)); if (s > 0) board.rotation.y = Math.PI; this.scene.add(board);
    }
    const centreLogo = canvasTexture(512, 256, ctx => {
      ctx.fillStyle = 'rgba(185,219,195,.12)'; ctx.font = '900 108px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('S /', 256, 166);
    });
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshBasicMaterial({ map: centreLogo, transparent: true, depthWrite: false })); logo.rotation.x = -Math.PI / 2; logo.position.set(0, 0.025, 0); this.scene.add(logo);
  }

  resetCamera() { this.followReady = false; }

  render(sim: Simulation, input: Input, realDt: number) {
    this.elapsed += realDt;
    this.car.group.position.copy(sim.car.translation()); this.car.group.quaternion.copy(sim.car.rotation());
    this.ball.position.copy(sim.ball.translation()); this.ball.quaternion.copy(sim.ball.rotation());
    for (let i = 0; i < 4; i++) {
      this.car.wheels[i].rotation.x -= sim.speed * realDt / 0.16;
      this.wheelMarkers[i].visible = this.wheelGuide;
      (this.wheelMarkers[i].material as THREE.MeshBasicMaterial).color.setHex(sim.wheelBallContacts[i] ? colors.lime : sim.wheelContacts[i] ? 0x5bbbc9 : 0x64776a);
    }
    this.boost.visible = input.boost;
    this.boost.scale.set(1, 1, 0.8 + Math.sin(this.elapsed * 80) * 0.12);
    this.ballRing.position.set(this.ball.position.x, 0.035, this.ball.position.z);
    this.ballRing.scale.setScalar(1 + this.ball.position.y * 0.018);
    (this.ballRing.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.65 - this.ball.position.y * 0.018);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.car.group.quaternion); forward.y = 0;
    if (forward.lengthSq() < 0.01) forward.set(0, 0, -1); forward.normalize();
    let lookDir = forward.clone();
    if (this.cameraMode === 'ball') {
      lookDir.subVectors(this.ball.position, this.car.group.position); lookDir.y = 0;
      if (lookDir.lengthSq() < 0.8) lookDir.copy(forward); lookDir.normalize();
    }
    const desired = this.car.group.position.clone().addScaledVector(lookDir, -5.5).add(new THREE.Vector3(0, 2.65, 0));
    const target = this.car.group.position.clone().addScaledVector(lookDir, 2).add(new THREE.Vector3(0, 0.75, 0));
    if (this.cameraMode === 'ball') target.y += Math.min(4, Math.max(0, this.ball.position.y - this.car.group.position.y) * 0.35);
    if (this.cameraMode === 'orbit') { desired.set(Math.sin(this.elapsed * 0.055) * 54, 37, Math.cos(this.elapsed * 0.055) * 60); target.set(0, 0, 0); }
    desired.x = THREE.MathUtils.clamp(desired.x, -ARENA.halfWidth + 0.6, ARENA.halfWidth - 0.6);
    desired.z = THREE.MathUtils.clamp(desired.z, -ARENA.halfLength + 0.5, ARENA.halfLength - 0.5);
    desired.y = THREE.MathUtils.clamp(desired.y, 0.7, ARENA.height - 0.5);
    const smoothing = this.followReady ? 1 - Math.exp(-7 * Math.min(realDt, 0.05)) : 1;
    this.camera.position.lerp(desired, smoothing); this.cameraTarget.lerp(target, smoothing);
    this.camera.lookAt(this.cameraTarget); this.followReady = true;
    this.trajectoryLine.visible = this.trajectory;
    if (this.trajectory) this.updateTrajectory(sim);
    for (let i = 0; i < 80; i++) {
      this.sparkLife[i] -= realDt;
      if (this.sparkLife[i] <= 0 && input.boost) {
        const p = new THREE.Vector3((Math.sin(i * 7 + this.elapsed * 13)) * 0.13, -0.06, 0.75).applyQuaternion(this.car.group.quaternion).add(this.car.group.position);
        this.sparkPositions.set([p.x, p.y, p.z], i * 3); this.sparkLife[i] = 0.25 + (i % 7) * 0.025;
      } else if (this.sparkLife[i] <= 0) this.sparkPositions[i * 3 + 1] = -10;
    }
    (this.spark.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }

  private updateTrajectory(sim: Simulation) {
    const p = new THREE.Vector3().copy(sim.ball.translation()), vel = new THREE.Vector3().copy(sim.ball.linvel());
    const data = this.trajectoryLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < 100; i++) {
      data.setXYZ(i, p.x, p.y, p.z);
      vel.y -= GRAVITY * DT * 3; p.addScaledVector(vel, DT * 3);
      if (p.y < BALL_RADIUS) { p.y = BALL_RADIUS; vel.y = Math.abs(vel.y) * 0.6; }
      if (Math.abs(p.x) > ARENA.halfWidth - BALL_RADIUS) { p.x = Math.sign(p.x) * (ARENA.halfWidth - BALL_RADIUS); vel.x *= -0.6; }
      if (Math.abs(p.z) > ARENA.halfLength - BALL_RADIUS) { p.z = Math.sign(p.z) * (ARENA.halfLength - BALL_RADIUS); vel.z *= -0.6; }
    }
    data.needsUpdate = true; this.trajectoryLine.computeLineDistances();
  }
}
