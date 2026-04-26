// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// api/simulate-bf.js - BF 계산기 전용
// 대출, 집구매 후 자산리셋, 이벤트 라벨 포함
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const config = { runtime: 'edge' };
import { PRICES, calcTakehome, calcBabyTotal, corsHeaders, json } from './_utils.js';

const MY_ASSETS = { none:0, small:8000, mid:25000, big:40000 };

// BF 전용 시뮬레이션 (대출 + 집구매 후 자산리셋 + 이벤트 라벨)
function simulateBF({
  netSalary, initAsset, targetPrice, investRate=0,
  extraByYear={}, monthlyBabyByYr={}, eventLabels={},
  loanAmt=0, loanRate=0,
  annualRaisePct=0, promoRaise=false, promoBasePct=0, maxNetSalary=Infinity,
  carStartYr=Infinity, carMonthlyMaint=0,
  livingCost=200, maxMonths=360,
}) {
  const monthlyR = Math.pow(1+investRate/100, 1/12)-1;
  const r30 = loanAmt>0 ? loanRate/100/12 : 0;
  const n30 = 360;
  const monthlyLoanPayment = (loanAmt>0 && r30>0)
    ? Math.round(loanAmt*r30*Math.pow(1+r30,n30)/(Math.pow(1+r30,n30)-1)) : 0;

  let asset = initAsset;
  let currentNet = netSalary;
  let reachedMonth = -1;
  if(asset >= targetPrice) reachedMonth = 0;

  const results = [];

  for(let m=0; m<maxMonths; m++) {
    const yr = Math.floor(m/12);
    const mon = m%12;

    // 연봉 인상 (매년 1월)
    if(mon===0 && m>0) {
      if(promoRaise) {
        currentNet *= (1+promoBasePct/100);
        if(yr%5===0) currentNet *= 1.10;
      } else {
        currentNet *= (1+annualRaisePct/100);
      }
      currentNet = Math.min(currentNet, maxNetSalary);
    }

    const monthlyIncome = currentNet/12;
    const carMaint = yr>=carStartYr ? carMonthlyMaint : 0;
    const babyM = monthlyBabyByYr[yr]||0;
    const netCF = monthlyIncome - livingCost - monthlyLoanPayment - carMaint - babyM;
    const eventCost = mon===0 ? (extraByYear[yr]||0) : 0;

    // 음수 복리 방지
    asset = Math.max(0,asset)*(1+monthlyR) + netCF - eventCost;

    const evLabels = (mon===0 && eventLabels[yr]) ? eventLabels[yr] : null;
    results.push({ month:m, year:yr, age:0, asset:Math.round(asset), salary:Math.round(currentNet), label:evLabels, housePurchase:false });

    if(reachedMonth<0 && asset>=targetPrice) {
      reachedMonth = m+1;
      asset = 0; // 집 구매 = 자산 전액 사용
      results.push({ month:m, year:yr, asset:0, label:['🏠집구매'], housePurchase:true });
      if(m>=240) break;
    }
  }

  return { results, reachedMonth, monthlyLoanPayment };
}

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null, { headers: corsHeaders() });
  if(req.method!=='POST') return json({ error: 'POST only' }, 405);

  try {
    const body = await req.json();
    const {
      salary, myAsset='none', asset=0, region='seoul', size='mid',
      living=200, investRate=5, age=30,
      raisePct=3, promoRaise=true, maxSalary=15000,
      // 이벤트
      weddingOn=false, weddingCost=5000, weddingAge=33,
      babyOn=false, babyCost=500, babyAge=35,
      carOn=false, carCost=3500, carAge=30,
      // 대출
      loanOn=false,
    } = body;

    if(!salary || salary<500) return json({ error: '연봉을 입력해주세요' }, 400);

    const targetPrice = PRICES[region]?.[size];
    if(!targetPrice) return json({ error: '지역/평수 값 오류' }, 400);

    const initAsset = (MY_ASSETS[myAsset]||0) + (asset||0);
    const netSalary = calcTakehome(salary) * 12; // 연 실수령
    const netMonthly = calcTakehome(salary);

    // 대출
    const loanAmt  = loanOn ? Math.round(targetPrice*0.40) : 0;
    const loanRate = loanOn ? 4 : 0;
    const effectiveTarget = targetPrice - loanAmt;

    // 이벤트 데이터
    const extraByYear = {}, monthlyBabyByYr = {}, eventLabels = {};
    if(weddingOn) {
      const yr = Math.max(0, weddingAge-age);
      extraByYear[yr] = (extraByYear[yr]||0) + weddingCost;
      eventLabels[yr] = [...(eventLabels[yr]||[]), '💍결혼'];
    }
    if(babyOn) {
      const startYr = Math.max(0, babyAge-age);
      for(let i=0; i<26; i++) {
        const yr = startYr+i;
        const c = Math.min(Math.round(babyCost*Math.pow(1.03,i)), 2000);
        monthlyBabyByYr[yr] = (monthlyBabyByYr[yr]||0) + Math.round(c/12);
      }
      eventLabels[babyAge-age] = [...(eventLabels[babyAge-age]||[]), '👶출산'];
    }
    const carMonthlyMaint = carOn ? Math.round(Math.max(carCost*0.015,30)) : 0;
    if(carOn) {
      const yr = Math.max(0, carAge-age);
      extraByYear[yr] = (extraByYear[yr]||0) + carCost;
      eventLabels[yr] = [...(eventLabels[yr]||[]), '🚗차량'];
    }

    // 연봉인상 설정
    const promoBasePct = promoRaise ? raisePct : 0;
    const maxNetSalary = calcTakehome(maxSalary) * 12;
    const carStartYr = carOn ? Math.max(0,carAge-age) : Infinity;

    const sim = simulateBF({
      netSalary, initAsset, targetPrice:effectiveTarget,
      investRate, extraByYear, monthlyBabyByYr, eventLabels,
      loanAmt, loanRate,
      annualRaisePct: promoRaise ? 0 : raisePct,
      promoRaise, promoBasePct, maxNetSalary,
      carStartYr, carMonthlyMaint,
      livingCost: living,
    });

    // 연간 차트 데이터 (월→연)
    const chartData = sim.results.filter(r=>r.month%12===0||r.housePurchase).map(r=>({
      year: r.year, age: age+r.year,
      asset: r.asset,
      netMonthly: Math.round(r.salary/12),
      monthlyExpense: living + (r.year>=carStartYr?carMonthlyMaint:0) + (monthlyBabyByYr[r.year]||0),
      label: r.label,
      housePurchase: r.housePurchase||false,
    }));

    const years = sim.reachedMonth>0 ? Math.ceil(sim.reachedMonth/12) : null;
    const monthlySave = netMonthly - living - carMonthlyMaint;
    const savingRate = Math.round(monthlySave/netMonthly*100);
    const monthlyInvest = Math.round(initAsset*(Math.pow(1+investRate/100,1/12)-1));
    const babyTotal = babyOn ? calcBabyTotal(babyCost) : 0;
    const totalEventCost = (weddingOn?weddingCost:0)+babyTotal+(carOn?carCost:0);

    return json({
      years, reachedMonth: sim.reachedMonth,
      targetPrice, effectiveTarget, loanAmt,
      monthlyLoanPayment: sim.monthlyLoanPayment,
      netMonthly, monthlySave, savingRate,
      monthlyInvest,
      carMonthly: carMonthlyMaint,
      weddingCost: weddingOn?weddingCost:0,
      babyTotal, carCost: carOn?carCost:0,
      totalEventCost,
      chartData,
      eventMarkers: {
        wedding: weddingOn?{year:Math.max(0,weddingAge-age),age:weddingAge}:null,
        baby:    babyOn?{year:Math.max(0,babyAge-age),age:babyAge}:null,
        car:     carOn?{year:Math.max(0,carAge-age),age:carAge}:null,
      },
    });
  } catch(e) {
    return json({ error: e.message }, 500);
  }
}
