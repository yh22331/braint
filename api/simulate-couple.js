export const config = { runtime: 'edge' };

const PRICES={gangnam:{small:90000,mid:140000,big:220000},seoul:{small:55000,mid:90000,big:150000},gyeonggi:{small:30000,mid:55000,big:90000},local:{small:15000,mid:25000,big:45000}};
function calcTakehome(gross){let r;if(gross<=3000)r=0.88;else if(gross<=4000)r=0.855;else if(gross<=5000)r=0.835;else if(gross<=6000)r=0.82;else if(gross<=7000)r=0.805;else if(gross<=8000)r=0.79;else if(gross<=10000)r=0.775;else if(gross<=12000)r=0.755;else if(gross<=15000)r=0.73;else r=0.70;return Math.round(gross*r/12);}
function calcBabyTotal(c){let t=0;for(let i=0;i<26;i++)t+=Math.min(Math.round(c*Math.pow(1.03,i)),2000);return t;}
function getEvData(cfg,age){const ex={},by={};let cm=0;
  if(cfg.weddingOn){const yr=Math.max(0,(cfg.weddingAge||33)-age);ex[yr]=(ex[yr]||0)+(cfg.weddingCost||5000);}
  if(cfg.babyOn){const s=Math.max(0,(cfg.babyAge||35)-age);for(let i=0;i<26;i++){const yr=s+i;const c=Math.min(Math.round((cfg.babyCost||500)*Math.pow(1.03,i)),2000);by[yr]=(by[yr]||0)+Math.round(c/12);}}
  if(cfg.carOn){const yr=Math.max(0,(cfg.carAge||30)-age);ex[yr]=(ex[yr]||0)+(cfg.carCost||3500);cm=Math.round(Math.max((cfg.carCost||3500)*0.015,30));}
  return{extraByYear:ex,monthlyBabyByYr:by,carMonthly:cm};}
function simCouple({me,partner,targetPrice,meAge}){
  const avg=(me.investRate+partner.investRate)/2;
  const mR=Math.pow(1+avg/100,1/12)-1,meR=Math.pow(1+me.investRate/100,1/12)-1;
  const meEv=getEvData({...me.events,weddingCost:me.events.weddingOn?Math.round((me.events.weddingCost||5000)/2):0,babyCost:me.events.babyOn?Math.round((me.events.babyCost||500)/2):0},meAge);
  const pEv=getEvData({...partner.events,weddingCost:partner.events.weddingOn?Math.round((partner.events.weddingCost||5000)/2):0,babyCost:partner.events.babyOn?Math.round((partner.events.babyCost||500)/2):0},meAge);
  let tot=me.asset+partner.asset,solo=me.asset;
  const cChart=[],sChart=[];let cR=-1,sR=-1;
  for(let m=0;m<=360;m++){
    const yr=Math.floor(m/12),ca=meAge+yr;
    let ms=me.salary*(1+me.raisePct/100)**yr;if(me.promoRaise&&yr>0&&yr%5===0)ms*=1.10;ms=Math.min(ms,me.maxSalary||999999);
    let ps=partner.salary*(1+partner.raisePct/100)**yr;if(partner.promoRaise&&yr>0&&yr%5===0)ps*=1.10;ps=Math.min(ps,partner.maxSalary||999999);
    const mn=calcTakehome(Math.round(ms)),pn=calcTakehome(Math.round(ps));
    const mcm=(ca>=(me.events.carAge||30)&&me.events.carOn)?meEv.carMonthly:0;
    const pcm=(ca>=(partner.events.carAge||30)&&partner.events.carOn)?pEv.carMonthly:0;
    const tev=m%12===0?((meEv.extraByYear[yr]||0)+(pEv.extraByYear[yr]||0)):0;
    const mev=m%12===0?(meEv.extraByYear[yr]||0):0;
    tot=Math.max(0,tot)*(1+mR)+(mn+pn-me.living-partner.living-mcm-pcm-(meEv.monthlyBabyByYr[yr]||0)-(pEv.monthlyBabyByYr[yr]||0))-tev;
    solo=Math.max(0,solo)*(1+meR)+(mn-me.living-mcm-(meEv.monthlyBabyByYr[yr]||0))-mev;
    if(m%12===0){cChart.push({year:yr,age:ca,asset:Math.round(tot),meNet:mn,pNet:pn});sChart.push({year:yr,age:ca,asset:Math.round(solo),netMonthly:mn});
      if(cR<0&&tot>=targetPrice)cR=m;if(sR<0&&solo>=targetPrice)sR=m;}
  }
  return{coupleYears:cR>=0?Math.ceil(cR/12):null,soloYears:sR>=0?Math.ceil(sR/12):null,coupleChart:cChart,soloChart:sChart,meCarM:meEv.carMonthly||0,pCarM:pEv.carMonthly||0};}
function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Content-Type':'application/json'};}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:cors()});}

export default async function handler(req){
  if(req.method==='OPTIONS')return new Response(null,{headers:cors()});
  if(req.method!=='POST')return json({error:'POST only'},405);
  try{
    const{me,partner}=await req.json();
    if(!me?.salary||!partner?.salary)return json({error:'연봉 필요'},400);
    const mp=PRICES[me.region||'seoul'][me.size||'mid'],pp=PRICES[partner.region||'seoul'][partner.size||'mid'];
    const targetPrice=(me.region===partner.region&&me.size===partner.size)?mp:Math.round((mp+pp)/2);
    const meAge=me.age||30,r=simCouple({me,partner,targetPrice,meAge});
    const mn=calcTakehome(me.salary),pn=calcTakehome(partner.salary);
    const avg=(me.investRate+partner.investRate)/2;
    const cmi=Math.round((me.asset+partner.asset)*(Math.pow(1+avg/100,1/12)-1));
    const bt=me.events.babyOn?calcBabyTotal(me.events.babyCost||500):0;
    const bma=me.events.babyOn?Math.round(bt/26/12):0;
    const mc=me.events.carOn?me.events.carCost:0,pc=partner.events.carOn?partner.events.carCost:0;
    const wc=me.events.weddingOn?(me.events.weddingCost||5000):0;
    const saved=r.soloYears&&r.coupleYears?r.soloYears-r.coupleYears:null;
    return json({...r,saved,targetPrice,avgInvestRate:avg,
      report:{meNet:mn,pNet:pn,meSalary:me.salary,pSalary:partner.salary,meAsset:me.asset,pAsset:partner.asset,
        meLiving:me.living,pLiving:partner.living,meCarMonthly:r.meCarM,pCarMonthly:r.pCarM,
        meCarCost:mc,pCarCost:pc,combinedMonthlyInvest:cmi,totalIncome:mn+pn+cmi,
        totalExpense:me.living+partner.living+bma+r.meCarM+r.pCarM,
        weddingCost:wc,babyTotal:bt,babyMonthlyAvg:bma,
        totalEventCost:wc+bt+mc+pc,meRaisePct:me.raisePct,mePromo:me.promoRaise,
        pRaisePct:partner.raisePct,pPromo:partner.promoRaise}});
  }catch(e){return json({error:e.message},500);}
}
