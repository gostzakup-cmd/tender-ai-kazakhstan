const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({Set,Map});vm.runInContext(fs.readFileSync('TsProductSearch.gs','utf8'),c);
const lot={id:'123',isGoods:true};
const requirements=[{id:'C1',parameterCode:'HEAD',operator:'GE',value:'40',unit:'m'},{id:'C2',parameterCode:'POWER',operator:'LE',value:'5.5',unit:'kW'},{id:'C3',parameterCode:'VOLTAGE',operator:'EQ',value:'380',unit:'V'}];
test('KZ RU CN search from TS parameters without pre-known model',()=>{
 const r=c.planTenderTsParameterSearch(lot,'vertical pump',requirements,['KZ','RU','CN']);
 assert.equal(r.issue,null);assert.equal(r.queries.length,6);
 assert.equal(r.queries[0].market,'KZ');assert.equal(r.queries[2].market,'RU');assert.equal(r.queries[4].market,'CN');
 assert.equal(r.queries[0].requiredCriteria.length,3);assert.equal(r.certificateGate,false);
 assert.equal(r.matchedProductsVerified,0);assert.equal(r.nationalDecision,'HOLD_NATIONAL');
});
test('malformed criteria and duplicate markets fail closed',()=>{
 assert.equal(c.planTenderTsParameterSearch(lot,'pump',[{...requirements[0],value:'not a number'}],['KZ']).issue,'TS_PARAMETER_SEARCH_INPUT_INVALID');
 assert.equal(c.planTenderTsParameterSearch(lot,'pump',requirements,['KZ','KZ']).issue,'TS_PARAMETER_SEARCH_INPUT_INVALID');
});
test('range carries min max and every criterion',()=>{
 const cs=[{id:'X',parameterCode:'FLOW',operator:'BETWEEN',minimum:'30',maximum:'40',unit:'m3/h'}];
 const r=c.planTenderTsParameterSearch(lot,'pump',cs,['CN']);
 assert.equal(r.issue,null);assert.match(r.queries[0].query,/30 40 m3\/h/);
 assert.equal(r.queries[0].requiredCriteria[0].operator,'BETWEEN');
});
test('discovery plan makes no confirmed claims',()=>{
 const r=c.planTenderTsParameterSearch(lot,'pump',requirements,['RU']);
 assert.equal(r.technicalDecision,'TECHNICAL_REVIEW');assert.equal(r.commercialDecision,'REVIEW');
 assert.equal(r.queries[0].verification,'PENDING_PRODUCT_SEARCH');
});
