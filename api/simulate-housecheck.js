// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// api/simulate-housecheck.js - HouseCheck 전용
// 대출, 단계별 입력, 자산 흐름 차트
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const config = { runtime: 'edge' };
import { calcTakehome, calcBabyTotal, corsHeaders, json } from './_utils.js';

function simulateHousecheck({
  netSalary, initAsset, targetPrice, investRate=5,
  extraByYear={}, monthlyBabyByYr={},
  loanAmt=0, loanRate=4,
  annualRaisePct=3, promoRaise=false, promoBasePct=3, maxNetSalary=Infinity,
  carStartYr=Infinity, carMonthlyMaint=0,
  livingCost=200, maxMonths=360,
}) {
  const monthlyR = Math.pow(1+investRate/100, 1/12)-1;
  const r30 = loanAmt>0 ? loanRate/100/12 : 0;
  const monthlyLoanPayment = (loanAmt>0 && r30>0)
    ? Math.round(loanAmt*r30*Math.pow(1+r30,360)/(Math.pow(1+r30,360)-1)) : 0;

  let asset = initAsset;
  let currentNet = netSalary;
  let reachedMonth = -1;
  if(asset >= targetPrice) reachedMonth = 0;

  const results = [];

  for(let m=0; m<=maxMonths; m++) {
    const yr = Math.floor(m/12);
    const mon = m%12;

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

    if(m%12===0) {
      results.push({
        year:yr, age:0,
        asset: Math.round(asset),
        netMonthly: Math.round(currentNet/12),
        monthlyExpense: Math.round(livingCost+monthlyLoanPayment+carMaint+babyM),
      });
    }
    if(reachedMonth<0 && asset>=targetPrice) {
      reachedMonth = m+1;
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
      age=30, salary, asset=0, housePrice,
      living=200, invest='mixed', investRate=5,
      raiseMode='fixed', raisePct=3,
      loan=false,
      weddingOn=false, weddingCost=5000, weddingAge=33,
      babyOn=false, babyCost=500, babyAge=35,
      carOn=false, carType='domestic', carCost=3500, carAge=30,
    } = body;

    if(!salary||salary<500) return json({ error: '연봉 입력 필요' }, 400);
    if(!housePrice||housePrice<1000) return json({ error: '집값 입력 필요' }, 400);

    const takeHome = calcTakehome(salary);
    const netSalary = takeHome * 12;
    const loanAmt  = loan ? Math.round(housePrice*0.40) : 0;
    const effectiveTarget = housePrice - loanAmt;

    // 이벤트
    const extraByYear={}, monthlyBabyByYr={};
    if(weddingOn) { const yr=Math.max(0,weddingAge-age); extraByYear[yr]=(extraByYear[yr]||0)+weddingCost; }
    if(babyOn) {
      const startYr=Math.max(0,babyAge-age);
      for(let i=0;i<26;i++){const yr=startYr+i;const c=Math.min(Math.round(babyCost*Math.pow(1.03,i)),2000);monthlyBabyByYr[yr]=(monthlyBabyByYr[yr]||0)+Math.round(c/12);}
    }
    const carMaintMap={domestic:{fuel:15,insure:10,repair:5},foreign:{fuel:25,insure:20,repair:15},super:{fuel:50,insure:50,repair:50}};
    const carBase=carMaintMap[carType]||carMaintMap.domestic;
    const basePrice={domestic:3500,foreign:8000,super:30000};
    const ratio=Math.max(0.5,Math.min(3,carCost/(basePrice[carType]||3500)));
    const carMonthlyMaint=carOn?Math.round(carBase.fuel*Math.sqrt(ratio)+carBase.insure*ratio+carBase.repair*Math.sqrt(ratio)+carCost*0.10/12):0;
    if(carOn){const yr=Math.max(0,carAge-age);extraByYear[yr]=(extraByYear[yr]||0)+carCost;}

    const promoRaise = raiseMode==='promo';
    const maxNetSalary = calcTakehome(15000)*12;

    const sim = simulateHousecheck({
      netSalary, initAsset:asset, targetPrice:effectiveTarget,
      investRate, extraByYear, monthlyBabyByYr,
      loanAmt, loanRate:4,
      annualRaisePct: promoRaise?raisePct:raisePct,
      promoRaise, promoBasePct:raisePct, maxNetSalary,
      carStartYr: carOn?Math.max(0,carAge-age):Infinity,
      carMonthlyMaint, livingCost:living,
    });

    const years = sim.reachedMonth>0 ? Math.ceil(sim.reachedMonth/12) : null;
    const achieveAge = years ? age+years : null;
    const monthlySave = takeHome - living - carMonthlyMaint;
    const savingRate = Math.round(monthlySave/takeHome*100);
    const monthlyInvest = Math.round(asset*(Math.pow(1+investRate/100,1/12)-1));
    const babyTotal = babyOn?calcBabyTotal(babyCost):0;
    const totalEventCost=(weddingOn?weddingCost:0)+babyTotal+(carOn?carCost:0);

    return json({
      years, reachedMonth:sim.reachedMonth, achieveAge,
      housePrice, effectiveTarget, loanAmt,
      monthlyLoanPayment: sim.monthlyLoanPayment,
      takeHome, monthlySave, savingRate,
      monthlyInvest,
      carMonthly: carMonthlyMaint,
      weddingCost:weddingOn?weddingCost:0,
      babyTotal, carCost:carOn?carCost:0,
      totalEventCost,
      chartData: sim.results.map(r=>({...r, age:age+r.year})),
      eventMarkers:{
        wedding:weddingOn?{year:Math.max(0,weddingAge-age),age:weddingAge}:null,
        baby:babyOn?{year:Math.max(0,babyAge-age),age:babyAge}:null,
        car:carOn?{year:Math.max(0,carAge-age),age:carAge}:null,
      },
      report:{
        asset, salary, takeHome, living,
        investRate, carMonthlyMaint,
        loanAmt, monthlyLoanPayment:sim.monthlyLoanPayment,
        totalEventCost, babyTotal,
      },
    });
  } catch(e) {
    return json({ error: e.message }, 500);
  }
}
