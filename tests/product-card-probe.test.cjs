const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
function setup(){
 const c=vm.createContext({Date,Map,Set});
 vm.runInContext(fs.readFileSync('SupplierIntake.gs','utf8'),c);
 vm.runInContext(fs.readFileSync('ProductCardProbe.gs','utf8'),c);
 return c;
}
const url='https://www.satu.kz/p123456-item.html', now='2026-10-13T12:00:00.000Z';
const expected={brand:'Brand',model:'Model',partNumber:'PN-1'};
function html(price='1200'){
 return '<html><script type="application/ld+json">'+JSON.stringify({
  '@context':'https://schema.org','@type':'Product',name:'Widget',brand:{name:'Brand'},model:'Model',mpn:'PN-1',sku:'PN-1',
  offers:{'@type':'Offer',price,priceCurrency:'KZT',availability:'https://schema.org/InStock',url}
 })+'</script></html>';
}
test('parses one exact JSON-LD product and preserves UNREVIEWED pricing',()=>{
 const r=setup().parseTenderProductCard_(html(),url,expected,now);
 assert.equal(r.status,'UNREVIEWED_PRODUCT_CARD');assert.equal(r.identityMatch,'EXACT_FIELDS');
 assert.equal(r.listedOffer.unitPrice,1200);assert.equal(r.listedOffer.availability,'InStock');
 assert.equal(r.priceVerified,false);assert.equal(r.stockVerified,false);assert.equal(r.tsCompliance,'UNVERIFIED');
 assert.equal(r.availableQuantity,null);assert.equal(r.leadTimeDays,null);
});
test('missing/mismatching identity or multiple offers cannot claim exact product',()=>{
 const c=setup();
 assert.equal(c.parseTenderProductCard_(html(),url,{...expected,partNumber:'OTHER'},now).identityMatch,'MISMATCH');
 assert.equal(c.parseTenderProductCard_(html(),url,null,now).reason,'EXPECTED_EXACT_IDENTITY_REQUIRED');
 assert.equal(c.parseTenderProductCard_(html().replace('PN-1','OTHER'),url,expected,now).identityMatch,'MISMATCH');
 assert.equal(c.parseTenderProductCard_(html()+html(),url,expected,now).reason,'PRODUCT_AMBIGUOUS');
});
test('no price inference from HTML, stale price invalid, malformed JSON stays REVIEW',()=>{
 const c=setup();
 assert.equal(c.parseTenderProductCard_('<b>₸1200</b>',url,expected,now).listedOffer,null);
 assert.equal(c.parseTenderProductCard_('<script type="application/ld+json">{broken}</script>',url,expected,now).reason,'SCHEMA_PRODUCT_NOT_FOUND');
 assert.equal(c.parseTenderProductCard_(html('0'),url,expected,now).reason,'PRICE_CURRENCY_UNVERIFIED');
 const outdated=html().replace('"url":"'+url+'"','"priceValidUntil":"2020-01-01","url":"'+url+'"');
 assert.equal(c.parseTenderProductCard_(outdated,url,expected,now).reason,'PRICE_EXPIRED');
});
test('fixed provider host allowlist and manual exact manufacturer hosts',()=>{
 const c=setup(),card={lotId:'123',origin:'KZ',provider:'SATU',url};
 assert.equal(c.productCardAllowed_(card,{}),true);
 assert.equal(c.productCardAllowed_({...card,url:'https://satu.kz.evil.com/p'},{}),false);
 assert.equal(c.productCardAllowed_({...card,url:'https://127.0.0.1/p'},{}),false);
 assert.equal(c.productCardAllowed_({...card,provider:'DISTRIBUTOR'},{}),false);
 assert.equal(c.productCardAllowed_({...card,provider:'DISTRIBUTOR'},
   {approved:true,approvedHosts:[{approved:true,host:'www.satu.kz',provider:'DISTRIBUTOR',origin:'KZ'}]}),true);
});
test('runtime guard rejects noncandidate lots before any network calls',()=>{
 const c=setup();let calls=0;
 c.UrlFetchApp={fetch:()=>{calls++;throw Error('unexpected');}};
 const r=c.inspectTenderProductCards({observedAt:now,items:[{lotId:'123',decision:'EXPIRED'}]},
 [{lotId:'123',origin:'KZ',provider:'SATU',url,expected}],
 {approved:true,allowPublicProductFetch:true});
 assert.equal(r.issue,'PRODUCT_CARD_SOURCE_NOT_APPROVED');assert.equal(calls,0);
});
test('authorized synthetic HTTP response hashes actual bytes, never verifies offer',()=>{
 const c=setup();let calls=0,locks=0,claims=0;const body=html();
 c.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>locks++})};
 c.pilotBudget_=()=>({claim:()=>claims++});c.safeApiError_=s=>Error(s);
 c.nationalSafeReport_=x=>x;c.Utilities={DigestAlgorithm:{SHA_256:'sha'},computeDigest:(_,bytes)=>Array.from(crypto.createHash('sha256').update(Buffer.from(bytes.map(v=>(v+256)%256))).digest()).map(x=>x>127?x-256:x)};
 c.UrlFetchApp={fetch:(u,opt)=>{calls++;assert.equal(u,url);assert.equal(opt.followRedirects,false);
   return {getResponseCode:()=>200,getAllHeaders:()=>({'Content-Type':'text/html;charset=utf-8'}),
   getContent:()=>Array.from(Buffer.from(body)),getContentText:()=>body};}};
 const s={observedAt:new Date().toISOString(),items:[{lotId:'123',decision:'SAME_DAY_CANDIDATE',deadline:'2099-01-01T00:00:00Z'}]};
 const r=c.inspectTenderProductCards(s,[{lotId:'123',origin:'KZ',provider:'SATU',url,expected}],
 {approved:true,allowPublicProductFetch:true});
 assert.equal(r.issue,null);assert.equal(r.items[0].status,'UNREVIEWED_PRODUCT_CARD');
 assert.equal(r.items[0].listedOffer.unitPrice,1200);
 assert.equal(r.items[0].contentSha256,crypto.createHash('sha256').update(body).digest('hex'));
 assert.equal(r.verifiedQuotes,0);assert.equal(r.nationalDecision,'HOLD_NATIONAL');
 assert.equal(calls,1);assert.equal(claims,1);assert.equal(locks,1);
});
