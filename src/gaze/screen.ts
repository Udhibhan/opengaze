// Converting between a page's viewport (CSS px) and screen coordinates, so a calibration done in one tab
// can be used in any other tab or window. Small residual offsets are absorbed by drift correction.

export interface ViewportFrame {
  /** Screen position (DIP) of the viewport's top-left corner. */
  left: number;
  top: number;
  /** Screen DIPs per CSS px in this page (page zoom). */
  scale: number;
}

/** Best estimate of where this page's viewport sits on screen. `baseDpr` is the calibration page's devicePixelRatio. */
export function viewportFrame(baseDpr = window.devicePixelRatio): ViewportFrame {
  const scale = window.devicePixelRatio / baseDpr || 1;
  const innerW = window.innerWidth * scale;
  const innerH = window.innerHeight * scale;
  const border = Math.max(0, (window.outerWidth - innerW) / 2);
  return {
    left: window.screenX + border,
    top: window.screenY + Math.max(0, window.outerHeight - innerH - border),
    scale,
  };
}

export function clientToScreen(x: number, y: number, f: ViewportFrame): [number, number] {
  return [f.left + x * f.scale, f.top + y * f.scale];
}

export function screenToClient(x: number, y: number, f: ViewportFrame): [number, number] {
  return [(x - f.left) / f.scale, (y - f.top) / f.scale];
}
