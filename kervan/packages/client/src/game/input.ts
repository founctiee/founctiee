/**
 * Girdi: ham fare (Pointer Lock unadjustedMovement), CS2 hassasiyet formülü
 * (piksel × sens × 0.022°), tuş atamaları ve tek seferlik eylemler.
 */
import {
  IN_ATTACK,
  IN_ATTACK2,
  IN_BACK,
  IN_DUCK,
  IN_FORWARD,
  IN_INSPECT,
  IN_JUMP,
  IN_MOVELEFT,
  IN_MOVERIGHT,
  IN_RELOAD,
  IN_SPEED,
  IN_USE,
} from '@kervan/shared';
import { settings } from '../settings';
import { security } from '../security/integrity';

const M_YAW = 0.022;
const M_PITCH = 0.022;

const BUTTON_ACTIONS: Record<string, number> = {
  forward: IN_FORWARD,
  back: IN_BACK,
  left: IN_MOVELEFT,
  right: IN_MOVERIGHT,
  jump: IN_JUMP,
  duck: IN_DUCK,
  walk: IN_SPEED,
  attack: IN_ATTACK,
  attack2: IN_ATTACK2,
  reload: IN_RELOAD,
  use: IN_USE,
  inspect: IN_INSPECT,
};

export type ActionHandler = (action: string, down: boolean) => void;

export class Input {
  // açılar dışarıdan yazılamaz (aimbot scripti için gerçek #private alan)
  #yaw = 0;
  #pitch = 0;
  get yaw() {
    return this.#yaw;
  }
  get pitch() {
    return this.#pitch;
  }
  private held = new Set<string>();
  /** Bu tick içinde basılıp bırakılan tuşlar (çok kısa basışlar kaybolmasın). */
  private tapped = new Set<string>();
  locked = false;
  /** Oyun girdisi aktif mi (menü/sohbet açıkken kapalı). */
  enabled = true;
  /** Zoom sırasında hassasiyet çarpanı. */
  sensScale = 1;
  /** Ateş tuşuna son basılma anı ve o andaki açılar (subtick). */
  #fire: { t: number; yaw: number; pitch: number } | null = null;
  onAction: ActionHandler = () => {};
  onPointerLockChange: (locked: boolean) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.releaseAll();
      this.onPointerLockChange(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      // script ile üretilen (sahte) olaylar yok sayılır ve bildirilir
      if (!e.isTrusted) return security.untrusted();
      if (!this.locked || !this.enabled) return;
      // aşırı sıçramaları (bazı tarayıcı hataları) yut
      if (Math.abs(e.movementX) > 2000 || Math.abs(e.movementY) > 2000) return;
      const s = settings.sensitivity * this.sensScale;
      let yaw = this.#yaw - e.movementX * s * M_YAW;
      let pitch = this.#pitch + e.movementY * s * M_PITCH * (settings.invertY ? -1 : 1);
      if (pitch > 89) pitch = 89;
      if (pitch < -89) pitch = -89;
      yaw = ((yaw % 360) + 360) % 360;
      this.#yaw = yaw;
      this.#pitch = pitch;
    });
    const codeOfMouse = (b: number) => `Mouse${b}`;
    document.addEventListener('mousedown', (e) => {
      if (!e.isTrusted) return security.untrusted();
      if (!this.locked || !this.enabled) return;
      this.keyDown(codeOfMouse(e.button));
      e.preventDefault();
    });
    document.addEventListener('mouseup', (e) => {
      if (!e.isTrusted) return security.untrusted();
      this.keyUp(codeOfMouse(e.button));
    });
    document.addEventListener(
      'wheel',
      (e) => {
        if (!e.isTrusted) return security.untrusted();
        if (!this.locked || !this.enabled) return;
        const code = e.deltaY > 0 ? 'WheelDown' : 'WheelUp';
        this.keyDown(code);
        this.keyUp(code);
      },
      { passive: true },
    );
    window.addEventListener('keydown', (e) => {
      if (!e.isTrusted) return security.untrusted();
      if (isTyping(e)) return;
      if (e.code === 'Tab' || (e.code.startsWith('Digit') && this.locked)) e.preventDefault();
      if (e.code === 'Space' && this.locked) e.preventDefault();
      if (e.repeat) return;
      if (!this.enabled && e.code !== 'Escape' && e.code !== settings.binds['console'] && e.code !== settings.binds['buy']) {
        // menüler kendi tuşlarını yönetir
        const act = this.actionFor(e.code);
        if (act === 'score') this.onAction('score', true);
        return;
      }
      this.keyDown(e.code);
    });
    window.addEventListener('keyup', (e) => {
      if (!e.isTrusted) return security.untrusted();
      if (isTyping(e)) return;
      this.keyUp(e.code);
    });
    window.addEventListener('blur', () => this.releaseAll());
  }

  actionFor(code: string): string | null {
    for (const [a, c] of Object.entries(settings.binds)) if (c === code) return a;
    return null;
  }

  private keyDown(code: string) {
    const act = this.actionFor(code);
    if (!act) {
      if (code === 'Escape') this.onAction('escape', true);
      return;
    }
    if (BUTTON_ACTIONS[act] !== undefined) {
      if (!this.held.has(act)) {
        this.held.add(act);
        this.tapped.add(act);
        if (act === 'attack') {
          this.#fire = { t: performance.now(), yaw: this.#yaw, pitch: this.#pitch };
        }
      }
    }
    this.onAction(act, true);
  }

  private keyUp(code: string) {
    const act = this.actionFor(code);
    if (!act) return;
    this.held.delete(act);
    this.onAction(act, false);
  }

  releaseAll() {
    for (const a of this.held) this.onAction(a, false);
    this.held.clear();
  }

  /** Bu tick'in tuş maskesi. */
  buttons(): number {
    let b = 0;
    if (!this.enabled) return 0;
    for (const a of this.held) b |= BUTTON_ACTIONS[a] ?? 0;
    for (const a of this.tapped) b |= BUTTON_ACTIONS[a] ?? 0;
    this.tapped.clear();
    return b;
  }

  /** Bekleyen ateş basışını al (bir kez). */
  takeFirePress(): { t: number; yaw: number; pitch: number } | null {
    const f = this.#fire;
    this.#fire = null;
    return f;
  }

  isHeld(action: string) {
    return this.held.has(action);
  }

  async lock() {
    if (this.locked) return;
    try {
      if (settings.rawInput) {
        await (this.canvas.requestPointerLock as (o?: { unadjustedMovement?: boolean }) => Promise<void>).call(this.canvas, { unadjustedMovement: true });
        return;
      }
    } catch {
      /* desteklenmiyor → normal kilit */
    }
    try {
      await (this.canvas.requestPointerLock as () => Promise<void> | void).call(this.canvas);
    } catch {
      /* kullanıcı jesti gerekebilir */
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
}
