/**
 * Issue #30 / PR #47: verified transport boundary for discovered manufacturer PDF.
 * A sitemap discovery is merely a URL candidate, not an authenticated datasheet.
 * No parsing, TS match, original version attestation, Sheets or bid.
 */
const MFR_PDF_INTEGRITY=Object.freeze({maxBytes:8*1024*1024,maxAttempts:1,maxRuntimeMs:30000,maxAgeMs:300000});
function mfrPdfStamp_(x){return typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(x)?Date.parse(x):NaN;}
function mfrPdfPreflight_(discovery,lot,candidate,policy,nowIso){
 const out={allowed:false,reason:'MFR_PDF_SOURCE_UNVERIFIED'};
 const now=mfrPdfStamp_(nowIso),at=mfrPdfStamp_(discovery&&discovery.observedAt);
 if(!Number.isFinite(now)||!Number.isFinite(at)||at>now||now-at>MFR_PDF_INTEGRITY.maxAgeMs||
    !discovery||discovery.issue||discovery.mode!=='MANUFACTURER_SITE_DISCOVERY'||
    discovery.coverage!=='approved_sitemaps_sample_only'||
    !lot||lot.active!==true||lot.isGoods!==true||lot.planCoverageVerified!==true||
    mfrPdfStamp_(lot.deadline)<=now||mfrPdfStamp_(lot.applicationStart)>now||
    !candidate||candidate.lotId!==lot.id||
    !['brand','model','partNumber'].every(function(k){return mfrSiteModelTerm_(candidate[k]);})||
    candidate.status!=='PENDING_PDF_BYTES_AND_MANUFACTURER_IDENTITY_REVIEW'||
    candidate.manufacturerVerified!==false||
    !policy||policy.approved!==true||policy.allowPublicManufacturerPdfFetch!==true||
    !Number.isInteger(policy.maxBytes)||policy.maxBytes<16||policy.maxBytes>MFR_PDF_INTEGRITY.maxBytes){
   return out;
 }
 const found=[];
 for(const result of discovery.results||[]){
  if(result.lotId!==lot.id||!Array.isArray(result.candidates))continue;
  for(const c of result.candidates){
   if(c.pdfUrl===candidate.pdfUrl&&c.lotId===candidate.lotId &&
      ['brand','model','partNumber','linkedFromUrl','linkedSourceSha256','observedAt',
      'discoveryKind','status'].every(function(k){return c[k]===candidate[k];}) &&
      c.manufacturerVerified===false){
     found.push({host:result.host,record:c});
   }
  }
 }
 if(found.length!==1)return out;
 const host=found[0].host;
 if(!mfrSiteUrl_(candidate.pdfUrl,host,'pdf')||
    !mfrSiteUrl_(candidate.linkedFromUrl,host,
      candidate.discoveryKind==='SITEMAP_PDF_URL'?'xml':'html')||
    !/^[a-f0-9]{64}$/.test(candidate.linkedSourceSha256||'')||
    !Number.isFinite(mfrPdfStamp_(candidate.observedAt)) ||
    candidate.observedAt!==discovery.observedAt &&
      mfrPdfStamp_(candidate.observedAt)>now ||
    !mfrSiteApproval_({host:host,brand:candidate.brand},policy,now)){
    return out;
 }
 const matches=(policy.approvedPdfSources||[]).filter(function(x){
  return x&&x.approved===true&&x.lotId===lot.id&&x.url===candidate.pdfUrl&&
    x.host===host&&x.brand===candidate.brand&&x.model===candidate.model&&
    x.partNumber===candidate.partNumber&&x.linkedSourceSha256===candidate.linkedSourceSha256&&
    x.ownerReviewed===true&&x.termsReviewed===true;
 });
 if(matches.length!==1)return out;
 out.allowed=true;out.reason='APPROVED_EXACT_MANUFACTURER_PDF_URL';
 return out;
}
function mfrPdfInspectResponse_(response,candidate,maxBytes,nowIso){
 const out={status:'REVIEW',reason:'MFR_PDF_HTTP_UNVERIFIED',
  bytesVerified:false,sha256:null,sizeBytes:null,pdfBytesReturned:false,
  technicalCompliance:'UNVERIFIED',manufacturerIdentityVerified:false,
  currentRevisionVerified:false,observedAt:nowIso};
 if(!response||response.getResponseCode()!==200)return out;
 const headers=response.getAllHeaders();
 if(!headers||typeof headers!=='object')return out;
 const contentType=Object.keys(headers).find(function(k){return k.toLowerCase()==='content-type';});
 const mime=contentType?String(headers[contentType]):'';
 if(!/^application\/pdf(?:\s*;|$)/i.test(mime)){out.reason='MFR_PDF_CONTENT_TYPE_INVALID';return out;}
 const encoding=Object.keys(headers).find(function(k){return k.toLowerCase()==='content-encoding';});
 if(encoding&&String(headers[encoding]).toLowerCase()!=='identity'){
  out.reason='MFR_PDF_ENCODING_UNVERIFIED';return out;
 }
 const length=Object.keys(headers).find(function(k){return k.toLowerCase()==='content-length';});
 const declared=length?String(headers[length]):null;
 if(declared!==null&&(!/^(?:0|[1-9]\d*)$/.test(declared)||
    Number(declared)>maxBytes)){out.reason='MFR_PDF_LENGTH_INVALID';return out;}
 const bytes=response.getContent();
 if(!Array.isArray(bytes)||bytes.length<16||bytes.length>maxBytes||
   (declared!==null&&Number(declared)!==bytes.length)||
   bytes.some(function(x){return !Number.isInteger(x)||x< -128||x>255;})){
  out.reason='MFR_PDF_SIZE_INVALID';return out;
 }
 const byte=function(i){return (bytes[i]+256)%256;};
 if([37,80,68,70,45].some(function(v,i){return byte(i)!==v;})){
  out.reason='MFR_PDF_MAGIC_INVALID';return out;
 }
 let eof=false;
 for(let i=Math.max(0,bytes.length-2048);i+4<bytes.length;i++){
  if([37,37,69,79,70].every(function(v,j){return byte(i+j)===v;})){eof=true;break;}
 }
 if(!eof){out.reason='MFR_PDF_EOF_MISSING';return out;}
 const hash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes)
  .map(function(v){return ('0'+((v+256)%256).toString(16)).slice(-2);}).join('');
 out.status='BYTES_HASHED_UNREVIEWED';out.reason='ORIGINAL_MANUFACTURER_IDENTITY_AND_CONTENT_REVIEW_REQUIRED';
 out.bytesVerified=true;out.sha256=hash;out.sizeBytes=bytes.length;
 return out;
}
/** Explicitly approved owner-only, one attempt. Returns no bytes and no PDF
 * content. Keeps existing shared request ledger and never follows redirects.
 */
function inspectTenderManufacturerPdfOnce(discovery,lot,candidate,policy){
 const now=new Date().toISOString();
 const out={mode:'MANUFACTURER_PDF_INTEGRITY_READ_ONLY',issue:null,attempts:0,
  status:'REVIEW',reason:null,manufacturerIdentityVerified:false,
  technicalCompliance:'UNVERIFIED',nationalDecision:'HOLD_NATIONAL',
  pdfBytesReturned:false,sheetsChanged:false};
 const check=mfrPdfPreflight_(discovery,lot,candidate,policy,now);
 if(!check.allowed){out.issue=check.reason;return out;}
 const lock=LockService.getScriptLock();
 if(!lock.tryLock(1000)){out.issue='MANUFACTURER_PDF_BUSY';return out;}
 const start=Date.now();
 try{
  const budget=pilotBudget_();budget.claim();out.attempts++;
  const r=UrlFetchApp.fetch(candidate.pdfUrl,{method:'get',followRedirects:false,
    muteHttpExceptions:true,validateHttpsCertificates:true,headers:{Accept:'application/pdf'}});
  if(Date.now()-start>=MFR_PDF_INTEGRITY.maxRuntimeMs)throw Error('LATE');
  const check=mfrPdfInspectResponse_(r,candidate,policy.maxBytes,new Date().toISOString());
  out.status=check.status;out.reason=check.reason;
  out.sha256=check.sha256;out.sizeBytes=check.sizeBytes;
  out.observedAt=check.observedAt;
  return out;
 }catch(e){
  out.issue='MANUFACTURER_PDF_TRANSPORT_BLOCKED';out.status='REVIEW';
  return out;
 }finally{lock.releaseLock();}
}
