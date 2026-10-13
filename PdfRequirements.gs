/** Approved real OCR transport only; no built-in fake PDF/AI reader. Transport
 * must not log payload or credentials. This module never confirms compliance. */
function extractTenderPdfRequirementCandidates(input, policy, nowIso, transport) {
  const result={status:'REVIEW',reason:null,candidates:[],pagesRead:[],issues:[],
    allTechnicalRequirementsVerified:false,tsCompliance:'UNVERIFIED',commercialDecision:'REVIEW'};
  const intake=acceptTenderOriginalDocument(input,policy,nowIso);
  if (!intake.accepted) { result.reason=intake.reason; return result; }
  const config=policy && policy.extraction;
  if (!config || config.approved !== true || config.provider !== 'GOOGLE_DOCUMENT_AI' ||
      !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(config.projectId || '') ||
      !['us','eu'].includes(config.location) || !/^[a-zA-Z0-9_-]+$/.test(config.processorId || '') ||
      !Number.isSafeInteger(config.expectedPageCount) || config.expectedPageCount < 1 || config.expectedPageCount > 15 ||
      config.pageCountSourceSha256 !== intake.artifact.sha256 || config.pageCountReviewed !== true ||
      !Number.isSafeInteger(config.maxTextChars) || config.maxTextChars < 1 || config.maxTextChars > 1000000) {
    result.reason='EXTRACTION_POLICY_UNVERIFIED'; return result;
  }
  if (typeof transport !== 'function') { result.reason='REAL_OCR_TRANSPORT_REQUIRED'; return result; }
  const request={sourceSha256:intake.artifact.sha256,url:'https://'+config.location+'-documentai.googleapis.com/v1/projects/'+
    config.projectId+'/locations/'+config.location+'/processors/'+config.processorId+':process',
    body:{rawDocument:{content:Utilities.base64Encode(input.bytes.map(function(b){return b>127?b-256:b;})),mimeType:'application/pdf'}}};
  let response;
  try { response=transport(request); } catch(e) { result.reason='OCR_SERVICE_FAILED'; return result; }
  if (!response || response.requestSourceSha256!==intake.artifact.sha256) { result.reason='OCR_SOURCE_RECEIPT_MISMATCH'; return result; }
  const provider=response.providerResponse;
  if (!provider || provider.error || provider.document && provider.document.error && provider.document.error.code) { result.reason='OCR_PROVIDER_ERROR'; return result; }
  const doc=provider.document;
  if (!doc || typeof doc.text !== 'string' || !doc.text.length || doc.text.length>config.maxTextChars ||
      !Array.isArray(doc.pages) || doc.pages.length!==config.expectedPageCount) {
    result.reason='OCR_DOCUMENT_OR_PAGE_COVERAGE_INVALID'; return result;
  }
  // Index semantics for astral Unicode are not approved here; never guess offsets.
  if (/[\uD800-\uDFFF]/.test(doc.text)) { result.reason='TEXT_INDEX_ENCODING_REQUIRES_REVIEW'; return result; }
  const intervals=[],pages=new Set(),candidates=[];
  const index=function(v,zeroDefault){
    if(v===undefined && zeroDefault)return 0;
    if(!['string','number'].includes(typeof v)|| !/^(?:0|[1-9][0-9]*)$/.test(String(v)))return NaN;
    const n=Number(v);return Number.isSafeInteger(n)?n:NaN;
  };
  for(const page of doc.pages){
    if(!page || !Number.isInteger(page.pageNumber) || page.pageNumber<1 || page.pageNumber>config.expectedPageCount || pages.has(page.pageNumber)){
      result.reason='OCR_PAGE_ID_INVALID';return result;
    }
    pages.add(page.pageNumber);
    const segments=page.layout && page.layout.textAnchor && page.layout.textAnchor.textSegments;
    if(!Array.isArray(segments)||!segments.length||segments.length>100){result.reason='OCR_PAGE_UNREAD';return result;}
    let pageHasText=false;
    for(const segment of segments){
      const start=index(segment && segment.startIndex,true),end=index(segment && segment.endIndex,false);
      if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||end>doc.text.length){result.reason='OCR_ANCHOR_INVALID';return result;}
      intervals.push({start:start,end:end,page:page.pageNumber});
      const span=doc.text.slice(start,end);let offset=start;
      for(const line of span.split('\n')){
        if(line.trim()){
          pageHasText=true;
          candidates.push({id:'p'+page.pageNumber+'-'+offset,text:line.trim(),verbatimText:line,
            pageNumber:page.pageNumber,sourceSha256:intake.artifact.sha256,sourceUrl:intake.artifact.sourceUrl,
            sourceVersion:intake.artifact.version,locator:{startIndex:offset,endIndex:offset+line.length},
            confirmation:'UNREVIEWED',kind:'REQUIREMENT_CANDIDATE'});
        }
        offset+=line.length+1;
      }
    }
    if(!pageHasText){result.reason='OCR_PAGE_UNREAD';return result;}
  }
  intervals.sort(function(a,b){return a.start-b.start;});let covered=0;
  for(const part of intervals){
    if(part.start<covered){result.reason='OCR_OVERLAPPING_PAGE_ANCHORS';return result;}
    if(doc.text.slice(covered,part.start).trim()){result.reason='OCR_TEXT_NOT_ASSIGNED_TO_PAGE';return result;}
    covered=part.end;
  }
  if(doc.text.slice(covered).trim()){result.reason='OCR_TEXT_NOT_ASSIGNED_TO_PAGE';return result;}
  if(candidates.length>5000){result.reason='REQUIREMENT_CANDIDATE_LIMIT';return result;}
  result.candidates=candidates.sort(function(a,b){return a.pageNumber-b.pageNumber||a.locator.startIndex-b.locator.startIndex;});
  result.pagesRead=Array.from(pages).sort(function(a,b){return a-b;});
  result.reason='OCR_PAGE_TEXT_CAPTURED_SEMANTIC_REVIEW_REQUIRED';
  // Every nonblank line is retained (including headings and table text). Humans
  // group multiline requirements and verify numbers/OCR against original pages.
  return result;
}

/** Real, single-use transport. Owner must approve billing/IAM/OAuth first.
 * Never sends Goszakup credentials. Creating it performs no HTTP or token read. */
function createTenderDocumentAiTransport(authorization) {
  let used=false;
  return function (request) {
    if (!authorization || authorization.approved !== true || authorization.billingReviewed !== true || used) throw new Error('OCR_INVOCATION_NOT_AUTHORIZED');
    if (!request || !/^https:\/\/(us|eu)-documentai\.googleapis\.com\/v1\/projects\/[a-z][a-z0-9-]{4,61}[a-z0-9]\/locations\/\1\/processors\/[A-Za-z0-9_-]+:process$/.test(request.url || '') ||
        !/^[a-f0-9]{64}$/.test(request.sourceSha256 || '') || !request.body || !request.body.rawDocument || request.body.rawDocument.mimeType!=='application/pdf') throw new Error('OCR_REQUEST_INVALID');
    used=true;
    const response=UrlFetchApp.fetch(request.url,{method:'post',contentType:'application/json',
      headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},payload:JSON.stringify(request.body),
      muteHttpExceptions:true,followRedirects:false,validateHttpsCertificates:true});
    if(response.getResponseCode()!==200)throw new Error('OCR_HTTP_FAILED');
    const body=response.getContentText();
    if(body.length>3000000)throw new Error('OCR_RESPONSE_TOO_LARGE');
    let json;try{json=JSON.parse(body);}catch(e){throw new Error('OCR_RESPONSE_INVALID');}
    // Internal receipt, not a fabricated field in Google's REST response.
    return {requestSourceSha256:request.sourceSha256,providerResponse:json};
  };
}
