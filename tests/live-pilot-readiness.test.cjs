const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const ctx=vm.createContext({Date});
vm.runInContext(fs.readFileSync('LivePilotReadiness.gs','utf8'),ctx);
const now='2026-10-16T08:00:00.000Z';
const discovery={mode:'SAME_DAY_SELECTED_IDS_READ_ONLY',issue:null,items:[{lotId:'123'}],dailyCoverageVerified:true};
const ts={origin:'ORIGINAL_PROCUREMENT_DOCUMENT',fullDocumentReviewed:true,currentVersionVerified:true,criteria:[{id:'C'}]};
const merchant={approved:true,allowSearchApiCall:true,apiProvider:'BRAVE_SEARCH',billingApproved:true,maxApprovedRequests:2};
const manufacturer={manufacturerSites:{approved:true,hosts:[{approved:true,manufacturerDomainOwnershipReviewed:true,publicSiteTermsReviewed:true}]}};
test('partial and offline discovery blocks pilot',()=>{
 const x={...discovery,dailyCoverageVerified:false};
 const r=ctx.assessTenderLivePilotReadiness(x,ts,merchant,manufacturer,now);
 assert.equal(r.ready,false);assert.ok(r.blocks.includes('FULL_SAME_DAY_LOT_DISCOVERY_UNVERIFIED'));
 assert.equal(r.allowExternalCalls,false);assert.equal(r.allowTenderApplication,false);
});
test('missing billing approval never implies automatic paid calls',()=>{
 const r=ctx.assessTenderLivePilotReadiness(discovery,ts,{...merchant,billingApproved:false},manufacturer,now);
 assert.equal(r.ready,false);assert.ok(r.blocks.includes('SEARCH_API_OWNER_BILLING_APPROVAL_REQUIRED'));
});
test('even all checks passing does not grant network or bid permission',()=>{
 const r=ctx.assessTenderLivePilotReadiness(discovery,ts,merchant,manufacturer,now);
 assert.equal(r.ready,true);assert.equal(r.allowExternalCalls,false);assert.equal(r.allowTenderApplication,false);
 assert.equal(r.certificateGate,false);assert.equal(r.nationalDecision,'HOLD_NATIONAL');
});
test('unverified manufacturer ownership blocks readiness',()=>{
 const r=ctx.assessTenderLivePilotReadiness(discovery,ts,merchant,{manufacturerSites:{approved:true,hosts:[{approved:true}]}},now);
 assert.equal(r.ready,false);assert.ok(r.blocks.includes('REVIEWED_MANUFACTURER_SOURCE_REQUIRED'));
});
