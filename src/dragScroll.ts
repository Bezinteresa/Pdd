// Mouse drag scrolls lists and pages the way a finger swipe does on a phone. Touch keeps the browser's own scrolling.
// A press that moves less than a few pixels stays an ordinary click; a drag swallows the click that would follow it.

const THRESHOLD = 6;
/** Never start a drag on things that use the pointer themselves: fields, the driving controls and the 3D view. */
const OWN_POINTER = 'input, textarea, select, [contenteditable], .control-deck, .simulator canvas, .mirrors, .ticket-image img';

function scrollable(el: Element | null, axis: 'x' | 'y'): HTMLElement | null {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue;
    const style = getComputedStyle(node), overflow = axis === 'y' ? style.overflowY : style.overflowX;
    const room = axis === 'y' ? node.scrollHeight - node.clientHeight : node.scrollWidth - node.clientWidth;
    if (room > 1 && (overflow === 'auto' || overflow === 'scroll')) return node;
  }
  const page = document.scrollingElement as HTMLElement | null;
  return page && (axis === 'y' ? page.scrollHeight > page.clientHeight + 1 : page.scrollWidth > page.clientWidth + 1) ? page : null;
}

export function enableDragScroll() {
  let drag: { x: number; y: number; targetY: HTMLElement | null; targetX: HTMLElement | null; moved: boolean } | null = null;
  window.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !(event.target instanceof Element) || event.target.closest(OWN_POINTER)) return;
    const targetY = scrollable(event.target, 'y'), targetX = scrollable(event.target, 'x');
    if (targetY || targetX) drag = { x: event.clientX, y: event.clientY, targetY, targetX, moved: false };
  });
  window.addEventListener('pointermove', event => {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < THRESHOLD) return;
    if (!drag.moved) { drag.moved = true; document.documentElement.classList.add('drag-scrolling'); }
    // Scroll along the axis the drag mostly goes, in the nearest container that can.
    if (Math.abs(dy) >= Math.abs(dx) && drag.targetY) drag.targetY.scrollTop -= dy; else if (drag.targetX) drag.targetX.scrollLeft -= dx; else if (drag.targetY) drag.targetY.scrollTop -= dy;
    drag.x = event.clientX; drag.y = event.clientY;
    window.getSelection()?.removeAllRanges();
  });
  const end = () => {
    if (drag?.moved) {
      // The click after a drag must not press the button the drag started on.
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    }
    drag = null; document.documentElement.classList.remove('drag-scrolling');
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}
function swallow(event: Event) { event.stopPropagation(); event.preventDefault(); }
