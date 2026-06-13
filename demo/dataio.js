// dataio.js — dependency-free CSV parsing + column heuristics for the
// "Your data" tab. No CDN, no libraries: this is an ES module that runs in the
// browser straight off GitHub Pages and is import-able headlessly under node,
// so the parser the demo ships is the exact parser the tests exercise.
//
// Nothing here decides a gate verdict. It only turns text into row objects and
// guesses which columns are the time index / target — the verdict is whatever
// gate.js returns on the parsed rows (see index.html).

// Coerce a raw cell string: numeric-looking -> Number, everything else stays a
// (trimmed) string. Blank -> "" so isNumericColumn/toFloat treat it as missing.
export function coerceCell(v) {
  const t = (v == null ? "" : String(v)).trim();
  if (t === "") return "";
  // strict numeric literal (optional sign, int/decimal, optional exponent) —
  // avoids coercing "Infinity", "0x10", "1,2", dates, ids-with-leading-zeros-as-text, etc.
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
  return t;
}

// Parse CSV text into { header: string[], rows: object[] }.
//   - handles quoted fields containing commas, newlines, and "" escapes
//   - trims surrounding whitespace on every field
//   - coerces numeric-looking cells to numbers, leaves the rest as strings
// On a structural problem (wrong column count, unterminated quote) it throws an
// Error whose `.line` is the 1-based physical source line of the offending row,
// so the UI can show a red banner naming the line.
export function parseCSV(text) {
  if (typeof text !== "string") throw new Error("expected text to parse");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM

  const records = []; // { cells: string[], line: number }
  let field = "";
  let row = [];
  let inQuotes = false;
  let line = 1;
  let recStart = 1;
  let started = false; // has the current record seen any content yet?

  const pushField = () => {
    row.push(field.trim());
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push({ cells: row, line: recStart });
    row = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!started && ch !== "\n" && ch !== "\r") {
      started = true;
      recStart = line;
    }
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { pushField(); continue; }
    if (ch === "\r") { continue; }
    if (ch === "\n") {
      line++;
      if (started) pushRecord();
      continue;
    }
    field += ch;
  }
  if (inQuotes) {
    const e = new Error("unterminated quoted field (missing closing quote)");
    e.line = recStart;
    throw e;
  }
  if (started || field.length || row.length) pushRecord();

  if (records.length === 0) {
    const e = new Error("no rows found (empty input)");
    e.line = 1;
    throw e;
  }

  const header = records[0].cells.map((h) => h.trim());
  const rows = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    if (rec.cells.length !== header.length) {
      const e = new Error(
        `expected ${header.length} columns but found ${rec.cells.length}`,
      );
      e.line = rec.line;
      throw e;
    }
    const obj = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = coerceCell(rec.cells[c]);
    rows.push(obj);
  }
  return { header, rows };
}

// Every value in the column is a number (or blank/missing).
export function isNumericCol(rows, col) {
  let sawNumber = false;
  for (const r of rows) {
    const v = r[col];
    if (v === "" || v === null || v === undefined) continue;
    if (typeof v !== "number" || Number.isNaN(v)) return false;
    sawNumber = true;
  }
  return sawNumber;
}

// Columns numeric in BOTH frames (the comparable covariates), minus any to drop.
export function numericColsInBoth(trainRows, valRows, drop = []) {
  if (!trainRows.length || !valRows.length) return [];
  const dropSet = new Set(drop.filter(Boolean));
  const valKeys = new Set(Object.keys(valRows[0]));
  return Object.keys(trainRows[0]).filter(
    (c) =>
      !dropSet.has(c) &&
      valKeys.has(c) &&
      isNumericCol(trainRows, c) &&
      isNumericCol(valRows, c),
  );
}

// time = first column whose name looks temporal, else the only monotonic-ish
// integer column, else the first column.
export function guessTimeCol(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const byName = cols.find((c) => /period|time|date|t$/i.test(c));
  if (byName) return byName;
  const monoInts = cols.filter((c) => {
    let prev = -Infinity;
    let saw = false;
    for (const r of rows) {
      const v = r[c];
      if (v === "" || v === null || v === undefined) continue;
      if (typeof v !== "number" || !Number.isInteger(v)) return false;
      if (v < prev) return false;
      prev = v;
      saw = true;
    }
    return saw;
  });
  if (monoInts.length === 1) return monoInts[0];
  return cols[0] || "";
}

// target = a column named like a target, present in train.
export function guessTargetCol(rows) {
  if (!rows.length) return "";
  return Object.keys(rows[0]).find((c) => /target|y|label/i.test(c)) || "";
}

// Align validation ground-truth target onto valRows. If val itself carries the
// target column, read it directly; otherwise join a separate truth frame on the
// columns the two share (e.g. period+region), falling back to row order when
// no shared key columns exist. Returns null if no target can be resolved.
export function buildValTarget(valRows, valTruthRows, targetCol) {
  if (!targetCol || !valRows.length) return null;
  // Case 1: val already contains the target column.
  if (targetCol in valRows[0]) {
    const direct = valRows.map((r) => r[targetCol]);
    if (direct.every((v) => typeof v === "number" && !Number.isNaN(v))) return direct;
  }
  // Case 2: a separate truth frame.
  if (!valTruthRows || !valTruthRows.length || !(targetCol in valTruthRows[0])) {
    return null;
  }
  const keyCols = Object.keys(valTruthRows[0]).filter(
    (c) => c !== targetCol && c in valRows[0],
  );
  if (keyCols.length) {
    const SEP = "";
    const map = new Map();
    for (const r of valTruthRows) {
      map.set(keyCols.map((c) => r[c]).join(SEP), r[targetCol]);
    }
    const joined = valRows.map((r) => {
      const k = keyCols.map((c) => r[c]).join(SEP);
      return map.has(k) ? map.get(k) : NaN;
    });
    if (joined.every((v) => typeof v === "number" && !Number.isNaN(v))) return joined;
  }
  // Fallback: positional alignment when lengths match.
  if (valTruthRows.length === valRows.length) {
    const pos = valTruthRows.map((r) => r[targetCol]);
    if (pos.every((v) => typeof v === "number" && !Number.isNaN(v))) return pos;
  }
  return null;
}
