const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function harness(){const c=vm.createContext({Date,Map,Set});vm.runInContext(fs.readFileSync('OfficialTsManifest.gs','utf8'),c);return c;}
const now='2026-10-13T05:00:00.000Z';
function shortlist(){return {mode:'SAME_DAY_SELECTED_IDS_READ_ONLY',coverage:'sample_only',observedAt:now,
 items:[{lotId:'43544048',decision:'SAME_DAY_CANDIDATE',lotNumber:'88138120-ЗЦП1',announcementId:17757453,
 announcementNumber:'17757453-1',amountKzt:10000,quantity:1,plannedMethodId:3,actualMethodId:6,
 status:'PublishedOfferAccept',deadline:'2026-10-13T09:00:00.000Z',applicationStart:'2026-10-13T01:00:00.000Z',
 deadlineRaw:'2026-10-13 14:00:00',repeatDeadlineRaw:null}]};}
function lot(){const s=shortlist().items[0];return {id:43544048,lotNumber:s.lotNumber,trdBuyId:s.announcementId,
 trdBuyNumberAnno:s.announcementNumber,amount:s.amountKzt,count:s.quantity,
 refTradeMethodsId:s.plannedMethodId,refBuyTradeMethodsId:s.actualMethodId,
 RefLotsStatus:{code:s.status},TrdBuy:{id:s.announcementId,endDate:s.deadlineRaw,repeatEndDate:null},
 Files:[{id:17,objectId:888,originalName:'techspec_17757453_43544048.pdf',
 nameRu:'Техническая спецификация',nameKz:'Техникалық сипаттама',indexDate:null,systemId:12}]};}
test('official FileLots metadata is ONLY a candidate, not original TS proof',()=>{
 const r=harness().prepareTenderTsManifest(shortlist(),[lot()],now);
 assert.equal(r.issue,null);assert.equal(r.items[0].reason,'TS_FILENAME_HINT_ONLY');
 assert.equal(r.items[0].filenameCandidates,1);assert.equal(r.items[0].originalTsUrl,null);
 assert.equal(r.items[0].currentDocumentVersionVerified,false);
 assert.equal(r.originalDocumentsVerified,0);assert.equal(r.nationalDecision,'HOLD_NATIONAL');
 assert.equal(JSON.stringify(r).includes('"objectId":'),false);
});
test('changed announcement or deadline quarantines document link',()=>{
 const c=harness();for(const mutate of [x=>x.trdBuyId++,x=>x.TrdBuy.endDate='CHANGED',x=>x.amount++]) {
 const x=lot();mutate(x);assert.equal(c.prepareTenderTsManifest(shortlist(),[x],now).items[0].reason,'CURRENT_LOT_CONTEXT_CHANGED');
 }});
test('malformed and oversized files cannot become accepted',()=>{
 const c=harness();const a=lot();a.Files.push(a.Files[0]);
 assert.equal(c.prepareTenderTsManifest(shortlist(),[a],now).items[0].reason,'FILE_METADATA_MALFORMED');
 const b=lot();b.Files=Array(11).fill(b.Files[0]);
 assert.equal(c.prepareTenderTsManifest(shortlist(),[b],now).items[0].reason,'FILES_RELATION_TOO_LARGE');
});
test('no Files relation and zero files are distinct uncertain statuses',()=>{
 const c=harness();const x=lot();x.Files=null;
 assert.equal(c.prepareTenderTsManifest(shortlist(),[x],now).items[0].reason,'FILES_RELATION_UNVERIFIED');
 x.Files=[];assert.equal(c.prepareTenderTsManifest(shortlist(),[x],now).items[0].reason,'EMPTY_API_FILES_RELATION');
});
test('duplicate source Lots.id and wrong lot id fail closed',()=>{
 const c=harness();assert.equal(c.prepareTenderTsManifest(shortlist(),[lot(),lot()],now).items[0].reason,'DUPLICATE_LOT_RESPONSE');
 const x=lot();x.id=123;assert.equal(c.prepareTenderTsManifest(shortlist(),[x],now).issue,'TS_MANIFEST_RESPONSE_SCOPE_INVALID');
});
test('stale snapshots and expired deadline are never reviewed',()=>{
 const c=harness();const s=shortlist();s.observedAt='2026-10-12T05:00:00.000Z';
 assert.equal(c.prepareTenderTsManifest(s,[lot()],now).issue,'TS_MANIFEST_INPUT_INVALID');
 const t=shortlist();t.items[0].deadline=now;
 assert.equal(c.prepareTenderTsManifest(t,[lot()],now).items[0].reason,'LOT_NOT_CURRENT');
});
test('unapproved runtime prevents API, lock, quota and Sheet changes',()=>{
 const c=harness();let calls=0;c.LockService={getScriptLock:()=>{calls++;throw Error('lock requested');}};
 assert.equal(c.inspectTenderOfficialTsMetadata(shortlist(),{}).issue,'OWNER_OFFICIAL_METADATA_APPROVAL_REQUIRED');
 assert.equal(calls,0);
});
test('workflow manifest join does not substitute filename as PDF source URL',()=>{
 const c=harness(),metadata=c.prepareTenderTsManifest(shortlist(),[lot()],now);
 const workflow={mode:'TENDER_WORKFLOW_READ_ONLY',issue:null,rows:[{lotId:'43544048',lotNo:'88138120-ЗЦП1',
 tenderNo:'17757453-1',decision:'REVIEW',originalTsUrl:null}]};
 const result=c.joinTenderTsManifestPreview(workflow,metadata);
 assert.equal(result.rows[0].tsFilenameHints.length,1);
 assert.equal(result.rows[0].originalTsUrl,null);assert.equal(result.rows[0].tsLinkFromMetadata,null);
 assert.equal(result.rows[0].tsMetadataIsDocumentProof,false);
});
