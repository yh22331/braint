// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// api/_utils.js - 공통 계산 엔진
// BF / HouseCheck / Couple 공유
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── 집값 테이블 (만원)
export const PRICES = {
  gangnam: { small:90000, mid:140000, big:220000 },
  seoul:   { small:55000, mid:90000,  big:150000 },
  gyeonggi:{ small:30000, mid:55000,  big:90000  },
  local:   { small:15000, mid:25000,  big:45000  },
};

// ── 세전 연봉 → 월 실수령 (만원)
export function calcTakehome(gross) {
  let rate;
  if(gross<=3000)       rate=0.88;
  else if(gross<=4000)  rate=0.855;
  else if(gross<=5000)  rate=0.835;
  else if(gross<=6000)  rate=0.82;
  else if(gross<=7000)  rate=0.805;
  else if(gross<=8000)  rate=0.79;
  else if(gross<=10000) rate=0.775;
  else if(gross<=12000) rate=0.755;
  else if(gross<=15000) rate=0.73;
  else                  rate=0.70;
  return Math.round(gross * rate / 12);
}

// ── 이벤트 데이터 계산
export function getEventDataFor(cfg, age) {
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
      const c = Math.min(Math.round(initCost * Math.pow(1.03, i)), 2000);
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

// ── 육아 총비용 계산
export function calcBabyTotal(initCost) {
  let total = 0;
  for(let i=0; i<26; i++)
    total += Math.min(Math.round(initCost * Math.pow(1.03, i)), 2000);
  return total;
}

// ── 개인 시뮬레이션 (이벤트 반영)
export function simulatePersonal({
  salary, asset, living, investRate,
  targetPrice, age,
  raisePct=3, promoRaise=true, maxSalary=999999,
  events, maxMonths=360
}) {
  const monthlyR = Math.pow(1 + investRate/100, 1/12) - 1;
  const { extraByYear, monthlyBabyByYr, carMonthly, carAge, carOn } = events;
  let cur = asset;
  const chartData = [];

  for(let m=0; m<=maxMonths; m++) {
    const yr = Math.floor(m/12);
    const curAge = age + yr;

    let sal = salary * (1 + raisePct/100) ** yr;
    if(promoRaise && yr>0 && yr%5===0) sal *= 1.10;
    sal = Math.min(sal, maxSalary);
    const netM = calcTakehome(Math.round(sal));

    const carM = (curAge >= (carAge||30) && carOn) ? carMonthly : 0;
    const babyM = monthlyBabyByYr[yr] || 0;
    const eventCost = m%12===0 ? (extraByYear[yr]||0) : 0;

    // 음수 복리 방지
    cur = Math.max(0, cur)*(1+monthlyR) + (netM - living - carM - babyM) - eventCost;

    if(m%12===0) {
      chartData.push({
        year: yr, age: curAge,
        asset: Math.round(cur),
        netMonthly: netM,
        monthlyExpense: living + carM + babyM,
      });
    }
    if(cur >= targetPrice) {
      return { years: Math.ceil((m+1)/12), reachedMonth: m, chartData, netMonthly: calcTakehome(salary), carMonthly };
    }
  }
  return { years: null, reachedMonth: -1, chartData, netMonthly: calcTakehome(salary), carMonthly };
}

// ── 커플 합산 시뮬레이션
export function simulateCoupled({
  me, partner, targetPrice, meAge, maxMonths=360
}) {
  const avgInvestRate = (me.investRate + partner.investRate) / 2;
  const monthlyR = Math.pow(1 + avgInvestRate/100, 1/12) - 1;
  const meMonthlyR = Math.pow(1 + me.investRate/100, 1/12) - 1;

  // 이벤트 (결혼/육아 반반, 차량 각자)
  const meEvSplit = { ...me.events,
    weddingCost: me.events.weddingOn ? Math.round((me.events.weddingCost||5000)/2) : 0,
    babyCost:    me.events.babyOn    ? Math.round((me.events.babyCost||500)/2)     : 0,
  };
  const pEvSplit = { ...partner.events,
    weddingCost: partner.events.weddingOn ? Math.round((partner.events.weddingCost||5000)/2) : 0,
    babyCost:    partner.events.babyOn    ? Math.round((partner.events.babyCost||500)/2)     : 0,
  };

  const meEv = { ...getEventDataFor(meEvSplit, meAge), carAge: me.events.carAge, carOn: me.events.carOn };
  const pEv  = { ...getEventDataFor(pEvSplit,  meAge), carAge: partner.events.carAge, carOn: partner.events.carOn };

  let totalAsset = me.asset + partner.asset;
  let soloAsset  = me.asset;
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

    const meCarM  = (curAge>=(meEv.carAge||30) && meEv.carOn) ? meEv.carMonthly : 0;
    const pCarM   = (curAge>=(pEv.carAge||30)  && pEv.carOn)  ? pEv.carMonthly  : 0;
    const meBabyM = meEv.monthlyBabyByYr[yr] || 0;
    const pBabyM  = pEv.monthlyBabyByYr[yr]  || 0;
    const totalEvCost = m%12===0 ? ((meEv.extraByYear[yr]||0)+(pEv.extraByYear[yr]||0)) : 0;
    const meEvCost    = m%12===0 ? (meEv.extraByYear[yr]||0) : 0;

    // 음수 복리 방지
    totalAsset = Math.max(0,totalAsset)*(1+monthlyR) + (meNet+pNet - me.living-partner.living - meCarM-pCarM - meBabyM-pBabyM) - totalEvCost;
    soloAsset  = Math.max(0,soloAsset)*(1+meMonthlyR) + (meNet - me.living - meCarM - meBabyM) - meEvCost;

    if(m%12===0) {
      coupleChart.push({ year:yr, age:curAge, asset:Math.round(totalAsset), meNet, pNet });
      soloChart.push({ year:yr, age:curAge, asset:Math.round(soloAsset), netMonthly:meNet });
      if(coupleReached<0 && totalAsset>=targetPrice) coupleReached=m;
      if(soloReached<0  && soloAsset>=targetPrice)   soloReached=m;
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

// ── CORS 헬퍼
export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}
export function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}
