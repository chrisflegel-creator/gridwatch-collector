// Anonymous official Texas map only; shared by the relay and Gridwatch.
function count(v){if(!Number.isSafeInteger(v)||v<0)throw Error('Invalid CenterPoint customer count');return v;}
function clock(value,now){const age=+now-Date.parse(value);if(typeof value!=='string'||!Number.isFinite(age)||age< -300000)throw Error('Invalid CenterPoint publication clock');return {updatedAt:value,fresh:age<=1800000};}
/** @param {any} d @param {Date} now */
export function validateCenterpointTexas(d,now=new Date()){
 if(d?.schemaVersion!==1||d.source!=='centerpoint-tx'||d.region!=='texas'||!clock(d.collectedAt,now).fresh)throw Error('Invalid or stale CenterPoint Texas relay');
 const {settings,statsBefore,statsAfter,events,counties}=d.reports??{},layers=settings?.layers?.objectLayers;
 if(settings?.maintenanceMode?.enabled!==false||!Array.isArray(layers)||layers.length!==1||layers[0]?.settings?.visibility!=='PUBLIC'||layers[0].settings.defaultEnabled!==true||layers[0].settings.supportedEventTypes?.join()!=='OUTAGE'||layers[0].settings.globalConditions?.length!==0||settings?.areaMode?.restricted===true)throw Error('CenterPoint map unavailable or filtered');
 const epoch=Number(statsAfter?.lastUpdatedTime);count(epoch);
 if(!epoch||statsBefore?.lastUpdatedTime!==statsAfter.lastUpdatedTime||!Array.isArray(events)||!Array.isArray(counties)||counties.length<10||counties.length>20)throw Error('Incomplete or changed CenterPoint publication');
 const allowed=['AUSTIN','BRAZORIA','CHAMBERS','COLORADO','FORT BEND','GALVESTON','GRIMES','HARRIS','LIBERTY','MATAGORDA','MONTGOMERY','WALLER','WHARTON','WASHINGTON','SAN JACINTO'];
 const time=clock(new Date(epoch).toISOString(),now),ids=new Set(),totals=new Map(),ambiguous=new Set();let customers=0,unallocated=0,overlap=0;
 for(const e of events){const id=count(e.id),n=count(e.numPeople);count(e.startTime);count(e.lastUpdatedTime);
  if(!id||ids.has(id)||e.lastUpdatedTime!==epoch||e.startTime>+now+300000||e.type!==undefined&&e.type!=='OUTAGE'||typeof e.status!=='string'||!e.status.trim()||/restored|completed|cancelled/i.test(e.status))throw Error('Invalid CenterPoint current incident');ids.add(id);
  const labels=e.additionalProperties?.filter(p=>p.property==='AREA_COUNTY');
  if(labels!==undefined&&!Array.isArray(labels)||labels?.length>1)throw Error('Invalid CenterPoint county scope');
  const value=labels?.[0]?.value,values=value===undefined||value===null?[]:typeof value==='string'?[value]:value;
  if(!Array.isArray(values)||values.some(v=>typeof v!=='string'))throw Error('Invalid CenterPoint county scope');
  const names=values.map(v=>v.trim().toUpperCase()).filter(Boolean);
  if(new Set(names).size!==names.length||names.some(name=>!allowed.includes(name)))throw Error('Invalid CenterPoint county scope');
  if(names.length===1)totals.set(names[0],(totals.get(names[0])??0)+n);
  else {unallocated+=n;overlap+=n*Math.max(0,names.length-1);for(const name of names.length?names:allowed)ambiguous.add(name);}
  customers+=n;
 }
 const names=new Set();let accounts=0,total=0;
 const rows=counties.map(c=>{const n=count(c.customersAffected),served=count(c.customersServed);
  if(c.type!=='COUNTY'||typeof c.name!=='string'||names.has(c.name)||!allowed.includes(c.name)||n>served||(ambiguous.has(c.name)?n<(totals.get(c.name)??0):n!==(totals.get(c.name)??0)))throw Error('CenterPoint county/event totals disagree');
  names.add(c.name);accounts+=served;total+=n;return {name:c.name,customers:n};
 });
 if((ambiguous.size?total<customers-unallocated||total>customers+overlap:total!==customers)||[...totals.keys()].some(name=>!names.has(name))||accounts<2500000||accounts>4000000||customers>accounts)throw Error('CenterPoint service and event totals disagree');
 // The Texas endpoint supplies a complete state list even when one incident
 // spans counties or lacks county attribution. Preserve that state total and
 // only independently reconciled county observations; never split an event.
 return {...time,customers,accounts,stateOnly:ambiguous.size>0,counties:ambiguous.size?rows.filter(c=>!ambiguous.has(c.name)):rows};
}
