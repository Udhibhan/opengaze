// Overlay UI for the content script, isolated from the page in a shadow root.
// Every interactive piece is a "tile": a big gaze target that also responds to a carer's mouse click.

export interface Tile {
  el: HTMLElement;
  action: () => void;
  /** Fires continuously while looked at (scrolling) instead of once after a dwell. */
  continuous?: (dt: number) => void;
  dwellMs?: number;
  /** Still usable while eye control is paused. */
  pauseSafe?: boolean;
  /** May fire again without looking away (keyboard keys). */
  repeatable?: boolean;
  /** A grid-mode block of the page (big, so no drift learning; slightly longer dwell). */
  cell?: boolean;
  /** Not selectable right now (e.g. a grid block with nothing clickable in it). */
  disabled?: boolean;
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
  font: 600 18px/1.25 "Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", sans-serif; color: #f6f2e9; }
.tile { pointer-events: auto; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; border-radius: 18px; border: 2px solid #3a4e7c; background: rgba(20, 34, 70, 0.94);
  color: #f6f2e9; cursor: pointer; user-select: none; padding: 6px; transition: border-color .15s, background .15s; }
.tile.hover { border-color: #f5b248; background: rgba(29, 47, 92, 0.98); box-shadow: 0 0 0 3px rgba(245,178,72,.35); }
.tile.primary { border-color: rgba(245,178,72,.8); background: rgba(245,178,72,.18); }
.tile.danger { border-color: #f88078; }
.tile.dim { opacity: .45; }
.tile small { display: block; font-weight: 400; font-size: 12px; color: #c9d0e0; }
.dock { position: fixed; right: 10px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column;
  gap: 8px; width: 112px; }
.face { pointer-events: none; position: relative; height: 63px; border-radius: 14px; background: #000;
  border: 2px solid #3a4e7c; overflow: hidden; }
.face img, .cambig img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
.face .ov, .cambig .ov { position: absolute; inset: 0; }
.face .ov svg, .cambig .ov svg { width: 100%; height: 100%; }
.cambig { position: fixed; left: 50%; top: 70px; transform: translateX(-50%); width: 360px; border-radius: 18px;
  overflow: hidden; background: #000; border: 3px solid #f5b248; display: none; }
.cambig .frame { position: relative; width: 360px; height: 203px; }
.cambig .hint { padding: 8px 12px; background: rgba(11,21,48,.96); text-align: center; font-size: 19px; }
.gridlayer { position: fixed; inset: 0; pointer-events: none; }
.cell { position: fixed; border: 2px dashed rgba(245,178,72,.28); border-radius: 16px; display: flex;
  align-items: flex-start; justify-content: flex-end; padding: 6px; transition: background .15s, border-color .15s; }
.cell.hover { border: 3px solid #f5b248; background: rgba(245,178,72,.10); box-shadow: inset 0 0 0 2px rgba(245,178,72,.25); }
.cell.dim { border-color: rgba(160,170,190,.12); }
.cell .n { font-size: 14px; padding: 2px 8px; border-radius: 10px; background: rgba(11,21,48,.85); color: #f5b248; }
.cell.dim .n { display: none; }
.cursor { position: fixed; left: 0; top: 0; width: 28px; height: 28px; margin: -14px 0 0 -14px; border-radius: 50%;
  background: radial-gradient(circle, rgba(245,178,72,.95) 0 28%, rgba(245,178,72,.35) 45%, rgba(245,178,72,0) 70%);
  box-shadow: 0 0 22px 6px rgba(245,178,72,.35); opacity: 0; transition: opacity .2s, transform .14s ease-out; will-change: transform; }
.ring { position: fixed; left: 0; top: 0; overflow: visible; display: none; }
.ring rect, .ring circle { fill: none; stroke: #f5b248; stroke-width: 5; stroke-linecap: round; }
.ring .track { stroke: rgba(245,178,72,.25); }
.toast { position: fixed; left: 50%; top: 18px; transform: translateX(-50%); max-width: 80vw; padding: 12px 22px;
  border-radius: 16px; background: rgba(11,21,48,.96); border: 2px solid #f5b248; font-size: 20px; display: none; }
.scrim { position: fixed; inset: 0; background: rgba(5,10,25,.55); pointer-events: auto; display: none; }
.chooser { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(900px, calc(100vw - 160px));
  display: none; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.chooser .tile { min-height: 130px; font-size: 20px; flex-direction: column; gap: 4px; }
.chooser .num { width: 34px; height: 34px; border-radius: 50%; background: #f5b248; color: #1b1200;
  display: flex; align-items: center; justify-content: center; font-size: 18px; }
.badge { position: fixed; min-width: 26px; height: 26px; padding: 0 6px; border-radius: 13px; background: #f5b248;
  color: #1b1200; font-size: 15px; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 0 2px #0b1530; }
.outline { position: fixed; border: 3px solid #f5b248; border-radius: 8px; display: none; }
.kb { position: fixed; left: 10px; right: 132px; bottom: 10px; display: none; flex-direction: column; gap: 8px;
  padding: 10px; border-radius: 22px; background: rgba(11,21,48,.97); border: 2px solid #3a4e7c; }
.kb .row { display: grid; gap: 8px; }
.kb .tile { font-size: 26px; text-transform: uppercase; }
.kb .tile.word, .kb .tile.act { text-transform: none; font-size: 19px; }
`;

export interface Ui {
  host: HTMLElement;
  root: HTMLElement;
  cursor: HTMLElement;
  ring: SVGSVGElement;
  outline: HTMLElement;
  toast: HTMLElement;
  dock: HTMLElement;
  face: HTMLElement;
  faceImg: HTMLImageElement;
  faceOv: HTMLElement;
  camBig: HTMLElement;
  camBigImg: HTMLImageElement;
  camBigOv: HTMLElement;
  camBigHint: HTMLElement;
  grid: HTMLElement;
  scrim: HTMLElement;
  chooser: HTMLElement;
  badges: HTMLElement;
  kb: HTMLElement;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/**
 * @param open use an open shadow root (dev harness only). Normally it's closed so the page's own scripts
 *             can't reach into the overlay, which shows the camera thumbnail.
 */
export function buildUi(open = false): Ui {
  const host = h('div');
  host.id = 'opengaze-overlay';
  const shadow = host.attachShadow({ mode: open ? 'open' : 'closed' });
  const style = h('style');
  style.textContent = CSS;
  const root = h('div', 'root');
  shadow.append(style, root);

  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ring.classList.add('ring');
  const outline = h('div', 'outline');
  const toast = h('div', 'toast');
  const dock = h('div', 'dock');
  const face = h('div', 'face');
  const faceImg = h('img');
  faceImg.alt = '';
  const faceOv = h('div', 'ov');
  face.append(faceImg, faceOv);
  dock.append(face);
  const camBig = h('div', 'cambig');
  const camFrame = h('div', 'frame');
  const camBigImg = h('img');
  camBigImg.alt = '';
  const camBigOv = h('div', 'ov');
  const camBigHint = h('div', 'hint');
  camFrame.append(camBigImg, camBigOv);
  camBig.append(camFrame, camBigHint);
  const grid = h('div', 'gridlayer');
  const scrim = h('div', 'scrim');
  const chooser = h('div', 'chooser');
  const badges = h('div');
  const kb = h('div', 'kb');
  const cursor = h('div', 'cursor');
  root.append(grid, outline, badges, dock, kb, scrim, chooser, camBig, ring, toast, cursor);
  (document.documentElement || document.body).append(host);
  return {
    host,
    root,
    cursor,
    ring,
    outline,
    toast,
    dock,
    face,
    faceImg,
    faceOv,
    camBig,
    camBigImg,
    camBigOv,
    camBigHint,
    grid,
    scrim,
    chooser,
    badges,
    kb,
  };
}

/** Creates a tile element with a label and optional sub-label. */
export function tileEl(label: string, sub = '', cls = ''): HTMLElement {
  const t = h('div', `tile ${cls}`.trim());
  t.setAttribute('role', 'button');
  t.setAttribute('aria-label', label);
  t.append(document.createTextNode(label));
  if (sub) t.append(h('small', '', sub));
  return t;
}

/** Draws the dwell-progress ring around a rect (or a circle at a point when w/h are 0). */
export function drawRing(svg: SVGSVGElement, x: number, y: number, w: number, hgt: number, progress: number) {
  if (progress <= 0) {
    svg.style.display = 'none';
    return;
  }
  const pad = 6;
  const circle = w === 0 && hgt === 0;
  const W = circle ? 56 : w + pad * 2;
  const H = circle ? 56 : hgt + pad * 2;
  svg.style.display = 'block';
  svg.style.transform = `translate(${circle ? x - 28 : x - pad}px, ${circle ? y - 28 : y - pad}px)`;
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  const shape = circle
    ? `<circle class="track" cx="28" cy="28" r="24"/><circle cx="28" cy="28" r="24" pathLength="100"
        stroke-dasharray="${progress * 100} 100" transform="rotate(-90 28 28)"/>`
    : `<rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="12" pathLength="100"
        stroke-dasharray="${progress * 100} 100"/>`;
  if (svg.dataset.k !== shape) {
    svg.innerHTML = shape;
    svg.dataset.k = shape;
  }
}

/** Tiny face-position indicator for the dock: oval = home position, dot = nose now. */
export function drawFace(
  el: HTMLElement,
  nose: { x: number; y: number } | null,
  home: { x: number; y: number },
  good: boolean,
) {
  const col = !nose ? '#f88078' : good ? '#78dea8' : '#f5b248';
  // Mirrored so it reads like a mirror.
  const dot = nose ? `<circle cx="${(1 - nose.x) * 96}" cy="${nose.y * 54}" r="4" fill="${col}"/>` : '';
  el.innerHTML = `<svg viewBox="0 0 96 54" preserveAspectRatio="none" aria-hidden="true">
    <ellipse cx="${(1 - home.x) * 96}" cy="${home.y * 54}" rx="11" ry="16" fill="none" stroke="${col}" stroke-width="2.5"
      ${good ? '' : 'stroke-dasharray="4 3"'}/>${dot}</svg>`;
  el.title = !nose ? 'Face not visible' : good ? 'Good position' : 'Re-centre your head';
}
