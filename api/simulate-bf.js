export const config = { runtime: 'edge' };

// ━━ 공통 함수 (standalone) ━━
const PRICES = {
  gangnam: { small:90000, mid:140000, big:220000 },
  seoul:   { small:55000, mid:90000,  big:150000 },
  gyeonggi:{ small:30000, mid:55000,  big:90000  },
  local:   { small:15000, mid:25000,  big:45000  },
};
const MY_ASSETS = { none:0, small:8000, mid:25000, big:40000 };

function calcTakehome(gross) {
  let rate;
  if(gross<=3000)rate=0.88;else if(gross<=4000)rate=0.855;else if(gross<=5000)rate=0.835;
  else if(gross<=6000)rate=0.82;else if(gross<=7000)rate=0.805;else if(gross<=8000)rate=0.79;
  else if(gross<=10000)rate=0.775;else if(gross<=12000)rate=0.755;else if(gross<=15000)rate=0.73;
  else rate=0.70;
  return Math.round(gross * rate / 12);
}

function calcBabyTotal(initCost) {
  let total = 0;
  for(let i=0;i<26;i++) total+=Math.min(Math.round(initCost*Math.pow(1.03,i)),2000);
  return total;
}

function simulateBF({ netSalary, initAsset, targetPrice, investRate=0,
  extraByYear={}, monthlyBabyByYr={}, loanAmt=0, loanRate=4,
  annualRaisePct=0, promoRaise=false, promoBasePct=3, maxNetSalary=999999,
  carStartYr=999, carMonthlyMaint=0, livingCost=200, maxMonths=360 }) {
  const monthlyR = Math.pow(1+investRate/100,1/12)-1;
  const r30 = loanAmt>0 ? loanRate/100/12 : 0;
  const monthlyLoanPayment = (loanAmt>0&&r30>0)
    ? Math.round(loanAmt*r30*Math.pow(1+r30,360)/(Math.pow(1+r30,360)-1)) : 0;
  let asset=initAsset, currentNet=netSalary, reachedMonth=-1;
  if(asset>=targetPrice) reachedMonth=0;
  const results=[];
  for(let m=0;m<maxMonths;m++){
    const yr=Math.floor(m/12), mon=m%12;
    if(mon===0&&m>0){
      if(promoRaise){currentNet*=(1+promoBasePct/100);if(yr%5===0)currentNet*=1.10;}
      else currentNet*=(1+annualRaisePct/100);
      currentNet=Math.min(currentNet,maxNetSalary);
    }
    const netM=currentNet/12, carM=yr>=carStartYr?carMonthlyMaint:0;
    const babyM=monthlyBabyByYr[yr]||0, evCost=mon===0?(extraByYear[yr]||0):0;
    asset=Math.max(0,asset)*(1+monthlyR)+(netM-livingCost-monthlyLoanPayment-carM-babyM)-evCost;
    results.push({year:yr,age:0,asset:Math.round(asset),netMonthly:Math.round(currentNet/12),
      monthlyExpense:Math.round(livingCost+monthlyLoanPayment+carM+babyM),
      label:mon===0&&extraByYear[yr]?['이벤트']:null,housePurchase:false});
    if(reachedMonth<0&&asset>=targetPrice){
      reachedMonth=m+1;
      results.push({year:yr,age:0,asset:0,netMonthly:Math.round(currentNet/12),
        monthlyExpense:0,label:['🏠집구매'],housePurchase:true});
      if(m>=240)break;
    }
  }
  return{results,reachedMonth,monthlyLoanPayment};
}

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Content-Type':'application/json'};}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:cors()});}

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null,{headers:cors()});
  if(req.method!=='POST') return json({error:'POST only'},405);
  try{
    const { salary, asset=0, myAsset='none', region='seoul', size='mid',
      living=200, investRate=5, age=30,
      raisePct=3, promoRaise=true, maxSalary=15000,
      weddingOn=false, weddingCost=5000, weddingAge=33,
      babyOn=false, babyCost=500, babyAge=35,
      carOn=false, carCost=3500, carAge=30, loanOn=false } = await req.json();

    if(!salary||salary<500) return json({error:'연봉 입력 필요'},400);
    const targetPrice=PRICES[region]?.[size];
    if(!targetPrice) return json({error:'지역/평수 오류'},400);

    const initAsset=(MY_ASSETS[myAsset]||0)+(asset||0);
    const netSalary=calcTakehome(salary)*12;
    const loanAmt=loanOn?Math.round(targetPrice*0.40):0;
    const effectiveTarget=targetPrice-loanAmt;

    const extraByYear={}, monthlyBabyByYr={}, eventMarkers={};
    if(weddingOn){const yr=Math.max(0,weddingAge-age);extraByYear[yr]=(extraByYear[yr]||0)+weddingCost;eventMarkers.wedding={year:yr,age:weddingAge};}
    if(babyOn){
      const startYr=Math.max(0,babyAge-age);
      for(let i=0;i<26;i++){const yr=startYr+i;const c=Math.min(Math.round(babyCost*Math.pow(1.03,i)),2000);monthlyBabyByYr[yr]=(monthlyBabyByYr[yr]||0)+Math.round(c/12);}
      eventMarkers.baby={year:Math.max(0,babyAge-age),age:babyAge};
    }
    const carMonthlyMaint=carOn?Math.round(Math.max(carCost*0.015,30)):0;
    if(carOn){const yr=Math.max(0,carAge-age);extraByYear[yr]=(extraByYear[yr]||0)+carCost;eventMarkers.car={year:yr,age:carAge};}

    const maxNetSalary=calcTakehome(maxSalary)*12;
    const sim=simulateBF({
      netSalary,initAsset,targetPrice:effectiveTarget,investRate,
      extraByYear,monthlyBabyByYr,loanAmt,loanRate:4,
      annualRaisePct:promoRaise?0:raisePct,promoRaise,promoBasePct:raisePct,
      maxNetSalary,carStartYr:carOn?Math.max(0,carAge-age):999,
      carMonthlyMaint,livingCost:living,
    });

    const years=sim.reachedMonth>0?Math.ceil(sim.reachedMonth/12):null;
    const netMonthly=calcTakehome(salary);
    const babyTotal=babyOn?calcBabyTotal(babyCost):0;
    const totalEventCost=(weddingOn?weddingCost:0)+babyTotal+(carOn?carCost:0);
    // 연간 데이터만 추출
    const chartData=sim.results.filter(r=>r.label?.includes('🏠집구매')||
      sim.results.indexOf(r)%12===0).map(r=>({...r,age:age+r.year}));

    return json({years,reachedMonth:sim.reachedMonth,targetPrice,effectiveTarget,loanAmt,
      monthlyLoanPayment:sim.monthlyLoanPayment,netMonthly,
      monthlySave:netMonthly-living-carMonthlyMaint,
      savingRate:Math.round((netMonthly-living)/netMonthly*100),
      carMonthly:carMonthlyMaint,totalEventCost,
      weddingCost:weddingOn?weddingCost:0,babyTotal,carCost:carOn?carCost:0,
      chartData,eventMarkers});
  }catch(e){return json({error:e.message},500);}
}
