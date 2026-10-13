const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
function setup(){
 let fetches=0,claims=0;
 const c=vm.createContext({Date,Set,Map,Utilities:{DigestAlgorithm:{SHA_256:'sha'},
 computeDigest:(_,data)=>Array.from(crypto.createHash('sha256').update(Buffer.from(data.map(b=>(b+256)%256))).digest()).map(b=>b>127?b-256:b)}});
 for(const f of ['NationalEvidence.gs','OriginalDocuments.gs','OriginalPdfFetch.gs'])vm.runInContext(fs.readFileSync(f,'utf8'),c);
 c.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})};
 c.pilotBudget_=()=>({claim:()=>{claims++;}});
 return {c,get:()=>({fetches,claims}),setFetch:f=>{c.UrlFetchApp={fetch:(url,opts)=>{fetches++;return f(url,opts)}}}};
}
const now='2026-10-13T05:00:00.000Z';
function fixture(){
 const lot={id:'1',lotNumber:'L1',announcementId:'2',announcementNumber:'A2',statusCode:'OPEN',
 plannedMethodId:3,actualMethodId:3,revisionHash:'c'.repeat(64),planIds:['3'],
 verifiedAt:now,isGoods:true,planCoverageVerified:true,active:true,amountKzt:1000,quantity:1,
 applicationStart:'2026-10-13T04:00:00.000Z',deadline:'2026-10-13T09:00:00.000Z'};
 const proof={kind:'OFFICIAL_PER_LOT',restriction:'NO',adapterId:'TEST',url:'https://example.invalid/record',
 sha256:'a'.repeat(64),version:'v1',observedAt:now,context:structuredClone(lot),
 allPlanRowsVerified:true,methodAndExceptionsVerified:true};
 const bytes=Array.from(Buffer.from('%PDF-1.7\nSYNTHETIC TEST BYTES\n%%EOF\n'));
 const document={kind:'ORIGINAL_PROCUREMENT_DOCUMENT',url:'https://v3bl.goszakup.gov.kz/files/download_file/123/456/',
 sha256:crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
 version:'reviewed-v1',observedAt:now,mimeType:'application/pdf',context:structuredClone(lot)};
 const policy={national:{approved:true,maxAgeMs:3600000,sources:[{approved:true,adapterId:'TEST',artifacts:[structuredClone(proof)]}]},
 documents:{approved:true,maxBytes:1024,maxAgeMs:3600000,artifacts:[{
 ...structuredClone(document),approved:true,sourceBindingReviewed:true,currentVersionReviewed:true,fullOriginalReviewed:true}]},
 originalPdfDownload:{approved:true,allowPublicPdfFetch:true,maxBytes:1024,maxRuntimeMs:30000,
 approvedSources:[{approved:true,url:document.url,sha256:document.sha256,version:document.version,
 lotId:lot.id,announcementId:lot.announcementId,revisionHash:lot.revisionHash}]}};
 return {input:{lot,nationalProof:proof,researchAuthorized:true,document},policy,bytes};
}
function response(bytes,type='application/pdf',status=200){
 return {getResponseCode:()=>status,getAllHeaders:()=>({'Content-Type':type,'Content-Length':String(bytes.length)}),
 getContent:()=>bytes};
}
test('exact reviewed bytes pass intake but do NOT assert PDF parsing or TS compliance',()=>{
 const h=setup(),f=fixture(),r=h.c.inspectTenderOriginalPdfResponse_(f.input,f.policy,response(f.bytes),now);
 assert.equal(r.accepted,true);assert.equal(r.originalTs.sha256,f.input.document.sha256);
 assert.equal(r.pdfParseVerified,false);assert.equal(r.signatureVerified,false);
 assert.equal(r.tsCompliance,'UNVERIFIED');assert.equal(r.commercialDecision,'REVIEW');
 assert.equal(r.bytes,undefined);
});
test('absent national proof blocks even before a fetch',()=>{
 const h=setup(),f=fixture();f.input.nationalProof=null;
 h.setFetch(()=>{throw Error('unexpected')});
 const r=h.c.inspectTenderOriginalPdfOnce(f.input,f.policy);
 assert.equal(r.nationalDecision,'HOLD_NATIONAL');assert.equal(h.get().fetches,0);assert.equal(h.get().claims,0);
});
test('national YES produces SKIP and no download',()=>{
 const h=setup(),f=fixture();f.input.nationalProof.restriction='YES';f.policy.national.sources[0].artifacts[0].restriction='YES';
 const r=h.c.preflightTenderOriginalPdf_(f.input,f.policy,now);
 assert.equal(r.allowed,false);assert.equal(r.decision,'SKIP');
});
test('no independent approval, wrong version, hash, lot context and guessed link block',()=>{
 const h=setup();
 for(const bad of ['downloadDisabled','registryMissing','mismatchedVersion','wrongLot','guessedHost','signedQuery']){
  const f=fixture();
  if(bad==='downloadDisabled')f.policy.originalPdfDownload.allowPublicPdfFetch=false;
  if(bad==='registryMissing')f.policy.documents.artifacts=[];
  if(bad==='mismatchedVersion')f.input.document.version='v2';
  if(bad==='wrongLot')f.input.document.context.id='999';
  if(bad==='guessedHost')f.input.document.url='https://evil.example/files/download_file/123/456/';
  if(bad==='signedQuery')f.input.document.url+='?token=SECRET';
  assert.equal(h.c.preflightTenderOriginalPdf_(f.input,f.policy,now).allowed,false,bad);
 }
});
test('reject invalid MIME, HTML login, byte mismatch, oversized body, mismatched Content-Length',()=>{
 const h=setup(),f=fixture();
 for(const r of [response(f.bytes,'text/html'),response(Array.from(Buffer.from('<html>login</html>'))),
  response([...f.bytes,65]),response(Array(1025).fill(65)),
  {getResponseCode:()=>200,getAllHeaders:()=>({'Content-Type':'application/pdf','Content-Length':'999'}),getContent:()=>f.bytes}]){
  assert.equal(h.c.inspectTenderOriginalPdfResponse_(f.input,f.policy,r,now).accepted,false);
 }
});
test('one approved HTTP request, no redirect or cookies, no bytes in report',()=>{
 const h=setup(),f=fixture();
 // Normalize policy observation times to the real runtime for controlled simulation.
 const stamp=new Date().toISOString();
 f.input.lot.verifiedAt=stamp;f.input.nationalProof.observedAt=stamp;f.input.nationalProof.context.verifiedAt=stamp;
 f.policy.national.sources[0].artifacts[0].observedAt=stamp;
 f.policy.national.sources[0].artifacts[0].context.verifiedAt=stamp;
 f.input.document.observedAt=stamp;f.policy.documents.artifacts[0].observedAt=stamp;
 f.input.lot.applicationStart=new Date(Date.now()-60000).toISOString();
 f.input.lot.deadline=new Date(Date.now()+3600000).toISOString();
 f.input.nationalProof.context.applicationStart=f.input.lot.applicationStart;
 f.input.nationalProof.context.deadline=f.input.lot.deadline;
 f.policy.national.sources[0].artifacts[0].context.applicationStart=f.input.lot.applicationStart;
 f.policy.national.sources[0].artifacts[0].context.deadline=f.input.lot.deadline;
 h.setFetch((url,opts)=>{assert.equal(url,f.input.document.url);assert.equal(opts.followRedirects,false);
 assert.equal(opts.headers.Authorization,undefined);return response(f.bytes);});
 const r=h.c.inspectTenderOriginalPdfOnce(f.input,f.policy);
 assert.equal(r.accepted,true);assert.equal(r.requests,1);assert.equal(h.get().fetches,1);
 assert.equal(h.get().claims,1);assert.equal(r.downloadedBytesReturned,false);
 assert.equal(JSON.stringify(r).includes('SYNTHETIC TEST BYTES'),false);
});
