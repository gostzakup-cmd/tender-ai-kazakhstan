/**
 * #30: End-to-end pure adapter from bound external search response imports
 * to product card identity and technical hints. No search network/billing.
 */
function previewTenderImportedTsResearch(lot,label,criteria,markets,records,cardResponses,nowIso,policy){
 const out={mode:'IMPORTED_TS_RESEARCH_PREVIEW',issue:null,
  products:[],technicalMatchesVerified:0,nationalDecision:'HOLD_NATIONAL',
  commercialDecision:'REVIEW',certificateGate:false,sheetsChanged:false};
 const plan=planTenderTsParameterSearch(lot,label,criteria,markets);
 if(plan.issue){out.issue=plan.issue;return out;}
 const imported=importTenderTsSearchResponses(plan,records,nowIso);
 if(imported.issue){out.issue=imported.issue;return out;}
 const report=previewTenderTsResearchPipeline(lot,label,criteria,markets,
   imported.packets,cardResponses,nowIso,policy);
 if(report.issue){out.issue=report.issue;return out;}
 out.products=report.products;
 out.queries=report.searchQueries;
 out.coverage='externally_imported_results_only';
 return out;
}
