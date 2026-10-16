const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const c=vm.createContext({});
vm.runInContext(fs.readFileSync('ClosingCoverageAudit.gs','utf8'),c);
const names=['TrdBuy.publishDate','TrdBuy.lastUpdateDate','Lots.lastUpdateDate','Lots.indexDate','Lots.byTrdBuyId'];
function report(){return {mode:'SAME_DAY_SELECTED_IDS_READ_ONLY',discoveryMode:'OWS_V3_BOUNDED_AUTO',
 coverage:'sample_only',dailyCoverageVerified:false,issue:null,items:[{decision:'SAME_DAY_CANDIDATE'}],
 streams:names.map(name=>({name,returned:1,totalReported:1,hasMore:false}))};}
test('even entirely exhausted short change-window pages are not all daily deadlines',()=>{
 const r=c.auditTenderClosingDiscoveryCoverage(report());
 assert.equal(r.issue,null);assert.equal(r.foundCandidates,1);
 assert.equal(r.dailyCoverageVerified,false);assert.equal(r.canClaimAllSameDayLots,false);
 assert.ok(r.gaps.includes('DEADLINE_INDEX_OR_FULL_DAY_CURSOR_NOT_AVAILABLE'));
});
test('unfinished pages and caps reported',()=>{
 const p=report();p.streams[2].hasMore=true;p.streams[2].totalReported=4;
 p.lotCapReached=true;p.announcementIdsTruncated=true;
 const r=c.auditTenderClosingDiscoveryCoverage(p);
 assert.ok(r.gaps.includes('UNPAGED_SOURCE:Lots.lastUpdateDate'));
 assert.ok(r.gaps.includes('LOT_SAMPLE_LIMIT_REACHED'));
 assert.ok(r.gaps.includes('ANNOUNCEMENT_SAMPLE_LIMIT_REACHED'));
});
test('forged complete coverage blocked',()=>{
 const p=report();p.dailyCoverageVerified=true;
 assert.equal(c.auditTenderClosingDiscoveryCoverage(p).issue,'UNSUPPORTED_FULL_DAY_COVERAGE_CLAIM');
});
test('duplicated or unknown stream blocked',()=>{
 const p=report();p.streams[4].name='Lots.indexDate';
 assert.equal(c.auditTenderClosingDiscoveryCoverage(p).issue,'CLOSING_DISCOVERY_STREAM_INVALID');
});
