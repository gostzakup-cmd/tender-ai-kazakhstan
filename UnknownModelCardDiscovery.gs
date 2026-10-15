/**
 * Issue #30: extract product identity from exact permitted product page
 * without knowing the brand/model/MPN beforehand.
 * Does not infer any mandatory technical TS fact or confirm prices.
 */
function inspectTenderUnknownModelCardHtml(html,url,nowIso){
 const out={mode:'UNKNOWN_MODEL_PRODUCT_CARD',status:'REVIEW',
  reason:'PRODUCT_CARD_UNVERIFIED',product:null,url:url||null,
  technicalDecision:'TECHNICAL_REVIEW',tsCompliancePercent:null,
  technicalFactsVerified:0,certificateGate:false,nationalDecision:'HOLD_NATIONAL',
  commercialDecision:'REVIEW',priceVerified:false};
 if(typeof html!=='string'||html.length>PRODUCT_CARD_PROBE.maxBytes||
    !productCardHost_(url)||!Number.isFinite(Date.parse(nowIso)))return out;
 const nodes=[],re=/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
 let m,blocks=0;
 while((m=re.exec(html))!==null){
  if(!/\btype\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)(?=[\s>]|$)/i.test(m[1]))continue;
  blocks++;
  if(blocks>20||m[2].length>131072){out.reason='JSONLD_LIMIT';return out;}
  let json;try{json=JSON.parse(m[2]);}catch(e){continue;}
  productCardNodes_(json).forEach(x=>{if(productCardTypes_(x,'Product'))nodes.push(x);});
 }
 if(nodes.length!==1){out.reason=nodes.length?'MULTIPLE_PRODUCTS':'NO_PRODUCT_SCHEMA';return out;}
 const p=nodes[0];
 const brand=typeof p.brand==='string'?p.brand:p.brand&&p.brand.name;
 const fields={name:productCardPlain_(p.name,240),
  brand:productCardPlain_(brand,120),
  model:productCardPlain_(typeof p.model==='string'?p.model:p.model&&p.model.name,120),
  partNumber:productCardPlain_(p.mpn,120),
  sku:productCardPlain_(p.sku,120)};
 out.product=fields;
 if(!fields.brand||!fields.model||(!fields.partNumber&&!fields.sku)){
  out.reason='EXACT_IDENTITY_INCOMPLETE';return out;
 }
 out.status='UNREVIEWED_PRODUCT_IDENTITY';
 out.reason='SOURCE_IDENTITY_CANDIDATE_ONLY';
 return out;
}
function inspectTenderTsSearchCardResponses(leads,responses,nowIso){
 const out={mode:'TS_SEARCH_CARD_IDENTITIES',issue:null,items:[],
  nationalDecision:'HOLD_NATIONAL',technicalDecision:'TECHNICAL_REVIEW',
  commercialDecision:'REVIEW',certificatesChecked:false,verifiedTechnicalMatches:0};
 if(!leads||leads.issue||leads.mode!=='TS_SEARCH_PRODUCT_CARD_LEADS'||
   !Array.isArray(leads.items)||leads.items.length>TS_CARD_BRIDGE.maxCards||
   !Array.isArray(responses)||responses.length!==leads.items.length){
  out.issue='TS_CARD_INPUT_INVALID';return out;
 }
 const seen=new Set();
 for(const r of responses){
  if(!r||!Number.isInteger(r.index)||r.index<0||r.index>=leads.items.length||
     seen.has(r.index)||typeof r.html!=='string'){
   out.issue='TS_CARD_RESPONSE_BINDING_INVALID';out.items=[];return out;
  }
  seen.add(r.index);
  const lead=leads.items[r.index];
  if(r.url!==lead.productUrl){
   out.issue='TS_CARD_URL_MISMATCH';out.items=[];return out;
  }
  const parsed=inspectTenderUnknownModelCardHtml(r.html,r.url,nowIso);
  out.items.push({lotId:lead.lotId,market:lead.market,url:lead.productUrl,
   requiredCriteria:lead.requiredCriteria,product:parsed.product,
   discoveryStatus:parsed.status,reason:parsed.reason,
   technicalDecision:'TECHNICAL_REVIEW',tsCompliancePercent:null,
   certificateGate:false});
 }
 return out;
}
