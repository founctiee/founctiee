/** Kullanıcı komutu tuşları (Source IN_* benzeri). */
export const IN_ATTACK = 1 << 0;
export const IN_JUMP = 1 << 1;
export const IN_DUCK = 1 << 2;
export const IN_FORWARD = 1 << 3;
export const IN_BACK = 1 << 4;
export const IN_USE = 1 << 5;
export const IN_MOVELEFT = 1 << 6;
export const IN_MOVERIGHT = 1 << 7;
export const IN_ATTACK2 = 1 << 8;
export const IN_RELOAD = 1 << 9;
/** Shift ile yürüme. */
export const IN_SPEED = 1 << 10;
export const IN_INSPECT = 1 << 11;
/** Silah düşürme (tek seferlik). */
export const IN_DROP = 1 << 12;

/**
 * Bir tick'lik oyuncu girdisi. İstemci her tick bir tane üretir; sunucu aynısını çalıştırır.
 */
export interface UserCmd {
  seq: number;
  buttons: number;
  /** Derece. Source: pitch pozitif = aşağı. */
  yaw: number;
  pitch: number;
  /** İstenen silah yuvası (envanter indeksi) — 255: değişiklik yok. */
  weapon: number;
  /**
   * İstemcinin bu komutu ürettiği andaki görüntü zamanı (sunucu tick'i cinsinden, ondalıklı).
   * Lag compensation bu ana geri sarar.
   */
  renderTick: number;
  /**
   * Subtick: bu tick içinde ateş tuşuna basılma anı (0..1). 255 yoksa.
   * Sunucu geri sarmayı bu kesirle hassaslaştırır.
   */
  fireFrac: number;
}

export function emptyCmd(seq = 0): UserCmd {
  return { seq, buttons: 0, yaw: 0, pitch: 0, weapon: 255, renderTick: 0, fireFrac: 255 };
}

export function cmdMove(buttons: number): { forward: number; side: number } {
  let forward = 0;
  let side = 0;
  if (buttons & IN_FORWARD) forward += 450;
  if (buttons & IN_BACK) forward -= 450;
  if (buttons & IN_MOVERIGHT) side += 450;
  if (buttons & IN_MOVELEFT) side -= 450;
  return { forward, side };
}
