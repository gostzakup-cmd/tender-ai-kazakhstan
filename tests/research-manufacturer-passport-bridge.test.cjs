const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const c=vm.createContext({Date,Set,Map});
c.productCardHost_=u=>typeof u==='string'&&u.startsWith('https://www.satu.kz/')?'www.satu.kz':null;
for(const f of ['ManufacturerSiteDiscovery.gs','ResearchManufacturerPassportBridge.gs'])vm.runInContext(fs.readFileSync(f,'utf8'),c);
const now='2026-10-15T12:00:00.000Z';
const lot={id:'123',isGoods:true,active:true,planCoverageVerified:true,amountKzt:100000,
 verifiedAt:now,applicationStart:'2026-10-15T09:00:00.000Z',deadline:'2026-10-15T18:00:00.000Z'};
const research={mode:'IMPORTED_TS_RESEARCH_PREVIEW',issue:null,products:[{brand:'CNP',model:'CDLF32-80',partNumber:'P1',
 productUrl:'https://www.satu.kz/pump',technicalDecision:'TECHNICAL_REVIEW'}]};
const hosts=[{brand:'CNP',host:'manufacturer.example.com',approved:true}];
const policy={manufacturerSites:{approved:true,hosts:[{host:'manufacturer.example.com',brand:'CNP',
 approved:true,manufacturerDomainOwnershipReviewed:true,publicSiteTermsReviewed:true,reviewerId:'analyst1',reviewedAt:now}]}};
test('discovered product identity becomes manufacturer passport discovery request',()=>{
 const r=c.planTenderResearchManufacturerPassports(lot,research,hosts,policy,now);
 assert.equal(r.issue,null);assert.equal(r.matchedProducts,1);
 assert.equal(r.requests[0].model,'CDLF32-80');assert.equal(r.certificateGate,false);
 assert.equal(r.technicalDecision,'TECHNICAL_REVIEW');
});
test('unknown manufacturer host never inferred from merchant result',()=>{
 const r=c.planTenderResearchManufacturerPassports(lot,research,[],policy,now);
 assert.equal(r.issue,'NO_APPROVED_MANUFACTURER_HOST_FOR_PRODUCTS');
});
test('manufacturer host requires independent reviewed registry',()=>{
 const r=c.planTenderResearchManufacturerPassports(lot,research,hosts,{},now);
 assert.equal(r.issue,'MANUFACTURER_SITE_SOURCE_NOT_REVIEWED');
});
test('merchant input cannot claim 100% TS match',()=>{
 const changed=structuredClone(research);changed.products[0].technicalDecision='TECHNICAL_MATCH';
 const r=c.planTenderResearchManufacturerPassports(lot,changed,hosts,policy,now);
 assert.equal(r.issue,'NO_APPROVED_MANUFACTURER_HOST_FOR_PRODUCTS');
});
