// OpenGaze content script: eye control for any website.
// Gaze features stream in from the extension's offscreen sensor page; this script maps them to the page,
// smooths them, and lets the user dwell to click links/buttons, type into fields, scroll, go back and pause.
import { predict } from '../../src/gaze/ridge';
import { GazeSmoother } from '../../src/gaze/oneEuro';
import { DriftCorrector } from '../../src/gaze/drift';
import { HEAD_LIMITS, type HeadPose } from '../../src/gaze/features';
import { screenToClient, viewportFrame } from '../../src/gaze/screen';
import { HEAD_RANGES, headToScreen, NeutralCapture, Steady, type HeadRange, type Tilt } from '../../src/gaze/head';
import { predictWords } from '../../src/lib/predict';
import type { StoredCalibration } from '../../src/lib/extensionBridge';
import { GAZE_PORT, type FrameMsg } from './protocol';
import { buildUi, drawFace, drawRing, h, tileEl, type Tile, type Ui } from './content/ui';
import { candidatesNear, clickElement, isEditable, labelFor, scrollerAtCentre, type Candidate } from './content/pick';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const KEYS = 'etaoinshrdlucmwfgypbvkjxqz'.split('').concat(['.', ',', '?', "'"]);

type Anchor = { kind: 'tile'; tile: Tile } | { kind: 'point'; x: number; y: number };

// Don't run inside the OpenGaze app itself (it has its own gaze UI), or in frames.
if (window.top === window && !document.querySelector('meta[name="opengaze-app"]')) start();

function start() {
  // An extension update/reload leaves the previous content script orphaned in open tabs: replace its overlay.
  document.getElementById('opengaze-overlay')?.remove();
  let calib: StoredCalibration | null = null;
  let enabled = false;
  let dwellMs = 1000;
  /** 'head' = head pointer (default, no calibration needed); 'eyes' = calibrated eye gaze. */
  let pointer: 'head' | 'eyes' = 'head';
  let headRange: HeadRange = 'medium';
  let neutral: Tilt | null = null;
  let capture: NeutralCapture | null = null;
  let mountedMode: 'head' | 'eyes' | null = null;
  const steady = new Steady(6);
  let ui: Ui | null = null;
  let port: chrome.runtime.Port | null = null;
  let retry = 0;

  // Gaze pipeline state.
  const smoother = new GazeSmoother();
  const drift = new DriftCorrector();
  let trail: { t: number; x: number; y: number }[] = [];
  let smooth: [number, number] | null = null;
  let lastT = 0;
  let faceLostSince: number | null = null;
  let headOutSince: number | null = null;
  let paused = false;

  // Selection state.
  let anchor: Anchor | null = null;
  let progressMs = 0;
  let lock: Anchor | null = null;
  let lockLeftAt: number | null = null;
  let cooldownUntil = 0;
  let cands: Candidate[] = [];
  let candsAt = 0;
  let hoverEl: HTMLElement | null = null;
  /** New UI appeared under the gaze: nothing may fire until the gaze moves away from this point. */
  let holdUntilMoved: [number, number] | null = null;

  // Tiles: the dock is always active; a modal (chooser) replaces everything; the keyboard adds its keys.
  let dockTiles: Tile[] = [];
  let kbTiles: Tile[] = [];
  let modalTiles: Tile[] | null = null;
  let kbTarget: HTMLElement | null = null;
  let pauseTile: Tile | null = null;
  let toastTimer = 0;

  // ---------- settings / lifecycle ----------

  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };

  async function load() {
    const s = (await chrome.storage.local.get(['enabled', 'calibration', 'dwellMs', 'pointer', 'headRange'])) as {
      enabled?: boolean;
      calibration?: StoredCalibration;
      dwellMs?: number;
      pointer?: 'head' | 'eyes';
      headRange?: HeadRange;
    };
    enabled = !!s.enabled;
    calib = s.calibration ?? null;
    dwellMs = s.dwellMs ?? 1000;
    pointer = s.pointer ?? 'head';
    headRange = s.headRange ?? 'medium';
    apply();
  }

  function apply() {
    if (enabled && (pointer === 'head' || calib)) {
      if (ui && mountedMode !== pointer) teardown();
      if (!ui) mountUi();
      // Calm filtering: head movement is continuous (no saccades to snap to); eye gaze keeps saccade snapping.
      if (pointer === 'head') smoother.configure({ minCutoff: 0.35, beta: 0.003, saccadePx: 1e6 });
      else smoother.configure({ minCutoff: 0.4, beta: 0.003, saccadePx: Math.max(140, calib?.accuracy?.p95Px ?? 160) });
      steady.px = pointer === 'head' ? 6 : 4;
      if (pointer === 'head' && !neutral && !capture) startCapture();
      connect();
    } else teardown();
  }

  function connect() {
    if (port || !enabled || (pointer === 'eyes' && !calib) || document.visibilityState !== 'visible' || !alive())
      return;
    try {
      port = chrome.runtime.connect({ name: GAZE_PORT });
    } catch {
      port = null;
      return;
    }
    port.onMessage.addListener((m: FrameMsg) => {
      retry = 0;
      onFrame(m);
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      port = null;
      // Extension was reloaded or removed: this script is orphaned, so take its UI down.
      if (!alive()) return teardown();
      // The sensor page may still be starting: retry with backoff.
      if (enabled) setTimeout(connect, Math.min(5000, 800 * ++retry));
    });
  }

  function teardown() {
    port?.disconnect();
    port = null;
    ui?.host.remove();
    ui = null;
    mountedMode = null;
    dockTiles = [];
    kbTiles = [];
    modalTiles = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') connect();
    else {
      port?.disconnect();
      port = null;
    }
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.enabled) enabled = !!ch.enabled.newValue;
    if (ch.calibration) {
      calib = (ch.calibration.newValue as StoredCalibration) ?? null;
      drift.reset();
      smoother.reset();
    }
    if (ch.dwellMs) dwellMs = (ch.dwellMs.newValue as number) ?? 1000;
    if (ch.pointer) pointer = (ch.pointer.newValue as 'head' | 'eyes') ?? 'head';
    if (ch.headRange) headRange = (ch.headRange.newValue as HeadRange) ?? 'medium';
    if (ch.recentreAt) startCapture();
    apply();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (modalTiles || kbTarget)) {
      closeChooser();
      closeKeyboard();
    }
  });

  // ---------- UI ----------

  function makeTile(el: HTMLElement, t: Omit<Tile, 'el'>): Tile {
    const tile: Tile = { el, ...t };
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!tile.continuous) tile.action();
    });
    return tile;
  }

  function mountUi() {
    ui = buildUi();
    mountedMode = pointer;
    const dockH = clamp((innerHeight - 140) / (pointer === 'head' ? 6.4 : 5.4), 64, 96);
    const mk = (label: string, sub: string, t: Omit<Tile, 'el'>, cls = '') => {
      const el = tileEl(label, sub, cls);
      el.style.height = `${dockH}px`;
      ui!.dock.append(el);
      const tile = makeTile(el, t);
      dockTiles.push(tile);
      return tile;
    };
    const scroll = (dir: number) => {
      let held = 0;
      return (dt: number) => {
        held += dt;
        const speed = 300 + Math.min(600, held * 400);
        scrollerAtCentre(ui!.host).scrollBy({ top: dir * speed * dt });
      };
    };
    const upScroll = scroll(-1);
    const downScroll = scroll(1);
    mk('▲ Scroll up', 'look to scroll', { action: () => {}, continuous: upScroll });
    mk('▼ Scroll down', 'look to scroll', { action: () => {}, continuous: downScroll });
    mk('← Back', '', { action: () => window.history.back() });
    mk('Keyboard', '', {
      action: () => {
        if (kbTarget) return closeKeyboard();
        const a = deepActive();
        if (a && isEditable(a)) openKeyboard(a);
        else toast('Look at a text box first, then choose Keyboard');
      },
    });
    if (pointer === 'head') mk('Re-centre', 'look at middle', { action: startCapture });
    pauseTile = mk('Pause', 'look 2 s', {
      action: () => {
        paused = !paused;
        renderPause();
        toast(paused ? 'Eye control paused. Look at Resume for 2 s to continue.' : 'Eye control resumed');
      },
      dwellMs: 2000,
      pauseSafe: true,
    });
  }

  function renderPause() {
    if (!pauseTile || !ui) return;
    pauseTile.el.firstChild!.textContent = paused ? 'Resume' : 'Pause';
    pauseTile.el.classList.toggle('primary', paused);
    for (const t of dockTiles) if (t !== pauseTile) t.el.classList.toggle('dim', paused);
  }

  function toast(text: string, ms = 2600) {
    if (!ui) return;
    ui.toast.textContent = text;
    ui.toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => ui && (ui.toast.style.display = 'none'), ms);
  }

  function flash(el: HTMLElement) {
    if (!ui) return;
    const r = el.getBoundingClientRect();
    const o = ui.outline;
    Object.assign(o.style, {
      display: 'block',
      left: `${r.left - 4}px`,
      top: `${r.top - 4}px`,
      width: `${r.width + 8}px`,
      height: `${r.height + 8}px`,
      borderColor: '#78dea8',
    });
    setTimeout(() => (o.style.borderColor = '#f5b248'), 400);
  }

  // ---------- chooser (several small targets close together) ----------

  function openChooser(items: { label: string; sub?: string; run: () => void; el?: HTMLElement }[]) {
    if (!ui) return;
    closeChooser();
    ui.scrim.style.display = 'block';
    ui.chooser.style.display = 'grid';
    modalTiles = [];
    items.forEach((it, i) => {
      const el = h('div', 'tile');
      el.setAttribute('role', 'button');
      el.append(h('span', 'num', String(i + 1)), h('span', '', it.label));
      if (it.sub) el.append(h('small', '', it.sub));
      ui!.chooser.append(el);
      modalTiles!.push(
        makeTile(el, {
          action: () => {
            closeChooser();
            it.run();
          },
        }),
      );
      if (it.el) {
        const r = it.el.getBoundingClientRect();
        const b = h('div', 'badge', String(i + 1));
        b.style.left = `${clamp(r.left - 8, 0, innerWidth - 30)}px`;
        b.style.top = `${clamp(r.top - 10, 0, innerHeight - 30)}px`;
        ui!.badges.append(b);
      }
    });
    const cancel = tileEl('Cancel', 'nothing selected', 'danger');
    ui.chooser.append(cancel);
    modalTiles.push(makeTile(cancel, { action: closeChooser }));
    resetDwell();
    holdGaze();
  }

  function closeChooser() {
    if (!ui) return;
    ui.chooser.replaceChildren();
    ui.badges.replaceChildren();
    ui.chooser.style.display = 'none';
    ui.scrim.style.display = 'none';
    modalTiles = null;
  }

  function chooseFrom(cs: Candidate[]) {
    openChooser(
      cs.slice(0, 5).map((c) => ({
        label: labelFor(c.el),
        sub: c.el instanceof HTMLAnchorElement ? 'link' : isEditable(c.el) ? 'text box' : '',
        el: c.el,
        run: () => activate(c.el),
      })),
    );
  }

  // ---------- activation ----------

  function deepActive(): HTMLElement | null {
    let a: Element | null = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a as HTMLElement | null;
  }

  function activate(el: HTMLElement) {
    flash(el);
    if (el instanceof HTMLSelectElement) {
      const opts = [...el.options].filter((o) => !o.disabled);
      openChooser(
        opts.slice(0, 5).map((o) => ({
          label: o.text,
          sub: o.selected ? 'current' : '',
          run: () => {
            el.value = o.value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          },
        })),
      );
      return;
    }
    if (isEditable(el)) {
      el.focus();
      openKeyboard(el);
      return;
    }
    clickElement(el);
    // Clicking a search icon or label often focuses a text box: offer the keyboard.
    setTimeout(() => {
      const a = deepActive();
      if (a && isEditable(a) && a !== kbTarget) openKeyboard(a);
    }, 150);
  }

  // ---------- keyboard ----------

  function openKeyboard(el: HTMLElement) {
    if (!ui) return;
    kbTarget = el;
    const kb = ui.kb;
    kb.replaceChildren();
    kbTiles = [];
    const H = Math.min(innerHeight * 0.5, 440);
    const rowH = (H - 20 - 4 * 8) / 5;
    const row = (cols: string) => {
      const r = h('div', 'row');
      r.style.gridTemplateColumns = cols;
      r.style.height = `${rowH}px`;
      kb.append(r);
      return r;
    };
    const add = (r: HTMLElement, label: string, action: () => void, cls = '', repeatable = false) => {
      const el = tileEl(label, '', cls);
      r.append(el);
      const t = makeTile(el, { action, repeatable });
      kbTiles.push(t);
      return t;
    };
    const predRow = row('repeat(4, 1fr) 1fr');
    const predTiles = [0, 1, 2, 3].map((i) =>
      add(
        predRow,
        '',
        () => {
          const w = predTiles[i].el.dataset.word;
          if (w) insertWord(w);
        },
        'word',
      ),
    );
    add(predRow, 'Hide keyboard', closeKeyboard, 'act');
    for (let r = 0; r < 3; r++) {
      const lr = row('repeat(10, 1fr)');
      for (const k of KEYS.slice(r * 10, r * 10 + 10)) add(lr, k, () => type(k), '', true);
    }
    const ar = row('3fr 1fr 1fr 1.4fr');
    add(ar, 'Space', () => type(' '), 'act', true);
    add(ar, 'Delete', () => del(1), 'act', true);
    add(ar, 'Delete word', delWord, 'act', true);
    add(ar, 'Enter / Search', enter, 'act primary');
    kb.style.display = 'flex';
    holdGaze();
    // Keep the text box visible above the keyboard.
    const er = el.getBoundingClientRect();
    if (er.bottom > innerHeight - H - 20) window.scrollBy({ top: er.top - innerHeight * 0.18 });
    (kb as HTMLElement & { _pred?: Tile[] })._pred = predTiles;
    updatePredictions();
  }

  function closeKeyboard() {
    if (!ui) return;
    ui.kb.style.display = 'none';
    ui.kb.replaceChildren();
    kbTiles = [];
    kbTarget = null;
  }

  function focusTarget() {
    if (kbTarget && deepActive() !== kbTarget) kbTarget.focus({ preventScroll: true });
  }

  function textBeforeCaret(): string {
    const el = kbTarget;
    if (!el) return '';
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      try {
        return el.value.slice(0, el.selectionStart ?? el.value.length);
      } catch {
        return el.value; // e.g. type=email doesn't expose selection
      }
    }
    return el.innerText ?? '';
  }

  function type(s: string) {
    focusTarget();
    document.execCommand('insertText', false, s);
    updatePredictions();
  }

  function del(n: number) {
    focusTarget();
    for (let i = 0; i < n; i++) document.execCommand('delete');
    updatePredictions();
  }

  function delWord() {
    const t = textBeforeCaret();
    const m = t.match(/\S*\s*$/);
    del(Math.max(1, m ? m[0].length : 1));
  }

  function insertWord(w: string) {
    const t = textBeforeCaret();
    const partial = /\s$/.test(t) ? '' : (t.match(/\S*$/)?.[0] ?? '');
    focusTarget();
    for (let i = 0; i < partial.length; i++) document.execCommand('delete');
    document.execCommand('insertText', false, `${w} `);
    updatePredictions();
  }

  function enter() {
    const el = kbTarget;
    if (!el) return;
    focusTarget();
    if (el instanceof HTMLInputElement && el.form) {
      el.form.requestSubmit();
      closeKeyboard();
      return;
    }
    if (el instanceof HTMLTextAreaElement || (el.isContentEditable && !(el instanceof HTMLInputElement))) {
      document.execCommand('insertLineBreak');
      return;
    }
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keypress', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
    closeKeyboard();
  }

  function updatePredictions() {
    if (!ui) return;
    const pred = (ui.kb as HTMLElement & { _pred?: Tile[] })._pred;
    if (!pred) return;
    const words = predictWords(textBeforeCaret(), 4);
    pred.forEach((t, i) => {
      const w = words[i] ?? '';
      t.el.firstChild!.textContent = w;
      t.el.dataset.word = w;
      t.el.setAttribute('aria-label', w || 'no prediction');
      t.el.classList.toggle('dim', !w);
    });
  }

  // ---------- gaze pipeline ----------

  function activeTiles(): Tile[] {
    if (modalTiles) return modalTiles;
    const all = [...dockTiles, ...kbTiles];
    return paused ? all.filter((t) => t.pauseSafe) : all;
  }

  function nearestTile(x: number, y: number, pad: number): Tile | null {
    let best: Tile | null = null;
    let bestD = Infinity;
    for (const t of activeTiles()) {
      const r = t.el.getBoundingClientRect();
      if (r.width < 4) continue;
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      const d = Math.hypot(dx, dy);
      if (d > pad) continue;
      const cd = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y) / Math.max(r.width, r.height);
      const score = d * 4 + cd;
      if (score < bestD) {
        bestD = score;
        best = t;
      }
    }
    return best;
  }

  function headOutside(hp: HeadPose): boolean {
    const m = calib?.headRef.mean;
    if (!m) return false;
    return (
      Math.abs(hp.tz - m.tz) > HEAD_LIMITS.tz ||
      Math.abs(hp.yaw - m.yaw) > HEAD_LIMITS.yaw ||
      Math.abs(hp.tx - m.tx) > HEAD_LIMITS.tx ||
      Math.abs(hp.pitch - m.pitch) > HEAD_LIMITS.pitch ||
      Math.abs(hp.ty - m.ty) > HEAD_LIMITS.ty
    );
  }

  /** Head pointer: capture a new centre pose while the user looks at the middle of the screen. */
  function startCapture() {
    if (pointer !== 'head') return;
    capture = new NeutralCapture(20);
    resetDwell();
    toast('Look at the middle of the screen and hold still…', 1500);
  }

  function holdGaze() {
    holdUntilMoved = smooth ? [smooth[0], smooth[1]] : null;
    progressMs = 0;
  }

  function resetDwell() {
    anchor = null;
    progressMs = 0;
    cands = [];
  }

  function setHover(el: HTMLElement | null) {
    if (hoverEl === el) return;
    hoverEl?.classList.remove('hover');
    el?.classList.add('hover');
    hoverEl = el;
  }

  function onFrame(m: FrameMsg) {
    if (!ui || (pointer === 'eyes' && !calib)) return;
    const t = performance.now();
    const dt = lastT ? clamp((t - lastT) / 1000, 0.001, 0.2) : 1 / 30;
    lastT = t;
    if (!document.hasFocus()) {
      ui.cursor.style.opacity = '0';
      drawRing(ui.ring, 0, 0, 0, 0, 0);
      return;
    }
    drift.decay(dt);

    // Face / head checks.
    const home = (pointer === 'eyes' && calib?.headRef.nose) || { x: 0.5, y: 0.5 };
    if (!m.face || !m.v) {
      faceLostSince ??= t;
      drawFace(ui.face, null, home, false);
      if (t - faceLostSince > 300) {
        resetDwell();
        ui.cursor.style.opacity = '0';
        drawRing(ui.ring, 0, 0, 0, 0, 0);
        if (t - faceLostSince > 1500) toast("I can't see your face. Nothing will be clicked until you're back.", 1200);
      }
      return;
    }
    faceLostSince = null;
    let headOut = false;
    if (pointer === 'eyes' && m.head && headOutside(m.head)) {
      headOutSince ??= t;
      headOut = t - headOutSince > 400;
    } else headOutSince = null;
    const ratioOk = m.eyeRatio === undefined || (m.eyeRatio > 0.085 && m.eyeRatio < 0.3);
    const centred = !!m.nose && Math.abs(m.nose.x - home.x) < 0.07 && Math.abs(m.nose.y - home.y) < 0.08;
    drawFace(ui.face, m.nose ?? null, home, !headOut && ratioOk && centred);
    if (headOut) {
      toast('Gently move your head back to where it was during calibration', 1000);
      resetDwell();
    }

    const closed = pointer === 'eyes' && Math.min(m.blinkL ?? 0, m.blinkR ?? 0) > 0.55;
    let raw: [number, number] | null = null;
    if (pointer === 'head') {
      if (!m.tilt) return;
      if (capture) {
        const n = capture.add(m.tilt);
        ui.cursor.style.opacity = '0';
        if (!n) return;
        neutral = n;
        capture = null;
        smoother.reset();
        steady.reset();
        drift.reset();
        toast('Centred. Turn or tilt your head gently to move the pointer.', 2200);
      }
      if (!neutral) return;
      raw = headToScreen(m.tilt, neutral, HEAD_RANGES[headRange], innerWidth, innerHeight);
    } else if (!closed && calib) {
      // Eye gaze: model (calibration-page CSS px) -> screen -> this page's CSS px.
      const [px, py] = predict(calib.model, m.v);
      raw = screenToClient(
        calib.frame.left + px * calib.frame.scale,
        calib.frame.top + py * calib.frame.scale,
        viewportFrame(calib.dpr),
      );
    }
    if (raw) {
      trail.push({ t, x: raw[0], y: raw[1] });
      trail = trail.filter((p) => t - p.t < 400);
      const [rx, ry] = drift.apply(raw[0], raw[1]);
      const [sx, sy] = smoother.update(clamp(rx, -40, innerWidth + 40), clamp(ry, -40, innerHeight + 40), dt);
      smooth = steady.update(sx, sy);
    }
    if (!smooth) return;
    step(t, dt, headOut, closed);
  }

  function step(t: number, dt: number, blocked: boolean, closed: boolean) {
    if (!ui || !smooth) return;
    const [x, y] = smooth;
    // Pointer precision: a head pointer is steady and precise; eye gaze uses its measured error.
    const p95 = pointer === 'head' ? 60 : (calib?.accuracy?.p95Px ?? 160);
    const R = clamp(0.45 * p95, 35, 90); // fixation radius
    const R2 = clamp(0.9 * p95, 40, 160); // candidate search radius
    const pad = clamp(0.5 * p95, 16, 70); // tile padding

    const tile = blocked ? null : nearestTile(x, y, pad);
    setHover(tile?.el ?? null);

    // Cursor (magnetised toward a hovered tile).
    let cxy: [number, number] = [x, y];
    if (tile) {
      const r = tile.el.getBoundingClientRect();
      cxy = [x + (r.left + r.width / 2 - x) * 0.6, y + (r.top + r.height / 2 - y) * 0.6];
    }
    ui.cursor.style.opacity = paused ? '0.35' : '1';
    ui.cursor.style.transform = `translate(${cxy[0]}px, ${cxy[1]}px)`;

    if (blocked) {
      drawRing(ui.ring, 0, 0, 0, 0, 0);
      return;
    }

    // Midas-touch lock: after a selection, that tile/spot can't fire again until the gaze leaves it.
    if (lock) {
      const still = lock.kind === 'tile' ? tile === lock.tile : !tile && Math.hypot(x - lock.x, y - lock.y) < R * 1.2;
      if (still) lockLeftAt = null;
      else if ((lockLeftAt ??= t) && t - lockLeftAt > 200) lock = null;
    }

    // Continuous tiles (scrolling) act while looked at.
    if (tile?.continuous) {
      if (anchor?.kind === 'tile' && anchor.tile === tile) {
        progressMs += dt * 1000;
        if (progressMs > 250) tile.continuous(dt);
      } else {
        anchor = { kind: 'tile', tile };
        progressMs = 0;
      }
      drawRing(ui.ring, 0, 0, 0, 0, 0);
      ui.outline.style.display = 'none';
      return;
    }

    const pagePointsAllowed = !paused && !modalTiles;
    if (tile) {
      if (!(anchor?.kind === 'tile' && anchor.tile === tile)) {
        anchor = { kind: 'tile', tile };
        progressMs = 0;
      }
    } else if (pagePointsAllowed) {
      if (!(anchor?.kind === 'point' && Math.hypot(x - anchor.x, y - anchor.y) < R)) {
        anchor = { kind: 'point', x, y };
        progressMs = 0;
        cands = candidatesNear(x, y, R2, ui.host);
        candsAt = t;
      } else if (t - candsAt > 200) {
        cands = candidatesNear(anchor.x, anchor.y, R2, ui.host);
        candsAt = t;
      }
    } else {
      resetDwell();
    }

    const lockedHere =
      !!lock &&
      !!anchor &&
      (lock.kind === 'tile'
        ? anchor.kind === 'tile' && anchor.tile === lock.tile && !anchor.tile.repeatable
        : anchor.kind === 'point' && Math.hypot(anchor.x - lock.x, anchor.y - lock.y) < R);
    if (holdUntilMoved && Math.hypot(x - holdUntilMoved[0], y - holdUntilMoved[1]) > R) holdUntilMoved = null;
    const held = !!holdUntilMoved;
    const hasTarget = !held && (anchor?.kind === 'tile' || (anchor?.kind === 'point' && cands.length > 0));
    if (anchor && hasTarget && !closed && !lockedHere && t >= cooldownUntil) progressMs += dt * 1000;

    const need = anchor?.kind === 'tile' ? (anchor.tile.dwellMs ?? dwellMs) : dwellMs;
    const progress = hasTarget && !lockedHere ? clamp(progressMs / need, 0, 1) : 0;

    // Feedback: ring around the tile / the single clear page target, or a circle when it's ambiguous.
    const clear = cands.length === 1 || (cands.length > 1 && cands[0].dist === 0 && cands[1].dist > R2 * 0.5);
    if (anchor?.kind === 'tile') {
      const r = anchor.tile.el.getBoundingClientRect();
      drawRing(ui.ring, r.left, r.top, r.width, r.height, progress);
      ui.outline.style.display = 'none';
    } else if (anchor?.kind === 'point' && cands.length) {
      if (clear) {
        const r = cands[0].el.getBoundingClientRect();
        drawRing(ui.ring, r.left, r.top, r.width, r.height, progress);
        Object.assign(ui.outline.style, {
          display: 'block',
          left: `${r.left - 4}px`,
          top: `${r.top - 4}px`,
          width: `${r.width + 8}px`,
          height: `${r.height + 8}px`,
        });
      } else {
        drawRing(ui.ring, anchor.x, anchor.y, 0, 0, progress);
        ui.outline.style.display = 'none';
      }
    } else {
      drawRing(ui.ring, 0, 0, 0, 0, 0);
      ui.outline.style.display = 'none';
    }

    if (anchor && hasTarget && progressMs >= need && !lockedHere) fire(anchor, t, clear, R2);
  }

  function recentRaw(t: number): [number, number] | null {
    const r = trail.filter((p) => t - p.t < 350);
    if (r.length < 3) return null;
    return [r.reduce((a, p) => a + p.x, 0) / r.length, r.reduce((a, p) => a + p.y, 0) / r.length];
  }

  function fire(a: Anchor, t: number, clear: boolean, R2: number) {
    lock = a;
    lockLeftAt = null;
    cooldownUntil = t + 400;
    progressMs = 0;
    const raw = recentRaw(t);
    if (a.kind === 'tile') {
      if (raw) {
        const r = a.tile.el.getBoundingClientRect();
        drift.observe(raw[0], raw[1], r.left + r.width / 2, r.top + r.height / 2);
      }
      a.tile.action();
      if (a.tile.repeatable) lock = null;
      return;
    }
    const cs = candidatesNear(a.x, a.y, R2, ui!.host);
    if (!cs.length) return;
    if (clear || cs.length === 1) {
      const r = cs[0].rect;
      // Only learn drift from compact targets, where "looking at the centre" is a fair assumption.
      if (raw && r.width < 2.5 * R2 && r.height < 2.5 * R2)
        drift.observe(raw[0], raw[1], r.left + r.width / 2, r.top + r.height / 2);
      activate(cs[0].el);
    } else chooseFrom(cs);
  }

  void load();
}
