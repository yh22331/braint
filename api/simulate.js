export const config = { runtime: 'edge' };

import {
  ASSUMPTIONS as A,
  PRICES,
  calcTakehome,
  calcBabyTotal,
  calcLivingCost,
  calcLoanAmount,
  monthlyRate,
  getEventData,
  buildEventMarkers,
  json,
  corsHeaders,
} from './_utils.js';

function simulate({ salary, asset, living, investRate, targetPrice, age, raisePct, promoRaise, maxSalary, events, weddingStartYr, loanAmt, loanRate, maxMonths = A.defaultMaxMonths }) {
  const mR = monthlyRate(investRate);
  const r30 = loanAmt > 0 ? loanRate / 100 / 12 : 0;
  const monthlyLoanPayment = (loanAmt > 0 && r30 > 0)
    ? Math.round(loanAmt * r30 * Math.pow(1 + r30, A.loanTermMonths) / (Math.pow(1 + r30, A.loanTermMonths) - 1))
    : 0;
  let cur = asset, reachedMonth = cur >= targetPrice ? 0 : -1;
  const chart = [];
  for (let m = 0; m <= maxMonths; m++) {
    const yr = Math.floor(m / 12), curAge = age + yr;
    let sal = salary * (1 + raisePct / 100) ** yr;
    if (promoRaise && yr > 0 && yr % A.promoEveryYears === 0) sal *= A.promoBonusMultiplier;
    sal = Math.min(sal, maxSalary || A.unlimitedSalarySentinel);
    const netM = calcTakehome(Math.round(sal));
    const carM = (curAge >= (events.carAge || A.carAgeDefault) && events.carOn) ? events.carMonthly : 0;
    const babyM = events.monthlyBabyByYr[yr] || 0, evC = m % 12 === 0 ? (events.extraByYear[yr] || 0) : 0;
    // 생활비: 결혼 시 1.5배 + 연 2.5% 인플레 (bf-home과 동일)
    const livingM = calcLivingCost(living, yr >= weddingStartYr, yr);
    const loanM = reachedMonth >= 0 ? monthlyLoanPayment : 0; // 주택담보대출: 집 구매 후부터 상환
    cur = Math.max(0, cur) * (1 + mR) + (netM - livingM - loanM - carM - babyM) - evC;
    if (m % 12 === 0) chart.push({ year: yr, age: curAge, asset: Math.round(cur), netMonthly: netM, monthlyExpense: livingM + loanM + carM + babyM });
    if (reachedMonth < 0 && cur >= targetPrice) { reachedMonth = m + 1; cur = 0; } // 집 구매 = 자산 전액 사용
  }
  return {
    years: reachedMonth >= 0 ? Math.ceil(reachedMonth / 12) : null,
    reachedMonth, chartData: chart,
    netMonthly: calcTakehome(salary), carMonthly: events.carMonthly, monthlyLoanPayment,
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const {
      salary, asset = 0, region = 'seoul', size = 'mid',
      living = A.livingDefault, investRate = 3, age = A.ageDefault,
      raisePct = 3, promoRaise = true, maxSalary = A.unlimitedSalarySentinel,
      weddingOn = false, weddingCost = A.weddingCostDefault, weddingAge = A.weddingAgeDefault,
      babyOn = false, babyCost = A.babyCostDefault, babyAge = A.babyAgeDefault,
      carOn = false, carCost = A.carCostDefault, carAge = A.carAgeDefault, loanOn = false,
    } = await req.json();

    if (!salary || salary < 500) return json({ error: '연봉 입력 필요' }, 400);
    const targetPrice = PRICES[region]?.[size];
    if (!targetPrice) return json({ error: '지역/평수 오류' }, 400);

    const loanAmt = loanOn ? Math.round(calcLoanAmount(targetPrice)) : 0;
    const effectiveTarget = targetPrice - loanAmt;
    const weddingStartYr = weddingOn ? Math.max(0, weddingAge - age) : A.weddingStartNeverSentinel;

    const evCfg = { weddingOn, weddingCost, weddingAge, babyOn, babyCost, babyAge, carOn, carCost, carAge };
    const events = { ...getEventData(evCfg, age), carAge, carOn };
    const result = simulate({
      salary, asset, living, investRate, targetPrice: effectiveTarget, age,
      raisePct, promoRaise, maxSalary, events, weddingStartYr, loanAmt, loanRate: A.loanRate,
    });

    const netMonthly = result.netMonthly;
    const babyTotal = babyOn ? calcBabyTotal(babyCost) : 0;
    const monthlyInvest = Math.round(asset * monthlyRate(investRate));
    // monthlySave/savingRate 기준 시점: 집 구매 시점(못 사면 0년차) — bf-home과 동일
    const refYr = result.reachedMonth >= 0 ? Math.floor(result.reachedMonth / 12) : 0;
    const refLiving = calcLivingCost(living, refYr >= weddingStartYr, refYr);

    return json({
      ...result, targetPrice, effectiveTarget, loanAmt, monthlyInvest, totalIncome: netMonthly + monthlyInvest,
      monthlySave: netMonthly - refLiving, savingRate: Math.round((netMonthly - refLiving) / netMonthly * 100),
      weddingCost: weddingOn ? weddingCost : 0, babyTotal, carCost: carOn ? carCost : 0,
      totalEventCost: (weddingOn ? weddingCost : 0) + babyTotal + (carOn ? carCost : 0),
      eventMarkers: buildEventMarkers(evCfg, age),
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
