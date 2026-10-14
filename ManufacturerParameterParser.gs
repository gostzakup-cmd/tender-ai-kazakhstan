/**
 * Issue #30: deterministic engineering-value suggestions from manufacturer OCR.
 * A parsed number is NOT a reviewed manufacturer fact or a TS match.
 * Conservative one-parameter-per-line, one-unit-per-line, explicit aliases.
 */
const MFR_PARAMETER_PARSER=Object.freeze({maxLines:1000,maxSuggestions:200});
function mfrParameterParseLine_(raw){
 if(typeof raw!=='string'||raw.length>2000)return {reason:'INVALID_LINE',suggestion:null};
 const text=raw.trim();
 const specs=[
  {code:'POWER',unit:'kW',name:/(?:\bpower\b|мощность|қуат)/iu,units:/(?:квт|kw|кw)/giu},
  {code:'VOLTAGE',unit:'V',name:/(?:\bvoltage\b|напряжение|кернеу)/iu,units:/(?:вольт|в|v)/giu},
  {code:'FREQUENCY',unit:'Hz',name:/(?:\bfrequency\b|частота|жиілік)/iu,units:/(?:гц|hz)/giu},
  {code:'HEAD',unit:'m',name:/(?:\bhead\b|напор|арын)/iu,units:/(?:метр(?:ов|а)?|м|m)/giu},
  {code:'FLOW',unit:'m3/h',name:/(?:\bflow\b|производительность|өнімділік|расход)/iu,units:/(?:м³\/ч|м3\/h|m³\/h|m3\/ч)/giu}
 ];
 const matching=specs.filter(s=>s.name.test(text));
 if(matching.length!==1)return {reason:'PARAMETER_AMBIGUOUS_OR_UNKNOWN',suggestion:null};
 const s=matching[0];
 // Anchored whole-line label/value/unit, excluding ranges, ±, equations, lists.
 const matches=Array.from(text.matchAll(/(?:^|[^\w\d])(-?(?:0|[1-9]\d{0,5})(?:[.,]\d{1,3})?)(?![\d.,])/gu));
 if(matches.length!==1||/[±≤≥<>~≈]/u.test(text))
   return {reason:'VALUE_AMBIGUOUS',suggestion:null};
 const found=matches[0],value=found[1].replace(',','.');
 const unitRaw=text.slice(found.index+found[0].length).trim();
 const normalized=s.units;
 const candidates=Array.from(unitRaw.matchAll(normalized)).filter(x=>{
  const prefix=unitRaw.slice(0,x.index),end=x.index+x[0].length;
  return !/[\p{L}\p{N}]/u.test(unitRaw[end]||'') &&
    !/[\p{L}\p{N}]/u.test(unitRaw[x.index-1]||'') &&
    prefix.trim()==='';
 });
 if(candidates.length!==1||unitRaw.slice(candidates[0].index+candidates[0][0].length).trim()!=='')
  return {reason:'UNIT_OR_LAYOUT_UNVERIFIED',suggestion:null};
 if(!/^-?(?:0|[1-9]\d{0,5})(?:\.\d{1,3})?$/.test(value))
  return {reason:'NUMERIC_FORMAT_UNSUPPORTED',suggestion:null};
 return {reason:'PARAMETER_SUGGESTED_NOT_VERIFIED',suggestion:{
  parameterCode:s.code,value:value,unit:s.unit,rawUnit:candidates[0][0]}};
}
function proposeTenderManufacturerOcrParameters(ocr){
 const out={mode:'MANUFACTURER_OCR_PARAMETER_SUGGESTIONS',status:'REVIEW',
  issue:null,items:[],verifiedFacts:0,manufacturerIdentityVerified:false,
  technicalDecision:'TECHNICAL_REVIEW',tsCompliance:'UNVERIFIED',
  nationalDecision:'HOLD_NATIONAL',sheetsChanged:false};
 if(!ocr||ocr.mode!=='MANUFACTURER_PDF_FACT_CANDIDATES'||
   ocr.reason!=='OCR_LINES_CAPTURED_FACTS_AND_IDENTITY_NOT_VERIFIED'||
   !ocr.source||!/^[a-f0-9]{64}$/.test(ocr.source.sha256||'')||
   !Array.isArray(ocr.lines)||ocr.lines.length>MFR_PARAMETER_PARSER.maxLines){
  out.issue='UNREVIEWED_OCR_SOURCE_REQUIRED';return out;
 }
 const ids=new Set(),suggestions=[];
 for(const l of ocr.lines){
  if(!l||typeof l.id!=='string'||ids.has(l.id)||l.reviewStatus!=='UNREVIEWED'||
    !Number.isInteger(l.pageNumber)||l.pageNumber<1||
    !Number.isSafeInteger(l.startIndex)||!Number.isSafeInteger(l.endIndex)||
    l.endIndex!==l.startIndex+l.verbatimText.length||
    l.sourceSha256!==ocr.source.sha256||l.sourceUrl!==ocr.source.url){
   out.issue='OCR_ANCHOR_OR_SOURCE_INVALID';return out;
  }
  ids.add(l.id);
  const p=mfrParameterParseLine_(l.verbatimText);
  out.items.push({id:l.id,pageNumber:l.pageNumber,locator:l.startIndex+'-'+l.endIndex,
    verbatimText:l.verbatimText,sourceSha256:l.sourceSha256,
    sourceUrl:l.sourceUrl,reason:p.reason,proposal:p.suggestion,
    reviewStatus:'UNREVIEWED'});
  if(p.suggestion)suggestions.push(l.id);
 }
 if(suggestions.length>MFR_PARAMETER_PARSER.maxSuggestions){
  out.issue='PARAMETER_SUGGESTION_LIMIT';out.items=[];return out;
 }
 return out;
}
