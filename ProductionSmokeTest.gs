/**
 * Read-only production smoke test of the already deployed public portal collector.
 * Never treats portal search listings alone as active/eligible procurement.
 * No bid, Sheet write, API token, paid request or scheduled trigger.
 */
function runTenderProductionSmokeTest(){
 const report=inspectTenderTodayMvp();
 const result=summarizeTenderProductionSmokeTest(report,new Date().toISOString());
 // Log only bounded diagnostic counters; no raw HTML, credentials, or supplier data.
 console.log('TENDER_SMOKE_RESULT: '+JSON.stringify(result));
 console.log('TENDER_PORTAL_ISSUE: '+String(report&&report.issue||'NONE'));
 return result;
}
function summarizeTenderProductionSmokeTest(report,at){
 const out={mode:'TENDER_PRODUCTION_SMOKE_TEST',observedAt:at,
  status:'BLOCKED',issue:null,portalDate:report&&report.date||null,
  portalReportedTotal:null,parsedRows:0,detailChecked:0,confirmedNotOpen:0,
  openVerified:0,unverified:0,coverage:'sample_only',
  dailyCoverageVerified:false,autonomousGo:false,
  sheetsChanged:false,watermarkAdvanced:false,paidServicesUsed:false,
  nextAction:'INVESTIGATE_PORTAL_SOURCE_OR_QUOTA'};
 if(!report||report.mode!=='PUBLIC_PORTAL_TODAY_MVP'||report.issue||
   !Array.isArray(report.items)||report.items.length>30||
   !Array.isArray(report.pages)||report.pages.length>3||
   typeof report.date!=='string'||!/^\d{4}-\d\d-\d\d$/.test(report.date)||
   !Number.isFinite(Date.parse(at))){
  out.issue='PUBLIC_COLLECTOR_NOT_VERIFIED';return out;
 }
 out.portalReportedTotal=report.portalReportedTotal;
 out.parsedRows=report.parsedRows||0;
 const seen=new Set();
 for(const item of report.items){
  if(!item||typeof item.lotId!=='string'||seen.has(item.lotId)||
    !['REVIEW_DATE','NOT_OPEN'].includes(item.decision)){
   out.issue='PUBLIC_LOT_ID_OR_DECISION_INVALID';return out;
  }
  seen.add(item.lotId);
  if(item.detailChecked===true){
   out.detailChecked++;
   if(item.decision==='NOT_OPEN')out.confirmedNotOpen++;
   else out.unverified++;
  }else out.unverified++;
 }
 out.status='READ_ONLY_SAMPLE_COMPLETED';
 out.nextAction=out.unverified>0?'VERIFY_CURRENT_LOT_STATUS_AND_ORIGINAL_TS':
  'COLLECT_NEW_CURRENTLY_ACCEPTING_LOTS';
 return out;
}
