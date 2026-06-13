// sampling.js — the "Your data" responsiveness cap: group-aware down-sampling of
// large uploads BEFORE the gate runs. Dependency-free ES module so the exact
// sampling the demo ships is the sampling the BYO tests exercise headlessly.
//
// NOT a correctness limit: the gate is numerically correct at any size. This is a
// pure speed/memory guard, and every run discloses the subset it ran on.

import { isNumericCol } from "./dataio.js";
import { mulberry32 } from "./scenarios.js";

export const ROW_CAP = 50000;
export const SAMPLE_SEED = 1337; // fixed → deterministic sampling

// Detect the group key: ID-like columns (non-numeric, or named like an id/key/
// code) that aren't the time column or the target, and that actually partition
// the rows into multi-row series. Returns [] when there is no usable group key
// (a single flat series).
export function detectGroupCols(rows, timeCol, targetCol) {
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]).filter((c) => c !== timeCol && c !== targetCol);
  const idLike = cols.filter(
    (c) => !isNumericCol(rows, c) || /(^|_)(id|key|code|group|panel)$/i.test(c),
  );
  if (!idLike.length) return [];
  const keyOf = (r) => idLike.map((c) => r[c]).join("|");
  const nGroups = new Set(rows.map(keyOf)).size;
  // require real groups: >=2 of them, each holding a series (avg > 1 row).
  if (nGroups < 2 || rows.length / nGroups < 2) return [];
  return idLike;
}

export const groupKeyOf = (row, cols) => cols.map((c) => row[c]).join("|");

// Group-level sample: a RANDOM subset of WHOLE groups (deterministic, fixed seed),
// each group's full time series kept intact, adding groups until the next would
// exceed the cap. Falls back, when there is no group key (a lone flat series), to
// the most RECENT rows up to the cap (recency is the only structure a single
// series has, and the gate only compares the recent window vs history).
// restrictTo (optional Set of group keys) keeps val on the SAME groups as train.
// Returns { rows, full, used, sampled, mode, gcols, chosen, groupsFull, groupsUsed }.
export function sampleGroups(rows, timeCol, targetCol, cap, seed, restrictTo) {
  const N = rows.length;
  const gcols = detectGroupCols(rows, timeCol, targetCol);

  // Val consistency: restrict to train's chosen groups (where the key applies).
  if (restrictTo && gcols.length) {
    const kept = rows.filter((r) => restrictTo.has(groupKeyOf(r, gcols)));
    if (kept.length) {
      return { rows: kept, full: N, used: kept.length, sampled: kept.length !== N,
               mode: "group-match", gcols, chosen: restrictTo };
    }
  }
  if (N <= cap) return { rows, full: N, used: N, sampled: false, mode: "none" };

  if (gcols.length) {
    const map = new Map(); // group key -> original row indices
    for (let i = 0; i < N; i++) {
      const k = groupKeyOf(rows[i], gcols);
      let g = map.get(k); if (!g) map.set(k, (g = [])); g.push(i);
    }
    const keys = [...map.keys()];
    const rng = mulberry32(seed);
    for (let j = keys.length - 1; j > 0; j--) { // seeded shuffle of GROUPS
      const t = Math.floor(rng() * (j + 1));
      const tmp = keys[j]; keys[j] = keys[t]; keys[t] = tmp;
    }
    const chosen = new Set();
    const keepIdx = [];
    let used = 0;
    for (const k of keys) {
      const g = map.get(k);
      if (used + g.length > cap) break;      // stop when the next whole group would exceed
      chosen.add(k); used += g.length;
      for (const i of g) keepIdx.push(i);
    }
    keepIdx.sort((a, b) => a - b);           // restore original row order
    return { rows: keepIdx.map((i) => rows[i]), full: N, used, sampled: true,
             mode: "group", gcols, chosen, groupsFull: keys.length, groupsUsed: chosen.size };
  }

  // Flat-series fallback: keep the most RECENT cap rows by time (the LAST N).
  const idx = rows.map((_, i) => i)
    .sort((a, b) => (Number(rows[a][timeCol]) - Number(rows[b][timeCol])) || (a - b));
  const keepIdx = idx.slice(Math.max(0, idx.length - cap)).sort((a, b) => a - b);
  return { rows: keepIdx.map((i) => rows[i]), full: N, used: keepIdx.length, sampled: true, mode: "recent" };
}
