// Shared by the public GitHub collector and Gridwatch. Public data only.
/** @typedef {{updatedAt:string,fresh:boolean,customers:number,accounts:number,counties:{name:string,customers:number}[],timestampKind?:'checked'}} ValidatedPublication */
function count(v){if(!Number.isSafeInteger(v)||v<0)throw Error('Invalid public customer count');return v;}
function time(value,now){const age=+now-Date.parse(value);if(typeof value!=='string'||!Number.isFinite(age)||age< -300000)throw Error('Invalid public publication clock');return {updatedAt:value,fresh:age<=1800000};}
function localTime(value){
 const m=typeof value==='string'&&value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))? (AM|PM)$/);
 if(!m||+m[4]<1||+m[4]>12)throw Error('Invalid MLGW Central publication clock');
 const values=[+m[3],+m[1],+m[2],+m[4]%12+(m[7]==='PM'?12:0),+m[5],+(m[6]??0)],target=Date.UTC(values[0],values[1]-1,...values.slice(2));let epoch=target;
 const format=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 for(let i=0;i<3;i++){const p=Object.fromEntries(format.formatToParts(new Date(epoch)).map(p=>[p.type,p.value]));epoch+=target-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);}
 const p=Object.fromEntries(format.formatToParts(new Date(epoch)).map(p=>[p.type,p.value]));if([+p.year,+p.month,+p.day,+p.hour,+p.minute,+p.second].some((v,i)=>v!==values[i]))throw Error('Invalid MLGW local date');
 return new Date(epoch).toISOString();
}
function envelope(d,source,now){if(d?.schemaVersion!==1||d.source!==source||!d.reports||!time(d.collectedAt,now).fresh)throw Error('Invalid or stale public relay envelope');}
function success(d){if(d?.status?.code!==200||d.status.type!=='success'||d.status.error!==false)throw Error('Public utility report unavailable');return d.data;}
/** @param {any} d @param {Date} now @returns {ValidatedPublication} */
export function validateOppdRelay(d,now=new Date()){
 envelope(d,'oppd-ne',now);
 const events=success(d.reports.events),counties=success(d.reports.counties),accounts=count(success(d.reports.accounts)?.count);
 if(!accounts||accounts>600000||!Array.isArray(events)||!Array.isArray(counties))throw Error('Incomplete OPPD reports');
 if(events.length===0){
  if(counties.length!==0||!Array.isArray(d.responseDates)||d.responseDates.length!==3||d.responseDates.some(v=>!Number.isFinite(Date.parse(v))||Math.abs(Date.parse(d.collectedAt)-Date.parse(v))>120000))throw Error('OPPD zero report lacks verified response clocks');
  return {...time(d.collectedAt,now),customers:0,accounts,counties:[],timestampKind:'checked'};
 }
 const utc=v=>{const m=typeof v==='string'&&v.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);if(!m||+m[4]>23||+m[5]>59||+m[6]>59)throw Error('Invalid OPPD publication clock');return `${m[3]}-${m[1]}-${m[2]}T${m[4]}:${m[5]}:${m[6]}Z`;};
 const stamp=utc(events[0].lastUpdateTime),clock=time(stamp,now),ids=new Set(),totals=new Map();let total=0;
 for(const e of events){if(typeof e.incidentId!=='string'||!e.incidentId||ids.has(e.incidentId)||e.outageType!==2||e.serviceType!==1||![0,1].includes(e.status)||e.locationType!==1||typeof e.location!=='string'||!e.location||utc(e.lastUpdateTime)!==stamp)throw Error('Invalid OPPD current event');ids.add(e.incidentId);const n=count(e.affectedCount);total+=n;totals.set(e.location,(totals.get(e.location)??0)+n);}
 const names=new Set();let countyTotal=0;
 for(const c of counties){if(typeof c.location!=='string'||names.has(c.location)||totals.get(c.location)!==count(c.affectedCount))throw Error('OPPD county/event totals disagree');names.add(c.location);countyTotal+=c.affectedCount;}
 if(total>accounts||total!==countyTotal||names.size!==totals.size)throw Error('OPPD headline totals disagree');
 return {...clock,customers:total,accounts,counties:counties.map(c=>({name:c.location,customers:c.affectedCount}))};
}
/** @param {any} d @param {Date} now @returns {ValidatedPublication} */
export function validateMlgwRelay(d,now=new Date()){
 envelope(d,'mlgw-tn',now);
 const html=d.reports.summary,events=d.reports.events;
 if(typeof html!=='string'||html.length>1000000||events?.type!=='FeatureCollection'||!Array.isArray(events.features))throw Error('Incomplete MLGW public reports');
 const clocks=[...html.matchAll(/CURRENT AS\s+OF\s+(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} [AP]M)/g)].map(m=>localTime(m[1]));
 const values=[...html.matchAll(/<p\s+class=["'](?:D|M)CustImpact["'][^>]*>\s*([\d,]+)\s*<\/p>/g)].map(m=>count(Number(m[1].replaceAll(',',''))));
 if(clocks.length!==2||clocks[0]!==clocks[1]||values.length!==4||values[0]!==values[2]||values[1]!==values[3]||!html.includes('Customers Without Power')||!html.includes('Customers With Power'))throw Error('MLGW desktop/mobile summaries disagree');
 const clock=time(clocks[0],now),accounts=values[0]+values[1],ids=new Set();let total=0;
 for(const f of events.features){const e=f.properties,id=count(e?.OUTAGE_NO),n=count(e?.CUR_CUST_AFF);
  if(f.type!=='Feature'||!id||ids.has(id)||typeof e.STATUS!=='string'||!e.STATUS.trim()||/restored|completed|cancelled/i.test(e.STATUS)||Date.parse(localTime(e.TIME_STAMP))>+now+300000)throw Error('Invalid MLGW current event');ids.add(id);total+=n;
 }
 if(!accounts||accounts>600000||total!==values[1]||total>accounts)throw Error('MLGW event/headline totals disagree');
 // MLGW's official service/map scope is Shelby County, Tennessee.
 return {...clock,customers:total,accounts,counties:[{name:'Shelby',customers:total}]};
}
