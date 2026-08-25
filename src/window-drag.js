// Drag the window from anywhere on it.
//
// This can't use Chromium's `-webkit-app-region: drag`, which is what the top
// strip used to do: a native drag region swallows mousedown entirely, so the
// sphere's click-to-play/pause would stop working the moment the whole window
// became draggable. Instead we track the pointer ourselves and move the window
// over IPC (electron/main.cjs), which lets us tell a drag from a click —
// movement under DRAG_THRESHOLD_PX is a click and is passed through untouched.

// Enough slack that a click with a shaky hand still reads as a click, small
// enough that a deliberate drag feels immediate.
const DRAG_THRESHOLD_PX = 4;

// Controls are never drag handles — they do their own thing on click.
const CONTROL_SELECTOR = 'button, a, input, select, textarea';

export function initWindowDrag() {
  let origin = null; // pointer position when the gesture started, in screen coords
  let dragging = false;
  let suppressClick = false;

  function end() {
    if (dragging) {
      window.windowBridge?.dragEnd();
      // The pointerup after a drag would otherwise fire a click on whatever is
      // under the cursor — e.g. toggling play/pause just because the drag
      // happened to finish over the sphere.
      suppressClick = true;
    }
    origin = null;
    dragging = false;
    document.body.classList.remove('dragging');
  }

  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    if (e.target.closest?.(CONTROL_SELECTOR)) return;
    origin = { x: e.screenX, y: e.screenY };
    dragging = false;
    // Keeps pointermove/up coming even if the cursor outruns the window and
    // slips outside it mid-drag. Captured on the target element — `document`
    // itself has no setPointerCapture.
    e.target.setPointerCapture?.(e.pointerId);
  });

  document.addEventListener('pointermove', (e) => {
    if (!origin || !e.isPrimary) return;
    const dx = e.screenX - origin.x;
    const dy = e.screenY - origin.y;

    if (!dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      document.body.classList.add('dragging');
      window.windowBridge?.dragStart();
    }
    // Deltas are measured from the gesture's origin rather than accumulated
    // per-event, so the window can't drift away from the cursor.
    window.windowBridge?.dragMove(dx, dy);
  });

  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);

  // Capture phase, so this runs before the sphere's own click handler.
  document.addEventListener('click', (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.stopPropagation();
  }, true);

  return { isDragging: () => dragging };
}
