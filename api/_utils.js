// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// api/_utils.js — 공용 헬퍼 / 상수
// 모든 simulate-*.js 핸들러에서 import.
// 가정값/매직넘버는 여기서만 수정 — 모든 시뮬레이션이 동일 값 사용.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const ASSUMPTIONS = {
  // 대출 (bf-home / housecheck)
  loanRate: 4,                     // 연 4% 고정금리
  loanTermMonths: 360,             // 30년
  ltvRatio: 0.40,                  // 대출 시 집값의 40%

  // 시뮬레이션 루프
  defaultMaxMonths: 360,           // 30년 시뮬
  promoBonusMultiplier: 1.10,      // 5년마다 +10%
  promoEveryYears: 5,
  unlimitedSalarySentinel: 999999, // maxSalary 미지정 시 사실상 무제한
  carStartNeverSentinel: 999,      // carOn=false일 때 carStartYr
  maxSalaryCapManwon: 15000,       // bf-home / housecheck 연봉 상한 (만원)

  // 육아비
  babyInflation: 1.03,             // 연 3% 상승
  babyYears: 26,                   // 출산 후 26년
  babyAnnualCapManwon: 2000,       // 연 최대 2,000만원

  // 차량 유지비 (bf-home / couple — 간이 공식)
  carMaintRatioOfCost: 0.015,      // 차값 × 1.5%/월
  carMaintMinMonthly: 30,          // 만원

  // 입력 기본값
  ageDefault: 30,
  livingDefault: 200,
  weddingCostDefault: 5000,
  weddingAgeDefault: 33,
  babyCostDefault: 500,
  babyAgeDefault: 35,
  carCostDefault: 3500,
  carAgeDefault: 30,
};

// ── 지역×평수 가격 (만원)
export const PRICES = {
  gangnam:  { small: 90000, mid: 140000, big: 220000 },
  seoul:    { small: 55000, mid:  90000, big: 150000 },
  gyeonggi: { small: 30000, mid:  55000, big:  90000 },
  local:    { small: 15000, mid:  25000, big:  45000 },
};

// ── '내 자산' 프리셋 (bf-home 전용, 만원)
export const MY_ASSETS = { none: 0, small: 8000, mid: 25000, big: 40000 };

// ── 연봉(만원) → 세후 월급(만원). 누진 단순화.
export function calcTakehome(gross) {
  let rate;
  if (gross <= 3000) rate = 0.88;
  else if (gross <= 4000) rate = 0.855;
  else if (gross <= 5000) rate = 0.835;
  else if (gross <= 6000) rate = 0.82;
  else if (gross <= 7000) rate = 0.805;
  else if (gross <= 8000) rate = 0.79;
  else if (gross <= 10000) rate = 0.775;
  else if (gross <= 12000) rate = 0.755;
  else if (gross <= 15000) rate = 0.73;
  else rate = 0.70;
  return Math.round(gross * rate / 12);
}

// ── 26년 누적 육아비 총합(만원). 연 3% 상승, 연 2,000만원 상한.
export function calcBabyTotal(initCost) {
  let total = 0;
  for (let i = 0; i < ASSUMPTIONS.babyYears; i++) {
    total += Math.min(
      Math.round(initCost * Math.pow(ASSUMPTIONS.babyInflation, i)),
      ASSUMPTIONS.babyAnnualCapManwon,
    );
  }
  return total;
}

// ── 연 수익률(%) → 월 수익률(소수)
export function monthlyRate(annualPct) {
  return Math.pow(1 + annualPct / 100, 1 / 12) - 1;
}

// ── 결혼/육아/차량 이벤트를 시뮬레이션이 사용하는 형태로 변환
export function getEventData(cfg, age) {
  const extraByYear = {};
  const monthlyBabyByYr = {};
  let carMonthly = 0;

  if (cfg.weddingOn) {
    const yr = Math.max(0, (cfg.weddingAge || ASSUMPTIONS.weddingAgeDefault) - age);
    extraByYear[yr] = (extraByYear[yr] || 0) + (cfg.weddingCost || ASSUMPTIONS.weddingCostDefault);
  }

  if (cfg.babyOn) {
    const startYr = Math.max(0, (cfg.babyAge || ASSUMPTIONS.babyAgeDefault) - age);
    const baseCost = cfg.babyCost || ASSUMPTIONS.babyCostDefault;
    for (let i = 0; i < ASSUMPTIONS.babyYears; i++) {
      const yr = startYr + i;
      const annual = Math.min(
        Math.round(baseCost * Math.pow(ASSUMPTIONS.babyInflation, i)),
        ASSUMPTIONS.babyAnnualCapManwon,
      );
      monthlyBabyByYr[yr] = (monthlyBabyByYr[yr] || 0) + Math.round(annual / 12);
    }
  }

  if (cfg.carOn) {
    const yr = Math.max(0, (cfg.carAge || ASSUMPTIONS.carAgeDefault) - age);
    const cost = cfg.carCost || ASSUMPTIONS.carCostDefault;
    extraByYear[yr] = (extraByYear[yr] || 0) + cost;
    carMonthly = Math.round(Math.max(cost * ASSUMPTIONS.carMaintRatioOfCost, ASSUMPTIONS.carMaintMinMonthly));
  }

  return { extraByYear, monthlyBabyByYr, carMonthly };
}

// ── UI에 표시할 이벤트 마커 (각 이벤트의 발생 연차/나이)
export function buildEventMarkers(cfg, age) {
  return {
    wedding: cfg.weddingOn ? { year: Math.max(0, cfg.weddingAge - age), age: cfg.weddingAge } : null,
    baby:    cfg.babyOn    ? { year: Math.max(0, cfg.babyAge - age),    age: cfg.babyAge    } : null,
    car:     cfg.carOn     ? { year: Math.max(0, cfg.carAge - age),     age: cfg.carAge     } : null,
  };
}

// ── CORS / JSON 응답 헬퍼 (simulate-* 핸들러 공용)
export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}
