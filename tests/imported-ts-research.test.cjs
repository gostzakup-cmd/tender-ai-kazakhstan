const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const c=vm.createContext({Date,Map,Set});
c.PRODUCT_CARD_PROBE={maxBytes:524288};
c.productCardHost_=url=>typeof url==='string'&&/^https:\/\/(?:www\.)?(?:satu\.kz|kaspi\.kz)\//.test(url)?url.split('/')[2]:null;
c.productCardAllowed_=()=>true;
c.productCardPlain_=(s,n)=>typeof s==='string'&&s.length<=n?s.trim():null;
c.productCardTypes_=(p,t)=>p&&p['@type']===t;
c.productCardNodes_=p=>[p];
for(const f of ['TsProductSearch.gs','TsSearchResponseImport.gs','TsSearchCardBridge.gs','ManufacturerParameterParser.gs','ManufacturerComparison.gs','UnknownModelCardDiscovery.gs','CardTechnicalHints.gs','TsResearchPipeline.gs','ImportedTsResearch.gs'])
 vm.runInContext(fs.readFileSync(f,'utf8'),c);
const now='2026-10-15T12:00:00.000Z',lot={id:'123',isGoods:true};
const ts=[{id:'H',parameterCode:'HEAD',operator:'GE',value:'40',unit:'m'}];
const plan=c.planTenderTsParameterSearch(lot,'pump',ts,['KZ']);
const url='https://www.satu.kz/pump1';
const records=plan.queries.map((q,i)=>({queryIndex:i,provider:'BRAVE_SEARCH',httpStatus:200,
 contentType:'application/json',observedAt:now,payload:{query:{original:q.query},
 web:{results:i===0?[{url,title:'Potential pump'}]:[]}}}));
const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',
 name:'Pump',brand:'CNP',model:'CDLF32',mpn:'A1',
 additionalProperty:[{'@type':'PropertyValue',name:'Head',value:'42 m'}]})+'</script>';
test('imported search records feed full TS hint pipeline',()=>{
 const r=c.previewTenderImportedTsResearch(lot,'pump',ts,['KZ'],records,[{index:0,url,html}],now,{});
 assert.equal(r.issue,null);assert.equal(r.products.length,1);
 assert.equal(r.products[0].model,'CDLF32');assert.equal(r.products[0].counts.suggestMatch,1);
 assert.equal(r.products[0].technicalDecision,'TECHNICAL_REVIEW');
 assert.equal(r.technicalMatchesVerified,0);assert.equal(r.certificateGate,false);
});
test('altered upstream query never reaches product analysis',()=>{
 const altered=JSON.parse(JSON.stringify(records));altered[0].payload.query.original='forged';
 const r=c.previewTenderImportedTsResearch(lot,'pump',ts,['KZ'],altered,[{index:0,url,html}],now,{});
 assert.equal(r.issue,'SEARCH_IMPORT_PROVENANCE_INVALID');assert.equal(r.products.length,0);
});
test('missing product page remains blocked',()=>{
 const r=c.previewTenderImportedTsResearch(lot,'pump',ts,['KZ'],records,[],now,{});
 assert.equal(r.issue,'PRODUCT_CARD_RESPONSES_INCOMPLETE');
});
