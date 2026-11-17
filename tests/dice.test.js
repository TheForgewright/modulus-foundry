// Test 1 (§17.2): dice distribution against Appendix B, by exhaustive enumeration.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rollKept, keepFromFaces, keptDistribution, expectedKept, hitChance, diceCount
} from "../module/rules/dice.js";

/** Enumerate all 20^n outcomes; counts[k][v] = number of outcomes whose k-th smallest (0-based) is v. */
function enumerate(n) {
  const counts = Array.from({ length: n }, () => new Array(21).fill(0));
  const faces = new Array(n).fill(1);
  const sorted = new Array(n);
  const total = 20 ** n;
  for (let c = 0; c < total; c++) {
    let x = c;
    for (let i = 0; i < n; i++) { faces[i] = (x % 20) + 1; x = Math.floor(x / 20); }
    for (let i = 0; i < n; i++) sorted[i] = faces[i];
    sorted.sort((a, b) => a - b);
    for (let k = 0; k < n; k++) counts[k][sorted[k]]++;
  }
  return { counts, total };
}

const ENUM = { 3: enumerate(3), 4: enumerate(4), 5: enumerate(5) };
const TIERS = ["tertiary", "secondary", "primary"];
const OPS = {
  base: { buff: 0, debuff: 0 },
  buff1: { buff: 1, debuff: 0 },
  debuff1: { buff: 0, debuff: 1 },
  compression: { buff: 1, debuff: 1 },
  buff2: { buff: 2, debuff: 0 },
  debuff2: { buff: 0, debuff: 2 }
};

function enumDist(tier, { buff, debuff }) {
  const n = 3 + buff + debuff;
  const k = buff + TIERS.indexOf(tier);
  const { counts, total } = ENUM[n];
  return counts[k].map((c) => c / total);
}

// Appendix B: expected kept value
const MEANS = {
  base: [5.51, 10.50, 15.49],
  buff1: [8.50, 12.50, 16.48],
  debuff1: [4.52, 8.50, 12.50],
  compression: [7.17, 10.50, 13.83],
  buff2: [10.50, 13.83, 17.15],
  debuff2: [3.85, 7.17, 10.50]
};

// Appendix B: P(kept = 20), in percent
const NAT20 = {
  base: [0.0125, 0.7250, 14.2625],
  buff1: [0.0481, 1.4019, 18.5494],
  debuff1: [0.0006, 0.0481, 1.4019],
  compression: [0.0030, 0.1158, 2.2593],
  buff2: [0.1158, 2.2593, 22.6219],
  debuff2: [0.0000, 0.0030, 0.1158]
};

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

test("closed-form distribution equals brute-force enumeration", () => {
  for (const op of Object.values(OPS)) {
    for (const tier of TIERS) {
      const a = keptDistribution({ tier, ...op });
      const b = enumDist(tier, op);
      for (let v = 1; v <= 20; v++) assert.ok(Math.abs(a[v] - b[v]) < 1e-12, `${tier} ${JSON.stringify(op)} v=${v}`);
    }
  }
});

test("means match Appendix B", () => {
  for (const [name, op] of Object.entries(OPS)) {
    TIERS.forEach((tier, i) => {
      const mean = enumDist(tier, op).reduce((s, p, v) => s + p * v, 0);
      assert.equal(round(mean, 2), MEANS[name][i], `${name} ${tier}: ${mean}`);
      assert.ok(Math.abs(expectedKept({ tier, ...op }) - mean) < 1e-9);
    });
  }
});

test("P(kept = 20) matches Appendix B", () => {
  for (const [name, op] of Object.entries(OPS)) {
    TIERS.forEach((tier, i) => {
      const p = enumDist(tier, op)[20] * 100;
      assert.equal(round(p, 4), NAT20[name][i], `${name} ${tier}: ${p}`);
    });
  }
});

test("hit rates match Appendix B (preset A, preset B, original, DC 11 with dice)", () => {
  const pct = (x) => round(x * 100, 1);
  const tables = [
    { dcs: [8, 11, 14], rows: { primary: [95.7, 87.5, 72.5], secondary: [71.8, 50.0, 28.2], tertiary: [27.5, 12.5, 4.3] } },
    { dcs: [9, 11, 13], rows: { primary: [93.6, 87.5, 78.4], secondary: [64.8, 50.0, 35.2], tertiary: [21.6, 12.5, 6.4] } },
    { dcs: [5, 10, 15], rows: { primary: [99.2, 90.9, 65.7], secondary: [89.6, 57.5, 21.6], tertiary: [51.2, 16.6, 2.7] } }
  ];
  for (const { dcs, rows } of tables) {
    for (const [tier, expected] of Object.entries(rows)) {
      dcs.forEach((dc, i) => assert.equal(pct(hitChance({ tier, dc })), expected[i], `${tier} vs DC ${dc}`));
    }
  }
  const dc11 = {
    base: [12.5, 50.0, 87.5],
    buff1: [31.2, 68.8, 93.8],
    debuff1: [6.2, 31.2, 68.8],
    compression: [18.8, 50.0, 81.2]
  };
  for (const [name, expected] of Object.entries(dc11)) {
    TIERS.forEach((tier, i) => {
      // Appendix B rounds these four to one decimal; exact values sit on .x5 boundaries, so allow 0.05.
      const got = hitChance({ tier, dc: 11, ...OPS[name] }) * 100;
      assert.ok(Math.abs(got - expected[i]) <= 0.05 + 1e-9, `${name} ${tier}: ${got}`);
    });
  }
});

test("secondary vs secondary is exactly 50% under both presets", () => {
  assert.ok(Math.abs(hitChance({ tier: "secondary", dc: 11 }) - 0.5) < 1e-12);
});

test("keepFromFaces drops lowest for buff and highest for debuff", () => {
  const faces = [7, 19, 2, 12, 15]; // sorted 2 7 12 15 19
  const r = keepFromFaces(faces, { tier: "secondary", buff: 1, debuff: 1 });
  assert.deepEqual(r.kept3, [7, 12, 15]);
  assert.equal(r.kept, 12);
  assert.equal(r.keptIndex, 3);
  assert.deepEqual(r.droppedIndices, [0, 1, 2, 4]);
  assert.equal(keepFromFaces([5, 5, 5, 1], { tier: "tertiary", buff: 1 }).kept, 5);
  assert.equal(keepFromFaces([20, 1, 10, 9], { tier: "primary", debuff: 1 }).kept, 10);
});

test("rollKept uses injected RNG and rolls 3 + B + D dice", () => {
  const seq = [0.0, 0.5, 0.95, 0.3];
  let i = 0;
  const r = rollKept({ tier: "primary", buff: 1, rng: () => seq[i++] });
  assert.deepEqual(r.faces, [1, 11, 20, 7]);
  assert.equal(r.kept, 20);
  assert.equal(diceCount(2, 3), 8);
  assert.throws(() => diceCount(-1, 0));
});
