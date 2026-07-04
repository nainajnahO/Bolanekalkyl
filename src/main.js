import Chart from 'chart.js/auto';
import '98.css';
import './style.css';
import { legalMinMonthly, simulate, keyFigures, normalizeRules, LAW_RULES } from './mortgage.js';

const STORAGE_KEY = 'bolan-dashboard';
const PALETTE = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948'];
const MAX_SCENARIOS = PALETTE.length;
const START_YEAR = new Date().getFullYear();
const AMORT_RANGE = { kr: { min: 0, max: 40000, step: 100 }, pct: { min: 0, max: 10, step: 0.1 } };

const fmtSEK = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 });
const $ = (sel) => document.querySelector(sel);

// --- State ---

function defaultScenario() {
  return {
    id: crypto.randomUUID(),
    name: 'Grundscenario',
    colorIndex: 0,
    propertyValue: 4_000_000,
    loanAmount: 3_400_000,
    borrowers: 2,
    rateSegments: [{ fromYear: 0, annualRatePct: 3.5 }],
    showRateBand: false,
    rateSpreadPct: 1,
    amortMode: 'auto',
    amortSegments: [{ fromYear: 0, value: 6000, unit: 'kr' }],
  };
}

function defaultState() {
  const sc = defaultScenario();
  return { version: 1, activeId: sc.id, scenarios: [sc], rules: { ...LAW_RULES } };
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (
      parsed?.version === 1 &&
      Array.isArray(parsed.scenarios) &&
      parsed.scenarios.length > 0 &&
      parsed.scenarios.some((s) => s.id === parsed.activeId)
    ) {
      delete parsed.theme98; // leftover from when the Win98 look was a toggle
      for (const s of parsed.scenarios) {
        delete s.incomeAnnual; // skuldkvotskravet avskaffat april 2026
        s.showRateBand = s.showRateBand === true;
        if (!Number.isFinite(Number(s.rateSpreadPct))) s.rateSpreadPct = 1; // fanns inte i äldre sparade lägen
      }
      parsed.rules = normalizeRules(parsed.rules); // fills lagens nivåer for states saved before rules existed
      return parsed;
    }
  } catch {
    // corrupt storage → defaults
  }
  return defaultState();
}

let state = loadState();
const active = () => state.scenarios.find((s) => s.id === state.activeId);

let saveTimer;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)), 250);
}

let recalcPending = false;
function scheduleRecalc() {
  if (recalcPending) return;
  recalcPending = true;
  requestAnimationFrame(() => {
    recalcPending = false;
    recalc();
  });
}

// --- Charts ---

const monthLabel = (m) =>
  new Date(START_YEAR, m, 1).toLocaleDateString('sv-SE', { month: 'short', year: 'numeric' });

function compactSEK(v) {
  const n = (x, d) => x.toLocaleString('sv-SE', { maximumFractionDigits: d });
  if (Math.abs(v) >= 1e6) return `${n(v / 1e6, 1)} mkr`;
  if (Math.abs(v) >= 1e3) return `${n(v / 1e3, 0)} tkr`;
  return `${n(v, 0)} kr`;
}

function makeChart(canvas, afterLabel) {
  return new Chart(canvas, {
    type: 'line',
    data: { datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      normalized: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 14,
            boxHeight: 3,
            color: '#444',
            filter: (item, data) => !data.datasets[item.datasetIndex].bolanBand,
          },
        },
        tooltip: {
          filter: (item) => !item.dataset.bolanBand,
          callbacks: {
            title: (items) => (items.length ? monthLabel(items[0].dataIndex) : ''),
            label: (ctx) => `${ctx.dataset.label}: ${fmtSEK.format(ctx.parsed.y)}`,
            afterLabel,
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          ticks: { precision: 0, maxTicksLimit: 12, callback: (v) => String(v), color: '#6f6d66' },
          grid: { color: '#eceae4' },
        },
        y: {
          beginAtZero: true,
          ticks: { maxTicksLimit: 7, callback: compactSEK, color: '#6f6d66' },
          grid: { color: '#eceae4' },
        },
      },
    },
  });
}

const charts = {
  balance: makeChart($('#chartBalance'), (ctx) => {
    const b = ctx.dataset.bolan;
    return b.propertyValue > 0 ? `LTV ${Math.round((ctx.parsed.y / b.propertyValue) * 100)} %` : '';
  }),
  payment: makeChart($('#chartPayment'), (ctx) => {
    const b = ctx.dataset.bolan;
    const m = ctx.dataIndex;
    const lines = [
      `varav amortering ${fmtSEK.format(b.amort[m])}`,
      `varav räntenetto ${fmtSEK.format(b.interestNet[m])} (brutto ${fmtSEK.format(b.interestGross[m])})`,
    ];
    if (b.band) lines.push(`räntespann ${fmtSEK.format(b.band.low[m])} – ${fmtSEK.format(b.band.high[m])}`);
    return lines;
  }),
  cumInterest: makeChart($('#chartCumInterest'), (ctx) => {
    const b = ctx.dataset.bolan;
    const m = ctx.dataIndex;
    const lines = [`brutto ${fmtSEK.format(b.cumInterestGross[m])}`];
    if (b.band) lines.push(`räntespann ${fmtSEK.format(b.band.low[m])} – ${fmtSEK.format(b.band.high[m])}`);
    return lines;
  }),
};

function toDataset(sc, res, series) {
  return {
    label: sc.name || '(namnlöst)',
    data: series.map((y, m) => ({ x: START_YEAR + m / 12, y })),
    borderColor: PALETTE[sc.colorIndex],
    backgroundColor: PALETTE[sc.colorIndex],
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    bolan: {
      propertyValue: sc.propertyValue,
      amort: res.amort,
      interestNet: res.interestNet,
      interestGross: res.interestGross,
      cumInterestGross: res.cumInterestGross,
    },
  };
}

// Boundary lines for the räntespann band: invisible, and the upper one fills
// down to its neighbour (fill: '-1'). Excluded from legend/tooltip via bolanBand.
function toBandDataset(sc, series, fillToPrev) {
  return {
    label: `${sc.name || '(namnlöst)'} ±`,
    data: series.map((y, m) => ({ x: START_YEAR + m / 12, y })),
    borderWidth: 0,
    pointRadius: 0,
    pointHoverRadius: 0,
    backgroundColor: `${PALETTE[sc.colorIndex]}26`, // 8-siffrig hex ≈ 15 % alfa
    fill: fillToPrev ? '-1' : false,
    bolanBand: true,
    order: 1, // högre order ritas först → bandet hamnar bakom linjerna
  };
}

// --- Recalculation (all input events funnel here, rAF-coalesced) ---

// Exakt värsta/bästa-fall: kostnaden är monoton i räntan, så hela banan
// skiftad till spannets kanter omsluter varje räntebana som håller sig inom
// spannet. (Skulden är oberoende av räntan — rak amortering, räntan
// kapitaliseras aldrig — så payoff och skuldkurva ändras inte.)
function shiftRates(sc, delta) {
  return {
    ...sc,
    rateSegments: sc.rateSegments.map((s) => ({ ...s, annualRatePct: (Number(s.annualRatePct) || 0) + delta })),
  };
}

function recalc() {
  const rules = normalizeRules(state.rules);
  const results = state.scenarios.map((sc) => {
    const res = simulate(sc, { startYear: START_YEAR, rules });
    const spread = Number(sc.rateSpreadPct) || 0;
    const band =
      sc.showRateBand && spread > 0
        ? {
            low: simulate(shiftRates(sc, -spread), { startYear: START_YEAR, rules }),
            high: simulate(shiftRates(sc, spread), { startYear: START_YEAR, rules }),
          }
        : null;
    return { sc, res, band };
  });
  const act = results.find((r) => r.sc.id === state.activeId);

  const seriesFor = { balance: 'balance', payment: 'paymentNet', cumInterest: 'cumInterestNet' };
  for (const [key, chart] of Object.entries(charts)) {
    const series = seriesFor[key];
    chart.data.datasets = results.flatMap(({ sc, res, band }) => {
      const main = toDataset(sc, res, res[series]);
      if (!band || key === 'balance') return [main]; // skuldkurvan påverkas inte av räntan
      main.bolan.band = { low: band.low[series], high: band.high[series] };
      return [toBandDataset(sc, band.low[series], false), toBandDataset(sc, band.high[series], true), main];
    });
    chart.options.plugins.legend.display = results.length > 1;
    chart.update('none');
  }

  $('#statMonthly').textContent = fmtSEK.format(act.res.paymentNet[0] ?? 0);
  $('#statAmort').textContent = fmtSEK.format(act.res.amort[0] ?? 0);
  $('#statInterest').textContent = fmtSEK.format(act.res.interestNet[0] ?? 0);
  $('#statPayoff').textContent = keyFigures(act.res).payoffLabel ?? '—';

  const min = legalMinMonthly(act.sc.loanAmount, act.sc, rules);
  $('#legalMinReadout').textContent = `Lagkrav nu: ${min.pct} % = ${fmtSEK.format(min.monthly)}/mån`;
  $('#bolanetakPctText').textContent = rules.bolanetakPct.toLocaleString('sv-SE');
  $('#bolanetakWarning').hidden = !(act.sc.loanAmount > (rules.bolanetakPct / 100) * act.sc.propertyValue);
  $('#rulesModifiedFlag').hidden = !Object.keys(LAW_RULES).some((k) => rules[k] !== LAW_RULES[k]);

  const hasDup = (list) => new Set(list.map((s) => s.fromYear)).size !== list.length;
  $('#rateDuplicateNote').hidden = !hasDup(act.sc.rateSegments);
  $('#amortDuplicateNote').hidden = !hasDup(act.sc.amortSegments);
  renderAmortWarnings(act.res);

  renderTable(results);
  saveSoon();
}

function renderAmortWarnings(res) {
  $('#amortWarnings').replaceChildren(
    ...res.warnings.map((w) => {
      const p = document.createElement('p');
      p.className = 'warning';
      const from = Math.floor(w.fromMonth / 12);
      const to = Math.floor(w.toMonth / 12);
      const span = from === to ? `År ${from}` : `År ${from}–${to}`;
      p.textContent = `${span}: under lagkravet (minst ${fmtSEK.format(w.minAtStart)}/mån vid periodens start).`;
      const link = document.createElement('a');
      link.href = '#';
      link.className = 'rule-link';
      link.dataset.rule = 'amortRateHighPct';
      link.textContent = '[ändra]';
      p.append(' ', link);
      return p;
    }),
  );
}

function renderTable(results) {
  const cell = (v) => (v == null ? '—' : fmtSEK.format(v));
  $('#comparisonTable tbody').replaceChildren(
    ...results.map(({ sc, res }) => {
      const kf = keyFigures(res);
      const tr = document.createElement('tr');
      const nameTd = document.createElement('td');
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.background = PALETTE[sc.colorIndex];
      nameTd.append(chip, sc.name || '(namnlöst)');
      tr.append(
        nameTd,
        ...[
          cell(kf.netMonthlyNow),
          cell(kf.netMonthlyYear5),
          cell(kf.netMonthlyYear10),
          kf.payoffLabel ?? '—',
          cell(kf.totalInterestNet),
          cell(kf.totalInterestGross),
        ].map((text) => {
          const td = document.createElement('td');
          td.textContent = text;
          return td;
        }),
      );
      return tr;
    }),
  );
}

// --- Scalar inputs (paired slider + number) ---

const scalarFields = [
  { key: 'propertyValue', range: $('#propertyValueRange'), num: $('#propertyValueNum') },
  { key: 'loanAmount', range: $('#loanAmountRange'), num: $('#loanAmountNum') },
];

for (const f of scalarFields) {
  f.range.addEventListener('input', () => {
    f.num.value = f.range.value;
    active()[f.key] = Number(f.range.value);
    scheduleRecalc();
  });
  f.num.addEventListener('input', () => {
    const v = Math.max(0, Number(f.num.value) || 0);
    f.range.value = v;
    active()[f.key] = v;
    scheduleRecalc();
  });
  // blur with an empty/garbage field: restore the stored value
  f.num.addEventListener('change', () => {
    f.num.value = active()[f.key];
  });
}

$('#borrowers').addEventListener('change', (e) => {
  active().borrowers = Number(e.target.value);
  scheduleRecalc();
});

$('#scenarioName').addEventListener('input', (e) => {
  active().name = e.target.value;
  renderScenarioBar();
  scheduleRecalc();
});

// --- Segment editors ---
// Rows are rebuilt only on add/remove/re-sort/scenario-switch — never while
// typing or dragging, so focus is never stolen mid-edit.

function segYearInput(seg, first) {
  return `<label>Från år</label>
    <input type="number" class="seg-year" min="0" max="50" step="1" value="${seg.fromYear}" ${first ? 'disabled' : ''} />`;
}

// row 0 gets an invisible spacer instead of a button so sliders align across rows
const delButton = (first) =>
  first
    ? '<span class="seg-del-spacer"></span>'
    : '<button type="button" class="seg-del" title="Ta bort">✗</button>';

function buildRateRows() {
  $('#rateRows').replaceChildren(
    ...active().rateSegments.map((seg, i) => {
      const row = document.createElement('div');
      row.className = 'segment-row';
      row.dataset.index = i;
      row.innerHTML = `${segYearInput(seg, i === 0)}
        <input type="range" class="seg-range" min="0" max="10" step="0.05" value="${seg.annualRatePct}" aria-label="Ränta" />
        <input type="number" class="seg-val" min="0" max="100" step="0.05" value="${seg.annualRatePct}" />
        <span class="unit">%</span>
        ${delButton(i === 0)}`;
      return row;
    }),
  );
}

function buildAmortRows() {
  $('#amortRows').replaceChildren(
    ...active().amortSegments.map((seg, i) => {
      const r = AMORT_RANGE[seg.unit];
      const row = document.createElement('div');
      row.className = 'segment-row';
      row.dataset.index = i;
      row.innerHTML = `${segYearInput(seg, i === 0)}
        <input type="range" class="seg-range" min="${r.min}" max="${r.max}" step="${r.step}" value="${seg.value}" aria-label="Amortering" />
        <input type="number" class="seg-val" min="0" step="${r.step}" value="${seg.value}" />
        <select class="seg-unit" aria-label="Enhet">
          <option value="kr" ${seg.unit === 'kr' ? 'selected' : ''}>kr/mån</option>
          <option value="pct" ${seg.unit === 'pct' ? 'selected' : ''}>% per år</option>
        </select>
        ${delButton(i === 0)}`;
      return row;
    }),
  );
}

// Returns true if sorting changed the visible order (only then do rows rebuild).
function sortSegments(list) {
  const before = list.map((s) => s.fromYear).join();
  list.sort((a, b) => a.fromYear - b.fromYear);
  return list.map((s) => s.fromYear).join() !== before;
}

function bindSegmentEditor({ container, segments, addButton, buildRows, onInput, newSegment }) {
  container.addEventListener('input', (e) => {
    const row = e.target.closest('.segment-row');
    if (!row) return;
    const seg = segments()[Number(row.dataset.index)];
    if (e.target.classList.contains('seg-year')) {
      seg.fromYear = Math.max(0, Math.min(50, Math.round(Number(e.target.value) || 0)));
    } else {
      onInput(e.target, row, seg);
    }
    scheduleRecalc();
  });
  container.addEventListener('change', () => {
    if (sortSegments(segments())) buildRows();
    scheduleRecalc();
  });
  container.addEventListener('click', (e) => {
    if (!e.target.classList.contains('seg-del')) return;
    segments().splice(Number(e.target.closest('.segment-row').dataset.index), 1);
    buildRows();
    scheduleRecalc();
  });
  addButton.addEventListener('click', () => {
    const prev = segments().at(-1);
    segments().push(newSegment(prev));
    buildRows();
    scheduleRecalc();
  });
}

bindSegmentEditor({
  container: $('#rateRows'),
  segments: () => active().rateSegments,
  addButton: $('#addRateSegment'),
  buildRows: buildRateRows,
  newSegment: (prev) => ({ fromYear: Math.min(50, prev.fromYear + 5), annualRatePct: prev.annualRatePct }),
  onInput: (target, row, seg) => {
    const v = Math.max(0, Number(target.value) || 0);
    seg.annualRatePct = v;
    const twin = target.classList.contains('seg-range') ? row.querySelector('.seg-val') : row.querySelector('.seg-range');
    twin.value = v;
  },
});

// --- Räntespann (per scenario: kryssruta + ± i procentenheter) ---

$('#rateBandToggle').addEventListener('change', (e) => {
  active().showRateBand = e.target.checked;
  $('#rateSpread').disabled = !e.target.checked;
  $('#rateBandHint').hidden = !e.target.checked;
  scheduleRecalc();
});

$('#rateSpread').addEventListener('input', (e) => {
  active().rateSpreadPct = Math.max(0, Number(e.target.value) || 0);
  scheduleRecalc();
});
$('#rateSpread').addEventListener('change', (e) => {
  e.target.value = active().rateSpreadPct; // blur med tomt/skräp: återställ
});

bindSegmentEditor({
  container: $('#amortRows'),
  segments: () => active().amortSegments,
  addButton: $('#addAmortSegment'),
  buildRows: buildAmortRows,
  newSegment: (prev) => ({ fromYear: Math.min(50, prev.fromYear + 5), value: prev.value, unit: prev.unit }),
  onInput: (target, row, seg) => {
    if (target.classList.contains('seg-unit')) {
      // convert so the amount keeps its meaning: kr/mån ⇄ % av ursprungligt lån per år
      const loan = active().loanAmount || 1;
      seg.unit = target.value;
      seg.value =
        seg.unit === 'pct'
          ? Math.round(((seg.value * 1200) / loan) * 100) / 100
          : Math.round(((seg.value / 100) * loan) / 12);
      const r = AMORT_RANGE[seg.unit];
      const range = row.querySelector('.seg-range');
      range.min = r.min;
      range.max = r.max;
      range.step = r.step;
      range.value = seg.value;
      const num = row.querySelector('.seg-val');
      num.step = r.step;
      num.value = seg.value;
      return;
    }
    const v = Math.max(0, Number(target.value) || 0);
    seg.value = v;
    const twin = target.classList.contains('seg-range') ? row.querySelector('.seg-val') : row.querySelector('.seg-range');
    twin.value = v;
  },
});

// --- Amortization mode ---

for (const radio of document.querySelectorAll('input[name="amortMode"]')) {
  radio.addEventListener('change', () => {
    active().amortMode = radio.value;
    $('#amortManualSection').hidden = radio.value !== 'manual';
    scheduleRecalc();
  });
}

// --- Scenarios ---

function renderScenarioBar() {
  $('#scenarioBar').replaceChildren(
    ...state.scenarios.map((sc) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.id = sc.id;
      btn.setAttribute('aria-pressed', String(sc.id === state.activeId));
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.background = PALETTE[sc.colorIndex];
      btn.append(chip, sc.name || '(namnlöst)');
      return btn;
    }),
  );
  $('#addScenario').disabled = state.scenarios.length >= MAX_SCENARIOS;
  $('#deleteScenario').disabled = state.scenarios.length <= 1;
}

$('#scenarioBar').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-id]');
  if (!btn || btn.dataset.id === state.activeId) return;
  state.activeId = btn.dataset.id;
  renderScenarioBar();
  syncControls();
  scheduleRecalc();
});

$('#addScenario').addEventListener('click', () => {
  if (state.scenarios.length >= MAX_SCENARIOS) return;
  const copy = structuredClone(active());
  copy.id = crypto.randomUUID();
  copy.name = `${copy.name} (kopia)`.slice(0, 30);
  const used = new Set(state.scenarios.map((s) => s.colorIndex));
  copy.colorIndex = PALETTE.findIndex((_, i) => !used.has(i));
  state.scenarios.push(copy);
  state.activeId = copy.id;
  renderScenarioBar();
  syncControls();
  scheduleRecalc();
});

$('#deleteScenario').addEventListener('click', () => {
  if (state.scenarios.length <= 1) return;
  if (!confirm(`Ta bort scenariot "${active().name}"?`)) return;
  const i = state.scenarios.findIndex((s) => s.id === state.activeId);
  state.scenarios.splice(i, 1);
  state.activeId = state.scenarios[Math.max(0, i - 1)].id;
  renderScenarioBar();
  syncControls();
  scheduleRecalc();
});

// --- Regler (global rule overrides, non-modal Win98 window) ---

const rulesDialog = $('#rulesDialog');
const ruleInputs = [...rulesDialog.querySelectorAll('input[data-rule]')];

function syncRuleInputs() {
  for (const el of ruleInputs) el.value = state.rules[el.dataset.rule];
}

function openRulesDialog(ruleKey) {
  if (!rulesDialog.open) rulesDialog.show(); // non-modal: charts stay live
  const target = ruleKey ? rulesDialog.querySelector(`input[data-rule="${ruleKey}"]`) : ruleInputs[0];
  target.focus();
  target.select();
}

rulesDialog.addEventListener('input', (e) => {
  const key = e.target.dataset.rule;
  if (!key) return;
  // raw while typing (simulate normalizes defensively); clamped on blur below
  state.rules[key] = Math.max(0, Number(e.target.value) || 0);
  scheduleRecalc();
});

rulesDialog.addEventListener('change', () => {
  state.rules = normalizeRules(state.rules);
  syncRuleInputs();
  scheduleRecalc();
});

// Esc closes modal dialogs natively, but not non-modal ones
rulesDialog.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') rulesDialog.close();
});

$('#rulesClose').addEventListener('click', () => rulesDialog.close());
$('#rulesButton').addEventListener('click', () => openRulesDialog());

$('#rulesResetLaw').addEventListener('click', () => {
  state.rules = { ...LAW_RULES };
  syncRuleInputs();
  scheduleRecalc();
});

// Drag the Regler window by its title bar. No native API exists for moving
// elements (HTML:s draggable-attribut är för dataöverföring, inte fönster),
// so this composes the standard Pointer Events pattern by hand.
const rulesTitleBar = rulesDialog.querySelector('.title-bar');
let drag = null; // { dx, dy } = grab offset while dragging

rulesTitleBar.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.title-bar-controls')) return; // X-knappen är inte ett drag
  const rect = rulesDialog.getBoundingClientRect();
  drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
  // switch from right-anchored CSS to explicit left/top; freeze width so the
  // narrow-viewport left+right stretch rule can't reflow mid-drag
  rulesDialog.style.width = `${rect.width}px`;
  rulesDialog.style.left = `${rect.left}px`;
  rulesDialog.style.top = `${rect.top}px`;
  rulesDialog.style.right = 'auto';
  try {
    rulesTitleBar.setPointerCapture(e.pointerId); // smooth drag outside the bar; best effort
  } catch {
    // pointer already gone (or synthetic event) — drag still works via bubbling
  }
});

rulesTitleBar.addEventListener('pointermove', (e) => {
  if (!drag) return;
  // clamp so a grabbable piece of the title bar always stays in the viewport
  const x = Math.min(Math.max(e.clientX - drag.dx, 60 - rulesDialog.offsetWidth), window.innerWidth - 60);
  const y = Math.min(Math.max(e.clientY - drag.dy, 0), window.innerHeight - 30);
  rulesDialog.style.left = `${x}px`;
  rulesDialog.style.top = `${y}px`;
});

rulesTitleBar.addEventListener('pointerup', () => {
  drag = null;
});
rulesTitleBar.addEventListener('pointercancel', () => {
  drag = null;
});

// [ändra] links: delegated at document level so the ones rebuilt inside
// #amortWarnings on every recalc need no rebinding
document.addEventListener('click', (e) => {
  const link = e.target.closest('a.rule-link');
  if (!link) return;
  e.preventDefault();
  openRulesDialog(link.dataset.rule);
});

// --- Reset ---

$('#resetAll').addEventListener('click', () => {
  if (!confirm('Återställ allt till standardvärden?')) return;
  state = defaultState();
  localStorage.removeItem(STORAGE_KEY);
  renderScenarioBar();
  syncControls();
  syncRuleInputs();
  scheduleRecalc();
});

// --- Init ---

function syncControls() {
  const sc = active();
  for (const f of scalarFields) {
    f.range.value = sc[f.key];
    f.num.value = sc[f.key];
  }
  $('#borrowers').value = String(sc.borrowers);
  $('#scenarioName').value = sc.name;
  $('#rateBandToggle').checked = sc.showRateBand === true;
  $('#rateSpread').value = sc.rateSpreadPct;
  $('#rateSpread').disabled = sc.showRateBand !== true;
  $('#rateBandHint').hidden = sc.showRateBand !== true;
  $('#amortModeAuto').checked = sc.amortMode === 'auto';
  $('#amortModeManual').checked = sc.amortMode === 'manual';
  $('#amortManualSection').hidden = sc.amortMode !== 'manual';
  buildRateRows();
  buildAmortRows();
}

renderScenarioBar();
syncControls();
syncRuleInputs();
recalc();
