/**
 * Issue #30: source-bound technical-specification criterion review.
 *
 * The existing Document AI OCR extractor returns ALL nonblank lines with exact
 * page/character anchors, not an attested interpretation of the original PDF.
 * This module proposes a one-line-per-row review matrix and requires an
 * independently approved, exhaustive line AND original-page review before
 * mapping it to ResearchPipeline.ts.criteria. Never auto-MATCH a product.
 *
 * Offline only: no network, Sheets, billing, OAuth, writes or AI claims.
 */
const TENDER_TS_CRITERIA = Object.freeze({
  maxPages: 15, maxLines: 500, maxCriteria: 200,
  maxLineChars: 2000, maxReasonChars: 300, maxAgeMs: 300000
});

function tenderTsCriterionTime_(value) {
  return typeof value==='string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) ?
    Date.parse(value) : NaN;
}

function tenderTsCriterionHints_(line) {
  // Hints are never semantic claims. No numeric normalization or unit conversion.
  const measurement=/(?:\d[0-9.,]*\s*)(?:квт|вт|гц|мпа|па|бар|мм|см|кг|г|л\/мин|м³\/ч|шт|°c|°с|v|hz|kg|rpm)\b/iu;
  const numeric=/\d/u, constraint=/(?:не\s+менее|не\s+более|не\s+ниже|не\s+выше|от\s+\d|до\s+\d|кемінде|аспау|артық\s+емес|≥|≤|±|диапазон|дәлдігі)/iu;
  const table=/[│|;]|\t/u;
  const flags=[];
  if (measurement.test(line)) flags.push('MEASUREMENT_TOKEN');
  if (numeric.test(line) && !measurement.test(line)) flags.push('NUMBER_WITHOUT_UNIT_CHECK');
  if (constraint.test(line)) flags.push('CONSTRAINT_PHRASE');
  if (table.test(line)) flags.push('TABLE_LAYOUT_REVIEW');
  return flags;
}

/** Verify the current original bytes/national evidence BEFORE trusting OCR rows.
 * Do not prune administrative lines, headings or ambiguous OCR text.
 */
function buildTenderTsCriterionMatrix(input,policy,nowIso,extraction) {
  const out={mode:'TS_CRITERION_REVIEW_MATRIX',status:'REVIEW',reason:null,
    nationalDecision:'HOLD_NATIONAL',source:null,lotId:null,announcementId:null,
    expectedPageCount:null,entries:[],lineCount:0,reviewComplete:false,
    tsCompliance:'UNVERIFIED',commercialDecision:'REVIEW',sheetsChanged:false};
  const original=acceptTenderOriginalDocument(input,policy,nowIso);
  out.nationalDecision=original.nationalDecision;
  if(!original.accepted) {out.reason=original.reason;return out;}
  const source=original.artifact, cfg=policy && policy.extraction;
  if(!cfg || cfg.approved!==true || cfg.provider!=='GOOGLE_DOCUMENT_AI' ||
      !Number.isInteger(cfg.expectedPageCount) || cfg.expectedPageCount<1 ||
      cfg.expectedPageCount>TENDER_TS_CRITERIA.maxPages ||
      cfg.pageCountReviewed!==true ||
      cfg.pageCountSourceSha256!==source.sha256) {
    out.reason='TS_OCR_PAGE_POLICY_UNVERIFIED';return out;
  }
  out.lotId=source.lotId;
  out.announcementId=source.announcementId;
  out.source={url:source.sourceUrl,sha256:source.sha256,version:source.version};
  out.expectedPageCount=cfg.expectedPageCount;
  if(!extraction || extraction.status!=='REVIEW' ||
      extraction.reason!=='OCR_PAGE_TEXT_CAPTURED_SEMANTIC_REVIEW_REQUIRED' ||
      extraction.allTechnicalRequirementsVerified!==false ||
      extraction.tsCompliance!=='UNVERIFIED' ||
      !Array.isArray(extraction.candidates) || !extraction.candidates.length ||
      extraction.candidates.length>TENDER_TS_CRITERIA.maxLines ||
      !Array.isArray(extraction.pagesRead) ||
      extraction.pagesRead.length!==cfg.expectedPageCount ||
      !Array.isArray(extraction.issues) || extraction.issues.length!==0) {
    out.reason='TS_COMPLETE_OCR_CAPTURE_REQUIRED';return out;
  }
  for(let p=1;p<=cfg.expectedPageCount;p++){
    if(extraction.pagesRead[p-1]!==p) {
      out.reason='TS_PAGE_COVERAGE_INVALID';return out;
    }
  }
  const ids=new Set(), seenPages=new Set(), lastByPage=new Map();
  for(const raw of extraction.candidates) {
    if(!raw || raw.kind!=='REQUIREMENT_CANDIDATE' ||
        raw.confirmation!=='UNREVIEWED' ||
        !Number.isInteger(raw.pageNumber) || raw.pageNumber<1 ||
        raw.pageNumber>cfg.expectedPageCount ||
        typeof raw.verbatimText!=='string' || !raw.verbatimText.trim() ||
        raw.verbatimText.length>TENDER_TS_CRITERIA.maxLineChars ||
        /[\uD800-\uDFFF]/u.test(raw.verbatimText) ||
        raw.text!==raw.verbatimText.trim() ||
        !raw.locator ||
        !Number.isSafeInteger(raw.locator.startIndex) ||
        !Number.isSafeInteger(raw.locator.endIndex) ||
        raw.locator.startIndex<0 ||
        raw.locator.endIndex!==raw.locator.startIndex+raw.verbatimText.length ||
        raw.id!=='p'+raw.pageNumber+'-'+raw.locator.startIndex ||
        ids.has(raw.id) ||
        raw.sourceSha256!==source.sha256 ||
        raw.sourceUrl!==source.sourceUrl ||
        raw.sourceVersion!==source.version) {
      out.reason='TS_OCR_ANCHOR_OR_SOURCE_INVALID';out.entries=[];return out;
    }
    const prev=lastByPage.get(raw.pageNumber);
    if(prev!==undefined && raw.locator.startIndex<prev) {
      out.reason='TS_OCR_LINES_OVERLAP';out.entries=[];return out;
    }
    ids.add(raw.id);seenPages.add(raw.pageNumber);
    lastByPage.set(raw.pageNumber,raw.locator.endIndex);
    const flags=tenderTsCriterionHints_(raw.verbatimText);
    out.entries.push({id:raw.id,pageNumber:raw.pageNumber,
      startIndex:raw.locator.startIndex,endIndex:raw.locator.endIndex,
      verbatimText:raw.verbatimText,text:raw.text,reviewStatus:'UNREVIEWED',
      suggestedReviewFlags:flags,assignment:null});
  }
  if(seenPages.size!==cfg.expectedPageCount){
    out.reason='TS_PAGE_WITHOUT_OCR_TEXT';out.entries=[];return out;
  }
  out.lineCount=out.entries.length;
  out.reason='EVERY_OCR_LINE_AND_ORIGINAL_PAGE_REQUIRES_REVIEW';
  return out;
}

function tenderTsCriterionReviewShape_(matrix,review) {
  if(!review || typeof review.reviewId!=='string' ||
      !/^[A-Za-z0-9_-]{3,64}$/.test(review.reviewId) ||
      review.lotId!==matrix.lotId ||
      review.announcementId!==matrix.announcementId ||
      review.sourceSha256!==matrix.source.sha256 ||
      review.sourceUrl!==matrix.source.url ||
      review.sourceVersion!==matrix.source.version ||
      !Array.isArray(review.assignments) ||
      review.assignments.length!==matrix.entries.length) return null;
  const lookup=new Map(),groups=new Map();
  for(const a of review.assignments) {
    if(!a || typeof a.candidateId!=='string' ||
        lookup.has(a.candidateId) ||
        !['REQUIREMENT','EXCLUDE'].includes(a.disposition) ||
        !matrix.entries.some(function(e){return e.id===a.candidateId;})) return null;
    if(a.disposition==='REQUIREMENT') {
      if(typeof a.criterionId!=='string' ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(a.criterionId) ||
          typeof a.critical!=='boolean' ||
          a.reason!==null && a.reason!==undefined) return null;
      if(groups.has(a.criterionId) &&
          groups.get(a.criterionId)!==a.critical) return null;
      groups.set(a.criterionId,a.critical);
    } else {
      if(a.criterionId!==null || a.critical!==null ||
          typeof a.reason!=='string' || a.reason.trim().length<12 ||
          a.reason.length>TENDER_TS_CRITERIA.maxReasonChars) return null;
    }
    lookup.set(a.candidateId,a);
  }
  if(lookup.size!==matrix.entries.length || groups.size===0 ||
      groups.size>TENDER_TS_CRITERIA.maxCriteria) return null;
  // All text lines accounted for and multi-line criteria must form contiguous
  // runs, never silently combine distant pages/sections.
  const closed=new Set();let last=null;
  for(const e of matrix.entries) {
    const a=lookup.get(e.id);
    const id=a.disposition==='REQUIREMENT'?a.criterionId:null;
    if(id!==last && last!==null) closed.add(last);
    if(id!==null && closed.has(id)) return null;
    last=id;
  }
  return lookup;
}

/**
 * One complete explicit reviewer assignment per OCR line, independently
 * cross-checked against an approved trusted review registry.
 *
 * On no approval, returns draft text + review-needed status, never ts:true.
 * The registry represents an OUT-OF-BAND human/source-verification authority,
 * NOT something AI, user JSON or this function is allowed to self-generate.
 */
function finalizeTenderTsCriterionReview(input,policy,nowIso,extraction,review) {
  const output={mode:'TS_CRITERION_REVIEW',status:'REVIEW',reason:null,
    nationalDecision:'HOLD_NATIONAL',ts:null,draftCriteria:[],
    reviewedCriteria:0,sourceLinesReviewed:0,excludedLines:0,
    tsCompliance:'UNVERIFIED',commercialDecision:'REVIEW',sheetsChanged:false};
  const matrix=buildTenderTsCriterionMatrix(input,policy,nowIso,extraction);
  output.nationalDecision=matrix.nationalDecision;
  if(matrix.entries.length===0 || matrix.reason!=='EVERY_OCR_LINE_AND_ORIGINAL_PAGE_REQUIRES_REVIEW') {
    output.reason=matrix.reason;return output;
  }
  const assigned=tenderTsCriterionReviewShape_(matrix,review);
  if(!assigned){output.reason='EXHAUSTIVE_LINE_REVIEW_REQUIRED';return output;}
  const grouped=new Map(),ordered=[];
  for(const e of matrix.entries){
    const a=assigned.get(e.id);
    if(a.disposition==='EXCLUDE') {output.excludedLines++;continue;}
    if(!grouped.has(a.criterionId)) {
      const c={id:a.criterionId,critical:a.critical,parts:[],pages:[]};
      grouped.set(a.criterionId,c);ordered.push(c);
    }
    const criterion=grouped.get(a.criterionId);
    criterion.parts.push(e.verbatimText);
    if(!criterion.pages.includes(e.pageNumber)) criterion.pages.push(e.pageNumber);
  }
  output.draftCriteria=ordered.map(function(c){
    return {id:c.id,requirement:c.parts.join('\n'),
      critical:c.critical,pageNumbers:c.pages.slice(),
      confirmation:'UNREVIEWED',sourceSha256:matrix.source.sha256};
  });
  output.sourceLinesReviewed=matrix.lineCount;
  const registry=policy && policy.tsReview,now=tenderTsCriterionTime_(nowIso);
  const artifact=registry && registry.approved===true &&
    Array.isArray(registry.artifacts) && registry.artifacts.find(function(a){
    return a && a.approved===true && a.reviewId===review.reviewId &&
      a.lotId===review.lotId && a.announcementId===review.announcementId &&
      a.sourceUrl===review.sourceUrl &&
      a.sourceSha256===review.sourceSha256 &&
      a.sourceVersion===review.sourceVersion &&
      typeof a.reviewerId==='string' && a.reviewerId.length>=3 &&
      a.allOriginalPagesReviewed===true &&
      a.allNonblankOcrLinesReviewed===true &&
      a.currentVersionVerified===true &&
      a.documentLayoutReviewed===true &&
      Number.isFinite(tenderTsCriterionTime_(a.observedAt)) &&
      tenderTsCriterionTime_(a.observedAt)<=now &&
      Number.isFinite(registry.maxAgeMs) && registry.maxAgeMs>0 &&
      now-tenderTsCriterionTime_(a.observedAt)<=registry.maxAgeMs &&
      Array.isArray(a.assignments) &&
      JSON.stringify(a.assignments)===JSON.stringify(review.assignments);
  });
  if(!artifact) {output.reason='INDEPENDENT_ORIGINAL_PAGE_REVIEW_NOT_APPROVED';return output;}
  // Reuse the exact original PDF hash/URL from already verified bytes,
  // with an independently approved observation timestamp/line dispositions.
  const proof=function(locator){
    return {status:'CONFIRMED',url:matrix.source.url,
      sha256:matrix.source.sha256,locator:locator,observedAt:artifact.observedAt};
  };
  output.ts={origin:'ORIGINAL_PROCUREMENT_DOCUMENT',
    lotId:matrix.lotId,announcementId:matrix.announcementId,
    version:matrix.source.version,
    fullDocumentReviewed:true,currentVersionVerified:true,
    evidence:proof('full original PDF; '+matrix.expectedPageCount+' pages; review '+review.reviewId),
    criteria:ordered.map(function(c){
      return {id:c.id,requirement:c.parts.join('\n'),critical:c.critical,
        evidence:proof('original PDF page(s) '+c.pages.join(',')+'; review '+review.reviewId+'; criterion '+c.id)};
    })};
  output.reviewedCriteria=ordered.length;
  output.status='REVIEWED_TS_CRITERIA_READY';
  output.reason='INDEPENDENT_COVERAGE_REVIEW_REGISTERED';
  // READY does NOT mean any product matches. Existing ResearchPipeline
  // independently requires exact candidate assessments and suppliers/costs.
  return output;
}
