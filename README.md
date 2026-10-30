# Soccar · Freeplay Lab

A solo car-soccer website built with TypeScript, Three.js, and Rapier. It runs entirely in the browser: no multiplayer server, database service, login, or API keys.

## Run it

Use Node.js 24 (see `.nvmrc`).

```sh
npm ci
npm run dev
```

Open the address Vite prints in your desktop browser. Click the field to drive. A current browser with WebGL 2 and hardware acceleration is recommended. A keyboard and mouse or standard gamepad is required; there are no touch driving controls.

```sh
npm run build      # Type check and produce dist/
npm test           # Physics and take validation tests
npm run test:e2e   # Chromium browser integration tests
npm run preview   # Serve the production build locally
```

The browser tests use `/usr/bin/chromium` when available. Otherwise install Playwright's browser with `npx playwright install chromium` (and the platform dependencies if needed). Browser tests start their own server on port 4173. The cloud development server uses port 5173.

## Your defaults, all rebindable

| Action | Binding |
| --- | --- |
| Throttle / nose down | W |
| Reverse / nose up | S |
| Steer / yaw | A / D |
| Air roll | Q / E |
| Boost | **Left click** |
| Jump / dodge | **Right click** |
| Ball cam | **Space** |
| Powerslide | **Left Shift** |
| Restart setup | R |
| Place ball ahead | B |
| Pause / resume | P |
| Single physics frame | . |
| Record / save video | V |
| Controls panel | H |

Open **Your controls** or **Controls & bindings** to change any action to a key or mouse button. Click a binding and press the new input; Escape cancels. Conflicts are reported instead of silently replacing another action. Preferences are saved to this browser's localStorage. “Restore your defaults” restores the mouse bindings above. While editing text, normal browser typing takes priority. Escape releases the arena and pauses. Changing tabs also pauses; refocus the arena and resume when you return.

Standard gamepad support: RT/LT throttle/reverse, left stick steer/pitch, A jump, B boost, X slide, LB/RB roll, Y ball cam, Start pause, Back reset. The keyboard/mouse bindings are customizable; gamepad mapping is fixed in this version. Press a pad button to connect, then focus the arena.

## Practice

- **Freeplay**: unlimited boost, centre field, aerial approach, under-the-ball, and wall takeoff presets. Restart exactly the selected setup with R, or place the ball ahead with B. Ball cam and car cam are available.
- **Reset trainer**: starts inverted below an airborne ball with the original flip expired. Align the underside of the car with the underside of the ball. All **four** suspension/wheel probes must contact the ball to award a reset; a chassis hit or two-wheel touch does not count. Once earned, use a direction and jump to dodge immediately. The four indicators and coach show contact and flip availability. Optional auto retry runs a six-second simulation attempt. At .25× speed this lasts 24 real seconds.
- **Training assists**: .25×/.5×/1× simulation speed, wheel markers, and a ball trajectory guide. The guide estimates gravity and simple bounces; it does not predict car impacts, goal openings, ramps, spin, or ceiling bounces.
- **TAS studio**: pauses play, stores up to 60 seconds of frames at 120 Hz, scrubs states, steps forward/back, stores a checkpoint, and lets you apply chosen inputs for 1–600 frames. Applying after scrubbing replaces the previous future. Restore starts a new branch from the checkpoint. Play take reproduces the recorded states; resume live or Apply continues the simulation. Export/import `.json` takes to keep editing in a later session. The rolling timeline and checkpoint are otherwise in memory and disappear on reload. Imported files must match this physics version and pass validation.
- **Clip library**: record the rendered arena, including TAS playback, at the browser's available frame rate (up to 60 fps). Stop to save a WebM video, or MP4 if the browser only supports it. A recording stops automatically after three minutes. Sound is optional; enable it **before** starting a recording to include it. Rename, preview, download, and delete saved clips in the library. The site UI is not included in the video.

Videos use IndexedDB on this device and website origin. They are **not uploaded**. Browser storage is not a backup: private browsing, quota limits, clearing site data, changing domains, or changing browsers can make clips unavailable. Download anything you want to keep. If storage is unavailable, clips stay in memory for the current tab; if a save fails, the app offers the video as a download. Recording requires a secure origin (HTTPS or local development) and MediaRecorder/canvas capture support.

## Physics scope — please read before training

This is an **independent prototype, not an exact Rocket League simulator**. It has a Fennec-inspired, procedurally modelled boxy body called Boxer, not the licensed Fennec asset. It does not use Rocket League code, assets, or branding and is not affiliated with Psyonix or Epic Games.

The simulation runs at a fixed 120 Hz. Reference targets use 100 Unreal units per metre:

- Gravity: 650 uu/s²; maximum car speed: 2300 uu/s; boost acceleration: about 991.67 uu/s².
- Car mass: 180 kg; ball mass: 30 kg; ball radius: 92.75 uu.
- Octane-class rectangular hitbox: 118 × 84.2 × 36.2 uu (length × width × height).
- First-jump impulse: 292 uu/s; variable jump hold up to .2 seconds; timed second jump/dodge; persistent flip availability after a ball reset.
- Reference speed-dependent throttle and steering curves, air control, directional dodges, slide grip, and segmented floor-to-wall transitions.

The targets are based on the [RLBot community's game values](https://wiki.rlbot.org/botmaking/useful-game-values/), not a complete implementation of the original engine. Suspension, friction, car-ball collision impulses, dodge details, air control, arena corners, and wall/ceiling handling are approximations. The arena uses rectangular corners and segmented side/end ramps. There is no measured parity suite against Rocket League. Treat it as an experimental sandbox for practising the idea of resets and making tool-assisted shots; timing and muscle memory are not guaranteed to transfer. Recorded-state playback reproduces a saved take; resimulating from a checkpoint can differ around contacts because the physics engine's internal contact caches are not serialized.

## Put it online for free

**Use a static site**, not a paid web service. The entire deployed app is the contents of `dist/`. No game server needs to stay awake. Render Static Sites is a practical choice if you already have a Render account; Cloudflare Pages is another suitable option. Check each provider's current free-plan limits when you deploy.

### Render Static Site (recommended for your existing account)

1. Use the `main` branch of [`LiamBD07/Soccar`](https://github.com/LiamBD07/Soccar) on GitHub.
2. In Render, create a **Static Site** and connect that repository/branch.
3. Set build command to `npm ci && npm run build` and publish directory to `dist`. Leave the root directory at the repository root. Set Node to 24 if the host asks; `.node-version` and `.nvmrc` are included.
4. Deploy. Render provides the public HTTPS address and can redeploy on future pushes.

`render.yaml` contains the equivalent static-site Blueprint configuration if you prefer Render's Blueprint flow. It has no backend service or paid instance configured. No credentials belong in this repository.

### Cloudflare Pages

Connect the GitHub repository to a Pages project, use `npm run build`, set output directory to `dist`, and use Node 24. Alternatively, build locally and use Pages' direct-upload option to upload the contents of `dist/` (the release ZIP is also suitable after extracting it). Do not deploy `src/` or `node_modules/`.

### Any static HTTPS host

Upload the built `dist/` files. Assets use relative paths, so the build also works in a project subdirectory. The app does not use URL-based client-side routes and needs no SPA rewrite. Keep HTTPS enabled so recording and browser APIs work normally. No custom network or secret environment variables are needed by the app.

## Project map

- `src/physics/` — reference constants, arena colliders, vehicle/ball simulation.
- `src/render/` — procedural stadium, Boxer model, ball, camera, visual assists.
- `src/input.ts` — saved keyboard/mouse bindings and standard gamepad input.
- `src/replay.ts` — frame history, branching, import validation.
- `src/storage.ts` — IndexedDB library, capture, downloads.
- `src/main.ts` — training workflow and UI coordination.
- `tests/` — meaningful physics checks, take validation, browser workflows.

Dependencies are pinned in `package-lock.json`. Three.js and Rapier are MIT / Apache-2.0 respectively; preserve their licenses when distributing. This source is not assigned an open-source license by the scaffolding; choose a project license before advertising it as open source.
