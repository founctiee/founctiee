/**
 * CS2 hareket sabitleri (Source birimleri: inç, saniye).
 * Değerler CS2 varsayılan convar'larıdır.
 */
export const TICK_RATE = 64;
export const TICK_DT = 1 / TICK_RATE;

export const cvars = {
  sv_gravity: 800,
  sv_accelerate: 5.5,
  sv_airaccelerate: 12,
  sv_air_max_wishspeed: 30,
  sv_friction: 5.2,
  sv_stopspeed: 80,
  sv_maxspeed: 320,
  sv_jump_impulse: 301.993377,
  sv_stepsize: 18,
  sv_staminamax: 80,
  sv_staminajumpcost: 0.08,
  sv_staminalandcost: 0.05,
  sv_staminarecoveryrate: 60,
  sv_maxvelocity: 3500,
  sv_bounce: 0,
  /** İleri/yan tuş hızı (cl_forwardspeed/cl_sidespeed). */
  cl_forwardspeed: 450,
  cl_sidespeed: 450,
};

/** Shift ile yürüme hız çarpanı (CS_PLAYER_SPEED_WALK_MODIFIER). */
export const WALK_SPEED_MODIFIER = 0.52;
/** Çömelme hız çarpanı (CS_PLAYER_SPEED_DUCK_MODIFIER). */
export const DUCK_SPEED_MODIFIER = 0.34;
/** Hareket ederken isabetin bozulmaya başladığı hız oranı. */
export const ACCURATE_SPEED_RATIO = 0.34;

export const PLAYER_WIDTH = 32;
export const PLAYER_HEIGHT = 72;
export const PLAYER_DUCK_HEIGHT = 54;
export const VIEW_HEIGHT = 64;
export const DUCK_VIEW_HEIGHT = 46;
/** Havada çömelince ayakların kalktığı mesafe (CS2: 9u). */
export const DUCK_JUMP_LIFT = 9;

export const HULL_MINS = { x: -16, y: -16, z: 0 };
export const HULL_MAXS = { x: 16, y: 16, z: PLAYER_HEIGHT };
export const DUCK_HULL_MAXS = { x: 16, y: 16, z: PLAYER_DUCK_HEIGHT };

/** Zemin sayılan en dik yüzey normali (cos ~45.6°). */
export const MIN_WALK_NORMAL = 0.7;
/** Bu hızdan hızlı yükselirken zemine yapışılmaz. */
export const NON_JUMP_VELOCITY = 140;

export const FALL_DAMAGE_THRESHOLD = 580; // PLAYER_MAX_SAFE_FALL_SPEED (~ sqrt(2*800*210))
export const FATAL_FALL_SPEED = 1024;

export const MAX_HEALTH = 100;
export const MAX_ARMOR = 100;

/** Lag compensation geri sarma limiti (sv_maxunlag). */
export const MAX_UNLAG_SECONDS = 0.2;
