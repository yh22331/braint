export const config = { runtime: 'edge' };

import {
  ASSUMPTIONS as A,
  PRICES,
  MY_ASSETS,
  calcTakehome,
  calcBabyTotal,
  monthlyRate,
  getEventData,
  buildEventMarkers,
  json,
  corsHeaders,
} from './_utils.js';

function simulateBF({ netSalary, initAsset, targetPrice, investRate = 0,
  extraByYear = {}, monthlyBabyByYr = {}, loanAmt = 0, loanRate = A.loanRate,
  annualRaisePct = 0, promoRaise = false, promoBasePct = 3, maxNetSalary = A.unlimitedSalarySentinel,
  carStartYr = A.carStartNeverSentinel, carMonthlyMaint = 0, livingCost = A.livingDefault, maxMonths = A.defaultMaxMonths }) {
  const monthlyR = monthlyRate(investRate);
  const r30 = loanAmt > 0 ? loanRate / 100 / 12 : 0;
  const monthlyLoanPayment = (loanAmt > 0 && r30 > 0)
    ? Math.round(loanAmt * r30 * Math.pow(1 + r30, A.loanTermMonths) / (Math.pow(1 + r30, A.loanTermMonths) - 1))
    : 0;
  let asset = initAsset, currentNet = netSalary, reachedMonth = -1;
  if (asset >= targetPrice) reachedMonth = 0;
  const results = [];
  for (let m = 0; m < maxMonths; m++) {
    const yr = Math.floor(m / 12), mon = m % 12;
    if (mon === 0 && m > 0) {
      if (promoRaise) {
        currentNet *= (1 + promoBasePct / 100);
        if (yr % A.promoEveryYears === 0) currentNet *= A.promoBonusMultiplier;
      } else {
        currentNet *= (1 + annualRaisePct / 100);
      }
      currentNet = Math.min(currentNet, maxNetSalary);
    }
    const netM = currentNet / 12, carM = yr >= carStartYr ? carMonthlyMaint : 0;
    const babyM = monthlyBabyByYr[yr] || 0, evCost = mon === 0 ? (extraByYear[yr] || 0) : 0;
    asset = Math.max(0, asset) * (1 + monthlyR) + (netM - livingCost - monthlyLoanPayment - carM - babyM) - evCost;
    results.push({
      year: yr, age: 0, asset: Math.round(asset), netMonthly: Math.round(currentNet / 12),
      monthlyExpense: Math.round(livingCost + monthlyLoanPayment + carM + babyM),
      label: mon === 0 && extraByYear[yr] ? ['이벤트'] : null, housePurchase: false,
    });
    if (reachedMonth < 0 && asset >= targetPrice) {
      reachedMonth = m + 1;
      results.push({
        year: yr, age: 0, asset: 0, netMonthly: Math.round(currentNet / 12),
        monthlyExpense: 0, label: ['🏠집구매'], housePurchase: true,
      });
      if (m >= 240) break;
    }
  }
  return { results, reachedMonth, monthlyLoanPayment };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const {
      salary, asset = 0, myAsset = 'none', region = 'seoul', size = 'mid',
      living = A.livingDefault, investRate = 5, age = A.ageDefault,
      raisePct = 3, promoRaise = true, maxSalary = A.maxSalaryCapManwon,
      weddingOn = false, weddingCost = A.weddingCostDefault, weddingAge = A.weddingAgeDefault,
      babyOn = false, babyCost = A.babyCostDefault, babyAge = A.babyAgeDefault,
      carOn = false, carCost = A.carCostDefault, carAge = A.carAgeDefault, loanOn = false,
    } = await req.json();

    if (!salary || salary < 500) return json({ error: '연봉 입력 필요' }, 400);
    const targetPrice = PRICES[region]?.[size];
    if (!targetPrice) return json({ error: '지역/평수 오류' }, 400);

    const initAsset = (MY_ASSETS[myAsset] || 0) + (asset || 0);
    const netSalary = calcTakehome(salary) * 12;
    const loanAmt = loanOn ? Math.round(targetPrice * A.ltvRatio) : 0;
    const effectiveTarget = targetPrice - loanAmt;

    const evCfg = { weddingOn, weddingCost, weddingAge, babyOn, babyCost, babyAge, carOn, carCost, carAge };
    const ev = getEventData(evCfg, age);
    const eventMarkers = buildEventMarkers(evCfg, age);
    const carMonthlyMaint = ev.carMonthly;

    const maxNetSalary = calcTakehome(maxSalary) * 12;
    const sim = simulateBF({
      netSalary, initAsset, targetPrice: effectiveTarget, investRate,
      extraByYear: ev.extraByYear, monthlyBabyByYr: ev.monthlyBabyByYr,
      loanAmt, loanRate: A.loanRate,
      annualRaisePct: promoRaise ? 0 : raisePct, promoRaise, promoBasePct: raisePct,
      maxNetSalary,
      carStartYr: carOn ? Math.max(0, carAge - age) : A.carStartNeverSentinel,
      carMonthlyMaint, livingCost: living,
    });

    const years = sim.reachedMonth > 0 ? Math.ceil(sim.reachedMonth / 12) : null;
    const netMonthly = calcTakehome(salary);
    const babyTotal = babyOn ? calcBabyTotal(babyCost) : 0;
    const totalEventCost = (weddingOn ? weddingCost : 0) + babyTotal + (carOn ? carCost : 0);
    // 연간 데이터만 추출 (집구매 마커는 보존)
    const chartData = sim.results.filter(r => r.label?.includes('🏠집구매') ||
      sim.results.indexOf(r) % 12 === 0).map(r => ({ ...r, age: age + r.year }));

    return json({
      years, reachedMonth: sim.reachedMonth, targetPrice, effectiveTarget, loanAmt,
      monthlyLoanPayment: sim.monthlyLoanPayment, netMonthly,
      monthlySave: netMonthly - living - carMonthlyMaint,
      savingRate: Math.round((netMonthly - living) / netMonthly * 100),
      carMonthly: carMonthlyMaint, totalEventCost,
      weddingCost: weddingOn ? weddingCost : 0, babyTotal, carCost: carOn ? carCost : 0,
      chartData, eventMarkers,
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
