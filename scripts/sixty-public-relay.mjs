import {createRequire} from 'node:module';
import {writeFile,mkdir} from 'node:fs/promises';
import {parseAlliant,parseSrp} from '../lib/sixty-public-validation.mjs';
const definitions=[{source:'alliant',origin:'https://myaccount.alliantenergy.com',page:'https://myaccount.alliantenergy.com/Portal/',urls:['https://alliant-svc.smartcmobile.com/outageAPI/api/1/outage/alloutages/2/1/true','https://alliant-svc.smartcmobile.com/Services/api/1/Outage/GetOutageSummaryDetails?mode=1']},{source:'srp',origin:'https://myaccount.srpnet.com',page:'https://myaccount.srpnet.com/power/myaccount/outages',urls:['https://myaccount.srpnet.com/myaccountapi/api/outages/getall']}];
await mkdir('public',{recursive:true});let failed=false;
for(const definition of definitions){
 try{
  let payload,reports;
  const bootstrap=await fetch(definition.page,{signal:AbortSignal.timeout(20000)});
  const cookie=bootstrap.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const headers={Accept:'application/json',Origin:definition.origin,Referer:definition.page,ST:'PL',uid:'1',...(cookie?{Cookie:cookie}:{})};
  for(let attempt=0;attempt<3;attempt++){
   let data;try{data=await Promise.all(definition.urls.map(async url=>{const r=await fetch(url+(url.includes('?')?'&':'?')+'_publication='+Date.now()+'-'+attempt,{redirect:'manual',headers,signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Source HTTP '+r.status+' at '+new URL(url).pathname+'; '+(await r.text()).replace(/\s+/g,' ').slice(0,120));const text=await r.text();if(text.length>2000000)throw Error('Source report too large');return JSON.parse(text);}));}catch(e){
    if(!/HTTP 403/.test(e.message)||!process.env.GRIDWATCH_PLAYWRIGHT_MODULE)throw e;
    const {chromium}=createRequire(import.meta.url)(process.env.GRIDWATCH_PLAYWRIGHT_MODULE);
    const browser=await chromium.launch({headless:true});
    try{const page=await browser.newPage();await page.goto(definition.page+(definition.source==='alliant'?'#/PreOutages':''),{waitUntil:'domcontentloaded',timeout:30000});
     data=await page.evaluate(async urls=>Promise.all(urls.map(async url=>{const r=await fetch(url,{credentials:'include',headers:{Accept:'application/json',ST:'PL',uid:'1'}});if(!r.ok)throw Error('Public browser request HTTP '+r.status);return r.json();})),definition.urls);
    }finally{await browser.close();}
   }
   const checked=new Date();payload={schemaVersion:1,source:definition.source,checkedAt:checked.toISOString(),data};
   try{
    reports=definition.source==='srp'?[parseSrp(data[0],{id:'srp-az',name:'Salt River Project state total',kind:'srp',states:['AZ'],eiaIds:['16572']},checked)]:['IA','WI'].map(state=>parseAlliant(data[0],data[1],{id:'alliant-'+state.toLowerCase(),name:'Alliant '+state,kind:'alliant',states:[state],eiaIds:[state==='IA'?'9417':'20856']},checked));
    if(reports.some(r=>!r.fresh))throw Error('Stale source report');break;
   }catch(e){if(attempt===2||!/disagree|Mixed/.test(e.message))throw e;}
  }
  await writeFile('public/'+definition.source+'.json',JSON.stringify(payload));console.log(JSON.stringify({source:definition.source,saved:true,checkedAt:payload.checkedAt,totals:reports.map(r=>({state:r.stateReports[0].state,customers:r.customers,updatedAt:r.updatedAt}))}));
 }catch(e){failed=true;console.error(JSON.stringify({source:definition.source,saved:false,error:e.message}));}
}
if(failed)process.exitCode=1;
