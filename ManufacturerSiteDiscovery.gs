/**
 * Issue #30 — FREE, opt-in, bounded public manufacturer-site sitemap discovery.
 * No search subscription: inspect one approved exact manufacturer host's
 * sitemap and optionally two model-related product pages for linked PDFs.
 * Sitemap hints are NOT reviewed official passports and never become TS MATCH.
 * No Forms, Sheets, triggers, installs, background execution or bidding.
 */
const MFR_SITE_DISCOVERY=Object.freeze({
  maxTargets:2,maxRequests:8,maxSitemapsPerTarget:3,maxPagesPerTarget:2,
  maxEntriesPerSitemap:250,maxCandidates:20,maxBodyBytes:262144,
  maxRuntimeMs:30000,maxProofAgeMs:86400000
});
function mfrSiteTime_(s){
  return typeof s==='string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(s) ?
    Date.parse(s):NaN;
}
function mfrSiteHost_(h){
  return typeof h==='string' && h.length<=253 &&
    /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(h) &&
    !/(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(h);
}
/** Exact HTTPS host only, no auth, IP/port, URL escape, query, dot segments.
 * Relative links only from /absolute-path syntax, never // or ./.
 */
function mfrSiteUrl_(url,host,suffix){
  if(!mfrSiteHost_(host) || typeof url!=='string' || url.length>1500 ||
     /[\s\\%?#<>"'\u0000-\u001f]/.test(url))return null;
  const m=/^https:\/\/([a-z0-9.-]+)(\/[^?#]*)?$/i.exec(url);
  if(!m || m[1]!==host || !m[2] || m[2].startsWith('//') ||
     m[2].split('/').some(function(s){return s==='.' || s==='..';}))return null;
  if(suffix==='pdf' && !/\.pdf$/i.test(m[2]))return null;
  if(suffix==='xml' && !/\.xml$/i.test(m[2]))return null;
  if(suffix==='html' && /\.(?:pdf|xml|gz|zip|exe|js|css|json)$/i.test(m[2]))return null;
  return url;
}
function mfrSiteModelTerm_(v) {
  return typeof v==='string' && v.length>=2 && v.length<=80 &&
    /^[A-Za-z0-9][A-Za-z0-9 ._+()\/-]*$/.test(v) &&
    v.trim()===v && !/\s{2}/.test(v) ? v:null;
}
function mfrSiteHint_(url,expected) {
  const compact=function(x){return x.toLowerCase().replace(/[^a-z0-9]/g,'');};
  const path=compact(url.split('/').slice(3).join('/'));
  return ['model','partNumber'].some(function(k){
    const needle=compact(expected[k]);
    return needle.length>=5 && path.includes(needle);
  });
}
function mfrSiteApproval_(target,policy,now) {
  const reg=policy && policy.manufacturerSites;
  if(!reg || reg.approved!==true || !Array.isArray(reg.hosts) ||
      reg.hosts.length>50 || !mfrSiteHost_(target.host))return false;
  const a=reg.hosts.filter(function(x){
    return x && x.host===target.host && x.brand===target.brand &&
      x.approved===true;
  });
  if(a.length!==1)return false;
  const entry=a[0],stamp=mfrSiteTime_(entry.reviewedAt);
  return entry.manufacturerDomainOwnershipReviewed===true &&
    entry.publicSiteTermsReviewed===true &&
    typeof entry.reviewerId==='string' && entry.reviewerId.length>=3 &&
    Number.isFinite(stamp) && stamp<=now &&
    now-stamp<=MFR_SITE_DISCOVERY.maxProofAgeMs;
}
/** Offline discovery preflight. Lot is a validated current technical-first lot,
 * but a reviewed national decision is NOT needed for noncommercial research.
 */
function planTenderManufacturerSiteDiscovery(lot,targets,policy,nowIso) {
  const out={mode:'MANUFACTURER_SITE_DISCOVERY_PLAN',
    issue:null,coverage:'approved_sitemaps_sample_only',requests:[],
    nationalDecision:'HOLD_NATIONAL',technicalDecision:'TECHNICAL_REVIEW',
    commercialDecision:'REVIEW',verifiedDatasheets:0,sheetsChanged:false};
  const now=mfrSiteTime_(nowIso),at=mfrSiteTime_(lot && lot.verifiedAt);
  if(!Number.isFinite(now) || !lot || typeof lot.id!=='string' ||
      !/^[1-9]\d{0,9}$/.test(lot.id) ||
      !lot.isGoods || lot.active!==true || lot.planCoverageVerified!==true ||
      !Number.isFinite(lot.amountKzt) || lot.amountKzt<=0 ||
      lot.amountKzt>10000000 ||
      !Number.isFinite(at) || at>now || now-at>300000 ||
      !(mfrSiteTime_(lot.deadline)>now) ||
      !(mfrSiteTime_(lot.applicationStart)<=now) ||
      !Array.isArray(targets) || targets.length<1 ||
      targets.length>MFR_SITE_DISCOVERY.maxTargets)return {...out,issue:'MANUFACTURER_SITE_LOT_OR_TARGET_INVALID'};
  const used=new Set();
  for(const t of targets){
    if(!t || t.lotId!==lot.id ||
        !['brand','model','partNumber'].every(function(k){return mfrSiteModelTerm_(t[k]);}) ||
        !mfrSiteApproval_(t,policy,now) || used.has(t.host) ||
        (t.sitemapUrl!==undefined &&
         !mfrSiteUrl_(t.sitemapUrl,t.host,'xml'))) {
      out.issue='MANUFACTURER_SITE_SOURCE_NOT_REVIEWED';out.requests=[];return out;
    }
    used.add(t.host);
    out.requests.push({lotId:lot.id,brand:t.brand,model:t.model,
      partNumber:t.partNumber,host:t.host,
      sitemapUrl:t.sitemapUrl || 'https://'+t.host+'/sitemap.xml'});
  }
  return out;
}
/** XML sitemap protocol subset (urlset or sitemapindex) with strict limits.
 * Reject DTD/entity expansion and non-HTTPS/foreign-host locations. Does not
 * mistake a URL listing for proof of manufacturer ownership/part compatibility.
 */
function parseTenderManufacturerSitemap(xml,host) {
  const out={type:null,links:[],totalSeen:0,truncated:false,issue:null};
  if(typeof xml!=='string' || xml.length>MFR_SITE_DISCOVERY.maxBodyBytes ||
      /<!DOCTYPE|<!ENTITY|<!\[CDATA/i.test(xml)){
    out.issue='SITEMAP_XML_UNSAFE';return out;
  }
  const head=xml.replace(/^\s*<\?xml[^>]*\?>\s*/i,'').trim();
  const root=/^<(urlset|sitemapindex)(?=\s|>)/i.exec(head);
  if(!root || !new RegExp('</'+root[1]+'\\s*>\\s*$','i').test(head)) {
    out.issue='SITEMAP_ROOT_INVALID';return out;
  }
  out.type=root[1].toLowerCase();
  const kind=out.type==='urlset'?'url':'sitemap';
  const entries=new RegExp('<'+kind+'\\b[^>]*>([\\s\\S]*?)</'+kind+'\\s*>','gi');
  let hit;
  while((hit=entries.exec(head))!==null){
    out.totalSeen++;
    if(out.totalSeen>MFR_SITE_DISCOVERY.maxEntriesPerSitemap) {
      out.truncated=true;break;
    }
    const matches=Array.from(hit[1].matchAll(/<loc(?:\s[^>]*)?>([^<]{1,1600})<\/loc\s*>/gi));
    if(matches.length!==1)continue;
    // Sitemap spec permits XML entities, but URLs containing query or escaped
    // credentials are intentionally rejected rather than normalized.
    const candidate=matches[0][1].trim();
    const safe=mfrSiteUrl_(candidate,host,out.type==='sitemapindex'?'xml':null);
    if(safe)out.links.push(safe);
  }
  return out;
}
/** Only linked PDFs inside model/part-number-related approved-host product
 * pages. No javascript execution, site-wide crawling or heuristic TS MATCH.
 */
function parseTenderManufacturerPagePdfLinks(html,pageUrl,host) {
  const out=[];
  if(typeof html!=='string' || html.length>MFR_SITE_DISCOVERY.maxBodyBytes ||
      !mfrSiteUrl_(pageUrl,host,'html'))return out;
  const seen=new Set(),tags=html.match(/<a\b[^>]{0,2000}>/gi) || [];
  for(const tag of tags.slice(0,300)){
    const match=/\bhref\s*=\s*(?:"([^"]{1,1500})"|'([^']{1,1500})')/i.exec(tag);
    if(!match)continue;
    const href=match[1] || match[2];
    const full=href.startsWith('/') && !href.startsWith('//') ?
      'https://'+host+href : href;
    const url=mfrSiteUrl_(full,host,'pdf');
    if(url && !seen.has(url)){seen.add(url);out.push(url);}
    if(out.length>=MFR_SITE_DISCOVERY.maxCandidates)break;
  }
  return out;
}
/**
 * Optional zero-paid-API manufacturer site sampling; external GET remains
 * subject to an explicit owner-approved Apps Script deployment/execution.
 * Uses current shared rolling 24h quota. No redirects or download of PDF.
 */
function inspectTenderManufacturerSiteDiscovery(lot,targets,policy) {
  const start=Date.now(),at=new Date(start).toISOString();
  const out={mode:'MANUFACTURER_SITE_DISCOVERY',
    issue:null,coverage:'approved_sitemaps_sample_only',observedAt:at,
    results:[],attempts:0,truncated:false,nationalDecision:'HOLD_NATIONAL',
    technicalDecision:'TECHNICAL_REVIEW',commercialDecision:'REVIEW',
    verifiedDatasheets:0,verifiedTechnicalMatches:0,
    sheetsChanged:false,watermarkAdvanced:false};
  const plan=planTenderManufacturerSiteDiscovery(lot,targets,policy,at);
  if(plan.issue){out.issue=plan.issue;return out;}
  if(!policy || policy.approved!==true ||
      policy.allowManufacturerPublicFetch!==true ||
      policy.allowManufacturerSiteTermsCompliantFetch!==true){
    out.issue='MANUFACTURER_SITE_FETCH_APPROVAL_REQUIRED';return out;
  }
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(1000)){out.issue='MANUFACTURER_SITE_BUSY';return out;}
  try{
    const quota=pilotBudget_();
    const fetch=function(url,host,type){
      if(Date.now()-start>=MFR_SITE_DISCOVERY.maxRuntimeMs ||
         out.attempts>=MFR_SITE_DISCOVERY.maxRequests ||
         !mfrSiteUrl_(url,host,type==='xml'?'xml':'html'))throw Error('FETCH_BUDGET');
      quota.claim();out.attempts++;
      const r=UrlFetchApp.fetch(url,{method:'get',followRedirects:false,
        muteHttpExceptions:true,validateHttpsCertificates:true,
        headers:{Accept:type==='xml'?'application/xml,text/xml':'text/html'}});
      if(Date.now()-start>=MFR_SITE_DISCOVERY.maxRuntimeMs ||
         r.getResponseCode()!==200)throw Error('FETCH_NOT_VERIFIED');
      const headers=r.getAllHeaders(),key=Object.keys(headers).find(function(k){
        return k.toLowerCase()==='content-type';
      });
      const mime=key?String(headers[key]):'';
      if(!(type==='xml' ? /^(?:application\/xml|text\/xml)(?:\s*;|$)/i.test(mime) :
          /^text\/html(?:\s*;|$)/i.test(mime)))throw Error('MIME');
      const bytes=r.getContent();
      if(!bytes || bytes.length<1 || bytes.length>MFR_SITE_DISCOVERY.maxBodyBytes)
        throw Error('SIZE');
      const hash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes)
        .map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
      return {text:r.getContentText('UTF-8'),sha256:hash,observedAt:new Date().toISOString()};
    };
    for(const target of plan.requests){
      const root=fetch(target.sitemapUrl,target.host,'xml');
      const first=parseTenderManufacturerSitemap(root.text,target.host);
      if(first.issue)throw Error('SITEMAP');
      const maps=first.type==='sitemapindex'?first.links.slice(0,2):[];
      if(first.truncated || first.links.length>maps.length && first.type==='sitemapindex')
        out.truncated=true;
      const sourceMaps=first.type==='urlset'?[{parsed:first,source:root,url:target.sitemapUrl}]:[];
      for(const url of maps){
        const s=fetch(url,target.host,'xml');
        const parsed=parseTenderManufacturerSitemap(s.text,target.host);
        if(parsed.issue || parsed.type!=='urlset')throw Error('SITEMAP_CHILD');
        sourceMaps.push({parsed:parsed,source:s,url:url});
      }
      let pages=[],seenPages=new Set(),seenPdfs=new Set();
      const candidates=[];
      const add=function(pdf,source,viaUrl,kind){
        if(seenPdfs.has(pdf) || candidates.length>=MFR_SITE_DISCOVERY.maxCandidates){
          if(!seenPdfs.has(pdf))out.truncated=true;return;
        }
        seenPdfs.add(pdf);
        candidates.push({lotId:target.lotId,brand:target.brand,model:target.model,
          partNumber:target.partNumber,pdfUrl:pdf,
          linkedFromUrl:viaUrl,linkedSourceSha256:source.sha256,
          observedAt:source.observedAt,discoveryKind:kind,
          status:'PENDING_PDF_BYTES_AND_MANUFACTURER_IDENTITY_REVIEW',
          manufacturerVerified:false,technicalCompliance:'UNVERIFIED',
          nationalDecision:'HOLD_NATIONAL'});
      };
      sourceMaps.forEach(function(entry){
        if(entry.parsed.truncated)out.truncated=true;
        entry.parsed.links.forEach(function(url){
          if(mfrSiteUrl_(url,target.host,'pdf') &&
             mfrSiteHint_(url,target))add(url,entry.source,entry.url,'SITEMAP_PDF_URL');
          else if(mfrSiteUrl_(url,target.host,'html') &&
                  mfrSiteHint_(url,target) && !seenPages.has(url)){
            seenPages.add(url);pages.push(url);
          }
        });
      });
      if(pages.length>MFR_SITE_DISCOVERY.maxPagesPerTarget)out.truncated=true;
      pages=pages.slice(0,MFR_SITE_DISCOVERY.maxPagesPerTarget);
      pages.forEach(function(page){
        const content=fetch(page,target.host,'html');
        const pdfs=parseTenderManufacturerPagePdfLinks(content.text,page,target.host);
        pdfs.forEach(function(pdf){add(pdf,content,page,'MATCHED_PRODUCT_PAGE_LINK');});
      });
      out.results.push({lotId:target.lotId,brand:target.brand,model:target.model,
        partNumber:target.partNumber,host:target.host,
        sampledSitemaps:sourceMaps.length,
        sampledProductPages:pages.length,candidates:candidates});
    }
    return out;
  }catch(e){
    // Redact source bytes, request URL and any underlying network exception.
    return {mode:'MANUFACTURER_SITE_DISCOVERY',
      issue:'MANUFACTURER_SITE_SOURCE_OR_QUOTA_BLOCKED',
      coverage:'approved_sitemaps_sample_only',observedAt:new Date().toISOString(),
      attempts:out.attempts,results:[],truncated:true,
      nationalDecision:'HOLD_NATIONAL',technicalDecision:'TECHNICAL_REVIEW',
      commercialDecision:'REVIEW',verifiedDatasheets:0,verifiedTechnicalMatches:0,
      sheetsChanged:false,watermarkAdvanced:false};
  }finally{lock.releaseLock();}
}
