/**
 * Issue #30: one bounded, deterministic, offline research pipeline.
 * Input responses originate outside this module; no network or billable calls.
 * Search/card suggestions are never reviewed TS evidence or procurement GO.
 */
function previewTenderTsResearchPipeline(lot,label,criteria,markets,searchResponses,cardResponses,nowIso,policy){
 const out={mode:'TS_RESEARCH_PIPELINE_PREVIEW',issue:null,
  lotId:lot&&lot.id||null,searchQueries:[],products:[],
  technicalMatchesVerified:0,certificateGate:false,
  nationalDecision:'HOLD_NATIONAL',commercialDecision:'REVIEW',
  sheetsChanged:false,watermarkAdvanced:false};
 const plan=planTenderTsParameterSearch(lot,label,criteria,markets);
 if(plan.issue){out.issue=plan.issue;return out;}
 out.searchQueries=plan.queries.map(x=>({market:x.market,domain:x.domain,query:x.query}));
 const leads=parseTenderTsSearchCardLeads(plan,searchResponses,policy);
 if(leads.issue){out.issue=leads.issue;return out;}
 if(!Array.isArray(cardResponses)||cardResponses.length!==leads.items.length){
  out.issue='PRODUCT_CARD_RESPONSES_INCOMPLETE';return out;
 }
 const indexed=new Map();
 for(const r of cardResponses){
  if(!r||!Number.isInteger(r.index)||r.index<0||r.index>=leads.items.length||
     indexed.has(r.index)||r.url!==leads.items[r.index].productUrl||
     typeof r.html!=='string'){
   out.issue='PRODUCT_CARD_RESPONSE_UNTRUSTED';out.products=[];return out;
  }
  indexed.set(r.index,r);
 }
 for(let i=0;i<leads.items.length;i++){
  const lead=leads.items[i],r=indexed.get(i);
  if(!r){out.issue='PRODUCT_CARD_RESPONSES_INCOMPLETE';out.products=[];return out;}
  const proposal=proposeTenderCardTechnicalHints(r.html,r.url,lead.requiredCriteria,nowIso);
  const counts={suggestMatch:0,suggestFail:0,unknown:0};
  for(const h of proposal.criterionHints){
   if(h.status==='SUGGEST_MATCH')counts.suggestMatch++;
   else if(h.status==='SUGGEST_FAIL')counts.suggestFail++;
   else counts.unknown++;
  }
  out.products.push({market:lead.market,productUrl:lead.productUrl,
   title:lead.title,brand:proposal.identity&&proposal.identity.brand||null,
   model:proposal.identity&&proposal.identity.model||null,
   partNumber:proposal.identity&&(proposal.identity.partNumber||proposal.identity.sku)||null,
   discoveryStatus:proposal.issue||'UNREVIEWED',
   criteria:lead.requiredCriteria.map(c=>({id:c.id,parameterCode:c.parameterCode,
     operator:c.operator,unit:c.unit,value:c.value||null,
     minimum:c.minimum||null,maximum:c.maximum||null})),
   hints:proposal.criterionHints,counts,
   technicalDecision:'TECHNICAL_REVIEW',tsCompliancePercent:null,
   certificateRequiredForSearch:false});
 }
 out.products.sort((a,b)=>a.counts.suggestFail-b.counts.suggestFail||
  b.counts.suggestMatch-a.counts.suggestMatch||
  a.productUrl.localeCompare(b.productUrl));
 return out;
}
