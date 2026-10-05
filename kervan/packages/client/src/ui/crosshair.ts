/** CS2 tarzı nişangah çizimi (YRES ölçeği: ekran yüksekliği / 480). */
import type { CrosshairSettings } from '../settings';

export function drawCrosshair(ctx: CanvasRenderingContext2D, cx: number, cy: number, c: CrosshairSettings, dynamicGap: number, screenH: number) {
  const yres = screenH / 480;
  const len = Math.max(0, Math.round(c.size * yres));
  const thick = Math.max(1, Math.round(c.thickness * yres));
  const gap = Math.max(0, Math.round((4 + c.gap) * yres * 0.5)) + Math.round(dynamicGap);
  const ox = Math.round(cx);
  const oy = Math.round(cy);
  const half = Math.floor(thick / 2);
  const col = `rgba(${c.r},${c.g},${c.b},${c.alpha / 255})`;
  const rects: [number, number, number, number][] = [];
  if (len > 0) {
    rects.push([ox + gap, oy - half, len, thick]); // sağ
    rects.push([ox - gap - len, oy - half, len, thick]); // sol
    rects.push([ox - half, oy + gap, thick, len]); // alt
    if (!c.tStyle) rects.push([ox - half, oy - gap - len, thick, len]); // üst
  }
  if (c.dot) rects.push([ox - half, oy - half, thick, thick]);
  if (c.outline) {
    const o = Math.max(1, Math.round(c.outlineThickness));
    ctx.fillStyle = `rgba(0,0,0,${c.alpha / 255})`;
    for (const [x, y, w, h] of rects) ctx.fillRect(x - o, y - o, w + o * 2, h + o * 2);
  }
  ctx.fillStyle = col;
  for (const [x, y, w, h] of rects) ctx.fillRect(x, y, w, h);
}
