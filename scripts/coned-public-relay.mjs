// Public utility data only. No Gridwatch credentials are used or saved.
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const base='https://outagemap.coned.com/resources/data/external/interval_generation_data/';
async function get(path){for(let attempt=0;attempt<2;attempt++){try{const r=await fetch(base+path+'?_='+Date.now(),{redirect:'error',signal:AbortSignal.timeout(90000),headers:{Accept:'application/json, text/javascript, */*; q=0.01',Referer:'https://outagemap.coned.com/external/default.html'}});if(!r.ok){const e=Error('Public utility HTTP '+r.status);e.transient=r.status===429||r.status>=500;throw e;}const value=await r.json();if(value.error)throw Error('Utility returned an error');return value;}catch(e){if(attempt||!(e.transient||e.name==='TimeoutError'||e.name==='TypeError'))throw e;}}}
export function validatePublication(publication,now=new Date()){
 const {source,summary,nyc,westchester}=publication;
 if(source!=='coned-ny')throw Error('Invalid utility identity');
 const d=summary?.summaryFileData,age=now.getTime()-Date.parse(d?.date_generated);
 if(!d||d.page_mode?.pausePublish||d.page_mode?.redirectURL||!Number.isFinite(age)||age< -300000||age>1800000)throw Error('Unavailable or stale publication');
 const count=v=>{if(!Number.isSafeInteger(v)||v<0)throw Error('Invalid customer count');return v;};
 const exact=v=>{if(v?.mask||v?.masked)throw Error('Masked count is not exact');return count(v?.val);};
 const expected=[['BRONX','BROOKLYN','MANHATTAN','QUEENS','STATEN ISLAND'],['WESTCHESTER']];
 let affected=0,accounts=0;
 for(const [i,report] of [nyc,westchester].entries()){
  const roots=report?.file_data?.areas;
  if(!Array.isArray(roots)||roots.length!==1)throw Error('Missing report');
  const root=roots[0],areas=root.areas;
  if(!Array.isArray(areas)||areas.length!==expected[i].length)throw Error('Incomplete county report');
  const names=areas.map(a=>a.area_name);
  if(new Set(names).size!==names.length||expected[i].some(name=>!names.includes(name)))throw Error('Invalid county identity');
  let total=0;
  for(const a of areas){const n=exact(a.cust_a);if(n>count(a.cust_s))throw Error('Outages exceed accounts');total+=n;}
  if(total!==exact(root.cust_a))throw Error('County totals disagree');
  affected+=total;accounts+=count(root.cust_s);
 }
 if(affected!==exact(d.total_cust_a)||accounts!==count(d.total_cust_s))throw Error('Utility totals disagree');
 return {affected,accounts,publishedAt:d.date_generated};
}
export async function collectPublicPublication(){
 const metadata=await get('metadata.json');
 if(typeof metadata.directory!=='string'||!/^\d{4}(?:_\d{2}){5}$/.test(metadata.directory))throw Error('Invalid publication directory');
 const [summary,nyc,westchester]=await Promise.all(['data.json','report_nyc.json','report_westchester.json'].map(f=>get(metadata.directory+'/'+f)));
 const publication={source:'coned-ny',summary,nyc,westchester};
 const checked=validatePublication(publication);
 await mkdir('public',{recursive:true});
 await writeFile('public/coned.json',JSON.stringify(publication)+'\n');
 console.log(JSON.stringify({saved:true,...checked}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await collectPublicPublication();
