/**
 * Issue #30: inspect why OWS V3 bounded same-day discovery is partial.
 * All source windows in ClosingDiscovery are change/publication samples,
 * NOT comprehensive deadline listings. Never assert complete day coverage.
 */
function auditTenderClosingDiscoveryCoverage(report){
 const out={mode:'CLOSING_DISCOVERY_COVERAGE_AUDIT',issue:null,
  dailyCoverageVerified:false,coverage:'sample_only',gaps:[],
  foundCandidates:0,canClaimAllSameDayLots:false,
  nationalDecision:'HOLD_NATIONAL',commercialDecision:'REVIEW',
  sheetsChanged:false,watermarkAdvanced:false};
 if(!report||report.mode!=='SAME_DAY_SELECTED_IDS_READ_ONLY'||
    report.discoveryMode!=='OWS_V3_BOUNDED_AUTO'||
    !Array.isArray(report.streams)||report.streams.length!==5||
    !Array.isArray(report.items)||report.items.length>30){
  out.issue='CLOSING_DISCOVERY_AUDIT_INPUT_INVALID';return out;
 }
 if(report.issue)out.gaps.push('SOURCE_OR_POLICY_ERROR');
 if(report.coverage!=='sample_only'||report.dailyCoverageVerified!==false){
  out.issue='UNSUPPORTED_FULL_DAY_COVERAGE_CLAIM';return out;
 }
 // A one-hour change window cannot prove coverage of the entire set of lots
 // closing today, even if all fetched pages happened to have no next page.
 out.gaps.push('DEADLINE_INDEX_OR_FULL_DAY_CURSOR_NOT_AVAILABLE');
 const expected=['TrdBuy.publishDate','TrdBuy.lastUpdateDate',
   'Lots.lastUpdateDate','Lots.indexDate','Lots.byTrdBuyId'];
 const names=new Set();
 for(const s of report.streams){
  if(!s||!expected.includes(s.name)||names.has(s.name)||
     typeof s.hasMore!=='boolean'||!Number.isSafeInteger(s.returned)||
     !Number.isSafeInteger(s.totalReported)||s.returned<0||
     s.totalReported<0||s.returned>s.totalReported){
   out.issue='CLOSING_DISCOVERY_STREAM_INVALID';return out;
  }
  names.add(s.name);
  if(s.hasMore)out.gaps.push('UNPAGED_SOURCE:'+s.name);
 }
 if(names.size!==expected.length){
  out.issue='CLOSING_DISCOVERY_STREAM_INVALID';return out;
 }
 if(report.lotCapReached===true)out.gaps.push('LOT_SAMPLE_LIMIT_REACHED');
 if(report.announcementIdsTruncated===true)out.gaps.push('ANNOUNCEMENT_SAMPLE_LIMIT_REACHED');
 out.foundCandidates=report.items.filter(x=>x&&x.decision==='SAME_DAY_CANDIDATE').length;
 return out;
}
