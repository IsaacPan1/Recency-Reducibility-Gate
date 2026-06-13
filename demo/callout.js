// callout.js — composes the naive-vs-gate DISAGREEMENT callout text from the
// REAL computed state: the two verdicts, the gate's frac/rel/n, and the verbatim
// reason string decideScheme() returned. Nothing is hardcoded to a scenario —
// every branch reads gate.js / scenarios.js output. Shared by index.html (it
// drives the same ✗-on-naive callout on both the Scenarios tab and the "Your
// data" tab) and exercised headlessly by the parity tests, so the text the demo
// renders is exactly the text we verify.

import {
  DRIFT_FRAC_IMPROVED_THRESHOLD as T_FRAC,
  DRIFT_REL_THRESHOLD as T_REL,
  MIN_FEATURES_FOR_SLIDING as T_NFEAT,
} from "./gate.js";
import { NAIVE_THRESHOLD } from "./scenarios.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (x, d = 2) => (x == null || Number.isNaN(x) ? "—" : Number(x).toFixed(d));

// Returns the callout body as an HTML string when the naive baseline and the
// gate DISAGREE, or null when they agree (the caller hides the callout in that
// case). Inputs are exactly what the demo already computed:
//   naive   = scenarios.naiveFoil(...)   → { scheme, meanAuc, ... }
//   diag    = gate.driftDiagnostic(...)  → { ok, frac_improved, rel, n_features_scanned, ... }
//   verdict = gate.decideScheme(diag)    → { scheme, reason, gates:{frac_ok,rel_ok,nfeat_ok} }
export function disagreementCallout(naive, diag, verdict) {
  if (!naive || !verdict) return null;
  if (naive.scheme === verdict.scheme) return null; // agree → no callout

  const auc = fmt(naive.meanAuc);
  const verbatim = `<span class="cverb">${esc(verdict.reason)}</span>`;

  // ── naive=SLIDING, gate=EXPANDING — the retail foil and its honest variants ──
  if (naive.scheme === "sliding" && verdict.scheme === "expanding") {
    let why;
    if (!diag || !diag.ok) {
      // The gate could not even assess recency-reducibility (e.g. too few
      // periods / no shared feature) → it fell back to expanding. Say THAT, not
      // "recency doesn't reduce the gap".
      why = `the gate could <b>not</b> assess recency-reducibility on this data, so it
        <b class="green">conservatively holds EXPANDING</b> rather than slide on missing evidence`;
    } else {
      const g = verdict.gates || {};
      const frac = fmt(diag.frac_improved), rel = fmt(diag.rel), n = diag.n_features_scanned;
      if (!g.frac_ok) {
        // The substantive reason: recency genuinely does NOT reduce the gap on
        // enough features (frac is low) — name THAT first. This is honest even
        // when the breadth floor also trips (frac low AND n<12, the retail case):
        // a thin-evidence rider acknowledges the floor without pretending the
        // floor is why recency "would have" helped.
        const floorRider = !g.nfeat_ok
          ? ` (and with only <b>n=${n}</b> features scanned, &lt; ${T_NFEAT}, that evidence is thin besides)`
          : ``;
        why = `here it does <b>not</b> — recency narrows the gap on too few features
          (<b>frac=${frac}</b> &lt; ${T_FRAC})${floorRider} — so it
          <b class="green">correctly keeps all history</b>`;
      } else if (!g.nfeat_ok) {
        // frac CLEARED (recency DID reduce the gap) but too few features to trust
        // it — the operative brake is the breadth FLOOR alone. Do NOT claim
        // "recency doesn't reduce the gap" here, because it does.
        why = `with only <b>n=${n}</b> features scanned (&lt; ${T_NFEAT}) the evidence is too thin
          to trust a slide, so it <b class="green">holds EXPANDING on the breadth floor</b>`;
      } else {
        // Breadth cleared, but the DEPTH gate (rel) did not.
        why = `breadth clears (<b>frac=${frac}</b> ≥ ${T_FRAC}) but the reduction is too shallow
          (<b>rel=${rel}</b> &lt; ${T_REL}), so it <b class="green">holds EXPANDING</b>`;
      }
    }
    return `The separability test reads train and val as different
      (<b class="coral">mean AUC=${auc}</b>) and would slide. But validation is the future by
      construction, so separability is high regardless. The gate checks whether restricting to the
      recent window actually pulls the covariates closer to val — ${why}. ${verbatim}`;
  }

  // ── naive=EXPANDING, gate=SLIDING — the rare inverse ──
  // Sliding requires all three gates to clear, so diag.ok is necessarily true here.
  const frac = fmt(diag.frac_improved), rel = fmt(diag.rel), n = diag.n_features_scanned;
  return `Separability looked mild (<b class="coral">mean AUC=${auc}</b>, below ${NAIVE_THRESHOLD})
    so the naive test would keep all history. But recency genuinely narrows the gap on enough
    features (<b class="green">frac=${frac}</b> ≥ ${T_FRAC}, rel=${rel} ≥ ${T_REL},
    n=${n} ≥ ${T_NFEAT}), so the gate <b class="green">slides to the recent window</b>. ${verbatim}`;
}
