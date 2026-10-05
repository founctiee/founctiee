/** Ayarlar: oyun, görüntü, ses, nişangah (CS2 kodu içe aktarma), silah görünümü, kontroller. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { decodeCrosshairShareCode } from 'csgo-sharecode';
import { settings, saveSettings, resetSettings, DEFAULT_BINDS, CrosshairSettings } from '../settings';
import { ui } from './store';
import { tr } from '../i18n/tr';
import { drawCrosshair } from './crosshair';
import { audio } from '../audio/audio';

type Tab = 'game' | 'video' | 'audio' | 'crosshair' | 'viewmodel' | 'controls';

function Slider(p: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label class="row">
      <span>{p.label}</span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onInput={(e) => p.onChange(Number((e.target as HTMLInputElement).value))} />
      <input class="numbox" type="number" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number((e.target as HTMLInputElement).value))} />
    </label>
  );
}

function Check(p: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="row">
      <span>{p.label}</span>
      <input type="checkbox" checked={p.value} onChange={(e) => p.onChange((e.target as HTMLInputElement).checked)} />
    </label>
  );
}

function keyName(code: string) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Mouse0: 'Sol tık',
    Mouse1: 'Orta tık',
    Mouse2: 'Sağ tık',
    Mouse3: 'Fare 4',
    Mouse4: 'Fare 5',
    WheelUp: 'Tekerlek ↑',
    WheelDown: 'Tekerlek ↓',
    Space: 'Boşluk',
    ControlLeft: 'Sol Ctrl',
    ShiftLeft: 'Sol Shift',
    AltLeft: 'Sol Alt',
    Backquote: '" (konsol)',
    Tab: 'Tab',
  };
  return map[code] ?? code;
}

function CrosshairPreview({ c }: { c: CrosshairSettings }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, cv.width, cv.height);
    const grd = g.createLinearGradient(0, 0, cv.width, cv.height);
    grd.addColorStop(0, '#c9a873');
    grd.addColorStop(1, '#6b5a43');
    g.fillStyle = grd;
    g.fillRect(0, 0, cv.width, cv.height);
    drawCrosshair(g, cv.width / 2, cv.height / 2, c, 0, 1080);
  });
  return <canvas class="ch-preview" ref={ref} width={220} height={140} />;
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('game');
  const [, force] = useState(0);
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState('');
  const [binding, setBinding] = useState<string | null>(null);
  const upd = () => {
    saveSettings();
    audio.setVolume(settings.volume);
    force((x) => x + 1);
  };
  const c = settings.crosshair;

  useEffect(() => {
    if (!binding) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') settings.binds[binding] = e.code;
      setBinding(null);
      upd();
    };
    const onMouse = (e: MouseEvent) => {
      e.preventDefault();
      settings.binds[binding] = `Mouse${e.button}`;
      setBinding(null);
      upd();
    };
    const onWheel = (e: WheelEvent) => {
      settings.binds[binding] = e.deltaY > 0 ? 'WheelDown' : 'WheelUp';
      setBinding(null);
      upd();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('wheel', onWheel, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('wheel', onWheel, true);
    };
  }, [binding]);

  const importCode = () => {
    try {
      const x = decodeCrosshairShareCode(code.trim()) as unknown as Record<string, number | boolean>;
      const n = (k: string, d = 0) => (typeof x[k] === 'number' ? (x[k] as number) : d);
      const b = (k: string) => Boolean(x[k]);
      c.size = n('length', c.size);
      c.gap = n('gap', c.gap);
      c.thickness = Math.max(0.5, n('thickness', c.thickness));
      c.r = n('red', c.r);
      c.g = n('green', c.g);
      c.b = n('blue', c.b);
      c.alpha = n('alpha', 255) || 255;
      c.dot = b('centerDotEnabled');
      c.tStyle = b('tStyleEnabled');
      c.outline = b('outlineEnabled') || n('outlineMode') > 0 || b('drawOutline');
      c.outlineThickness = Math.max(1, Math.round(n('outline', 1)));
      c.followRecoil = b('followRecoil');
      const style = n('style', 4);
      c.style = style === 2 || style === 3 ? 'dynamic' : 'static';
      setCodeErr('');
      upd();
    } catch {
      setCodeErr(tr.invalidCode);
    }
  };

  return (
    <div class="overlay">
      <div class="panel settings-panel wide">
        <div class="panel-title">{tr.settings}</div>
        <div class="tabs">
          {(
            [
              ['game', tr.sGame],
              ['video', tr.sVideo],
              ['audio', tr.sAudio],
              ['crosshair', tr.sCrosshair],
              ['viewmodel', tr.sViewmodel],
              ['controls', tr.sControls],
            ] as [Tab, string][]
          ).map(([k, l]) => (
            <button key={k} class={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>
        <div class="tab-body">
          {tab === 'game' && (
            <>
              <Slider label={tr.sensitivity} value={settings.sensitivity} min={0.1} max={8} step={0.01} onChange={(v) => ((settings.sensitivity = v), upd())} />
              <Slider label={tr.zoomSensitivity} value={settings.zoomSensitivity} min={0.1} max={3} step={0.01} onChange={(v) => ((settings.zoomSensitivity = v), upd())} />
              <Check label={tr.invertY} value={settings.invertY} onChange={(v) => ((settings.invertY = v), upd())} />
              <Check label={tr.rawInput} value={settings.rawInput} onChange={(v) => ((settings.rawInput = v), upd())} />
              <div class="hint">CS2'deki "sensitivity" değerinin aynısını gir: aynı fare hareketi aynı dönüşü verir (m_yaw 0.022).</div>
            </>
          )}
          {tab === 'video' && (
            <>
              <label class="row">
                <span>{tr.quality}</span>
                <select value={settings.quality} onChange={(e) => ((settings.quality = (e.target as HTMLSelectElement).value as typeof settings.quality), upd())}>
                  <option value="low">{tr.qLow}</option>
                  <option value="medium">{tr.qMedium}</option>
                  <option value="high">{tr.qHigh}</option>
                </select>
              </label>
              <div class="hint">Kalite değişikliği sayfa yenilenince uygulanır.</div>
              <Slider label={tr.renderScale} value={settings.renderScale} min={0.5} max={1.5} step={0.05} onChange={(v) => ((settings.renderScale = v), upd(), window.dispatchEvent(new Event('resize')))} />
              <Slider label={tr.brightness} value={settings.brightness} min={0.6} max={1.6} step={0.02} onChange={(v) => ((settings.brightness = v), upd())} />
              <Check label={tr.showFps} value={settings.showFps} onChange={(v) => ((settings.showFps = v), upd())} />
              <Check label={tr.netGraph} value={settings.netGraph} onChange={(v) => ((settings.netGraph = v), upd())} />
            </>
          )}
          {tab === 'audio' && <Slider label={tr.volume} value={settings.volume} min={0} max={1} step={0.01} onChange={(v) => ((settings.volume = v), upd())} />}
          {tab === 'crosshair' && (
            <div class="ch-layout">
              <div class="ch-controls">
                <label class="row">
                  <span>{tr.crosshairCode}</span>
                  <input class="code" placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
                  <button class="btn small" onClick={importCode}>
                    {tr.importCode}
                  </button>
                </label>
                {codeErr && <div class="err">{codeErr}</div>}
                <label class="row">
                  <span>{tr.chStyle}</span>
                  <select value={c.style} onChange={(e) => ((c.style = (e.target as HTMLSelectElement).value as CrosshairSettings['style']), upd())}>
                    <option value="static">{tr.chStatic}</option>
                    <option value="dynamic">{tr.chDynamic}</option>
                  </select>
                </label>
                <Slider label={tr.chSize} value={c.size} min={0} max={10} step={0.1} onChange={(v) => ((c.size = v), upd())} />
                <Slider label={tr.chGap} value={c.gap} min={-5} max={5} step={0.1} onChange={(v) => ((c.gap = v), upd())} />
                <Slider label={tr.chThickness} value={c.thickness} min={0.5} max={5} step={0.1} onChange={(v) => ((c.thickness = v), upd())} />
                <Check label={tr.chOutline} value={c.outline} onChange={(v) => ((c.outline = v), upd())} />
                <Check label={tr.chDot} value={c.dot} onChange={(v) => ((c.dot = v), upd())} />
                <Check label={tr.chTStyle} value={c.tStyle} onChange={(v) => ((c.tStyle = v), upd())} />
                <Check label={tr.chFollowRecoil} value={c.followRecoil} onChange={(v) => ((c.followRecoil = v), upd())} />
                <label class="row">
                  <span>{tr.chColor}</span>
                  <input
                    type="color"
                    value={`#${[c.r, c.g, c.b].map((x) => x.toString(16).padStart(2, '0')).join('')}`}
                    onInput={(e) => {
                      const v = (e.target as HTMLInputElement).value;
                      c.r = parseInt(v.slice(1, 3), 16);
                      c.g = parseInt(v.slice(3, 5), 16);
                      c.b = parseInt(v.slice(5, 7), 16);
                      upd();
                    }}
                  />
                </label>
                <Slider label={tr.chAlpha} value={c.alpha} min={0} max={255} step={1} onChange={(v) => ((c.alpha = v), upd())} />
              </div>
              <CrosshairPreview c={{ ...c }} />
            </div>
          )}
          {tab === 'viewmodel' && (
            <>
              <Slider label={tr.vmFov} value={settings.viewmodelFov} min={54} max={68} step={1} onChange={(v) => ((settings.viewmodelFov = v), upd())} />
              <Slider label={tr.vmX} value={settings.viewmodelX} min={-2.5} max={2.5} step={0.1} onChange={(v) => ((settings.viewmodelX = v), upd())} />
              <Slider label={tr.vmY} value={settings.viewmodelY} min={-2} max={2} step={0.1} onChange={(v) => ((settings.viewmodelY = v), upd())} />
              <Slider label={tr.vmZ} value={settings.viewmodelZ} min={-2} max={2} step={0.1} onChange={(v) => ((settings.viewmodelZ = v), upd())} />
              <Check label={tr.vmBob} value={settings.viewmodelBob} onChange={(v) => ((settings.viewmodelBob = v), upd())} />
            </>
          )}
          {tab === 'controls' && (
            <div class="binds">
              {Object.keys(DEFAULT_BINDS).map((a) => (
                <div key={a} class="bind-row">
                  <span>{tr.bindNames[a] ?? a}</span>
                  <button class={`btn small ${binding === a ? 'wait' : ''}`} onClick={() => setBinding(a)}>
                    {binding === a ? tr.pressKey : keyName(settings.binds[a] ?? '')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div class="btn-row">
          <button
            class="btn"
            onClick={() => {
              resetSettings();
              upd();
            }}
          >
            {tr.resetDefaults}
          </button>
          <button class="btn primary" onClick={onClose}>
            {tr.close}
          </button>
        </div>
      </div>
    </div>
  );
}

export function closeSettings(game: { syncInputState(): void }) {
  ui.settingsOpen.value = false;
  game.syncInputState();
}
