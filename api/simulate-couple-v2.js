// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// api/simulate-couple.js - 커플 합산 시뮬레이션
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const config = { runtime: 'edge' };
import { PRICES, calcTakehome, calcBabyTotal, simulateCoupled, corsHeaders, json } from './_utils.js';

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null, { headers: corsHeaders() });
  if(req.method!=='POST') return json({ error: 'POST only' }, 405);

  try {
    const { me, partner } = await req.json();
    if(!me?.salary || !partner?.salary) return json({ error: '나와 짝꿍 연봉 필요' }, 400);

    // 목표 집값 (지역 다르면 평균)
    const mePrice = PRICES[me.region||'seoul'][me.size||'mid'];
    const pPrice  = PRICES[partner.region||'seoul'][partner.size||'mid'];
    const targetPrice = (me.region===partner.region && me.size===partner.size)
      ? mePrice : Math.round((mePrice+pPrice)/2);

    const meAge = me.age || 30;
    const result = simulateCoupled({ me, partner, targetPrice, meAge });

    // 리포트용
    const meNet = calcTakehome(me.salary);
    const pNet  = calcTakehome(partner.salary);
    const avgInvestRate = (me.investRate + partner.investRate) / 2;
    const combinedMonthlyInvest = Math.round((me.asset+partner.asset) * (Math.pow(1+avgInvestRate/100,1/12)-1));
    const totalIncome = meNet + pNet + combinedMonthlyInvest;

    const meCar = me.events.carOn      ? me.events.carCost      : 0;
    const pCar  = partner.events.carOn ? partner.events.carCost  : 0;
    const weddingCost = me.events.weddingOn ? (me.events.weddingCost||5000) : 0;
    const babyTotal   = me.events.babyOn    ? calcBabyTotal(me.events.babyCost||500) : 0;
    const babyMonthlyAvg = me.events.babyOn ? Math.round(babyTotal/26/12) : 0;
    const totalExpense = me.living + partner.living + babyMonthlyAvg + result.meCarMonthly + result.pCarMonthly;
    const saved = result.soloYears && result.coupleYears ? result.soloYears - result.coupleYears : null;

    return json({
      coupleYears: result.coupleYears,
      soloYears:   result.soloYears,
      saved, targetPrice, avgInvestRate,
      report: {
        meNet, pNet,
        meSalary: me.salary, pSalary: partner.salary,
        meAsset: me.asset, pAsset: partner.asset,
        meLiving: me.living, pLiving: partner.living,
        meCarMonthly: result.meCarMonthly, pCarMonthly: result.pCarMonthly,
        meCarCost: meCar, pCarCost: pCar,
        combinedMonthlyInvest, totalIncome, totalExpense,
        weddingCost, babyTotal, babyMonthlyAvg,
        totalEventCost: weddingCost + babyTotal + meCar + pCar,
        meRaisePct: me.raisePct, mePromo: me.promoRaise,
        pRaisePct: partner.raisePct, pPromo: partner.promoRaise,
      },
      coupleChart: result.coupleChart,
      soloChart:   result.soloChart,
    });
  } catch(e) {
    return json({ error: e.message }, 500);
  }
}
