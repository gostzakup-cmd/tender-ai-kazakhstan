/**
 * Issue #30 — manufacturer PDF OCR response -> source-anchored fact candidates.
 * Offline parser only. It never calls OCR or upgrades evidence to CONFIRMED.
 * PDF capture must be from the exact PR #47 hash; external review is still
 * required to assert manufacturer identity, units, values, version or TS match.
 */
const MFR_PDF_TEXT=Object.freeze({maxPages:30,maxTextChars:200000,maxLines:1000,maxLineLength:2000});
function mfrPdfTextStamp_(s) {
  return typeof s==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(s)?Date.parse(s):NaN;
}
function mfrPdfTextReviewCandidates(capture,candidate,receipt,policy,nowIso){
  const result={mode:'MANUFACTURER_PDF_FACT_CANDIDATES',status:'REVIEW',
    reason:'OCR_RESPONSE_UNVERIFIED',source:null,lines:[],pagesRead:[],
    technicalFactsVerified:0,manufacturerIdentityVerified:false,
    tsCompliance:'UNVERIFIED',technicalDecision:'TECHNICAL_REVIEW',
    nationalDecision:'HOLD_NATIONAL',commercialDecision:'REVIEW',sheetsChanged:false};
  const now=mfrPdfTextStamp_(nowIso),stamp=mfrPdfTextStamp_(capture&&capture.observedAt);
  const approved=policy&&policy.manufacturerOcr;
  if(!Number.isFinite(now)||!Number.isFinite(stamp)||stamp>now||now-stamp>300000 ||
    !capture||capture.mode!=='MANUFACTURER_PDF_INTEGRITY_READ_ONLY'||
    capture.issue||capture.status!=='BYTES_HASHED_UNREVIEWED'||
    !/^[a-f0-9]{64}$/.test(capture.sha256||'')||
    !Number.isInteger(capture.sizeBytes)||capture.sizeBytes<16||
    !candidate||candidate.status!=='PENDING_PDF_BYTES_AND_MANUFACTURER_IDENTITY_REVIEW'||
    !mfrSiteModelTerm_(candidate.model)||!mfrSiteModelTerm_(candidate.partNumber)||
    !approved||approved.approved!==true||approved.ocrResultReviewed!==true||
    approved.pdfSha256!==capture.sha256||
    !Number.isSafeInteger(approved.expectedPageCount)||approved.expectedPageCount<1||
    approved.expectedPageCount>MFR_PDF_TEXT.maxPages||
    !receipt||receipt.requestSourceSha256!==capture.sha256||
    receipt.sourceUrl!==candidate.pdfUrl||!receipt.providerResponse||
    !receipt.providerResponse.document) return result;
  const doc=receipt.providerResponse.document;
  if(typeof doc.text!=='string'||!doc.text.length||
    doc.text.length>MFR_PDF_TEXT.maxTextChars||
    /[\uD800-\uDFFF]/.test(doc.text)||
    !Array.isArray(doc.pages)||
    doc.pages.length!==approved.expectedPageCount){
    result.reason='OCR_TEXT_OR_PAGES_INVALID';return result;
  }
  const pageNumbers=new Set(),intervals=[],lines=[];
  const index=(v,zero)=>v===undefined&&zero?0:
    (typeof v==='string'||typeof v==='number')&&/^(?:0|[1-9]\d*)$/.test(String(v))&&
    Number.isSafeInteger(Number(v))?Number(v):NaN;
  for(const page of doc.pages){
    if(!page||!Number.isInteger(page.pageNumber)||page.pageNumber<1||
      page.pageNumber>approved.expectedPageCount||pageNumbers.has(page.pageNumber)){
      result.reason='OCR_PAGE_IDS_INVALID';return result;
    }
    pageNumbers.add(page.pageNumber);
    const parts=page.layout&&page.layout.textAnchor&&page.layout.textAnchor.textSegments;
    if(!Array.isArray(parts)||!parts.length||parts.length>100){
      result.reason='OCR_PAGE_ANCHORS_MISSING';return result;
    }
    let nonempty=false;
    for(const part of parts){
      const start=index(part&&part.startIndex,true),end=index(part&&part.endIndex,false);
      if(!Number.isInteger(start)||!Number.isInteger(end)||start>=end||end>doc.text.length){
        result.reason='OCR_ANCHOR_INVALID';return result;
      }
      intervals.push({start,end});
      const span=doc.text.slice(start,end);
      let offset=start;
      for(const line of span.split('\n')){
        if(line.trim()){
          if(line.length>MFR_PDF_TEXT.maxLineLength||lines.length===MFR_PDF_TEXT.maxLines){
            result.reason='OCR_LINE_LIMIT';return result;
          }
          nonempty=true;
          lines.push({id:'manufacturer-p'+page.pageNumber+'-'+offset,
            pageNumber:page.pageNumber,startIndex:offset,endIndex:offset+line.length,
            verbatimText:line,reviewStatus:'UNREVIEWED',
            sourceSha256:capture.sha256,sourceUrl:candidate.pdfUrl});
        }
        offset+=line.length+1;
      }
    }
    if(!nonempty){result.reason='OCR_EMPTY_PAGE';return result;}
  }
  intervals.sort((a,b)=>a.start-b.start);
  let covered=0;
  for(const part of intervals){
    if(part.start<covered||doc.text.slice(covered,part.start).trim()){
      result.reason='OCR_PAGE_TEXT_OVERLAP_OR_GAP';return result;
    }
    covered=part.end;
  }
  if(doc.text.slice(covered).trim()){
    result.reason='OCR_TEXT_OUTSIDE_PAGES';return result;
  }
  result.source={url:candidate.pdfUrl,sha256:capture.sha256,
    observedAt:capture.observedAt,brand:candidate.brand,
    model:candidate.model,partNumber:candidate.partNumber,
    documentVersion:'UNVERIFIED'};
  result.lines=lines.sort((a,b)=>a.pageNumber-b.pageNumber||a.startIndex-b.startIndex);
  result.pagesRead=Array.from(pageNumbers).sort((a,b)=>a-b);
  result.reason='OCR_LINES_CAPTURED_FACTS_AND_IDENTITY_NOT_VERIFIED';
  return result;
}
/** Optional review worklist; no inferred fact value or normalized unit. */
function mfrPdfTextFactWorklist(result){
  if(!result||result.mode!=='MANUFACTURER_PDF_FACT_CANDIDATES'||
    result.reason!=='OCR_LINES_CAPTURED_FACTS_AND_IDENTITY_NOT_VERIFIED'||
    !Array.isArray(result.lines)||result.lines.length>MFR_PDF_TEXT.maxLines)return null;
  return result.lines.map(x=>({candidateId:x.id,page:x.pageNumber,
    originalText:x.verbatimText,sourceSha256:x.sourceSha256,
    disposition:'REVIEW',parameterCode:null,value:null,unit:null,
    manufacturerProductVerified:false}));
}
