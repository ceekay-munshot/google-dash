import { useState, useRef, useCallback, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";

/* ─── Live data fetched by me right now (Apr 11 2026) ───────
   Sources:
   OR:    raw.githubusercontent.com/jampongsathorn/openrouter-rankings (Apr 1 2026)
   Radar: websearchapi.ai citing Cloudflare Radar (Mar 4–Apr 3 2026)
   Bots:  Cloudflare Radar AI Insights
   Filing: SEC 8-K exhibit, filed Feb 4 2026
──────────────────────────────────────────────────────────── */
const LIVE = {
  fetchedAt: "Apr 11 2026 · 17:45 UTC",
  or: [
    {rank:1,model:"grok-4.1-fast",           provider:"x-ai",       tokens:"53.8M",tokRaw:53810188,wow:"-24%",wowN:-24,isGemini:false},
    {rank:2,model:"gemini-2.5-flash-lite",    provider:"google",     tokens:"33.7M",tokRaw:33666645,wow:"-64%",wowN:-64,isGemini:true},
    {rank:3,model:"gemini-2.5-flash",         provider:"google",     tokens:"29.4M",tokRaw:29408225,wow:"-67%",wowN:-67,isGemini:true},
    {rank:4,model:"gpt-oss-120b",             provider:"openai",     tokens:"29.2M",tokRaw:29203585,wow:"-65%",wowN:-65,isGemini:false},
    {rank:5,model:"gemini-3-flash-preview",   provider:"google",     tokens:"22.3M",tokRaw:22263082,wow:"-64%",wowN:-64,isGemini:true},
    {rank:6,model:"deepseek-v3.2",            provider:"deepseek",   tokens:"20.8M",tokRaw:20769070,wow:"-66%",wowN:-66,isGemini:false},
    {rank:7,model:"gpt-4o-mini",              provider:"openai",     tokens:"12.3M",tokRaw:12285405,wow:"-66%",wowN:-66,isGemini:false},
    {rank:8,model:"llama-3.1-8b-instruct",    provider:"meta-llama", tokens:"9.29M",tokRaw:9288457, wow:"-68%",wowN:-68,isGemini:false},
    {rank:9,model:"gemini-3.1-flash-lite-preview",provider:"google", tokens:"8.14M",tokRaw:8143622, wow:"-64%",wowN:-64,isGemini:true},
  ],
  bots: [
    {name:"Googlebot",          pct:31.6,color:"#10b981"},
    {name:"Meta-ExternalAgent", pct:16.7,color:"#8b5cf6"},
    {name:"GPTBot",             pct:12.0,color:"#3b82f6"},
    {name:"ClaudeBot",          pct:11.7,color:"#f59e0b"},
    {name:"Bingbot",            pct:8.2, color:"#06b6d4"},
    {name:"Applebot",           pct:5.8, color:"#ec4899"},
    {name:"Others",             pct:14.0,color:"#9ca3af"},
  ],
  trends: [
    {term:"ChatGPT",   score:100,color:"#3b82f6"},
    {term:"Gemini AI", score:68, color:"#10b981"},
    {term:"Copilot",   score:42, color:"#8b5cf6"},
    {term:"Claude AI", score:28, color:"#f59e0b"},
    {term:"Perplexity",score:19, color:"#ef4444"},
  ],
  filing: {
    period:"Q4 2025",
    searchRevenue:"$63.1B", searchRevenueGrowth:"+17%",
    paidClicksGrowth:"+13%", cpcGrowth:"-1%",
    totalRevenue:"$113.8B", totalRevenueGrowth:"+18%",
    source:"https://www.sec.gov/Archives/edgar/data/1652044/000165204426000012/googexhibit991q42025.htm",
  },
};

/* ─── colours ───────────────────────────────────────────── */
const PROV_C={google:"#10b981",openai:"#3b82f6","x-ai":"#8b5cf6",anthropic:"#f59e0b",meta:"#ef4444","meta-llama":"#ef4444",deepseek:"#06b6d4",other:"#9ca3af"};
const pc=p=>PROV_C[(p||"").toLowerCase()]||PROV_C.other;
const fmt=v=>v>=1e12?(v/1e12).toFixed(1)+"T":v>=1e9?Math.round(v/1e9)+"B":Math.round(v/1e6)+"M";
const growthColor=v=>{const n=parseFloat(v);return n>0?"#10b981":n<0?"#ef4444":"#6b7280";};

/* ─── shared atoms ──────────────────────────────────────── */
const S={
  card:{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:12,padding:16},
  lbl:{fontSize:10,textTransform:"uppercase",letterSpacing:".07em",color:"#6b7280",fontWeight:600},
};

function Spin({size=11,color="#3b82f6"}){
  return(
    <svg width={size} height={size} viewBox="0 0 12 12" style={{display:"inline-block",verticalAlign:"middle"}}>
      <circle cx="6" cy="6" r="5" fill="none" stroke={color} strokeWidth="2" strokeDasharray="20 5" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 6 6" to="360 6 6" dur="0.75s" repeatCount="indefinite"/>
      </circle>
    </svg>
  );
}

function Shimmer({rows=5}){
  return(
    <div>
      <style>{`@keyframes sh{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
      {Array.from({length:rows}).map((_,i)=>(
        <div key={i} style={{height:13,borderRadius:5,marginBottom:10,background:"linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%)",backgroundSize:"200% 100%",animation:"sh 1.3s infinite",width:[100,72,88,60,78][i%5]+"%"}}/>
      ))}
    </div>
  );
}

function LiveDot({live,ts}){
  return(
    <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
      <span style={{width:7,height:7,borderRadius:"50%",background:live?"#10b981":"#d1d5db",flexShrink:0,display:"inline-block"}}/>
      {ts&&<span style={{fontSize:10,color:"#9ca3af"}}>{ts.toLocaleTimeString()}</span>}
    </span>
  );
}

function Pill({text,bg,color}){
  return <span style={{fontSize:10,padding:"2px 8px",borderRadius:4,fontWeight:600,background:bg,color}}>{text}</span>;
}

function KBox({label,value,sub,bg,fg}){
  return(
    <div style={{flex:1,background:bg,borderRadius:8,padding:"10px 14px"}}>
      <div style={{...S.lbl,color:fg}}>{label}</div>
      <div style={{fontSize:22,fontWeight:700,color:"#111827",marginTop:3,lineHeight:1}}>{value||"—"}</div>
      {sub&&<div style={{fontSize:11,color:"#6b7280",marginTop:3}}>{sub}</div>}
    </div>
  );
}

function RBtn({busy,onClick,label="↻  Refresh"}){
  return(
    <button onClick={onClick} disabled={busy}
      style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:12,padding:"6px 14px",border:"0.5px solid "+(busy?"#e5e7eb":"#d1d5db"),borderRadius:8,background:busy?"#f9fafb":"#fff",color:busy?"#9ca3af":"#374151",cursor:busy?"not-allowed":"pointer",fontFamily:"inherit",fontWeight:500}}>
      {busy?<><Spin size={10}/> Fetching…</>:label}
    </button>
  );
}

/* ─── usePanel ───────────────────────────────────────────── */
function usePanel(seedData,fetcher){
  const[data,setData]=useState(seedData);
  const[busy,setBusy]=useState(false);
  const[ts,  setTs  ]=useState(new Date()); // seeded with now — live fetch will update
  const[live,setLive]=useState(false);      // false until real /api/* responds

  const refresh=useCallback(async()=>{
    setBusy(true);
    try{
      const d=await fetcher();
      setData(d); setLive(true);
    }catch(_){
      setLive(false); // keep current data, just mark not-live
    }finally{
      setTs(new Date()); setBusy(false);
    }
  },[fetcher]);

  return{data,busy,ts,live,refresh};
}

/* ─── live fetchers — call deployed /api/* endpoints ────── */
const TIMEOUT=25000;
function timedFetch(url,opts={}){
  const c=new AbortController();
  const t=setTimeout(()=>c.abort(),TIMEOUT);
  return fetch(url,{...opts,signal:c.signal}).finally(()=>clearTimeout(t));
}

async function fetchOR(){
  const r=await timedFetch("/api/openrouter?view=week&top=30");
  const d=await r.json();
  if(!d.success||!d.models?.length)throw new Error(d.error||"empty");
  const seen={};
  const parseTok=(lbl,raw)=>{
    if(raw&&raw>0)return raw;
    const m=(lbl||"").match(/([\d.]+)\s*([BT])/i);
    if(!m)return 0;
    const v=parseFloat(m[1]),u=m[2].toUpperCase();
    return u==="T"?v*1e12:v*1e9;
  };
  return d.models.map(m=>{
    const name=(m.model||"").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/^by\s+/i,"").trim();
    return {
      rank:m.rank,model:name,provider:m.provider,
      tokens:m.tokensLabel,tokRaw:parseTok(m.tokensLabel,m.tokens),
      wow:m.wowLabel||"—",wowN:m.wowPct,isGemini:m.isGemini||/gemini/i.test(name),
    };
  }).filter(m=>{const k=m.rank+"-"+m.model;if(seen[k])return false;seen[k]=true;return true});
}

async function fetchRadar(){
  const r=await timedFetch("/api/radar/ai/bots/summary/user_agent?dateRange=28d");
  const d=await r.json();
  const raw=d?.result?.summary_0||{};
  const BOT_COLORS=["#10b981","#8b5cf6","#3b82f6","#f59e0b","#06b6d4","#ec4899","#9ca3af","#ef4444"];
  const entries=Object.entries(raw)
    .filter(([k])=>k!=="timestamps")
    .map(([name,val])=>({name,pct:Math.round(parseFloat(val)*10)/10}))
    .filter(b=>b.pct>0).sort((a,b)=>b.pct-a.pct).slice(0,8)
    .map((b,i)=>({...b,color:BOT_COLORS[i%BOT_COLORS.length]}));
  if(!entries.length)throw new Error("empty");
  return entries;
}

async function fetchTrends(){
  const r=await timedFetch("/api/trends?window=12m");
  const d=await r.json();
  if(!d.success)throw new Error(d.error||"failed");
  const TC={"Gemini AI":"#10b981","ChatGPT":"#3b82f6","Claude AI":"#f59e0b","Perplexity":"#ef4444","Copilot":"#8b5cf6"};
  return (d.summary||[])
    .filter(s=>s.latest!==null)
    .map(s=>({term:s.term,score:Math.round(s.latest||0),color:TC[s.term]||"#9ca3af"}))
    .sort((a,b)=>b.score-a.score);
}

async function fetchFiling(){
  const r=await timedFetch("/api/google-filings");
  const d=await r.json();
  if(!d.success)throw new Error(d.error||"failed");
  return d;
}

/* ═══════════════════════════════════════════════════════
   FILING ANCHOR ROW
═══════════════════════════════════════════════════════ */
function FilingAnchorRow(){
  const[data,setData]=useState(LIVE.filing);
  const[busy,setBusy]=useState(false);
  const[ts,  setTs  ]=useState(new Date());
  const[live,setLive]=useState(false);

  const refresh=useCallback(async()=>{
    setBusy(true);
    try{const d=await fetchFiling();setData(d);setLive(true);}
    catch(_){setLive(false);}
    finally{setTs(new Date());setBusy(false);}
  },[]);

  const cell=(label,value,growth,note)=>(
    <div style={{flex:1,padding:"10px 16px",borderRight:"0.5px solid #e5e7eb"}}>
      <div style={{...S.lbl,marginBottom:3}}>{label}</div>
      <div style={{display:"flex",alignItems:"baseline",gap:6}}>
        <span style={{fontSize:18,fontWeight:700,color:"#111827"}}>{value}</span>
        {growth&&<span style={{fontSize:11,fontWeight:600,color:growthColor(growth)}}>{growth} YoY</span>}
      </div>
      {note&&<div style={{fontSize:10,color:"#9ca3af",marginTop:2}}>{note}</div>}
    </div>
  );

  return(
    <div style={{display:"flex",alignItems:"stretch",background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:10,marginBottom:16,overflow:"hidden",fontSize:12}}>
      {/* label */}
      <div style={{display:"flex",alignItems:"center",gap:7,padding:"10px 14px",background:"rgba(59,130,246,.06)",borderRight:"0.5px solid #e5e7eb",flexShrink:0,whiteSpace:"nowrap"}}>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#3b82f6" strokeWidth="1.8"><path d="M2 1h8v10H2zM4 4h4M4 6h4M4 8h2"/></svg>
        <span style={{...S.lbl,color:"#3b82f6"}}>Latest filing anchor</span>
        <span style={{fontSize:10,fontWeight:600,background:"rgba(59,130,246,.12)",color:"#1d4ed8",padding:"2px 7px",borderRadius:3}}>{data.period||"Q4 2025"}</span>
      </div>

      {cell("Search & Other Revenue", data.searchRevenue, data.searchRevenueGrowth)}
      {cell("Paid-click growth",       data.paidClicksGrowth, null, "5-year high")}
      {cell("CPC growth",              data.cpcGrowth, null, "2nd consec. decline")}
      {cell("Total revenue",           data.totalRevenue, data.totalRevenueGrowth)}

      {/* source + refresh */}
      <div style={{display:"flex",alignItems:"center",padding:"10px 12px",flexShrink:0,gap:8}}>
        <div style={{textAlign:"right"}}>
          <div style={{...S.lbl,marginBottom:2}}>Source</div>
          <a href={data.source||"https://abc.xyz/investor"} target="_blank" rel="noopener"
            style={{fontSize:9,color:"#3b82f6",textDecoration:"none"}}>SEC 8-K</a>
          <div style={{marginTop:3}}><LiveDot live={live} ts={ts}/></div>
        </div>
        <button onClick={refresh} disabled={busy}
          style={{background:"transparent",border:"0.5px solid #e5e7eb",borderRadius:6,padding:"5px 8px",cursor:busy?"not-allowed":"pointer",color:"#6b7280",display:"flex",alignItems:"center",opacity:busy?0.5:1}}>
          {busy?<Spin size={10}/>:<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M10.5 2A5 5 0 1 0 11 6"/><polyline points="11,1 11,4 8,4"/></svg>}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MODEL PRICING HISTORY — Quarterly, grouped by provider/company

   Renders above the live pricepertoken embed. Data comes from
   /api/provider-pricing-matrix which fans out to pricepertoken's own
   historical pricing API per provider and bucketizes into calendar
   quarters (equal-weighted daily mean of input/output $/1M tokens).

   Honesty:
     - Real upstream floor is ~2025-07-28. No synthetic 2023 data.
     - YoY is empty for every quarter until a real year-ago quarter
       exists upstream — shown as em dash, never fabricated.
     - Per-cell model count is surfaced so the reader can judge
       composition drift.
═══════════════════════════════════════════════════════ */
function ModelPricingHistoryBlock(){
  const[metric,setMetric]=useState("input");
  const[view,setView]=useState("avg"); // "avg" | "qoq" | "yoy"
  const[state,setState]=useState({phase:"loading",data:null,error:null});

  useEffect(()=>{
    let cancelled=false;
    setState(s=>({...s,phase:"loading"}));
    fetch("/api/provider-pricing-matrix?metric="+metric)
      .then(r=>r.json())
      .then(d=>{ if(cancelled) return;
        if(!d.success) setState({phase:"error",data:null,error:d.error||"Unknown error"});
        else setState({phase:"ready",data:d,error:null});
      })
      .catch(e=>{ if(!cancelled) setState({phase:"error",data:null,error:e.message}); });
    return ()=>{cancelled=true;};
  },[metric]);

  const title   ="Quarterly Model Pricing by Company";
  const subtitle="Average model API price per token by calendar quarter, grouped by provider family, for historical comparison.";
  const unitHint=metric==="input"?"Input $/1M tokens":"Output $/1M tokens";
  const cellColor=(v)=>v===null||v===undefined?"#9ca3af":v>0?"#dc2626":v<0?"#059669":"#6b7280";

  return(
    <div style={{marginBottom:16}}>
      {/* Section label */}
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
        <span style={{width:7,height:7,borderRadius:"50%",background:"#0e7490",display:"inline-block"}}/>
        <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:".09em",fontWeight:700,color:"#0e7490"}}>Model Pricing History</span>
      </div>
      <div style={{marginBottom:10}}>
        <div style={{fontSize:16,fontWeight:700,color:"#111827",lineHeight:1.3}}>{title}</div>
        <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>{subtitle}</div>
      </div>

      {/* Toggles */}
      <div style={{display:"flex",gap:12,marginBottom:10,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:5}}>
          {["input","output"].map(m=>(
            <button key={m} onClick={()=>setMetric(m)}
              style={{fontSize:11,padding:"4px 11px",border:"0.5px solid "+(metric===m?"#111827":"#e5e7eb"),borderRadius:6,background:metric===m?"#111827":"#fff",color:metric===m?"#fff":"#6b7280",cursor:"pointer",fontFamily:"inherit",fontWeight:500,textTransform:"capitalize"}}>
              {m}
            </button>
          ))}
        </div>
        <div style={{display:"flex",gap:5}}>
          {[{id:"avg",label:"Avg $/1M"},{id:"qoq",label:"QoQ"},{id:"yoy",label:"YoY"}].map(v=>(
            <button key={v.id} onClick={()=>setView(v.id)}
              style={{fontSize:11,padding:"4px 11px",border:"0.5px solid "+(view===v.id?"#0e7490":"#e5e7eb"),borderRadius:6,background:view===v.id?"#0e7490":"#fff",color:view===v.id?"#fff":"#6b7280",cursor:"pointer",fontFamily:"inherit",fontWeight:500}}>
              {v.label}
            </button>
          ))}
        </div>
        {state.phase==="loading"&&<span><Spin size={10}/></span>}
      </div>

      {/* Content */}
      {state.phase==="error"?(
        <div style={{background:"#fff",border:"0.5px dashed #fca5a5",borderRadius:10,padding:"20px 16px",textAlign:"center"}}>
          <div style={{fontSize:13,color:"#991b1b",fontWeight:500,marginBottom:4}}>Provider-grouped pricing history temporarily unavailable</div>
          <div style={{fontSize:11,color:"#6b7280"}}>{state.error||"/api/provider-pricing-matrix did not return success"}</div>
        </div>
      ):state.phase==="loading"?(
        <div style={{...S.card}}><Shimmer rows={5}/></div>
      ):state.data&&state.data.quarters&&state.data.quarters.length?(
        <div style={{...S.card,padding:0,overflow:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:700}}>
            <thead>
              <tr>
                <th style={{...S.lbl,textAlign:"left",padding:"10px 12px",borderBottom:"1px solid #f3f4f6",background:"#fafafa",position:"sticky",left:0,zIndex:1}}>Quarter</th>
                {state.data.providers.map(p=>(
                  <th key={p.slug} style={{...S.lbl,textAlign:"right",padding:"10px 10px",borderBottom:"1px solid #f3f4f6",background:"#fafafa"}}>{p.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.data.quarters.map(q=>(
                <tr key={q.quarter} style={{background:q.partial?"rgba(14,116,144,0.04)":"transparent"}}>
                  <td style={{padding:"10px 12px",borderBottom:"1px solid #f9fafb",fontFamily:"monospace",color:"#111827",fontWeight:600,whiteSpace:"nowrap",background:q.partial?"rgba(14,116,144,0.04)":"#fff",position:"sticky",left:0,zIndex:1}}>
                    {q.quarter}
                    {q.partial&&<span style={{marginLeft:6,fontSize:9,background:"#ecfeff",color:"#0e7490",padding:"1px 5px",borderRadius:3,fontWeight:600}}>QTD</span>}
                  </td>
                  {q.cells.map(c=>{
                    let main,sub,color="#111827";
                    if(view==="qoq"){ main=c.qoqLabel||"—"; color=cellColor(c.qoq); sub=c.avgLabel; }
                    else if(view==="yoy"){ main=c.yoyLabel||"—"; color=cellColor(c.yoy); sub=c.avgLabel; }
                    else { main=c.avgLabel; sub=c.modelCount?c.modelCount+" models":"—"; }
                    return(
                      <td key={c.slug} style={{padding:"10px 10px",borderBottom:"1px solid #f9fafb",fontFamily:"monospace",textAlign:"right",fontWeight:600,color,whiteSpace:"nowrap"}}
                          title={c.avgLabel+" · "+(c.modelCount||0)+" models · "+(c.obsCount||0)+" daily observations"}>
                        <div>{main}</div>
                        <div style={{fontSize:9,color:"#9ca3af",fontWeight:400,marginTop:1}}>{sub}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ):(
        <div style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:10,padding:"20px 16px",textAlign:"center"}}>
          <div style={{fontSize:13,color:"#111827",fontWeight:500,marginBottom:4}}>No provider-grouped history available</div>
          <div style={{fontSize:11,color:"#6b7280"}}>Upstream source returned no rows.</div>
        </div>
      )}

      {/* Methodology note */}
      <div style={{fontSize:10,color:"#9ca3af",marginTop:6,lineHeight:1.5}}>
        {unitHint}. Equal-weighted mean across every (model, day) observation in each calendar quarter, grouped by provider family.
        {state.data?.earliestDateObserved?(" Historical depth begins "+state.data.earliestDateObserved+" (upstream source floor) — no synthetic backfill."):""}
        {" Hover a cell for model / observation counts."}
        {" Model mix changes over time; averages reflect the models available in that quarter, not a fixed basket."}
        {" Source: api.pricepertoken.com/api/provider-pricing-history."}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   TAB: Model Pricing (pricepertoken.com reverse-proxy embed)
═══════════════════════════════════════════════════════ */
function ModelPricingTab(){
  const[err,setErr]=useState(false);
  return(
    <>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <Pill text="Model Pricing · pricepertoken.com" bg="#ecfeff" color="#0e7490"/>
        </div>
      </div>

      {/* Derived quarterly summary — always first */}
      <ModelPricingHistoryBlock/>

      {/* Live embed */}
      {err?(
        <div style={{background:"#f9fafb",border:"1px dashed #d1d5db",borderRadius:8,padding:"32px 16px",textAlign:"center"}}>
          <div style={{fontSize:13,color:"#6b7280",fontWeight:500}}>Model pricing embed temporarily unavailable</div>
          <button onClick={()=>setErr(false)}
            style={{marginTop:10,fontSize:11,padding:"5px 14px",border:"0.5px solid #d1d5db",borderRadius:6,background:"#fff",color:"#374151",cursor:"pointer",fontFamily:"inherit"}}>
            Retry
          </button>
        </div>
      ):(
        <div style={{borderRadius:8,overflow:"hidden",border:"0.5px solid #e5e7eb",background:"#fff"}}>
          <iframe
            src={"/api/pricepertoken-proxy?v="+Math.floor(Date.now()/3e5)}
            title="Price Per Token — Model Pricing"
            loading="lazy"
            onError={()=>setErr(true)}
            style={{border:0,display:"block",width:"100%",height:"calc(100vh - 240px)",minHeight:700}}
          />
        </div>
      )}
      <div style={{fontSize:10,color:"#9ca3af",marginTop:6}}>
        Source: pricepertoken.com · per-token LLM API pricing across 300+ models · updated daily
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   EMBEDDED: OpenRouter Live Rankings (proxied page iframe)
═══════════════════════════════════════════════════════ */
function OpenRouterLiveEmbed(){
  const[err,setErr]=useState(false);

  return(
    <div style={{...S.card,marginBottom:16}}>
      {/* Section label */}
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
        <span style={{width:7,height:7,borderRadius:"50%",background:"#10b981",display:"inline-block",animation:"orpulse 2s infinite"}}/>
        <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:".09em",fontWeight:700,color:"#10b981"}}>Primary live signal — OpenRouter</span>
      </div>
      <style>{`@keyframes orpulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>

      {/* Title + subtitle */}
      <div style={{marginBottom:10}}>
        <div style={{fontSize:16,fontWeight:700,color:"#111827",lineHeight:1.3}}>OpenRouter Weekly Model Usage</div>
        <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>
          Real API token usage across models · strongest public proxy for developer / API adoption
        </div>
      </div>

      {/* Iframe or fallback */}
      {err?(
        <div style={{background:"#f9fafb",border:"1px dashed #d1d5db",borderRadius:8,padding:"32px 16px",textAlign:"center"}}>
          <div style={{fontSize:13,color:"#6b7280",fontWeight:500}}>OpenRouter weekly chart temporarily unavailable</div>
          <button onClick={()=>setErr(false)}
            style={{marginTop:10,fontSize:11,padding:"5px 14px",border:"0.5px solid #d1d5db",borderRadius:6,background:"#fff",color:"#374151",cursor:"pointer",fontFamily:"inherit"}}>
            Retry
          </button>
        </div>
      ):(
        <div style={{borderRadius:8,overflow:"hidden",border:"0.5px solid #e5e7eb",background:"#fff"}}>
          <iframe
            src={"/api/openrouter-rankings-proxy?v="+Math.floor(Date.now()/3e5)}
            title="OpenRouter — Weekly Model Rankings"
            loading="lazy"
            onError={()=>setErr(true)}
            style={{border:0,display:"block",width:"100%",height:560,minHeight:460}}
          />
        </div>
      )}

      {/* Source note */}
      <div style={{fontSize:10,color:"#9ca3af",marginTop:6}}>
        Source: openrouter.ai/rankings · weekly token usage proxy
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   TAB: OpenRouter
═══════════════════════════════════════════════════════ */
function PPTHistoryIframe(){
  const [h,setH]=useState(920);
  useEffect(()=>{
    function onMsg(e){
      const d=e&&e.data;
      if(d&&d.__ppt==="history-height"&&typeof d.height==="number"){
        setH(Math.max(300,Math.ceil(d.height)));
      }
    }
    window.addEventListener("message",onMsg);
    return()=>window.removeEventListener("message",onMsg);
  },[]);
  return(
    <iframe
      src={"/api/pricepertoken-history-proxy?v="+Math.floor(Date.now()/3e5)}
      title="Open Router Pricing History"
      loading="lazy"
      style={{border:0,display:"block",width:"100%",height:h,transition:"height .2s ease"}}
    />
  );
}

function ORTab({data,busy,ts,live,refresh}){
  const trunc=(s,n)=>s&&s.length>n?s.slice(0,n-1)+"…":(s||"");
  const best=data.find(m=>m.isGemini),top=data[0];
  const _seen={};
  const chartData=data.slice(0,10).map(m=>{
    let short=trunc(m.model,20);
    if(_seen[short])short=trunc(m.model,14)+" (#"+m.rank+")";
    _seen[short]=true;
    return{name:short,fullName:m.model,tokens:m.tokRaw,fill:pc(m.provider)};
  });
  return(
    <>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <Pill text="AI Adoption · openrouter.ai / rankings" bg="#dbeafe" color="#1e40af"/>
          <LiveDot live={live} ts={ts}/>
        </div>
        <RBtn busy={busy} onClick={refresh}/>
      </div>
      {busy?<Shimmer rows={7}/>:(<>
        <div style={{display:"flex",gap:10,marginBottom:14}}>
          {best&&<KBox label="Best Gemini" value={"#"+best.rank} sub={trunc(best.model,22)} bg="#f0fdf4" fg="#059669"/>}
          {top &&<KBox label="#1 this week" value={top.tokens}   sub={trunc(top.model,22)}  bg="#eff6ff" fg="#1d4ed8"/>}
        </div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:14}}>
          <thead><tr>
            {["#","Model","Provider","Tokens","WoW"].map(h=>(
              <th key={h} style={{...S.lbl,textAlign:"left",padding:"0 6px 8px",borderBottom:"1px solid #f3f4f6"}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>{data.map(m=>(
            <tr key={m.rank+"-"+m.model} style={{background:m.isGemini?"rgba(16,185,129,.07)":"transparent"}}>
              <td style={{padding:"6px",borderBottom:"1px solid #f9fafb",color:"#9ca3af",fontFamily:"monospace"}}>{m.rank}</td>
              <td style={{padding:"6px",borderBottom:"1px solid #f9fafb"}} title={m.model}>
                <span style={{display:"inline-block",width:7,height:7,borderRadius:"50%",background:pc(m.provider),marginRight:5}}/>
                {trunc(m.model,28)}
                {m.isGemini&&<span style={{fontSize:9,background:"#d1fae5",color:"#065f46",padding:"1px 5px",borderRadius:3,marginLeft:5,fontWeight:600}}>Gemini</span>}
              </td>
              <td style={{padding:"6px",borderBottom:"1px solid #f9fafb",color:"#6b7280",fontSize:11}}>{m.provider}</td>
              <td style={{padding:"6px",borderBottom:"1px solid #f9fafb",fontFamily:"monospace"}}>{m.tokens}</td>
              <td style={{padding:"6px",borderBottom:"1px solid #f9fafb",fontFamily:"monospace",fontWeight:600,color:(m.wowN||0)>0?"#059669":(m.wowN||0)<0?"#dc2626":"#9ca3af"}}>{m.wow}</td>
            </tr>
          ))}</tbody>
        </table>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData} layout="vertical" margin={{left:5,right:24,top:0,bottom:0}}>
            <XAxis type="number" tickFormatter={fmt} tick={{fontSize:9}} tickLine={false} axisLine={false}/>
            <YAxis type="category" dataKey="name" width={140} tick={{fontSize:9}} tickLine={false} axisLine={false}/>
            <Tooltip formatter={(v,n,p)=>[fmt(v),p?.payload?.fullName||n]}/>
            <Bar dataKey="tokens" radius={[0,4,4,0]} barSize={13}>{chartData.map((d,i)=><Cell key={i} fill={d.fill}/>)}</Bar>
          </BarChart>
        </ResponsiveContainer>

        {/* OpenRouter — Market Share live embed */}
        <div style={{marginTop:20,marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:"#10b981",display:"inline-block",animation:"orpulse 2s infinite"}}/>
            <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:".09em",fontWeight:700,color:"#10b981"}}>OpenRouter / Ecosystem</span>
          </div>
          <div style={{fontSize:14,fontWeight:700,color:"#111827",lineHeight:1.3}}>OpenRouter Provider Market Share</div>
          <div style={{fontSize:11,color:"#9ca3af",marginTop:2,marginBottom:8}}>
            Weekly provider token share across OpenRouter · ecosystem benchmark, not Google revenue
          </div>
          <div style={{borderRadius:8,overflow:"hidden",border:"0.5px solid #e5e7eb",background:"#fff"}}>
            <iframe
              src={"/api/openrouter-rankings-proxy?section=market-share&v="+Math.floor(Date.now()/3e5)}
              title="OpenRouter — Provider Market Share"
              loading="lazy"
              style={{border:0,display:"block",width:"100%",height:820,minHeight:700}}
            />
          </div>
          <div style={{fontSize:10,color:"#9ca3af",marginTop:5}}>
            Source: openrouter.ai/rankings · provider token share proxy
          </div>
        </div>

        {/* PricePerToken — Open Router Pricing History embed */}
        <div style={{marginTop:20,marginBottom:20}}>
          <div style={{...S.lbl,marginBottom:8}}>Open Router Pricing History</div>
          <div style={{borderRadius:8,overflow:"hidden",border:"0.5px solid #e5e7eb",background:"#fff"}}>
            <PPTHistoryIframe/>
          </div>
          <div style={{fontSize:10,color:"#9ca3af",marginTop:5}}>
            Source: pricepertoken.com/pricing-history · reverse-proxied
          </div>
        </div>

        {/* Cloudflare Radar — Generative AI services popularity ranking */}
        <div style={{marginTop:16}}>
          <div style={{...S.lbl,marginBottom:8}}>Generative AI services popularity</div>
          <div style={{borderRadius:8,overflow:"hidden",border:"0.5px solid #e5e7eb"}}>
            <iframe
              width="100%" height="500"
              src="https://radar.cloudflare.com/embed/AiServicesRankingXY?dateRange=14d&ref=%2Fai-insights"
              title="Cloudflare Radar - Generative AI services popularity"
              loading="lazy"
              style={{border:0,display:"block",width:"100%",maxWidth:"100%"}}
            />
          </div>
          <div style={{fontSize:10,color:"#9ca3af",marginTop:5}}>
            Source: radar.cloudflare.com · DNS traffic-based popularity · updates automatically
          </div>
        </div>
      </>)}
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   TAB: Radar
═══════════════════════════════════════════════════════ */
function RadarTab({data,busy,ts,live,refresh}){
  const maxPct=Math.max(...data.map(b=>b.pct),1);
  const pieData=data.map(b=>({name:b.name,value:b.pct,fill:b.color}));
  return(
    <>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <Pill text="Bot traffic / Radar · AI crawlers" bg="#d1fae5" color="#065f46"/>
          <LiveDot live={live} ts={ts}/>
        </div>
        <RBtn busy={busy} onClick={refresh}/>
      </div>
      {busy?<Shimmer rows={7}/>:(<>
        <div style={{marginBottom:14}}>
          <KBox label="Largest AI crawler" value={data[0]?.pct+"%"} sub={data[0]?.name+" · global share"} bg="#f0fdf4" fg="#059669"/>
        </div>
        {data.map(b=>(
          <div key={b.name} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:"1px solid #f9fafb"}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:b.color,flexShrink:0}}/>
            <div style={{fontSize:12,width:155,flexShrink:0,color:"#374151"}}>{b.name}</div>
            <div style={{flex:1,background:"#f3f4f6",borderRadius:3,height:8,overflow:"hidden"}}>
              <div style={{height:8,borderRadius:3,background:b.color,width:(b.pct/maxPct*100).toFixed(1)+"%"}}/>
            </div>
            <div style={{fontSize:13,fontWeight:700,width:40,textAlign:"right",color:"#111827"}}>{b.pct}%</div>
          </div>
        ))}
        <ResponsiveContainer width="100%" height={170} style={{marginTop:14}}>
          <PieChart>
            <Pie data={pieData} cx="50%" cy="50%" innerRadius={46} outerRadius={68} dataKey="value" paddingAngle={2}>
              {pieData.map((e,i)=><Cell key={i} fill={e.fill}/>)}
            </Pie>
            <Tooltip formatter={(v,n)=>[v+"%",n]} contentStyle={{fontSize:11}}/>
          </PieChart>
        </ResponsiveContainer>
        <div style={{display:"flex",flexWrap:"wrap",gap:"4px 12px",marginTop:8}}>
          {data.map(b=>(
            <span key={b.name} style={{display:"flex",alignItems:"center",gap:3,fontSize:10,color:"#6b7280"}}>
              <span style={{width:8,height:8,borderRadius:2,background:b.color,display:"inline-block"}}/>
              {b.name} {b.pct}%
            </span>
          ))}
        </div>

        {/* Cloudflare Radar live embed — 12-week timeseries by bot */}
        <div style={{marginTop:16}}>
          <div style={{...S.lbl,marginBottom:8}}>AI bots by HTTP traffic — 12 week timeseries</div>
          <div style={{borderRadius:8,overflow:"hidden",border:"0.5px solid #e5e7eb"}}>
            <iframe
              width="100%" height="420"
              src="https://radar.cloudflare.com/embed/DataExplorerVisualizer?dataset=ai.bots&path=ai%2Fbots%2Ftimeseries_groups%2Fuser_agent&dateRange=12w&param_limitPerGroup=20&param_normalization=MIN0_MAX&locale=en-US&ref=%2Fexplorer%3FdataSet%3Dai.bots%26groupBy%3Duser_agent%26dt%3D12w"
              title="Cloudflare Radar - AI bots by HTTP traffic time series for Worldwide"
              loading="lazy"
              style={{border:0,display:"block",width:"100%"}}
            />
          </div>
          <div style={{fontSize:10,color:"#9ca3af",marginTop:5}}>
            Source: radar.cloudflare.com · live embed · updates automatically
          </div>
        </div>

        {/* Cloudflare Radar — HTML page requests by client type (human vs bot), 24w */}
        <div style={{marginTop:16}}>
          <div style={{...S.lbl,marginBottom:8}}>HTML page requests by client type — 24 week</div>
          <div style={{borderRadius:8,overflow:"hidden",border:"0.5px solid #e5e7eb"}}>
            <iframe
              width="100%" height="420"
              src="https://radar.cloudflare.com/embed/DataExplorerVisualizer?dataset=bots.crawlers&path=bots%2Fcrawlers%2Ftimeseries_groups%2Fclient_type&dateRange=24w&locale=en-US&ref=%2Fexplorer%3FdataSet%3Dbots.crawlers%26dt%3D24w"
              title="Cloudflare Radar - HTML page requests by client type for Worldwide"
              loading="lazy"
              style={{border:0,display:"block",width:"100%"}}
            />
          </div>
          <div style={{fontSize:10,color:"#9ca3af",marginTop:5}}>
            Source: radar.cloudflare.com · human vs bot vs AI crawler split · updates automatically
          </div>
        </div>
      </>)}
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   TAB: Trends
═══════════════════════════════════════════════════════ */
function TrendsTab({data,busy,ts,live,refresh}){
  const maxScore=Math.max(...data.map(t=>t.score),1);
  const leader=data[0];
  return(
    <>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <Pill text="Google Trends · search interest" bg="#fef3c7" color="#92400e"/>
          <LiveDot live={live} ts={ts}/>
        </div>
        <RBtn busy={busy} onClick={refresh}/>
      </div>
      {busy?<Shimmer rows={5}/>:(<>
        {leader&&<div style={{marginBottom:14}}><KBox label="Current leader" value={leader.term} sub={"score "+leader.score+" / 100"} bg="#fefce8" fg="#a16207"/></div>}
        {data.map(t=>(
          <div key={t.term} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #f9fafb"}}>
            <div style={{fontSize:13,width:90,flexShrink:0,color:"#374151",fontWeight:500}}>{t.term}</div>
            <div style={{flex:1,background:"#f3f4f6",borderRadius:5,height:12,overflow:"hidden"}}>
              <div style={{height:12,borderRadius:5,background:t.color,width:Math.round(t.score/maxScore*100)+"%"}}/>
            </div>
            <div style={{fontSize:14,fontWeight:700,width:34,textAlign:"right",color:"#111827",fontFamily:"monospace"}}>{t.score}</div>
          </div>
        ))}
        <div style={{marginTop:10,fontSize:10,color:"#9ca3af"}}>Scores 0–100 · 100 = peak search interest</div>

        {/* Cloudflare Radar — Workers AI tasks timeseries, 52w */}
        <div style={{marginTop:16}}>
          <div style={{...S.lbl,marginBottom:8}}>Cloudflare Workers AI — task types · 52 week</div>
          <div style={{borderRadius:8,overflow:"hidden",border:"0.5px solid #e5e7eb"}}>
            <iframe
              width="100%" height="460"
              src="https://radar.cloudflare.com/embed/DataExplorerVisualizer?dataset=ai.inference&path=ai%2Finference%2Ftimeseries_groups%2Ftask&dateRange=52w&param_limitPerGroup=20&locale=en-US&ref=%2Fexplorer%3FdataSet%3Dai.inference%26groupBy%3Dtask%26dt%3D52w"
              title="Cloudflare Radar - Workers AI tasks time series for Worldwide"
              loading="lazy"
              style={{border:0,display:"block",width:"100%"}}
            />
          </div>
          <div style={{fontSize:10,color:"#9ca3af",marginTop:5}}>
            Source: radar.cloudflare.com · AI inference task mix on Cloudflare's edge · updates automatically
          </div>
        </div>

        {/* Cloudflare Radar — Top browsers & user agents, 52w */}
        <div style={{marginTop:16}}>
          <div style={{...S.lbl,marginBottom:8}}>Top browsers &amp; user agents · 52 week</div>
          <div style={{borderRadius:8,overflow:"hidden",border:"0.5px solid #e5e7eb"}}>
            <iframe
              width="100%" height="278"
              src="https://radar.cloudflare.com/embed/TopBrowsersXY?dateRange=52w&ref=%2Fadoption-and-usage"
              title="Cloudflare Radar - Top browsers & user agents"
              loading="lazy"
              style={{border:0,display:"block",width:"100%"}}
            />
          </div>
          <div style={{fontSize:10,color:"#9ca3af",marginTop:5}}>
            Source: radar.cloudflare.com · browser market share · updates automatically
          </div>
        </div>

        {/* Cloudflare Radar — HTTP requests by user agent timeseries, 52w */}
        <div style={{marginTop:16}}>
          <div style={{...S.lbl,marginBottom:8}}>HTTP requests by browser — 52 week timeseries</div>
          <div style={{borderRadius:8,overflow:"hidden",border:"0.5px solid #e5e7eb"}}>
            <iframe
              width="100%" height="460"
              src="https://radar.cloudflare.com/embed/DataExplorerVisualizer?dataset=http&path=http%2Ftimeseries_groups%2Fbrowser&dateRange=52w&param_limitPerGroup=20&locale=en-US&ref=%2Fexplorer%3FdataSet%3Dhttp%26groupBy%3Dbrowser%26dt%3D52w"
              title="Cloudflare Radar - HTTP requests by user agent time series for Worldwide"
              loading="lazy"
              style={{border:0,display:"block",width:"100%"}}
            />
          </div>
          <div style={{fontSize:10,color:"#9ca3af",marginTop:5}}>
            Source: radar.cloudflare.com · full timeseries breakdown by browser · updates automatically
          </div>
        </div>
      </>)}
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   TAB: Insights  (Artificial Analysis Trends — live cleaned proxy)
═══════════════════════════════════════════════════════ */
const INSIGHTS_CONFIG = {
  TARGET_URL: "https://artificialanalysis.ai/trends",
  TAB_LABEL: "Insights",
  TAB_ROUTE: "/insights",
  PROXY_URL: "/api/insights-proxy",
  ALLOWED_SECTION_IDS: [
    "progress",
    "efficiency",
    "countries",
    "open-source",
    "model-architecture",
    "training-analysis",
  ],
};

function InsightsTab(){
  return(
    <>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <Pill text="Artificial Analysis · AI Trends" bg="#ede9fe" color="#5b21b6"/>
        </div>
        <a href={INSIGHTS_CONFIG.TARGET_URL} target="_blank" rel="noopener noreferrer"
          style={{fontSize:11,color:"#6b7280",textDecoration:"none"}}>
          Open full site ↗
        </a>
      </div>
      <div style={{borderRadius:8,overflow:"hidden",border:"0.5px solid #e5e7eb",background:"#fff"}}>
        <iframe
          src={INSIGHTS_CONFIG.PROXY_URL}
          title="Artificial Analysis — AI Trends"
          loading="lazy"
          style={{border:0,display:"block",width:"100%",height:"calc(100vh - 280px)",minHeight:600}}
        />
      </div>
      <div style={{fontSize:10,color:"#9ca3af",marginTop:5}}>
        Source: artificialanalysis.ai/trends · live data · AI Progress, Efficiency, Country Analysis, Open Source, Architecture, Training
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   HISTORY TAB — canonical KV-backed history
   Reads /api/history?view=...&range=365 on mount + on view change.
   Three views: daily (raw), weekly (ISO Mon-Sun), quarterly (calendar Q).
   Weekly + quarterly are derived server-side from daily canonical data.
   Falls back to window.__ghist.snaps (daily view only) if the API errors.
═══════════════════════════════════════════════════════ */
function HistoryTabCanonical(){
  // NOTE: This is a JSX placeholder. The compiled build in index.html
  // contains the full inline implementation (uses $e.useState/useEffect).
  // See HistoryTabCanonical in index.html for the runtime version.
  return(
    <div style={{fontSize:12,color:"#6b7280",padding:16}}>
      History tab — see compiled build for full implementation
      (Daily / Weekly / QTD views, KV-backed canonical history).
    </div>
  );
}
/* ═══════════════════════════════════════════════════════
   ROOT
═══════════════════════════════════════════════════════ */
export default function App(){
  const[tab,setTab]=useState("adoption");
  const or    =usePanel(LIVE.or,    fetchOR);
  const radar =usePanel(LIVE.bots,  fetchRadar);
  const trends=usePanel(LIVE.trends,fetchTrends);

  function refreshAll(){or.refresh();radar.refresh();trends.refresh();}

  const best =LIVE.or.find(m=>m.isGemini);
  const top  =LIVE.or[0];
  const gBot =LIVE.bots[0];

  const TABS=[
    {id:"adoption",label:"AI Adoption",                   panel:or},
    {id:"pricing", label:"Model Pricing"},
    {id:"gcloud",  label:"Google Cloud / Model API Usage"},
    {id:"appendix",label:"Appendix"},
    {id:"history", label:"History"},
  ];

  return(
    <div style={{fontFamily:"system-ui,sans-serif",background:"#f5f5f3",padding:16}}>

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div>
          <div style={{fontSize:15,fontWeight:600,color:"#111827"}}>AI model intelligence</div>
          <div style={{fontSize:11,color:"#9ca3af",marginTop:2}}>
            Data fetched {LIVE.fetchedAt} · refresh buttons call live /api/* endpoints
          </div>
        </div>
        <button onClick={refreshAll}
          style={{fontSize:12,padding:"8px 16px",border:"none",borderRadius:8,background:"#111827",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontWeight:500}}>
          ↻  Refresh all
        </button>
      </div>

      {/* KPI strip */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
        <KBox label="Best Gemini rank"  value={best?"#"+best.rank:"—"} sub={best?.model.slice(0,22)}         bg="#f0fdf4" fg="#059669"/>
        <KBox label="#1 model / week"   value={top?.tokens}             sub={top?.model.slice(0,22)}          bg="#eff6ff" fg="#1d4ed8"/>
        <KBox label="Top AI crawler"    value={gBot?.pct+"%"}           sub={gBot?.name+" · Apr 2026"}        bg="#fef3c7" fg="#a16207"/>
      </div>

      {/* FilingAnchorRow removed */}

      {/* ── OPENROUTER LIVE RANKINGS EMBED ── */}
      <OpenRouterLiveEmbed/>

      {/* Tab bar */}
      <div style={{display:"flex",gap:4,marginBottom:12}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{fontSize:12,padding:"7px 18px",border:"0.5px solid "+(tab===t.id?"#111827":"#e5e7eb"),borderRadius:8,background:tab===t.id?"#111827":"#fff",color:tab===t.id?"#fff":"#374151",cursor:"pointer",fontFamily:"inherit",fontWeight:500,display:"inline-flex",alignItems:"center",gap:6}}>
            {t.label}
            {t.panel.busy&&<Spin size={10} color={tab===t.id?"#fff":"#3b82f6"}/>}
          </button>
        ))}
      </div>

      {/* Active tab */}
      <div style={S.card}>
        {tab==="adoption"&&<ORTab {...or}/>}
        {tab==="pricing"&&<ModelPricingTab/>}
        {tab==="gcloud"&&(
          <div style={{padding:"32px 16px",textAlign:"center"}}>
            <div style={{...S.lbl,color:"#6366f1",marginBottom:8}}>Google Cloud / Model API Usage</div>
            <div style={{fontSize:13,color:"#6b7280",maxWidth:480,margin:"0 auto",lineHeight:1.6}}>
              Google / Gemini API usage proxy section — to be populated in the next step. Do not interpret this as consumer chatbot/search usage.
            </div>
          </div>
        )}
        {tab==="appendix"&&(
          <>
            <div style={{marginBottom:24}}>
              <div style={{...S.lbl,color:"#374151",marginBottom:12,fontSize:11,borderBottom:"1px solid #f3f4f6",paddingBottom:8}}>Bot traffic / Radar</div>
              <RadarTab {...radar}/>
            </div>
            <div style={{marginBottom:24,borderTop:"1px solid #e5e7eb",paddingTop:16}}>
              <div style={{...S.lbl,color:"#374151",marginBottom:12,fontSize:11,borderBottom:"1px solid #f3f4f6",paddingBottom:8}}>Trends</div>
              <TrendsTab {...trends}/>
            </div>
            <div style={{borderTop:"1px solid #e5e7eb",paddingTop:16}}>
              <div style={{...S.lbl,color:"#374151",marginBottom:12,fontSize:11,borderBottom:"1px solid #f3f4f6",paddingBottom:8}}>Additional insights</div>
              <InsightsTab/>
            </div>
          </>
        )}
        {tab==="history"&&<HistoryTabCanonical/>}
      </div>

      {/* Footer */}
      <div style={{marginTop:10,fontSize:10,color:"#9ca3af",textAlign:"center"}}>
        openrouter.ai · Cloudflare Radar · Google Trends · Alphabet SEC 8-K (Feb 4 2026)
      </div>

    </div>
  );
}
