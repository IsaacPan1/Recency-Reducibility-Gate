// tooltip.js — FLIP + CLAMP tooltip positioning in a viewport escape layer.
//
// Each ⓘ trigger (.info) carries its copy in a child .tip (so aria-describedby
// and the verbatim-COPY byte-compare still resolve it at rest). On show we move
// the .tip into a document.body escape layer as position:fixed, then:
//   1. FLIP: prefer opening above the icon, but drop below if above would clip
//      (and vice-versa) — whichever side has room.
//   2. CLAMP: keep the full tooltip box inside the viewport with an 8px margin,
//      adjusting only the cross-axis (horizontal), anchored near the ⓘ.
// Because it lives in document.body with position:fixed, it is clipped only by
// the viewport — never by a panel's overflow:hidden/auto or a transformed
// ancestor (e.g. the .col load animation establishes a containing block).

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

// PURE geometry — no DOM. Given the trigger's rect, the tooltip's measured size,
// and the viewport, return where to place the tooltip and its caret.
// prefer = "above" | "below" (the configured side).
export function computeTipPosition({
  triggerRect, tipW, tipH, vw, vh, gap = 9, margin = 8, prefer = "above",
}) {
  const tCx = triggerRect.left + triggerRect.width / 2;
  const spaceAbove = triggerRect.top - margin;
  const spaceBelow = vh - triggerRect.bottom - margin;
  const fits = (s) => (s === "above" ? spaceAbove : spaceBelow) >= tipH + gap;
  const other = prefer === "above" ? "below" : "above";

  // FLIP: configured side if it fits; else the opposite if IT fits; else the
  // side with more room (CLAMP below will still keep the box on-screen).
  let side;
  if (fits(prefer)) side = prefer;
  else if (fits(other)) side = other;
  else side = spaceAbove >= spaceBelow ? "above" : "below";

  let top = side === "above" ? triggerRect.top - gap - tipH : triggerRect.bottom + gap;
  // CLAMP vertical (covers the "neither side fits" case) — never negative, never
  // past the bottom edge when the box is shorter than the viewport.
  top = clamp(top, margin, Math.max(margin, vh - margin - tipH));

  // Cross-axis: center on the trigger, then CLAMP horizontally so the box stays
  // on-screen while remaining anchored near the icon.
  let left = clamp(tCx - tipW / 2, margin, Math.max(margin, vw - margin - tipW));

  // Caret points back to the trigger centre, clamped inside the tooltip body.
  const caretLeft = clamp(tCx - left, 12, Math.max(12, tipW - 12));

  return { left, top, side, caretLeft };
}

// Wire delegated hover + keyboard-focus on every .info under `root`, manage the
// escape layer, and keep the active tooltip positioned on resize/scroll/layout
// change. Focus positions identically to hover (both call show()).
export function initTooltips(root = document, win = window) {
  const doc = root.ownerDocument || root;
  let active = null;          // { trigger, tip, home }
  let repositioning = false;  // re-entrancy guard (see position())

  // Reposition the active tooltip. Reading layout (getBoundingClientRect /
  // offsetWidth) here can, in some browsers, synchronously fire scroll/resize
  // (e.g. a focus-driven scrollIntoView), whose handlers call position() again —
  // an unbounded reposition→event→reposition loop. The guard makes position()
  // strictly non-re-entrant so that can never recurse.
  function position() {
    if (!active || repositioning) return;
    repositioning = true;
    try {
      const { trigger, tip } = active;
      const r = trigger.getBoundingClientRect();
      const { left, top, side, caretLeft } = computeTipPosition({
        triggerRect: r, tipW: tip.offsetWidth, tipH: tip.offsetHeight,
        vw: win.innerWidth, vh: win.innerHeight,
      });
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
      tip.style.setProperty("--caret-left", `${caretLeft}px`);
      tip.classList.toggle("tip-above", side === "above");
      tip.classList.toggle("tip-below", side === "below");
    } finally {
      repositioning = false;
    }
  }

  function show(trigger) {
    const id = trigger.getAttribute("aria-describedby");
    const tip = id && doc.getElementById(id);
    if (!tip) return;
    if (active && active.trigger === trigger) return;
    hide();
    const home = tip.parentNode;            // restore here on hide
    doc.body.appendChild(tip);              // escape layer
    tip.classList.add("tip-show");          // display:block so it can be measured
    active = { trigger, tip, home };
    position();
  }

  function hide() {
    if (!active) return;
    const { tip, home } = active;
    tip.classList.remove("tip-show", "tip-above", "tip-below");
    tip.style.left = tip.style.top = "";
    tip.style.removeProperty("--caret-left");
    if (home) home.appendChild(tip);        // back to its ⓘ
    active = null;
  }

  // Called after a render: if the active trigger was detached by a panel rebuild,
  // drop the orphaned tooltip; otherwise reposition it (its ⓘ may have moved as
  // the layout reflowed — e.g. a slider revealed the breadcrumb).
  function refresh() {
    if (!active) return;
    if (!doc.contains(active.trigger)) hide();
    else position();
  }

  const triggerOf = (e) => (e.target && e.target.closest ? e.target.closest(".info") : null);

  root.addEventListener("mouseover", (e) => { const t = triggerOf(e); if (t) show(t); });
  root.addEventListener("mouseout", (e) => {
    const t = triggerOf(e);
    if (t && active && active.trigger === t && !t.contains(e.relatedTarget)) hide();
  });
  // Focus must behave identically to hover.
  root.addEventListener("focusin", (e) => { const t = triggerOf(e); if (t) show(t); else if (active) hide(); });
  root.addEventListener("focusout", (e) => { const t = triggerOf(e); if (t && active && active.trigger === t) hide(); });
  // Reposition on real viewport changes only (these never fire from our own
  // style writes). We deliberately do NOT observe DOM mutations to drive
  // repositioning: render() calls refresh() explicitly after each rebuild, so a
  // MutationObserver here would only add a redundant mutation→refresh→reposition
  // path — the kind of re-entrant cycle to avoid.
  win.addEventListener("resize", position);
  win.addEventListener("scroll", position, true);

  return { show, hide, position, refresh };
}
