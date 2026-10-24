/** Gesture threshold is in CSS pixels, independent of DPR and world zoom. */
export function beginPointerDrag(event, point) {
  return { pointerId: event.pointerId, previous: point,
    clientX: event.clientX, clientY: event.clientY, active: event.button !== 0 };
}
export function advancePointerDrag(drag, event, point) {
  if (!drag || drag.pointerId !== event.pointerId || !point) return null;
  if (!drag.active) {
    if (Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 5) return null;
    drag.active = true;
  }
  const result = { x: point.x - drag.previous.x, y: point.y - drag.previous.y, pivot: drag.previous };
  drag.previous = point;
  return result;
}
