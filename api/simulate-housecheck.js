export const config = { runtime: 'edge' };

import {
  ASSUMPTIONS as A,
  calcTakehome,
  calcBabyTotal,
  monthlyRate,
  json,
  corsHeaders,
} from './_utils.js';

function simulate({ netSalary, initAsset, targetPrice, investRate = 5, extraByYear = {}, monthlyBabyByYr = {},
  loanAmt = 0, loanRate = A.loanRate, annualRaisePct = 3, promoRaise = false, promoBasePct = 3,
  maxNetSalary = A.unlimitedSalarySentinel, carStartYr = A.carStartNeverSentinel,
  carMonthlyMaint = 0, livingCost = A.livingDefault, maxMonths = A.defaultMaxMonths }) {
  const mR = monthlyRate(investRate);
  const r30 = loanAmt > 0 ? loanRate / 100 / 12 : 0;
  const mlp = (loanAmt > 0 && r30 > 0)
    ? Math.round(loanAmt * r30 * Math.pow(1 + r30, A.loanTermMonths) / (Math.pow(1 + r30, A.loanTermMonths) - 1))
    : 0;
  let asset = initAsset, cur = netSalary, reached = -1;
  if (asset >= targetPrice) reached = 0;
  const results = [];
  for (let m = 0; m <= maxMonths; m++) {
    const yr = Math.floor(m / 12), mon = m % 12;
    if (mon === 0 && m > 0) {
      if (promoRaise) {
        cur *= (1 + promoBasePct / 100);
        if (yr % A.promoEveryYears === 0) cur *= A.promoBonusMultiplier;
      } else {
        cur *= (1 + annualRaisePct / 100);
      }
      cur = Math.min(cur, maxNetSalary);
    }
    const carM = yr >= carStartYr ? carMonthlyMaint : 0, babyM = monthlyBabyByYr[yr] || 0, evC = mon === 0 ? (extraByYear[yr] || 0) : 0;
    asset = Math.max(0, asset) * (1 + mR) + (cur / 12 - livingCost - mlp - carM - babyM) - evC;
    if (m % 12 === 0) results.push({ year: yr, age: 0, asset: Math.round(asset), netMonthly: Math.round(cur / 12), monthlyExpense: Math.round(livingCost + mlp + carM + babyM) });
    if (reached < 0 && asset >= targetPrice) reached = m + 1;
  }
  return { results, reachedMonth: reached, monthlyLoanPayment: mlp };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const {
      age = A.ageDefault, salary, asset = 0, housePrice,
      living = A.livingDefault, investRate = 5, raiseMode = 'fixed', raisePct = 3, loan = false,
      weddingOn = false, weddingCost = A.weddingCostDefault, weddingAge = A.weddingAgeDefault,
      babyOn = false, babyCost = A.babyCostDefault, babyAge = A.babyAgeDefault,
      carOn = false, carType = 'domestic', carCost = A.carCostDefault, carAge = A.carAgeDefault,
    } = await req.json();
    if (!salary || salary < 500) return json({ error: '연봉 입력 필요' }, 400);
    if (!housePrice || housePrice < 1000) return json({ error: '집값 입력 필요' }, 400);
    const th = calcTakehome(salary), net = th * 12;
    const la = loan ? Math.round(housePrice * A.ltvRatio) : 0, et = housePrice - la;
    const ex = {}, by = {};
    if (weddingOn) { const yr = Math.max(0, weddingAge - age); ex[yr] = (ex[yr] || 0) + weddingCost; }
    if (babyOn) {
      const s = Math.max(0, babyAge - age);
      for (let i = 0; i < A.babyYears; i++) {
        const yr = s + i;
        const c = Math.min(Math.round(babyCost * Math.pow(A.babyInflation, i)), A.babyAnnualCapManwon);
        by[yr] = (by[yr] || 0) + Math.round(c / 12);
      }
    }
    // housecheck 전용 차량 유지비 공식 (carType별 가/중/감/연료 차등)
    const cm = { domestic: { f: 15, i: 10, r: 5 }, foreign: { f: 25, i: 20, r: 15 }, super: { f: 50, i: 50, r: 50 } }[carType] || { f: 15, i: 10, r: 5 };
    const bp = { domestic: 3500, foreign: 8000, super: 30000 }[carType] || 3500;
    const ratio = Math.max(0.5, Math.min(3, carCost / bp));
    const cMaint = carOn ? Math.round(cm.f * Math.sqrt(ratio) + cm.i * ratio + cm.r * Math.sqrt(ratio) + carCost * 0.10 / 12) : 0;
    if (carOn) { const yr = Math.max(0, carAge - age); ex[yr] = (ex[yr] || 0) + carCost; }
    const sim = simulate({
      netSalary: net, initAsset: asset, targetPrice: et, investRate, extraByYear: ex, monthlyBabyByYr: by,
      loanAmt: la, loanRate: A.loanRate, annualRaisePct: raisePct, promoRaise: raiseMode === 'promo', promoBasePct: raisePct,
      maxNetSalary: calcTakehome(A.maxSalaryCapManwon) * 12,
      carStartYr: carOn ? Math.max(0, carAge - age) : A.carStartNeverSentinel,
      carMonthlyMaint: cMaint, livingCost: living,
    });
    const yrs = sim.reachedMonth > 0 ? Math.ceil(sim.reachedMonth / 12) : null;
    const bt = babyOn ? calcBabyTotal(babyCost) : 0;
    return json({
      years: yrs, reachedMonth: sim.reachedMonth, achieveAge: yrs ? age + yrs : null,
      housePrice, effectiveTarget: et, loanAmt: la, monthlyLoanPayment: sim.monthlyLoanPayment,
      takeHome: th, monthlySave: th - living - cMaint, savingRate: Math.round((th - living) / th * 100),
      carMonthly: cMaint, totalEventCost: (weddingOn ? weddingCost : 0) + bt + (carOn ? carCost : 0),
      chartData: sim.results.map(r => ({ ...r, age: age + r.year })),
      eventMarkers: {
        wedding: weddingOn ? { year: Math.max(0, weddingAge - age), age: weddingAge } : null,
        baby:    babyOn    ? { year: Math.max(0, babyAge - age),    age: babyAge    } : null,
        car:     carOn     ? { year: Math.max(0, carAge - age),     age: carAge     } : null,
      },
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
