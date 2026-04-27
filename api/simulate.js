// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// api/simulate.js - 개인 시뮬레이션 (BF + 커플)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const config = { runtime: 'edge' };
import { PRICES, calcTakehome, getEventDataFor, calcBabyTotal, simulatePersonal, corsHeaders, json } from './_utils.js';

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null, { headers: corsHeaders() });
  if(req.method!=='POST') return json({ error: 'POST only' }, 405);

  try {
    const body = await req.json();
    const {
      salary, asset, region='seoul', size='mid',
      living=200, investRate=3, age=30,
      raisePct=3, promoRaise=true, maxSalary=999999,
      weddingOn=false, weddingCost=5000, weddingAge=33,
      babyOn=false, babyCost=500, babyAge=35,
      carOn=false, carCost=3500, carAge=30,
    } = body;

    if(!salary || salary<500) return json({ error: '연봉을 입력해주세요' }, 400);
    if(!PRICES[region]?.[size]) return json({ error: '지역/평수 값 오류' }, 400);

    const targetPrice = PRICES[region][size];
    const netMonthly  = calcTakehome(salary);
    const monthlySave = netMonthly - living;
    const savingRate  = netMonthly>0 ? Math.round(monthlySave/netMonthly*100) : 0;

    const events = getEventDataFor({ weddingOn, weddingCost, weddingAge, babyOn, babyCost, babyAge, carOn, carCost, carAge }, age);
    const result  = simulatePersonal({ salary, asset, living, investRate, targetPrice, age, raisePct, promoRaise, maxSalary, events: { ...events, carAge, carOn } });

    const monthlyInvest = Math.round(asset * (Math.pow(1+investRate/100, 1/12)-1));
    const totalIncome   = netMonthly + monthlyInvest;
    const babyTotal     = babyOn ? calcBabyTotal(babyCost) : 0;
    const totalEventCost = (weddingOn?weddingCost:0) + babyTotal + (carOn?carCost:0);

    return json({
      years: result.years,
      reachedMonth: result.reachedMonth,
      targetPrice,
      netMonthly, monthlySave, savingRate,
      monthlyInvest, totalIncome,
      carMonthly: result.carMonthly,
      totalMonthlyExpense: living + result.carMonthly,
      weddingCost: weddingOn?weddingCost:0,
      babyTotal, carCost: carOn?carCost:0,
      totalEventCost,
      chartData: result.chartData,
      eventMarkers: {
        wedding: weddingOn ? { year: Math.max(0,weddingAge-age), age: weddingAge } : null,
        baby:    babyOn    ? { year: Math.max(0,babyAge-age),    age: babyAge    } : null,
        car:     carOn     ? { year: Math.max(0,carAge-age),     age: carAge     } : null,
      },
    });
  } catch(e) {
    return json({ error: e.message }, 500);
  }
}
