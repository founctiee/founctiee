/** Oyuncu ayarları (localStorage). CS2 ile aynı birimler: hassasiyet m_yaw 0.022. */
export interface CrosshairSettings {
  style: 'static' | 'dynamic';
  size: number;
  gap: number;
  thickness: number;
  outline: boolean;
  outlineThickness: number;
  dot: boolean;
  tStyle: boolean;
  r: number;
  g: number;
  b: number;
  alpha: number;
  followRecoil: boolean;
}

export interface Settings {
  name: string;
  sensitivity: number;
  zoomSensitivity: number;
  invertY: boolean;
  rawInput: boolean;
  volume: number;
  musicVolume: number;
  quality: 'low' | 'medium' | 'high';
  renderScale: number;
  showFps: boolean;
  netGraph: boolean;
  crosshair: CrosshairSettings;
  viewmodelFov: number;
  viewmodelX: number;
  viewmodelY: number;
  viewmodelZ: number;
  viewmodelBob: boolean;
  brightness: number;
  binds: Record<string, string>;
}

/** Eylem → tuş kodu (KeyboardEvent.code ya da Mouse0/1/2, WheelUp/Down). */
export const DEFAULT_BINDS: Record<string, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  duck: 'ControlLeft',
  walk: 'ShiftLeft',
  attack: 'Mouse0',
  attack2: 'Mouse2',
  reload: 'KeyR',
  use: 'KeyE',
  drop: 'KeyG',
  inspect: 'KeyF',
  buy: 'KeyB',
  score: 'Tab',
  slot1: 'Digit1',
  slot2: 'Digit2',
  slot3: 'Digit3',
  slot4: 'Digit4',
  slot5: 'Digit5',
  lastweapon: 'KeyQ',
  invnext: 'WheelDown',
  invprev: 'WheelUp',
  chat: 'KeyY',
  teamchat: 'KeyU',
  teammenu: 'KeyM',
  console: 'Backquote',
};

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  sensitivity: 1.25,
  zoomSensitivity: 1.0,
  invertY: false,
  rawInput: true,
  volume: 0.7,
  musicVolume: 0.4,
  quality: 'high',
  renderScale: 1,
  showFps: true,
  netGraph: false,
  crosshair: {
    style: 'static',
    size: 2.5,
    gap: -1,
    thickness: 1,
    outline: true,
    outlineThickness: 1,
    dot: false,
    tStyle: false,
    r: 50,
    g: 250,
    b: 50,
    alpha: 255,
    followRecoil: false,
  },
  viewmodelFov: 68,
  viewmodelX: 2.5,
  viewmodelY: 0,
  viewmodelZ: -1.5,
  viewmodelBob: true,
  brightness: 1,
  binds: { ...DEFAULT_BINDS },
};

const KEY = 'kervan.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...s,
      crosshair: { ...DEFAULT_SETTINGS.crosshair, ...(s.crosshair ?? {}) },
      binds: { ...DEFAULT_BINDS, ...(s.binds ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export const settings: Settings = load();

const listeners = new Set<() => void>();
export function onSettingsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function saveSettings(patch?: Partial<Settings>) {
  if (patch) Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* gizli sekme vb. */
  }
  for (const l of listeners) l();
}

export function resetSettings() {
  const name = settings.name;
  Object.assign(settings, structuredClone(DEFAULT_SETTINGS), { name });
  saveSettings();
}
