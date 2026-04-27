export const config = { runtime: 'edge' };

const PRICES={gangnam:{small:90000,mid:140000,big:220000},seoul:{small:55000,mid:90000,big:150000},gyeonggi:{small:30000,mid:55000,big:90000},local:{small:15000,mid:25000,big:45000}};
function calcTakehome(gross){let r;if(gross<=3000)r=0.88;else if(gross<=4000)r=0.855;else if(gross<=5000)r=0.835;else if(gross<=6000)r=0.82;else if(gross<=7000)r=0.805;else if(gross<=8000)r=0.79;else if(gross<=10000)r=0.775;else if(gross<=12000)r=0.755;else if(gross<=15000)r=0.73;else r=0.70;return Math.round(gross*r/12);}
function calcBabyTotal(c){let t=0;for(let i=0;i<26;i++)t+=Math.min(Math.round(c*Math.pow(1.03,i)),2000);return t;}
function getEventData(cfg,age){const extra={},baby={};let carM=0;
  if(cfg.weddingOn){const yr=Math.max(0,(cfg.weddingAge||33)-age);extra[yr]=(extra[yr]||0)+(cfg.weddingCost||5000);}
  if(cfg.babyOn){const s=Math.max(0,(cfg.babyAge||35)-age);for(let i=0;i<26;i++){const yr=s+i;const c=Math.min(Math.round((cfg.babyCost||500)*Math.pow(1.03,i)),2000);baby[yr]=(baby[yr]||0)+Math.round(c/12);}}
  if(cfg.carOn){const yr=Math.max(0,(cfg.carAge||30)-age);extra[yr]=(extra[yr]||0)+(cfg.carCost||3500);carM=Math.round(Math.max((cfg.carCost||3500)*0.015,30));}
  return{extraByYear:extra,monthlyBabyByYr:baby,carMonthly:carM};}
function simulate({salary,asset,living,investRate,targetPrice,age,raisePct,promoRaise,maxSalary,events,maxMonths=360}){
  const mR=Math.pow(1+investRate/100,1/12)-1;let cur=asset;const chart=[];
  for(let m=0;m<=maxMonths;m++){
    const yr=Math.floor(m/12),curAge=age+yr;
    let sal=salary*(1+raisePct/100)**yr;if(promoRaise&&yr>0&&yr%5===0)sal*=1.10;sal=Math.min(sal,maxSalary||999999);
    const netM=calcTakehome(Math.round(sal));
    const carM=(curAge>=(events.carAge||30)&&events.carOn)?events.carMonthly:0;
    const babyM=events.monthlyBabyByYr[yr]||0,evC=m%12===0?(events.extraByYear[yr]||0):0;
    cur=Math.max(0,cur)*(1+mR)+(netM-living-carM-babyM)-evC;
    if(m%12===0)chart.push({year:yr,age:curAge,asset:Math.round(cur),netMonthly:netM,monthlyExpense:living+carM+babyM});
    if(cur>=targetPrice)return{years:Math.ceil((m+1)/12),reachedMonth:m,chartData:chart,netMonthly:calcTakehome(salary),carMonthly:events.carMonthly};
  }
  return{years:null,reachedMonth:-1,chartData:chart,netMonthly:calcTakehome(salary),carMonthly:events.carMonthly};}
function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Content-Type':'application/json'};}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:cors()});}

export default async function handler(req){
  if(req.method==='OPTIONS')return new Response(null,{headers:cors()});
  if(req.method!=='POST')return json({error:'POST only'},405);
  try{
    const{salary,asset=0,region='seoul',size='mid',living=200,investRate=3,age=30,
      raisePct=3,promoRaise=true,maxSalary=999999,
      weddingOn=false,weddingCost=5000,weddingAge=33,
      babyOn=false,babyCost=500,babyAge=35,
      carOn=false,carCost=3500,carAge=30}=await req.json();
    if(!salary||salary<500)return json({error:'연봉 입력 필요'},400);
    const targetPrice=PRICES[region]?.[size];if(!targetPrice)return json({error:'지역/평수 오류'},400);
    const events={...getEventData({weddingOn,weddingCost,weddingAge,babyOn,babyCost,babyAge,carOn,carCost,carAge},age),carAge,carOn};
    const result=simulate({salary,asset,living,investRate,targetPrice,age,raisePct,promoRaise,maxSalary,events});
    const netMonthly=result.netMonthly,babyTotal=babyOn?calcBabyTotal(babyCost):0;
    const monthlyInvest=Math.round(asset*(Math.pow(1+investRate/100,1/12)-1));
    return json({...result,targetPrice,monthlyInvest,totalIncome:netMonthly+monthlyInvest,
      monthlySave:netMonthly-living,savingRate:Math.round((netMonthly-living)/netMonthly*100),
      weddingCost:weddingOn?weddingCost:0,babyTotal,carCost:carOn?carCost:0,
      totalEventCost:(weddingOn?weddingCost:0)+babyTotal+(carOn?carCost:0),
      eventMarkers:{wedding:weddingOn?{year:Math.max(0,weddingAge-age),age:weddingAge}:null,
        baby:babyOn?{year:Math.max(0,babyAge-age),age:babyAge}:null,
        car:carOn?{year:Math.max(0,carAge-age),age:carAge}:null}});
  }catch(e){return json({error:e.message},500);}
}
