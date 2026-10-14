const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const c=vm.createContext({Set,Map});
vm.runInContext(fs.readFileSync('CertificateIndependentSearch.gs','utf8'),c);
const lot={id:'123',isGoods:true};
const products=[{lotId:'123',brand:'CNP',model:'CDLF32-80',partNumber:'CDLF32-80-F'}];
const docs=[{id:'DOC1',kind:'CERTIFICATE',requirement:'Сертификат соответствия'}];
test('product search not blocked by missing certificate',()=>{
 const r=c.planCertificateIndependentProductSearch(lot,products,docs);
 assert.equal(r.issue,null);assert.equal(r.targets.length,1);
 assert.deepEqual(Array.from(r.targets[0].searchTerms),['CNP','CDLF32-80','CDLF32-80-F']);
 assert.equal(r.certificateRequiredForSearch,false);
 assert.equal(r.documentRequirements[0].status,'DOCUMENT_NOT_VERIFIED');
 assert.equal(r.documentRequirements[0].blocksTechnicalDiscovery,false);
});
test('technical match persists and separate procurement documentation remains review',()=>{
 const docsReport=c.planCertificateIndependentProductSearch(lot,products,docs);
 const technical={mode:'TECHNICAL_PRODUCT_SHORTLIST',lotId:'123',issue:null,
  products:[{brand:'CNP',model:'CDLF32-80',partNumber:'CDLF32-80-F',decision:'TECHNICAL_MATCH',tsCompliancePercent:100}]};
 const r=c.attachCertificateStatusToTechnicalShortlist(technical,docsReport);
 assert.equal(r.products[0].decision,'TECHNICAL_MATCH');
 assert.equal(r.products[0].tsCompliancePercent,100);
 assert.equal(r.documentationDecision,'DOCUMENT_REQUIRED');
 assert.equal(r.procurementDecision,'REVIEW');
});
test('invalid products or arbitrary query injection fail closed',()=>{
 const x=[{...products[0],model:'CNP" site:evil.com'}];
 assert.equal(c.planCertificateIndependentProductSearch(lot,x,docs).issue,'PRODUCT_IDENTITY_UNVERIFIED');
 assert.equal(c.planCertificateIndependentProductSearch(lot,[...products,...products],docs).issue,'DUPLICATE_PRODUCT');
});
test('document labels cannot create synthetic certificate or commercial GO',()=>{
 const r=c.planCertificateIndependentProductSearch(lot,products,docs);
 assert.equal(r.targets[0].certificateGate,false);
 assert.equal(r.procurementDecision,'REVIEW');assert.equal(r.nationalDecision,'HOLD_NATIONAL');
 assert.equal(r.sourceEvidenceVerified,false);
});
