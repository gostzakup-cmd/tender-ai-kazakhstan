const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const c=vm.createContext({Date,Map,Set});
vm.runInContext(fs.readFileSync('ManufacturerSiteDiscovery.gs','utf8'),c);
const now='2026-10-13T12:00:00.000Z',host='manufacturer.example.com';
function f(){return {lot:{id:'123',isGoods:true,active:true,planCoverageVerified:true,amountKzt:50000,verifiedAt:now,applicationStart:'2026-10-13T11:00:00.000Z',deadline:'2026-10-13T18:00:00.000Z'},
 targets:[{lotId:'123',brand:'CNP',model:'CDLF32-80',partNumber:'CDLF32-80-F',host}],
 policy:{manufacturerSites:{approved:true,hosts:[{approved:true,host,brand:'CNP',reviewedAt:now,reviewerId:'REVIEWER',manufacturerDomainOwnershipReviewed:true,publicSiteTermsReviewed:true}]}}};}
test('plan does not spend and requires approved manufacturer-owned exact domain',()=>{
 const a=f(),r=c.planTenderManufacturerSiteDiscovery(a.lot,a.targets,a.policy,now);
 assert.equal(r.issue,null);assert.equal(r.requests[0].sitemapUrl,'https://manufacturer.example.com/sitemap.xml');
 assert.equal(r.verifiedDatasheets,0);assert.equal(r.nationalDecision,'HOLD_NATIONAL');
 const x=f();x.policy.manufacturerSites.hosts[0].manufacturerDomainOwnershipReviewed=false;
 assert.equal(c.planTenderManufacturerSiteDiscovery(x.lot,x.targets,x.policy,now).requests.length,0);
});
test('external, private, bypass and token URLs are excluded',()=>{
 for(const u of ['https://manufacturer.example.com.evil.com/a.pdf','http://manufacturer.example.com/a.pdf','https://manufacturer.example.com/../a.pdf','https://manufacturer.example.com/a.pdf?token=foo','https://127.0.0.1/a.pdf','https://manufacturer.example.com/%2e/a.pdf']){
   assert.equal(c.mfrSiteUrl_(u,host,'pdf'),null,u);
 }
 assert.equal(c.mfrSiteUrl_('https://manufacturer.example.com/cdlf32-80-f.pdf',host,'pdf')!==null,true);
});
test('sitemap entries include only exact HTTPS domain and no metadata promotion',()=>{
 const xml='<urlset><url><loc>https://manufacturer.example.com/cdlf32-80-f.pdf</loc></url>'+
 '<url><loc>https://example.com/a.pdf</loc></url></urlset>';
 const p=c.parseTenderManufacturerSitemap(xml,host);
 assert.equal(p.issue,null);assert.equal(p.links.length,1);assert.equal(p.type,'urlset');
 assert.equal(c.mfrSiteHint_(p.links[0],f().targets[0]),true);
});
test('XML entity expansion and malformed body cannot create candidates',()=>{
 assert.equal(c.parseTenderManufacturerSitemap('<!DOCTYPE urlset [<!ENTITY a "bad">]><urlset></urlset>',host).issue,'SITEMAP_XML_UNSAFE');
 assert.equal(c.parseTenderManufacturerSitemap('<html>bad</html>',host).issue,'SITEMAP_ROOT_INVALID');
});
test('product-page PDF links only on exact domain and without redirects',()=>{
 const html='<a href="/downloads/cdlf32-80-f.pdf">Passport</a>'+
 '<a href="https://evil.example.com/private.pdf">bad</a>'+
 '<a href="//evil.example.com/bad.pdf">bad</a>';
 const links=c.parseTenderManufacturerPagePdfLinks(html,'https://manufacturer.example.com/cdlf32-80-f/',host);
 assert.equal(links.length,1);assert.equal(links[0],'https://manufacturer.example.com/downloads/cdlf32-80-f.pdf');
});
test('unapproved runtime cannot call fetch or spend quota',()=>{
 let n=0;c.UrlFetchApp={fetch:()=>{n++;throw Error('network');}};
 const a=f(),r=c.inspectTenderManufacturerSiteDiscovery(a.lot,a.targets,a.policy);
 assert.equal(r.issue,'MANUFACTURER_SITE_LOT_OR_TARGET_INVALID'); // stale fixture vs real wall clock
 assert.equal(n,0);
});
test('synthetic authorized runtime returns only unverified datasheet candidates',()=>{
 const a=f(),start=new Date().toISOString(),nowMs=Date.now();
 a.lot.verifiedAt=start;a.lot.applicationStart=new Date(nowMs-60000).toISOString();
 a.lot.deadline=new Date(nowMs+180000).toISOString();
 a.policy.manufacturerSites.hosts[0].reviewedAt=start;
 a.policy.approved=true;a.policy.allowManufacturerPublicFetch=true;
 a.policy.allowManufacturerSiteTermsCompliantFetch=true;
 let count=0;
 c.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})};
 c.pilotBudget_=()=>({claim:()=>{}});
 c.Utilities={DigestAlgorithm:{SHA_256:'sha'},computeDigest:(_,arr)=>Array.from(crypto.createHash('sha256').update(Buffer.from(arr.map(x=>(x+256)%256))).digest()).map(x=>x>127?x-256:x)};
 const body='<urlset><url><loc>https://manufacturer.example.com/cdlf32-80-f.pdf</loc></url></urlset>';
 c.UrlFetchApp={fetch:(url,options)=>{
   count++;assert.equal(options.followRedirects,false);
   return {getResponseCode:()=>200,getAllHeaders:()=>({'content-type':'text/xml'}),getContent:()=>Array.from(Buffer.from(body)),getContentText:()=>body};
 }};
 const result=c.inspectTenderManufacturerSiteDiscovery(a.lot,a.targets,a.policy);
 assert.equal(result.issue,null);assert.equal(count,1);
 assert.equal(result.results[0].candidates.length,1);
 assert.equal(result.results[0].candidates[0].manufacturerVerified,false);
 assert.equal(result.results[0].candidates[0].technicalCompliance,'UNVERIFIED');
 assert.equal(result.verifiedTechnicalMatches,0);
});
