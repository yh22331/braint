// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// /api/simulate.js  - Vercel Edge Function
// 개인 시뮬레이션 (BF계산기 + 커플 개인탭)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const config = { runtime: 'edge' };

// ── 집값 테이블 (만원)
const PRICES = {
  gangnam: { small:90000, mid:140000, big:220000 },
  seoul:   { small:55000, mid:90000,  big:150000 },
  gyeonggi:{ small:30000, mid:55000,  big:90000  },
  local:   { small:15000, mid:25000,  big:45000  },
};

// ── 세전→월 실수령
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

// ── 이벤트 데이터 계산
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

// ── 월별 시뮬레이션 (이벤트 반영)
function simulateWithEvents({
  salary, asset, living, investRate,
  targetPrice, age,
  raisePct, promoRaise, maxSalary,
  events, // getEventDataFor 결과
  maxMonths = 360
}) {
  const monthlyR = Math.pow(1 + investRate/100, 1/12) - 1;
  const { extraByYear, monthlyBabyByYr, carMonthly, carAge, carOn } = events;
  let cur = asset;
  const chartData = []; // 연도별 자산 (억원)

  for(let m = 0; m <= maxMonths; m++) {
    const yr = Math.floor(m/12);
    const curAge = age + yr;

    let sal = salary * (1 + raisePct/100) ** yr;
    if(promoRaise && yr > 0 && yr%5 === 0) sal *= 1.10;
    sal = Math.min(sal, maxSalary || 999999);
    const netM = calcTakehome(Math.round(sal));

    const carM = (curAge >= (carAge||30) && carOn) ? carMonthly : 0;
    const babyM = monthlyBabyByYr[yr] || 0;
    const eventCost = m%12===0 ? (extraByYear[yr]||0) : 0;

    cur = Math.max(0,cur)*(1+monthlyR) + (netM - living - carM - babyM) - eventCost;

    if(m%12 === 0) {
      chartData.push({
        year: yr,
        age: curAge,
        asset: Math.round(cur),
        netMonthly: netM,
        monthlyExpense: living + carM + babyM,
      });
    }
    if(cur >= targetPrice) {
      return {
        years: Math.ceil((m+1)/12),
        reachedMonth: m,
        chartData,
        netMonthly: calcTakehome(salary),
        carMonthly,
      };
    }
  }
  return { years: null, reachedMonth: -1, chartData, netMonthly: calcTakehome(salary), carMonthly };
}

// ── 육아 총비용 계산
function calcBabyTotal(initCost) {
  let total = 0;
  for(let i=0; i<26; i++) total += Math.min(Math.round(initCost * Math.pow(1.03,i)), 2000);
  return total;
}

export default async function handler(req) {
  if(req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }
  if(req.method !== 'POST') {
    return json({ error: 'POST only' }, 405);
  }

  try {
    const body = await req.json();
    const {
      salary, asset, region, size,
      living, investRate,
      age = 30,
      raisePct = 3, promoRaise = true, maxSalary = 999999,
      // 이벤트
      weddingOn = true, weddingCost = 5000, weddingAge = 33,
      babyOn = true, babyCost = 500, babyAge = 35,
      carOn = true, carCost = 3500, carAge = 30,
    } = body;

    // 입력 검증
    if(!salary || salary < 500) return json({ error: '연봉을 입력해주세요' }, 400);
    if(!PRICES[region]) return json({ error: '지역 값이 올바르지 않아요' }, 400);
    if(!PRICES[region][size]) return json({ error: '평수 값이 올바르지 않아요' }, 400);

    const targetPrice = PRICES[region][size];
    const netMonthly = calcTakehome(salary);
    const monthlySave = netMonthly - living;
    const savingRate = netMonthly > 0 ? Math.round(monthlySave/netMonthly*100) : 0;

    // 이벤트 데이터
    const events = getEventDataFor({
      weddingOn, weddingCost, weddingAge,
      babyOn, babyCost, babyAge,
      carOn, carCost, carAge,
    }, age);

    // 시뮬레이션
    const result = simulateWithEvents({
      salary, asset, living, investRate,
      targetPrice, age,
      raisePct, promoRaise, maxSalary,
      events: { ...events, carAge, carOn },
    });

    // 월 투자수익 (초기 자산 기준)
    const monthlyInvest = Math.round(asset * (Math.pow(1+investRate/100, 1/12)-1));
    const totalIncome = netMonthly + monthlyInvest;

    // 이벤트 비용 총계
    const babyTotal = babyOn ? calcBabyTotal(babyCost) : 0;
    const totalEventCost =
      (weddingOn ? weddingCost : 0) +
      babyTotal +
      (carOn ? carCost : 0);

    return json({
      // 기본 결과
      years: result.years,
      reachedMonth: result.reachedMonth,
      targetPrice,

      // 개인 재무 요약
      netMonthly,
      monthlySave,
      savingRate,
      monthlyInvest,
      totalIncome,
      carMonthly: result.carMonthly,
      totalMonthlyExpense: living + result.carMonthly,

      // 이벤트 비용
      weddingCost: weddingOn ? weddingCost : 0,
      babyTotal,
      carCost: carOn ? carCost : 0,
      totalEventCost,

      // 차트 데이터
      chartData: result.chartData,
      // 이벤트 마커 (차트용)
      eventMarkers: {
        wedding: weddingOn ? { year: Math.max(0, weddingAge-age), age: weddingAge } : null,
        baby:    babyOn    ? { year: Math.max(0, babyAge-age),    age: babyAge    } : null,
        car:     carOn     ? { year: Math.max(0, carAge-age),     age: carAge     } : null,
      },
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
