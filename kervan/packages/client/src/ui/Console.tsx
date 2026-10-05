/** Geliştirici konsolu (~): CS2 benzeri komutlar. */
import { useEffect, useRef } from 'preact/hooks';
import { ui, log } from './store';
import { settings, saveSettings } from '../settings';
import type { Game } from '../game/game';
import { audio } from '../audio/audio';

const HELP = [
  'Komutlar:',
  '  sensitivity <değer>          fare hassasiyeti (CS2 ile aynı)',
  '  zoom_sensitivity_ratio <d>   dürbün hassasiyeti',
  '  volume <0-1>                 ana ses',
  '  cl_crosshairsize/gap/thickness <d>, cl_crosshaircolor_r/g/b <0-255>',
  '  cl_crosshairdot 0/1, cl_crosshair_t 0/1, cl_crosshair_drawoutline 0/1',
  '  cl_crosshairstyle 2|4        (2 dinamik, 4 sabit)',
  '  viewmodel_fov <54-68>, viewmodel_offset_x/y/z <d>',
  '  net_graph 0/1, cl_showfps 0/1',
  '  noclip, god, restart, setpos x y z, getpos   (antrenman)',
  '  say <mesaj>, say_team <mesaj>',
  '  disconnect, clear, help',
];

export function runCommand(game: Game, line: string) {
  const [cmd, ...args] = line.trim().split(/\s+/);
  if (!cmd) return;
  const a = args.join(' ');
  const n = Number(args[0]);
  const c = settings.crosshair;
  const set = (fn: () => void) => {
    if (!Number.isFinite(n)) {
      log(`geçersiz değer: ${args[0] ?? ''}`);
      return;
    }
    fn();
    saveSettings();
  };
  log(`] ${line}`);
  switch (cmd.toLowerCase()) {
    case 'help':
      HELP.forEach(log);
      break;
    case 'clear':
      ui.consoleLines.value = [];
      break;
    case 'sensitivity':
      if (!args.length) log(`sensitivity = ${settings.sensitivity}`);
      else set(() => (settings.sensitivity = n));
      break;
    case 'zoom_sensitivity_ratio':
    case 'zoom_sensitivity_ratio_mouse':
      set(() => (settings.zoomSensitivity = n));
      break;
    case 'volume':
      set(() => {
        settings.volume = Math.max(0, Math.min(1, n));
        audio.setVolume(settings.volume);
      });
      break;
    case 'cl_crosshairsize':
      set(() => (c.size = n));
      break;
    case 'cl_crosshairgap':
      set(() => (c.gap = n));
      break;
    case 'cl_crosshairthickness':
      set(() => (c.thickness = n));
      break;
    case 'cl_crosshaircolor_r':
      set(() => (c.r = n));
      break;
    case 'cl_crosshaircolor_g':
      set(() => (c.g = n));
      break;
    case 'cl_crosshaircolor_b':
      set(() => (c.b = n));
      break;
    case 'cl_crosshairalpha':
      set(() => (c.alpha = n));
      break;
    case 'cl_crosshairdot':
      set(() => (c.dot = n !== 0));
      break;
    case 'cl_crosshair_t':
      set(() => (c.tStyle = n !== 0));
      break;
    case 'cl_crosshair_drawoutline':
      set(() => (c.outline = n !== 0));
      break;
    case 'cl_crosshair_outlinethickness':
      set(() => (c.outlineThickness = n));
      break;
    case 'cl_crosshairstyle':
      set(() => (c.style = n === 2 || n === 3 ? 'dynamic' : 'static'));
      break;
    case 'cl_crosshair_recoil':
      set(() => (c.followRecoil = n !== 0));
      break;
    case 'viewmodel_fov':
      set(() => (settings.viewmodelFov = Math.max(54, Math.min(68, n))));
      break;
    case 'viewmodel_offset_x':
      set(() => (settings.viewmodelX = Math.max(-2.5, Math.min(2.5, n))));
      break;
    case 'viewmodel_offset_y':
      set(() => (settings.viewmodelY = Math.max(-2, Math.min(2, n))));
      break;
    case 'viewmodel_offset_z':
      set(() => (settings.viewmodelZ = Math.max(-2, Math.min(2, n))));
      break;
    case 'net_graph':
      set(() => (settings.netGraph = n !== 0));
      break;
    case 'cl_showfps':
      set(() => (settings.showFps = n !== 0));
      break;
    case 'noclip':
    case 'god':
    case 'restart':
      game.send({ t: 'cheat', name: cmd as 'noclip' | 'god' | 'restart' });
      break;
    case 'setpos':
      game.send({ t: 'cheat', name: 'setpos', args: args.map(Number) });
      break;
    case 'getpos': {
      const o = game.sim?.move.origin;
      if (o) log(`setpos ${o.x.toFixed(1)} ${o.y.toFixed(1)} ${o.z.toFixed(1)}; yaw ${game.input.yaw.toFixed(1)} pitch ${game.input.pitch.toFixed(1)}`);
      break;
    }
    case 'say':
      game.send({ t: 'chat', text: a, team: false });
      break;
    case 'say_team':
      game.send({ t: 'chat', text: a, team: true });
      break;
    case 'disconnect':
      game.disconnect();
      break;
    default:
      log(`Bilinmeyen komut: ${cmd} (help yaz)`);
  }
}

export function Console({ game }: { game: Game }) {
  const ref = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const open = ui.consoleOpen.value;
  const lines = ui.consoleLines.value;
  useEffect(() => {
    if (open) setTimeout(() => ref.current?.focus(), 0);
  }, [open]);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines, open]);
  if (!open) return null;
  return (
    <div class="console">
      <div class="console-log" ref={logRef}>
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      <input
        ref={ref}
        class="console-input"
        placeholder="komut yaz… (help)"
        onKeyDown={(e) => {
          const el = e.target as HTMLInputElement;
          if (e.key === 'Enter') {
            runCommand(game, el.value);
            el.value = '';
          } else if (e.key === 'Escape' || e.code === settings.binds['console']) {
            e.preventDefault();
            ui.consoleOpen.value = false;
            game.syncInputState();
          }
          e.stopPropagation();
        }}
      />
    </div>
  );
}
