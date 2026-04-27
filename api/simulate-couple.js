export const config = { runtime: 'edge' };

import {
  ASSUMPTIONS as A,
  PRICES,
  calcTakehome,
  calcBabyTotal,
  monthlyRate,
  getEventData,
  json,
  corsHeaders,
} from './_utils.js';

function simCouple({ me, partner, targetPrice, meAge }) {
  const avg = (me.investRate + partner.investRate) / 2;
  const mR = monthlyRate(avg), meR = monthlyRate(me.investRate);
  // 결혼/육아 비용은 각자 절반 부담 (커플 합산 가정)
  const meEv = getEventData({
    ...me.events,
    weddingCost: me.events.weddingOn ? Math.round((me.events.weddingCost || A.weddingCostDefault) / 2) : 0,
    babyCost:    me.events.babyOn    ? Math.round((me.events.babyCost    || A.babyCostDefault)    / 2) : 0,
  }, meAge);
  const pEv = getEventData({
    ...partner.events,
    weddingCost: partner.events.weddingOn ? Math.round((partner.events.weddingCost || A.weddingCostDefault) / 2) : 0,
    babyCost:    partner.events.babyOn    ? Math.round((partner.events.babyCost    || A.babyCostDefault)    / 2) : 0,
  }, meAge);
  let tot = me.asset + partner.asset, solo = me.asset;
  const cChart = [], sChart = [];
  let cR = -1, sR = -1;
  for (let m = 0; m <= A.defaultMaxMonths; m++) {
    const yr = Math.floor(m / 12), ca = meAge + yr;
    let ms = me.salary * (1 + me.raisePct / 100) ** yr;
    if (me.promoRaise && yr > 0 && yr % A.promoEveryYears === 0) ms *= A.promoBonusMultiplier;
    ms = Math.min(ms, me.maxSalary || A.unlimitedSalarySentinel);
    let ps = partner.salary * (1 + partner.raisePct / 100) ** yr;
    if (partner.promoRaise && yr > 0 && yr % A.promoEveryYears === 0) ps *= A.promoBonusMultiplier;
    ps = Math.min(ps, partner.maxSalary || A.unlimitedSalarySentinel);
    const mn = calcTakehome(Math.round(ms)), pn = calcTakehome(Math.round(ps));
    const mcm = (ca >= (me.events.carAge || A.carAgeDefault) && me.events.carOn) ? meEv.carMonthly : 0;
    const pcm = (ca >= (partner.events.carAge || A.carAgeDefault) && partner.events.carOn) ? pEv.carMonthly : 0;
    const tev = m % 12 === 0 ? ((meEv.extraByYear[yr] || 0) + (pEv.extraByYear[yr] || 0)) : 0;
    const mev = m % 12 === 0 ? (meEv.extraByYear[yr] || 0) : 0;
    tot = Math.max(0, tot) * (1 + mR) + (mn + pn - me.living - partner.living - mcm - pcm - (meEv.monthlyBabyByYr[yr] || 0) - (pEv.monthlyBabyByYr[yr] || 0)) - tev;
    solo = Math.max(0, solo) * (1 + meR) + (mn - me.living - mcm - (meEv.monthlyBabyByYr[yr] || 0)) - mev;
    if (m % 12 === 0) {
      cChart.push({ year: yr, age: ca, asset: Math.round(tot), meNet: mn, pNet: pn });
      sChart.push({ year: yr, age: ca, asset: Math.round(solo), netMonthly: mn });
      if (cR < 0 && tot >= targetPrice) cR = m;
      if (sR < 0 && solo >= targetPrice) sR = m;
    }
  }
  return {
    coupleYears: cR >= 0 ? Math.ceil(cR / 12) : null,
    soloYears:   sR >= 0 ? Math.ceil(sR / 12) : null,
    coupleChart: cChart, soloChart: sChart,
    meCarM: meEv.carMonthly || 0, pCarM: pEv.carMonthly || 0,
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const { me, partner } = await req.json();
    if (!me?.salary || !partner?.salary) return json({ error: '연봉 필요' }, 400);
    const mp = PRICES[me.region || 'seoul'][me.size || 'mid'];
    const pp = PRICES[partner.region || 'seoul'][partner.size || 'mid'];
    const targetPrice = (me.region === partner.region && me.size === partner.size) ? mp : Math.round((mp + pp) / 2);
    const meAge = me.age || A.ageDefault;
    const r = simCouple({ me, partner, targetPrice, meAge });
    const mn = calcTakehome(me.salary), pn = calcTakehome(partner.salary);
    const avg = (me.investRate + partner.investRate) / 2;
    const cmi = Math.round((me.asset + partner.asset) * monthlyRate(avg));
    const bt = me.events.babyOn ? calcBabyTotal(me.events.babyCost || A.babyCostDefault) : 0;
    const bma = me.events.babyOn ? Math.round(bt / A.babyYears / 12) : 0;
    const mc = me.events.carOn ? me.events.carCost : 0, pc = partner.events.carOn ? partner.events.carCost : 0;
    const wc = me.events.weddingOn ? (me.events.weddingCost || A.weddingCostDefault) : 0;
    const saved = r.soloYears && r.coupleYears ? r.soloYears - r.coupleYears : null;
    return json({
      ...r, saved, targetPrice, avgInvestRate: avg,
      report: {
        meNet: mn, pNet: pn,
        meSalary: me.salary, pSalary: partner.salary,
        meAsset: me.asset, pAsset: partner.asset,
        meLiving: me.living, pLiving: partner.living,
        meCarMonthly: r.meCarM, pCarMonthly: r.pCarM,
        meCarCost: mc, pCarCost: pc,
        combinedMonthlyInvest: cmi, totalIncome: mn + pn + cmi,
        totalExpense: me.living + partner.living + bma + r.meCarM + r.pCarM,
        weddingCost: wc, babyTotal: bt, babyMonthlyAvg: bma,
        totalEventCost: wc + bt + mc + pc,
        meRaisePct: me.raisePct, mePromo: me.promoRaise,
        pRaisePct: partner.raisePct, pPromo: partner.promoRaise,
      },
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
