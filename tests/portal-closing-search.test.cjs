const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
function row(id=11,buy=21,amount='10 000 000.00'){
 return `<tr><td><strong>31-ЗЦП1</strong><td><a href="/ru/announce/index/${buy}">${buy}-1 SYNTHETIC</a></td><td><a href="https://old.goszakup.gov.kz/ru/subpriceoffer/index/${buy}/${id}">SYNTHETIC Товар</a><a data-lot-id='${id}' data-trb-buy='${buy}' href='javascript:void(0)'>История</a></td><td>2</td><td>${amount}</td><td>Запрос ценовых предложений</td><td>Опубликован (прием ценовых предложений)</td></tr>`;
}
function html(rows=[row()],total=rows.length,page=1){return `<input name="filter[end_date_from]" value="20.10.2026"><input value="20.10.2026" name="filter[end_date_to]"><input name="filter[amount_to]" value="10000000"><select name="filter[trade_type]" data-size="7" data-size="10"><option value="g" selected="selected">Товар</option></select><strong>Показано c ${(page-1)*50+1} по ${(page-1)*50+rows.length} из ${total} записей</strong><table id="search-result"><thead><tr>${['№ лота','Наименование объявления','Наименование и описание лота','Кол-во','Сумма, тг.','Способ закупки','Статус'].map(h=>'<th>'+h+'</th>').join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;}
function detail(item,status='Закупка не состоялась'){return `<h1>Информация о лоте №${item.lotNumber}</h1><table><tr><th>Лот №</th><td>${item.lotNumber} <a data-lot-id="${item.lotId}" data-trb-buy="${item.announcementId}">История</a></td></tr><tr><th>Количество</th><td>2</td></tr><tr><th>Статус лота</th><td>${status}</td></tr><tr><th>Дата окончания приема заявок</th><td>2026-10-20 00:00:00</td></tr></table>`;}
function harness(){
 let now=Date.parse('2026-10-20T15:00:00Z'),released=0,claimed=0;const calls=[],sleeps=[];
 class Clock extends Date{constructor(...v){super(...v.length?v:[now]);}static now(){return now;}}
 const c=vm.createContext({Date:Clock,Map,Set,Utilities:{formatDate:()=> '2026-10-20',sleep:n=>{sleeps.push(n);now+=n;}},
 fingerprint_:s=>crypto.createHash('sha256').update(s).digest('hex'),pilotBudget_:()=>({claim:()=>claimed++}),
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>released++})},
 UrlFetchApp:{fetch:(url,options)=>{calls.push({url,options});const body=url.includes('/search/')?html():detail({lotId:'11',announcementId:21,lotNumber:'31-ЗЦП1'});
 return {getResponseCode:()=>200,getAllHeaders:()=>({'Content-Type':'text/html; charset=UTF-8'}),getContent:()=>Buffer.from(body),getContentText:()=>body};}}});
 vm.runInContext(fs.readFileSync('PortalClosingSearch.gs','utf8'),c);
 return {c,calls,sleeps,stats:()=>({released,claimed}),late:()=>{now+=120000;}};
}
const at='2026-10-20T15:00:00.000Z';
const parse=(h)=>harness().c.parseTenderPortalClosingPage(h,'2026-10-20',1,at);
test('real form semantics: closing date, goods, inclusive per-lot budget and observed URL binding',()=>{
 const r=parse(html());assert.equal(r.issue,null);assert.equal(r.items[0].amountKzt,10000000);assert.equal(r.items[0].lotId,'11');assert.equal(r.items[0].nationalDecision,'HOLD_NATIONAL');
 assert.equal(r.items[0].decision,'REVIEW_DATE');assert.match(r.sourceSha256,/^[a-f0-9]{64}$/);assert.equal(r.dailyCoverageVerified,false);
 assert.ok(r.sourceUrl.includes('filter%5Bend_date_to%5D=20.10.2026'));assert.ok(!r.sourceUrl.includes('publish'));
});
test('invalid date and page are refused before source construction',()=>{const c=harness().c;assert.throws(()=>c.portalClosingUrl_('2026-02-30',1));assert.throws(()=>c.portalClosingUrl_('2026-10-20',4));});
test('missing or ignored filters, wrong type, changed columns, malformed count and duplicate IDs fail closed',()=>{
 const base=html();for(const h of [base.replace('value="10000000"','value=""'),base.replace('selected="selected"',''),base.replace('value="g"','value="s"'),
 base.replace('Сумма, тг.','Итого'),base.replace('по 1 из','по 2 из'),html([row(),row()]),base.replace('20.10.2026','21.10.2026')])assert.equal(parse(h).items.length,0);
});
test('wrong announcement link, external source, overbudget, duplicate attribute and nonnumeric amounts cannot pass',()=>{
 for(const h of [html().replace('/index/21/11','/index/22/11'),html().replace('https://old.goszakup.gov.kz/ru/subpriceoffer','https://evil.invalid/ru/subpriceoffer'),
 html([row(11,21,'10 000 000.01')]),html().replace('data-lot-id=','data-lot-id="12" data-lot-id='),html([row(11,21,'нет данных')])])assert.ok(parse(h).issue);
});
test('HTML entities decode as text without executing markup or trusting history scripts',()=>{const h=harness();assert.equal(h.c.portalText_('A &amp; B &#8470; &#x422;'),'A & B № Т');});
test('current detail overrides a stale accepting search-index status, never infers national NO',()=>{
 const c=harness().c,item=parse(html()).items[0],r=c.inspectTenderPortalDetail(detail(item),item,at);
 assert.equal(r.detailChecked,true);assert.equal(r.decision,'NOT_OPEN');assert.equal(r.deadlineRaw,'2026-10-20 00:00:00');assert.equal(r.nationalDecision,'HOLD_NATIONAL');
});
test('an accepting detail with no proven timezone still stays REVIEW_DATE',()=>{
 const c=harness().c,item=parse(html()).items[0];assert.equal(c.inspectTenderPortalDetail(detail(item,item.portalSearchStatus),item,at).decision,'REVIEW_DATE');
});
test('wrong detail identity or changed quantity cannot become an open opportunity',()=>{
 const c=harness().c,item=parse(html()).items[0];for(const body of [detail(item).replace('data-lot-id="11"','data-lot-id="12"'),detail(item).replace('<td>2</td>','<td>3</td>')])assert.equal(c.inspectTenderPortalDetail(body,item,at).detailChecked,false);
});
test('no-argument collector executes real-source adapter with crawl delay, quota and no credentials',()=>{
 const h=harness(),r=h.c.inspectTenderTodayMvp();assert.equal(r.issue,null);assert.equal(r.items.length,1);assert.equal(r.requests,2);assert.equal(r.detailRequests,1);
 assert.equal(h.stats().claimed,2);assert.equal(h.stats().released,1);assert.equal(h.sleeps[0],5000);
 for(const call of h.calls){assert.equal(call.options.followRedirects,false);assert.equal(call.options.validateHttpsCertificates,true);assert.equal(call.options.headers.Authorization,undefined);assert.equal(call.options.headers.Cookie,undefined);}
 assert.equal(r.sheetsChanged,false);assert.equal(r.watermarkAdvanced,false);assert.equal(r.paidServicesUsed,false);
});
test('403, redirect, CAPTCHA HTML and quota failure are redacted, without fallback or retries',()=>{
 for(const kind of ['403','redirect','captcha','quota']){
 const h=harness();if(kind==='quota')h.c.pilotBudget_=()=>({claim:()=>{throw Error('private value');}});
 else h.c.UrlFetchApp.fetch=()=>({getResponseCode:()=>kind==='403'?403:kind==='redirect'?302:200,getAllHeaders:()=>({'Content-Type':'text/html'}),getContent:()=>[1],getContentText:()=>'<html>CAPTCHA private value</html>'});
 const r=h.c.inspectTenderTodayMvp();assert.equal(r.issue,'PORTAL_SOURCE_SCHEMA_OR_QUOTA_BLOCKED');assert.equal(r.items.length,0);assert.ok(!JSON.stringify(r).includes('private value'));assert.equal(h.stats().released,1);
 }
});
test('oversized and late responses cannot produce a partial accepted shortlist',()=>{
 for(const late of [false,true]){const h=harness();h.c.UrlFetchApp.fetch=()=>{if(late)h.late();return {getResponseCode:()=>200,getAllHeaders:()=>({'Content-Type':'text/html'}),getContent:()=>({length:1000001}),getContentText:()=>html()};};assert.ok(h.c.inspectTenderTodayMvp().issue);}
});
test('bounded pagination and diverse announcement detail sampling, no country-wide scan',()=>{
 const h=harness();let n=0;h.c.UrlFetchApp.fetch=(url)=>{let body;if(url.includes('/search/')){n++;body=html(Array.from({length:50},(_,i)=>row((n-1)*50+i+1,i%8+21)),200,n);}else{const m=url.match(/\/index\/(\d+)\/(\d+)$/);body=detail({lotId:m[2],announcementId:Number(m[1]),lotNumber:'31-ЗЦП1'});}return {getResponseCode:()=>200,getAllHeaders:()=>({'Content-Type':'text/html'}),getContent:()=>Buffer.from(body),getContentText:()=>body};};
 const r=h.c.inspectTenderTodayMvp();assert.equal(r.issue,null);assert.equal(r.requests,8);assert.equal(r.pages.length,3);assert.equal(r.parsedRows,150);assert.equal(r.items.length,30);assert.equal(r.detailRequests,5);assert.equal(new Set(r.items.slice(0,5).map(x=>x.announcementId)).size,5);assert.equal(r.dailyCoverageVerified,false);
});
test('safe CSV contains actual source/provenance, never formulas or invented margin',()=>{
 const h=harness(),report=h.c.inspectTenderTodayMvp();report.items[0].name='=HYPERLINK("evil")';
 const csv=h.c.exportTenderTodayMvpCsv(report);assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes('detailSourceSha256'));assert.ok(!csv.includes('netMarginPercent'));
 assert.equal(h.c.exportTenderTodayMvpCsv({...report,issue:'BLOCKED'}),null);
});
test('both manual deployment phases require the entire regression suite before Google access',()=>{
 const yaml=require('../tools/ci/node_modules/yaml');
 const flow=yaml.parse(fs.readFileSync('.github/workflows/apps-script-publish.yml','utf8'));
 for(const phase of ['prepare','publish']){
 const steps=flow.jobs[phase].steps,check=steps.findIndex(s=>s.name==='Validate dispatch and run local tests');
 assert.ok(check>=0);assert.match(steps[check].run,/node --test tests\/\*\.test\.cjs/);
 assert.ok(check<steps.findIndex(s=>s.name==='Materialize temporary Google OAuth file'));
 }
 assert.equal(flow.on.workflow_dispatch.inputs.operation.default,'prepare');
 assert.equal(flow.jobs.publish.environment,'apps-script-production');
});
