/** Offline join only. No discovery, paid OCR, storage, bidding or source approval. */
function analyzeTenderSameDay(shortlist, inputs, policy, nowIso) {
  const report = {mode:'SAME_DAY_REVIEWED_RESEARCH',coverage:'sample_only',items:[],
    issue:null,observedAt:nowIso,sheetsChanged:false,revenueGuaranteed:false};
  const now=Date.parse(nowIso), observed=shortlist && Date.parse(shortlist.observedAt);
  if (!shortlist || shortlist.mode!=='SAME_DAY_SELECTED_IDS_READ_ONLY' || shortlist.coverage!=='sample_only' ||
      shortlist.issue || !Array.isArray(shortlist.items) || shortlist.items.length>30 ||
      new Set(shortlist.items.map(function(i){return i && i.lotId;})).size!==shortlist.items.length ||
      !Array.isArray(inputs) || inputs.length>30 || !policy ||
      !Number.isFinite(policy.shortlistMaxAgeMs) || policy.shortlistMaxAgeMs<=0 || policy.shortlistMaxAgeMs>300000 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(nowIso || '') ||
      !Number.isFinite(now) || !Number.isFinite(observed) || observed>now || now-observed>policy.shortlistMaxAgeMs) {
    report.issue='CURRENT_SHORTLIST_REQUIRED';return report;
  }
  shortlist.items.forEach(function(item){
    const out={lotId:item && item.lotId,decision:'REVIEW',nationalDecision:'HOLD_NATIONAL',
      finance:null,reason:'SAME_DAY_CANDIDATE_REQUIRED',sourceUrl:item && item.sourceUrl || null};
    report.items.push(out);
    if (!item || item.decision!=='SAME_DAY_CANDIDATE') return;
    const matches=inputs.filter(function(input){return input && input.lot && input.lot.id===item.lotId;});
    if(matches.length!==1){out.reason='EXACT_RESEARCH_INPUT_REQUIRED';return;}
    const input=matches[0], lot=input.lot;
    const expected={id:item.lotId,lotNumber:item.lotNumber,announcementId:String(item.announcementId),
      announcementNumber:item.announcementNumber,statusCode:item.status,
      plannedMethodId:item.plannedMethodId,actualMethodId:item.actualMethodId,amountKzt:item.amountKzt,
      quantity:item.quantity,applicationStart:item.applicationStart,deadline:item.deadline,
      isGoods:true,planCoverageVerified:true,active:true};
    if(Object.keys(expected).some(function(k){return expected[k]===undefined || lot[k]!==expected[k];}) ||
        !Array.isArray(item.planIds) || !Array.isArray(lot.planIds) ||
        JSON.stringify(item.planIds.slice().sort())!==JSON.stringify(lot.planIds.slice().sort()) ||
        Date.parse(lot.verifiedAt)!==observed || !Number.isFinite(Date.parse(item.deadline)) ||
        Date.parse(item.deadline)<=now || Date.parse(item.applicationStart)>now){
      out.reason='CURRENT_LOT_CONTEXT_MISMATCH_OR_EXPIRED';return;
    }
    try {
      if(Utilities.formatDate(new Date(now),item.deadlineTimezone,'yyyy-MM-dd')!==shortlist.date){
        out.reason='PORTAL_DAY_CHANGED';return;
      }
      const gate=assessTenderNationalEvidence(lot,input.nationalProof,policy.national,nowIso);
      out.nationalDecision=gate.decision;
      if(!gate.allowedResearch){out.decision=gate.decision==='SKIP'?'SKIP':'REVIEW';out.reason=gate.reason;return;}
      const doc=acceptTenderOriginalDocument(input,policy,nowIso);
      out.documentStatus=doc.status;
      if(!doc.accepted){out.reason=doc.reason;return;}
      if(!input.ts || !input.ts.evidence || input.ts.evidence.sha256!==doc.artifact.sha256 ||
          input.ts.evidence.url!==doc.artifact.sourceUrl || input.ts.version!==doc.artifact.version){
        out.reason='TS_ORIGINAL_DOCUMENT_MISMATCH';return;
      }
      const analysis=evaluateTenderResearch(input,policy,nowIso);
      out.decision=analysis.decision;out.nationalDecision=analysis.nationalDecision;
      out.finance=analysis.finance;out.compliance=analysis.compliance;
      out.reasons=analysis.reasons;out.reason='REVIEWED_ENGINE_RESULT';
      out.originalTs={url:doc.artifact.sourceUrl,sha256:doc.artifact.sha256,version:doc.artifact.version};
      // Original source links only, never substitute search snippets for offers.
      out.validQuoteIds=analysis.validQuoteIds;out.unconfirmedQuotes=analysis.unconfirmedQuotes;
      out.missingCosts=analysis.missingCosts;
      out.supplierOffers=(input.quotes || []).filter(function(q){return q && analysis.validQuoteIds.includes(q.id);})
        .map(function(q){return {id:q.id,supplierId:q.supplierId,brand:q.brand,model:q.model,partNumber:q.partNumber,
          unitPrice:q.unitPrice,currency:q.currency,stock:q.stock,priceUrl:q.priceEvidence.url,
          stockUrl:q.stockEvidence.url,deliveryUrl:q.deliveryEvidence.url};});
    }catch(e){out.decision='REVIEW';out.finance=null;out.reason='RESEARCH_CHECK_FAILED';}
  });
  return report;
}
