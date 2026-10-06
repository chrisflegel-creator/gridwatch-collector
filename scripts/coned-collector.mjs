// Standalone external collector. The Site credential belongs only in the runner's secret store.
const site='https://gridwatch-outage-monitor.reliance-5748.chatgpt.site';
const base='https://outagemap.coned.com/resources/data/external/interval_generation_data/';
const token=process.env.GRIDWATCH_SITE_TOKEN;
if(!token)throw Error('GRIDWATCH_SITE_TOKEN is not configured');
async function request(url,options={}){
 for(let attempt=0;attempt<2;attempt++){
  try{
   const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(90000)});
   if(!response.ok){const error=new Error('HTTP '+response.status+' for '+new URL(url).pathname);error.transient=response.status===429||response.status>=500;throw error;}
   const data=await response.json();if(data.error)throw Error('Endpoint reported an error');return data;
  }catch(error){if(attempt||!(error.transient||error.name==='TimeoutError'||error.name==='TypeError'))throw error;}
 }
}
async function publicGet(path){return request(base+path+'?_='+Date.now(),{headers:{Accept:'application/json, text/javascript, */*; q=0.01',Referer:'https://outagemap.coned.com/external/default.html'}});}
async function siteRequest(path,body){return request(site+path,{method:body?'POST':'GET',headers:{'OAI-Sites-Authorization':'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
const metadata=await publicGet('metadata.json'),directory=metadata.directory;
if(typeof directory!=='string'||!/^\d{4}(?:_\d{2}){5}$/.test(directory))throw Error('Invalid publication directory');
const [summary,nyc,westchester]=await Promise.all(['data.json','report_nyc.json','report_westchester.json'].map(file=>publicGet(directory+'/'+file)));
const uploaded=await siteRequest('/api/utility-ingest',{source:'coned-ny',summary,nyc,westchester});
if(!uploaded.accepted||uploaded.superseded)throw Error('Publication was not accepted as the current feed');
const collection=await siteRequest('/api/refresh',{}),saved=await siteRequest('/api/outages');
if(!collection.snapshot||saved.snapshot?.collectedAt!==collection.snapshot.collectedAt||saved.snapshot?.total!==collection.snapshot.total)throw Error('Snapshot read-back mismatch');
const source=saved.snapshot.sources?.find(row=>row.id==='coned-ny');
if(source?.status!=='fresh'||source.customers!==uploaded.customers||Date.parse(source.updatedAt)!==Date.parse(uploaded.publishedAt))throw Error('Publication is saved, but not yet included in a fresh snapshot; the next interval can collect it');
console.log(JSON.stringify({verified:true,source:'Con Edison',publishedAt:uploaded.publishedAt,collectedAt:saved.snapshot.collectedAt,customers:source.customers,reportingAccounts:source.reportingAccounts,counties:uploaded.counties}));
