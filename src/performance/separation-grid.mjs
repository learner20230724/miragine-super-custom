// Separation-only spatial hash: lower-j positions do not move before their turn.
// Re-query the moving i after every push; never cache a static neighbor list.
const MAX_CELL_COORDINATE = 2 ** 40;
export class SeparationGrid {
  constructor() {
    this.columns = new Map(); this.identities = new Set(); this.x = []; this.y = []; this.list = null;
  }
  supported(x, y) {
    return Number.isFinite(x) && Number.isFinite(y)
      && Math.abs(x / this.cellSize) <= MAX_CELL_COORDINATE && Math.abs(y / this.cellSize) <= MAX_CELL_COORDINATE;
  }
  clear() {
    this.columns.clear(); this.identities.clear(); this.x.length = this.y.length = 0; this.list = null;
  }
  rebuild(list, radius) {
    this.clear(); this.cellSize = radius * 2; this.radiusSquared = radius * radius;
    for (let i = 0; i < list.length; i++) {
      const entity = list[i], x = entity.px, y = entity.py;
      if (!this.supported(x, y) || this.identities.has(entity)) { this.clear(); return false; }
      this.identities.add(entity); this.x[i] = x; this.y[i] = y;
      const cx = Math.floor(x / this.cellSize), cy = Math.floor(y / this.cellSize);
      let column = this.columns.get(cx);
      if (!column) this.columns.set(cx, column = new Map());
      let bucket = column.get(cy);
      if (!bucket) column.set(cy, bucket = []);
      bucket.push(i); // original list order, enabling upper-bound binary search
    }
    this.identities.clear(); // queries need only copied coordinates and numeric j values
    return true;
  }
  previousCollision(x, y, before) {
    const cx = Math.floor(x / this.cellSize), cy = Math.floor(y / this.cellSize);
    let best = -1;
    // Cell width is 2r, not r. Within the guarded cell-coordinate range,
    // floating-point division error cannot move a <r neighbor beyond +/-1 cell.
    for (let columnId = cx - 1; columnId <= cx + 1; columnId++) {
      const column = this.columns.get(columnId);
      if (!column) continue;
      for (let rowId = cy - 1; rowId <= cy + 1; rowId++) {
        const bucket = column.get(rowId);
        if (!bucket) continue;
        let lo = 0, hi = bucket.length;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (bucket[mid] < before) lo = mid + 1; else hi = mid; }
        for (let at = lo - 1; at >= 0; at--) {
          const j = bucket[at]; if (j <= best) break;
          const dx = x - this.x[j], dy = y - this.y[j];
          if (dx * dx + dy * dy < this.radiusSquared) { best = j; break; }
        }
      }
    }
    return best;
  }
}
