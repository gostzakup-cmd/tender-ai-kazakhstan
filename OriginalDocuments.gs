/** Byte intake only. Trusted registry is populated by separately approved source
 * review, never filenames, FileLots.objectId, AI output or owner K-column values.
 * No network, Google storage, secrets or logging. PDF parsing/signature separate. */
function acceptTenderOriginalDocument(input, policy, nowIso) {
  const result = {status:'HOLD_DOCUMENT', nationalDecision:'HOLD_NATIONAL', accepted:false,
    reason:null, artifact:null, pdfParseVerified:false, signatureVerified:false,
    extractedTextVerified:false, tsCompliance:'UNVERIFIED', commercialDecision:'REVIEW'};
  const hold = function (reason) { result.reason=reason; return result; };
  if (!input || typeof input !== 'object') return hold('INPUT_REQUIRED');
  const gate=assessTenderNationalEvidence(input.lot,input.nationalProof,policy && policy.national,nowIso);
  result.nationalDecision=gate.decision;
  if (!gate.allowedResearch) return hold('NATIONAL_GATE_BLOCKED');
  if (input.researchAuthorized !== true) return hold('OWNER_AUTHORIZATION_REQUIRED');
  const config=policy && policy.documents, doc=input.document;
  if (!config || config.approved !== true || !Array.isArray(config.artifacts) ||
      !Number.isSafeInteger(config.maxBytes) || config.maxBytes < 16 || config.maxBytes > 10*1024*1024 ||
      !Number.isFinite(config.maxAgeMs) || config.maxAgeMs <= 0) return hold('DOCUMENT_POLICY_UNVERIFIED');
  if (!doc || typeof doc !== 'object' || doc.kind !== 'ORIGINAL_PROCUREMENT_DOCUMENT' ||
      !/^https:\/\/(?:old|v3bl)\.goszakup\.gov\.kz\/[^?#\s]+$/.test(doc.url || '') ||
      typeof doc.version !== 'string' || !doc.version || doc.version.length > 160 ||
      !/^[a-f0-9]{64}$/.test(doc.sha256 || '') || doc.mimeType !== 'application/pdf') return hold('DOCUMENT_METADATA_INVALID');
  const artifact=config.artifacts.find(function (a) {
    return a && a.approved === true && a.kind === doc.kind && a.url === doc.url &&
      a.version === doc.version && a.sha256 === doc.sha256 && a.observedAt === doc.observedAt &&
      a.sourceBindingReviewed === true && a.currentVersionReviewed === true && a.fullOriginalReviewed === true;
  });
  if (!artifact) return hold('DOCUMENT_SOURCE_NOT_APPROVED');
  const time=function (v) { return typeof v==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)?Date.parse(v):NaN; };
  const now=time(nowIso), observed=time(doc.observedAt);
  if (!Number.isFinite(observed) || observed > now || now-observed > config.maxAgeMs) return hold('DOCUMENT_OBSERVATION_STALE');
  const keys=['id','lotNumber','announcementId','announcementNumber','revisionHash'];
  if (!doc.context || !artifact.context || keys.some(function (key) {
    return doc.context[key] !== input.lot[key] || artifact.context[key] !== input.lot[key];
  })) return hold('DOCUMENT_LOT_BINDING_MISMATCH');
  const plans=input.lot.planIds, validIds=function (ids) { return Array.isArray(ids) && Array.from(ids).every(function (id) { return typeof id==='string' && /^[1-9][0-9]*$/.test(id) && Number(id)<=2147483647; }); };
  if (!validIds(doc.context.planIds) || !validIds(artifact.context.planIds) ||
      JSON.stringify(doc.context.planIds.slice().sort()) !== JSON.stringify(plans.slice().sort()) ||
      JSON.stringify(artifact.context.planIds.slice().sort()) !== JSON.stringify(plans.slice().sort())) return hold('DOCUMENT_PLAN_COVERAGE_MISMATCH');
  const bytes=input.bytes;
  if (!Array.isArray(bytes) || bytes.length < 16 || bytes.length > config.maxBytes ||
      Array.from(bytes).some(function (b) { return !Number.isInteger(b) || b < -128 || b > 255; })) return hold('DOCUMENT_BYTES_INVALID_OR_TOO_LARGE');
  const normalized=bytes.map(function (b) { return b<0?b+256:b; });
  const head=normalized.slice(0,8).map(function (b) { return String.fromCharCode(b); }).join('');
  const tail=normalized.slice(-1024).map(function (b) { return String.fromCharCode(b); }).join('');
  if (!/^%PDF-(?:1\.[0-7]|2\.0)/.test(head) || !/%%EOF\s*$/.test(tail)) return hold('PDF_ENVELOPE_INVALID');
  let sha;
  try { sha=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    normalized.map(function (b) { return b>127?b-256:b; }))
    .map(function (b) { return ('0'+((b+256)%256).toString(16)).slice(-2); }).join(''); } catch (e) { return hold('DOCUMENT_HASH_FAILED'); }
  if (sha !== artifact.sha256) return hold('DOCUMENT_HASH_MISMATCH');
  result.status='ORIGINAL_BYTES_VERIFIED'; result.accepted=true; result.reason='REVIEWED_SOURCE_AND_EXACT_BYTES';
  result.artifact={lotId:input.lot.id,lotNumber:input.lot.lotNumber,announcementId:input.lot.announcementId,
    announcementNumber:input.lot.announcementNumber,revisionHash:input.lot.revisionHash,
    planIds:plans.slice(),sourceUrl:artifact.url,version:artifact.version,sha256:sha,byteLength:bytes.length,
    mimeType:'application/pdf',observedAt:artifact.observedAt};
  // Caller already retains original bytes. Do not echo/store them or pretend
  // header/EOF checks parsed a valid complete TS, verified CMS or found lot IDs.
  return result;
}
