// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// /api/simulate-couple.js - Vercel Edge Function
// 커플 합산 시뮬레이션
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const config = { runtime: 'edge' };

const PRICES = {
  gangnam: { small:90000, mid:140000, big:220000 },
  seoul:   { small:55000, mid:90000,  big:150000 },
  gyeonggi:{ small:30000, mid:55000,  big:90000  },
  local:   { small:15000, mid:25000,  big:45000  },
};

function calcTakehome(gross) {
  let rate;
  if(gross<=3000)      rate=0.88;
  else if(gross<=4000) rate=0.855;
  else if(gross<=5000) rate=0.835;
  else if(gross<=6000) rate=0.82;
  else if(gross<=7000) rate=0.805;
  else if(gross<=8000) rate=0.79;
  else if(gross<=10000)rate=0.775;
  else if(gross<=12000)rate=0.755;
  else if(gross<=15000)rate=0.73;
  else                 rate=0.70;
  return Math.round(gross * rate / 12);
}

function getEventDataFor(cfg, age) {
  const extraByYear = {}, monthlyBabyByYr = {};
  let carMonthly = 0;
  if(cfg.weddingOn) {
    const yr = Math.max(0, (cfg.weddingAge||33) - age);
    extraByYear[yr] = (extraByYear[yr]||0) + (cfg.weddingCost||5000);
  }
  if(cfg.babyOn) {
    const startYr = Math.max(0, (cfg.babyAge||35) - age);
    const initCost = cfg.babyCost || 500;
    for(let i=0; i<26; i++) {
      const yr = startYr + i;
      const c = Math.min(Math.round(initCost * Math.pow(1.03,i)), 2000);
      monthlyBabyByYr[yr] = (monthlyBabyByYr[yr]||0) + Math.round(c/12);
    }
  }
  if(cfg.carOn) {
    const yr = Math.max(0, (cfg.carAge||30) - age);
    extraByYear[yr] = (extraByYear[yr]||0) + (cfg.carCost||3500);
    carMonthly = Math.round(Math.max((cfg.carCost||3500) * 0.015, 30));
  }
  return { extraByYear, monthlyBabyByYr, carMonthly };
}

function calcBabyTotal(initCost) {
  let total = 0;
  for(let i=0; i<26; i++) total += Math.min(Math.round(initCost * Math.pow(1.03,i)), 2000);
  return total;
}

// ━━ 합산 시뮬레이션 원칙 ━━
// 투자수익률: (나+짝꿍)/2 → 합산 자산 적용
// 연봉인상률: 각자 계산 후 합산 실수령
// 목표집값:   (나+짝꿍)/2
// 결혼/육아:  공동 1회 (반반 → 합산하면 1회)
// 차량:       각자 구매비+유지비
function simulateCoupled({
  me, partner, targetPrice, meAge, maxMonths=360
}) {
  const avgInvestRate = (me.investRate + partner.investRate) / 2;
  const monthlyR = Math.pow(1 + avgInvestRate/100, 1/12) - 1;
  const meMonthlyR = Math.pow(1 + me.investRate/100, 1/12) - 1;

  // 이벤트: 결혼/육아 반반(합산하면 1회), 차량 각자
  const meEvSplit = { ...me.events, weddingCost: me.events.weddingOn?Math.round((me.events.weddingCost||5000)/2):0, babyCost: me.events.babyOn?Math.round((me.events.babyCost||500)/2):0 };
  const pEvSplit  = { ...partner.events, weddingCost: partner.events.weddingOn?Math.round((partner.events.weddingCost||5000)/2):0, babyCost: partner.events.babyOn?Math.round((partner.events.babyCost||500)/2):0 };

  const meEv = { ...getEventDataFor(meEvSplit, meAge), carAge: me.events.carAge, carOn: me.events.carOn };
  const pEv  = { ...getEventDataFor(pEvSplit, meAge),  carAge: partner.events.carAge, carOn: partner.events.carOn };

  let totalAsset = me.asset + partner.asset;
  let soloAsset = me.asset;
  const coupleChart = [], soloChart = [];

  let coupleReached = -1, soloReached = -1;

  for(let m=0; m<=maxMonths; m++) {
    const yr = Math.floor(m/12);
    const curAge = meAge + yr;

    // 각자 연봉인상
    let meSal = me.salary * (1+me.raisePct/100)**yr;
    if(me.promoRaise && yr>0 && yr%5===0) meSal *= 1.10;
    meSal = Math.min(meSal, me.maxSalary||999999);

    let pSal = partner.salary * (1+partner.raisePct/100)**yr;
    if(partner.promoRaise && yr>0 && yr%5===0) pSal *= 1.10;
    pSal = Math.min(pSal, partner.maxSalary||999999);

    const meNet = calcTakehome(Math.round(meSal));
    const pNet  = calcTakehome(Math.round(pSal));
    const totalNet = meNet + pNet;

    // 지출
    const meCarM = (curAge >= (meEv.carAge||30) && meEv.carOn) ? meEv.carMonthly : 0;
    const pCarM  = (curAge >= (pEv.carAge||30)  && pEv.carOn)  ? pEv.carMonthly  : 0;
    const meBabyM = meEv.monthlyBabyByYr[yr] || 0;
    const pBabyM  = pEv.monthlyBabyByYr[yr]  || 0;

    const totalLiving = me.living + partner.living;
    const totalCarM = meCarM + pCarM;
    const totalBabyM = meBabyM + pBabyM;

    const totalEvCost = m%12===0 ? ((meEv.extraByYear[yr]||0) + (pEv.extraByYear[yr]||0)) : 0;
    const meEvCost    = m%12===0 ? (meEv.extraByYear[yr]||0) : 0;

    // 합산 자산 (평균 투자수익률)
    totalAsset = totalAsset*(1+monthlyR) + (totalNet - totalLiving - totalCarM - totalBabyM) - totalEvCost;

    // 혼자(나) 자산
    soloAsset = soloAsset*(1+meMonthlyR) + (meNet - me.living - meCarM - meBabyM) - meEvCost;

    if(m%12===0) {
      coupleChart.push({ year:yr, age:curAge, asset:Math.round(totalAsset), meNet, pNet });
      soloChart.push({ year:yr, age:curAge, asset:Math.round(soloAsset), netMonthly:meNet });
      if(coupleReached<0 && totalAsset>=targetPrice) coupleReached=m;
      if(soloReached<0 && soloAsset>=targetPrice) soloReached=m;
    }
  }

  return {
    coupleYears: coupleReached>=0 ? Math.ceil(coupleReached/12) : null,
    soloYears:   soloReached>=0   ? Math.ceil(soloReached/12)   : null,
    coupleChart, soloChart,
    meCarMonthly: meEv.carMonthly||0,
    pCarMonthly:  pEv.carMonthly||0,
  };
}

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null, { headers: corsHeaders() });
  if(req.method!=='POST') return json({ error: 'POST only' }, 405);

  try {
    const body = await req.json();
    const { me, partner } = body;

    // 입력 검증
    if(!me?.salary || !partner?.salary) return json({ error: '나와 짝꿍 연봉 필요' }, 400);

    // 목표 집값 (지역 다를 때 평균)
    const mePrice = PRICES[me.region||'seoul'][me.size||'mid'];
    const pPrice  = PRICES[partner.region||'seoul'][partner.size||'mid'];
    const targetPrice = (me.region===partner.region && me.size===partner.size)
      ? mePrice
      : Math.round((mePrice + pPrice) / 2);

    const meAge = me.age || 30;
    const avgInvestRate = (me.investRate + partner.investRate) / 2;

    // 시뮬레이션
    const result = simulateCoupled({ me, partner, targetPrice, meAge });

    // 리포트용 계산
    const meNet = calcTakehome(me.salary);
    const pNet  = calcTakehome(partner.salary);
    const meMonthlyInvest = Math.round(me.asset * (Math.pow(1+me.investRate/100,1/12)-1));
    const pMonthlyInvest  = Math.round(partner.asset * (Math.pow(1+partner.investRate/100,1/12)-1));
    const combinedMonthlyInvest = Math.round((me.asset+partner.asset) * (Math.pow(1+avgInvestRate/100,1/12)-1));
    const totalIncome = meNet + pNet + combinedMonthlyInvest;

    const meCar  = me.events.carOn      ? me.events.carCost      : 0;
    const pCar   = partner.events.carOn ? partner.events.carCost  : 0;
    const weddingCost = me.events.weddingOn ? (me.events.weddingCost||5000) : 0;
    const babyTotal   = me.events.babyOn    ? calcBabyTotal(me.events.babyCost||500) : 0;

    const babyMonthlyAvg = me.events.babyOn ? Math.round(babyTotal/26/12) : 0;
    const totalExpense = me.living + partner.living + babyMonthlyAvg + result.meCarMonthly + result.pCarMonthly;

    return json({
      // 결과
      coupleYears: result.coupleYears,
      soloYears:   result.soloYears,
      saved: result.soloYears && result.coupleYears ? result.soloYears - result.coupleYears : null,
      targetPrice,
      avgInvestRate,

      // 리포트 데이터
      report: {
        meNet, pNet,
        meSalary: me.salary, pSalary: partner.salary,
        meAsset: me.asset,   pAsset:  partner.asset,
        meLiving: me.living, pLiving: partner.living,
        meCarMonthly: result.meCarMonthly, pCarMonthly: result.pCarMonthly,
        meCarCost: meCar, pCarCost: pCar,
        combinedMonthlyInvest, totalIncome, totalExpense,
        weddingCost, babyTotal, babyMonthlyAvg,
        totalEventCost: weddingCost + babyTotal + meCar + pCar,
        meRaisePct: me.raisePct, mePromo: me.promoRaise,
        pRaisePct: partner.raisePct, pPromo: partner.promoRaise,
      },

      // 차트 데이터
      coupleChart: result.coupleChart,
      soloChart:   result.soloChart,
    });
  } catch(e) {
    return json({ error: e.message }, 500);
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}
function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}
