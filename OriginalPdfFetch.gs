/**
 * Issue #30 — owner-gated, single-use original PDF transport.
 * Only an independently approved, exact official file URL may be fetched.
 * No guessed FileLots.filePath / objectId, no portal session, no redirect,
 * no Apps Script deployment, no OCR, no Sheets/Drive/storage and no bidding.
 *
 * Download policy and source registry are externally reviewed trusted inputs:
 * a user/AI-supplied "approved:true" alone is NOT proof of current provenance.
 */
const TENDER_ORIGINAL_PDF_FETCH = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxRuntimeMs: 30000,
  maxRequests: 1
});

function tenderOriginalPdfTime_(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
  return Date.parse(value);
}

function tenderOriginalPdfUrl_(value) {
  // This shape has previously been observed on the official public portal.
  // Numeric path components are opaque: their meaning must NEVER be inferred.
  return typeof value === 'string' &&
    /^https:\/\/v3bl\.goszakup\.gov\.kz\/files\/download_file\/[1-9]\d{0,9}\/[1-9]\d{0,9}\/$/.test(value);
}

/** Refuses before UrlFetch / quota if national, document source, context or
 * owner network approval is incomplete. The existing document acceptance
 * engine independently repeats gate + SHA checks AFTER bytes are received.
 */
function preflightTenderOriginalPdf_(input, policy, nowIso) {
  const out={allowed:false,decision:'REVIEW',nationalDecision:'HOLD_NATIONAL',
    reason:'DOCUMENT_DOWNLOAD_NOT_APPROVED'};
  const now=tenderOriginalPdfTime_(nowIso);
  if (!input || !input.lot || !policy || !Number.isFinite(now)) {
    out.reason='DOCUMENT_INPUT_INVALID';return out;
  }
  const gate=assessTenderNationalEvidence(input.lot,input.nationalProof,
    policy.national,nowIso);
  out.nationalDecision=gate.decision;
  if (!gate.allowedResearch) {
    out.decision=gate.decision==='SKIP'?'SKIP':'REVIEW';
    out.reason='NATIONAL_GATE_BLOCKED';return out;
  }
  if (input.researchAuthorized!==true) {
    out.reason='RESEARCH_AUTHORIZATION_REQUIRED';return out;
  }
  const doc=input.document, cfg=policy.documents, download=policy.originalPdfDownload;
  if (!cfg || cfg.approved!==true || !Array.isArray(cfg.artifacts) ||
      !Number.isSafeInteger(cfg.maxBytes) || cfg.maxBytes<16 ||
      cfg.maxBytes>TENDER_ORIGINAL_PDF_FETCH.maxBytes ||
      !Number.isFinite(cfg.maxAgeMs) || cfg.maxAgeMs<=0 ||
      !download || download.approved!==true ||
      download.allowPublicPdfFetch!==true ||
      !Number.isSafeInteger(download.maxBytes) || download.maxBytes<16 ||
      download.maxBytes>cfg.maxBytes ||
      !Number.isSafeInteger(download.maxRuntimeMs) ||
      download.maxRuntimeMs<1 ||
      download.maxRuntimeMs>TENDER_ORIGINAL_PDF_FETCH.maxRuntimeMs ||
      !Array.isArray(download.approvedSources) ||
      !doc || doc.kind!=='ORIGINAL_PROCUREMENT_DOCUMENT' ||
      !tenderOriginalPdfUrl_(doc.url) ||
      doc.mimeType!=='application/pdf' ||
      typeof doc.version!=='string' || !doc.version || doc.version.length>160 ||
      !/^[a-f0-9]{64}$/.test(doc.sha256 || '')) {
    out.reason='DOCUMENT_DOWNLOAD_POLICY_UNVERIFIED';return out;
  }
  const observed=tenderOriginalPdfTime_(doc.observedAt);
  if (!Number.isFinite(observed) || observed>now || now-observed>cfg.maxAgeMs ||
      !Number.isFinite(tenderOriginalPdfTime_(input.lot.deadline)) ||
      tenderOriginalPdfTime_(input.lot.deadline)<=now ||
      !Number.isFinite(tenderOriginalPdfTime_(input.lot.verifiedAt))) {
    out.reason='DOCUMENT_SOURCE_STALE_OR_LOT_EXPIRED';return out;
  }
  const identityKeys=['id','lotNumber','announcementId','announcementNumber',
    'revisionHash'];
  const sameIds=function(context) {
    return !!context && identityKeys.every(function(k) {
      return typeof input.lot[k]==='string' && !!input.lot[k] &&
        context[k]===input.lot[k];
    }) && Array.isArray(context.planIds) && Array.isArray(input.lot.planIds) &&
      context.planIds.length===input.lot.planIds.length &&
      new Set(context.planIds).size===context.planIds.length &&
      JSON.stringify(context.planIds.slice().sort())===
        JSON.stringify(input.lot.planIds.slice().sort());
  };
  if (!sameIds(doc.context)) {
    out.reason='DOCUMENT_LOT_CONTEXT_CHANGED';return out;
  }
  const reviewed=cfg.artifacts.find(function(a) {
    return a && a.approved===true && a.kind===doc.kind &&
      a.url===doc.url && a.sha256===doc.sha256 &&
      a.version===doc.version && a.observedAt===doc.observedAt &&
      a.sourceBindingReviewed===true && a.currentVersionReviewed===true &&
      a.fullOriginalReviewed===true && sameIds(a.context);
  });
  const granted=download.approvedSources.find(function(a) {
    return a && a.approved===true && a.url===doc.url &&
      a.sha256===doc.sha256 && a.version===doc.version &&
      a.lotId===input.lot.id &&
      a.announcementId===input.lot.announcementId &&
      a.revisionHash===input.lot.revisionHash;
  });
  if (!reviewed || !granted) {
    out.reason='DOCUMENT_SOURCE_REVIEW_REQUIRED';return out;
  }
  out.allowed=true;out.nationalDecision='PASS_TO_TS';
  out.reason='EXACT_APPROVED_DOCUMENT_CAN_BE_FETCHED';
  return out;
}

/** Processes *only* the supplied HTTP response; no body, token, headers,
 * redirect location, user data or signed link appears in reports.
 */
function inspectTenderOriginalPdfResponse_(input,policy,response,nowIso) {
  const out={status:'HOLD_DOCUMENT',reason:'PDF_RESPONSE_UNVERIFIED',
    accepted:false,nationalDecision:'HOLD_NATIONAL',
    originalTs:null,pdfParseVerified:false,signatureVerified:false,
    extractedTextVerified:false,tsCompliance:'UNVERIFIED',
    commercialDecision:'REVIEW',sheetsChanged:false};
  const ready=preflightTenderOriginalPdf_(input,policy,nowIso);
  out.nationalDecision=ready.nationalDecision;
  if (!ready.allowed) {out.reason=ready.reason;return out;}
  if(!response || typeof response.getResponseCode!=='function' ||
      typeof response.getAllHeaders!=='function' ||
      typeof response.getContent!=='function' ||
      response.getResponseCode()!==200) {
    out.reason='PDF_HTTP_NOT_200';return out;
  }
  let headers,content;
  try {headers=response.getAllHeaders();}catch(e){out.reason='PDF_HEADERS_INVALID';return out;}
  if(!headers || typeof headers!=='object') {
    out.reason='PDF_HEADERS_INVALID';return out;
  }
  const value=function(key){
    const found=Object.keys(headers).find(function(k){return k.toLowerCase()===key;});
    return found?headers[found]:null;
  };
  if(typeof value('content-type')!=='string' ||
      !/^application\/pdf(?:\s*;.*)?$/i.test(value('content-type'))) {
    out.reason='PDF_MIME_INVALID';return out;
  }
  const encoding=value('content-encoding');
  if(encoding!==null && String(encoding).trim().toLowerCase()!=='identity') {
    out.reason='PDF_CONTENT_ENCODING_UNVERIFIED';return out;
  }
  const declared=value('content-length'),max=policy.originalPdfDownload.maxBytes;
  if(declared!==null && (typeof declared!=='string' && typeof declared!=='number' ||
      !/^(?:0|[1-9]\d*)$/.test(String(declared)) ||
      Number(declared)>max || Number(declared)<16)) {
    out.reason='PDF_CONTENT_LENGTH_INVALID';return out;
  }
  try {content=response.getContent();}catch(e){out.reason='PDF_CONTENT_UNREADABLE';return out;}
  if(!Array.isArray(content) || content.length<16 || content.length>max ||
      (declared!==null && Number(declared)!==content.length)) {
    out.reason='PDF_SIZE_OR_LENGTH_MISMATCH';return out;
  }
  // Underlying intake validates signed/unsigned bytes, PDF envelope and SHA.
  const checked=acceptTenderOriginalDocument(Object.assign({},input,{bytes:content}),
    policy,nowIso);
  out.nationalDecision=checked.nationalDecision;
  if(!checked.accepted) {
    out.reason=checked.reason;return out;
  }
  out.status='ORIGINAL_BYTES_VERIFIED';
  out.accepted=true;out.reason='EXACT_REVIEWED_PDF_BYTES_MATCH';
  out.originalTs=checked.artifact;
  return out;
}

/**
 * Manual owner invocation only after a separate Apps Script deployment approval.
 * Single attempt, shared script lock and existing 24-hour request ledger.
 * Returns only provenance metadata; never PDF bytes.
 */
function inspectTenderOriginalPdfOnce(input,policy) {
  const started=Date.now(),at=new Date(started).toISOString();
  const report={mode:'ORIGINAL_PDF_READ_ONLY',issue:null,
    status:'HOLD_DOCUMENT',reason:null,nationalDecision:'HOLD_NATIONAL',
    accepted:false,originalTs:null,requests:0,downloadedBytesReturned:false,
    pdfParseVerified:false,signatureVerified:false,extractedTextVerified:false,
    tsCompliance:'UNVERIFIED',commercialDecision:'REVIEW',
    sheetsChanged:false,watermarkAdvanced:false};
  const ready=preflightTenderOriginalPdf_(input,policy,at);
  report.nationalDecision=ready.nationalDecision;
  if(!ready.allowed) {report.issue=ready.reason;report.reason=ready.reason;return report;}
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(1000)){report.issue='ORIGINAL_PDF_BUSY';return report;}
  try {
    const budget=pilotBudget_();
    if(Date.now()-started>=policy.originalPdfDownload.maxRuntimeMs)
      throw new Error('PDF_RUNTIME_LIMIT');
    budget.claim();
    report.requests=1;
    const response=UrlFetchApp.fetch(input.document.url,{
      method:'get',followRedirects:false,muteHttpExceptions:true,
      validateHttpsCertificates:true,headers:{Accept:'application/pdf'}
    });
    if(Date.now()-started>=policy.originalPdfDownload.maxRuntimeMs)
      throw new Error('PDF_LATE_RESPONSE');
    const checked=inspectTenderOriginalPdfResponse_(input,policy,response,
      new Date().toISOString());
    report.reason=checked.reason;
    report.nationalDecision=checked.nationalDecision;
    report.accepted=checked.accepted;
    report.status=checked.status;
    report.originalTs=checked.originalTs;
    return report;
  }catch(e){
    // Retain no partial bytes and don't disclose raw exception/HTTP body.
    report.issue='ORIGINAL_PDF_NETWORK_OR_QUOTA_BLOCKED';
    report.reason=report.issue;
    report.accepted=false;
    report.originalTs=null;
    return report;
  }finally {lock.releaseLock();}
}
