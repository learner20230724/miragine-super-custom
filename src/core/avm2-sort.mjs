// SPDX-License-Identifier: MIT
// Copyright (c) 2018-2022 Ruffle LLC <ruffle@ruffle.rs> and Ruffle contributors.
// Adapted to JavaScript in 2026; see docs/licenses/Ruffle-qsort-MIT.txt.
// Upstream: Ruffle v0.7.1 core/src/avm2/globals/array.rs, qsort.
// Ruffle identifies that implementation as a port of Adobe avmplus QuickSort.

/**
 * AVM2's non-stable partition ordering is observable by the game: the renderer
 * reorders Scene's display list, which determines next-frame simulation order.
 * Native JS stable Array.sort cannot substitute for these equal-key swaps.
 * This implements the Ruffle/avmplus partition scheme on a dense array. It does
 * not implement Flash's general sortOn property coercion, flags, or sparse arrays.
 */
export function avm2QuickSort(values, compare) {
  const swap = (a, b) => {
    const temporary = values[a]; values[a] = values[b]; values[b] = temporary;
  };
  function sortRange(start, count) {
    if (count < 2) return;
    if (count === 2) {
      if (compare(values[start], values[start + 1]) > 0) swap(start, start + 1);
      return;
    }
    if (count === 3) {
      if (compare(values[start], values[start + 1]) > 0) swap(start, start + 1);
      if (compare(values[start + 1], values[start + 2]) > 0) {
        swap(start + 1, start + 2);
        if (compare(values[start], values[start + 1]) > 0) swap(start, start + 1);
      }
      return;
    }
    swap(start, start + Math.floor(count / 2));
    let left = 0, right = count;
    for (;;) {
      do { left++; } while (left < count && compare(values[start + left], values[start]) <= 0);
      do { right--; } while (right > 0 && compare(values[start + right], values[start]) >= 0);
      if (right < left) break;
      swap(start + left, start + right);
    }
    swap(start, start + right);
    const lowCount = right, highStart = start + left, highCount = count - left;
    // Preserve the upstream smaller-partition-first comparison order.
    if (lowCount < highCount) {
      sortRange(start, lowCount); sortRange(highStart, highCount);
    } else {
      sortRange(highStart, highCount); sortRange(start, lowCount);
    }
  }
  sortRange(0, values.length);
  return values;
}

/** Numeric DESCENDING ordering for the game's Number-valued py property. */
export function compareDepthDescending(a, b) {
  if (Number.isNaN(a.py)) return Number.isNaN(b.py) ? 0 : -1;
  if (Number.isNaN(b.py)) return 1;
  return a.py > b.py ? -1 : a.py < b.py ? 1 : 0;
}
