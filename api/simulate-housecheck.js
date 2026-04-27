export const config = { runtime: 'edge' };

function calcTakehome(gross){let r;if(gross<=3000)r=0.88;else if(gross<=4000)r=0.855;else if(gross<=5000)r=0.835;else if(gross<=6000)r=0.82;else if(gross<=7000)r=0.805;else if(gross<=8000)r=0.79;else if(gross<=10000)r=0.775;else if(gross<=12000)r=0.755;else if(gross<=15000)r=0.73;else r=0.70;return Math.round(gross*r/12);}
function calcBabyTotal(c){let t=0;for(let i=0;i<26;i++)t+=Math.min(Math.round(c*Math.pow(1.03,i)),2000);return t;}
function simulate({netSalary,initAsset,targetPrice,investRate=5,extraByYear={},monthlyBabyByYr={},loanAmt=0,loanRate=4,annualRaisePct=3,promoRaise=false,promoBasePct=3,maxNetSalary=999999,carStartYr=999,carMonthlyMaint=0,livingCost=200,maxMonths=360}){
  const mR=Math.pow(1+investRate/100,1/12)-1;
  const r30=loanAmt>0?loanRate/100/12:0;
  const mlp=(loanAmt>0&&r30>0)?Math.round(loanAmt*r30*Math.pow(1+r30,360)/(Math.pow(1+r30,360)-1)):0;
  let asset=initAsset,cur=netSalary,reached=-1;if(asset>=targetPrice)reached=0;
  const results=[];
  for(let m=0;m<=maxMonths;m++){
    const yr=Math.floor(m/12),mon=m%12;
    if(mon===0&&m>0){if(promoRaise){cur*=(1+promoBasePct/100);if(yr%5===0)cur*=1.10;}else cur*=(1+annualRaisePct/100);cur=Math.min(cur,maxNetSalary);}
    const carM=yr>=carStartYr?carMonthlyMaint:0,babyM=monthlyBabyByYr[yr]||0,evC=mon===0?(extraByYear[yr]||0):0;
    asset=Math.max(0,asset)*(1+mR)+(cur/12-livingCost-mlp-carM-babyM)-evC;
    if(m%12===0)results.push({year:yr,age:0,asset:Math.round(asset),netMonthly:Math.round(cur/12),monthlyExpense:Math.round(livingCost+mlp+carM+babyM)});
    if(reached<0&&asset>=targetPrice)reached=m+1;
  }
  return{results,reachedMonth:reached,monthlyLoanPayment:mlp};}
function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Content-Type':'application/json'};}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:cors()});}

export default async function handler(req){
  if(req.method==='OPTIONS')return new Response(null,{headers:cors()});
  if(req.method!=='POST')return json({error:'POST only'},405);
  try{
    const{age=30,salary,asset=0,housePrice,living=200,investRate=5,raiseMode='fixed',raisePct=3,loan=false,
      weddingOn=false,weddingCost=5000,weddingAge=33,babyOn=false,babyCost=500,babyAge=35,
      carOn=false,carType='domestic',carCost=3500,carAge=30}=await req.json();
    if(!salary||salary<500)return json({error:'연봉 입력 필요'},400);
    if(!housePrice||housePrice<1000)return json({error:'집값 입력 필요'},400);
    const th=calcTakehome(salary),net=th*12;
    const la=loan?Math.round(housePrice*0.40):0,et=housePrice-la;
    const ex={},by={};
    if(weddingOn){const yr=Math.max(0,weddingAge-age);ex[yr]=(ex[yr]||0)+weddingCost;}
    if(babyOn){const s=Math.max(0,babyAge-age);for(let i=0;i<26;i++){const yr=s+i;const c=Math.min(Math.round(babyCost*Math.pow(1.03,i)),2000);by[yr]=(by[yr]||0)+Math.round(c/12);}}
    const cm={domestic:{f:15,i:10,r:5},foreign:{f:25,i:20,r:15},super:{f:50,i:50,r:50}}[carType]||{f:15,i:10,r:5};
    const bp={domestic:3500,foreign:8000,super:30000}[carType]||3500;
    const ratio=Math.max(0.5,Math.min(3,carCost/bp));
    const cMaint=carOn?Math.round(cm.f*Math.sqrt(ratio)+cm.i*ratio+cm.r*Math.sqrt(ratio)+carCost*0.10/12):0;
    if(carOn){const yr=Math.max(0,carAge-age);ex[yr]=(ex[yr]||0)+carCost;}
    const sim=simulate({netSalary:net,initAsset:asset,targetPrice:et,investRate,extraByYear:ex,monthlyBabyByYr:by,
      loanAmt:la,loanRate:4,annualRaisePct:raisePct,promoRaise:raiseMode==='promo',promoBasePct:raisePct,
      maxNetSalary:calcTakehome(15000)*12,carStartYr:carOn?Math.max(0,carAge-age):999,
      carMonthlyMaint:cMaint,livingCost:living});
    const yrs=sim.reachedMonth>0?Math.ceil(sim.reachedMonth/12):null;
    const bt=babyOn?calcBabyTotal(babyCost):0;
    return json({years:yrs,reachedMonth:sim.reachedMonth,achieveAge:yrs?age+yrs:null,
      housePrice,effectiveTarget:et,loanAmt:la,monthlyLoanPayment:sim.monthlyLoanPayment,
      takeHome:th,monthlySave:th-living-cMaint,savingRate:Math.round((th-living)/th*100),
      carMonthly:cMaint,totalEventCost:(weddingOn?weddingCost:0)+bt+(carOn?carCost:0),
      chartData:sim.results.map(r=>({...r,age:age+r.year})),
      eventMarkers:{wedding:weddingOn?{year:Math.max(0,weddingAge-age),age:weddingAge}:null,
        baby:babyOn?{year:Math.max(0,babyAge-age),age:babyAge}:null,
        car:carOn?{year:Math.max(0,carAge-age),age:carAge}:null}});
  }catch(e){return json({error:e.message},500);}
}
