/** Numeric bounds of the opt-in editor, not balancing or army-size limits. */
export const MAX_INTEGER = Number.MAX_SAFE_INTEGER;
const MAX_BIGINT = BigInt(MAX_INTEGER);

export function clampFinite(value, { min = 0, max = Number.MAX_VALUE } = {}) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) throw new TypeError('Expected a numeric value');
  return Math.max(min, Math.min(max, numeric));
}

export function clampInteger(value, { min = 0, max = MAX_INTEGER } = {}) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
    throw new RangeError('Integer bounds must be ordered safe integers');
  }
  if (typeof value === 'string') {
    // Do not convert decimal text to Number before truncating: just below the
    // upper bound, "9007199254740990.9" otherwise rounds up by a whole coin.
    // At most the bounded integer's digits become a BigInt; huge exponents or
    // long mantissas cannot request an enormous intermediate power/allocation.
    const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value.trim());
    if (match) {
      const whole = match[2] ?? '', fraction = match[3] ?? match[4] ?? '';
      const allDigits = whole + fraction, digits = allDigits.replace(/^0+/, '');
      if (!digits) return Math.max(min, Math.min(max, 0));
      const point = whole.length + Number(match[5] ?? 0) - (allDigits.length - digits.length);
      if (point <= 0) return Math.max(min, Math.min(max, 0));
      const negative = match[1] === '-';
      const boundDigits = String(Math.max(Math.abs(min), Math.abs(max))).length;
      if (point > boundDigits) return negative ? min : max;
      const integerText = point < digits.length ? digits.slice(0, point) : digits.padEnd(point, '0');
      const exact = BigInt(integerText) * (negative ? -1n : 1n);
      return Number(exact < BigInt(min) ? BigInt(min) : exact > BigInt(max) ? BigInt(max) : exact);
    }
    // Preserve the ordinary overflow policy for "Infinity" and JS numeric
    // forms: positive overflow clamps high, negative overflow clamps low;
    // genuinely nonnumeric text still raises the existing TypeError below.
  }
  return Math.trunc(clampFinite(value, { min, max }));
}

// BigInt is only an intermediate: persisted/rendered game values remain Numbers.
// Doing the Number addition first loses one unit close to MAX_SAFE_INTEGER.
export function safeAdd(left, right, max = MAX_INTEGER) {
  const sum = BigInt(clampInteger(left)) + BigInt(clampInteger(right));
  const limit = BigInt(clampInteger(max));
  return Number(sum > limit ? limit : sum);
}
export function safeSubtract(left, right) {
  const result = BigInt(clampInteger(left)) - BigInt(clampInteger(right));
  return Number(result < 0n ? 0n : result > MAX_BIGINT ? MAX_BIGINT : result);
}
export function safeMultiply(left, right) {
  const value = left * right;
  if (Number.isNaN(value)) return 0;
  return Math.max(-Number.MAX_VALUE, Math.min(Number.MAX_VALUE, value));
}
export function finiteAdd(left, right) {
  const value = left + right;
  if (Number.isNaN(value)) return 0;
  return Math.max(-Number.MAX_VALUE, Math.min(Number.MAX_VALUE, value));
}
export function finiteSubtract(left, right) { return finiteAdd(left, -right); }

/** Preserve the exact ordinary expression; stabilize only overflow/underflow. */
export function scaleRatio(value, previous, next) {
  const ratio = value / previous;
  const result = ratio * next;
  if (Number.isFinite(result) && (result !== 0 || value === 0 || next === 0)) return result;
  if (!(value > 0 && previous > 0 && next > 0)) return clampFinite(result);
  const logarithm = Math.log(value) - Math.log(previous) + Math.log(next);
  return clampFinite(Math.exp(logarithm));
}
