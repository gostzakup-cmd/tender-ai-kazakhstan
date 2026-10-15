const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const c=vm.createContext({Date,Set,Map});
c.PRODUCT_CARD_PROBE={maxBytes:524288};
c.productCardHost_=url=>typeof url==='string'&&url.startsWith('https://www.satu.kz/')?'www.satu.kz':null;
c.productCardPlain_=(x,n)=>typeof x==='string'&&x.length<=n?x.trim():null;
c.productCardTypes_=(x,t)=>x&&x['@type']===t;
c.productCardNodes_=x=>[x];
c.TS_CARD_BRIDGE={maxCards:5};
vm.runInContext(fs.readFileSync('UnknownModelCardDiscovery.gs','utf8'),c);
const url='https://www.satu.kz/product1',now='2026-10-15T10:00:00.000Z';
const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'CNP pump',brand:'CNP',model:'CDLF32-80',mpn:'CDLF32-80-F'})+'</script>';
test('can discover unreviewed model without expected brand or SKU',()=>{
 const r=c.inspectTenderUnknownModelCardHtml(html,url,now);
 assert.equal(r.status,'UNREVIEWED_PRODUCT_IDENTITY');
 assert.equal(r.product.partNumber,'CDLF32-80-F');
 assert.equal(r.tsCompliancePercent,null);assert.equal(r.technicalFactsVerified,0);
});
test('no model or multiple products never accepted',()=>{
 assert.equal(c.inspectTenderUnknownModelCardHtml('<html></html>',url,now).status,'REVIEW');
 assert.equal(c.inspectTenderUnknownModelCardHtml(html+html,url,now).reason,'MULTIPLE_PRODUCTS');
});
test('linked search response retains every TS criterion but not a match',()=>{
 const leads={mode:'TS_SEARCH_PRODUCT_CARD_LEADS',items:[{lotId:'123',market:'KZ',productUrl:url,requiredCriteria:[{id:'H',value:'40',unit:'m'}]}]};
 const r=c.inspectTenderTsSearchCardResponses(leads,[{index:0,url,html}],now);
 assert.equal(r.items[0].product.model,'CDLF32-80');
 assert.equal(r.items[0].requiredCriteria.length,1);
 assert.equal(r.verifiedTechnicalMatches,0);assert.equal(r.certificatesChecked,false);
});
test('unexpected source URLs fail closed',()=>{
 const leads={mode:'TS_SEARCH_PRODUCT_CARD_LEADS',items:[{lotId:'123',market:'KZ',productUrl:url,requiredCriteria:[]}]};
 const r=c.inspectTenderTsSearchCardResponses(leads,[{index:0,url:'https://www.satu.kz/different',html}],now);
 assert.equal(r.issue,'TS_CARD_URL_MISMATCH');
});
