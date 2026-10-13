/**
 * Issue #30 — per-lot official OWS V3 FileLots metadata intake.
 *
 * Confirmed SDL: Lots.Files: [FileLots], FileLots.id/objectId/originalName/
 * nameRu/nameKz/indexDate/systemId. filePath is intentionally NEVER selected:
 * it may be private, signed or ambiguous and is not a verified download URL.
 * A techspec filename is a HINT, not proof of file identity, version or bytes.
 */
const TENDER_TS_MANIFEST = Object.freeze({
  maxLots:30, batchSize:10, maxAttempts:4, maxRuntimeMs:30000,
  maxFilesPerLot:10, maxSnapshotAgeMs:300000
});

function tenderTsManifestTime_(value) {
  return typeof value==='string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) ?
    Date.parse(value) : NaN;
}

function tenderTsManifestText_(v) {
  return typeof v==='string' && v.length<=256 && !/[\x00-\x1f\x7f]/.test(v) ? v : null;
}

function tenderTsManifestFilename_(name,lotId,announcementId) {
  if (!name) return false;
  const m=/^techspec_([1-9]\d{0,9})_([1-9]\d{0,9})\.pdf$/i.exec(name);
  return !!m && m[1]===String(announcementId) && m[2]===String(lotId);
}

/**
 * Pure deterministic, fail-closed metadata review. Returns one status per
 * selected Lots.id. It NEVER authorizes original PDF use or commercial GO.
 */
function prepareTenderTsManifest(shortlist,rows,nowIso) {
  const report={mode:'OFFICIAL_TS_METADATA_READ_ONLY',coverage:'selected_lots_only',
    observedAt:nowIso,shortlistObservedAt:shortlist && shortlist.observedAt,
    issue:null,items:[],nationalDecision:'HOLD_NATIONAL',originalDocumentsVerified:0,
    downloadUrlsVerified:0,fullTsReviewed:0,sheetsChanged:false,watermarkAdvanced:false};
  const now=tenderTsManifestTime_(nowIso);
  const observed=shortlist && tenderTsManifestTime_(shortlist.observedAt);
  if (!shortlist || shortlist.mode!=='SAME_DAY_SELECTED_IDS_READ_ONLY' ||
      shortlist.coverage!=='sample_only' || shortlist.issue ||
      !Array.isArray(shortlist.items) || !shortlist.items.length ||
      shortlist.items.length>TENDER_TS_MANIFEST.maxLots ||
      !Array.isArray(rows) || rows.length>TENDER_TS_MANIFEST.maxLots ||
      !Number.isFinite(now) || !Number.isFinite(observed) || observed>now ||
      now-observed>TENDER_TS_MANIFEST.maxSnapshotAgeMs ||
      new Set(shortlist.items.map(function(i){return i && i.lotId;})).size!==shortlist.items.length) {
    report.issue='TS_MANIFEST_INPUT_INVALID';return report;
  }
  const selected=new Map();
  for(const item of shortlist.items) {
    if(!item || typeof item.lotId!=='string' ||
        !/^[1-9]\d{0,9}$/.test(item.lotId) || Number(item.lotId)>2147483647) {
      report.issue='TS_MANIFEST_LOT_IDS_INVALID';return report;
    }
    selected.set(Number(item.lotId),item);
  }
  const fetched=new Map(),duplicate=new Set();
  for(const row of rows) {
    if(!row || !Number.isInteger(row.id) || !selected.has(row.id)) {
      report.issue='TS_MANIFEST_RESPONSE_SCOPE_INVALID';return report;
    }
    if(fetched.has(row.id)) duplicate.add(row.id);
    else fetched.set(row.id,row);
  }
  shortlist.items.forEach(function(item) {
    const out={lotId:item.lotId,lotNumber:item.lotNumber || null,
      announcementId:Number.isInteger(item.announcementId)?item.announcementId:null,
      announcementNumber:item.announcementNumber || null,
      nationalDecision:'HOLD_NATIONAL',decision:'REVIEW',
      status:'HOLD_DOCUMENT',reason:'LOT_NOT_RETURNED',
      metadataSource:'Lots.Files',documents:[],filenameCandidates:0,
      originalTsUrl:null,originalTsSha256:null,
      currentDocumentVersionVerified:false,documentBytesVerified:false,
      objectIdSemanticsVerified:false,fullTsReviewed:false,
      lotContextChecked:false};
    report.items.push(out);
    if(duplicate.has(Number(item.lotId))){out.reason='DUPLICATE_LOT_RESPONSE';return;}
    const row=fetched.get(Number(item.lotId));
    if(!row) return;
    // An unverified/current-change shortlist cannot be used as a file anchor.
    if(item.decision!=='SAME_DAY_CANDIDATE' ||
        !Number.isFinite(tenderTsManifestTime_(item.deadline)) ||
        tenderTsManifestTime_(item.deadline)<=now ||
        !Number.isFinite(tenderTsManifestTime_(item.applicationStart)) ||
        tenderTsManifestTime_(item.applicationStart)>now) {
      out.reason='LOT_NOT_CURRENT';return;
    }
    if(row.lotNumber!==item.lotNumber || row.trdBuyId!==item.announcementId ||
        row.trdBuyNumberAnno!==item.announcementNumber ||
        row.amount!==item.amountKzt || row.count!==item.quantity ||
        row.refTradeMethodsId!==item.plannedMethodId ||
        row.refBuyTradeMethodsId!==item.actualMethodId ||
        !row.RefLotsStatus || row.RefLotsStatus.code!==item.status ||
        !row.TrdBuy || row.TrdBuy.id!==item.announcementId ||
        row.TrdBuy.endDate!==item.deadlineRaw ||
        row.TrdBuy.repeatEndDate!==item.repeatDeadlineRaw) {
      out.reason='CURRENT_LOT_CONTEXT_CHANGED';return;
    }
    out.lotContextChecked=true;
    if(!Array.isArray(row.Files)) {
      out.reason='FILES_RELATION_UNVERIFIED';return;
    }
    if(row.Files.length>TENDER_TS_MANIFEST.maxFilesPerLot) {
      out.reason='FILES_RELATION_TOO_LARGE';return;
    }
    const used=new Set(),files=[];
    for(const file of row.Files) {
      if(!file || !Number.isInteger(file.id) || file.id<1 ||
          file.id>2147483647 || used.has(file.id) ||
          !(file.objectId===null || (Number.isInteger(file.objectId) && file.objectId>=0 && file.objectId<=2147483647)) ||
          !(file.systemId===null || (Number.isInteger(file.systemId) && file.systemId>=0 && file.systemId<=2147483647)) ||
          !(file.indexDate===null || tenderTsManifestText_(file.indexDate)!==null) ||
          !(file.nameRu===null || tenderTsManifestText_(file.nameRu)!==null) ||
          !(file.nameKz===null || tenderTsManifestText_(file.nameKz)!==null) ||
          !tenderTsManifestText_(file.originalName)) {
        out.reason='FILE_METADATA_MALFORMED';return;
      }
      used.add(file.id);
      // Raw objectId, path, arbitrary labels, credentials and file content are
      // not exposed in the owner view; just enough identity to review.
      const hint=tenderTsManifestFilename_(file.originalName,item.lotId,item.announcementId);
      files.push({fileId:file.id,originalName:file.originalName,
        filenameMatchesLot:hint,metadataOnly:true,
        officialDownloadUrl:null,sha256:null,versionVerified:false});
    }
    out.documents=files;
    out.filenameCandidates=files.filter(function(f){return f.filenameMatchesLot;}).length;
    out.reason=!files.length?'EMPTY_API_FILES_RELATION':
      out.filenameCandidates>1?'MULTIPLE_TS_FILENAME_HINTS':
      out.filenameCandidates===1?'TS_FILENAME_HINT_ONLY':
      'NO_TS_FILENAME_HINT';
    out.status='METADATA_ONLY';
  });
  return report;
}

/**
 * Opt-in official API call, never a document-byte download.
 * Requires independent deployment/execution approval, fixed OWS host,
 * verified V3 configuration, shared quota and script lock.
 */
function inspectTenderOfficialTsMetadata(shortlist,policy) {
  const stamp=new Date().toISOString(),report={
    mode:'OFFICIAL_TS_METADATA_READ_ONLY',coverage:'selected_lots_only',
    issue:'OWNER_OFFICIAL_METADATA_APPROVAL_REQUIRED',observedAt:stamp,
    items:[],originalDocumentsVerified:0,downloadUrlsVerified:0,
    nationalDecision:'HOLD_NATIONAL',sheetsChanged:false,watermarkAdvanced:false};
  if(!policy || policy.approved!==true || policy.allowOfficialMetadataRead!==true) return report;
  // Dry-run guards before acquiring a lock or touching Secrets/API quotas.
  const preflight=prepareTenderTsManifest(shortlist,[],stamp);
  if(preflight.issue){report.issue=preflight.issue;return report;}
  const ids=shortlist.items.map(function(i){return Number(i.lotId);});
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(1000)){report.issue='TS_MANIFEST_ALREADY_RUNNING';return report;}
  let used=0;
  try {
    const config=assertV3Ready_();
    if(config.endpoint!==TENDER.v3Endpoint ||
        JSON.stringify(config.fields)!==JSON.stringify(V3_FIELDS)) {
      throw safeApiError_('TS_MANIFEST_SOURCE_MAPPING_UNVERIFIED');
    }
    const started=Date.now(),shared=pilotBudget_(),rows=[];
    config.requestBudget={claim:function() {
      if(Date.now()-started>=TENDER_TS_MANIFEST.maxRuntimeMs ||
          used>=TENDER_TS_MANIFEST.maxAttempts) throw safeApiError_('TS_MANIFEST_BUDGET');
      shared.claim();used++;
    },used:function(){return used;}};
    const query='query TenderTsManifest($filter: LotsFiltersInput!, $limit: Int!) {'+
      ' Lots(filter: $filter, limit: $limit) {'+
      ' id lotNumber trdBuyId trdBuyNumberAnno amount count'+
      ' refTradeMethodsId refBuyTradeMethodsId RefLotsStatus { code }'+
      ' TrdBuy { id endDate repeatEndDate }'+
      ' Files { id objectId originalName nameRu nameKz indexDate systemId }'+
      ' } }';
    for(let i=0;i<ids.length;i+=TENDER_TS_MANIFEST.batchSize) {
      const group=ids.slice(i,i+TENDER_TS_MANIFEST.batchSize);
      const reply=graphqlResponse_(config,query,{filter:{id:group},limit:group.length});
      if(Date.now()-started>=TENDER_TS_MANIFEST.maxRuntimeMs ||
          !reply.data || !Array.isArray(reply.data.Lots) ||
          reply.data.Lots.length>group.length ||
          reply.data.Lots.some(function(row){return !row || !group.includes(row.id);})) {
        throw safeApiError_('TS_MANIFEST_API_SCOPE_INVALID');
      }
      rows.push.apply(rows,reply.data.Lots);
    }
    const output=prepareTenderTsManifest(shortlist,rows,new Date().toISOString());
    if(output.issue) throw safeApiError_('TS_MANIFEST_STALE_OR_INVALID');
    output.requests=used;
    return nationalSafeReport_(output);
  }catch(e) {
    return {mode:'OFFICIAL_TS_METADATA_READ_ONLY',coverage:'selected_lots_only',
      issue:'TS_MANIFEST_SOURCE_OR_QUOTA_BLOCKED',items:[],requests:used,
      observedAt:new Date().toISOString(),originalDocumentsVerified:0,
      downloadUrlsVerified:0,nationalDecision:'HOLD_NATIONAL',
      sheetsChanged:false,watermarkAdvanced:false};
  }finally {lock.releaseLock();}
}

/**
 * Report-only cross reference to PR #37. Does not modify analyzed source
 * records or elevate metadata to a confirmed original TS/PDF link.
 */
function joinTenderTsManifestPreview(workflow,metadata) {
  if(!workflow || workflow.mode!=='TENDER_WORKFLOW_READ_ONLY' ||
      workflow.issue || !Array.isArray(workflow.rows) || workflow.rows.length>30 ||
      !metadata || metadata.mode!=='OFFICIAL_TS_METADATA_READ_ONLY' ||
      metadata.issue || !Array.isArray(metadata.items) ||
      metadata.items.length!==workflow.rows.length) return null;
  const byId=new Map();
  for(const item of metadata.items) {
    if(!item || typeof item.lotId!=='string' || byId.has(item.lotId)) return null;
    byId.set(item.lotId,item);
  }
  const rows=[];
  for(const row of workflow.rows) {
    const doc=byId.get(row.lotId);
    if(!doc || doc.lotNumber!==row.lotNo ||
        doc.announcementNumber!==row.tenderNo) return null;
    rows.push(Object.assign({},row,{tsMetadataStatus:doc.status,
      tsMetadataReason:doc.reason,
      tsFilenameHints:doc.documents.filter(function(f){return f.filenameMatchesLot;})
        .map(function(f){return f.originalName;}),
      tsLinkFromMetadata:null,tsMetadataIsDocumentProof:false}));
  }
  return Object.assign({},workflow,{rows:rows,tsMetadataAttached:true});
}
