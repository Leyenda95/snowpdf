/*
 * Small polyfills for recent JavaScript built-ins that pdf.js relies on. Desktop WebView2 is
 * evergreen, but Android's System WebView can lag a year or more behind Chrome, and without these
 * opening any PDF fails ("toHex is not a function"...). Imported first by the app entry and by the
 * pdf.js worker wrapper (src/render/pdfWorker.ts). Each one is only installed when missing.
 * No DOM access here: it also runs inside workers.
 */

function define<T extends object>(target: T, name: string, value: unknown): void {
  if (name in target) return;
  Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
}

type AnyFn = (...args: unknown[]) => unknown;

// Promise.withResolvers (Chrome 119), Promise.try (Chrome 128)
define(Promise, "withResolvers", function withResolvers<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
});
define(Promise, "try", function tryFn(fn: AnyFn, ...args: unknown[]) {
  return new Promise((resolve) => resolve(fn(...args)));
});

// Map / WeakMap getOrInsert, getOrInsertComputed (upsert proposal)
for (const proto of [Map.prototype, WeakMap.prototype] as unknown as Map<unknown, unknown>[]) {
  define(proto, "getOrInsert", function getOrInsert(this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (this.has(key)) return this.get(key);
    this.set(key, value);
    return value;
  });
  define(proto, "getOrInsertComputed", function getOrInsertComputed(this: Map<unknown, unknown>, key: unknown, compute: AnyFn) {
    if (this.has(key)) return this.get(key);
    const value = compute(key);
    this.set(key, value);
    return value;
  });
}

// Math.sumPrecise: Neumaier compensated summation (pdf.js only sums byte sizes with it).
define(Math, "sumPrecise", function sumPrecise(items: Iterable<number>) {
  let sum = 0;
  let c = 0;
  for (const x of items) {
    const t = sum + x;
    c += Math.abs(sum) >= Math.abs(x) ? sum - t + x : x - t + sum;
    sum = t;
  }
  return sum + c;
});

// Set methods (Chrome 122)
define(Set.prototype, "intersection", function intersection(this: Set<unknown>, other: { has(v: unknown): boolean }) {
  const out = new Set();
  for (const v of this) if (other.has(v)) out.add(v);
  return out;
});
define(Set.prototype, "union", function union(this: Set<unknown>, other: { keys(): Iterable<unknown> }) {
  const out = new Set(this);
  for (const v of other.keys()) out.add(v);
  return out;
});
define(Set.prototype, "difference", function difference(this: Set<unknown>, other: { has(v: unknown): boolean }) {
  const out = new Set();
  for (const v of this) if (!other.has(v)) out.add(v);
  return out;
});
define(Set.prototype, "isSubsetOf", function isSubsetOf(this: Set<unknown>, other: { has(v: unknown): boolean }) {
  for (const v of this) if (!other.has(v)) return false;
  return true;
});

// Uint8Array base64 / hex (Chrome 140)
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

define(Uint8Array.prototype, "toHex", function toHex(this: Uint8Array) {
  let s = "";
  for (let i = 0; i < this.length; i++) s += this[i].toString(16).padStart(2, "0");
  return s;
});
define(Uint8Array, "fromHex", function fromHex(hex: string) {
  if (hex.length % 2 !== 0) throw new SyntaxError("Invalid hex string");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) throw new SyntaxError("Invalid hex string");
    out[i] = byte;
  }
  return out;
});
define(Uint8Array.prototype, "toBase64", function toBase64(this: Uint8Array, options?: { alphabet?: string; omitPadding?: boolean }) {
  let s = "";
  let i = 0;
  for (; i + 2 < this.length; i += 3) {
    const n = (this[i] << 16) | (this[i + 1] << 8) | this[i + 2];
    s += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < this.length) {
    const n = (this[i] << 16) | ((this[i + 1] ?? 0) << 8);
    s += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < this.length ? B64[(n >> 6) & 63] : "=") + "=";
  }
  if (options?.alphabet === "base64url") s = s.replace(/\+/g, "-").replace(/\//g, "_");
  if (options?.omitPadding) s = s.replace(/=+$/, "");
  return s;
});
define(Uint8Array, "fromBase64", function fromBase64(input: string, options?: { alphabet?: string }) {
  let s = input.replace(/[\t\n\f\r ]+/g, "");
  if (options?.alphabet === "base64url") s = s.replace(/-/g, "+").replace(/_/g, "/");
  s = s.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (let i = 0; i < s.length; i++) {
    const v = B64.indexOf(s[i]);
    if (v < 0) throw new SyntaxError("Invalid base64 string");
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
});
