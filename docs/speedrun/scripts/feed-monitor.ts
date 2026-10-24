#!/usr/bin/env bun
// Login-free demo monitor (rs/83): reads the public world feed and /playercount, never logs in.
// Prints one line a minute (ticks, interval p50/p90/max, gaps, feed closes, online, process-start token).
// ALERT: a gap over 5 s, a restart (token change) or a tickMs change. SLOWEVT n start/clear: a minute under
// 145 tick intervals starts an episode; 10 straight minutes at 145+ clear it. DEPART: 10+ players leaving the
// roster in one 4 s snapshot (names only as sha256(lowercased name)[0:8]); WAVE n: 40+ leaving in 60 s.
// WATCH left/back/present: names whose hashes are in RS83_WATCH (comma-separated, from the environment).
// Every relay-worthy line is prefixed NOTIFY#n: so one rolling Cairn phrase wake covers them all.
// Usage: RS83_WATCH=h1,h2 bun feed-monitor.ts [slowSeq] [on|off] [slowSinceISO] [slowMinN]
// one-subscription wake: every line worth relaying is numbered NOTIFY#n: so a single rolling phrase wake covers all of them
var notifySeq=0;const _log=console.log;console.log=(...a:any[])=>{const s=a.map(String).join(" ");if(/\bALERT\b|^SLOWEVT|^WATCH (left|back)/.test(s)){notifySeq++;_log("NOTIFY#"+notifySeq+": "+s);}else _log(...a);};
const B="https://rs-sdk-demo.fly.dev";
const iso=()=>new Date().toISOString();
let tok="",T=0,last=0,iv:number[]=[],gaps=0,closes=0;
async function meta(){try{const p=await (await fetch(B+"/bot")).text();const t=p.match(/client\.js\?v=([a-z0-9]+)/)?.[1]??"?";const c=JSON.parse(await (await fetch(B+"/playercount")).text()).count;if(tok&&t!==tok)console.log(iso(),"ALERT restart token",tok,"->",t,new Date(parseInt(t,36)).toISOString());tok=t;return c;}catch(e){console.log(iso(),"meta error",String(e));return -1;}}
function connect(){const ws=new WebSocket(B.replace("https","wss")+"/worldfeed");last=0;let ping:any;
ws.onopen=()=>{ws.send(JSON.stringify({t:"sub",x:3200,z:3200,w:16,h:16}));ws.send(JSON.stringify({t:"roster",on:true}));ping=setInterval(()=>{try{ws.send("{\"t\":\"ping\"}")}catch{}},30000);};
ws.onmessage=(e:any)=>{const d=JSON.parse(e.data);if(d.t==="hello"){if(T&&d.tickMs!==T)console.log(iso(),"ALERT tickMs",T,"->",d.tickMs);T=d.tickMs;}else if(d.t==="roster"){rosterStep(d);}else if(d.t==="tick"){const n=performance.now();if(last){const g=n-last;iv.push(g);if(g>1500){gaps++;lastGapAt=Date.now();console.log(iso(),(g>5000?"ALERT stall":"hitch")+" gap_ms="+g.toFixed(0),"ended_at_tick",d.k);}}last=n;}};
ws.onclose=(ev:any)=>{clearInterval(ping);closes++;console.log(iso(),"feed closed code="+ev.code,String(ev.reason||""),"reconnecting");setTimeout(connect,3000);};ws.onerror=()=>{};}
connect();await meta();
setInterval(async()=>{const c=await meta();const s=iv.sort((a,b)=>a-b);const q=(p:number)=>s.length?s[Math.min(s.length-1,Math.floor(p*s.length))].toFixed(0):"-";slowStep(s.length,closes,c);console.log(iso(),"T="+T,"n="+s.length,"p50="+q(.5),"p90="+q(.9),"max="+(s.at(-1)?.toFixed(0)??"-"),"gaps="+gaps,"closes="+closes,"online="+c,"tok="+tok);iv=[];gaps=0;closes=0;},60000);
let warned=false;setInterval(()=>{if(!last)return;const s=performance.now()-last;if(s>5000&&!warned){warned=true;console.log(iso(),"ALERT silence_ms="+s.toFixed(0),"no tick yet");}if(s<5000)warned=false;},1000);
// slow-tick episodes: start at the first minute under 145 intervals, clear after 10 consecutive minutes at 145+; minutes with a reconnect are skipped
var slowSeq=Number(process.argv[2]??0),slowOn=process.argv[3]==="on",okRun=0,slowMin=Number(process.argv[5]??999),slowStart=process.argv[4]??"";
function slowStep(n:number,cl:number,online:number){if(cl>0||n===0)return;if(n<145){okRun=0;if(!slowOn){slowOn=true;slowSeq++;slowMin=n;slowStart=iso();console.log("SLOWEVT "+slowSeq+" start",iso(),"n="+n,"online="+online);}else slowMin=Math.min(slowMin,n);}else if(slowOn){okRun++;if(okRun>=10){slowOn=false;okRun=0;console.log("SLOWEVT "+slowSeq+" clear",iso(),"since="+slowStart,"min_n="+slowMin,"online="+online);}}}
// roster departures: names only as sha256 prefixes (never written in clear). still = seconds since the player last changed tile.
import { createHash } from "node:crypto";
const h8=(s:string)=>createHash("sha256").update(s.toLowerCase()).digest("hex").slice(0,8);
var prevR:Map<string,{x:number,z:number,moved:number}>|null=null,recentDeps:number[]=[],waveSeq=0,waveOpenUntil=0,lastGapAt=0;
function rosterStep(d:any){const now=Date.now();const cur=new Map<string,{x:number,z:number,moved:number}>();for(const e of d.p??[]){const nm=String(e[1]);const x=e[2],z=e[3];const p=prevR?.get(nm);cur.set(nm,{x,z,moved:p&&p.x===x&&p.z===z?p.moved:now});}
if(prevR){const dep:string[]=[];const still:number[]=[];for(const [nm,v] of prevR){if(!cur.has(nm)){dep.push(nm);still.push(Math.round((now-v.moved)/1000));}}let arr=0;for(const nm of cur.keys())if(!prevR.has(nm))arr++;
for(let i=0;i<dep.length;i++)recentDeps.push(now);recentDeps=recentDeps.filter(t=>now-t<=60000);
for(let i=0;i<dep.length;i++){const hh=h8(dep[i]);if(WATCH.has(hh))console.log("WATCH left",iso(),"k="+d.k,"h="+hh,"still_s="+still[i],"burst="+dep.length);}for(const nm of cur.keys())if(!prevR.has(nm)){const hh=h8(nm);if(WATCH.has(hh))console.log("WATCH back",iso(),"k="+d.k,"h="+hh);}
if(dep.length>=10){const s=[...still].sort((a,b)=>a-b);const s60=still.filter(v=>v>=60).length;let base=0;for(const v of prevR.values())if(now-v.moved>=60000)base++;console.log("DEPART",iso(),"k="+d.k,"left="+dep.length,"arrived="+arr,"online="+cur.size,"still_min_s="+s[0],"still_p50_s="+s[Math.floor(s.length/2)],"still60="+s60+"/"+dep.length,"base_still60="+(base/prevR.size*100).toFixed(0)+"%","h="+dep.map(h8).join(","));}
if(recentDeps.length>=40&&now>waveOpenUntil){waveSeq++;waveOpenUntil=now+180000;console.log("WAVE "+waveSeq+" ",iso(),"left_60s="+recentDeps.length,"online="+cur.size,"feed_gap_last_120s="+(now-lastGapAt<120000?"yes":"no"));}}
prevR=cur;}
var WATCH=new Set((process.env.RS83_WATCH??"").split(",").map(s=>s.trim()).filter(Boolean));
var watchPresent=0;setInterval(()=>{if(!prevR)return;let c=0;for(const nm of prevR.keys())if(WATCH.has(h8(nm)))c++;if(c!==watchPresent){console.log("WATCH present",iso(),"n="+c);watchPresent=c;}},60000);
