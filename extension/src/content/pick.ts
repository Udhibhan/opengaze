// Finding and activating the page's interactive elements near a gaze fixation.

const CLICKABLE = [
  'a[href]',
  'button',
  'input:not([type=hidden])',
  'textarea',
  'select',
  'summary',
  'label[for]',
  '[role=button]',
  '[role=link]',
  '[role=tab]',
  '[role=menuitem]',
  '[role=checkbox]',
  '[role=radio]',
  '[role=option]',
  '[role=switch]',
  '[onclick]',
  '[contenteditable=""]',
  '[contenteditable=true]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface Candidate {
  el: HTMLElement;
  rect: DOMRect;
  /** Distance from the fixation to the element's box (0 = inside). */
  dist: number;
}

function rectDist(r: DOMRect, x: number, y: number) {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

function visible(el: HTMLElement, r: DOMRect): boolean {
  if (r.width < 6 || r.height < 6) return false;
  if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.pointerEvents !== 'none' && +cs.opacity > 0.05;
}

/** True if the element (or something inside it) is what's actually on top at its centre. */
function onTop(el: HTMLElement, r: DOMRect): boolean {
  const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
  const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
  const top = document.elementFromPoint(x, y);
  return !!top && (top === el || el.contains(top) || top.contains(el));
}

/** Interactive elements within `radius` px of (x, y), nearest first, de-duplicated (outermost clickable wins). */
export function candidatesNear(x: number, y: number, radius: number, overlay: Element): Candidate[] {
  const out: Candidate[] = [];
  for (const node of document.querySelectorAll<HTMLElement>(CLICKABLE)) {
    if (overlay.contains(node)) continue;
    const r = node.getBoundingClientRect();
    const d = rectDist(r, x, y);
    if (d > radius || !visible(node, r)) continue;
    out.push({ el: node, rect: r, dist: d });
  }
  // Drop elements nested inside another candidate (e.g. a span[tabindex] inside a link).
  const filtered = out.filter((c) => !out.some((o) => o !== c && o.el.contains(c.el)));
  const cx = (c: Candidate) => Math.hypot(c.rect.left + c.rect.width / 2 - x, c.rect.top + c.rect.height / 2 - y);
  filtered.sort((a, b) => a.dist - b.dist || cx(a) - cx(b));
  return filtered.filter((c) => onTop(c.el, c.rect)).slice(0, 12);
}

export function isEditable(el: Element): el is HTMLElement {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    const t = el.type.toLowerCase();
    return (
      !el.readOnly && !el.disabled && ['text', 'search', 'email', 'url', 'tel', 'number', 'password', ''].includes(t)
    );
  }
  return (el as HTMLElement).isContentEditable;
}

/** Short, human label for an element, for the chooser. */
export function labelFor(el: HTMLElement): string {
  const pick = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  let s =
    pick(el.getAttribute('aria-label')) ||
    pick(el.innerText) ||
    pick(el.getAttribute('title')) ||
    pick((el as HTMLInputElement).placeholder) ||
    pick(el.querySelector('img')?.getAttribute('alt')) ||
    pick((el as HTMLInputElement).value);
  if (!s && el instanceof HTMLAnchorElement) {
    try {
      s = new URL(el.href).hostname.replace(/^www\./, '');
    } catch {
      /* ignore */
    }
  }
  if (!s) s = el.tagName.toLowerCase();
  return s.length > 48 ? `${s.slice(0, 46)}…` : s;
}

/** Clicks an element the way a mouse would (pointer + mouse events, then click). */
export function clickElement(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: r.left + r.width / 2,
    clientY: r.top + r.height / 2,
    button: 0,
  };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mousedown', init));
  el.focus?.({ preventScroll: true });
  el.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mouseup', init));
  el.click();
}

/** The element that should scroll: the scrollable container under the page centre, or the document. */
export function scrollerAtCentre(overlay: Element): Element {
  let el = document.elementFromPoint(innerWidth / 2 - 70, innerHeight / 2);
  while (el && el !== document.body && el !== document.documentElement) {
    if (!overlay.contains(el)) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 4) return el;
    }
    el = el.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}
