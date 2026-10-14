const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({Set,Map});vm.runInContext(fs.readFileSync('TsProductSearch.gs','utf8'),c);
c.productCardHost_=url=>typeof url==='string'&&/^https:\/\/[^\s/]+\//.test(url)?url.split('/')[2]:null;
c.productCardAllowed_=x=>!!x.provider&&['KZ','RU','CN'].includes(x.origin);
vm.runInContext(fs.readFileSync('TsSearchCardBridge.gs','utf8'),c);
function plan(){return c.planTenderTsParameterSearch({id:'123',isGoods:true},'pump',[{id:'H',parameterCode:'HEAD',operator:'GE',value:'40',unit:'m'}],['KZ']);}
function receipts(p){return p.queries.map((q,i)=>({queryIndex:i,response:{query:{original:q.query},web:{results:[{url:'https://www.'+q.domain+'/product123',title:'Potential pump'}]}}}));}
test('TS search link becomes unreviewed product card lead, not a 100% match',()=>{
 const p=plan(),r=c.parseTenderTsSearchCardLeads(p,receipts(p),{});
 assert.equal(r.issue,null);assert.equal(r.items.length,2);
 assert.equal(r.items[0].verification,'PENDING_PRODUCT_CARD');
 assert.equal(r.items[0].tsCompliancePercent,null);
 assert.equal(r.technicalMatchesVerified,0);assert.equal(r.certificatesChecked,false);
 const f=c.planTenderTsCardFollowup(r);
 assert.equal(f.requests.length,2);assert.equal(f.requests[0].expected,null);
});
test('different domain and spoofed source query are rejected',()=>{
 const p=plan(),x=receipts(p);x[0].response.web.results[0].url='https://satu.kz.evil.example/product';
 const r=c.parseTenderTsSearchCardLeads(p,x,{});
 assert.equal(r.items.length,1);assert.equal(r.rejected.length,1);
 const y=receipts(p);y[0].response.query.original='other';
 assert.equal(c.parseTenderTsSearchCardLeads(p,y,{}).issue,'SEARCH_RESPONSE_BINDING_INVALID');
});
test('duplicate and missing indexed receipts fail closed',()=>{
 const p=plan(),x=receipts(p);x[1].queryIndex=0;
 assert.equal(c.parseTenderTsSearchCardLeads(p,x,{}).issue,'SEARCH_RESPONSE_BINDING_INVALID');
});
