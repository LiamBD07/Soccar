import { emptyInput, type Input } from './types';

export const ACTIONS = [
  ['forward', 'Throttle / pitch forward'], ['reverse', 'Reverse / pitch back'],
  ['left', 'Steer / yaw left'], ['right', 'Steer / yaw right'],
  ['rollLeft', 'Air roll left'], ['rollRight', 'Air roll right'],
  ['boost', 'Boost'], ['jump', 'Jump / dodge'], ['powerslide', 'Powerslide'],
  ['camera', 'Toggle ball cam'], ['reset', 'Restart setup'], ['ball', 'Place ball ahead'],
  ['pause', 'Pause / resume'], ['step', 'Advance one frame'], ['record', 'Record / save clip'], ['help', 'Open controls'],
] as const;
export type Action = typeof ACTIONS[number][0];
export type Bindings = Record<Action, string>;
export const DEFAULT_BINDINGS: Bindings = {
  forward: 'KeyW', reverse: 'KeyS', left: 'KeyA', right: 'KeyD', rollLeft: 'KeyQ', rollRight: 'KeyE',
  boost: 'Mouse0', jump: 'Mouse2', powerslide: 'ShiftLeft', camera: 'Space', reset: 'KeyR', ball: 'KeyB',
  pause: 'KeyP', step: 'Period', record: 'KeyV', help: 'KeyH',
};
const STORAGE_KEY = 'soccar.bindings.v1';
export function bindingLabel(code: string) {
  const labels: Record<string, string> = { Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5', Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt', Period: '.', Comma: ',', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: 'Backspace', Enter: 'Enter', Tab: 'Tab' };
  return labels[code] ?? code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
}

export class InputManager {
  readonly keys = new Set<string>();
  bindings: Bindings;
  focused = false;
  gamepadConnected = false;
  onAction: (action: Action | 'release') => void = () => {};
  onFocus: (focused: boolean) => void = () => {};
  onBindingsChange: () => void = () => {};
  private gamepadLastButtons: boolean[] = [];
  constructor(private canvas: HTMLCanvasElement) {
    this.bindings = { ...DEFAULT_BINDINGS };
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (stored && ACTIONS.every(([action]) => typeof stored[action] === 'string')) this.bindings = stored;
    } catch { /* Browser storage can be unavailable. Defaults remain usable. */ }
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('auxclick', e => e.preventDefault());
    canvas.addEventListener('mousedown', e => { e.preventDefault(); canvas.focus(); this.press(`Mouse${e.button}`); });
    window.addEventListener('mouseup', e => this.keys.delete(`Mouse${e.button}`));
    canvas.addEventListener('focus', () => { this.focused = true; this.onFocus(true); });
    canvas.addEventListener('blur', () => this.release());
    window.addEventListener('blur', () => this.release());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.release(); });
    window.addEventListener('keydown', e => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, button, [contenteditable], dialog[open]')) return;
      if (e.code === 'Escape') { this.onAction('release'); canvas.blur(); return; }
      if (!this.focused || e.ctrlKey || e.metaKey || e.altKey) return;
      if (Object.values(this.bindings).includes(e.code)) { e.preventDefault(); if (!e.repeat) this.press(e.code); }
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
  }
  private press(code: string) {
    this.keys.add(code);
    for (const [action] of ACTIONS.slice(9)) if (this.bindings[action] === code) this.onAction(action);
  }
  release() { this.keys.clear(); this.focused = false; this.onFocus(false); }
  focus() { this.canvas.focus(); }
  setBinding(action: Action, code: string): string | null {
    if (code === 'Escape' || /^(Meta|OS)/.test(code)) return 'That key is reserved. Choose another.';
    const conflict = ACTIONS.find(([other]) => other !== action && this.bindings[other] === code);
    if (conflict) return `${bindingLabel(code)} is already assigned to ${conflict[1].toLowerCase()}. Rebind that action first.`;
    this.bindings[action] = code;
    this.save();
    return null;
  }
  restoreDefaults() { this.bindings = { ...DEFAULT_BINDINGS }; this.save(); }
  private save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings)); } catch { /* Keep session bindings even without persistent storage. */ }
    this.keys.clear(); this.onBindingsChange();
  }
  label(action: Action) { return bindingLabel(this.bindings[action]); }
  read(): Input {
    const input = emptyInput();
    const key = (action: Action) => this.focused && this.keys.has(this.bindings[action]) ? 1 : 0;
    input.throttle = key('forward') - key('reverse');
    input.steer = key('right') - key('left');
    input.pitch = -input.throttle; input.yaw = -input.steer;
    input.roll = key('rollRight') - key('rollLeft');
    input.jump = Boolean(key('jump')); input.boost = Boolean(key('boost')); input.powerslide = Boolean(key('powerslide'));
    const pad = navigator.getGamepads?.().find(p => p?.mapping === 'standard');
    this.gamepadConnected = Boolean(pad);
    if (!pad || !this.focused) return input;
    const dead = (n: number) => Math.abs(n) < 0.12 ? 0 : (Math.abs(n) - 0.12) / 0.88 * Math.sign(n);
    const pressed = (index: number) => Boolean(pad.buttons[index]?.pressed);
    const gThrottle = (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
    if (Math.abs(gThrottle) > 0.05) input.throttle = gThrottle;
    if (Math.abs(dead(pad.axes[0])) > 0) { input.steer = dead(pad.axes[0]); input.yaw = -input.steer; }
    if (Math.abs(dead(pad.axes[1])) > 0) input.pitch = dead(pad.axes[1]);
    input.roll = Number(pressed(5)) - Number(pressed(4));
    input.jump ||= pressed(0); input.boost ||= pressed(1); input.powerslide ||= pressed(2);
    for (const [index, action] of [[3, 'camera'], [9, 'pause'], [8, 'reset']] as const) {
      if (pressed(index) && !this.gamepadLastButtons[index]) this.onAction(action);
    }
    this.gamepadLastButtons = pad.buttons.map(b => b.pressed);
    return input;
  }
}
