// Public outage reports only. No credentials or private Gridwatch observations.
import {mkdir,writeFile} from 'node:fs/promises';
import {validateCenterpointTexas} from '../lib/centerpoint-public-validation.mjs';
const root='https://centerpoint.datacapable.com/datacapable/v2',base=root+'/p/centerpoint/r/texas/map/';
async function get(url){const r=await fetch(url+(url.includes('?')?'&':'?')+'_='+Date.now(),{redirect:'error',headers:{Accept:'application/json','Cache-Control':'no-cache'},signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('Public CenterPoint HTTP '+r.status);return r.json();}
try{for(let attempt=0;attempt<3;attempt++){
 const before=await get(base+'stats');
 const [settings,events,counties]=await Promise.all([get(base+'app/settings'),get(root+'/cache/p/centerpoint/r/texas/map/events'),get(base+'events/count?types=COUNTY')]);
 const after=await get(base+'stats');
 // Retain only the fields required to validate public outage observations.
 const publication={schemaVersion:1,source:'centerpoint-tx',region:'texas',collectedAt:new Date().toISOString(),reports:{settings:{maintenanceMode:settings.maintenanceMode,layers:{objectLayers:settings.layers?.objectLayers?.map(l=>({settings:l.settings}))},areaMode:settings.areaMode},statsBefore:{lastUpdatedTime:before.lastUpdatedTime},statsAfter:{lastUpdatedTime:after.lastUpdatedTime},events:events.map(e=>({id:e.id,type:e.type,startTime:e.startTime,lastUpdatedTime:e.lastUpdatedTime,numPeople:e.numPeople,status:e.status,additionalProperties:e.additionalProperties?.filter(p=>p.property==='AREA_COUNTY')})),counties}};
 try{const valid=validateCenterpointTexas(publication,new Date());if(!valid.fresh)throw Error('Stale CenterPoint publication');await mkdir('public',{recursive:true});await writeFile('public/centerpoint-tx.json',JSON.stringify(publication)+'\n');console.log(JSON.stringify({source:publication.source,saved:true,customers:valid.customers,counties:valid.counties.length,publishedAt:valid.updatedAt}));break;}catch(e){if(attempt===2||!/disagree|changed/.test(e.message))throw e;}
}}catch(e){console.error(e.message+'; previous publication retained');process.exitCode=1;}
