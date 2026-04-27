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
  const[pressed,setPressed]=useState(false);
  function handleClick(e){
    setPressed(true);
    setTimeout(()=>setPressed(false),180);
    onClick&&onClick(e);
  }
  return(
    <button onClick={handleClick} disabled={busy}
      style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:12,padding:"6px 14px",border:"0.5px solid "+(busy?"#e5e7eb":"#d1d5db"),borderRadius:8,background:busy?"#f9fafb":"#fff",color:busy?"#9ca3af":"#374151",cursor:busy?"wait":"pointer",fontFamily:"inherit",fontWeight:500,transform:pressed?"scale(0.96)":"scale(1)",transition:"transform .12s ease, background .15s, color .15s"}}>
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
   TAB: GPU Hardware Pricing (getdeploying.com reverse-proxy embed
   + /api/gpu-hardware-pricing-data parsed-data summary)
═══════════════════════════════════════════════════════ */

// Strategic SKU order for the comparison table. Matches decision-weight
// (H/B class trainers first, then mid-training + inference workhorses).
const GPU_STRATEGIC_ORDER=[
  "Nvidia H100","Nvidia H200","Nvidia B200","Nvidia GB200",
  "Nvidia A100","Nvidia L40S",
];
// KPI cards want just the cheapest by SKU — uses same canonical names.
const GPU_KPI_SKUS=["Nvidia H100","Nvidia H200","Nvidia B200","Nvidia A100"];

function fmtUSD(v){
  if(v==null||!isFinite(v))return"—";
  if(v<1)return"$"+v.toFixed(2);
  if(v<10)return"$"+v.toFixed(2);
  return"$"+v.toFixed(2);
}

function GPUHardwarePricingTab(){
  const[err,setErr]=useState(false);
  const[data,setData]=useState(null);
  const[loadErr,setLoadErr]=useState(false);
  const[hist,setHist]=useState(null);       // daily
  const[histErr,setHistErr]=useState(false);
  const[qHist,setQHist]=useState(null);     // quarter-close (operational)
  const[qHistErr,setQHistErr]=useState(false);
  const[fHist,setFHist]=useState(null);     // financial (period-average)
  const[fHistErr,setFHistErr]=useState(false);
  const[histView,setHistView]=useState("quarter");   // quarter | daily (inside Infra subtab)
  const[gpuSubtab,setGpuSubtab]=useState("financial"); // "financial" default per investor framing

  useEffect(()=>{
    let cancelled=false;
    fetch("/api/gpu-hardware-pricing-data?v="+Math.floor(Date.now()/3e5))
      .then(r=>r.ok?r.json():Promise.reject(r.status))
      .then(j=>{if(!cancelled){if(j&&j.ok){setData(j);}else{setLoadErr(true);}}})
      .catch(()=>{if(!cancelled)setLoadErr(true);});
    fetch("/api/gpu-hardware-pricing-history?window=60")
      .then(r=>r.ok?r.json():Promise.reject(r.status))
      .then(j=>{if(!cancelled){if(j&&j.success){setHist(j);}else{setHistErr(true);}}})
      .catch(()=>{if(!cancelled)setHistErr(true);});
    fetch("/api/gpu-hardware-pricing-history?view=quarter&window=400")
      .then(r=>r.ok?r.json():Promise.reject(r.status))
      .then(j=>{if(!cancelled){if(j&&j.success){setQHist(j);}else{setQHistErr(true);}}})
      .catch(()=>{if(!cancelled)setQHistErr(true);});
    fetch("/api/gpu-hardware-pricing-history?view=financial&window=400")
      .then(r=>r.ok?r.json():Promise.reject(r.status))
      .then(j=>{if(!cancelled){if(j&&j.success){setFHist(j);}else{setFHistErr(true);}}})
      .catch(()=>{if(!cancelled)setFHistErr(true);});
    return()=>{cancelled=true;};
  },[]);

  const updatedTxt=data?.sourceUpdatedAt?.text||null;

  return(
    <>
      <style>{`@keyframes gpupulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>

      {/* Page header — rendered once, above the subtab switcher */}
      <div style={{marginBottom:10}}>
        <div style={{fontSize:16,fontWeight:700,color:"#111827",lineHeight:1.3}}>GPU Hardware Pricing</div>
        <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>
          Two lenses on the same strategic GPU basket · daily snapshots underneath captured since <b style={{color:"#6b7280",fontWeight:600}}>{fHist?.trackingSinceRealDate||"—"}</b>
        </div>
      </div>

      {/* Subtab switcher */}
      <div style={{display:"flex",gap:4,marginBottom:14,borderBottom:"0.5px solid #e5e7eb",paddingBottom:0}}>
        {[
          {id:"financial",label:"Financial Correlation",sub:"period averages · QoQ · YoY"},
          {id:"infra",    label:"Infra Monitoring",     sub:"live spot · quarter-close · operational history"},
        ].map(t=>{
          const active=gpuSubtab===t.id;
          return(
            <button key={t.id} onClick={()=>setGpuSubtab(t.id)}
              style={{fontSize:12,padding:"8px 16px",border:"none",borderBottom:active?"2px solid #111827":"2px solid transparent",marginBottom:-1,background:"transparent",color:active?"#111827":"#6b7280",cursor:"pointer",fontFamily:"inherit",fontWeight:active?600:500,display:"flex",flexDirection:"column",alignItems:"flex-start",gap:1}}>
              <span>{t.label}</span>
              <span style={{fontSize:9,fontWeight:400,color:active?"#6b7280":"#9ca3af",textTransform:"lowercase"}}>{t.sub}</span>
            </button>
          );
        })}
      </div>

      {gpuSubtab==="financial"
        ? <GPUFinancialSubtab fHist={fHist} fHistErr={fHistErr}/>
        : <GPUInfraMonitoringSubtab
            data={data} loadErr={loadErr} updatedTxt={updatedTxt}
            histView={histView} setHistView={setHistView}
            qHist={qHist} qHistErr={qHistErr}
            hist={hist} histErr={histErr}
            embedErr={err} setEmbedErr={setErr}
          />
      }
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   SUBTAB: Financial Correlation (investor lens)
   - No live KPI cards (those are infra monitoring)
   - Period averages only · QoQ · YoY
   - Primary rows (B200/H200/H100) always visible
   - Secondary rows (A100/GB200/L40S) behind "Show more" expansion
═══════════════════════════════════════════════════════ */
function GPUFinancialSubtab({fHist,fHistErr}){
  return(
    <>
      {/* Section label */}
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
        <span style={{width:7,height:7,borderRadius:"50%",background:"#1d4ed8",display:"inline-block"}}/>
        <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:".09em",fontWeight:700,color:"#1d4ed8"}}>Investor lens — financial correlation</span>
      </div>

      {/* Title + subtitle */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:700,color:"#111827",lineHeight:1.3}}>Period-average pricing for equity correlation</div>
        <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>
          Arithmetic mean of daily <code>minPricePerHour</code> by calendar period · quarter labels = quarter-end month (Mar/Jun/Sep/Dec) · real-only, no fabricated history.
        </div>
      </div>

      {/* Financial matrix */}
      <GPUFinancialCorrelationBlock fHist={fHist} fHistErr={fHistErr}/>
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   SUBTAB: Infra Monitoring (live market plumbing)
   - Live KPI cards (current spot minimums)
   - Strategic SKU comparison (live lowest / highest $/hr)
   - Operational GPU Pricing History (quarter-close / QTD / daily)
   - Live reverse-proxied getdeploying table
═══════════════════════════════════════════════════════ */
function GPUInfraMonitoringSubtab({data,loadErr,updatedTxt,histView,setHistView,qHist,qHistErr,hist,histErr,embedErr,setEmbedErr}){
  const rows=data?.rows||[];
  const byName={};
  for(const r of rows)if(!byName[r.gpuModel])byName[r.gpuModel]=r;

  const kpiCards=GPU_KPI_SKUS.map(sku=>{
    const r=byName[sku];
    if(!r||r.minPricePerHour==null)return null;
    const short=sku.replace(/^Nvidia\s+/i,"");
    return{
      sku,label:"Live cheapest "+short+" $/hr",
      value:fmtUSD(r.minPricePerHour),
      sub:r.providerCount?r.providerCount+" providers":null,
    };
  }).filter(Boolean);

  const totalProviders=rows.reduce((m,r)=>Math.max(m,r.providerCount||0),0);
  const modelCount=rows.length;
  const tableRows=GPU_STRATEGIC_ORDER.map(n=>byName[n]).filter(Boolean);

  return(
    <>
      {/* Section label */}
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
        <span style={{width:7,height:7,borderRadius:"50%",background:"#0e7490",display:"inline-block",animation:"gpupulse 2s infinite"}}/>
        <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:".09em",fontWeight:700,color:"#0e7490"}}>Live infra signal — current market plumbing</span>
      </div>

      {/* Title + subtitle */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:700,color:"#111827",lineHeight:1.3}}>Live spot minimums, quarter-close history, and vendor table</div>
        <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>
          Current cheapest $/hr per SKU across 42+ providers · operational history uses quarter-close (last real snapshot in quarter).
          {updatedTxt&&<> · <b style={{color:"#6b7280",fontWeight:600}}>Source updated {updatedTxt}</b></>}
        </div>
      </div>

      {/* KPI cards */}
      {loadErr?(
        <div style={{background:"#f9fafb",border:"1px dashed #d1d5db",borderRadius:8,padding:"14px 16px",marginBottom:14}}>
          <div style={{fontSize:11,color:"#6b7280"}}>Summary metrics unavailable — parser temporarily offline. Live embed below still loads.</div>
        </div>
      ):!data?(
        <div style={{marginBottom:14}}>
          <Shimmer rows={2}/>
        </div>
      ):(
        <>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:8,marginBottom:10}}>
            {kpiCards.map(c=>(
              <KBox key={c.sku} label={c.label} value={c.value} sub={c.sub} bg="#ecfeff" fg="#0e7490"/>
            ))}
            <KBox label="Providers tracked"       value={totalProviders?totalProviders+"+":"—"} sub="across all SKUs"      bg="#f0fdf4" fg="#059669"/>
            <KBox label="GPU models tracked"      value={modelCount||"—"}                       sub="parsed from source" bg="#eff6ff" fg="#1d4ed8"/>
          </div>

          {/* Strategic comparison table */}
          {tableRows.length>0&&(
            <div style={{border:"0.5px solid #e5e7eb",borderRadius:8,overflow:"hidden",marginBottom:14,background:"#fff"}}>
              <div style={{padding:"9px 14px",borderBottom:"0.5px solid #f3f4f6",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:11,fontWeight:600,color:"#111827"}}>Strategic SKU comparison · live spot</span>
                <span style={{fontSize:10,color:"#9ca3af"}}>ordered by decision weight · training → inference</span>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:"#fafafa"}}>
                      <th style={gpuTh}>GPU</th>
                      <th style={gpuTh}>VRAM</th>
                      <th style={{...gpuTh,textAlign:"right"}}>Live&nbsp;lowest&nbsp;$/hr</th>
                      <th style={{...gpuTh,textAlign:"right"}}>Live&nbsp;highest&nbsp;$/hr</th>
                      <th style={{...gpuTh,textAlign:"right"}}>Providers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map(r=>(
                      <tr key={r.gpuModel} style={{borderTop:"0.5px solid #f3f4f6"}}>
                        <td style={gpuTd}><span style={{fontWeight:600,color:"#111827"}}>{r.gpuModel}</span></td>
                        <td style={{...gpuTd,color:"#6b7280"}}>{r.vram||"—"}</td>
                        <td style={{...gpuTd,textAlign:"right",color:"#059669",fontWeight:600}}>{fmtUSD(r.minPricePerHour)}</td>
                        <td style={{...gpuTd,textAlign:"right",color:"#374151"}}>{fmtUSD(r.maxPricePerHour)}</td>
                        <td style={{...gpuTd,textAlign:"right",color:"#6b7280"}}>{r.providerCount??"—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Operational history (quarter-close / QTD bootstrap / daily) */}
      <GPUHistoryShell
        histView={histView} setHistView={setHistView}
        qHist={qHist} qHistErr={qHistErr}
        hist={hist} histErr={histErr}
      />

      {/* Live embed */}
      {embedErr?(
        <div style={{background:"#f9fafb",border:"1px dashed #d1d5db",borderRadius:8,padding:"32px 16px",textAlign:"center"}}>
          <div style={{fontSize:13,color:"#6b7280",fontWeight:500}}>getdeploying GPU pricing live embed temporarily unavailable</div>
          <button onClick={()=>setEmbedErr(false)}
            style={{marginTop:10,fontSize:11,padding:"5px 14px",border:"0.5px solid #d1d5db",borderRadius:6,background:"#fff",color:"#374151",cursor:"pointer",fontFamily:"inherit"}}>
            Retry
          </button>
        </div>
      ):(
        <div style={{borderRadius:8,overflow:"hidden",border:"0.5px solid #e5e7eb",background:"#fff"}}>
          <iframe
            src={"/api/getdeploying-gpus-proxy?v="+Math.floor(Date.now()/3e5)}
            title="GetDeploying — GPU Hardware Pricing"
            loading="lazy"
            onError={()=>setEmbedErr(true)}
            style={{border:0,display:"block",width:"100%",height:"calc(100vh - 240px)",minHeight:720}}
          />
        </div>
      )}
      <div style={{fontSize:10,color:"#9ca3af",marginTop:6}}>
        Source: getdeploying.com/gpus (live reverse-proxied embed · summary parsed from SSR HTML)
      </div>
    </>
  );
}

const gpuTh={textAlign:"left",padding:"7px 12px",fontSize:10,textTransform:"uppercase",letterSpacing:".06em",color:"#6b7280",fontWeight:600};
const gpuTd={padding:"7px 12px",verticalAlign:"middle"};

/* ─── GPU Financial Correlation Block ─────────────────────
   Analyst-worksheet matrix: period-AVERAGE $/hr (not close), with QoQ
   and YoY growth rows directly underneath, quarter-end-month column
   labels (Mar/Jun/Sep/Dec-YY). Uses real-only data; partial periods are
   labeled QTD/MTD; growth cells only populate when both periods have
   real averages. Sits above the existing operational history block. */

const GPU_FIN_PRIMARY_ROWS=[
  {sku:"Nvidia B200",   shortLabel:"B200 192GB HBM3e"},
  {sku:"Nvidia H200",   shortLabel:"H200 141GB HBM3e"},
  {sku:"Nvidia H100",   shortLabel:"H100 80GB HBM3"},
];
const GPU_FIN_SECONDARY_ROWS=[
  {sku:"Nvidia A100",   shortLabel:"A100 40/80GB HBM2e"},
  {sku:"Nvidia GB200",  shortLabel:"GB200 (up to 13.4TB HBM3e)"},
  {sku:"Nvidia L40S",   shortLabel:"L40S 48GB GDDR6"},
];

/* Illustrative / design-preview values — NOT sourced from live data.
   Rendered only when the user explicitly flips the toggle ON. Never
   persisted to KV, never sent through the real pipeline, never mixed
   with real snapshots. An amber warning banner is shown whenever this
   data is visible. These values were supplied by the operator as a
   layout/shape preview for the Financial Correlation matrix. */
const GPU_FIN_ILLUSTRATIVE_QUARTERS=[
  {period:"2024-Q1", label:"Mar-24"},
  {period:"2024-Q2", label:"Jun-24"},
  {period:"2024-Q3", label:"Sep-24"},
  {period:"2024-Q4", label:"Dec-24"},
  {period:"2025-Q1", label:"Mar-25"},
  {period:"2025-Q2", label:"Jun-25"},
  {period:"2025-Q3", label:"Sep-25"},
  {period:"2025-Q4", label:"Dec-25"},
  {period:"2026-Q1", label:"Mar-26"},
  {period:"2026-Q2", label:"Jun-26"},
];
const GPU_FIN_ILLUSTRATIVE_PRICING={
  "Nvidia B200":[10.00, 2.00, 4.00, 5.00,12.00,10.00,5.00,1.00,2.00,3.53],
  "Nvidia H200":[ 8.00, 7.00, 6.00, 5.00, 4.50, 4.00,2.00,1.75,2.00,2.20],
  "Nvidia H100":[ 4.00, 3.60, 3.00, 2.50, 1.85, 1.75,1.55,1.25,1.75,1.54],
};

/* Synthesize an fHist-shaped payload from the illustrative pricing values.
   Quarterly-only. QoQ = pct change vs period N-1. YoY = pct change vs period
   N-4. Partial flags are always false (these are purely display values, not
   captured snapshots). */
function buildIllustrativeFHist(){
  const qLabels=GPU_FIN_ILLUSTRATIVE_QUARTERS;
  const series={};
  const qoq={};
  const yoy={};
  for(const[sku,values]of Object.entries(GPU_FIN_ILLUSTRATIVE_PRICING)){
    series[sku]=values.map((v,i)=>({
      period:qLabels[i].period,
      label:qLabels[i].label,
      avgMinPricePerHour:v,
      isQTD:false,
      isPartialQuarter:false,
      daysCoveredInQuarter:null,
      quarterDayCount:null,
      coverageRatioWithinQuarter:null,
    }));
    qoq[sku]={};
    yoy[sku]={};
    for(let i=0;i<values.length;i++){
      const cur=values[i];
      const prior=i>0?values[i-1]:null;
      const yoyPrior=i>=4?values[i-4]:null;
      qoq[sku][qLabels[i].period]=(prior!=null&&prior!==0)
        ?+(((cur-prior)/prior)*100).toFixed(1):null;
      yoy[sku][qLabels[i].period]=(yoyPrior!=null&&yoyPrior!==0)
        ?+(((cur-yoyPrior)/yoyPrior)*100).toFixed(1):null;
    }
  }
  return{
    success:true,
    view:"financial",
    include:"illustrative",
    isIllustrative:true,
    trackingSinceRealDate:null,
    quarterly:{labels:qLabels,series,qoq,yoy},
    monthly:{labels:[],series:{},mom:{},yoy:{}}, // not supported in illustrative mode
  };
}

const finTh={textAlign:"right",padding:"5px 10px",fontSize:10,color:"#6b7280",fontWeight:600,whiteSpace:"nowrap"};
const finThRow={textAlign:"left",padding:"5px 10px",fontSize:10,color:"#6b7280",fontWeight:600,whiteSpace:"nowrap"};
const finTd={textAlign:"right",padding:"4px 10px",fontSize:12,color:"#2563eb",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",whiteSpace:"nowrap"};
const finTdRow={textAlign:"left",padding:"4px 10px",fontSize:11,color:"#111827",fontWeight:600,whiteSpace:"nowrap"};
const finTdDim={textAlign:"right",padding:"4px 10px",fontSize:12,color:"#6b7280",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",whiteSpace:"nowrap"};
const finSectionTh={textAlign:"left",padding:"10px 10px 4px",fontSize:11,color:"#111827",fontWeight:700,textDecoration:"underline",textUnderlineOffset:"3px"};

function fmtMoney(v){
  if(v==null||!isFinite(v))return"—";
  if(v<1)return"$"+v.toFixed(2);
  return"$"+v.toFixed(2);
}
function fmtGrowth(v){
  if(v==null||!isFinite(v))return<span style={{color:"#d1d5db"}}>—</span>;
  const str=v<0?"("+Math.abs(v).toFixed(1)+"%)":v.toFixed(1)+"%";
  const color=v>0?"#059669":v<0?"#dc2626":"#6b7280";
  return <span style={{color}}>{str}</span>;
}

function GPUFinancialCorrelationBlock({fHist,fHistErr}){
  const[mode,setMode]=useState("quarter"); // "quarter" default per investor framing
  const[showSecondary,setShowSecondary]=useState(false);
  const[illustrative,setIllustrative]=useState(false);

  // Illustrative mode overrides the real fHist entirely. Toggle is
  // quarter-only (no monthly illustrative data), so mode is forced to
  // "quarter" while on. Secondary SKUs (A100/GB200/L40S) aren't included
  // in the illustrative payload — the expand button is hidden while on.
  const illFHist=illustrative?buildIllustrativeFHist():null;
  const effFHist=illustrative?illFHist:fHist;
  const effMode=illustrative?"quarter":mode;

  if(!illustrative && fHistErr){
    return(
      <div style={{background:"#f9fafb",border:"1px dashed #d1d5db",borderRadius:8,padding:"14px 16px",marginBottom:14}}>
        <div style={{...S.lbl,color:"#1d4ed8",marginBottom:6}}>Financial correlation view</div>
        <div style={{fontSize:11,color:"#6b7280"}}>Financial view service temporarily unavailable — operational history below still loads.</div>
        <div style={{marginTop:10}}>
          <IllustrativeToggle illustrative={illustrative} setIllustrative={setIllustrative}/>
        </div>
      </div>
    );
  }
  if(!illustrative && !fHist){
    return(
      <div style={{marginBottom:14}}>
        <div style={{...S.lbl,color:"#1d4ed8",marginBottom:8}}>Financial correlation view</div>
        <Shimmer rows={3}/>
      </div>
    );
  }

  const since=effFHist.trackingSinceRealDate;
  const periods=effMode==="quarter"?(effFHist.quarterly?.labels||[]):(effFHist.monthly?.labels||[]);
  const series=effMode==="quarter"?(effFHist.quarterly?.series||{}):(effFHist.monthly?.series||{});
  const growth=effMode==="quarter"?(effFHist.quarterly?.qoq||{}):(effFHist.monthly?.mom||{});
  const yoy=effMode==="quarter"?(effFHist.quarterly?.yoy||{}):(effFHist.monthly?.yoy||{});
  const growthLabel=effMode==="quarter"?"QoQ Growth":"MoM Growth";
  const partialKey=effMode==="quarter"?"isQTD":"isMTD";

  const hasAnyData=periods.length>0;

  return(
    <div style={{marginBottom:14}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,flexWrap:"wrap"}}>
        <div style={{...S.lbl,color:"#1d4ed8"}}>Financial correlation view</div>
        <div style={{display:"inline-flex",border:"0.5px solid #e5e7eb",borderRadius:6,overflow:"hidden",background:"#fff",opacity:illustrative?0.5:1}}>
          {["quarter","month"].map(v=>{
            const active=effMode===v;
            const disabled=illustrative&&v==="month";
            return(
              <button key={v} onClick={()=>!disabled&&setMode(v)} disabled={disabled}
                title={disabled?"Illustrative data is quarterly-only":undefined}
                style={{fontSize:11,padding:"4px 12px",border:"none",background:active?"#111827":"#fff",color:active?"#fff":"#6b7280",cursor:disabled?"not-allowed":"pointer",fontFamily:"inherit",fontWeight:500,textTransform:"capitalize"}}>
                {v==="quarter"?"Quarter":"Month"}
              </button>
            );
          })}
        </div>
        <span style={{fontSize:10,color:"#9ca3af",flex:1,minWidth:0}}>
          Analyst lens · period averages of daily $/hr · quarter labels = quarter-end month (Mar/Jun/Sep/Dec)
        </span>
        <IllustrativeToggle illustrative={illustrative} setIllustrative={setIllustrative}/>
      </div>

      {/* Illustrative warning banner */}
      {illustrative&&(
        <div style={{background:"#fef3c7",border:"1px solid #fbbf24",borderRadius:8,padding:"10px 12px",marginBottom:8,fontSize:11,color:"#92400e",lineHeight:1.5}}>
          <div style={{fontWeight:700,marginBottom:2,textTransform:"uppercase",letterSpacing:".04em",fontSize:10}}>⚠ Illustrative — design preview only</div>
          Values below are <b style={{fontWeight:600}}>not sourced from live data</b>. This toggle renders a fixed layout preview of what the full matrix will look like once real quarterly history accumulates. No values are written to KV. No real capture is affected. Flip off to return to the real-only investor view.
        </div>
      )}

      {/* Tracking-since caption (real mode only) */}
      {!illustrative&&since&&(
        <div style={{fontSize:11,color:"#9ca3af",marginBottom:8}}>
          Real tracking since <b style={{color:"#6b7280",fontWeight:600}}>{since}</b>
          {" · "}
          {periods.length} {effMode==="quarter"?"quarter":"month"}{periods.length===1?"":"s"} observed
          {" · "}
          growth rows populate once at least two real periods exist; YoY requires a period from one year prior
        </div>
      )}

      {/* Matrix or empty */}
      {!hasAnyData?(
        <div style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:8,padding:"14px 16px"}}>
          <div style={{fontSize:12,color:"#111827",fontWeight:500}}>Matrix populates as real daily snapshots accumulate</div>
          <div style={{fontSize:11,color:"#6b7280",marginTop:3}}>
            This view will show one column per calendar {effMode==="quarter"?"quarter":"month"} and include QoQ/MoM + YoY growth rows once enough real data exists. Flip the <b>Illustrative</b> toggle above to preview the full-matrix layout with non-live placeholder values.
          </div>
        </div>
      ):(
        <div style={{border:"0.5px solid #e5e7eb",borderRadius:8,overflow:"hidden",background:"#f9fafb"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",background:"#f3f4f6"}}>
              <thead>
                <tr>
                  <th style={{...finThRow,minWidth:170}}></th>
                  {periods.map(p=>{
                    // Partial flag = any primary OR visible secondary SKU has that period partial
                    const rowPool=showSecondary?[...GPU_FIN_PRIMARY_ROWS,...GPU_FIN_SECONDARY_ROWS]:GPU_FIN_PRIMARY_ROWS;
                    let partial=false;
                    for(const row of rowPool){
                      const sr=(series[row.sku]||[]).find(x=>x.period===p.period);
                      if(sr&&sr[partialKey]){partial=true;break;}
                    }
                    return(
                      <th key={p.period} style={finTh}>
                        {p.label}
                        {partial&&<span style={{marginLeft:3,fontSize:8,color:"#b45309",fontWeight:500}}>{mode==="quarter"?"QTD":"MTD"}</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {/* Section A: Pricing per Hour */}
                <tr><td colSpan={periods.length+1} style={finSectionTh}>Pricing per Hour</td></tr>
                {renderFinPriceRows(GPU_FIN_PRIMARY_ROWS,series,periods,partialKey)}
                {!illustrative&&showSecondary&&renderFinPriceRows(GPU_FIN_SECONDARY_ROWS,series,periods,partialKey,true)}

                {/* Spacer */}
                <tr><td colSpan={periods.length+1} style={{height:8}}></td></tr>

                {/* Section B: QoQ/MoM Growth */}
                <tr><td colSpan={periods.length+1} style={finSectionTh}>{growthLabel}</td></tr>
                {renderFinGrowthRows(GPU_FIN_PRIMARY_ROWS,growth,periods)}
                {!illustrative&&showSecondary&&renderFinGrowthRows(GPU_FIN_SECONDARY_ROWS,growth,periods,true)}

                {/* Spacer */}
                <tr><td colSpan={periods.length+1} style={{height:8}}></td></tr>

                {/* Section C: YoY Growth */}
                <tr><td colSpan={periods.length+1} style={finSectionTh}>YoY Growth</td></tr>
                {renderFinGrowthRows(GPU_FIN_PRIMARY_ROWS,yoy,periods)}
                {!illustrative&&showSecondary&&renderFinGrowthRows(GPU_FIN_SECONDARY_ROWS,yoy,periods,true)}
              </tbody>
            </table>
          </div>

          {/* Show more / Collapse secondary rows — hidden in illustrative mode (no secondary data) */}
          {!illustrative&&(
            <div style={{padding:"6px 10px",borderTop:"0.5px solid #e5e7eb",background:"#fafafa",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6}}>
              <span style={{fontSize:10,color:"#9ca3af"}}>
                {showSecondary?"Primary + secondary GPUs (6 tracked)":"Primary GPUs (B200/H200/H100)"} · tracked basket is fixed at the strategic 6 accelerators; other 85+ SKUs render live in the Infra Monitoring tab's vendor table.
              </span>
              <button onClick={()=>setShowSecondary(s=>!s)}
                style={{fontSize:10,padding:"4px 10px",border:"0.5px solid #d1d5db",borderRadius:4,background:"#fff",color:"#374151",cursor:"pointer",fontFamily:"inherit",fontWeight:500}}>
                {showSecondary?"− Hide secondary (A100 / GB200 / L40S)":"+ Show A100 / GB200 / L40S"}
              </button>
            </div>
          )}
          {illustrative&&(
            <div style={{padding:"6px 10px",borderTop:"0.5px solid #e5e7eb",background:"#fafafa",fontSize:10,color:"#9ca3af"}}>
              Illustrative data covers primary GPUs only (B200 / H200 / H100). Secondary expansion is disabled while the illustrative toggle is on.
            </div>
          )}
        </div>
      )}

      {/* Methodology footnote */}
      <div style={{fontSize:10,color:"#9ca3af",lineHeight:1.5,marginTop:6}}>
        <b style={{color:"#6b7280",fontWeight:600}}>Methodology:</b> {illustrative
          ? "Illustrative mode renders operator-supplied placeholder values for layout preview — NOT sourced from live data and NOT persisted. QoQ / YoY growth rows below are derived arithmetically from those placeholder values. Flip the toggle off to return to real-only data."
          : <>Period averages = arithmetic mean of daily minPricePerHour within the calendar {effMode==="quarter"?"quarter":"month"} (not month-of-months — daily average avoids coverage-weighted bias). {effMode==="quarter"?"QoQ":"MoM"} = (current {effMode} avg − prior {effMode} avg) / prior {effMode} avg × 100. YoY = (current {effMode} avg − same {effMode} previous year avg) / same {effMode} previous year avg × 100. Quarter labels are quarter-end month to match equity conventions. Real-only by default; synthetic/backfill snapshots are excluded.</>
        }
      </div>
    </div>
  );
}

function IllustrativeToggle({illustrative,setIllustrative}){
  return(
    <label style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:10,color:illustrative?"#92400e":"#6b7280",cursor:"pointer",padding:"3px 8px",borderRadius:12,background:illustrative?"#fef3c7":"#fff",border:"0.5px solid "+(illustrative?"#fbbf24":"#e5e7eb"),fontWeight:500,whiteSpace:"nowrap"}}>
      <span style={{position:"relative",width:24,height:14,background:illustrative?"#f59e0b":"#d1d5db",borderRadius:7,transition:"background 0.15s",flexShrink:0}}>
        <span style={{position:"absolute",top:1,left:illustrative?11:1,width:12,height:12,background:"#fff",borderRadius:"50%",transition:"left 0.15s",boxShadow:"0 1px 2px rgba(0,0,0,0.15)"}}/>
      </span>
      <input type="checkbox" checked={illustrative} onChange={e=>setIllustrative(e.target.checked)} style={{display:"none"}}/>
      <span>Illustrative (design preview)</span>
    </label>
  );
}

function renderFinPriceRows(rows,series,periods,partialKey,dim){
  return rows.map(row=>{
    const byPeriod=Object.fromEntries((series[row.sku]||[]).map(x=>[x.period,x]));
    return(
      <tr key={"price-"+row.sku}>
        <td style={{...finTdRow,color:dim?"#6b7280":"#111827"}}>{row.shortLabel}</td>
        {periods.map(p=>{
          const s=byPeriod[p.period];
          const val=s?s.avgMinPricePerHour:null;
          return(
            <td key={p.period} style={{...finTd,color:dim?"#6b7280":finTd.color}}>
              {fmtMoney(val)}
            </td>
          );
        })}
      </tr>
    );
  });
}

function renderFinGrowthRows(rows,growth,periods,dim){
  return rows.map(row=>{
    const row_g=growth[row.sku]||{};
    return(
      <tr key={"g-"+row.sku}>
        <td style={{...finTdRow,color:dim?"#6b7280":"#111827"}}>{row.shortLabel}</td>
        {periods.map(p=>(
          <td key={p.period} style={finTdDim}>{fmtGrowth(row_g[p.period])}</td>
        ))}
      </tr>
    );
  });
}

/* ─── GPU History Shell ─────────────────────────────────────
   Segmented Quarter | Daily toggle; Quarter is the investor-facing
   default. Quarter view uses /api/gpu-hardware-pricing-history?view=quarter
   (real-only by default — backfill/synthetic seeds are excluded). Daily
   view remains available as a secondary drill-down. */
function GPUHistoryShell({histView,setHistView,qHist,qHistErr,hist,histErr}){
  return(
    <div style={{marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,flexWrap:"wrap"}}>
        <div style={{...S.lbl,color:"#0e7490"}}>GPU Pricing History</div>
        <div style={{display:"inline-flex",border:"0.5px solid #e5e7eb",borderRadius:6,overflow:"hidden",background:"#fff"}}>
          {["quarter","daily"].map(v=>{
            const active=histView===v;
            return(
              <button key={v} onClick={()=>setHistView(v)}
                style={{fontSize:11,padding:"4px 12px",border:"none",background:active?"#111827":"#fff",color:active?"#fff":"#6b7280",cursor:"pointer",fontFamily:"inherit",fontWeight:500,textTransform:"capitalize"}}>
                {v==="quarter"?"Quarter (QoQ)":"Daily"}
              </button>
            );
          })}
        </div>
        <span style={{fontSize:10,color:"#9ca3af"}}>
          Investor lens · daily snapshots aggregated by calendar quarter (Q1 Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep, Q4 Oct–Dec UTC)
        </span>
      </div>
      {histView==="quarter"
        ? <GPUQuarterlyBlock qHist={qHist} qHistErr={qHistErr}/>
        : <GPUHistoryBlock hist={hist} histErr={histErr} hideHeader/>
      }
    </div>
  );
}

/* ─── Quarterly GPU Pricing History ─────────────────────────
   QoQ signal cards · quarter comparison table · quarter matrix
   Values default to quarter-CLOSE (the last real snapshot inside the
   quarter). Quarter-average is computed and surfaced separately — it
   never silently replaces close-to-close. Low-coverage quarters (any
   quarter with <25% daily coverage) are flagged in the UI. */
const GPU_QUARTER_QOQ_SKUS=["Nvidia H100","Nvidia H200","Nvidia B200","Nvidia A100"];

function fmtPct(v,digits=1){
  if(v==null||!isFinite(v))return"—";
  return (v>0?"+":"")+v.toFixed(digits)+"%";
}
function fmtNum(v,digits=2){
  if(v==null||!isFinite(v))return"—";
  return (v>0?"+":"")+v.toFixed(digits);
}
function fmtInt(v){
  if(v==null||!isFinite(v))return"—";
  return (v>0?"+":"")+Math.round(v);
}

/* State machine for the quarter section.
   - service_unavailable       → qHistErr
   - loading                   → no response yet
   - empty_no_tracking         → no real snapshots at all
   - insufficient_history_bootstrap  → ≥1 real snapshot but no SKU has qoq.status==="ok"
   - qoq_available             → at least one SKU has a real prior completed quarter
*/
function computeSectionMode(qHist,qHistErr){
  if(qHistErr)return"service_unavailable";
  if(!qHist)return"loading";
  if(!qHist.trackingSinceRealDate)return"empty_no_tracking";
  const qoq=qHist.qoq||{};
  const anyQoQ=Object.values(qoq).some(c=>c&&c.status==="ok");
  return anyQoQ?"qoq_available":"insufficient_history_bootstrap";
}

function nextQuarterId(qid){
  // "2026-Q2" → "2026-Q3"; "2026-Q4" → "2027-Q1"
  const m=/^(\d{4})-Q([1-4])$/.exec(qid||"");
  if(!m)return null;
  const year=parseInt(m[1],10);
  const q=parseInt(m[2],10);
  if(q<4)return year+"-Q"+(q+1);
  return (year+1)+"-Q1";
}

function qtdStatusLabel(q){
  if(!q)return"no data";
  const d=q.daysCoveredInQuarter||0;
  const cov=q.coverageRatioWithinQuarter||0;
  if(d<3)return"early tracking";
  if(cov<0.25)return"low coverage";
  if(cov<0.60)return"building history";
  return"monitoring-grade (not yet QoQ)";
}

function GPUQuarterlyBlock({qHist,qHistErr}){
  const mode=computeSectionMode(qHist,qHistErr);

  if(mode==="service_unavailable"){
    return(
      <div style={{background:"#f9fafb",border:"1px dashed #d1d5db",borderRadius:8,padding:"14px 16px"}}>
        <div style={{fontSize:11,color:"#6b7280"}}>Quarter service temporarily unavailable — live embed below still loads.</div>
      </div>
    );
  }
  if(mode==="loading"){
    return <Shimmer rows={3}/>;
  }
  if(mode==="empty_no_tracking"){
    return(
      <div style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:10,padding:"14px 16px"}}>
        <div style={{fontSize:12,color:"#111827",fontWeight:500}}>Tracking starts with the next daily capture</div>
        <div style={{fontSize:11,color:"#6b7280",marginTop:3}}>
          Real production snapshots will accumulate here. QTD metrics and QoQ comparisons appear automatically once real data is captured.
        </div>
      </div>
    );
  }

  const since=qHist.trackingSinceRealDate;
  const latest=qHist.latestRealSnapshotDate;
  const quarters=qHist.quartersAvailable||[];
  const series=qHist.series||{};
  const qoq=qHist.qoq||{};
  const signals=qHist.signals||{};
  const trackedSKUs=qHist.trackedSKUs||[];

  // Current quarter per SKU = last element in that SKU's quarter series (real-only).
  const currentQuarterBySku={};
  for(const sku of trackedSKUs){
    const qs=series[sku]||[];
    currentQuarterBySku[sku]=qs[qs.length-1]||null;
  }
  // Section-wide "current quarter" label — derived from whichever SKU has data.
  const anyCurrent=Object.values(currentQuarterBySku).find(q=>q);
  const currentQuarterId=anyCurrent?.quarter||null;
  const firstQoQQuarter=currentQuarterId?nextQuarterId(currentQuarterId):null;
  const currentIsQTD=anyCurrent?.isQTD===true;

  const bootstrap=mode==="insufficient_history_bootstrap";

  return(
    <div>
      {/* Header line — always rendered */}
      <div style={{fontSize:11,color:"#9ca3af",marginBottom:8}}>
        Tracking since <b style={{color:"#6b7280",fontWeight:600}}>{since}</b>
        {latest&&latest!==since&&<> · latest <b style={{color:"#6b7280",fontWeight:600}}>{latest}</b></>}
        {" · "}{quarters.length} quarter{quarters.length===1?"":"s"} observed
        {" · "}<span style={{color:"#6b7280"}}>
          {bootstrap?"QTD build-up · QoQ unlocks at "+(firstQoQQuarter||"next quarter"):"QoQ = quarter-close vs prior-quarter close"}
        </span>
      </div>

      {/* Bootstrap banner + building-history strip (bootstrap mode only) */}
      {bootstrap&&(
        <BootstrapExplainer since={since} currentQuarterId={currentQuarterId} currentQuarter={anyCurrent} firstQoQQuarter={firstQoQQuarter} trackedSKUs={trackedSKUs} currentQuarterBySku={currentQuarterBySku}/>
      )}

      {/* Cards row — QoQ cards in qoq mode, QTD NOW cards in bootstrap mode. */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8,marginBottom:10}}>
        {GPU_QUARTER_QOQ_SKUS.map(sku=>{
          const c=qoq[sku];
          const cur=currentQuarterBySku[sku];
          const short=sku.replace(/^Nvidia\s+/i,"");
          // Per-SKU mode selector: QoQ if this SKU specifically has ok status; QTD if we have current-quarter data; empty otherwise.
          if(c&&c.status==="ok"){
            return <QoQCard key={sku} short={short} c={c} sig={signals[sku]}/>;
          }
          if(cur){
            return <QTDNowCard key={sku} short={short} since={since} cur={cur} firstQoQQuarter={firstQoQQuarter}/>;
          }
          return(
            <div key={sku} style={{background:"#fafafa",border:"0.5px solid #e5e7eb",borderRadius:8,padding:"10px 12px"}}>
              <div style={{...S.lbl,color:"#6b7280",fontSize:9}}>{short} · no current data</div>
              <div style={{fontSize:11,color:"#9ca3af",marginTop:4}}>no real snapshot yet</div>
            </div>
          );
        })}
      </div>

      {/* Primary table — switches on section mode */}
      {bootstrap
        ? <CurrentQuarterSnapshotTable trackedSKUs={trackedSKUs} currentQuarterBySku={currentQuarterBySku} firstQoQQuarter={firstQoQQuarter}/>
        : <QoQComparisonTable trackedSKUs={trackedSKUs} qoq={qoq} series={series} signals={signals} currentQuarterBySku={currentQuarterBySku}/>
      }

      {/* Quarter matrix — close min $/hr by SKU × quarter */}
      {quarters.length>=1&&(
        <div style={{border:"0.5px solid #e5e7eb",borderRadius:8,overflow:"hidden",background:"#fff",marginBottom:10}}>
          <div style={{padding:"9px 14px",borderBottom:"0.5px solid #f3f4f6",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:11,fontWeight:600,color:"#111827"}}>Quarter-close min $/hr · SKU × quarter matrix</span>
            <span style={{fontSize:10,color:"#9ca3af"}}>quarter average shown in parentheses · QTD quarters marked</span>
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{background:"#fafafa"}}>
                  <th style={gpuTh}>GPU</th>
                  {quarters.map(q=>(
                    <th key={q} style={{...gpuTh,textAlign:"right"}}>{q}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trackedSKUs.map(sku=>{
                  const quarterHistory=series[sku]||[];
                  const byQuarter={};
                  for(const q of quarterHistory)byQuarter[q.quarter]=q;
                  return(
                    <tr key={sku} style={{borderTop:"0.5px solid #f3f4f6"}}>
                      <td style={gpuTd}><span style={{fontWeight:600,color:"#111827"}}>{sku}</span></td>
                      {quarters.map(qid=>{
                        const q=byQuarter[qid];
                        if(!q)return <td key={qid} style={{...gpuTd,textAlign:"right",color:"#d1d5db"}}>—</td>;
                        const close=q.quarterCloseMinPricePerHour;
                        const avg=q.quarterAverageMinPricePerHour;
                        return(
                          <td key={qid} style={{...gpuTd,textAlign:"right"}}>
                            <div style={{fontWeight:600,color:"#059669"}}>{close!=null?"$"+close.toFixed(2):"—"}{q.isQTD&&<span style={{fontSize:9,color:"#9ca3af",fontWeight:500,marginLeft:3}}>QTD</span>}</div>
                            {avg!=null&&<div style={{fontSize:10,color:"#9ca3af",marginTop:1}}>avg ${avg.toFixed(2)}</div>}
                            {q.lowCoverage&&<div style={{fontSize:9,color:"#b45309",marginTop:1}}>⚠ low coverage</div>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Methodology note */}
      <div style={{fontSize:10,color:"#9ca3af",lineHeight:1.5,marginBottom:4}}>
        <b style={{color:"#6b7280",fontWeight:600}}>Methodology:</b> QoQ uses quarter-close values (last real snapshot in the quarter). Quarter averages are computed across all real snapshots in the quarter and surfaced separately — they do not replace close-to-close. Coverage = distinct real snapshot days / calendar days in the quarter (QTD quarters use elapsed days only). Synthetic/backfill-only validation points are excluded; append <code>?include=all</code> to the history endpoint to inspect them.
      </div>
    </div>
  );
}

function BootstrapExplainer({since,currentQuarterId,currentQuarter,firstQoQQuarter,trackedSKUs,currentQuarterBySku}){
  // Aggregate strip: use the best-covered current-quarter entry to describe progress.
  const qs=trackedSKUs.map(s=>currentQuarterBySku[s]).filter(Boolean);
  const bestCovered=qs.reduce((a,b)=>{
    if(!a)return b;
    if(!b)return a;
    return (b.coverageRatioWithinQuarter||0)>(a.coverageRatioWithinQuarter||0)?b:a;
  },null);
  const daysCovered=bestCovered?bestCovered.daysCoveredInQuarter:0;
  const denom=bestCovered?bestCovered.quarterDayCount:null;
  const coveragePct=bestCovered&&denom?Math.round((daysCovered/denom)*100):0;
  return(
    <>
      <div style={{background:"#ecfeff",border:"0.5px solid #a5f3fc",borderRadius:8,padding:"10px 12px",marginBottom:10,fontSize:11,color:"#155e75",lineHeight:1.5}}>
        <b style={{fontWeight:600}}>Quarter view is live.</b> Real tracking began on <b style={{fontWeight:600}}>{since}</b>, so this section currently shows <b style={{fontWeight:600}}>QTD build-up metrics</b> — real snapshots of close price, provider count, and spread for the in-progress quarter. True QoQ comparisons appear automatically once the first prior quarter completes{firstQoQQuarter?(<> (first QoQ quarter: <b style={{fontWeight:600}}>{firstQoQQuarter}</b>)</>):null}.
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8,marginBottom:10}}>
        <MiniStat label="Tracking since" value={since||"—"}/>
        <MiniStat label="Current quarter" value={currentQuarterId?(currentQuarterId+(currentQuarter?.isQTD?" (QTD)":"")):"—"}/>
        <MiniStat label="Days captured" value={denom!=null?(daysCovered+" of "+denom):String(daysCovered)}/>
        <MiniStat label="Coverage" value={coveragePct+"%"} warn={coveragePct<25}/>
        <MiniStat label="First QoQ quarter" value={firstQoQQuarter||"—"} sub="QoQ unlocks here"/>
      </div>
    </>
  );
}

function MiniStat({label,value,sub,warn}){
  return(
    <div style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:8,padding:"8px 10px"}}>
      <div style={{...S.lbl,color:"#6b7280",fontSize:9}}>{label}</div>
      <div style={{fontSize:13,fontWeight:700,color:warn?"#b45309":"#111827",marginTop:3,lineHeight:1.1}}>{value}</div>
      {sub&&<div style={{fontSize:9,color:"#9ca3af",marginTop:2}}>{sub}</div>}
    </div>
  );
}

function QoQCard({short,c,sig}){
  const pct=c.qoqPct;
  const up=pct!=null&&pct>0;
  const down=pct!=null&&pct<0;
  const color=up?"#dc2626":down?"#059669":"#6b7280";
  const arrow=up?"▲":down?"▼":"•";
  const sigBg=sig==="loosening"?"#dcfce7":sig==="tightening"?"#fee2e2":sig==="stable"?"#f3f4f6":"#f3f4f6";
  const sigFg=sig==="loosening"?"#059669":sig==="tightening"?"#dc2626":sig==="stable"?"#6b7280":"#9ca3af";
  const sigLabel=sig==="loosening"?"loosening":sig==="tightening"?"tightening":sig==="stable"?"stable":null;
  return(
    <div style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:8,padding:"10px 12px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:6}}>
        <div style={{...S.lbl,color:"#6b7280",fontSize:9}}>
          {short} · QoQ {c.currentIsQTD&&<span style={{color:"#9ca3af",fontWeight:500}}>(QTD)</span>}
        </div>
        {sigLabel&&<span style={{fontSize:9,padding:"1px 6px",borderRadius:3,background:sigBg,color:sigFg,fontWeight:600,textTransform:"uppercase",letterSpacing:".04em"}}>{sigLabel}</span>}
      </div>
      <div style={{display:"flex",alignItems:"baseline",gap:6,marginTop:4}}>
        <span style={{fontSize:16,fontWeight:700,color}}>{arrow}&nbsp;{fmtPct(pct)}</span>
        <span style={{fontSize:11,color:"#6b7280"}}>close $/hr</span>
      </div>
      <div style={{fontSize:10,color:"#9ca3af",marginTop:3}}>
        {c.priorQuarter} ${c.priorClose?.toFixed(2)} → {c.currentQuarter} ${c.currentClose?.toFixed(2)}
        {c.providerDelta!=null&&<> · providers {fmtInt(c.providerDelta)}</>}
      </div>
      {c.lowCoverageFlag&&<div style={{fontSize:9,color:"#b45309",marginTop:2}}>⚠ low-coverage quarter — close may be imprecise</div>}
    </div>
  );
}

function QTDNowCard({short,cur,since,firstQoQQuarter}){
  const coveragePct=Math.round((cur.coverageRatioWithinQuarter||0)*100);
  return(
    <div style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:8,padding:"10px 12px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:6}}>
        <div style={{...S.lbl,color:"#0e7490",fontSize:9}}>
          {short} · QTD NOW
          {cur.isQTD&&<span style={{color:"#9ca3af",fontWeight:500,marginLeft:4}}>({cur.quarter})</span>}
        </div>
      </div>
      <div style={{display:"flex",alignItems:"baseline",gap:6,marginTop:4}}>
        <span style={{fontSize:16,fontWeight:700,color:"#059669"}}>{cur.quarterCloseMinPricePerHour!=null?"$"+cur.quarterCloseMinPricePerHour.toFixed(2):"—"}</span>
        <span style={{fontSize:11,color:"#6b7280"}}>close $/hr</span>
      </div>
      <div style={{fontSize:10,color:"#9ca3af",marginTop:3}}>
        avg ${cur.quarterAverageMinPricePerHour!=null?cur.quarterAverageMinPricePerHour.toFixed(2):"—"}
        {cur.quarterCloseProviderCount!=null&&<> · {cur.quarterCloseProviderCount} providers</>}
        {cur.quarterCloseSpreadMultiple!=null&&<> · spread {cur.quarterCloseSpreadMultiple.toFixed(1)}×</>}
      </div>
      <div style={{fontSize:10,color:"#9ca3af",marginTop:2}}>
        {cur.daysCoveredInQuarter}d observed · {coveragePct}% coverage
        {cur.lowCoverage&&<span style={{color:"#b45309",marginLeft:4}}>⚠</span>}
      </div>
      <div style={{fontSize:9,color:"#9ca3af",marginTop:4,borderTop:"0.5px dashed #e5e7eb",paddingTop:4}}>
        QoQ available after first completed prior quarter{firstQoQQuarter?(<> · first QoQ: <b style={{fontWeight:600,color:"#6b7280"}}>{firstQoQQuarter}</b></>):null}
      </div>
    </div>
  );
}

function CurrentQuarterSnapshotTable({trackedSKUs,currentQuarterBySku,firstQoQQuarter}){
  return(
    <div style={{border:"0.5px solid #e5e7eb",borderRadius:8,overflow:"hidden",background:"#fff",marginBottom:10}}>
      <div style={{padding:"9px 14px",borderBottom:"0.5px solid #f3f4f6",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <span style={{fontSize:11,fontWeight:600,color:"#111827"}}>Current quarter snapshot (QTD)</span>
        <span style={{fontSize:10,color:"#9ca3af"}}>
          real-only · QoQ comparison unavailable until a prior quarter completes{firstQoQQuarter?" ("+firstQoQQuarter+")":""}
        </span>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr style={{background:"#fafafa"}}>
              <th style={gpuTh}>GPU</th>
              <th style={{...gpuTh,textAlign:"right"}}>QTD&nbsp;close&nbsp;$/hr</th>
              <th style={{...gpuTh,textAlign:"right"}}>QTD&nbsp;avg&nbsp;$/hr</th>
              <th style={{...gpuTh,textAlign:"right"}}>Providers</th>
              <th style={{...gpuTh,textAlign:"right"}}>Spread×</th>
              <th style={{...gpuTh,textAlign:"right"}}>Days&nbsp;observed</th>
              <th style={gpuTh}>Coverage</th>
              <th style={gpuTh}>Status</th>
            </tr>
          </thead>
          <tbody>
            {trackedSKUs.map(sku=>{
              const cur=currentQuarterBySku[sku];
              if(!cur){
                return(
                  <tr key={sku} style={{borderTop:"0.5px solid #f3f4f6"}}>
                    <td style={gpuTd}><span style={{fontWeight:600,color:"#111827"}}>{sku}</span></td>
                    <td colSpan="7" style={{...gpuTd,color:"#9ca3af"}}>no real snapshot yet</td>
                  </tr>
                );
              }
              const coveragePct=Math.round((cur.coverageRatioWithinQuarter||0)*100);
              const status=qtdStatusLabel(cur);
              const statusColor=status==="early tracking"?"#6b7280":status==="low coverage"?"#b45309":status==="building history"?"#0e7490":"#059669";
              return(
                <tr key={sku} style={{borderTop:"0.5px solid #f3f4f6"}}>
                  <td style={gpuTd}>
                    <div style={{fontWeight:600,color:"#111827"}}>{sku}</div>
                    <div style={{fontSize:10,color:"#9ca3af",marginTop:1}}>{cur.quarter}{cur.isQTD?" · QTD":""}</div>
                  </td>
                  <td style={{...gpuTd,textAlign:"right",color:"#059669",fontWeight:600}}>
                    {cur.quarterCloseMinPricePerHour!=null?"$"+cur.quarterCloseMinPricePerHour.toFixed(2):"—"}
                  </td>
                  <td style={{...gpuTd,textAlign:"right",color:"#374151"}}>
                    {cur.quarterAverageMinPricePerHour!=null?"$"+cur.quarterAverageMinPricePerHour.toFixed(2):"—"}
                  </td>
                  <td style={{...gpuTd,textAlign:"right",color:"#374151"}}>{cur.quarterCloseProviderCount??"—"}</td>
                  <td style={{...gpuTd,textAlign:"right",color:"#6b7280"}}>{cur.quarterCloseSpreadMultiple!=null?cur.quarterCloseSpreadMultiple.toFixed(1)+"×":"—"}</td>
                  <td style={{...gpuTd,textAlign:"right",color:"#374151"}}>{cur.daysCoveredInQuarter}</td>
                  <td style={{...gpuTd,color:"#6b7280",fontSize:11}}>
                    {coveragePct}% of {cur.quarterDayCount}d
                    {cur.lowCoverage&&<span style={{color:"#b45309",marginLeft:4}}>⚠</span>}
                  </td>
                  <td style={{...gpuTd,color:statusColor,fontWeight:600,fontSize:11}}>{status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QoQComparisonTable({trackedSKUs,qoq,series,signals,currentQuarterBySku}){
  return(
    <div style={{border:"0.5px solid #e5e7eb",borderRadius:8,overflow:"hidden",background:"#fff",marginBottom:10}}>
      <div style={{padding:"9px 14px",borderBottom:"0.5px solid #f3f4f6",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:11,fontWeight:600,color:"#111827"}}>Quarter-close comparison (prior vs current)</span>
        <span style={{fontSize:10,color:"#9ca3af"}}>current = last real snapshot in quarter (QTD if in progress)</span>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr style={{background:"#fafafa"}}>
              <th style={gpuTh}>GPU</th>
              <th style={{...gpuTh,textAlign:"right"}}>Prior&nbsp;close&nbsp;$/hr</th>
              <th style={{...gpuTh,textAlign:"right"}}>Current&nbsp;close&nbsp;$/hr</th>
              <th style={{...gpuTh,textAlign:"right"}}>QoQ&nbsp;Δ</th>
              <th style={{...gpuTh,textAlign:"right"}}>Prior&nbsp;providers</th>
              <th style={{...gpuTh,textAlign:"right"}}>Current&nbsp;providers</th>
              <th style={{...gpuTh,textAlign:"right"}}>QoQ&nbsp;Δ&nbsp;providers</th>
              <th style={{...gpuTh,textAlign:"right"}}>Prior&nbsp;spread×</th>
              <th style={{...gpuTh,textAlign:"right"}}>Current&nbsp;spread×</th>
              <th style={{...gpuTh,textAlign:"right"}}>QoQ&nbsp;Δ&nbsp;spread</th>
              <th style={gpuTh}>Coverage</th>
              <th style={gpuTh}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {trackedSKUs.map(sku=>{
              const c=qoq[sku];
              const cur=currentQuarterBySku[sku];
              const coverageText=cur?(Math.round((cur.coverageRatioWithinQuarter||0)*100)+"% of "+cur.quarterDayCount+"d"):"—";
              const trendLabel=(()=>{
                const sig=signals[sku];
                if(!sig||sig==="insufficient-data")return <span style={{color:"#9ca3af"}}>QTD only</span>;
                const color=sig==="loosening"?"#059669":sig==="tightening"?"#dc2626":"#6b7280";
                return <span style={{color,fontWeight:600,textTransform:"capitalize"}}>{sig}</span>;
              })();
              return(
                <tr key={sku} style={{borderTop:"0.5px solid #f3f4f6"}}>
                  <td style={gpuTd}><span style={{fontWeight:600,color:"#111827"}}>{sku}</span></td>
                  <td style={{...gpuTd,textAlign:"right",color:"#374151"}}>{c?.priorClose!=null?"$"+c.priorClose.toFixed(2):"—"}</td>
                  <td style={{...gpuTd,textAlign:"right",color:"#059669",fontWeight:600}}>
                    {c?.currentClose!=null?"$"+c.currentClose.toFixed(2):(cur?.quarterCloseMinPricePerHour!=null?"$"+cur.quarterCloseMinPricePerHour.toFixed(2):"—")}
                    {(c?.currentIsQTD||cur?.isQTD)&&<span style={{fontSize:9,color:"#9ca3af",fontWeight:500,marginLeft:3}}>QTD</span>}
                  </td>
                  <td style={{...gpuTd,textAlign:"right"}}><QoQCell v={c?.qoqPct} suffix="%"/></td>
                  <td style={{...gpuTd,textAlign:"right",color:"#6b7280"}}>{c?.priorProviders??"—"}</td>
                  <td style={{...gpuTd,textAlign:"right",color:"#374151"}}>{c?.currentProviders??cur?.quarterCloseProviderCount??"—"}</td>
                  <td style={{...gpuTd,textAlign:"right"}}><QoQCell v={c?.providerDelta} integer/></td>
                  <td style={{...gpuTd,textAlign:"right",color:"#6b7280"}}>{c?.priorSpread!=null?c.priorSpread.toFixed(1)+"×":"—"}</td>
                  <td style={{...gpuTd,textAlign:"right",color:"#374151"}}>{c?.currentSpread!=null?c.currentSpread.toFixed(1)+"×":cur?.quarterCloseSpreadMultiple!=null?cur.quarterCloseSpreadMultiple.toFixed(1)+"×":"—"}</td>
                  <td style={{...gpuTd,textAlign:"right"}}><QoQCell v={c?.spreadDelta}/></td>
                  <td style={{...gpuTd,color:"#6b7280",fontSize:11}}>
                    {coverageText}
                    {cur?.lowCoverage&&<span style={{color:"#b45309",marginLeft:4}}>⚠</span>}
                  </td>
                  <td style={{...gpuTd}}>{trendLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QoQCell({v,suffix,integer}){
  if(v==null||!isFinite(v))return <span style={{color:"#9ca3af"}}>—</span>;
  const up=v>0;
  const down=v<0;
  const color=up?"#dc2626":down?"#059669":"#6b7280";
  const formatted=integer?fmtInt(v):(v>0?"+":"")+v.toFixed(suffix==="%"?1:2);
  return <span style={{color,fontWeight:600}}>{formatted}{suffix||""}</span>;
}

/* ─── GPU History Block (daily) ─────────────────────────────
   Trend cards + history comparison table + sparklines
   Reads /api/gpu-hardware-pricing-history (layers on top of the
   canonical day:YYYY-MM-DD snapshots written by /api/history-capture
   and /api/gpu-hardware-pricing-history-refresh). */
const GPU_HISTORY_TREND_SKUS=["Nvidia H100","Nvidia H200","Nvidia B200","Nvidia A100"];

function GPUHistoryBlock({hist,histErr,hideHeader}){
  // Hard-failure fallback — history service down, but we keep the rest of the tab alive.
  if(histErr){
    return(
      <div style={{background:"#f9fafb",border:"1px dashed #d1d5db",borderRadius:8,padding:"14px 16px"}}>
        {!hideHeader&&<div style={{...S.lbl,color:"#0e7490",marginBottom:6}}>GPU Pricing History</div>}
        <div style={{fontSize:11,color:"#6b7280"}}>History service temporarily unavailable — live embed below still loads.</div>
      </div>
    );
  }
  // Loading skeleton
  if(!hist){
    return(
      <div>
        {!hideHeader&&<div style={{...S.lbl,color:"#0e7490",marginBottom:8}}>GPU Pricing History</div>}
        <Shimmer rows={3}/>
      </div>
    );
  }

  const since=hist.trackingSinceDate;
  const latest=hist.latestDate;
  const days=hist.daysWithGPU||0;
  const d7=hist.comparisons?.d7||{};
  const d30=hist.comparisons?.d30||{};
  const signals=hist.signals||{};
  const series=hist.series||{};
  const latestBySku=hist.latest||{};
  const trackedSKUs=hist.trackedSKUs||[];

  // Empty-state: index exists but no snapshots had a gpu block yet.
  if(!days){
    return(
      <div style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:10,padding:"14px 16px"}}>
        {!hideHeader&&<div style={{...S.lbl,color:"#0e7490",marginBottom:6}}>GPU Pricing History</div>}
        <div style={{fontSize:12,color:"#111827",fontWeight:500}}>Tracking starts with the next daily capture</div>
        <div style={{fontSize:11,color:"#6b7280",marginTop:3}}>
          Daily snapshots of strategic GPU pricing will accumulate here. 7D and 30D comparisons become available once enough history is captured.
        </div>
      </div>
    );
  }

  return(
    <div>
      {/* Header — suppressed when rendered inside the history shell */}
      {!hideHeader&&(
        <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:6}}>
          <div>
            <div style={{...S.lbl,color:"#0e7490"}}>GPU Pricing History</div>
            <div style={{fontSize:11,color:"#9ca3af",marginTop:2}}>
              Tracking since <b style={{color:"#6b7280",fontWeight:600}}>{since||"—"}</b>
              {latest&&since&&latest!==since&&<> · latest <b style={{color:"#6b7280",fontWeight:600}}>{latest}</b></>}
              {" · "}{days} snapshot{days===1?"":"s"} captured
            </div>
          </div>
        </div>
      )}
      {hideHeader&&(
        <div style={{fontSize:11,color:"#9ca3af",marginBottom:8}}>
          Raw daily view · tracking since <b style={{color:"#6b7280",fontWeight:600}}>{since||"—"}</b>
          {latest&&since&&latest!==since&&<> · latest <b style={{color:"#6b7280",fontWeight:600}}>{latest}</b></>}
          {" · "}{days} real snapshot{days===1?"":"s"}
        </div>
      )}

      {/* Trend cards — 7D change in cheapest $/hr per strategic SKU */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:8,marginBottom:10}}>
        {GPU_HISTORY_TREND_SKUS.map(sku=>{
          const c=d7[sku];
          const latestPt=latestBySku[sku];
          const short=sku.replace(/^Nvidia\s+/i,"");
          if(!c||c.status!=="ok"){
            return(
              <div key={sku} style={{background:"#fafafa",border:"0.5px solid #e5e7eb",borderRadius:8,padding:"10px 12px"}}>
                <div style={{...S.lbl,color:"#6b7280",fontSize:9}}>{short} · 7D change</div>
                <div style={{fontSize:12,fontWeight:600,color:"#9ca3af",marginTop:4}}>not enough data yet</div>
                <div style={{fontSize:10,color:"#9ca3af",marginTop:2}}>tracking since {since}</div>
              </div>
            );
          }
          const pct=c.minDeltaPct;
          const providerDelta=c.providerDelta;
          const up=pct!=null&&pct>0;
          const down=pct!=null&&pct<0;
          const color=up?"#dc2626":down?"#059669":"#6b7280";
          const arrow=up?"▲":down?"▼":"•";
          const sig=signals[sku];
          const sigLabel=sig==="loosening"?"loosening":sig==="tightening"?"tightening":sig==="stable"?"stable":null;
          const sigBg=sig==="loosening"?"#dcfce7":sig==="tightening"?"#fee2e2":sig==="stable"?"#f3f4f6":"#f3f4f6";
          const sigFg=sig==="loosening"?"#059669":sig==="tightening"?"#dc2626":sig==="stable"?"#6b7280":"#9ca3af";
          return(
            <div key={sku} style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:8,padding:"10px 12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:6}}>
                <div style={{...S.lbl,color:"#6b7280",fontSize:9}}>{short} · 7D change</div>
                {sigLabel&&<span style={{fontSize:9,padding:"1px 6px",borderRadius:3,background:sigBg,color:sigFg,fontWeight:600,textTransform:"uppercase",letterSpacing:".04em"}}>{sigLabel}</span>}
              </div>
              <div style={{display:"flex",alignItems:"baseline",gap:6,marginTop:4}}>
                <span style={{fontSize:16,fontWeight:700,color}}>{arrow}&nbsp;{pct==null?"—":(pct>0?"+":"")+pct.toFixed(1)+"%"}</span>
                <span style={{fontSize:11,color:"#6b7280"}}>min $/hr</span>
              </div>
              <div style={{fontSize:10,color:"#9ca3af",marginTop:3}}>
                {latestPt?.minPricePerHour!=null?"now $"+latestPt.minPricePerHour.toFixed(2):"—"}
                {providerDelta!=null&&<> · providers {providerDelta>0?"+":""}{providerDelta}</>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Strategic history comparison table */}
      <div style={{border:"0.5px solid #e5e7eb",borderRadius:8,overflow:"hidden",background:"#fff",marginBottom:10}}>
        <div style={{padding:"9px 14px",borderBottom:"0.5px solid #f3f4f6",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:11,fontWeight:600,color:"#111827"}}>Strategic SKU history</span>
          <span style={{fontSize:10,color:"#9ca3af"}}>latest vs 7D / 30D prior · loosening = more providers or lower floor</span>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{background:"#fafafa"}}>
                <th style={gpuTh}>GPU</th>
                <th style={{...gpuTh,textAlign:"right"}}>Latest&nbsp;min&nbsp;$/hr</th>
                <th style={{...gpuTh,textAlign:"right"}}>7D&nbsp;Δ</th>
                <th style={{...gpuTh,textAlign:"right"}}>30D&nbsp;Δ</th>
                <th style={{...gpuTh,textAlign:"right"}}>Providers</th>
                <th style={{...gpuTh,textAlign:"right"}}>7D&nbsp;Δ&nbsp;providers</th>
                <th style={{...gpuTh,textAlign:"right"}}>Spread×</th>
                <th style={{...gpuTh,textAlign:"right"}}>Trend (60d)</th>
                <th style={gpuTh}>Tracking since</th>
              </tr>
            </thead>
            <tbody>
              {trackedSKUs.map(sku=>{
                const pts=series[sku]||[];
                const latestPt=latestBySku[sku];
                const c7=d7[sku];
                const c30=d30[sku];
                const firstDate=pts[0]?.date||null;
                return(
                  <tr key={sku} style={{borderTop:"0.5px solid #f3f4f6"}}>
                    <td style={gpuTd}><span style={{fontWeight:600,color:"#111827"}}>{sku}</span></td>
                    <td style={{...gpuTd,textAlign:"right",color:"#059669",fontWeight:600}}>{latestPt?.minPricePerHour!=null?"$"+latestPt.minPricePerHour.toFixed(2):"—"}</td>
                    <td style={{...gpuTd,textAlign:"right"}}><DeltaCell c={c7} field="minDeltaPct" suffix="%"/></td>
                    <td style={{...gpuTd,textAlign:"right"}}><DeltaCell c={c30} field="minDeltaPct" suffix="%"/></td>
                    <td style={{...gpuTd,textAlign:"right",color:"#374151"}}>{latestPt?.providerCount??"—"}</td>
                    <td style={{...gpuTd,textAlign:"right"}}><DeltaCell c={c7} field="providerDelta" suffix="" integer/></td>
                    <td style={{...gpuTd,textAlign:"right",color:"#6b7280"}}>{latestPt?.spreadMultiple?latestPt.spreadMultiple.toFixed(1)+"×":"—"}</td>
                    <td style={{...gpuTd,textAlign:"right"}}><Sparkline pts={pts}/></td>
                    <td style={{...gpuTd,color:"#9ca3af",fontSize:11}}>{firstDate||"—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Textual signal summary — only show when data-grounded */}
      {(() => {
        const msgs=[];
        for(const sku of GPU_HISTORY_TREND_SKUS){
          const c=d7[sku];
          const sig=signals[sku];
          if(!c||c.status!=="ok"||!sig||sig==="insufficient-data")continue;
          const short=sku.replace(/^Nvidia\s+/i,"");
          if(sig==="loosening"){
            const parts=[];
            if(c.minDeltaPct!=null&&c.minDeltaPct<=-2)parts.push("min "+c.minDeltaPct.toFixed(1)+"%");
            if(c.providerDelta!=null&&c.providerDelta>0)parts.push("+"+c.providerDelta+" providers");
            if(parts.length)msgs.push(short+" loosening ("+parts.join(" · ")+")");
          } else if(sig==="tightening"){
            const parts=[];
            if(c.minDeltaPct!=null&&c.minDeltaPct>=2)parts.push("min +"+c.minDeltaPct.toFixed(1)+"%");
            if(c.providerDelta!=null&&c.providerDelta<0)parts.push(c.providerDelta+" providers");
            if(parts.length)msgs.push(short+" tightening ("+parts.join(" · ")+")");
          }
        }
        if(!msgs.length)return null;
        return(
          <div style={{background:"#fef3c7",border:"0.5px solid #fde68a",borderRadius:6,padding:"8px 12px",fontSize:11,color:"#92400e",marginBottom:6}}>
            <b style={{fontWeight:600}}>Signal (7D):</b> {msgs.join(" · ")}
          </div>
        );
      })()}
    </div>
  );
}

function DeltaCell({c,field,suffix,integer}){
  if(!c||c.status!=="ok"||c[field]==null){
    return <span style={{color:"#9ca3af"}}>—</span>;
  }
  const v=c[field];
  const up=v>0;
  const down=v<0;
  const color=up?"#dc2626":down?"#059669":"#6b7280";
  const formatted=integer?(v>0?"+":"")+v:(v>0?"+":"")+v.toFixed(1);
  return <span style={{color,fontWeight:600}}>{formatted}{suffix}</span>;
}

function Sparkline({pts,w=80,h=22}){
  if(!pts||pts.length<2)return <span style={{color:"#d1d5db",fontSize:10}}>—</span>;
  const vals=pts.map(p=>p.minPricePerHour).filter(v=>typeof v==="number");
  if(vals.length<2)return <span style={{color:"#d1d5db",fontSize:10}}>—</span>;
  const min=Math.min.apply(null,vals);
  const max=Math.max.apply(null,vals);
  const range=max-min||1;
  const pad=2;
  const step=vals.length>1?(w-pad*2)/(vals.length-1):0;
  const points=vals.map((v,i)=>{
    const x=pad+i*step;
    const y=pad+(h-pad*2)*(1-(v-min)/range);
    return x.toFixed(1)+","+y.toFixed(1);
  }).join(" ");
  const lastV=vals[vals.length-1];
  const firstV=vals[0];
  const trendColor=lastV>firstV?"#dc2626":lastV<firstV?"#059669":"#6b7280";
  return(
    <svg width={w} height={h} style={{display:"inline-block",verticalAlign:"middle"}}>
      <polyline points={points} fill="none" stroke={trendColor} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
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
   AI ADOPTION — OpenRouter Token Demand by Provider
   Finance-model layout: rows = metric groups + provider buckets,
   columns = quarter-end periods (Mar/Jun/Sep/Dec). Mirrors the
   visual language of the GPU Hardware Pricing financial-correlation
   table. Sourced from /api/openrouter-chart-weekly?full=1 (the same
   chart-native payload that drives the live OpenRouter chart embed
   below). Real captured history only — no illustrative data, no
   design-preview toggle. Empty/incomplete comparisons render `—`.
═══════════════════════════════════════════════════════ */
function bucketProviderFromSlug(slug){
  if(!slug||slug==="Others")return null;
  const head=slug.includes("/")?slug.split("/")[0].toLowerCase():"";
  const sl=slug.toLowerCase();
  if(head==="google"||/gemini|gemma/.test(sl))return"google";
  if(head==="openai"||/(^|\/)gpt[-_]|(^|\/)o[1-9]/.test(sl))return"openai";
  if(head==="anthropic"||/claude/.test(sl))return"anthropic";
  return null;
}

function OpenRouterTokenDemandTable(){
  const[state,setState]=useState({phase:"loading",data:null,error:null});
  useEffect(()=>{
    let cancelled=false;
    fetch("/api/openrouter-chart-weekly?full=1")
      .then(r=>r.ok?r.json():Promise.reject(new Error("HTTP "+r.status)))
      .then(d=>{
        if(cancelled)return;
        if(!d||d.success===false){setState({phase:"error",data:null,error:d?.error||"Unknown error"});return;}
        setState({phase:"ready",data:d,error:null});
      })
      .catch(e=>{if(!cancelled)setState({phase:"error",data:null,error:e.message||"Fetch failed"});});
    return()=>{cancelled=true;};
  },[]);

  const header=(
    <>
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
        <span style={{width:7,height:7,borderRadius:"50%",background:"#1d4ed8",display:"inline-block"}}/>
        <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:".09em",fontWeight:700,color:"#1d4ed8"}}>OpenRouter Token Demand</span>
      </div>
      <div style={{marginBottom:10}}>
        <div style={{fontSize:16,fontWeight:700,color:"#111827",lineHeight:1.3}}>OpenRouter Token Demand by Provider</div>
        <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>Quarter-aligned token demand, provider share, and growth — real captured history only.</div>
      </div>
    </>
  );

  if(state.phase==="loading"){
    return(<div style={{marginBottom:16}}>{header}<div style={{...S.card}}><Shimmer rows={5}/></div></div>);
  }
  if(state.phase==="error"){
    return(
      <div style={{marginBottom:16}}>{header}
        <div style={{background:"#fff",border:"0.5px dashed #fca5a5",borderRadius:10,padding:"14px 16px"}}>
          <div style={{fontSize:12,color:"#991b1b",fontWeight:500}}>Token-demand history temporarily unavailable</div>
          <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>{state.error||"/api/openrouter-chart-weekly did not return success"}</div>
        </div>
      </div>
    );
  }

  const weeks=state.data?.weeks||[];
  if(!weeks.length){
    return(
      <div style={{marginBottom:16}}>{header}
        <div style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:10,padding:"14px 16px"}}>
          <div style={{fontSize:12,color:"#111827",fontWeight:500}}>Quarter matrix populates as real OpenRouter weeks accumulate</div>
          <div style={{fontSize:11,color:"#6b7280",marginTop:3}}>This view aggregates the chart-native OpenRouter payload by calendar quarter.</div>
        </div>
      </div>
    );
  }

  // Group weeks into calendar quarters; sum tokens per provider bucket.
  const groups=new Map();
  const QLBL=["Mar","Jun","Sep","Dec"]; // quarter-end month labels (Q1..Q4)
  for(const w of weeks){
    const [y,m]=w.start.split("-").map(Number);
    const q=Math.floor((m-1)/3)+1;
    const id=y+"-Q"+q;
    if(!groups.has(id)){
      const startMonth=(q-1)*3;
      const start=y+"-"+String(startMonth+1).padStart(2,"0")+"-01";
      const endD=new Date(Date.UTC(y,startMonth+3,0));
      const end=endD.toISOString().slice(0,10);
      groups.set(id,{
        id,year:y,quarter:q,
        label:QLBL[q-1]+"-"+String(y).slice(2),
        start,end,
        partial:false,
        weekCount:0,
        total:0,google:0,openai:0,anthropic:0,
      });
    }
    const g=groups.get(id);
    g.weekCount+=1;
    g.total+=(w.totalRaw||0);
    if(w.partial)g.partial=true;
    const ys=w.allModels||Object.fromEntries((w.topModels||[]).map(tm=>[tm.slug,tm.tokens]));
    for(const slug of Object.keys(ys)){
      const tokens=ys[slug];
      if(!tokens||tokens<=0)continue;
      const b=bucketProviderFromSlug(slug);
      if(b)g[b]+=tokens;
    }
  }

  // Chronological (oldest first) so the table reads left → right.
  const quarters=Array.from(groups.values()).sort((a,b)=>a.id<b.id?-1:1);
  for(const q of quarters){
    q.other=Math.max(0,q.total-q.google-q.openai-q.anthropic);
    // A non-current quarter with materially fewer than 13 ISO weeks of
    // observed data is itself incomplete — flag so we don't compute QoQ/YoY
    // from a truncated comparator.
    q.complete=!q.partial&&q.weekCount>=12;
  }
  const byId=Object.fromEntries(quarters.map(q=>[q.id,q]));
  const priorQ=(y,q)=>q===1?(y-1)+"-Q4":y+"-Q"+(q-1);
  const yoyQ  =(y,q)=>(y-1)+"-Q"+q;

  const growth={qoq:{},yoy:{}};
  for(const q of quarters){
    growth.qoq[q.id]={};
    growth.yoy[q.id]={};
    if(q.partial)continue; // QTD: full-quarter comparisons are not meaningful
    const prior=byId[priorQ(q.year,q.quarter)];
    const yoy  =byId[yoyQ(q.year,q.quarter)];
    for(const k of["google","openai","anthropic","other","total"]){
      if(prior&&prior.complete&&prior[k]>0){
        growth.qoq[q.id][k]=((q[k]-prior[k])/prior[k])*100;
      }
      if(yoy&&yoy.complete&&yoy[k]>0){
        growth.yoy[q.id][k]=((q[k]-yoy[k])/yoy[k])*100;
      }
    }
  }

  const fmtTok=v=>{
    if(v==null||!isFinite(v)||v<=0)return"—";
    if(v>=1e12)return(v/1e12).toFixed(2).replace(/\.?0+$/,"")+"T";
    if(v>=1e9) return(v/1e9) .toFixed(1).replace(/\.0$/,"")    +"B";
    if(v>=1e6) return(v/1e6) .toFixed(1).replace(/\.0$/,"")    +"M";
    return Math.round(v).toString();
  };
  const fmtShare=(num,den)=>{
    if(num==null||!isFinite(num)||den==null||!isFinite(den)||den<=0)return"—";
    return (num/den*100).toFixed(1)+"%";
  };
  const fmtG=v=>{
    if(v==null||!isFinite(v))return<span style={{color:"#d1d5db"}}>—</span>;
    const str=v<0?"("+Math.abs(v).toFixed(1)+"%)":(v>0?"+":"")+v.toFixed(1)+"%";
    const color=v>0?"#059669":v<0?"#dc2626":"#6b7280";
    return <span style={{color}}>{str}</span>;
  };

  // Sticky-column styling: opaque background + right-edge shadow so the
  // frozen label column reads cleanly as a separate plane once the table
  // scrolls horizontally. Width is locked via minWidth/maxWidth on every
  // first-column cell so the column can't be squeezed by a wide tail of
  // quarters. The section-header rows use colSpan and intentionally OMIT
  // width constraints — they need to span the full row, not be pinned at
  // FIRST_COL_W. The underlined label still anchors left thanks to sticky.
  const STICKY_BG="#f3f4f6";
  const STICKY_SHADOW="2px 0 0 #e5e7eb, 6px 0 6px -4px rgba(17,24,39,0.08)";
  const FIRST_COL_W=210;
  const COL_W=110;
  const stickyFirstBase={position:"sticky",left:0,background:STICKY_BG,boxShadow:STICKY_SHADOW,minWidth:FIRST_COL_W,maxWidth:FIRST_COL_W,width:FIRST_COL_W};
  const stickySectionBase={position:"sticky",left:0,background:STICKY_BG};
  const thMain={textAlign:"right",padding:"5px 10px",fontSize:10,color:"#6b7280",fontWeight:600,whiteSpace:"nowrap",minWidth:COL_W};
  const thFirst={...stickyFirstBase,textAlign:"left",padding:"5px 10px",fontSize:10,color:"#6b7280",fontWeight:600,whiteSpace:"nowrap",zIndex:3};
  const tdMain={textAlign:"right",padding:"4px 10px",fontSize:12,color:"#111827",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",whiteSpace:"nowrap",minWidth:COL_W};
  const tdDim ={textAlign:"right",padding:"4px 10px",fontSize:12,color:"#6b7280",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",whiteSpace:"nowrap",minWidth:COL_W};
  const tdFirst={...stickyFirstBase,textAlign:"left",padding:"4px 10px 4px 24px",fontSize:11,color:"#374151",whiteSpace:"nowrap",zIndex:2};
  const tdFirstTotal={...stickyFirstBase,textAlign:"left",padding:"4px 10px 4px 24px",fontSize:11,color:"#111827",fontWeight:700,whiteSpace:"nowrap",zIndex:2};
  const sectionTh={...stickySectionBase,textAlign:"left",padding:"10px 10px 4px",fontSize:11,color:"#111827",fontWeight:700,textDecoration:"underline",textUnderlineOffset:"3px",zIndex:1};

  const provBuckets=[
    {key:"google",   label:"Google / Gemini"},
    {key:"openai",   label:"OpenAI"},
    {key:"anthropic",label:"Anthropic"},
    {key:"other",    label:"Other"},
  ];

  const renderSectionRow=(label,qs,style)=>(
    <tr key={"sec-"+label}>
      <td style={style}>{label}</td>
      {qs.map(q=>(<td key={q.id} style={{padding:"10px 10px 4px",background:"#f3f4f6",minWidth:COL_W}}/>))}
    </tr>
  );
  const renderTokenRow=b=>(
    <tr key={"tok-"+b.key}>
      <td style={tdFirst}>{b.label}</td>
      {quarters.map(q=>(<td key={q.id} style={tdMain}>{fmtTok(q[b.key])}</td>))}
    </tr>
  );
  const renderShareRow=b=>(
    <tr key={"sh-"+b.key}>
      <td style={tdFirst}>{b.label}</td>
      {quarters.map(q=>(<td key={q.id} style={tdDim}>{fmtShare(q[b.key],q.total)}</td>))}
    </tr>
  );
  const renderGrowthRow=(b,bucket)=>(
    <tr key={bucket+"-"+b.key}>
      <td style={tdFirst}>{b.label}</td>
      {quarters.map(q=>(<td key={q.id} style={tdDim}>{fmtG(growth[bucket][q.id]?.[b.key])}</td>))}
    </tr>
  );

  return(
    <div style={{marginBottom:16}}>
      {header}
      <div style={{border:"0.5px solid #e5e7eb",borderRadius:8,overflow:"hidden",background:"#f9fafb"}}>
        {/* overflow-x:auto on the inner div is what creates the scrollable
           viewport that position:sticky on the first-column cells anchors to.
           border-collapse must be `separate` (not `collapse`) for sticky to
           paint cleanly on table cells across browsers — collapsed borders
           leak into the sticky cell and cause render artifacts on scroll. */}
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0,background:"#f3f4f6",minWidth:FIRST_COL_W+COL_W*Math.max(quarters.length,4)}}>
            <thead>
              <tr>
                <th style={thFirst}></th>
                {quarters.map(q=>(
                  <th key={q.id} style={thMain}>
                    {q.label}
                    {q.partial&&<span style={{marginLeft:3,fontSize:8,color:"#b45309",fontWeight:500}}>QTD</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Section header rows do NOT use colSpan — colSpan + position:sticky
                 is unreliable across browsers (the cell tries to span the full
                 row width, which breaks the sticky-left anchor). Instead, the
                 heading lives in the sticky first column and the remaining
                 columns get an empty filler cell so the row keeps its grid. */}
              {renderSectionRow("Tokens",quarters,sectionTh)}
              {provBuckets.map(renderTokenRow)}
              <tr key="tok-total">
                <td style={tdFirstTotal}>Total</td>
                {quarters.map(q=>(<td key={q.id} style={{...tdMain,fontWeight:700}}>{fmtTok(q.total)}</td>))}
              </tr>

              <tr><td colSpan={quarters.length+1} style={{height:8,background:"#f9fafb"}}></td></tr>

              {renderSectionRow("Share of Tokens",quarters,sectionTh)}
              {provBuckets.map(renderShareRow)}

              <tr><td colSpan={quarters.length+1} style={{height:8,background:"#f9fafb"}}></td></tr>

              {renderSectionRow("QoQ Growth",quarters,sectionTh)}
              {provBuckets.map(b=>renderGrowthRow(b,"qoq"))}
              <tr key="qoq-total">
                <td style={tdFirstTotal}>Total</td>
                {quarters.map(q=>(<td key={q.id} style={tdDim}>{fmtG(growth.qoq[q.id]?.total)}</td>))}
              </tr>

              <tr><td colSpan={quarters.length+1} style={{height:8,background:"#f9fafb"}}></td></tr>

              {renderSectionRow("YoY Growth",quarters,sectionTh)}
              {provBuckets.map(b=>renderGrowthRow(b,"yoy"))}
              <tr key="yoy-total">
                <td style={tdFirstTotal}>Total</td>
                {quarters.map(q=>(<td key={q.id} style={tdDim}>{fmtG(growth.yoy[q.id]?.total)}</td>))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div style={{fontSize:10,color:"#9ca3af",lineHeight:1.5,marginTop:6}}>
        <b style={{color:"#6b7280",fontWeight:600}}>Methodology:</b> Quarter buckets aggregate weekly OpenRouter chart-native data (the same RSC payload as the live provider-share embed below). Provider buckets group models by slug prefix and family-name match: Google / Gemini, OpenAI (incl. GPT/o-series), Anthropic (incl. Claude). Other = quarter total − the three named buckets. QoQ = current quarter vs immediately prior quarter; YoY = current quarter vs same calendar quarter previous year. Growth values render <b>—</b> when the comparator quarter is itself partial / unavailable. The current incomplete quarter is labeled <b>QTD</b>; full-quarter comparisons against QTD are not computed.
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

      {/* First detailed section — finance-model quarterly token-demand matrix.
         Renders independently of the rankings refresh state so it stays visible
         while the OR rankings card/table/chart below shimmer through a refresh. */}
      <OpenRouterTokenDemandTable/>

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
/**
 * Adapt the /api/openrouter-chart-weekly response to the renderer's snapshot
 * shape. The renderer was originally built around the /api/history canonical
 * snapshot shape; this converter lets us swap the source-of-truth without
 * rewriting the table/chart/KPI code.
 *
 * Chart-native input:
 *   { weeks: [{start, end, totalRaw, totalLabel, partial, topModels:[{slug, tokens}]}],
 *     currentWeek, weeklyPace, fetchedAt, forecastFromTimestamp }
 *
 * Output (matches /api/history shape used by the renderer):
 *   { snapshots: [{ date, periodId, periodStart, periodEnd, partial,
 *                   openrouterSummary: {totalTokensRaw, totalTokensLabel},
 *                   or: [{rank, model, slug, isGemini, tokRaw, provider}],
 *                   dayCount, source, ... }],
 *     trackingSinceDate, _chartNative: true, weeklyPace, fetchedAt }
 */
function adaptChartNative(raw, view){
  const weeks=raw.weeks||[];
  if(!weeks.length){
    return {snapshots:[], trackingSinceDate:null, _chartNative:true, weeklyPace:raw.weeklyPace, fetchedAt:raw.fetchedAt};
  }

  function topModelsToOR(topModels){
    // Filter out OR's synthetic "Others" rollup — it's the long-tail bucket,
    // not a real model. Including it makes "#1 model" misleading because it's
    // structurally always the largest entry on weeks with a wide tail.
    const real=(topModels||[]).filter(tm=>tm.slug&&tm.slug!=="Others");
    return real.map((tm,i)=>{
      const slug=tm.slug;
      const m=slug.toLowerCase();
      const provider = slug.includes("/") ? slug.split("/")[0] : (m.includes("gemini")?"google":m.includes("gpt")||m.includes("openai")?"openai":m.includes("claude")?"anthropic":m.includes("deepseek")?"deepseek":"other");
      return {
        rank:i+1,
        model:slug.includes("/")?slug.split("/").slice(1).join("/"):slug,
        slug,
        provider,
        isGemini:/gemini/.test(m),
        tokRaw:tm.tokens||0,
      };
    });
  }

  // Weekly: each chart week becomes one snapshot, newest first.
  if(view==="weekly"){
    const snapshots=[...weeks].reverse().map(w=>({
      date:w.end,
      periodId:w.start,
      periodStart:w.start,
      periodEnd:w.end,
      partial:!!w.partial,
      openrouterSummary:{totalTokensRaw:w.totalRaw,totalTokensLabel:w.totalLabel},
      or:topModelsToOR(w.topModels),
      dayCount:7,
      orDayCount:7,
      distinctHashes:1,
      source:"or-chart",
      representativeHasOR:true,
    }));
    return {
      snapshots,
      trackingSinceDate:weeks[0].start,
      _chartNative:true,
      weeklyPace:raw.weeklyPace,
      fetchedAt:raw.fetchedAt,
    };
  }

  // Quarterly: group weeks by calendar quarter (using week-start month).
  // Sum totalRaw within each quarter to get the chart-native quarterly total.
  // The representative top-models row is the latest week's topModels in that
  // quarter (best signal for "what was leading at quarter close").
  const groups=new Map();
  for(const w of weeks){
    const [y,m]=w.start.split("-").map(Number);
    const q=Math.floor((m-1)/3)+1;
    const id=y+"-Q"+q;
    if(!groups.has(id)){
      const startMonth=(q-1)*3;
      const start=y+"-"+String(startMonth+1).padStart(2,"0")+"-01";
      // last day of quarter = day 0 of next month
      const endD=new Date(Date.UTC(y,startMonth+3,0));
      const end=endD.toISOString().slice(0,10);
      groups.set(id,{id,start,end,weeks:[],totalRaw:0,partial:false});
    }
    const g=groups.get(id);
    g.weeks.push(w);
    g.totalRaw+=(w.totalRaw||0);
    if(w.partial)g.partial=true;
  }
  const snapshots=Array.from(groups.values())
    .sort((a,b)=>a.id<b.id?1:-1)
    .map(g=>{
      const lastWeek=g.weeks[g.weeks.length-1];
      return {
        date:g.end,
        periodId:g.id,
        periodStart:g.start,
        periodEnd:g.end,
        partial:g.partial,
        openrouterSummary:{
          totalTokensRaw:g.totalRaw,
          totalTokensLabel:formatTokensShort(g.totalRaw),
        },
        or:topModelsToOR(lastWeek?.topModels),
        dayCount:g.weeks.length, // = number of ISO weeks in this quarter we have
        orDayCount:g.weeks.length,
        distinctHashes:1,
        source:"or-chart",
        representativeHasOR:true,
      };
    });
  return {
    snapshots,
    trackingSinceDate:weeks[0].start,
    _chartNative:true,
    weeklyPace:raw.weeklyPace,
    fetchedAt:raw.fetchedAt,
  };
}
function formatTokensShort(n){
  if(!n||n<=0)return"—";
  if(n>=1e12)return(n/1e12).toFixed(2).replace(/\.?0+$/,"")+"T";
  if(n>=1e9) return(n/1e9) .toFixed(1).replace(/\.0$/,"")    +"B";
  if(n>=1e6) return(n/1e6) .toFixed(1).replace(/\.0$/,"")    +"M";
  return String(n);
}

/**
 * Turn an OR model slug OR a pre-formatted display name into a consistent
 * investor-readable label. Handles both input shapes because Daily (from
 * /api/history) carries pre-formatted names like "Claude Sonnet 4.6" and
 * Weekly/QTD (from /api/openrouter-chart-weekly) carries slugs like
 * "anthropic/claude-4.6-sonnet-20260217". We normalize both to the same
 * "<Family> <Version> <Tier>" word order.
 *
 *   "anthropic/claude-4.6-sonnet-20260217" → "Claude 4.6 Sonnet"
 *   "Claude Sonnet 4.6"                    → "Claude 4.6 Sonnet"
 *   "google/gemini-3-flash-preview"        → "Gemini 3 Flash Preview"
 *   "qwen/qwen3.6-plus-04-02:free"         → "Qwen3.6 Plus 04 02 (free)"
 *   "xiaomi/mimo-v2-pro-20260318"          → "Mimo V2 Pro"
 *   "deepseek/deepseek-v3.2-20251201"      → "DeepSeek V3.2"
 *   "Minimax M2.5"                         → "Minimax M2.5"
 *   "Grok Code Fast 1"                     → "Grok Code Fast 1"
 */
function prettyModel(slug){
  if(!slug)return"—";
  const bare=slug.includes("/")?slug.split("/").slice(1).join("/"):slug;
  // Separate variant tag like ":free", ":beta"
  const tagMatch=bare.match(/:(free|beta|latest|preview|thinking|exp)$/i);
  const tag=tagMatch?tagMatch[1].toLowerCase():null;
  let s=tagMatch?bare.slice(0,tagMatch.index):bare;
  // Strip trailing date stamps (YYYYMMDD or YYYY-MM-DD)
  s=s.replace(/[-_]?20\d{6}$/,"").replace(/[-_]?20\d{2}-\d{2}-\d{2}$/,"");
  // Split on any separator (hyphen, underscore, OR space) so pre-formatted
  // inputs like "Claude Sonnet 4.6" get the same reorder treatment as slugs.
  let parts=s.split(/[-_\s]+/).filter(Boolean).map(w=>{
    if(/^\d+(\.\d+)*$/.test(w))return w;
    const lw=w.toLowerCase();
    if(lw==="deepseek")return"DeepSeek";
    if(lw==="openai") return"OpenAI";
    if(lw==="gpt")    return"GPT";
    if(lw==="llama")  return"Llama";
    // Version-with-letter like "v3.2" → "V3.2"
    if(/^v\d+(\.\d+)*$/i.test(w))return w.toUpperCase();
    return w.charAt(0).toUpperCase()+w.slice(1);
  });
  // Normalize word order: if the last token is a pure decimal version
  // (e.g. "4.6", "2.5"), move it to position 2. This converts
  // "Claude Sonnet 4.6" → "Claude 4.6 Sonnet" and leaves names with plain
  // integer suffixes ("Grok Code Fast 1") or letter-bearing suffixes
  // ("Minimax M2.5") alone.
  if(parts.length>=3&&/^\d+\.\d+$/.test(parts[parts.length-1])){
    const v=parts.pop();
    parts=[parts[0],v,...parts.slice(1)];
  }
  let out=parts.join(" ");
  if(tag)out+=" ("+tag+")";
  return out;
}

function raw_pace_note(data){
  const wp=data?.weeklyPace;
  if(!wp)return null;
  return(<><br/>Our partial-week pace = <strong>{wp.label}</strong> via <code>{wp.method}</code>. OR's own "Weekly Pace" tooltip uses a proprietary forecast we do not replicate; treat ours as a sanity check, not a 1:1 match.</>);
}

function HistoryTabCanonical(){
  // Default to Weekly — that's the chart-native investor-facing view that
  // reconciles to the OpenRouter live chart embedded above.
  const[view,setView]=useState("weekly"); // "weekly" | "quarterly" | "daily"
  const[state,setState]=useState({phase:"loading",data:null,error:null});

  useEffect(()=>{
    let cancelled=false;
    setState({phase:"loading",data:null,error:null});

    // Source-of-truth split:
    //   weekly + quarterly → /api/openrouter-chart-weekly (the same RSC payload
    //     that drives the live OR chart embedded above; reconciles 1:1 with it)
    //   daily → /api/history?view=daily (our internal capture diagnostics)
    const url = view==="daily"
      ? "/api/history?view=daily&range=365"
      : "/api/openrouter-chart-weekly";

    fetch(url)
      .then(r=>r.ok?r.json():Promise.reject(new Error("HTTP "+r.status)))
      .then(d=>{
        if(cancelled)return;
        if(!d||d.success===false){
          setState({phase:"error",data:null,error:d?.error||"Unknown error"});
          return;
        }
        const adapted = view==="daily" ? d : adaptChartNative(d,view);
        const snaps=adapted.snapshots||[];
        if(!snaps.length){
          setState({phase:"empty",data:adapted,error:null});
          return;
        }
        setState({phase:"ready",data:adapted,error:null});
      })
      .catch(err=>{
        if(cancelled)return;
        if(view==="daily"&&typeof window!=="undefined"&&window.__ghist?.snaps?.length){
          const local=window.__ghist.snaps.map(s=>({
            date:(s.ts||"").slice(0,10),
            ts:s.ts,
            or:s.or||[],
            bots:s.bots||[],
            trends:s.trends||[],
            filing:s.filing||null,
            openrouterSummary:{
              totalTokensRaw:(s.or||[]).reduce((x,m)=>x+(m.tokRaw||0),0),
              totalTokensLabel:null,
            },
            source:"local",
          })).reverse();
          setState({phase:"ready",data:{view:"daily",snapshots:local,count:local.length,trackingSinceDate:local.length?local[local.length-1].date:null,_localFallback:true},error:null});
          return;
        }
        setState({phase:"error",data:null,error:err.message||"Fetch failed"});
      });
    return()=>{cancelled=true;};
  },[view]);

  // Order matters — Weekly first because it's the canonical investor view.
  const VIEWS=[
    {id:"weekly",    label:"Weekly"},
    {id:"quarterly", label:"QTD"},
    {id:"daily",     label:"Daily (diagnostics)"},
  ];

  const toggle=(
    <div style={{display:"flex",gap:4}}>
      {VIEWS.map(v=>(
        <button key={v.id} onClick={()=>setView(v.id)}
          style={{fontSize:12,padding:"6px 14px",border:"0.5px solid "+(view===v.id?"#111827":"#e5e7eb"),borderRadius:8,background:view===v.id?"#111827":"#fff",color:view===v.id?"#fff":"#374151",cursor:"pointer",fontFamily:"inherit",fontWeight:500}}>
          {v.label}
        </button>
      ))}
    </div>
  );

  const header=(
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
      <div>
        <div style={{fontSize:14,fontWeight:600,color:"#111827"}}>OpenRouter history</div>
        <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>
          {view==="daily"
            ? "Daily capture diagnostics · internal /api/history snapshots (rolling weekly observation per day)"
            : "Chart-native series · same RSC payload as the OpenRouter live chart embedded above (reconciles 1:1)"}
        </div>
      </div>
      {toggle}
    </div>
  );

  if(state.phase==="loading"){
    return(
      <div>
        {header}
        <div style={{padding:"8px 2px"}}><Shimmer rows={6}/></div>
      </div>
    );
  }

  if(state.phase==="error"){
    return(
      <div>
        {header}
        <div style={{fontSize:12,color:"#b91c1c",background:"#fef2f2",border:"0.5px solid #fecaca",borderRadius:8,padding:12}}>
          Failed to load history — {String(state.error)}. {view==="daily"
            ? <>The canonical store at <code style={{fontFamily:"monospace"}}>/api/history?view=daily</code> returned an error. Check that HISTORY_KV is bound and that <code style={{fontFamily:"monospace"}}>/api/history-capture</code> has run at least once.</>
            : <><code style={{fontFamily:"monospace"}}>/api/openrouter-chart-weekly</code> returned an error. The OpenRouter rankings page may be unreachable, or its RSC payload layout may have changed (see the parser in <code style={{fontFamily:"monospace"}}>functions/api/openrouter-chart-weekly.js</code>).</>}
        </div>
      </div>
    );
  }

  if(state.phase==="empty"){
    return(
      <div>
        {header}
        <div style={{fontSize:12,color:"#6b7280",background:"#f9fafb",border:"0.5px solid #e5e7eb",borderRadius:8,padding:16,textAlign:"center"}}>
          {view==="daily"?(<>
            <div style={{fontWeight:600,color:"#374151",marginBottom:4}}>No canonical history yet</div>
            <div>Run <code style={{fontFamily:"monospace"}}>/api/history-capture</code> to create the first snapshot. The daily cron (see <code style={{fontFamily:"monospace"}}>.github/workflows/history-capture.yml</code>) will then accumulate one snapshot per day.</div>
          </>):(<>
            <div style={{fontWeight:600,color:"#374151",marginBottom:4}}>No chart-native data returned</div>
            <div>Try <code style={{fontFamily:"monospace"}}>/api/openrouter-chart-weekly</code> directly. If OpenRouter changed their RSC payload structure the parser may need updating.</div>
          </>)}
        </div>
      </div>
    );
  }

  // ── ready ──
  const d=state.data;
  const snaps=d.snapshots||[];
  const trackingSinceDate=d.trackingSinceDate;

  function fmtDate(s){
    if(!s)return"—";
    const d=new Date(s+"T00:00:00Z");
    return d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
  }
  function fmtTokShort(n){
    if(!n||n<=0)return"—";
    if(n>=1e12)return(n/1e12).toFixed(2).replace(/\.?0+$/,"")+"T";
    if(n>=1e9) return(n/1e9) .toFixed(1).replace(/\.0$/,"")    +"B";
    if(n>=1e6) return(n/1e6) .toFixed(1).replace(/\.0$/,"")    +"M";
    return String(n);
  }

  // The OR metric is a WEEKLY ROLLING TOTAL captured at snapshot time from
  // /api/openrouter?view=week (sum of top-30 model tokens on OpenRouter's
  // weekly rankings page). It is NOT a daily token count — OpenRouter does
  // not expose per-day tokens. Every row, every card, every chart point in
  // this tab is a snapshot-in-time observation of that weekly rolling total.
  const hasOR=s=>!!(s?.or?.length||s?.openrouterSummary?.totalTokensRaw);
  const orTok=s=>s?.openrouterSummary?.totalTokensRaw||0;

  // Split snapshots by completion state.
  //   - completedSnaps: representative day of a fully-closed period (not the current week/quarter).
  //   - partialSnap:    the current in-progress week or quarter (if any).
  // For daily view nothing is "completed" in the same sense, so we fall back
  // to a simpler latest-with-OR logic.
  let primarySnap=null;   // what the big KPI card displays
  let priorSnap  =null;   // for the delta card
  let primaryKind=view;   // "daily" | "completed-week" | "completed-quarter"
  let partialSnap=null;   // current-period WTD/QTD to show separately

  if(view==="daily"){
    primarySnap=snaps.find(hasOR)||null;
    priorSnap  =primarySnap?snaps.slice(snaps.indexOf(primarySnap)+1).find(hasOR):null;
  }else{
    const completed=snaps.filter(s=>!s.partial&&hasOR(s));
    primarySnap=completed[0]||null;
    priorSnap  =completed[1]||null;
    partialSnap=snaps.find(s=>s.partial)||null;
    primaryKind=view==="weekly"?"completed-week":"completed-quarter";
  }

  // Sparkline data: oldest → newest, only snapshots with OR data, marking
  // partials so we can style them distinctly.
  const chart=[...snaps].reverse()
    .filter(s=>orTok(s)>0)
    .map(s=>({
      label: view==="daily" ? (s.date||"").slice(5)
           : view==="weekly" ? (s.periodStart||s.date||"").slice(5)
           : (s.periodId||s.date||""),
      tokens:orTok(s),
      partial:!!s.partial,
    }));

  const primaryTok=orTok(primarySnap);
  const priorTok  =orTok(priorSnap);
  const changePct =priorTok>0&&primaryTok>0?((primaryTok-priorTok)/priorTok)*100:null;

  // Labels are explicit about what is being compared.
  // Weekly metric = OR's chart-native weekly bucket. QTD metric = SUM of those
  // weekly buckets within each calendar quarter — it's a quarterly TOTAL, not
  // a "close" / point-in-time value, so labels must say so.
  const METRIC_SHORT=view==="daily"?"OR weekly total (rolling)":"OR weekly total (chart-native)";
  const METRIC_QTD="OR quarterly total (Σ chart-native weeks)";
  const primaryKpiLabel=
    view==="daily"     ? "OR weekly total (rolling) · captured"
  : view==="weekly"    ? "OR weekly total · last completed week"
  :                      "OR quarterly total · last completed quarter";
  const deltaLabel=
    view==="daily"     ? "Δ24h (rolling weekly observation)"
  : view==="weekly"    ? "WoW (completed vs prior completed)"
  :                      "QoQ total vs prior completed quarter";
  const deltaSub=changePct==null
    ? (view==="daily" ? "need ≥2 daily snapshots with OR data"
       : view==="weekly" ? "need ≥2 completed weeks"
       : "need ≥2 completed quarters")
    : (view==="quarterly"?METRIC_QTD:METRIC_SHORT);
  const deltaVal=changePct==null?"—":((changePct>=0?"+":"")+changePct.toFixed(1)+"%");

  function periodRangeLabel(s){
    if(!s)return"—";
    if(view==="daily")return fmtDate(s.date);
    if(view==="weekly")return s.periodStart?fmtDate(s.periodStart)+" – "+fmtDate(s.periodEnd):fmtDate(s.date);
    return s.periodId||"—";
  }

  const latestGem=(primarySnap?.or||[]).find(m=>m.isGemini);
  const latestTop=(primarySnap?.or||[])[0];

  // Partial banner values (Weekly/QTD only)
  const partialTok=orTok(partialSnap);
  const partialBadge=view==="weekly"?"WTD":"QTD";

  return(
    <div>
      {header}

      {/* Tracking-since caption + freshness */}
      <div style={{fontSize:11,color:"#6b7280",marginBottom:10}}>
        tracking since <strong style={{color:"#374151"}}>{fmtDate(trackingSinceDate)}</strong>
        {" · "}<span>{snaps.length} {view==="daily"?"day":view==="weekly"?"week":"quarter"}{snaps.length===1?"":"s"} captured</span>
        {d.fetchedAt&&(
          <span>
            {" · chart snapshot fetched "}
            <strong style={{color:"#374151"}}>{new Date(d.fetchedAt).toISOString().slice(11,16)} UTC</strong>
          </span>
        )}
        {d._localFallback&&<span style={{color:"#b45309"}}> · falling back to local cache (API error)</span>}
      </div>

      {/* Partial-period notice — only in Weekly / Quarterly views and only if
          there's a current in-progress period. Prevents the WTD/QTD value
          from being confused with a completed total on the main KPI card. */}
      {view!=="daily"&&partialSnap&&(
        <div style={{background:"#fffbeb",border:"0.5px solid #fde68a",borderRadius:8,padding:"10px 12px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <div style={{fontSize:11,color:"#92400e"}}>
            <strong style={{color:"#78350f"}}>Current {partialBadge} · in progress</strong>
            {" — "}{periodRangeLabel(partialSnap)}. Do not compare to completed {view==="weekly"?"weeks":"quarters"}.
            {d.fetchedAt&&<span style={{color:"#92400e"}}>{" · chart fetched "}{new Date(d.fetchedAt).toISOString().slice(11,16)} UTC (live iframe may differ intraday as both series grow)</span>}
          </div>
          <div style={{fontSize:13,fontWeight:600,color:"#78350f",fontVariantNumeric:"tabular-nums"}}>
            {fmtTokShort(partialTok)}{partialTok?" · "+(view==="weekly"?METRIC_SHORT:METRIC_QTD):""}
          </div>
        </div>
      )}

      {/* KPI row — all three cards refer to the same completed/primary snapshot */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
        <KBox
          label={primaryKpiLabel}
          value={fmtTokShort(primaryTok)}
          sub={primarySnap
            ? periodRangeLabel(primarySnap)+(view==="daily"?" · "+METRIC_SHORT:"")
            : (view==="daily"?"no daily snapshot with OR data yet":"no completed "+(view==="weekly"?"week":"quarter")+" yet")}
          bg="#eff6ff" fg="#1d4ed8"/>
        <KBox
          label={deltaLabel}
          value={deltaVal}
          sub={deltaSub}
          bg={changePct==null?"#f9fafb":changePct>=0?"#f0fdf4":"#fef2f2"}
          fg={changePct==null?"#6b7280":changePct>=0?"#059669":"#b91c1c"}/>
        <KBox
          label={"Top model · "+(primaryKind==="daily"?"at capture":primaryKind==="completed-week"?"end of week":"latest week in quarter")}
          value={latestTop?"#"+latestTop.rank+" "+prettyModel(latestTop.slug||latestTop.model):"—"}
          sub={latestGem?"best Gemini #"+latestGem.rank+" · "+prettyModel(latestGem.slug||latestGem.model):(latestTop?"":"no OR data")}
          bg="#fef3c7" fg="#a16207"/>
      </div>

      {/* Sparkline — total at each snapshot point */}
      <div style={{...S.card,padding:12,marginBottom:14}}>
        <div style={{...S.lbl,marginBottom:8}}>
          {view==="quarterly"?METRIC_QTD:METRIC_SHORT}
          {" · "}
          {view==="daily"?"daily captures":view==="weekly"?"weekly (completed + current)":"quarterly (completed + current)"}
        </div>
        {chart.length>=2?(
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chart} margin={{top:6,right:14,left:-6,bottom:6}}>
              <CartesianGrid stroke="#f3f4f6" vertical={false}/>
              <XAxis dataKey="label" tick={{fontSize:10,fill:"#6b7280"}} tickLine={false} axisLine={{stroke:"#e5e7eb"}}/>
              <YAxis tick={{fontSize:10,fill:"#6b7280"}} tickLine={false} axisLine={{stroke:"#e5e7eb"}} tickFormatter={fmtTokShort} width={50}/>
              <Tooltip
                formatter={(v,_,payload)=>[fmtTokShort(v)+(payload?.payload?.partial?" · partial":""),"tokens"]}
                labelStyle={{fontSize:11,color:"#374151"}}
                contentStyle={{fontSize:11,border:"0.5px solid #e5e7eb",borderRadius:6,padding:"6px 10px"}}/>
              <Line type="monotone" dataKey="tokens" stroke="#3b82f6" strokeWidth={2}
                dot={({cx,cy,payload})=><circle cx={cx} cy={cy} r={3} fill={payload.partial?"#f59e0b":"#3b82f6"}/>}
                activeDot={{r:5}} isAnimationActive={false}/>
            </LineChart>
          </ResponsiveContainer>
        ):(
          <div style={{fontSize:11,color:"#9ca3af",padding:"18px 0",textAlign:"center"}}>
            need ≥2 {view==="daily"?"daily snapshots":view==="weekly"?"weeks":"quarters"} with OR data to render a trend
          </div>
        )}
      </div>

      {/* Snapshot table */}
      <div style={{...S.card,padding:0,overflow:"hidden"}}>
        <div style={{...S.lbl,padding:"10px 12px",borderBottom:"1px solid #f3f4f6"}}>
          {view==="daily"?"Daily snapshots · internal capture diagnostics"
            :view==="weekly"?"Weekly periods · chart-native series"
            :"Quarterly periods · sum of chart-native weeks"}
        </div>
        <div style={{maxHeight:360,overflowY:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{background:"#f9fafb",textAlign:"left"}}>
                <th style={{padding:"7px 12px",fontWeight:600,color:"#374151",borderBottom:"1px solid #e5e7eb"}}>
                  {view==="daily"?"Capture date":view==="weekly"?"ISO week":"Quarter"}
                </th>
                <th style={{padding:"7px 12px",fontWeight:600,color:"#374151",borderBottom:"1px solid #e5e7eb",textAlign:"right"}}>
                  {view==="quarterly"?"OR quarterly total":"OR weekly total"}
                </th>
                <th style={{padding:"7px 12px",fontWeight:600,color:"#374151",borderBottom:"1px solid #e5e7eb"}}>#1 model</th>
                <th style={{padding:"7px 12px",fontWeight:600,color:"#374151",borderBottom:"1px solid #e5e7eb"}}>Best Gemini</th>
                <th style={{padding:"7px 12px",fontWeight:600,color:"#374151",borderBottom:"1px solid #e5e7eb"}}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {snaps.map((s,i)=>{
                const gem=(s.or||[]).find(m=>m.isGemini);
                const top=(s.or||[])[0];
                const key = view==="daily" ? (s.date||i)
                          : (s.periodId||s.date||i);
                const periodLabel = view==="daily" ? fmtDate(s.date)
                          : view==="weekly" ? (s.periodStart?fmtDate(s.periodStart)+" – "+fmtDate(s.periodEnd):fmtDate(s.date))
                          : (s.periodId||"—");
                const notes=[];
                if(s.partial)notes.push(view==="weekly"?"WTD":view==="quarterly"?"QTD":"partial");
                if(s.dedup)notes.push("dedup");
                // Weekly rows are 1 week by definition — no count chip needed.
                // Quarterly rows show the number of chart-native weeks that
                // rolled up into the total, spelled out explicitly.
                if(view==="quarterly"&&s.dayCount){
                  notes.push(s.dayCount+" week"+(s.dayCount===1?"":"s"));
                }
                // Daily rows are /api/history-derived; dayCount there is the
                // number of daily snapshots (not weeks). Omit for daily too —
                // the count doesn't add investor value.
                if(view!=="daily"&&s.representativeHasOR===false)notes.push("no OR signal");
                if(s.source&&s.source!=="cron"&&s.source!=="or-chart")notes.push(s.source);
                const isPartial=s.partial;
                return(
                  <tr key={key} style={{borderBottom:"1px solid #f3f4f6",background:isPartial?"#fffbeb":undefined}}>
                    <td style={{padding:"7px 12px",color:"#111827"}}>{periodLabel}</td>
                    <td style={{padding:"7px 12px",color:"#111827",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{fmtTokShort(orTok(s))}</td>
                    <td style={{padding:"7px 12px",color:"#374151"}}>{top?prettyModel(top.slug||top.model):"—"}</td>
                    <td style={{padding:"7px 12px",color:"#374151"}}>{gem?"#"+gem.rank+" "+prettyModel(gem.slug||gem.model):"—"}</td>
                    <td style={{padding:"7px 12px",color:"#6b7280",fontSize:11}}>
                      {notes.length?notes.map((n,j)=>{
                        const isPartialTag=n==="WTD"||n==="QTD"||n==="partial";
                        return(
                          <span key={j} style={{display:"inline-block",marginRight:6,padding:"1px 6px",borderRadius:4,background:isPartialTag?"#fef3c7":"#f3f4f6",color:isPartialTag?"#a16207":"#374151"}}>{n}</span>
                        );
                      }):<span style={{color:"#d1d5db"}}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{fontSize:10,color:"#9ca3af",marginTop:8,lineHeight:1.5}}>
        {view==="daily" ? (<>
          Metric: <strong style={{color:"#6b7280"}}>OR weekly total (rolling)</strong> — sum of top-30 model tokens scraped from <code>openrouter.ai/rankings?view=week</code> at our daily capture time. OpenRouter has no native daily metric; every captured number is a weekly rolling total observed on a specific day. <strong>This tab is internal capture diagnostics, not investor-facing</strong> — for completed-week and quarterly analysis use the Weekly and QTD tabs, which read the chart-native series directly.
        </>):view==="weekly"?(<>
          Source: <code>/api/openrouter-chart-weekly</code> — extracted from the same Next.js RSC payload (<code>self.__next_f.push</code>) that drives the OpenRouter Top Models live chart embedded above. Each row is one ISO week. Totals are <strong>Σ ys</strong> across all model series including OR's "Others" rollup, matching the chart tooltip's <strong>Total</strong> field exactly (modulo observation time within a partial week — the value grows as the week progresses).
          {raw_pace_note(state.data)}
        </>):(<>
          Source: <code>/api/openrouter-chart-weekly</code>, grouped by calendar quarter (week-start month). Each row's total is <strong>Σ chart-native weekly totals</strong> in that quarter — it is a quarterly SUM, not a point-in-time quarter-close value. A quarter is marked partial (QTD) when it contains the current in-progress week.
          {raw_pace_note(state.data)}
        </>)}
      </div>
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
  const[fetchedAtLabel,setFetchedAtLabel]=useState(LIVE.fetchedAt);

  const[allPressed,setAllPressed]=useState(false);
  const anyBusy=or.busy||radar.busy||trends.busy;

  function refreshAll(){
    setAllPressed(true);
    setTimeout(()=>setAllPressed(false),180);
    const d=new Date();
    const datePart=d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
    const timePart=String(d.getUTCHours()).padStart(2,"0")+":"+String(d.getUTCMinutes()).padStart(2,"0")+":"+String(d.getUTCSeconds()).padStart(2,"0");
    setFetchedAtLabel(datePart+" \u00B7 "+timePart+" UTC");
    or.refresh();radar.refresh();trends.refresh();
  }

  const best =LIVE.or.find(m=>m.isGemini);
  const top  =LIVE.or[0];
  const gBot =LIVE.bots[0];

  const TABS=[
    {id:"adoption",label:"AI Adoption",                   panel:or},
    {id:"pricing", label:"Model Pricing"},
    {id:"gpu",     label:"GPU Hardware Pricing"},
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
            Data fetched {fetchedAtLabel} · refresh buttons call live /api/* endpoints
          </div>
        </div>
        <button onClick={refreshAll} disabled={anyBusy}
          style={{fontSize:12,padding:"8px 16px",border:"none",borderRadius:8,background:anyBusy?"#374151":"#111827",color:"#fff",cursor:anyBusy?"wait":"pointer",fontFamily:"inherit",fontWeight:500,display:"inline-flex",alignItems:"center",gap:8,transform:allPressed?"scale(0.96)":"scale(1)",opacity:anyBusy?0.9:1,transition:"transform .12s ease, background .18s, opacity .18s"}}>
          {anyBusy?(<><Spin size={11} color="#fff"/> Refreshing…</>):"↻  Refresh all"}
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
            {t.panel?.busy&&<Spin size={10} color={tab===t.id?"#fff":"#3b82f6"}/>}
          </button>
        ))}
      </div>

      {/* Active tab */}
      <div style={S.card}>
        {tab==="adoption"&&<ORTab {...or}/>}
        {tab==="pricing"&&<ModelPricingTab/>}
        {tab==="gpu"&&<GPUHardwarePricingTab/>}
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
