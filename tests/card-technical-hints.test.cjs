const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const c=vm.createContext({Date,Map,Set});
c.PRODUCT_CARD_PROBE={maxBytes:524288};
c.productCardHost_=x=>/^https:\/\/www\.satu\.kz\/[a-z]/.test(x)?'www.satu.kz':null;
c.productCardPlain_=(s,n)=>typeof s==='string'&&s.length<=n?s.trim():null;
c.productCardTypes_=(p,t)=>p&&p['@type']===t;
c.productCardNodes_=p=>[p];
for(const file of ['TsProductSearch.gs','ManufacturerParameterParser.gs','ManufacturerComparison.gs','UnknownModelCardDiscovery.gs','CardTechnicalHints.gs'])
 vm.runInContext(fs.readFileSync(file,'utf8'),c);
const url='https://www.satu.kz/pump';
function html(properties){return '<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Pump',brand:'CNP',model:'CDLF32',mpn:'P1',additionalProperty:properties})+'</script>';}
const req=[{id:'H',parameterCode:'HEAD',operator:'GE',value:'40',unit:'m'}];
test('suggests technical match only, never 100% confirmed',()=>{
 const r=c.proposeTenderCardTechnicalHints(html([{'@type':'PropertyValue',name:'Напор',value:'42 м'}]),url,req,'2026-10-15T12:00:00.000Z');
 assert.equal(r.issue,null);assert.equal(r.criterionHints[0].status,'SUGGEST_MATCH');
 assert.equal(r.tsCompliancePercent,null);assert.equal(r.technicalDecision,'TECHNICAL_REVIEW');
});
test('failed value is only suggested fail',()=>{
 const r=c.proposeTenderCardTechnicalHints(html([{'@type':'PropertyValue',name:'Head',value:'39 m'}]),url,req,'2026-10-15T12:00:00.000Z');
 assert.equal(r.criterionHints[0].status,'SUGGEST_FAIL');
});
test('conflicting property claims and missing dimensions stay unknown',()=>{
 let r=c.proposeTenderCardTechnicalHints(html([{'@type':'PropertyValue',name:'Head',value:'41 m'},{'@type':'PropertyValue',name:'Head',value:'39 m'}]),url,req,'2026-10-15T12:00:00.000Z');
 assert.equal(r.criterionHints[0].status,'UNKNOWN');
 r=c.proposeTenderCardTechnicalHints(html([]),url,req,'2026-10-15T12:00:00.000Z');
 assert.equal(r.criterionHints[0].status,'UNKNOWN');
});
