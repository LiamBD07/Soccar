import './style.css';
import { layout } from './ui/layout';
import { icon } from './ui/icons';
import { ACTIONS, InputManager, type Action } from './input';
import { ClipRecorder, ClipStore, download, safeName } from './storage';
import { Timeline, editorInput, parseReplay } from './replay';
import { GameAudio } from './audio';
import { DT, HZ } from './physics/constants';
import { emptyInput, type Clip, type Input, type Mode, type Preset } from './types';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const $$ = <T extends HTMLElement = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)];
$('#app').innerHTML = layout();
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const duration = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

function toast(message: string, error = false) {
  const item = document.createElement('div'); item.className = `toast${error ? ' error' : ''}`; item.textContent = message;
  $('#toasts').append(item); setTimeout(() => item.remove(), error ? 9000 : 4500);
}

async function boot() {
  const [{ Simulation }, { GameScene }] = await Promise.all([import('./physics/simulation'), import('./render/scene')]);
  const simulation = await Simulation.create();
  const scene = new GameScene($('#arena'));
  const input = new InputManager(scene.renderer.domElement);
  const timeline = new Timeline(); timeline.reset(simulation.snapshot());
  const clips = new ClipStore(); await clips.open();
  const recorder = new ClipRecorder();
  const audio = new GameAudio();
  let mode: Mode = 'freeplay', preset: Preset = 'kickoff';
  let paused = false, playback = false, speed = 1, accumulator = 0;
  let modalWasPaused = false, modalWasFocused = false;
  let rebinding: Action | null = null;
  let swallowBindingClick = false;
  let clipURLs: string[] = [];
  const tasInputs = new Set<string>();
  let previousJump = false, messageTimer = 0;
  let lastTime = performance.now(), lastUI = 0, fps = 60;
  let recordingStopNotice = false;
  const controlsDialog = $<HTMLDialogElement>('#controls-dialog');
  const libraryDialog = $<HTMLDialogElement>('#library-dialog');
  const pauseButton = $('#pause-button');

  const focus = () => { if (!controlsDialog.open && !libraryDialog.open) input.focus(); };
  const refreshBindings = () => {
    $$<HTMLButtonElement>('[data-rebind]').forEach(button => { button.textContent = input.label(button.dataset.rebind as Action); button.classList.toggle('listening', button.dataset.rebind === rebinding); });
    $$('[data-binding]').forEach(element => { element.textContent = input.label(element.dataset.binding as Action); });
    $$<HTMLButtonElement>('[data-tas]').forEach(button => { const action = button.dataset.tas as Action; if (['forward', 'reverse', 'left', 'right', 'rollLeft', 'rollRight'].includes(action)) { button.textContent = input.label(action); } });
  };
  input.onBindingsChange = refreshBindings; refreshBindings();
  input.onFocus = focused => {
    $('#focus-hint').hidden = focused || paused || playback;
    if (!focused) audio.update(false);
    accumulator = 0;
  };

  function updateTransport() {
    pauseButton.innerHTML = icon(paused ? 'play' : 'pause');
    pauseButton.setAttribute('aria-label', paused ? 'Resume simulation' : 'Pause simulation');
    const active = !paused && (input.focused || playback);
    $('#live-status').textContent = paused ? 'PAUSED' : active ? (playback ? 'REPLAY' : 'LIVE') : 'READY';
    $('#live-status').classList.toggle('paused', paused);
    $('#focus-hint').hidden = input.focused || playback || controlsDialog.open || libraryDialog.open;
    if (paused && !input.focused) $('#focus-hint span').childNodes[0].textContent = `Click to focus · ${input.label('pause')} to resume`;
    else $('#focus-hint span').childNodes[0].textContent = 'Click the field to drive';
    $('#play-take').innerHTML = icon(playback ? 'pause' : 'play');
    $('#play-take').setAttribute('aria-label', playback ? 'Pause recorded take' : 'Play recorded take');
  }

  function syncTimeline() {
    const slider = $<HTMLInputElement>('#timeline');
    slider.max = String(timeline.frames.length - 1); slider.value = String(timeline.cursor);
    $('#frame-display').innerHTML = `${String(timeline.cursor).padStart(4, '0')} <span>/ ${String(timeline.frames.length - 1).padStart(4, '0')}</span>`;
    $('#take-length').textContent = `${((timeline.frames.length - 1) / HZ).toFixed(2)} s`;
    $<HTMLButtonElement>('#restore-checkpoint').disabled = !timeline.checkpoint;
  }

  function setPaused(value: boolean) {
    paused = value; playback = false; accumulator = 0; audio.update(false); updateTransport();
  }

  function reset(next = preset) {
    preset = next; playback = false;
    simulation.reset(preset); timeline.reset(simulation.snapshot());
    $<HTMLSelectElement>('#preset-select').value = preset;
    accumulator = 0; previousJump = false;
    scene.resetCamera(); syncTimeline(); updateTransport();
  }

  function setMode(next: Mode) {
    mode = next;
    $$<HTMLButtonElement>('[data-mode]').forEach(button => {
      if (!button.classList.contains('nav-item')) return;
      const selected = button.dataset.mode === mode;
      button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    const info = { freeplay: ['Freeplay', 'No clock. No opponents. Just one more try.'], trainer: ['Reset trainer', 'Find the contact. Earn the flip. Make it repeatable.'], tas: ['TAS studio', 'Slow it down. Shape the shot. Keep the impossible.'] }[mode];
    $('#page-title').innerHTML = `${info[0]}<span class="title-dot">.</span>`;
    $('#page-description').textContent = info[1];
    $('#tas-panel').hidden = mode !== 'tas';
    $('#freeplay-banner').hidden = mode !== 'freeplay';
    $('#trainer-options').hidden = mode !== 'trainer';
    $('#trainer-button').hidden = mode === 'trainer';
    $('#inspector-title').textContent = mode === 'tas' ? 'Shot setup' : mode === 'trainer' ? 'Training setup' : 'Session setup';
    if (mode === 'trainer') {
      reset('reset'); setPaused(false); scene.wheelGuide = true;
      $<HTMLInputElement>('#wheel-toggle').checked = true;
    } else if (mode === 'tas') {
      setPaused(true);
      toast('TAS paused. Set inputs below, then Apply or advance one frame.');
    } else { setPaused(false); reset('kickoff'); }
    syncTimeline();
    if (mode !== 'tas') focus();
  }

  function announce(event: string) {
    if (event === 'reset' || event === 'goal') {
      $('#game-message').innerHTML = event === 'reset' ? 'RESET ACQUIRED<small>FOUR WHEELS. ONE MORE CHANCE.</small>' : 'NICE SHOT<small>DO IT AGAIN. MAKE IT YOURS.</small>';
      $('#game-message').classList.add('show');
      clearTimeout(messageTimer); messageTimer = window.setTimeout(() => $('#game-message').classList.remove('show'), 1800);
    }
  }

  function advance(controls: Input) {
    if (controls.jump && !previousJump) audio.effect('jump');
    previousJump = controls.jump;
    simulation.step(controls);
    timeline.append(simulation.snapshot());
    if (simulation.lastEvent) { announce(simulation.lastEvent); audio.effect(simulation.lastEvent); }
    if (mode === 'trainer' && $<HTMLInputElement>('#auto-retry').checked && simulation.tick >= 6 * HZ) reset();
  }

  function runFrames(count: number) {
    setPaused(true);
    const controls = editorInput(tasInputs);
    for (let i = 0; i < count; i++) advance(controls);
    syncTimeline();
  }

  function camera() {
    const modes = ['ball', 'car'] as const;
    scene.cameraMode = modes[(modes.indexOf(scene.cameraMode as 'ball' | 'car') + 1) % modes.length];
    const label = scene.cameraMode === 'ball' ? 'BALL CAM' : 'CAR CAM';
    $('#camera-label').textContent = label; $('#camera-hint').textContent = label;
  }

  async function refreshClipCount() {
    try { $('#clip-count').textContent = String((await clips.list()).length); }
    catch { toast('The clip library could not be read. Check browser storage permissions.', true); }
  }

  async function renderLibrary() {
    clipURLs.forEach(url => URL.revokeObjectURL(url)); clipURLs = [];
    try {
      const all = await clips.list();
      $('#clip-count').textContent = String(all.length);
      $('#library-storage').textContent = clips.persistent ? `${all.length} clip${all.length === 1 ? '' : 's'} · ${(all.reduce((sum, clip) => sum + clip.size, 0) / 1024 / 1024).toFixed(1)} MB · this browser only` : 'Storage unavailable · clips last only until you close this tab';
      if (!all.length) {
        $('#library-content').innerHTML = `<div class="empty-library">${icon('film')}<h3>Your first highlight is out there.</h3><p>Hit Record clip, make your shot, then stop to save it here.<br>Recordings capture the arena ${$<HTMLInputElement>('#sound-toggle').checked ? 'with game sound' : 'without sound'}.</p></div>`;
        return;
      }
      $('#library-content').innerHTML = '<div class="clip-grid"></div>';
      const grid = $('.clip-grid');
      for (const clip of all) {
        const url = URL.createObjectURL(clip.blob); clipURLs.push(url);
        const article = document.createElement('article'); article.className = 'clip-card';
        article.innerHTML = `<video controls playsinline preload="metadata" src="${url}"></video><div class="clip-body"><input class="clip-title" type="text" aria-label="Clip title" value="${escapeHtml(clip.title)}" maxlength="100"/><div class="clip-meta"><span>${new Date(clip.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${duration(clip.duration)}</span><span>${(clip.size / 1024 / 1024).toFixed(1)} MB · ${clip.mime.includes('mp4') ? 'MP4' : 'WEBM'}</span></div><div class="clip-actions"><button class="text-button" data-download>${icon('download')} Download clip</button><button class="text-button delete-button" data-delete aria-label="Delete clip">${icon('trash')}</button></div></div>`;
        const video = article.querySelector('video')!;
        video.addEventListener('play', () => { $$('#library-content video').forEach(other => { if (other !== video) (other as HTMLVideoElement).pause(); }); });
        article.querySelector<HTMLInputElement>('.clip-title')!.addEventListener('change', async event => {
          const target = event.target as HTMLInputElement;
          clip.title = target.value.trim() || 'Untitled shot'; target.value = clip.title;
          try { await clips.put(clip); toast('Clip renamed.'); } catch { toast('The new title could not be saved.', true); }
        });
        article.querySelector('[data-download]')!.addEventListener('click', () => download(clip.blob, `${safeName(clip.title)}.${clip.mime.includes('mp4') ? 'mp4' : 'webm'}`));
        article.querySelector('[data-delete]')!.addEventListener('click', async () => {
          if (!confirm(`Delete “${clip.title}” from this browser? Download it first if you want to keep it.`)) return;
          try { await clips.delete(clip.id); await renderLibrary(); } catch { toast('That clip could not be deleted.', true); }
        });
        grid.append(article);
      }
    } catch { toast('The clip library could not be opened. Check browser storage permissions.', true); }
  }

  async function toggleRecording() {
    if (recorder.saving) return;
    if (recorder.recording) { recorder.stop(); $('#record-button span').textContent = 'Saving clip…'; return; }
    try {
      const track = audio.recordTrack;
      recorder.start(scene.renderer.domElement, track);
      recordingStopNotice = false;
      $('#record-button').classList.add('recording');
      $('#record-button').innerHTML = `${icon('stop')}<span>Save clip</span>`;
      $('#recording-indicator').hidden = false;
      toast('Recording the arena. Stop to save; 3 minute maximum.'); focus();
    } catch (error) { toast(error instanceof Error ? error.message : 'Recording could not start.', true); }
  }
  function recordingFinished() {
    $('#record-button').classList.remove('recording');
    $('#record-button').innerHTML = `${icon('record')}<span>Record clip</span>`;
    $('#recording-indicator').hidden = true;
  }
  recorder.onSaved = async (clip: Clip) => {
    recordingFinished();
    try {
      await clips.put(clip); await refreshClipCount();
      toast(clips.persistent ? 'Clip saved to your library. Nice work.' : 'Clip kept in this tab only. Download it before closing.');
      if (libraryDialog.open) await renderLibrary();
    } catch {
      // Never discard the user's take when browser storage is full.
      download(clip.blob, `soccar-unsaved-clip.${clip.mime.includes('mp4') ? 'mp4' : 'webm'}`);
      toast('Browser storage is full or unavailable. Your clip was downloaded instead.', true);
    }
  };
  recorder.onError = message => { recordingFinished(); toast(message, true); };

  async function showDialog(dialog: HTMLDialogElement) {
    if (controlsDialog.open || libraryDialog.open) return;
    modalWasPaused = paused; modalWasFocused = input.focused;
    paused = true; playback = false; input.release(); audio.update(false); accumulator = 0;
    if (dialog === libraryDialog) { if (recorder.recording) recorder.stop(); await renderLibrary(); }
    dialog.showModal(); updateTransport();
  }
  for (const dialog of [controlsDialog, libraryDialog]) {
    dialog.addEventListener('close', () => {
      rebinding = null; refreshBindings();
      paused = modalWasPaused;
      if (dialog === libraryDialog) {
        $$('#library-content video').forEach(video => (video as HTMLVideoElement).pause());
        clipURLs.forEach(url => URL.revokeObjectURL(url)); clipURLs = [];
      }
      if (modalWasFocused) focus();
      updateTransport();
    });
    dialog.addEventListener('cancel', event => {
      if (rebinding) { event.preventDefault(); cancelRebind(); }
    });
    dialog.addEventListener('click', event => {
      if ((event.target as HTMLElement).closest('[data-close]')) dialog.close();
    });
  }

  function cancelRebind() {
    rebinding = null; refreshBindings(); $('#binding-message').textContent = 'Rebinding cancelled. Your previous binding is unchanged.'; $('#binding-message').classList.remove('error');
  }
  function captureBinding(event: KeyboardEvent | MouseEvent) {
    if (!rebinding) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event instanceof KeyboardEvent && event.code === 'Escape') { cancelRebind(); return; }
    if (event instanceof KeyboardEvent && (event.ctrlKey || event.metaKey || event.altKey) && !/^(Control|Meta|Alt)/.test(event.code)) {
      $('#binding-message').textContent = 'Choose a single key or mouse button, without a modifier combination.';
      $('#binding-message').classList.add('error'); return;
    }
    const code = event instanceof KeyboardEvent ? event.code : `Mouse${event.button}`;
    if (event instanceof MouseEvent && event.button === 0) swallowBindingClick = true;
    const action = rebinding;
    const error = input.setBinding(action, code);
    if (error) { $('#binding-message').textContent = error; $('#binding-message').classList.add('error'); return; }
    rebinding = null; refreshBindings();
    $('#binding-message').textContent = `${ACTIONS.find(([name]) => name === action)![1]} → ${input.label(action)}. Saved in this browser.`;
    $('#binding-message').classList.remove('error');
  }
  window.addEventListener('keydown', captureBinding, true);
  window.addEventListener('mousedown', captureBinding, true);
  window.addEventListener('click', event => {
    if (!swallowBindingClick) return;
    swallowBindingClick = false; event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  controlsDialog.addEventListener('contextmenu', event => event.preventDefault());
  controlsDialog.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-rebind]');
    if (!button) return;
    rebinding = button.dataset.rebind as Action;
    refreshBindings(); $('#binding-message').textContent = `Listening for ${ACTIONS.find(([name]) => name === rebinding)![1].toLowerCase()}. Press a key or click a mouse button. Escape cancels.`;
    $('#binding-message').classList.remove('error');
  });

  const actions: Record<string, () => unknown> = {
    focus, camera,
    reset: () => { reset(); focus(); },
    ball: () => { simulation.placeBall(); timeline.append(simulation.snapshot()); focus(); },
    pause: () => { setPaused(!paused); focus(); },
    step: () => { setPaused(true); advance(mode === 'tas' ? editorInput(tasInputs) : input.read()); syncTimeline(); },
    back: () => { setPaused(true); simulation.restore(timeline.seek(timeline.cursor - 1)); syncTimeline(); },
    checkpoint: () => { timeline.checkpoint = simulation.snapshot(); syncTimeline(); toast('Checkpoint set. Restore it to try a different input.'); },
    restore: () => { if (!timeline.checkpoint) return; setPaused(true); simulation.restore(timeline.checkpoint); timeline.reset(simulation.snapshot()); scene.resetCamera(); syncTimeline(); toast('Checkpoint restored. A new branch starts here.'); },
    runframes: () => { const n = Math.round(Number($<HTMLInputElement>('#frame-count').value)); if (!Number.isFinite(n) || n < 1 || n > 600) { toast('Choose between 1 and 600 frames.', true); return; } runFrames(n); },
    playtake: () => {
      if (playback) { playback = false; paused = true; }
      else if (timeline.frames.length > 1) { if (timeline.cursor >= timeline.frames.length - 1) simulation.restore(timeline.seek(0)); playback = true; paused = false; accumulator = 0; }
      else { toast('Drive or apply a few frames to create a take first.'); return; }
      updateTransport();
    },
    record: toggleRecording,
    library: () => showDialog(libraryDialog),
    controls: () => showDialog(controlsDialog), help: () => showDialog(controlsDialog),
    defaults: () => { rebinding = null; input.restoreDefaults(); $('#binding-message').textContent = 'Your defaults restored: left click boost, right click jump, Space ball cam, Left Shift powerslide.'; $('#binding-message').classList.remove('error'); },
    newclip: () => { libraryDialog.close(); setPaused(false); void toggleRecording(); },
    export: () => { download(new Blob([JSON.stringify(timeline.export())], { type: 'application/json' }), 'soccar-take.json'); toast('Take exported. Import it here to keep editing; use Record clip for video.'); },
    import: () => $<HTMLInputElement>('#take-file').click(),
    release: () => { setPaused(true); input.release(); },
    fullscreen: async () => {
      try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('.arena-shell').requestFullscreen(); focus(); }
      catch { toast('Fullscreen is not available in this browser.', true); }
    },
  };
  input.onAction = action => { void actions[action]?.(); };
  document.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const modeButton = target.closest<HTMLElement>('[data-mode]');
    if (modeButton) { setMode(modeButton.dataset.mode as Mode); return; }
    const speedButton = target.closest<HTMLElement>('[data-speed]');
    if (speedButton) {
      speed = Number(speedButton.dataset.speed); accumulator = 0;
      $$('[data-speed]').forEach(button => button.classList.toggle('selected', button === speedButton)); focus(); return;
    }
    const tasButton = target.closest<HTMLElement>('[data-tas]');
    if (tasButton) {
      const key = tasButton.dataset.tas!;
      if (tasInputs.has(key)) tasInputs.delete(key); else tasInputs.add(key);
      tasButton.classList.toggle('selected', tasInputs.has(key));
      tasButton.setAttribute('aria-pressed', String(tasInputs.has(key))); return;
    }
    const button = target.closest<HTMLElement>('[data-action]');
    if (button) void actions[button.dataset.action!]?.();
  });
  $<HTMLSelectElement>('#preset-select').addEventListener('change', event => { reset((event.target as HTMLSelectElement).value as Preset); focus(); });
  $<HTMLInputElement>('#trajectory-toggle').addEventListener('change', event => { scene.trajectory = (event.target as HTMLInputElement).checked; });
  $<HTMLInputElement>('#wheel-toggle').addEventListener('change', event => { scene.wheelGuide = (event.target as HTMLInputElement).checked; });
  $<HTMLInputElement>('#sound-toggle').addEventListener('change', async event => {
    const toggle = event.target as HTMLInputElement;
    try { await audio.setEnabled(toggle.checked); }
    catch { toggle.checked = false; toast('Audio could not start. Check this browser’s sound permissions.', true); }
  });
  $<HTMLInputElement>('#timeline').addEventListener('input', event => { setPaused(true); simulation.restore(timeline.seek(Number((event.target as HTMLInputElement).value))); syncTimeline(); });
  $<HTMLInputElement>('#take-file').addEventListener('change', async event => {
    const fileInput = event.target as HTMLInputElement, file = fileInput.files?.[0]; if (!file) return;
    try {
      if (file.size > 32_000_000) throw new Error('Take files must be smaller than 32 MB.');
      const replay = parseReplay(await file.text());
      setMode('tas'); setPaused(true); simulation.restore(timeline.load(replay)); scene.resetCamera(); syncTimeline();
      toast(`Imported ${replay.frames.length.toLocaleString()} frames. Scrub or play your take.`);
    } catch (error) { toast(error instanceof Error ? error.message : 'That take could not be imported.', true); }
    fileInput.value = '';
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { paused = true; playback = false; accumulator = 0; audio.update(false); updateTransport(); } });
  window.addEventListener('beforeunload', event => { if (recorder.recording || recorder.saving) { event.preventDefault(); } });

  function updateUI(now: number) {
    $('#speed-value').textContent = String(Math.round(simulation.speed * 3.6));
    $('#ball-distance').innerHTML = `${simulation.distanceToBall.toFixed(1)} <small>m</small>`;
    $('#resets-value').textContent = String(simulation.resetCount).padStart(2, '0');
    const status = $('#flip-status');
    status.classList.toggle('unavailable', !simulation.flipAvailable);
    status.innerHTML = `${icon(simulation.flipAvailable ? 'check' : 'close')}<span>${simulation.flipAvailable ? 'Flip available' : 'Flip used / expired'}</span><span class="status-dot"></span>`;
    $$('[data-wheel]').forEach((marker, i) => { marker.classList.toggle('contact', simulation.wheelContacts[i]); marker.classList.toggle('ball-contact', simulation.wheelBallContacts[i]); });
    const contacts = simulation.wheelBallContacts.filter(Boolean).length;
    $('#contact-label').textContent = contacts === 4 ? 'Four wheels. Reset earned.' : contacts > 0 ? `${contacts} / 4 wheels on the ball` : simulation.grounded ? 'Find the underside.' : simulation.flipFromReset ? 'Your next flip is ready.' : 'Wheels toward the ball.';
    $('#coach-tip').textContent = contacts > 0 && contacts < 4 ? 'Adjust your angle to bring all four wheels into contact.' : simulation.flipFromReset ? 'Choose your direction, then jump to use the reset.' : 'Land all four wheels on the ball to earn your next flip.';
    $('#fps-value').textContent = String(Math.round(fps));
    $('#input-status').textContent = input.gamepadConnected ? 'GAMEPAD CONNECTED' : 'KEYBOARD + MOUSE';
    if (recorder.recording) {
      const elapsed = (now - recorder.startedAt) / 1000;
      $('#recording-indicator b').textContent = duration(elapsed);
      if (elapsed > 180 && !recordingStopNotice) { recordingStopNotice = true; recorder.stop(); toast('3 minute limit reached. Saving your clip.'); }
    }
    updateTransport(); syncTimeline();
  }

  function frame(now: number) {
    const elapsed = Math.min(0.1, Math.max(0, (now - lastTime) / 1000)); lastTime = now;
    if (elapsed > 0) fps += (1 / elapsed - fps) * 0.035;
    const controls = input.read();
    const active = !paused && !controlsDialog.open && !libraryDialog.open && (input.focused || playback);
    if (active) {
      accumulator += elapsed * speed;
      let steps = 0;
      while (accumulator >= DT && steps < 12) {
        if (playback) {
          if (timeline.cursor < timeline.frames.length - 1) simulation.restore(timeline.seek(timeline.cursor + 1));
          else { paused = true; playback = false; accumulator = 0; updateTransport(); break; }
        } else advance(controls);
        accumulator -= DT; steps++;
      }
    } else accumulator = 0;
    const renderedInput = playback ? simulation.lastInput : active ? controls : emptyInput();
    audio.update(active && renderedInput.boost);
    scene.render(simulation, renderedInput, elapsed);
    if (now - lastUI > 90) { updateUI(now); lastUI = now; }
    requestAnimationFrame(frame);
  }
  $('#loading').hidden = true;
  await refreshClipCount();
  updateUI(performance.now());
  if (!clips.persistent) toast('Browser storage is unavailable. Download clips before closing this tab.', true);
  if (!recorder.supported) { $<HTMLButtonElement>('#record-button').disabled = true; $('#record-button').title = 'Video recording requires a modern browser with MediaRecorder support.'; }
  requestAnimationFrame(frame);
}

boot().catch(error => {
  console.error('Soccar startup failed:', error);
  $('#loading').innerHTML = '<div class="loading-mark">S/</div><p>The arena could not start.</p><p style="margin-top:12px;max-width:340px;text-align:center;line-height:1.8;padding:0 24px">Use a current desktop browser with WebGL 2 and hardware acceleration enabled, then reload.</p>';
  toast('Arena startup failed. Check WebGL support and the browser console for details.', true);
});
