const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
function ctx(){
 const c=vm.createContext({Date,Map,Set});
 for(const f of ['ManufacturerSiteDiscovery.gs','ManufacturerPdfIntegrity.gs'])vm.runInContext(fs.readFileSync(f,'utf8'),c);
 return c;
}
const now='2026-10-13T12:00:00.000Z',host='manufacturer.example.com';
function sample(){
 const lot={id:'123',active:true,isGoods:true,planCoverageVerified:true,applicationStart:'2026-10-13T10:00:00.000Z',deadline:'2026-10-13T18:00:00.000Z'};
 const candidate={lotId:'123',brand:'CNP',model:'CDLF32-80',partNumber:'CDLF32-80-F',
  pdfUrl:'https://manufacturer.example.com/cdlf32-80-f.pdf',
  linkedFromUrl:'https://manufacturer.example.com/sitemap.xml',
  linkedSourceSha256:'a'.repeat(64),observedAt:now,discoveryKind:'SITEMAP_PDF_URL',
  status:'PENDING_PDF_BYTES_AND_MANUFACTURER_IDENTITY_REVIEW',manufacturerVerified:false};
 const discovery={mode:'MANUFACTURER_SITE_DISCOVERY',coverage:'approved_sitemaps_sample_only',observedAt:now,
 results:[{lotId:'123',host,candidates:[candidate]}]};
 const policy={approved:true,allowPublicManufacturerPdfFetch:true,maxBytes:100000,
  manufacturerSites:{approved:true,hosts:[{host,brand:'CNP',approved:true,reviewedAt:now,
   reviewerId:'AUDITOR',manufacturerDomainOwnershipReviewed:true,publicSiteTermsReviewed:true}]},
  approvedPdfSources:[{approved:true,lotId:'123',url:candidate.pdfUrl,host,brand:'CNP',
   model:'CDLF32-80',partNumber:'CDLF32-80-F',linkedSourceSha256:'a'.repeat(64),
   ownerReviewed:true,termsReviewed:true}]};
 return {lot,candidate,discovery,policy};
}
test('exact reviewed site and PDF URL pass only preflight, not TS acceptance',()=>{
 const f=sample(),r=ctx().mfrPdfPreflight_(f.discovery,f.lot,f.candidate,f.policy,now);
 assert.equal(r.allowed,true);assert.equal(r.reason,'APPROVED_EXACT_MANUFACTURER_PDF_URL');
});
test('wrong lot, unreviewed host, wrong source hash or unapproved URL fail closed',()=>{
 const c=ctx();for(const change of [f=>f.lot.id='999',f=>f.policy.manufacturerSites.hosts[0].approved=false,
 f=>f.candidate.linkedSourceSha256='b'.repeat(64),f=>f.policy.approvedPdfSources=[],
 f=>f.candidate.pdfUrl='https://evil.com/file.pdf']){
  const f=sample();change(f);assert.equal(c.mfrPdfPreflight_(f.discovery,f.lot,f.candidate,f.policy,now).allowed,false);
 }
});
test('synthetic valid PDF magic EOF and exact body SHA, not datasheet identity',()=>{
 const c=ctx(),bytes=Array.from(Buffer.from('%PDF-1.7\nfake fixture\n%%EOF\n'));
 c.Utilities={DigestAlgorithm:{SHA_256:'sha'},computeDigest:(_,x)=>Array.from(crypto.createHash('sha256').update(Buffer.from(x.map(v=>(v+256)%256))).digest()).map(v=>v>127?v-256:v)};
 const r=c.mfrPdfInspectResponse_({getResponseCode:()=>200,getAllHeaders:()=>({'Content-Type':'application/pdf','Content-Length':String(bytes.length)}),getContent:()=>bytes},sample().candidate,100000,now);
 assert.equal(r.status,'BYTES_HASHED_UNREVIEWED');assert.equal(r.sha256,crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex'));
 assert.equal(r.manufacturerIdentityVerified,false);assert.equal(r.technicalCompliance,'UNVERIFIED');
 assert.equal(r.pdfBytesReturned,false);
});
test('HTML masquerade, redirects, malformed MIME and PDF bytes reject',()=>{
 const c=ctx();for(const [bytes,mime,code] of [
  [Array.from(Buffer.from('<html>login</html>')),'application/pdf',200],
  [Array.from(Buffer.from('%PDF-1.7\nfake fixture\n%%EOF\n')),'text/html',200],
  [Array.from(Buffer.from('%PDF-1.7\nfake fixture\n%%EOF\n')),'application/pdf',302],
  [Array.from(Buffer.from('%PDF-1.7\nfake fixture\n')),'application/pdf',200]
 ]){
  const r=c.mfrPdfInspectResponse_({getResponseCode:()=>code,getAllHeaders:()=>({'Content-Type':mime}),getContent:()=>bytes},sample().candidate,100000,now);
  assert.equal(r.bytesVerified,false);
 }
});
test('owner permission missing stops before fetch or quota',()=>{
 const c=ctx(),f=sample();f.policy.allowPublicManufacturerPdfFetch=false;
 let calls=0;c.UrlFetchApp={fetch:()=>{calls++;throw Error('unexpected');}};
 const r=c.inspectTenderManufacturerPdfOnce(f.discovery,f.lot,f.candidate,f.policy);
 assert.notEqual(r.issue,null);assert.equal(calls,0);
});
