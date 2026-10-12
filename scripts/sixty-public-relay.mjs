import {writeFile,mkdir} from 'node:fs/promises';
import {parseAlliant,parseSrp} from '../lib/sixty-public-validation.mjs';
const definitions=[{source:'alliant',urls:['https://alliant-svc.smartcmobile.com/outageAPI/api/1/outage/alloutages/2/1/true','https://alliant-svc.smartcmobile.com/Services/api/1/Outage/GetOutageSummaryDetails?mode=1']},{source:'srp',urls:['https://myaccount.srpnet.com/myaccountapi/api/outages/getall']}];
await mkdir('public',{recursive:true});let failed=false;
for(const definition of definitions){
 try{
  let payload,reports;
  for(let attempt=0;attempt<3;attempt++){
   const data=await Promise.all(definition.urls.map(async url=>{const r=await fetch(url+(url.includes('?')?'&':'?')+'_publication='+Date.now()+'-'+attempt,{redirect:'manual',headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Source HTTP '+r.status);const text=await r.text();if(text.length>2000000)throw Error('Source report too large');return JSON.parse(text);}));
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
