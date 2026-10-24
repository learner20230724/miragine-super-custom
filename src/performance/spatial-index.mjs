// Exact broad-phase acceleration, not a different simulation. Original arithmetic,
// target-list tie order and reverse separation order remain the narrow phase.
const LIMIT = 1e100;
const LEAF_SIZE = 8;
const coordinate = value => Number.isFinite(value) && Math.abs(value) <= LIMIT;
const compareEntry = (a, b, axis) => a[axis] - b[axis] || a.order - b.order;

/** Reusable dynamic bounding-volume hierarchy. It never reorders the source list. */
export class SpatialIndex {
  constructor() {
    this.entries = []; this.nodes = []; this.byEntity = new Map();
    this.root = null; this.valid = false;
  }
  rebuild(list) {
    this.valid = true; this.byEntity.clear(); this.age = 0;
    this.best = null;
    for (let i = 0; i < list.length; i++) {
      const entity = list[i], entry = this.entries[i] ??= {};
      entry.entity = entity; entry.order = i; entry.x = entity.px; entry.y = entity.py;
      if (!coordinate(entity.px) || !coordinate(entity.py) || this.byEntity.has(entity)) this.valid = false;
      this.byEntity.set(entity, entry);
    }
    this.entries.length = list.length;
    if (!this.valid || !list.length) { this.root = null; this.nodes.length = 0; return; }
    this.usedNodes = 0;
    this.root = this.build(0, list.length, null, 0);
    // Do not retain obsolete units in spare nodes after a clear or a new round.
    this.nodes.length = this.usedNodes;
  }
  clear() { this.rebuild([]); }
  /** Refit the previous hierarchy in O(n) while membership/order is unchanged.
   * Periodic rebuilding improves partitions, but never affects query results. */
  synchronize(list) {
    if (!this.valid || list.length !== this.entries.length || this.age >= 30) return this.rebuild(list);
    this.best = null;
    for (let i = 0; i < list.length; i++) {
      const entity = list[i], entry = this.byEntity.get(entity);
      if (!entry || entry.order !== i || !coordinate(entity.px) || !coordinate(entity.py)) return this.rebuild(list);
      entry.x = entity.px; entry.y = entity.py;
    }
    // Parents are allocated before their children, so reverse order is bottom-up.
    for (let i = this.nodes.length - 1; i >= 0; i--) this.refit(this.nodes[i]);
    this.age++;
  }
  partition(start, end, nth, axis) {
    let lo = start, hi = end - 1;
    while (lo < hi) {
      const pivot = this.entries[(lo + hi) >>> 1]; let i = lo, j = hi;
      while (i <= j) {
        while (compareEntry(this.entries[i], pivot, axis) < 0) i++;
        while (compareEntry(this.entries[j], pivot, axis) > 0) j--;
        if (i <= j) { const entry = this.entries[i]; this.entries[i++] = this.entries[j]; this.entries[j--] = entry; }
      }
      if (nth <= j) hi = j; else if (nth >= i) lo = i; else break;
    }
  }
  build(start, end, parent, depth) {
    const node = this.nodes[this.usedNodes] ??= {};
    this.usedNodes++; node.parent = parent; node.start = start; node.end = end;
    node.left = node.right = null;
    if (end - start > LEAF_SIZE) {
      const mid = (start + end) >>> 1;
      this.partition(start, end, mid, depth % 2 ? 'y' : 'x');
      node.left = this.build(start, mid, node, depth + 1); node.right = this.build(mid, end, node, depth + 1);
    } else for (let i = start; i < end; i++) this.entries[i].leaf = node;
    this.refit(node); return node;
  }
  refit(node) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let minOrder = Infinity, maxOrder = -1;
    if (node.left) {
      const a = node.left, b = node.right;
      minX = Math.min(a.minX, b.minX); minY = Math.min(a.minY, b.minY);
      maxX = Math.max(a.maxX, b.maxX); maxY = Math.max(a.maxY, b.maxY);
      minOrder = Math.min(a.minOrder, b.minOrder); maxOrder = Math.max(a.maxOrder, b.maxOrder);
    } else for (let i = node.start; i < node.end; i++) {
      const entry = this.entries[i];
      minX = Math.min(minX, entry.x); minY = Math.min(minY, entry.y);
      maxX = Math.max(maxX, entry.x); maxY = Math.max(maxY, entry.y);
      minOrder = Math.min(minOrder, entry.order); maxOrder = Math.max(maxOrder, entry.order);
    }
    node.minX = minX; node.minY = minY; node.maxX = maxX; node.maxY = maxY;
    node.minOrder = minOrder; node.maxOrder = maxOrder;
  }
  update(entity) {
    const entry = this.byEntity.get(entity);
    if (!entry || !this.valid || (entry.x === entity.px && entry.y === entity.py)) return;
    if (!coordinate(entity.px) || !coordinate(entity.py)) { this.valid = false; return; }
    entry.x = entity.px; entry.y = entity.py;
    for (let node = entry.leaf; node; node = node.parent) this.refit(node);
  }
  lowerBound(node) {
    const dx = this.x < node.minX ? node.minX - this.x : this.x > node.maxX ? this.x - node.maxX : 0;
    const dy = this.y < node.minY ? node.minY - this.y : this.y > node.maxY ? this.y - node.maxY : 0;
    return dx * dx + this.weight * (dy * dy);
  }
  nearest(entity, weight) {
    if (!this.valid || !coordinate(entity.px) || !coordinate(entity.py)
      || !Number.isFinite(weight) || weight < 0 || weight > LIMIT) return undefined;
    this.x = entity.px; this.y = entity.py; this.weight = weight;
    this.best = null; this.bestScore = Number.MAX_VALUE; this.bestOrder = Infinity;
    // A previous target is only an initial bound. It receives no preferential tie.
    const previous = this.byEntity.get(entity.target);
    if (previous) this.consider(previous);
    if (this.root) this.searchNearest(this.root);
    return this.best;
  }
  consider(entry) {
    const entity = entry.entity;
    if (entity.nowHP === 0) return;
    const dx = entry.x - this.x, dy = entry.y - this.y;
    const score = dx * dx + this.weight * (dy * dy);
    if (score < this.bestScore || (this.best !== null && score === this.bestScore && entry.order < this.bestOrder)) {
      this.best = entity; this.bestScore = score; this.bestOrder = entry.order;
    }
  }
  searchNearest(node) {
    const bound = this.lowerBound(node);
    if (bound > this.bestScore || (bound === this.bestScore && node.minOrder >= this.bestOrder)) return;
    if (!node.left) {
      for (let i = node.start; i < node.end; i++) this.consider(this.entries[i]);
      return;
    }
    let first = node.left, second = node.right;
    if (this.lowerBound(second) < this.lowerBound(first)) [first, second] = [second, first];
    this.searchNearest(first); this.searchNearest(second);
  }
}

export const spatialCoordinateSupported = coordinate;
