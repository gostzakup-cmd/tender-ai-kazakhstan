#!/usr/bin/env node
'use strict';
// Runs the SAME Apps Script portal collector locally against public live pages.
// No server, OAuth, Goszakup token, browser session, paid API or Sheets access.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),vm=require('node:vm'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function main(){
 process.umask(0o077);
 const folder=path.join(os.tmpdir(),'tender-public-preview-'+process.getuid());
 if(!fs.existsSync(folder))fs.mkdirSync(folder,{mode:0o700});
 const st=fs.lstatSync(folder);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077))throw Error('PRIVATE_RUNTIME_DIRECTORY_REQUIRED');
 const lock=path.join(folder,'lock'),ledger=path.join(folder,'attempts.json');let locked=false;
 const runtime=fs.mkdtempSync(path.join(folder,'request-'));
 try{
  const context=vm.createContext({Date,Map,Set,Utilities:{
   formatDate:(d,zone,format)=>{
    if(format!=='yyyy-MM-dd')throw Error('DATE_FORMAT_UNSUPPORTED');
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
    const value=k=>parts.find(p=>p.type===k).value;
    return value('year')+'-'+value('month')+'-'+value('day');
   },sleep:ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)
  },fingerprint_:s=>crypto.createHash('sha256').update(s,'utf8').digest('hex'),
  LockService:{getScriptLock:()=>({tryLock:()=>{
   try{fs.mkdirSync(lock,{mode:0o700});locked=true;return true;}catch{return false;}
  },releaseLock:()=>{if(locked){fs.rmdirSync(lock);locked=false;}}})},
  pilotBudget_:()=>({claim:()=>{
   const now=Date.now(),previous=fs.existsSync(ledger)?JSON.parse(fs.readFileSync(ledger,'utf8')):[];
   if(!Array.isArray(previous)||previous.some(n=>!Number.isSafeInteger(n)||n<0||n>now))throw Error('QUOTA_STATE_INVALID');
   const live=previous.filter(n=>now-n<86400000);if(live.length>=200)throw Error('DAILY_ATTEMPT_CAP');
   live.push(now);fs.writeFileSync(ledger,JSON.stringify(live),{mode:0o600});
  }}),UrlFetchApp:{fetch:(url,options)=>{
   if(!/^https:\/\/old\.goszakup\.gov\.kz\/ru\//.test(url)||options.method!=='get'||options.followRedirects!==false)throw Error('PUBLIC_SOURCE_ONLY');
   const body=path.join(runtime,'body'),headers=path.join(runtime,'headers');
   const r=spawnSync('curl',['--silent','--show-error','--max-time','25','--max-filesize','1000000',
    '--proto','=https','--user-agent','TenderAIKazakhstan-PublicReadOnly/1.0',
    '--header','Accept: text/html','--dump-header',headers,'--output',body,'--write-out','%{http_code}',url],
    {encoding:'utf8',maxBuffer:4096});
   if(r.error||r.status!==0)throw Error('PUBLIC_HTTP_FAILED');
   const bytes=fs.readFileSync(body),h=fs.readFileSync(headers,'utf8').trim().split(/\r?\n\r?\n/).pop();
   const map={};for(const line of h.split(/\r?\n/)){const i=line.indexOf(':');if(i>0)map[line.slice(0,i).toLowerCase()]=line.slice(i+1).trim();}
   return {getResponseCode:()=>Number(r.stdout),getAllHeaders:()=>map,getContent:()=>bytes,getContentText:()=>bytes.toString('utf8')};
  }}});
  vm.runInContext(fs.readFileSync(path.join(root,'PortalClosingSearch.gs'),'utf8'),context,{filename:'PortalClosingSearch.gs'});
  const report=context.inspectTenderTodayMvp();
  report.executionEnvironment='LOCAL_NODE_PUBLIC_HTTP_BRIDGE_NOT_APPS_SCRIPT_PRODUCTION';
  report.quotaScope='LOCAL_ROLLING_24H_LEDGER_NOT_GOOGLE_SCRIPT_PROPERTIES';
  console.log(JSON.stringify(report,null,2));
  if(report.issue)process.exitCode=1;
 }finally{if(locked)fs.rmdirSync(lock);fs.rmSync(runtime,{recursive:true,force:true});}
}
if(require.main===module){try{main();}catch(e){console.error('PUBLIC_PREVIEW_FAILED');process.exitCode=1;}}
