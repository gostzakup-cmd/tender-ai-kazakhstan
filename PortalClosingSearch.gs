/** Public, date-filtered portal discovery; not an OWS deadline filter or a GO source.
 * Filters/link shapes verified against the live public form on 2026-10-20.
 * All HTML is untrusted. No cookies, credentials, redirects or paid services.
 */
const TENDER_PORTAL_SEARCH = Object.freeze({origin:'https://old.goszakup.gov.kz',
  maxPages:3,maxItems:30,maxDetails:5,maxCalls:8,maxBytes:1000000,maxRuntimeMs:110000,crawlDelayMs:5000});

function portalText_(html) {
  return String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ')
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi,function(e){
      const named={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '};
      if(named[e.toLowerCase()])return named[e.toLowerCase()];
      const hex=e[2].toLowerCase()==='x',n=parseInt(e.slice(hex?3:2,-1),hex?16:10);
      return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';
    }).replace(/\s+/g,' ').trim();
}
function portalAttrs_(tag) {
  const attrs=Object.create(null);let m;
  const re=/([\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
  while((m=re.exec(tag))!==null){
    const key=m[1].toLowerCase();if(Object.prototype.hasOwnProperty.call(attrs,key)&&['name','value','id','href','data-lot-id','data-trb-buy'].includes(key))throw new Error('ATTRIBUTE_DUPLICATE');
    // Attribute values are decoded without interpreting them as HTML.
    attrs[key]=m[3].replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  }
  return attrs;
}
function portalCalendar_(date) {
  if(typeof date!=='string'||!/^\d{4}-\d\d-\d\d$/.test(date)||
    !Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('DATE_INVALID');
  return date.slice(8,10)+'.'+date.slice(5,7)+'.'+date.slice(0,4);
}
function portalClosingUrl_(date,page) {
  const day=portalCalendar_(date);
  if(!Number.isInteger(page)||page<1||page>TENDER_PORTAL_SEARCH.maxPages)throw new Error('PAGE_INVALID');
  const pairs=[['filter[end_date_from]',day],['filter[end_date_to]',day],['filter[trade_type]','g'],
    ['filter[amount_to]','10000000'],['count_record','50'],['page',String(page)]];
  return TENDER_PORTAL_SEARCH.origin+'/ru/search/lots?'+pairs.map(function(p){return encodeURIComponent(p[0])+'='+encodeURIComponent(p[1]);}).join('&');
}
function portalNumber_(text) {
  const value=portalText_(text).replace(/[\s\u00a0]/g,'');
  if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw new Error('NUMBER_INVALID');
  const n=Number(value);if(!Number.isFinite(n)||n>Number.MAX_SAFE_INTEGER/100)throw new Error('NUMBER_INVALID');return n;
}
function parseTenderPortalClosingPage(html,date,page,observedAt) {
  const out={mode:'PUBLIC_PORTAL_CLOSING_PAGE',issue:null,date:date,page:page,items:[],
    portalReportedTotal:null,hasMore:null,observedAt:observedAt,sourceUrl:portalClosingUrl_(date,page),
    sourceSha256:null,coverage:'sample_only',dailyCoverageVerified:false};
  try{
    if(typeof html!=='string'||html.length>TENDER_PORTAL_SEARCH.maxBytes||!/\d{4}-\d\d-\d\dT/.test(observedAt || ''))throw new Error('HTML_INVALID');
    const day=portalCalendar_(date),echo=Object.create(null);
    for(const tag of html.match(/<input\b[^>]*>/gi)||[]){const a=portalAttrs_(tag);if(a.name){if(echo[a.name]!==undefined)throw new Error('FILTER_DUPLICATE');echo[a.name]=a.value;}}
    if(echo['filter[end_date_from]']!==day||echo['filter[end_date_to]']!==day||echo['filter[amount_to]']!=='10000000')throw new Error('FILTER_NOT_APPLIED');
    const goods=(html.match(/<select\b[^>]*>[\s\S]*?<\/select>/gi)||[]).filter(function(s){return portalAttrs_(s.slice(0,s.indexOf('>')+1)).name==='filter[trade_type]';});
    if(goods.length!==1)throw new Error('GOODS_FILTER_MISSING');
    const selected=(goods[0].match(/<option\b[^>]*>[\s\S]*?<\/option>/gi)||[]).filter(function(o){return /\bselected(?:\s*=|\s|>)/i.test(o.slice(0,o.indexOf('>')+1));});
    if(selected.length!==1||portalAttrs_(selected[0].slice(0,selected[0].indexOf('>')+1)).value!=='g')throw new Error('GOODS_FILTER_NOT_APPLIED');
    const range=/Показано\s+[cс]\s+(\d+)\s+по\s+(\d+)\s+из\s+(\d+)\s+записей/.exec(portalText_(html));
    if(!range)throw new Error('COUNT_UNVERIFIED');
    const first=Number(range[1]),last=Number(range[2]),total=Number(range[3]);
    if(![first,last,total].every(Number.isSafeInteger)||first!==(page-1)*50+1||last<first||last>first+49||last>total)throw new Error('RANGE_INVALID');
    const tables=(html.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi)||[]).filter(function(t){return portalAttrs_(t.slice(0,t.indexOf('>')+1)).id==='search-result';});
    if(tables.length!==1)throw new Error('RESULT_TABLE_MISSING');
    const table=tables[0],headers=(table.match(/<th\b[^>]*>[\s\S]*?<\/th>/gi)||[]).map(portalText_);
    if(headers.join('|')!=='№ лота|Наименование объявления|Наименование и описание лота|Кол-во|Сумма, тг.|Способ закупки|Статус')throw new Error('TABLE_SCHEMA_CHANGED');
    const body=/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(table);
    if(!body)throw new Error('RESULT_BODY_MISSING');
    const rows=body[1].match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)||[],ids=new Set();
    if(rows.length!==last-first+1||rows.length>50)throw new Error('ROW_COUNT_MISMATCH');
    for(const row of rows){
      // The observed portal omits the closing first </td>; split on openings.
      const cells=row.split(/<td\b[^>]*>/i).slice(1);
      if(cells.length!==7)throw new Error('ROW_SCHEMA_CHANGED');
      const history=(row.match(/<a\b[^>]*>/gi)||[]).map(portalAttrs_).filter(function(a){return a['data-lot-id']&&a['data-trb-buy'];});
      if(history.length!==1)throw new Error('IDENTITY_MISSING');
      const lotId=history[0]['data-lot-id'],buyId=history[0]['data-trb-buy'];
      if(![lotId,buyId].every(function(id){return /^[1-9]\d{0,9}$/.test(id)&&Number(id)<=2147483647;})||ids.has(lotId))throw new Error('IDENTITY_INVALID');
      ids.add(lotId);
      const links=(cells[2].match(/<a\b[^>]*>[\s\S]*?<\/a>/gi)||[]).filter(function(a){return !!portalAttrs_(a.slice(0,a.indexOf('>')+1)).href && !portalAttrs_(a.slice(0,a.indexOf('>')+1)).href.startsWith('javascript:');});
      if(links.length!==1)throw new Error('LOT_LINK_AMBIGUOUS');
      const url=portalAttrs_(links[0].slice(0,links[0].indexOf('>')+1)).href;
      if(!new RegExp('^https://old\\.goszakup\\.gov\\.kz/ru/[a-z]+/index/'+buyId+'/'+lotId+'$').test(url))throw new Error('LOT_LINK_UNBOUND');
      const anno=portalText_(cells[1]).match(/^([1-9]\d*-\d+)\s/),lotNo=portalText_(cells[0]);
      if(!anno||anno[1].split('-')[0]!==buyId||!/^\d+-[^\s]+$/.test(lotNo))throw new Error('NUMBER_BINDING_INVALID');
      const amount=portalNumber_(cells[4]),qty=portalNumber_(cells[3]);
      if(amount>10000000||qty<=0)throw new Error('BUDGET_OR_QUANTITY_INVALID');
      out.items.push({lotId:lotId,lotNumber:lotNo,announcementId:Number(buyId),announcementNumber:anno[1],
        name:portalText_(links[0]),amountKzt:amount,quantity:qty,portalMethod:portalText_(cells[5]),
        portalSearchStatus:portalText_(cells[6]),sourceUrl:url,searchSourceUrl:out.sourceUrl,
        decision:'REVIEW_DATE',nationalDecision:'HOLD_NATIONAL',commercialDecision:'REVIEW',
        reason:'PORTAL_DATE_FILTER_ONLY_REQUIRES_CURRENT_DETAIL',observedAt:observedAt});
    }
    out.portalReportedTotal=total;out.hasMore=last<total;out.sourceSha256=fingerprint_(html);
  }catch(e){out.issue='PORTAL_HTML_OR_FILTER_UNVERIFIED';out.items=[];}
  return out;
}

/** Current detail is separate evidence: search-index status can be stale. */
function inspectTenderPortalDetail(html,item,at) {
  const out=Object.assign({},item,{detailObservedAt:at,detailSourceSha256:null,
    deadlineRaw:null,applicationStartRaw:null,detailStatus:null,detailChecked:false,
    nationalDecision:'HOLD_NATIONAL',commercialDecision:'REVIEW',decision:'REVIEW_DATE'});
  try{
    if(typeof html!=='string'||html.length>TENDER_PORTAL_SEARCH.maxBytes||!Number.isFinite(Date.parse(at)))throw new Error('HTML_INVALID');
    const heading=portalText_((/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)||[])[1]||'');
    if(heading!=='Информация о лоте №'+item.lotNumber)throw new Error('WRONG_LOT');
    const history=(html.match(/<a\b[^>]*>/gi)||[]).map(portalAttrs_).filter(function(a){return a['data-lot-id']===item.lotId&&a['data-trb-buy']===String(item.announcementId);});
    if(history.length!==1)throw new Error('WRONG_IDENTITY');
    const values=Object.create(null);
    for(const row of html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)||[]){
      const m=/<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/i.exec(row);
      if(m){const k=portalText_(m[1]);if(values[k]!==undefined)throw new Error('AMBIGUOUS_DETAIL');values[k]=portalText_(m[2]);}
    }
    if(values['Лот №']!==item.lotNumber+' История'||portalNumber_(values['Количество'])!==item.quantity)throw new Error('DETAIL_CONTEXT_CHANGED');
    out.deadlineRaw=values['Дата окончания приема заявок']||null;
    out.applicationStartRaw=values['Дата начала приема заявок']||null;
    out.detailStatus=values['Статус лота']||null;out.unit=values['Единица измерения']||null;
    out.detailChecked=true;out.detailSourceSha256=fingerprint_(html);
    // Raw strings have no verified timezone; never guess an offset or OPEN.
    out.statusConflict=out.detailStatus!==item.portalSearchStatus;
    out.reason=out.statusConflict?'PORTAL_SEARCH_DETAIL_STATUS_CONFLICT':'SOURCE_DATE_TIMEZONE_REQUIRED';
    if(['Закупка не состоялась','Закупка состоялась','Отменен','Отказ от лота'].includes(out.detailStatus)){
      out.decision='NOT_OPEN';out.reason='CURRENT_DETAIL_STATUS_NOT_ACCEPTING';
    }
  }catch(e){out.reason='PORTAL_DETAIL_IDENTITY_OR_SCHEMA_UNVERIFIED';}
  return out;
}

/** No-argument entry point: real current-date public data; no token needed.
 * At most 3 date-filtered pages + 5 distinct-announcement details. */
function inspectTenderTodayMvp() {
  const began=Date.now(),zone='Asia/Qyzylorda',date=Utilities.formatDate(new Date(),zone,'yyyy-MM-dd');
  const out={mode:'PUBLIC_PORTAL_TODAY_MVP',date:date,selectionTimezone:zone,observedAt:new Date().toISOString(),
    coverage:'sample_only',dailyCoverageVerified:false,issue:null,items:[],pages:[],requests:0,
    detailRequests:0,sheetsChanged:false,watermarkAdvanced:false,paidServicesUsed:false,commercialDecision:'REVIEW'};
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000)){out.issue='PORTAL_ALREADY_RUNNING';return out;}
  let last=began;
  try{
    const budget=pilotBudget_();
    const get=function(url){
      if(!/^https:\/\/old\.goszakup\.gov\.kz\/ru\/(?:search\/lots\?|[a-z]+\/index\/\d+\/\d+$)/.test(url)||out.requests>=TENDER_PORTAL_SEARCH.maxCalls)throw new Error('SCOPE_LIMIT');
      const wait=Math.max(0,TENDER_PORTAL_SEARCH.crawlDelayMs-(Date.now()-last));if(last&&wait)Utilities.sleep(wait);
      if(Date.now()-began>=TENDER_PORTAL_SEARCH.maxRuntimeMs)throw new Error('TIME_LIMIT');
      budget.claim();out.requests++;last=Date.now();
      const response=UrlFetchApp.fetch(url,{method:'get',followRedirects:false,muteHttpExceptions:true,validateHttpsCertificates:true,
        headers:{Accept:'text/html','User-Agent':'TenderAIKazakhstan-PublicReadOnly/1.0'}});
      const headers=response.getAllHeaders(),type=Object.keys(headers).find(function(k){return k.toLowerCase()==='content-type';});
      if(response.getResponseCode()!==200||!type||!/^text\/html(?:;|$)/i.test(headers[type])||response.getContent().length>TENDER_PORTAL_SEARCH.maxBytes)throw new Error('SOURCE_BLOCKED');
      if(Date.now()-began>=TENDER_PORTAL_SEARCH.maxRuntimeMs)throw new Error('LATE_RESPONSE');
      return response.getContentText();
    };
    const all=[],seen=new Set();let total=null;
    for(let page=1;page<=TENDER_PORTAL_SEARCH.maxPages;page++){
      const url=portalClosingUrl_(date,page),parsed=parseTenderPortalClosingPage(get(url),date,page,new Date().toISOString());
      if(parsed.issue||total!==null&&total!==parsed.portalReportedTotal)throw new Error('SOURCE_CHANGED');
      total=parsed.portalReportedTotal;
      out.pages.push({page:page,url:url,sha256:parsed.sourceSha256,returned:parsed.items.length,hasMore:parsed.hasMore});
      for(const item of parsed.items){if(seen.has(item.lotId))throw new Error('DUPLICATE_PAGE_ID');seen.add(item.lotId);all.push(item);}
      if(!parsed.hasMore)break;
    }
    out.portalReportedTotal=total;out.parsedRows=all.length;
    // Prioritize distinct announcements for the tiny current-detail sample.
    const buyIds=new Set(),ordered=[];
    for(const item of all){if(!buyIds.has(item.announcementId)){buyIds.add(item.announcementId);ordered.push(item);}}
    for(const item of all){if(!ordered.includes(item))ordered.push(item);}
    out.items=ordered.slice(0,TENDER_PORTAL_SEARCH.maxItems);
    for(let i=0;i<Math.min(out.items.length,TENDER_PORTAL_SEARCH.maxDetails);i++){
      out.detailRequests++;
      out.items[i]=inspectTenderPortalDetail(get(out.items[i].sourceUrl),out.items[i],new Date().toISOString());
    }
    if(Utilities.formatDate(new Date(),zone,'yyyy-MM-dd')!==date)throw new Error('DAY_CHANGED');
    out.observedAt=new Date().toISOString();
  }catch(e){out.issue='PORTAL_SOURCE_SCHEMA_OR_QUOTA_BLOCKED';out.items=[];}
  finally{lock.releaseLock();}
  return out;
}

/** Read-only CSV artifact; never writes a Google Sheet or invents commercial data. */
function exportTenderTodayMvpCsv(report) {
  if(!report||report.mode!=='PUBLIC_PORTAL_TODAY_MVP'||report.issue||!Array.isArray(report.items)||report.items.length>30)return null;
  const fields=['lotId','lotNumber','announcementNumber','name','amountKzt','quantity','portalMethod',
    'portalSearchStatus','detailStatus','deadlineRaw','decision','nationalDecision','commercialDecision',
    'reason','sourceUrl','detailObservedAt','detailSourceSha256'];
  const cell=function(v){let s=String(v===undefined||v===null?'':v).replace(/[\r\n\t]/g,' ').slice(0,1600);
    if(/^\s*[=+\-@\u0000-\u001f]/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';};
  return [fields.map(cell).join(',')].concat(report.items.map(function(item){return fields.map(function(k){return cell(item[k]);}).join(',');})).join('\r\n');
}

/** Apps Script editor entry point. Result JSON only, no storage or publication. */
function previewTenderToday() {
  const report=inspectTenderTodayMvp(),text=JSON.stringify(report);
  for(let i=0;i<text.length;i+=4000)console.log('TENDER_TODAY_JSON_PART_'+(i/4000+1)+': '+text.slice(i,i+4000));
  return report;
}
