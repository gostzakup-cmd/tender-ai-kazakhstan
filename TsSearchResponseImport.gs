/**
 * #30: Strict import boundary for externally acquired search responses.
 * No network or API usage. The caller must independently obtain responses.
 * Untrusted search links remain investigation leads, never TS evidence.
 */
function importTenderTsSearchResponses(plan,records,nowIso){
 const out={mode:'TS_SEARCH_RESPONSE_IMPORT',issue:null,packets:[],
  searchResultsVerified:false,technicalDecision:'TECHNICAL_REVIEW',
  nationalDecision:'HOLD_NATIONAL',certificateGate:false,sheetsChanged:false};
 const now=Date.parse(nowIso);
 if(!plan||plan.issue||plan.mode!=='TS_PARAMETER_PRODUCT_SEARCH_PLAN'||
    !Array.isArray(plan.queries)||plan.queries.length<1||plan.queries.length>12||
    !Array.isArray(records)||records.length!==plan.queries.length||
    !Number.isFinite(now)){
  out.issue='SEARCH_IMPORT_INPUT_INVALID';return out;
 }
 const indexSet=new Set();
 for(const x of records){
  if(!x||!Number.isInteger(x.queryIndex)||x.queryIndex<0||
     x.queryIndex>=plan.queries.length||indexSet.has(x.queryIndex)||
     x.provider!=='BRAVE_SEARCH'||x.httpStatus!==200||
     x.contentType!=='application/json'||
     typeof x.observedAt!=='string'||!Number.isFinite(Date.parse(x.observedAt))||
     Date.parse(x.observedAt)>now||now-Date.parse(x.observedAt)>300000||
     !x.payload||!x.payload.query||x.payload.query.original!==plan.queries[x.queryIndex].query||
     !x.payload.web||!Array.isArray(x.payload.web.results)||
     x.payload.web.results.length>5){
   out.issue='SEARCH_IMPORT_PROVENANCE_INVALID';out.packets=[];return out;
  }
  indexSet.add(x.queryIndex);
  const planned=plan.queries[x.queryIndex];
  const results=[];
  for(const r of x.payload.web.results){
   if(!r||typeof r.url!=='string'||typeof r.title!=='string'||
      r.title.length>1000){out.issue='SEARCH_IMPORT_RESULT_INVALID';out.packets=[];return out;}
   const host=productCardHost_(r.url);
   if(!host||!(host===planned.domain||host.endsWith('.'+planned.domain)))continue;
   results.push({url:r.url,title:r.title});
  }
  out.packets.push({queryIndex:x.queryIndex,response:{
   query:{original:planned.query},web:{results}}});
 }
 out.packets.sort((a,b)=>a.queryIndex-b.queryIndex);
 return out;
}
