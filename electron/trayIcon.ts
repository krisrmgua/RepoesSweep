import fs from "node:fs";
import { nativeImage } from "electron";
import { assetPath } from "./paths";

type NativeImage = Electron.NativeImage;
type Rgb = [number, number, number];

export const CLEAN_GREEN: Rgb = [33, 191, 107];
export const IDLE_GRAY: Rgb = [194, 199, 209];
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

function loadLayer(name: string): NativeImage | null {
  const file = assetPath("mark", `${name}.png`);
  if (!fs.existsSync(file)) return null;
  const img = nativeImage.createFromPath(file);
  return img.isEmpty() ? null : img;
}

/**
 * Tints `layer` by its alpha and draws it over `canvas` (premultiplied BGRA, the
 * platform-native order nativeImage bitmaps use on macOS and Windows).
 */
function paint(
  canvas: Buffer,
  cw: number,
  layer: Buffer,
  lw: number,
  lh: number,
  ox: number,
  oy: number,
  [r, g, b]: Rgb,
): void {
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      const si = (y * lw + x) * 4;
      const a = layer[si + 3] / 255;
      if (a === 0) continue;
      const di = ((y + oy) * cw + (x + ox)) * 4;
      const inv = 1 - a;
      canvas[di] = Math.round(b * a + canvas[di] * inv);
      canvas[di + 1] = Math.round(g * a + canvas[di + 1] * inv);
      canvas[di + 2] = Math.round(r * a + canvas[di + 2] * inv);
      canvas[di + 3] = Math.round(255 * a + canvas[di + 3] * inv);
    }
  }
}

/**
 * Bolt, diamond, and tail: wings in `wing`, black outline and check, diamond in
 * `diamond`. `heightPx` is the pixel height; `square` pads to a square canvas
 * (Windows tray icons are square).
 */
function composeMark(
  wing: Rgb,
  diamond: Rgb,
  heightPx: number,
  scaleFactor: number,
  square: boolean,
): NativeImage | null {
  const wings = loadLayer("RepoesSweepWings");
  const gem = loadLayer("RepoesSweepDiamond");
  if (!wings || !gem) return null;
  const size = wings.getSize();
  const ratio = size.height > 0 ? size.width / size.height : 1.4;
  let lw = Math.round(heightPx * ratio);
  let lh = heightPx;
  if (square && lw > heightPx) {
    lw = heightPx;
    lh = Math.max(1, Math.round(heightPx / ratio));
  }
  const cw = square ? heightPx : lw;
  const ch = square ? heightPx : lh;
  const ox = Math.floor((cw - lw) / 2);
  const oy = Math.floor((ch - lh) / 2);
  const canvas = Buffer.alloc(cw * ch * 4);
  const layers: [NativeImage | null, Rgb][] = [
    [wings, wing],
    [loadLayer("RepoesSweepDiamondOutline"), BLACK],
    [gem, diamond],
    [loadLayer("RepoesSweepCheck"), BLACK],
  ];
  for (const [img, color] of layers) {
    if (!img) continue;
    const bmp = img.resize({ width: lw, height: lh, quality: "best" }).toBitmap();
    if (bmp.length !== lw * lh * 4) continue;
    paint(canvas, cw, bmp, lw, lh, ox, oy, color);
  }
  return nativeImage.createFromBitmap(canvas, { width: cw, height: ch, scaleFactor });
}

function fallbackCircle(diamond: Rgb, px: number, scaleFactor: number): NativeImage {
  const canvas = Buffer.alloc(px * px * 4);
  const c = (px - 1) / 2;
  const radius = px / 2 - 1;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      if ((x - c) ** 2 + (y - c) ** 2 > radius ** 2) continue;
      const i = (y * px + x) * 4;
      canvas[i] = diamond[2];
      canvas[i + 1] = diamond[1];
      canvas[i + 2] = diamond[0];
      canvas[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(canvas, { width: px, height: px, scaleFactor });
}

/**
 * Menu-bar / tray image at 2x. Wings follow the bar (`darkBar` = light wings);
 * the diamond is green only when `clean`.
 */
export function createTrayIcon(clean: boolean, darkBar: boolean): NativeImage {
  const diamond = clean ? CLEAN_GREEN : IDLE_GRAY;
  const wing = darkBar ? WHITE : BLACK;
  const win = process.platform === "win32";
  const px = win ? 32 : 36;
  return composeMark(wing, diamond, px, 2, win) ?? fallbackCircle(diamond, px, 2);
}

const headerCache = new Map<boolean, string | null>();

/** Header mark for the panel: white wings on the dark background. */
export function headerMarkDataUrl(clean: boolean): string | null {
  if (!headerCache.has(clean)) {
    const img = composeMark(WHITE, clean ? CLEAN_GREEN : IDLE_GRAY, 44, 1, false);
    headerCache.set(clean, img ? img.toDataURL() : null);
  }
  return headerCache.get(clean) ?? null;
}
