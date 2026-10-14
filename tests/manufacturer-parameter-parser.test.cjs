const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({Set,Map});
vm.runInContext(fs.readFileSync('ManufacturerParameterParser.gs','utf8'),c);
const good=[['Power 5.5 kW','POWER','5.5','kW'],['Напряжение 380 В','VOLTAGE','380','V'],['Frequency 50 Hz','FREQUENCY','50','Hz'],['Напор 42 м','HEAD','42','m'],['Flow 32 m³/h','FLOW','32','m3/h']];
for(const [line,code,value,unit] of good)test('recognizes isolated parameter: '+line,()=>{
 const r=c.mfrParameterParseLine_(line);
 assert.equal(r.reason,'PARAMETER_SUGGESTED_NOT_VERIFIED');
 assert.equal(r.suggestion.parameterCode,code);assert.equal(r.suggestion.value,value);
 assert.equal(r.suggestion.unit,unit);
});
test('ambiguous/range/multivalue and absent units never inferred',()=>{
 for(const line of ['Voltage 220/380 V','Head 40–60 m','Power ±5 kW','Power 5 kW at 50 Hz','Power 5000','unknown 50 Hz']){
  assert.equal(c.mfrParameterParseLine_(line).suggestion,null,line);
 }
});
test('OCR hash, anchor, source and review status remain UNREVIEWED',()=>{
 const sha='a'.repeat(64),url='https://manufacturer.example.com/passport.pdf',line='Напор 42 м';
 const ocr={mode:'MANUFACTURER_PDF_FACT_CANDIDATES',reason:'OCR_LINES_CAPTURED_FACTS_AND_IDENTITY_NOT_VERIFIED',
  source:{url,sha256:sha},lines:[{id:'manufacturer-p1-0',pageNumber:1,startIndex:0,endIndex:line.length,verbatimText:line,sourceSha256:sha,sourceUrl:url,reviewStatus:'UNREVIEWED'}]};
 const r=c.proposeTenderManufacturerOcrParameters(ocr);
 assert.equal(r.issue,null);assert.equal(r.items[0].proposal.value,'42');
 assert.equal(r.verifiedFacts,0);assert.equal(r.technicalDecision,'TECHNICAL_REVIEW');
 assert.equal(r.tsCompliance,'UNVERIFIED');assert.equal(r.nationalDecision,'HOLD_NATIONAL');
 const wrong=structuredClone(ocr);wrong.lines[0].sourceSha256='b'.repeat(64);
 assert.equal(c.proposeTenderManufacturerOcrParameters(wrong).issue,'OCR_ANCHOR_OR_SOURCE_INVALID');
});
