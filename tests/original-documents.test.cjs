// SYNTHETIC envelopes/approvals; not real PDF parsing or live national verdicts.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
let hashes=0;const c=vm.createContext({Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(a,b)=>{hashes++;return Array.from(crypto.createHash('sha256').update(Buffer.from(b.map(v=>(v+256)%256))).digest());}}});
for(const file of ['NationalEvidence.gs','OriginalDocuments.gs'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),c);
function fixture(){
 const now='2026-10-12T08:00:00Z',lot={id:'1',lotNumber:'SYNTHETIC-1',announcementId:'2',announcementNumber:'SYNTHETIC-2',statusCode:'OPEN',plannedMethodId:3,actualMethodId:3,revisionHash:'c'.repeat(64),planIds:['3'],verifiedAt:now,isGoods:true,planCoverageVerified:true,active:true,amountKzt:1000,quantity:1,applicationStart:'2026-10-12T07:00:00Z',deadline:'2026-10-13T08:00:00Z'};
 const proof={kind:'OFFICIAL_PER_LOT',restriction:'NO',adapterId:'SYNTHETIC',url:'https://example.invalid/synthetic',sha256:'a'.repeat(64),version:'v1',observedAt:now,context:structuredClone(lot),allPlanRowsVerified:true,methodAndExceptionsVerified:true};
 const bytes=Array.from(Buffer.from('%PDF-1.7\nSYNTHETIC ENVELOPE ONLY\n%%EOF\n'));
 const document={kind:'ORIGINAL_PROCUREMENT_DOCUMENT',url:'https://v3bl.goszakup.gov.kz/files/download_file/1/2/',version:'SYNTHETIC-v1',sha256:crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex'),observedAt:now,mimeType:'application/pdf',context:structuredClone(lot)};
 const policy={national:{approved:true,maxAgeMs:3600000,sources:[{approved:true,adapterId:'SYNTHETIC',artifacts:[structuredClone(proof)]}]},documents:{approved:true,maxBytes:1024,maxAgeMs:3600000,artifacts:[{...structuredClone(document),approved:true,sourceBindingReviewed:true,currentVersionReviewed:true,fullOriginalReviewed:true}]}};
 return {input:{lot,nationalProof:proof,researchAuthorized:true,document,bytes},policy,now};
}
const run=f=>c.acceptTenderOriginalDocument(f.input,f.policy,f.now);
test('exact approved bytes produce intake reference, not parsed TS or GO',()=>{const f=fixture(),r=run(f);assert.equal(r.accepted,true);assert.equal(r.status,'ORIGINAL_BYTES_VERIFIED');assert.equal(r.artifact.sha256,f.input.document.sha256);assert.equal(r.pdfParseVerified,false);assert.equal(r.signatureVerified,false);assert.equal(r.tsCompliance,'UNVERIFIED');assert.equal(r.commercialDecision,'REVIEW');assert.equal(r.bytes,undefined);});
for(const scenario of ['national missing','national YES','manual PASS','no authorization','no document policy','no approved source','wrong lot','wrong announcement','wrong revision','wrong plans','old observation','changed version','changed bytes','login HTML','wrong MIME','missing EOF','large file','sparse bytes','bad byte','signed URL','unreviewed binding','unreviewed version','partial original'])test('holds original document: '+scenario,()=>{
 const f=fixture(),i=f.input;
 if(scenario==='national missing')i.nationalProof=null;
 if(scenario==='national YES'){i.nationalProof.restriction='YES';f.policy.national.sources[0].artifacts[0].restriction='YES';}
 if(scenario==='manual PASS')i.nationalProof={decision:'PASS_TO_TS'};
 if(scenario==='no authorization')i.researchAuthorized=false;
 if(scenario==='no document policy')f.policy.documents=null;
 if(scenario==='no approved source')f.policy.documents.artifacts=[];
 if(scenario==='wrong lot')i.document.context.id='999';
 if(scenario==='wrong announcement')i.document.context.announcementId='999';
 if(scenario==='wrong revision')i.document.context.revisionHash='d'.repeat(64);
 if(scenario==='wrong plans')i.document.context.planIds=['4'];
 if(scenario==='old observation'){i.document.observedAt='2020-01-01T00:00:00Z';f.policy.documents.artifacts[0].observedAt=i.document.observedAt;}
 if(scenario==='changed version')i.document.version='v2';
 if(scenario==='changed bytes')i.bytes[12]=65;
 if(scenario==='login HTML')i.bytes=Array.from(Buffer.from('<html>login page only</html>'));
 if(scenario==='wrong MIME')i.document.mimeType='text/html';
 if(scenario==='missing EOF')i.bytes.splice(-7);
 if(scenario==='large file')f.policy.documents.maxBytes=16;
 if(scenario==='sparse bytes')i.bytes=new Array(20);
 if(scenario==='bad byte')i.bytes[0]=256;
 if(scenario==='signed URL')i.document.url+='?token=DO_NOT_ECHO';
 if(scenario==='unreviewed binding')f.policy.documents.artifacts[0].sourceBindingReviewed=false;
 if(scenario==='unreviewed version')f.policy.documents.artifacts[0].currentVersionReviewed=false;
 if(scenario==='partial original')f.policy.documents.artifacts[0].fullOriginalReviewed=false;
 const r=run(f);assert.equal(r.accepted,false);assert.equal(r.artifact,null);assert.notEqual(r.commercialDecision,'GO');assert.equal(JSON.stringify(r).includes('DO_NOT_ECHO'),false);
});
test('blocked national gate does not even hash bytes',()=>{const f=fixture();f.input.nationalProof=null;const before=hashes;run(f);assert.equal(hashes,before);});
test('signed Apps Script byte representation hashes identically and replay does not mutate inputs',()=>{const f=fixture();f.input.bytes.splice(15,0,255);f.input.document.sha256=crypto.createHash('sha256').update(Buffer.from(f.input.bytes)).digest('hex');f.policy.documents.artifacts[0].sha256=f.input.document.sha256;f.input.bytes=f.input.bytes.map(b=>b>127?b-256:b);const before=JSON.stringify(f);assert.equal(run(f).accepted,true);assert.equal(JSON.stringify(run(f)),JSON.stringify(run(f)));assert.equal(JSON.stringify(f),before);});

test('digest failure never reflects service error or content',()=>{const f=fixture(),original=c.Utilities.computeDigest;c.Utilities.computeDigest=()=>{throw new Error('PRIVATE_CONTENT_DO_NOT_REFLECT');};try{const r=run(f);assert.equal(r.reason,'DOCUMENT_HASH_FAILED');assert.equal(JSON.stringify(r).includes('PRIVATE_CONTENT'),false);}finally{c.Utilities.computeDigest=original;}});
