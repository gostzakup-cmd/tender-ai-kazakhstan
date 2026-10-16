const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({Date,Map,Set});
c.PRODUCT_CARD_PROBE={maxBytes:524288};
c.productCardHost_=u=>typeof u==='string'&&/^https:\/\/(?:www\.)?satu\.kz\//.test(u)?u.split('/')[2]:null;
c.productCardAllowed_=()=>true;
c.productCardPlain_=(v,n)=>typeof v==='string'&&v.length<=n?v.trim():null;
c.productCardTypes_=(v,t)=>v&&v['@type']===t;
c.productCardNodes_=v=>[v];
for(const f of ['TsProductSearch.gs','TsSearchResponseImport.gs','TsSearchCardBridge.gs','ManufacturerParameterParser.gs','ManufacturerComparison.gs','UnknownModelCardDiscovery.gs','CardTechnicalHints.gs','TsResearchPipeline.gs','ImportedTsResearch.gs','TsResearchReadinessAudit.gs','ManufacturerSiteDiscovery.gs','ResearchManufacturerPassportBridge.gs'])
 vm.runInContext(fs.readFileSync(f,'utf8'),c);
const now='2026-10-16T08:00:00.000Z';
const lot={id:'123',isGoods:true,active:true,planCoverageVerified:true,amountKzt:100000,
 verifiedAt:now,applicationStart:'2026-10-16T06:00:00.000Z',deadline:'2026-10-16T14:00:00.000Z'};
const req=[{id:'H',parameterCode:'HEAD',operator:'GE',value:'40',unit:'m'}];
const plan=c.planTenderTsParameterSearch(lot,'насос',req,['KZ']);
const url='https://www.satu.kz/example-pump';
const records=plan.queries.map((p,i)=>({queryIndex:i,provider:'BRAVE_SEARCH',httpStatus:200,
 contentType:'application/json',observedAt:now,payload:{query:{original:p.query},web:{results:i===0?[{url,title:'Насос'}]:[]}}}));
const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Насос',
 brand:'CNP',model:'CDLF32-80',mpn:'P1',additionalProperty:[{'@type':'PropertyValue',name:'Head',value:'42 m'}]})+'</script>';
const hosts=[{brand:'CNP',host:'manufacturer.example.com',approved:true}];
const policy={manufacturerSites:{approved:true,hosts:[{host:'manufacturer.example.com',brand:'CNP',
 approved:true,manufacturerDomainOwnershipReviewed:true,publicSiteTermsReviewed:true,
 reviewerId:'analyst1',reviewedAt:now}]}};
test('offline pilot: imported provider results -> product identity -> TS hint -> manufacturer site request',()=>{
 const research=c.previewTenderImportedTsResearch(lot,'насос',req,['KZ'],records,[{index:0,url,html}],now,policy);
 assert.equal(research.issue,null);assert.equal(research.products.length,1);
 const audit=c.auditTenderTsResearchReadiness(research);
 assert.equal(audit.issue,null);assert.equal(audit.completeIdentities,1);
 const passport=c.planTenderResearchManufacturerPassports(lot,research,hosts,policy,now);
 assert.equal(passport.issue,null);assert.equal(passport.requests.length,1);
 assert.equal(passport.requests[0].model,'CDLF32-80');
 assert.equal(passport.requests[0].status,'PENDING_APPROVED_MANUFACTURER_SITE_INSPECTION');
 assert.equal(passport.technicalDecision,'TECHNICAL_REVIEW');
 assert.equal(passport.certificateGate,false);assert.equal(research.technicalMatchesVerified,0);
});
test('offline pilot refuses unapproved manufacturer domain',()=>{
 const research=c.previewTenderImportedTsResearch(lot,'насос',req,['KZ'],records,[{index:0,url,html}],now,policy);
 const blocked=c.planTenderResearchManufacturerPassports(lot,research,hosts,{},now);
 assert.equal(blocked.issue,'MANUFACTURER_SITE_SOURCE_NOT_REVIEWED');
});
test('offline pilot rejects spoofed provider search query before any identity or PDF work',()=>{
 const wrong=JSON.parse(JSON.stringify(records));wrong[0].payload.query.original='forged';
 const research=c.previewTenderImportedTsResearch(lot,'насос',req,['KZ'],wrong,[{index:0,url,html}],now,policy);
 assert.equal(research.issue,'SEARCH_IMPORT_PROVENANCE_INVALID');assert.equal(research.products.length,0);
});
