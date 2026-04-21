import { useState, useRef, useCallback, useEffect } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, CartesianGrid, Legend } from "recharts";

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

/* Partial-mode render: used when KV share history hasn't yet crossed a
   quarter boundary, so shareQoqPP is null everywhere. We pivot the Y axis
   from "share QoQ (pp)" to "current share (%)" — still useful because the
   reader can see which providers moved price AND where they sit in share
   rank right now. Disappears automatically once a prior-quarter snapshot
   exists in KV and the main block is renderable again. */
function PricingSharePartialView({ header, quarter }){
  const rows=(quarter.rows||[]).filter(r=>typeof r.priceQoq==="number"&&typeof r.shareAvg==="number");
  const W=520,H=360,pL=44,pR=18,pT=22,pB=32;
  const xMax=Math.max(5,...rows.map(r=>Math.abs(r.priceQoq*100)))*1.15;
  const yMax=Math.max(5,...rows.map(r=>r.shareAvg))*1.12;
  const sx=(v)=>pL+((v+xMax)/(2*xMax))*(W-pL-pR);
  const sy=(v)=>H-pB-(v/yMax)*(H-pT-pB);
  const x0=sx(0);

  // Dot color: bias by price direction only (no share-QoQ regime available)
  const dotColor=(pq)=>pq<=-0.02?"#2563eb":pq>=0.02?"#dc2626":"#6b7280";

  // Smart label placement (flip + vertical stacking) — same logic as full view
  const dotData=rows.map(r=>({
    slug:r.slug,label:r.label,color:dotColor(r.priceQoq),
    x:sx(r.priceQoq*100),y:sy(r.shareAvg),
  }));
  const placed=[];
  [...dotData].sort((a,b)=>a.y-b.y).forEach(d=>{
    const flipLeft=d.x>W*0.6;
    const lAnchor=flipLeft?"end":"start";
    const lx=flipLeft?d.x-7:d.x+7;
    const lw=Math.max(36,d.label.length*5.8);
    let dy=3;
    for(let i=0;i<6;i++){
      const ly=d.y+dy;
      const collides=placed.some(p=>{
        if(Math.abs(p.ly-ly)>11) return false;
        const pLe=p.lAnchor==="end"?p.lx-p.lw:p.lx;
        const pRi=p.lAnchor==="end"?p.lx:p.lx+p.lw;
        const dLe=flipLeft?lx-lw:lx;
        const dRi=flipLeft?lx:lx+lw;
        return !(dRi<pLe-3||dLe>pRi+3);
      });
      if(!collides) break;
      dy+=12;
    }
    placed.push({...d,lx,ly:d.y+dy,lAnchor,lw});
  });

  // Sort table by current share descending so the dominant provider reads first
  const tableRows=[...rows].sort((a,b)=>b.shareAvg-a.shareAvg);
  const biggestCut=[...rows].filter(r=>r.priceQoq<0).sort((a,b)=>a.priceQoq-b.priceQoq)[0];
  const biggestUp=[...rows].filter(r=>r.priceQoq>0).sort((a,b)=>b.priceQoq-a.priceQoq)[0];
  const topShare=[...rows].sort((a,b)=>b.shareAvg-a.shareAvg)[0];

  return(
    <div style={{marginBottom:16}}>
      {header}
      <div style={{fontSize:11,color:"#6b7280",marginBottom:8}}>
        Quarter: <b style={{color:"#111827",fontFamily:"monospace"}}>{quarter.quarter}</b>
        {quarter.partial&&<span style={{marginLeft:5,fontSize:9,background:"#ecfeff",color:"#0e7490",padding:"1px 5px",borderRadius:3,fontWeight:600}}>QTD</span>}
        <span style={{color:"#9ca3af"}}> · {rows.length} providers · partial view</span>
      </div>
      {/* Explanation banner */}
      <div style={{background:"#fffbeb",border:"0.5px solid #fde68a",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:11,color:"#78350f",lineHeight:1.45}}>
        <b>Share QoQ pending.</b> Prior-quarter KV snapshots not yet captured, so share-delta can't be computed. Showing Price QoQ vs <i>current</i> share % instead — full view returns automatically once the next quarter of snapshots lands.
      </div>
      {/* Callouts limited to what's computable from a single quarter */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:8,marginBottom:12}}>
        {biggestCut&&<div style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:8,padding:"8px 10px"}}>
          <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:".07em",fontWeight:700,color:"#7c3aed"}}>Biggest price cut</div>
          <div style={{fontSize:13,fontWeight:700,color:"#111827",marginTop:2}}>{biggestCut.label}</div>
          <div style={{fontSize:10,color:"#6b7280",marginTop:2,lineHeight:1.4}}>{biggestCut.priceQoqLabel} input · current share {biggestCut.shareAvgLabel}</div>
        </div>}
        {biggestUp&&<div style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:8,padding:"8px 10px"}}>
          <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:".07em",fontWeight:700,color:"#7c3aed"}}>Biggest price increase</div>
          <div style={{fontSize:13,fontWeight:700,color:"#111827",marginTop:2}}>{biggestUp.label}</div>
          <div style={{fontSize:10,color:"#6b7280",marginTop:2,lineHeight:1.4}}>{biggestUp.priceQoqLabel} input · current share {biggestUp.shareAvgLabel}</div>
        </div>}
        {topShare&&<div style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:8,padding:"8px 10px"}}>
          <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:".07em",fontWeight:700,color:"#7c3aed"}}>Largest share holder</div>
          <div style={{fontSize:13,fontWeight:700,color:"#111827",marginTop:2}}>{topShare.label}</div>
          <div style={{fontSize:10,color:"#6b7280",marginTop:2,lineHeight:1.4}}>{topShare.shareAvgLabel} of observed tokens · price {topShare.priceQoqLabel}</div>
        </div>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"minmax(360px,1fr) minmax(420px,2fr)",gap:10}}>
        <div style={{...S.card,padding:"10px 12px 10px",display:"flex",flexDirection:"column"}}>
          <div style={{fontSize:10,color:"#6b7280",marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontWeight:600,color:"#374151"}}>Price QoQ vs Current Share</span>
            <span style={{fontSize:9,color:"#9ca3af"}}>x: price % · y: share %</span>
          </div>
          <svg viewBox={"0 0 "+W+" "+H} style={{display:"block",width:"100%",aspectRatio:`${W} / ${H}`,overflow:"visible"}}>
            {/* Left half (price cut) — gentle blue tint; right half (price up) — gentle red tint */}
            <rect x={pL} y={pT} width={x0-pL} height={H-pT-pB} fill="#eff6ff" opacity="0.6"/>
            <rect x={x0} y={pT} width={W-pR-x0} height={H-pT-pB} fill="#fef2f2" opacity="0.5"/>
            {/* Axes */}
            <line x1={pL} y1={H-pB} x2={W-pR} y2={H-pB} stroke="#9ca3af" strokeWidth="0.5"/>
            <line x1={x0} y1={pT} x2={x0} y2={H-pB} stroke="#9ca3af" strokeWidth="0.5"/>
            {/* Price axis labels */}
            <text x={pL} y={H-pB+14} fontSize="9" fill="#6b7280">−{xMax.toFixed(0)}%</text>
            <text x={W-pR} y={H-pB+14} fontSize="9" fill="#6b7280" textAnchor="end">+{xMax.toFixed(0)}%</text>
            {/* Share axis labels — absolute percentage, 0 at bottom, yMax at top */}
            <text x={pL-4} y={pT+4} fontSize="9" fill="#6b7280" textAnchor="end">{yMax.toFixed(0)}%</text>
            <text x={pL-4} y={H-pB+2} fontSize="9" fill="#6b7280" textAnchor="end">0%</text>
            {/* Corner hints — price direction only */}
            <text x={pL+4}    y={pT+10} fontSize="8" fill="#2563eb" fontWeight="600">price cut</text>
            <text x={W-pR-4}  y={pT+10} fontSize="8" fill="#dc2626" fontWeight="600" textAnchor="end">price up</text>
            {/* Dots */}
            {placed.map(p=>(
              <g key={p.slug}>
                <circle cx={p.x} cy={p.y} r="4.5" fill={p.color} stroke="#fff" strokeWidth="1"/>
                <text x={p.lx} y={p.ly} fontSize="10" fill="#111827" fontWeight="600" textAnchor={p.lAnchor}>{p.label}</text>
              </g>
            ))}
          </svg>
          <div style={{marginTop:"auto",paddingTop:12}}>
            <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:".07em",fontWeight:700,color:"#9ca3af",marginBottom:6}}>How to read the dot</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 12px",fontSize:10.5,color:"#374151",lineHeight:1.4}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:"#2563eb",marginTop:4,flexShrink:0}}/><span><b style={{color:"#111827"}}>Price cut</b><br/><span style={{color:"#6b7280"}}>QoQ ≤ −2%</span></span></div>
              <div style={{display:"flex",alignItems:"flex-start",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:"#dc2626",marginTop:4,flexShrink:0}}/><span><b style={{color:"#111827"}}>Price up</b><br/><span style={{color:"#6b7280"}}>QoQ ≥ +2%</span></span></div>
              <div style={{display:"flex",alignItems:"flex-start",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:"#6b7280",marginTop:4,flexShrink:0}}/><span><b style={{color:"#111827"}}>Price held</b><br/><span style={{color:"#6b7280"}}>|QoQ| &lt; 2%</span></span></div>
              <div style={{display:"flex",alignItems:"flex-start",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:"transparent",border:"1px dashed #9ca3af",marginTop:4,flexShrink:0}}/><span><b style={{color:"#111827"}}>Y = current %</b><br/><span style={{color:"#6b7280"}}>not a QoQ delta</span></span></div>
            </div>
          </div>
        </div>
        <div style={{...S.card,padding:0,overflow:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr>
                {["Provider","Avg Price /1M","Price QoQ","Current Share"].map(h=>(
                  <th key={h} style={{...S.lbl,textAlign:"left",padding:"8px 10px",borderBottom:"1px solid #f3f4f6",background:"#fafafa"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map(r=>(
                <tr key={r.slug}>
                  <td style={{padding:"8px 10px",borderBottom:"1px solid #f9fafb",fontWeight:600,color:"#111827",whiteSpace:"nowrap"}}>
                    <span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:dotColor(r.priceQoq),marginRight:6,verticalAlign:"middle"}}/>
                    {r.label}
                  </td>
                  <td style={{padding:"8px 10px",borderBottom:"1px solid #f9fafb",fontFamily:"monospace",color:"#111827"}}>{r.avgLabel}</td>
                  <td style={{padding:"8px 10px",borderBottom:"1px solid #f9fafb",fontFamily:"monospace",fontWeight:600,color:r.priceQoq>0?"#dc2626":r.priceQoq<0?"#059669":"#6b7280"}}>{r.priceQoqLabel}</td>
                  <td style={{padding:"8px 10px",borderBottom:"1px solid #f9fafb",fontFamily:"monospace",color:"#111827"}}>{r.shareAvgLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:"4px 10px",fontSize:10,color:"#6b7280",marginTop:8,lineHeight:1.5}}>
        <span><b style={{color:"#374151"}}>Scope:</b> partial view — Price QoQ shown, Share QoQ unavailable until a prior-quarter KV snapshot exists</span>
        <span>·</span>
        <span><b style={{color:"#374151"}}>Sources:</b> pricepertoken provider pricing history + canonical HISTORY_KV OpenRouter snapshots</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   PRICING / SHARE SIGNALS — Analytical read-through

   Joins /api/provider-pricing-matrix (quarterly provider avg $/1M +
   priceQoq) with canonical KV OpenRouter snapshots (provider token
   share, averaged by quarter). Renders top callouts for the latest
   comparable quarter, a per-provider signal table, and a compact
   quadrant scatter (native SVG — no recharts scatter in bundle).

   Honesty: directional ecosystem read-through, not a causal claim.
   Only providers observed in BOTH dimensions in the quarter appear.
═══════════════════════════════════════════════════════ */
function PricingShareSignalBlock(){
  const[state,setState]=useState({phase:"loading",data:null,error:null});
  useEffect(()=>{
    let cancelled=false;
    fetch("/api/pricing-share-signal")
      .then(r=>r.json())
      .then(d=>{ if(cancelled) return;
        if(!d.success) setState({phase:"error",data:null,error:d.error||"Unknown error"});
        else setState({phase:"ready",data:d,error:null});
      })
      .catch(e=>{ if(!cancelled) setState({phase:"error",data:null,error:e.message}); });
    return ()=>{cancelled=true;};
  },[]);

  /* Regime-to-color: green=favorable pricing-power, amber=neutral/ok, red=weak/anomaly */
  const regimeColor=(priceReg,shareReg)=>{
    if(priceReg==="hold"&&shareReg==="gain") return "#059669";  // pricing power
    if(priceReg==="up"  &&shareReg==="gain") return "#059669";  // strong pricing power
    if(priceReg==="cut" &&shareReg==="gain") return "#2563eb";  // effective cut
    if(priceReg==="up"  &&shareReg==="loss") return "#dc2626";  // weak position
    if(priceReg==="cut" &&shareReg==="loss") return "#dc2626";  // anomalous / cuts not defending
    if(priceReg==="cut" &&shareReg==="flat") return "#d97706";  // cut not converting
    return "#6b7280"; // flat/hold/flat and mixed neutrals
  };

  const header=(
    <>
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
        <span style={{width:7,height:7,borderRadius:"50%",background:"#7c3aed",display:"inline-block"}}/>
        <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:".09em",fontWeight:700,color:"#7c3aed"}}>Pricing / Share Signals</span>
      </div>
      <div style={{marginBottom:10}}>
        <div style={{fontSize:16,fontWeight:700,color:"#111827",lineHeight:1.3}}>Pricing Behavior and Market Share Read-Through</div>
        <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>Where pricing moves are translating into share gains, resilience, or anomalies.</div>
      </div>
    </>
  );

  if(state.phase==="error"){
    return(
      <div style={{marginBottom:16}}>
        {header}
        <div style={{background:"#fff",border:"0.5px dashed #fca5a5",borderRadius:10,padding:"14px 16px"}}>
          <div style={{fontSize:12,color:"#991b1b",fontWeight:500}}>Pricing / share read-through temporarily unavailable</div>
          <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>{state.error||"/api/pricing-share-signal did not return success"}</div>
        </div>
      </div>
    );
  }
  if(state.phase==="loading"){
    return(
      <div style={{marginBottom:16}}>
        {header}
        <div style={{...S.card}}><Shimmer rows={4}/></div>
      </div>
    );
  }
  const d=state.data;
  const latest=d.quarters.find(q=>q.quarter===d.latestComparable);

  /* Partial-mode fallback: when a full QoQ comparison isn't yet possible
     (KV snapshot history hasn't crossed a quarter boundary) we still have
     priceQoq + current share % for the newest quarter. Render a reduced
     view — Price QoQ vs current Share % — so the block stays useful
     instead of showing a dead empty state until Q3 snapshots accumulate. */
  if(!latest||!latest.rows||!latest.rows.length){
    const partialQuarter=(d.quarters||[]).find(q=>(q.rows||[]).some(r=>typeof r.priceQoq==="number"&&typeof r.shareAvg==="number"));
    if(!partialQuarter){
      return(
        <div style={{marginBottom:16}}>
          {header}
          <div style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:10,padding:"14px 16px"}}>
            <div style={{fontSize:12,color:"#111827",fontWeight:500}}>No comparable quarter available yet</div>
            <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>Need at least one quarter with both price and market-share observations.</div>
          </div>
        </div>
      );
    }
    return <PricingSharePartialView header={header} quarter={partialQuarter}/>;
  }

  /* SVG quadrant — Price QoQ % on x, Share QoQ pp on y.
     Asymmetric padding: extra room on left for share labels, extra room
     below for price labels. Keeps axis range labels OUTSIDE the plot so
     they never collide with dots near the origin. H is tuned so the SVG
     renders tall enough to visually balance the signal table alongside it. */
  const W=520,H=360,pL=40,pR=18,pT=22,pB=32;
  const rows=latest.rows.filter(r=>typeof r.priceQoq==="number"&&typeof r.shareQoqPP==="number");
  let xMax=Math.max(5,...rows.map(r=>Math.abs(r.priceQoq*100)))*1.15;
  let yMax=Math.max(1,...rows.map(r=>Math.abs(r.shareQoqPP)))*1.3;
  const sx=(v)=>pL+((v+xMax)/(2*xMax))*(W-pL-pR);
  const sy=(v)=>H-pB-((v+yMax)/(2*yMax))*(H-pT-pB);
  const x0=sx(0),y0=sy(0);

  /* Pre-compute dot placement with label-collision avoidance. Labels flip
     to the left of their dot when the dot sits in the right portion of the
     plot (prevents overflow past the SVG edge). Labels that would overlap
     are stacked vertically. */
  const dotData=rows.map(r=>({
    slug:r.slug,
    label:r.label,
    color:regimeColor(r.priceReg,r.shareReg),
    x:sx(r.priceQoq*100),
    y:sy(r.shareQoqPP),
  }));
  const placedLabels=[];
  [...dotData].sort((a,b)=>a.y-b.y).forEach(d=>{
    const flipLeft=d.x>W*0.6;
    const lAnchor=flipLeft?"end":"start";
    const lx=flipLeft?d.x-7:d.x+7;
    const lw=Math.max(36,d.label.length*5.8);
    let dy=3;
    for(let i=0;i<6;i++){
      const ly=d.y+dy;
      const collides=placedLabels.some(p=>{
        if(Math.abs(p.ly-ly)>11) return false;
        const pLe=p.lAnchor==="end"?p.lx-p.lw:p.lx;
        const pRi=p.lAnchor==="end"?p.lx:p.lx+p.lw;
        const dLe=flipLeft?lx-lw:lx;
        const dRi=flipLeft?lx:lx+lw;
        return !(dRi<pLe-3||dLe>pRi+3);
      });
      if(!collides) break;
      dy+=12;
    }
    placedLabels.push({...d,lx,ly:d.y+dy,lAnchor,lw});
  });

  return(
    <div style={{marginBottom:16}}>
      {header}

      {/* Latest-quarter tag */}
      <div style={{fontSize:11,color:"#6b7280",marginBottom:8}}>
        Latest comparable quarter: <b style={{color:"#111827",fontFamily:"monospace"}}>{d.latestComparable}</b>
        {latest.partial&&<span style={{marginLeft:5,fontSize:9,background:"#ecfeff",color:"#0e7490",padding:"1px 5px",borderRadius:3,fontWeight:600}}>QTD</span>}
        <span style={{color:"#9ca3af"}}> vs {d.priorComparable} · {rows.length} providers observed in both dimensions</span>
      </div>

      {/* Callout chips */}
      {d.callouts&&d.callouts.length>0&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:8,marginBottom:12}}>
          {d.callouts.map((c,i)=>(
            <div key={i} style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:8,padding:"8px 10px"}}>
              <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:".07em",fontWeight:700,color:"#7c3aed"}}>{c.title}</div>
              <div style={{fontSize:13,fontWeight:700,color:"#111827",marginTop:2}}>{c.provider}</div>
              <div style={{fontSize:10,color:"#6b7280",marginTop:2,lineHeight:1.4}}>{c.detail}</div>
            </div>
          ))}
        </div>
      )}

      {/* Quadrant chart + signal table side-by-side. Cards stretch to the same
         height (default grid behavior); the chart card uses flex column so the
         legend strip pushes to the bottom, balancing the chart card against the
         taller table. */}
      <div style={{display:"grid",gridTemplateColumns:"minmax(360px,1fr) minmax(420px,2fr)",gap:10}}>

        {/* Quadrant */}
        <div style={{...S.card,padding:"10px 12px 10px",display:"flex",flexDirection:"column"}}>
          <div style={{fontSize:10,color:"#6b7280",marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontWeight:600,color:"#374151"}}>Price QoQ vs Share QoQ</span>
            <span style={{fontSize:9,color:"#9ca3af"}}>x: price % · y: share pp</span>
          </div>
          <svg viewBox={"0 0 "+W+" "+H} style={{display:"block",width:"100%",aspectRatio:`${W} / ${H}`,overflow:"visible"}}>
            {/* Quadrant background tints */}
            <rect x={pL} y={pT} width={x0-pL} height={y0-pT} fill="#ecfdf5" opacity="0.5"/>
            <rect x={x0} y={pT} width={W-pR-x0} height={y0-pT} fill="#ecfdf5" opacity="0.7"/>
            <rect x={pL} y={y0} width={x0-pL} height={H-pB-y0} fill="#fef2f2" opacity="0.5"/>
            <rect x={x0} y={y0} width={W-pR-x0} height={H-pB-y0} fill="#fef2f2" opacity="0.5"/>
            {/* Axes */}
            <line x1={pL} y1={y0} x2={W-pR} y2={y0} stroke="#9ca3af" strokeWidth="0.5"/>
            <line x1={x0} y1={pT} x2={x0} y2={H-pB} stroke="#9ca3af" strokeWidth="0.5"/>
            {/* Price (x) axis range labels — below plot, outside the dot area */}
            <text x={pL} y={H-pB+14} fontSize="9" fill="#6b7280">−{xMax.toFixed(0)}%</text>
            <text x={W-pR} y={H-pB+14} fontSize="9" fill="#6b7280" textAnchor="end">+{xMax.toFixed(0)}%</text>
            {/* Share (y) axis range labels — left of plot, outside the dot area */}
            <text x={pL-4} y={pT+4} fontSize="9" fill="#6b7280" textAnchor="end">+{yMax.toFixed(1)}pp</text>
            <text x={pL-4} y={H-pB+2} fontSize="9" fill="#6b7280" textAnchor="end">−{yMax.toFixed(1)}pp</text>
            {/* Quadrant labels (corner hints) */}
            <text x={pL+4}    y={pT+10} fontSize="8" fill="#059669" fontWeight="600">effective cut</text>
            <text x={W-pR-4}  y={pT+10} fontSize="8" fill="#059669" fontWeight="600" textAnchor="end">pricing power</text>
            <text x={pL+4}    y={H-pB-3} fontSize="8" fill="#dc2626" fontWeight="600">cuts not defending</text>
            <text x={W-pR-4}  y={H-pB-3} fontSize="8" fill="#dc2626" fontWeight="600" textAnchor="end">weak position</text>
            {/* Dots + labels — labels flip and stack to avoid collisions */}
            {placedLabels.map(p=>(
              <g key={p.slug}>
                <circle cx={p.x} cy={p.y} r="4.5" fill={p.color} stroke="#fff" strokeWidth="1"/>
                <text x={p.lx} y={p.ly} fontSize="10" fill="#111827" fontWeight="600" textAnchor={p.lAnchor}>{p.label}</text>
              </g>
            ))}
          </svg>
          {/* Legend — pushes to bottom via marginTop:auto so the chart card
             visually matches the taller signal table alongside it. */}
          <div style={{marginTop:"auto",paddingTop:12}}>
            <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:".07em",fontWeight:700,color:"#9ca3af",marginBottom:6}}>How to read the dot</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 12px",fontSize:10.5,color:"#374151",lineHeight:1.4}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:"#059669",marginTop:4,flexShrink:0}}/><span><b style={{color:"#111827"}}>Pricing power</b><br/><span style={{color:"#6b7280"}}>price holds/up · share gain</span></span></div>
              <div style={{display:"flex",alignItems:"flex-start",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:"#2563eb",marginTop:4,flexShrink:0}}/><span><b style={{color:"#111827"}}>Effective cut</b><br/><span style={{color:"#6b7280"}}>price cut · share gain</span></span></div>
              <div style={{display:"flex",alignItems:"flex-start",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:"#dc2626",marginTop:4,flexShrink:0}}/><span><b style={{color:"#111827"}}>Weak position</b><br/><span style={{color:"#6b7280"}}>price up · share loss</span></span></div>
              <div style={{display:"flex",alignItems:"flex-start",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:"#6b7280",marginTop:4,flexShrink:0}}/><span><b style={{color:"#111827"}}>Neutral / mixed</b><br/><span style={{color:"#6b7280"}}>flat or absorbed move</span></span></div>
            </div>
          </div>
        </div>

        {/* Signal table */}
        <div style={{...S.card,padding:0,overflow:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr>
                {["Provider","Avg Price /1M","Price QoQ","Share QoQ","Regime / Interpretation"].map(h=>(
                  <th key={h} style={{...S.lbl,textAlign:"left",padding:"8px 10px",borderBottom:"1px solid #f3f4f6",background:"#fafafa"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r=>(
                <tr key={r.slug}>
                  <td style={{padding:"8px 10px",borderBottom:"1px solid #f9fafb",fontWeight:600,color:"#111827",whiteSpace:"nowrap"}}>
                    <span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:regimeColor(r.priceReg,r.shareReg),marginRight:6,verticalAlign:"middle"}}/>
                    {r.label}
                  </td>
                  <td style={{padding:"8px 10px",borderBottom:"1px solid #f9fafb",fontFamily:"monospace",color:"#111827"}}>{r.avgLabel}</td>
                  <td style={{padding:"8px 10px",borderBottom:"1px solid #f9fafb",fontFamily:"monospace",fontWeight:600,color:r.priceQoq>0?"#dc2626":r.priceQoq<0?"#059669":"#6b7280"}}>{r.priceQoqLabel}</td>
                  <td style={{padding:"8px 10px",borderBottom:"1px solid #f9fafb",fontFamily:"monospace",fontWeight:600,color:r.shareQoqPP>0?"#059669":r.shareQoqPP<0?"#dc2626":"#6b7280"}}>{r.shareQoqLabel}</td>
                  <td style={{padding:"8px 10px",borderBottom:"1px solid #f9fafb",fontSize:11,color:"#374151",lineHeight:1.35}}>
                    <div style={{fontWeight:600,color:"#111827"}}>{r.regimeLabel}</div>
                    <div style={{color:"#6b7280",marginTop:1}}>{r.note}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Methodology caveat */}
      <div style={{display:"flex",flexWrap:"wrap",gap:"4px 10px",fontSize:10,color:"#6b7280",marginTop:8,lineHeight:1.5}}>
        <span><b style={{color:"#374151"}}>Rules:</b> price cut ≤ −2%, price up ≥ +2%, share gain ≥ +0.3pp, share loss ≤ −0.3pp</span>
        <span>·</span>
        <span><b style={{color:"#374151"}}>Scope:</b> directional ecosystem read-through, not a causal claim</span>
        <span>·</span>
        <span><b style={{color:"#374151"}}>Omissions:</b> providers outside the OpenRouter top-N during the quarter are excluded, never imputed</span>
        <span>·</span>
        <span><b style={{color:"#374151"}}>Sources:</b> pricepertoken provider pricing history + canonical HISTORY_KV OpenRouter snapshots</span>
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

      {/* Per-provider upstream failure note — partial data still renders */}
      {state.data?.providerErrors?.length>0&&(
        <div style={{fontSize:11,color:"#92400e",background:"#fef3c7",border:"0.5px solid #fde68a",borderRadius:6,padding:"6px 10px",marginBottom:8,lineHeight:1.4}}>
          Partial data · upstream temporarily unavailable for {state.data.providerErrors.map(e=>e.slug).join(", ")} — other providers render as normal.
        </div>
      )}

      {/* ── Trend chart (reads the same matrix payload — single source of truth) ── */}
      {state.phase==="ready"&&state.data?.quarters?.length>0&&(() => {
        // Transform quarters×cells → one row per quarter with provider-slug keys.
        // Oldest quarter first (left→right on x-axis).
        const rows=[...state.data.quarters].reverse().map(q=>{
          const row={quarter:q.quarter,partial:q.partial};
          for(const c of q.cells){ row[c.slug]= (typeof c.avg==="number"?c.avg:null); }
          return row;
        });
        // Stable per-provider colours (distinct, investor-readable).
        const COLOR={openai:"#10a37f",anthropic:"#d97757",google:"#4285f4",xai:"#0ea5e9",mistralai:"#f59e0b",deepseek:"#8b5cf6","meta-llama":"#1877f2",cohere:"#ec4899"};
        const unit=metric==="input"?"Input $/1M":"Output $/1M";
        // Log-scale y-axis because provider prices span ~50× ($0.13 – $6.93).
        // Compute a domain floor strictly > 0.
        let minV=Infinity,maxV=0;
        for(const r of rows){ for(const p of state.data.providers){ const v=r[p.slug]; if(typeof v==="number"&&v>0){ if(v<minV) minV=v; if(v>maxV) maxV=v; } } }
        const yMin=isFinite(minV)?Math.max(0.01,minV*0.5):0.05;
        const yMax=isFinite(maxV)?maxV*1.4:10;
        return(
          <div style={{marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
              <span style={{width:6,height:6,borderRadius:"50%",background:"#0e7490",display:"inline-block",opacity:0.7}}/>
              <span style={{fontSize:9,textTransform:"uppercase",letterSpacing:".09em",fontWeight:700,color:"#0e7490"}}>Quarterly Pricing Trend</span>
            </div>
            <div style={{marginBottom:6}}>
              <div style={{fontSize:13,fontWeight:700,color:"#111827",lineHeight:1.3}}>Quarterly Model Pricing by Company — Trend</div>
              <div style={{fontSize:10,color:"#9ca3af",marginTop:2}}>Calendar-quarter average model API price per token, grouped by provider family. Log scale. Same data as matrix below.</div>
            </div>
            <div style={{...S.card,padding:"12px 12px 4px"}}>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={rows} margin={{top:8,right:14,left:-6,bottom:6}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false}/>
                  <XAxis dataKey="quarter" tick={{fontSize:10,fill:"#6b7280"}} tickLine={false} axisLine={{stroke:"#e5e7eb"}}/>
                  <YAxis scale="log" domain={[yMin,yMax]} tick={{fontSize:10,fill:"#6b7280"}} tickLine={false} axisLine={{stroke:"#e5e7eb"}} tickFormatter={v=>v>=1?"$"+v.toFixed(0):"$"+v.toFixed(2)} width={48}/>
                  <Tooltip
                    contentStyle={{fontSize:11,borderRadius:6,border:"0.5px solid #e5e7eb"}}
                    formatter={(v,n)=>[typeof v==="number"?"$"+v.toFixed(v>=1?2:3):"—",(state.data.providers.find(p=>p.slug===n)||{}).label||n]}
                    labelStyle={{fontWeight:600,color:"#111827"}}
                    labelFormatter={q=>q+" · "+unit}/>
                  <Legend
                    wrapperStyle={{fontSize:10,paddingTop:4}}
                    iconSize={8}
                    formatter={(n)=>(state.data.providers.find(p=>p.slug===n)||{}).label||n}/>
                  {state.data.providers.map(p=>(
                    <Line key={p.slug}
                      type="monotone"
                      dataKey={p.slug}
                      stroke={COLOR[p.slug]||"#9ca3af"}
                      strokeWidth={1.75}
                      dot={{r:2.5,strokeWidth:0}}
                      activeDot={{r:4}}
                      connectNulls
                      isAnimationActive={false}/>
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* ── Matrix section header (kept minimal — methodology lives at bottom) ── */}
      {state.phase==="ready"&&state.data?.quarters?.length>0&&(
        <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4,marginTop:4}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:"#0e7490",display:"inline-block",opacity:0.7}}/>
          <span style={{fontSize:9,textTransform:"uppercase",letterSpacing:".09em",fontWeight:700,color:"#0e7490"}}>Quarterly Pricing Matrix</span>
        </div>
      )}

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
                    const tip=(c.avgLabel||"—")+" avg · "+(c.modelCount||0)+" models in this quarter · "+(c.obsCount||0)+" daily observations"+(c.qoqLabel?" · QoQ "+c.qoqLabel:"")+(c.yoyLabel?" · YoY "+c.yoyLabel:"");
                    return(
                      <td key={c.slug} style={{padding:"10px 10px",borderBottom:"1px solid #f9fafb",fontFamily:"monospace",textAlign:"right",fontWeight:600,color,whiteSpace:"nowrap"}}
                          title={tip}>
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

      {/* Methodology strip — compact, investor-grade transparency */}
      <div style={{display:"flex",flexWrap:"wrap",gap:"4px 10px",fontSize:10,color:"#6b7280",marginTop:8,lineHeight:1.5}}>
        <span><b style={{color:"#374151"}}>Unit:</b> {unitHint}</span>
        <span>·</span>
        <span><b style={{color:"#374151"}}>Depth:</b> begins {state.data?.earliestDateObserved||"2025-07-28"}</span>
        <span>·</span>
        <span><b style={{color:"#374151"}}>Method:</b> equal-weighted mean of (model, day) observations per provider per quarter — model mix reflects what was available in that quarter, not a fixed basket</span>
        <span>·</span>
        <span><b style={{color:"#374151"}}>YoY:</b> appears only when a true year-ago quarter exists upstream</span>
        <span>·</span>
        <span><b style={{color:"#374151"}}>Backfill:</b> none — real snapshots only</span>
        <span>·</span>
        <span><b style={{color:"#374151"}}>Source:</b> api.pricepertoken.com provider pricing history</span>
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

      {/* Analytical read-through (callouts + signal table + quadrant) — first */}
      <PricingShareSignalBlock/>

      {/* Quarterly trend chart + matrix */}
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
