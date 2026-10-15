const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const c=vm.createContext({Date,Map,Set});
c.PRODUCT_CARD_PROBE={maxBytes:524288};
c.productCardHost_=url=>typeof url==='string'&&/^https:\/\/(?:www\.)?(?:satu\.kz|kaspi\.kz)\//.test(url)?url.split('/')[2]:null;
c.productCardAllowed_=()=>true;
c.productCardPlain_=(s,n)=>typeof s==='string'&&s.length<=n?s.trim():null;
c.productCardTypes_=(p,t)=>p&&p['@type']===t;
c.productCardNodes_=p=>[p];
for(const f of ['TsProductSearch.gs','TsSearchCardBridge.gs','ManufacturerParameterParser.gs','ManufacturerComparison.gs','UnknownModelCardDiscovery.gs','CardTechnicalHints.gs','TsResearchPipeline.gs'])
 vm.runInContext(fs.readFileSync(f,'utf8'),c);
const lot={id:'123',isGoods:true},ts=[{id:'H',parameterCode:'HEAD',operator:'GE',value:'40',unit:'m'}];
const now='2026-10-15T12:00:00.000Z';
const plan=c.planTenderTsParameterSearch(lot,'pump',ts,['KZ']);
const url='https://www.satu.kz/pump1';
const sr=plan.queries.map((q,i)=>({queryIndex:i,response:{query:{original:q.query},web:{results:i===0?[{url,title:'Pump'}]:[]}}}));
const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Pump',brand:'CNP',model:'CDLF32',mpn:'A1',additionalProperty:[{'@type':'PropertyValue',name:'Head',value:'42 m'}]})+'</script>';
test('offline chain returns model and numerical suggestion, never proof',()=>{
 const r=c.previewTenderTsResearchPipeline(lot,'pump',ts,['KZ'],sr,[{index:0,url,html}],now,{});
 assert.equal(r.issue,null);assert.equal(r.products.length,1);
 assert.equal(r.products[0].model,'CDLF32');assert.equal(r.products[0].counts.suggestMatch,1);
 assert.equal(r.products[0].technicalDecision,'TECHNICAL_REVIEW');
 assert.equal(r.products[0].tsCompliancePercent,null);
 assert.equal(r.technicalMatchesVerified,0);assert.equal(r.certificateGate,false);
});
test('wrong card source or absent page fails closed',()=>{
 const bad=c.previewTenderTsResearchPipeline(lot,'pump',ts,['KZ'],sr,[{index:0,url:'https://www.satu.kz/another',html}],now,{});
 assert.equal(bad.issue,'PRODUCT_CARD_RESPONSE_UNTRUSTED');
 const empty=c.previewTenderTsResearchPipeline(lot,'pump',ts,['KZ'],sr,[],now,{});
 assert.equal(empty.issue,'PRODUCT_CARD_RESPONSES_INCOMPLETE');
});
test('search reply query must equal original query',()=>{
 const wrong=JSON.parse(JSON.stringify(sr));wrong[0].response.query.original='wrong';
 const r=c.previewTenderTsResearchPipeline(lot,'pump',ts,['KZ'],wrong,[{index:0,url,html}],now,{});
 assert.equal(r.issue,'SEARCH_RESPONSE_BINDING_INVALID');
});
