const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const c=vm.createContext({Date,Map,Set});c.productCardHost_=u=>typeof u==='string'&&/^https:\/\/[a-z.]+\//.test(u)?u.split('/')[2]:null;
for(const f of ['TsProductSearch.gs','TsSearchResponseImport.gs'])vm.runInContext(fs.readFileSync(f,'utf8'),c);
const now='2026-10-15T12:00:00.000Z';
const plan=c.planTenderTsParameterSearch({id:'123',isGoods:true},'pump',[{id:'H',parameterCode:'HEAD',operator:'GE',value:'40',unit:'m'}],['KZ']);
function packets(){return plan.queries.map((p,i)=>({queryIndex:i,provider:'BRAVE_SEARCH',httpStatus:200,contentType:'application/json',observedAt:now,payload:{query:{original:p.query},web:{results:[{url:'https://www.'+p.domain+'/product',title:'Pump'},{url:'https://malicious.example/bait',title:'Bait'}]}}}));}
test('accepts bound search response, retaining only approved domain urls',()=>{
 const r=c.importTenderTsSearchResponses(plan,packets(),now);
 assert.equal(r.issue,null);assert.equal(r.packets.length,2);
 assert.equal(r.packets[0].response.web.results.length,1);
 assert.equal(r.searchResultsVerified,false);assert.equal(r.certificateGate,false);
});
test('rejects altered query and duplicate receipt',()=>{
 const p=packets();p[0].payload.query.original='different';
 assert.equal(c.importTenderTsSearchResponses(plan,p,now).issue,'SEARCH_IMPORT_PROVENANCE_INVALID');
 const q=packets();q[1].queryIndex=0;
 assert.equal(c.importTenderTsSearchResponses(plan,q,now).issue,'SEARCH_IMPORT_PROVENANCE_INVALID');
});
test('rejects stale or unauthorized provider records',()=>{
 const p=packets();p[0].observedAt='2026-10-15T10:00:00.000Z';
 assert.equal(c.importTenderTsSearchResponses(plan,p,now).issue,'SEARCH_IMPORT_PROVENANCE_INVALID');
 const q=packets();q[1].provider='UNKNOWN';
 assert.equal(c.importTenderTsSearchResponses(plan,q,now).issue,'SEARCH_IMPORT_PROVENANCE_INVALID');
});
