export const config = { runtime: 'edge' };

import {
  ASSUMPTIONS as A,
  PRICES,
  calcTakehome,
  calcBabyTotal,
  monthlyRate,
  getEventData,
  buildEventMarkers,
  json,
  corsHeaders,
} from './_utils.js';

function simulate({ salary, asset, living, investRate, targetPrice, age, raisePct, promoRaise, maxSalary, events, maxMonths = A.defaultMaxMonths }) {
  const mR = monthlyRate(investRate);
  let cur = asset;
  const chart = [];
  for (let m = 0; m <= maxMonths; m++) {
    const yr = Math.floor(m / 12), curAge = age + yr;
    let sal = salary * (1 + raisePct / 100) ** yr;
    if (promoRaise && yr > 0 && yr % A.promoEveryYears === 0) sal *= A.promoBonusMultiplier;
    sal = Math.min(sal, maxSalary || A.unlimitedSalarySentinel);
    const netM = calcTakehome(Math.round(sal));
    const carM = (curAge >= (events.carAge || A.carAgeDefault) && events.carOn) ? events.carMonthly : 0;
    const babyM = events.monthlyBabyByYr[yr] || 0, evC = m % 12 === 0 ? (events.extraByYear[yr] || 0) : 0;
    cur = Math.max(0, cur) * (1 + mR) + (netM - living - carM - babyM) - evC;
    if (m % 12 === 0) chart.push({ year: yr, age: curAge, asset: Math.round(cur), netMonthly: netM, monthlyExpense: living + carM + babyM });
    if (cur >= targetPrice) return { years: Math.ceil((m + 1) / 12), reachedMonth: m, chartData: chart, netMonthly: calcTakehome(salary), carMonthly: events.carMonthly };
  }
  return { years: null, reachedMonth: -1, chartData: chart, netMonthly: calcTakehome(salary), carMonthly: events.carMonthly };
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
      carOn = false, carCost = A.carCostDefault, carAge = A.carAgeDefault,
    } = await req.json();

    if (!salary || salary < 500) return json({ error: '연봉 입력 필요' }, 400);
    const targetPrice = PRICES[region]?.[size];
    if (!targetPrice) return json({ error: '지역/평수 오류' }, 400);

    const evCfg = { weddingOn, weddingCost, weddingAge, babyOn, babyCost, babyAge, carOn, carCost, carAge };
    const events = { ...getEventData(evCfg, age), carAge, carOn };
    const result = simulate({ salary, asset, living, investRate, targetPrice, age, raisePct, promoRaise, maxSalary, events });

    const netMonthly = result.netMonthly;
    const babyTotal = babyOn ? calcBabyTotal(babyCost) : 0;
    const monthlyInvest = Math.round(asset * monthlyRate(investRate));

    return json({
      ...result, targetPrice, monthlyInvest, totalIncome: netMonthly + monthlyInvest,
      monthlySave: netMonthly - living, savingRate: Math.round((netMonthly - living) / netMonthly * 100),
      weddingCost: weddingOn ? weddingCost : 0, babyTotal, carCost: carOn ? carCost : 0,
      totalEventCost: (weddingOn ? weddingCost : 0) + babyTotal + (carOn ? carCost : 0),
      eventMarkers: buildEventMarkers(evCfg, age),
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
