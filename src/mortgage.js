// Pure calculation engine — no DOM, runnable under plain `node` for sanity checks.

const MAX_YEARS = 50;

// Regelparametrar med lagens nivåer (från 1 april 2026) som standard.
// Alla beräkningar tar ett rules-objekt så att värdena kan ändras i appen.
export const LAW_RULES = Object.freeze({
  bolanetakPct: 90, // max lån i % av bostadens värde
  amortLtvHighPct: 70, // belåningsgrad över detta → högre kravet
  amortLtvLowPct: 50, // belåningsgrad över detta → lägre kravet, under → inget
  amortRateHighPct: 2, // %/år av ursprungligt lån
  amortRateLowPct: 1,
  deductionRatePct: 30, // ränteavdrag upp till taket
  deductionRateAbovePct: 21, // ränteavdrag över taket
  deductionCapPerPerson: 100_000, // kr räntekostnad per person och år
});

const clampNum = (v, lo, hi, fallback = lo) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

// Sort by fromYear (same fromYear → last in list order wins), force a segment at year 0.
function normalizeSegments(segments, cleanOne, fallback) {
  const cleaned = (Array.isArray(segments) ? segments : []).map(cleanOne);
  if (cleaned.length === 0) cleaned.push(fallback);
  const byYear = new Map();
  for (const seg of cleaned) byYear.set(seg.fromYear, seg);
  const sorted = [...byYear.values()].sort((a, b) => a.fromYear - b.fromYear);
  sorted[0] = { ...sorted[0], fromYear: 0 };
  return sorted;
}

// Same defensive philosophy as normalizeScenario: garbage in → clamped rules
// out, missing keys fall back to lagens nivåer. Never throws.
export function normalizeRules(rules) {
  rules = rules ?? {};
  const pct = (k) => clampNum(rules[k], 0, 100, LAW_RULES[k]);
  const r = {
    bolanetakPct: pct('bolanetakPct'),
    amortLtvHighPct: pct('amortLtvHighPct'),
    amortLtvLowPct: pct('amortLtvLowPct'),
    amortRateHighPct: pct('amortRateHighPct'),
    amortRateLowPct: pct('amortRateLowPct'),
    deductionRatePct: pct('deductionRatePct'),
    deductionRateAbovePct: pct('deductionRateAbovePct'),
    deductionCapPerPerson: clampNum(rules.deductionCapPerPerson, 0, 10_000_000, LAW_RULES.deductionCapPerPerson),
  };
  r.amortLtvLowPct = Math.min(r.amortLtvLowPct, r.amortLtvHighPct);
  return r;
}

// Defensive sanitization: garbage in → clamped scenario out. Never throws.
export function normalizeScenario(sc) {
  sc = sc ?? {};
  const rateMaxPct = clampNum(sc.rateMaxPct, 0, 100, 0);
  return {
    ...sc,
    propertyValue: clampNum(sc.propertyValue, 0, 100_000_000),
    loanAmount: clampNum(sc.loanAmount, 0, 100_000_000),
    borrowers: Math.round(clampNum(sc.borrowers, 1, 4, 2)),
    showRateBand: sc.showRateBand === true,
    rateMinPct: Math.min(clampNum(sc.rateMinPct, 0, 100, 0), rateMaxPct), // förväntat räntespann, min ≤ max
    rateMaxPct,
    amortMode: sc.amortMode === 'manual' ? 'manual' : 'auto',
    rateSegments: normalizeSegments(
      sc.rateSegments,
      (s) => ({
        fromYear: Math.round(clampNum(s?.fromYear, 0, MAX_YEARS)),
        annualRatePct: clampNum(s?.annualRatePct, 0, 100),
      }),
      { fromYear: 0, annualRatePct: 0 },
    ),
    amortSegments: normalizeSegments(
      sc.amortSegments,
      (s) => ({
        fromYear: Math.round(clampNum(s?.fromYear, 0, MAX_YEARS)),
        value: clampNum(s?.value, 0, 10_000_000),
        unit: s?.unit === 'pct' ? 'pct' : 'kr',
      }),
      { fromYear: 0, value: 0, unit: 'kr' },
    ),
  };
}

// Last segment whose start month <= m. Assumes sorted with fromYear 0 first.
function segmentAt(segments, m) {
  let current = segments[0];
  for (const seg of segments) {
    if (seg.fromYear * 12 <= m) current = seg;
    else break;
  }
  return current;
}

// Amorteringskrav — standardnivåer enligt lagen från 1 april 2026: 2 %/år av
// ursprungligt lån om LTV > 70 %, 1 % om > 50 %. (Det skärpta skuldkvotskravet
// på +1 % över 4,5 × bruttoinkomst är avskaffat.) Förenkling: LTV räknas på
// aktuell skuld mot konstant bostadsvärde (banker omvärderar högst vart 5:e år).
// Anropas i simulate-loopens hetaste väg — rules förutsätts redan normaliserade.
export function legalMinMonthly(balance, sc, rules = LAW_RULES) {
  const ltv = sc.propertyValue > 0 ? balance / sc.propertyValue : Infinity;
  const pct =
    ltv > rules.amortLtvHighPct / 100 ? rules.amortRateHighPct : ltv > rules.amortLtvLowPct / 100 ? rules.amortRateLowPct : 0;
  return { pct, monthly: (pct / 100) * sc.loanAmount / 12 };
}

// Monthly simulation. Month 0 = January of startYear (mid-year proration skipped).
export function simulate(scenario, { maxYears = MAX_YEARS, startYear, rules } = {}) {
  const sc = normalizeScenario(scenario);
  rules = normalizeRules(rules);
  const out = {
    startYear,
    payoffMonth: null,
    balance: [],
    interestGross: [],
    interestNet: [],
    amort: [],
    minAmort: [],
    paymentGross: [],
    paymentNet: [],
    cumInterestGross: [],
    cumInterestNet: [],
    warnings: [],
    totals: { interestGross: 0, interestNet: 0, deduction: 0 },
  };

  const deductionCap = rules.deductionCapPerPerson * sc.borrowers;
  let balance = sc.loanAmount;
  let ytdInterest = 0;
  let cumGross = 0;
  let cumNet = 0;

  for (let m = 0; m < maxYears * 12; m++) {
    if (m % 12 === 0) ytdInterest = 0;

    const rate = segmentAt(sc.rateSegments, m).annualRatePct / 100;
    const interest = (balance * rate) / 12;
    const below = Math.max(0, Math.min(interest, deductionCap - ytdInterest));
    const deduction = below * (rules.deductionRatePct / 100) + (interest - below) * (rules.deductionRateAbovePct / 100);
    ytdInterest += interest;

    const minA = legalMinMonthly(balance, sc, rules).monthly;
    let amort;
    if (sc.amortMode === 'auto') {
      amort = minA;
    } else {
      const seg = segmentAt(sc.amortSegments, m);
      amort = seg.unit === 'kr' ? seg.value : (seg.value / 100) * sc.loanAmount / 12;
      if (amort < minA - 0.5) {
        const last = out.warnings.at(-1);
        const segIndex = sc.amortSegments.indexOf(seg);
        if (last && last.segIndex === segIndex && last.toMonth === m - 1) {
          last.toMonth = m;
        } else {
          out.warnings.push({ type: 'belowLegalMinimum', segIndex, fromMonth: m, toMonth: m, minAtStart: minA });
        }
      }
    }
    amort = Math.min(amort, balance);
    balance -= amort;

    const net = interest - deduction;
    cumGross += interest;
    cumNet += net;
    out.balance.push(balance);
    out.interestGross.push(interest);
    out.interestNet.push(net);
    out.amort.push(amort);
    out.minAmort.push(minA);
    out.paymentGross.push(amort + interest);
    out.paymentNet.push(amort + net);
    out.cumInterestGross.push(cumGross);
    out.cumInterestNet.push(cumNet);

    if (balance <= 0.005) {
      out.payoffMonth = m;
      break;
    }
  }

  out.months = out.balance.length;
  out.totals = { interestGross: cumGross, interestNet: cumNet, deduction: cumGross - cumNet };
  return out;
}

// Row values for the comparison table. Numbers are raw; null = paid off before
// that point ("—" at display time). payoffLabel is null if never repaid in horizon.
export function keyFigures(result) {
  const at = (i) => (i < result.months ? result.paymentNet[i] : result.payoffMonth != null ? null : undefined);
  return {
    netMonthlyNow: result.paymentNet[0] ?? 0,
    netMonthlyYear5: at(60),
    netMonthlyYear10: at(120),
    payoffLabel:
      result.payoffMonth != null
        ? new Date(result.startYear, result.payoffMonth, 1).toLocaleDateString('sv-SE', { month: 'short', year: 'numeric' })
        : null,
    totalInterestGross: result.totals.interestGross,
    totalInterestNet: result.totals.interestNet,
  };
}
