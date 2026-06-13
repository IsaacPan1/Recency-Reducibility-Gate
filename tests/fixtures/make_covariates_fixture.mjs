// Generator/tuner for the REAL retail BYO fixtures. Panel data:
//   store_id, product_id (string IDs → non-numeric, excluded from the gate scan,
//     used as the group key), week (time col, scanned as a feature → negative
//     improvement), price / promotion_active / holiday_flag / weather_index
//     (numeric covariates). NO target column.
// Goal metrics (measured through the SHIPPED gate.js / dataio.js):
//   gate EXPANDING, frac≈0.20 (only weather_index improves of 5 scanned), rel≈0.02,
//   naive SLIDING (mean AUC≈0.62 over the 4 covariates, week excluded as time col).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { driftDiagnostic, decideScheme } from "../../demo/gate.js";
import { naiveFoil } from "../../demo/scenarios.js";
import { numericColsInBoth } from "../../demo/dataio.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rng) => {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const pad = (n, w) => String(n).padStart(w, "0");

// ── tunable parameters ──
const P = {
  NS: 50, NP: 30, TRAIN_WEEKS: 90, VAL_WEEKS: 10,  // 1500 groups → 135k / 15k rows
  WEEK_STEP: 50,        // weather regime change; recent 14 wks (76-89) sit in regime B = val
  MU_W: 1.78,           // weather step magnitude (drives weather improvement + AUC)
  W_NOISE: 1.0,
  PRICE_BASE: 10, PRICE_NOISE: 1.0, DELTA_PRICE: 0.44,  // small train/val offset → mild AUC, no recency reduction
  PV_TR: 0.20, PV_VAL: 0.40,   // promotion_active Bernoulli probs
  PH_TR: 0.10, PH_VAL: 0.275,  // holiday_flag Bernoulli probs
  SEED: 7,
};

function genRows(P) {
  const rng = makeRng(P.SEED);
  const train = [], val = [];
  for (let si = 0; si < P.NS; si++) {
    for (let pi = 0; pi < P.NP; pi++) {
      const store = "S" + pad(si, 3), product = "P" + pad(pi, 3);
      const priceBase = P.PRICE_BASE + (si % 5) * 0.4 + (pi % 7) * 0.25; // per-series level
      const emit = (arr, w, isVal) => {
        const weather = (w < P.WEEK_STEP ? 0 : P.MU_W) + gauss(rng) * P.W_NOISE;
        const price = priceBase + gauss(rng) * P.PRICE_NOISE + (isVal ? P.DELTA_PRICE : 0);
        const promo = rng() < (isVal ? P.PV_VAL : P.PV_TR) ? 1 : 0;
        const holiday = rng() < (isVal ? P.PH_VAL : P.PH_TR) ? 1 : 0;
        arr.push({
          store_id: store, product_id: product, week: w,
          price: +price.toFixed(4), promotion_active: promo, holiday_flag: holiday,
          weather_index: +weather.toFixed(4),
        });
      };
      for (let w = 0; w < P.TRAIN_WEEKS; w++) emit(train, w, false);
      for (let k = 0; k < P.VAL_WEEKS; k++) emit(val, P.TRAIN_WEEKS + k, true);
    }
  }
  return { train, val };
}

function measure(train, val) {
  const timeCol = "week", targetCol = "";
  const diag = driftDiagnostic(train, val, timeCol, { exclude: new Set() });
  const verdict = decideScheme(diag);
  const sharedExcl = [targetCol, timeCol].filter(Boolean);
  const naive = naiveFoil(train, val, numericColsInBoth(train, val, sharedExcl));
  return { diag, verdict, naive };
}

const { train, val } = genRows(P);
const { diag, verdict, naive } = measure(train, val);
console.log(`rows: train=${train.length} val=${val.length}`);
console.log(`n_scanned=${diag.n_features_scanned}  frac=${diag.frac_improved.toFixed(3)}  rel=${diag.rel.toFixed(3)}  verdict=${verdict.scheme.toUpperCase()}`);
console.log("per-feature improvement (counts toward frac if > 0.05):");
for (const f of diag.per_feature)
  console.log(`   ${f.feature.padEnd(18)} dist_full=${f.dist_full.toFixed(3)} dist_recent=${f.dist_recent.toFixed(3)} impr=${f.improvement.toFixed(3)} ${f.improvement > 0.05 ? "✓counts" : ""}`);
console.log(`naive: scheme=${naive.scheme.toUpperCase()} meanAUC=${naive.meanAuc.toFixed(3)}  cols=[${naive.per.map((p) => p.feature).join(", ")}]`);
console.log("naive per-col AUC:", naive.per.map((p) => `${p.feature}=${p.auc.toFixed(2)}`).join("  "));

const WRITE = process.argv.includes("--write");
if (WRITE) {
  const cols = ["store_id", "product_id", "week", "price", "promotion_active", "holiday_flag", "weather_index"];
  const toCSV = (rows) => cols.join(",") + "\n" + rows.map((r) => cols.map((c) => r[c]).join(",")).join("\n") + "\n";
  writeFileSync(join(HERE, "covariates_train.csv"), toCSV(train));
  writeFileSync(join(HERE, "covariates_val.csv"), toCSV(val));
  console.log("\nWROTE tests/fixtures/covariates_train.csv + covariates_val.csv");
}
