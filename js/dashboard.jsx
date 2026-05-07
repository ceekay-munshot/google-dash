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
   MODEL PRICING — finance-model price matrix, by class & period
   First detailed section in the Model Pricing tab. Rows = comparable
   model class (Frontier vs Fast/Cost-efficient) per provider; columns
   = calendar quarters with quarter-end labels (Mar/Jun/Sep/Dec). Same
   visual language as the OpenRouter Token Demand table and the GPU
   Hardware Pricing financial-correlation table.

   Data source: /api/model-pricing-peer-matrix. That endpoint proxies
   pricepertoken.com's own historical pricing API (same upstream that
   /api/provider-pricing-matrix uses) and filters to a fixed peer-pair
   set so QoQ math reflects real repricing on the same model class
   instead of a drifting lineup average. The fixed peer mapping and the
   model-name normalization rules live server-side in the endpoint —
   this component just renders.

   Pricing color convention: a price drop is favorable for buyers, so
   negative changes render green / positive changes render red — the
   inverse of the OpenRouter Token Demand growth table where positive
   = green growth. Same parenthesized magnitude formatting either way.
═══════════════════════════════════════════════════════ */
function quarterIdToLabel(qid){
  const m=qid.match(/^(\d{4})-Q(\d)$/);
  if(!m)return qid;
  const y=parseInt(m[1],10),q=parseInt(m[2],10);
  return ["Mar","Jun","Sep","Dec"][q-1]+"-"+String(y).slice(2);
}

function ModelPricingMatrixTable(){
  const[state,setState]=useState({phase:"loading",data:null,error:null});
  const[diagOpen,setDiagOpen]=useState(false);
  useEffect(()=>{
    let cancelled=false;
    // Source: /api/model-pricing-peer-matrix proxies pricepertoken's own
    // historical pricing API (the same upstream provider-pricing-matrix uses)
    // and filters to a fixed peer-pair set so QoQ math reflects real provider
    // repricing on the same model class. This is REAL upstream historical
    // data — not the canonical KV snapshot store, which only reaches back as
    // far as the dashboard has been running.
    //
    // The 5-minute bucket on the URL means every page load within that
    // window hits the same edge-cache entry, but a schema/code change
    // crossing the boundary always lands on a fresh URL — so a stale
    // 6-hour edge-cached response shape can't trap clients.
    fetch("/api/model-pricing-peer-matrix?v="+Math.floor(Date.now()/3e5))
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
        <span style={{width:7,height:7,borderRadius:"50%",background:"#0e7490",display:"inline-block"}}/>
        <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:".09em",fontWeight:700,color:"#0e7490"}}>Model Pricing Matrix</span>
      </div>
      <div style={{marginBottom:10}}>
        <div style={{fontSize:16,fontWeight:700,color:"#111827",lineHeight:1.3}}>Model Pricing by Provider</div>
        <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>Quarter-aligned price per token comparison across comparable model classes — real pricing history only.</div>
      </div>
    </>
  );

  if(state.phase==="loading"){
    return(<div style={{marginBottom:16}}>{header}<div style={{...S.card}}><Shimmer rows={6}/></div></div>);
  }
  if(state.phase==="error"){
    return(
      <div style={{marginBottom:16}}>{header}
        <div style={{background:"#fff",border:"0.5px dashed #fca5a5",borderRadius:10,padding:"14px 16px"}}>
          <div style={{fontSize:12,color:"#991b1b",fontWeight:500}}>Pricing matrix temporarily unavailable</div>
          <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>{state.error||"/api/model-pricing-peer-matrix did not return success"}</div>
        </div>
      </div>
    );
  }

  const data=state.data;
  const quarters=(data?.quarters||[]);
  const allReps=(data?.reps||[]);
  // Filter out reps that have no upstream data in any quarter — happens when
  // an entire candidate list whiffs (e.g. provider has no Legacy variants in
  // the upstream window). Per spec: don't render an all-`—` row.
  const reps=allReps.filter(rep=>{
    if(rep.hasData===false)return false;
    const hasAnyInput =Object.values(rep.input ||{}).some(v=>v!=null);
    const hasAnyOutput=Object.values(rep.output||{}).some(v=>v!=null);
    return hasAnyInput||hasAnyOutput;
  });
  const frontierRef=(data?.frontierReference||[]);
  const externalCatalog=data?.externalCatalog||null;
  if(!quarters.length||!reps.length){
    return(
      <div style={{marginBottom:16}}>{header}
        <div style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:10,padding:"14px 16px"}}>
          <div style={{fontSize:12,color:"#111827",fontWeight:500}}>Matrix populates as upstream historical pricing data becomes available</div>
          <div style={{fontSize:11,color:"#6b7280",marginTop:3}}>This view filters pricepertoken.com's historical pricing API to comparable peer models per provider.</div>
        </div>
      </div>
    );
  }

  const fmtPrice=v=>{
    if(v==null||!isFinite(v))return"—";
    if(v>=10)return"$"+v.toFixed(2);
    if(v>=1) return"$"+v.toFixed(2);
    return "$"+v.toFixed(3);
  };
  // Pricing change colors are INVERTED from the growth table convention:
  // a price drop is favorable for the buyer (green), a price hike is
  // cost pressure (red). Magnitude format mirrors finance: negatives in
  // parentheses, positives prefixed with +.
  const fmtChange=v=>{
    if(v==null||!isFinite(v))return<span style={{color:"#d1d5db"}}>—</span>;
    const pct=v*100;
    const str=pct<0?"("+Math.abs(pct).toFixed(1)+"%)":(pct>0?"+":"")+pct.toFixed(1)+"%";
    const color=pct>0?"#dc2626":pct<0?"#059669":"#6b7280";
    return <span style={{color}}>{str}</span>;
  };

  const STICKY_BG="#f3f4f6";
  const STICKY_SHADOW="2px 0 0 #e5e7eb, 6px 0 6px -4px rgba(17,24,39,0.08)";
  const FIRST_COL_W=260;
  const COL_W=110;
  const stickyFirstBase={position:"sticky",left:0,background:STICKY_BG,boxShadow:STICKY_SHADOW,minWidth:FIRST_COL_W,maxWidth:FIRST_COL_W,width:FIRST_COL_W};
  const stickySectionBase={position:"sticky",left:0,background:STICKY_BG};
  const thMain={textAlign:"right",padding:"5px 10px",fontSize:10,color:"#6b7280",fontWeight:600,whiteSpace:"nowrap",minWidth:COL_W};
  const thFirst={...stickyFirstBase,textAlign:"left",padding:"5px 10px",fontSize:10,color:"#6b7280",fontWeight:600,whiteSpace:"nowrap",zIndex:3};
  const tdMain={textAlign:"right",padding:"4px 10px",fontSize:12,color:"#111827",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",whiteSpace:"nowrap",minWidth:COL_W};
  const tdDim ={textAlign:"right",padding:"4px 10px",fontSize:12,color:"#6b7280",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",whiteSpace:"nowrap",minWidth:COL_W};
  const tdFirst={...stickyFirstBase,textAlign:"left",padding:"6px 10px 6px 18px",fontSize:11,whiteSpace:"nowrap",zIndex:2};
  const sectionTh={...stickySectionBase,textAlign:"left",padding:"10px 10px 4px",fontSize:11,color:"#111827",fontWeight:700,textDecoration:"underline",textUnderlineOffset:"3px",zIndex:1};

  const renderSectionRow=label=>(
    <tr key={"sec-"+label}>
      <td style={sectionTh}>{label}</td>
      {quarters.map(q=>(<td key={q.id} style={{padding:"10px 10px 4px",background:"#f3f4f6",minWidth:COL_W}}/>))}
    </tr>
  );
  const renderModelLabel=rep=>{
    const matchedSummary=(rep.matchedModels||[]).length
      ? rep.matchedModels.length+" upstream variant"+(rep.matchedModels.length===1?"":"s")+" matched: "+rep.matchedModels.join(", ")
      : "no upstream model matched";
    return(
      <td style={tdFirst} title={matchedSummary}>
        <div style={{lineHeight:1.25}}>
          <div style={{fontWeight:600,color:"#111827"}}>{rep.label}</div>
          <div style={{fontSize:10,color:"#9ca3af",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace"}}>{rep.modelDisplay}</div>
        </div>
      </td>
    );
  };
  const renderPriceRow=(rep,metricKey)=>(
    <tr key={metricKey+"-"+rep.key}>
      {renderModelLabel(rep)}
      {quarters.map(q=>{
        const val=rep[metricKey]?.[q.id];
        return(<td key={q.id} style={tdMain}>{fmtPrice(val)}</td>);
      })}
    </tr>
  );
  const renderChangeRow=(rep,key)=>(
    <tr key={key+"-"+rep.key}>
      {renderModelLabel(rep)}
      {quarters.map(q=>{
        const val=rep[key]?.[q.id];
        return(<td key={q.id} style={tdDim}>{fmtChange(val)}</td>);
      })}
    </tr>
  );

  return(
    <div style={{marginBottom:16}}>
      {header}
      <div style={{border:"0.5px solid #e5e7eb",borderRadius:8,overflow:"hidden",background:"#f9fafb"}}>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0,background:"#f3f4f6",minWidth:FIRST_COL_W+COL_W*quarters.length}}>
            <thead>
              <tr>
                <th style={thFirst}></th>
                {quarters.map(q=>(
                  <th key={q.id} style={thMain}>
                    {quarterIdToLabel(q.id)}
                    {q.partial&&<span style={{marginLeft:3,fontSize:8,color:"#b45309",fontWeight:500}}>QTD</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {renderSectionRow("Input Price / 1M Tokens")}
              {reps.map(rep=>renderPriceRow(rep,"input"))}

              <tr><td colSpan={quarters.length+1} style={{height:8,background:"#f9fafb"}}></td></tr>

              {renderSectionRow("Output Price / 1M Tokens")}
              {reps.map(rep=>renderPriceRow(rep,"output"))}

              <tr><td colSpan={quarters.length+1} style={{height:8,background:"#f9fafb"}}></td></tr>

              {renderSectionRow("QoQ Price Change (input)")}
              {reps.map(rep=>renderChangeRow(rep,"qoqInput"))}

              <tr><td colSpan={quarters.length+1} style={{height:8,background:"#f9fafb"}}></td></tr>

              {renderSectionRow("QoQ Price Change (output)")}
              {reps.map(rep=>renderChangeRow(rep,"qoqOutput"))}

              <tr><td colSpan={quarters.length+1} style={{height:8,background:"#f9fafb"}}></td></tr>

              {renderSectionRow("YoY Price Change (input)")}
              {reps.map(rep=>renderChangeRow(rep,"yoyInput"))}

              <tr><td colSpan={quarters.length+1} style={{height:8,background:"#f9fafb"}}></td></tr>

              {renderSectionRow("YoY Price Change (output)")}
              {reps.map(rep=>renderChangeRow(rep,"yoyOutput"))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Frontier Reference by Period — informational only. The customer's
         "the frontier today is not the same model as 12 quarters ago" point
         is answered here without contaminating the QoQ/YoY math above. */}
      {frontierRef.length>0&&(
        <div style={{marginTop:12,marginBottom:6}}>
          <div style={{fontSize:11,fontWeight:700,color:"#374151",lineHeight:1.3}}>Frontier Reference by Period</div>
          <div style={{fontSize:10,color:"#9ca3af",marginTop:2,marginBottom:6,lineHeight:1.45}}>Reference only: shows the highest-tier available model observed per provider in each period. The main matrix above uses fixed representatives to keep QoQ/YoY comparisons clean.</div>
          <div style={{border:"0.5px solid #e5e7eb",borderRadius:8,overflow:"hidden",background:"#fafafa"}}>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0,background:"#fafafa",minWidth:FIRST_COL_W+COL_W*quarters.length}}>
                <thead>
                  <tr>
                    <th style={{...thFirst,background:"#fafafa"}}></th>
                    {quarters.map(q=>(
                      <th key={q.id} style={thMain}>
                        {quarterIdToLabel(q.id)}
                        {q.partial&&<span style={{marginLeft:3,fontSize:8,color:"#b45309",fontWeight:500}}>QTD</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {frontierRef.map(row=>(
                    <tr key={"ref-"+row.providerSlug}>
                      <td style={{...tdFirst,background:"#fafafa"}}>
                        <div style={{lineHeight:1.25,fontWeight:600,color:"#111827"}}>{row.providerLabel}</div>
                      </td>
                      {quarters.map(q=>{
                        const cell=row.cells?.[q.id];
                        const variantsTitle=cell?.matchedVariants?.length
                          ? cell.matchedVariants.length+" upstream variant"+(cell.matchedVariants.length===1?"":"s")+" matched: "+cell.matchedVariants.join(", ")
                          : undefined;
                        return(
                          <td key={q.id} title={variantsTitle} style={{textAlign:"right",padding:"6px 10px",fontSize:11,color:cell?"#374151":"#d1d5db",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",whiteSpace:"nowrap",minWidth:COL_W}}>
                            {cell?cell.display:"—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Representative Model Check — compact investor-facing strip. The
         detailed per-rep diagnostics live behind a "Show diagnostics" toggle
         and are intentionally collapsed by default. Pricing math never reads
         this section; reps are never auto-promoted. */}
      {externalCatalog&&(()=>{
        const counts=reps.reduce((acc,r)=>{
          const s=r.repFreshness?.status||"OK";
          acc[s]=(acc[s]||0)+1;
          return acc;
        },{});
        const monitored=reps.length;
        const critical=counts.STALE||0;
        const review  =counts.REVIEW||0;
        const watch   =counts.WATCH||0;
        const ok      =counts.OK||0;
        const fcLabel = !externalCatalog.enabled ? "Not configured in this environment"
                      : externalCatalog.degraded ? "Degraded"
                      : "Live";
        const fcBg    = !externalCatalog.enabled ? "#f3f4f6"
                      : externalCatalog.degraded ? "#fef3c7"
                      : "#ecfdf5";
        const fcFg    = !externalCatalog.enabled ? "#6b7280"
                      : externalCatalog.degraded ? "#92400e"
                      : "#047857";
        const lastChecked = externalCatalog.generatedAt
          ? new Date(externalCatalog.generatedAt).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"})
          : null;
        const summaryParts=[
          monitored+" mappings monitored",
          critical+" critical",
          (review+watch)+" watch",
        ];
        return(
          <div style={{marginTop:12,marginBottom:6,border:"0.5px solid #e5e7eb",borderRadius:8,padding:"10px 12px",background:"#fafafa"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <div style={{fontSize:11,fontWeight:700,color:"#374151"}}>Representative Model Check</div>
                <span style={{fontSize:10,fontWeight:500,padding:"2px 7px",borderRadius:3,background:fcBg,color:fcFg}}>Firecrawl: {fcLabel}</span>
                <span style={{fontSize:10,color:"#6b7280"}}>Price source: <b style={{color:"#374151",fontWeight:600}}>pricepertoken historical API</b></span>
                <span style={{fontSize:10,color:"#6b7280"}}>·</span>
                <span style={{fontSize:10,color:"#6b7280"}}>{summaryParts.join(" · ")}</span>
                {lastChecked&&<>
                  <span style={{fontSize:10,color:"#6b7280"}}>·</span>
                  <span style={{fontSize:10,color:"#9ca3af"}}>checked {lastChecked}</span>
                </>}
              </div>
              <button onClick={()=>setDiagOpen(o=>!o)}
                style={{fontSize:10,padding:"3px 10px",border:"0.5px solid #d1d5db",borderRadius:4,background:"#fff",color:"#374151",cursor:"pointer",fontFamily:"inherit",fontWeight:500}}>
                {diagOpen?"Hide diagnostics":"Show diagnostics"}
              </button>
            </div>
            <div style={{fontSize:10,color:"#9ca3af",marginTop:6,lineHeight:1.4}}>Fixed reps are not auto-rotated; review signals are advisory.</div>
            {diagOpen&&(
              <div style={{marginTop:10,border:"0.5px solid #e5e7eb",borderRadius:6,overflow:"hidden",background:"#fff"}}>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0,fontSize:11,background:"#fff"}}>
                    <thead>
                      <tr>
                        <th style={{textAlign:"left",padding:"6px 10px",fontSize:10,color:"#6b7280",fontWeight:600,whiteSpace:"nowrap",background:"#f3f4f6"}}>Rep</th>
                        <th style={{textAlign:"left",padding:"6px 10px",fontSize:10,color:"#6b7280",fontWeight:600,whiteSpace:"nowrap",background:"#f3f4f6"}}>Status</th>
                        <th style={{textAlign:"left",padding:"6px 10px",fontSize:10,color:"#6b7280",fontWeight:600,background:"#f3f4f6"}}>Pricepertoken signal</th>
                        <th style={{textAlign:"left",padding:"6px 10px",fontSize:10,color:"#6b7280",fontWeight:600,background:"#f3f4f6"}}>External docs signal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reps.map(rep=>{
                        const fr=rep.repFreshness||{status:"OK",ppEvidence:{newerStable:[],newerLimited:[]},firecrawlEvidence:{enabled:false,possibleNewerModels:[]}};
                        const statusBg=fr.status==="STALE"?"#fef2f2":fr.status==="REVIEW"?"#fef3c7":fr.status==="WATCH"?"#eff6ff":"#f3f4f6";
                        const statusFg=fr.status==="STALE"?"#991b1b":fr.status==="REVIEW"?"#78350f":fr.status==="WATCH"?"#1d4ed8":"#374151";
                        const ppAll=[...(fr.ppEvidence?.newerStable||[]),...(fr.ppEvidence?.newerLimited||[])];
                        const fcModels=fr.firecrawlEvidence?.possibleNewerModels||[];
                        return(
                          <tr key={"fresh-"+rep.key} style={{borderTop:"0.5px solid #e5e7eb"}}>
                            <td style={{padding:"6px 10px",whiteSpace:"nowrap",verticalAlign:"top"}}>
                              <div style={{fontWeight:600,color:"#111827"}}>{rep.label}</div>
                              <div style={{fontSize:10,color:"#9ca3af",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace"}}>{rep.modelDisplay}</div>
                            </td>
                            <td style={{padding:"6px 10px",whiteSpace:"nowrap",verticalAlign:"top"}}>
                              <span style={{fontSize:10,fontWeight:600,padding:"2px 7px",borderRadius:3,background:statusBg,color:statusFg}}>{fr.status}</span>
                            </td>
                            <td style={{padding:"6px 10px",fontSize:10,color:"#374151",verticalAlign:"top"}}>
                              {ppAll.length===0
                                ? <span style={{color:"#9ca3af"}}>—</span>
                                : <span title={ppAll.map(e=>e.model+" ("+e.obs+" obs)").join(", ")}>
                                    {ppAll.slice(0,2).map(e=>e.model).join(", ")}{ppAll.length>2?` +${ppAll.length-2}`:""}
                                  </span>}
                            </td>
                            <td style={{padding:"6px 10px",fontSize:10,color:"#374151",verticalAlign:"top"}}>
                              {!fr.firecrawlEvidence?.enabled
                                ? <span style={{color:"#9ca3af"}}>External docs check unavailable</span>
                                : fcModels.length===0
                                  ? <span style={{color:"#059669"}}>none</span>
                                  : <span title={fcModels.join(", ")}>{fcModels.slice(0,3).join(", ")}{fcModels.length>3?` +${fcModels.length-3}`:""}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      <div style={{fontSize:10,color:"#9ca3af",lineHeight:1.5,marginTop:6}}>
        <b style={{color:"#6b7280",fontWeight:600}}>Methodology:</b> Prices use pricepertoken historical model-level rows, averaged by calendar quarter and shown as $/1M tokens. QoQ/YoY compare only valid full historical periods; QTD growth is suppressed. Fixed representative models keep growth math comparable; the Frontier Reference shows how latest frontier labels change by period. Firecrawl is used only as an advisory model-discovery signal, never for pricing math.
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   TAB: Model Pricing
   Two internal subtabs (matches GPU Hardware Pricing's pill bar):
     1) Pricing Matrix          — existing matrix + signal + history + ppt embed
     2) Quality / Value Scatter — live reverse-proxy of sanand0.github.io/llmpricing
═══════════════════════════════════════════════════════ */
function ModelPricingTab(){
  const[subtab,setSubtab]=useState("matrix");
  return(
    <>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <Pill text="Model Pricing · pricepertoken.com + LLM Pricing scatter" bg="#ecfeff" color="#0e7490"/>
        </div>
      </div>

      {/* Subtab switcher — same pattern + visual weight as GPU Hardware Pricing */}
      <div style={{display:"flex",gap:4,marginBottom:14,borderBottom:"0.5px solid #e5e7eb",paddingBottom:0}}>
        {[
          {id:"matrix", label:"Pricing Matrix",          sub:"peer-pair table · signal · history · live ppt embed"},
          {id:"scatter",label:"Quality / Value Scatter", sub:"ELO × input-token cost · live · sanand0 llmpricing"},
        ].map(t=>{
          const active=subtab===t.id;
          return(
            <button key={t.id} onClick={()=>setSubtab(t.id)}
              style={{fontSize:12,padding:"8px 16px",border:"none",borderBottom:active?"2px solid #111827":"2px solid transparent",marginBottom:-1,background:"transparent",color:active?"#111827":"#6b7280",cursor:"pointer",fontFamily:"inherit",fontWeight:active?600:500,display:"flex",flexDirection:"column",alignItems:"flex-start",gap:1}}>
              <span>{t.label}</span>
              <span style={{fontSize:9,fontWeight:400,color:active?"#6b7280":"#9ca3af",textTransform:"lowercase"}}>{t.sub}</span>
            </button>
          );
        })}
      </div>

      {subtab==="matrix"
        ? <ModelPricingMatrixSubtab/>
        : <LLMPricingScatterSubtab/>
      }
    </>
  );
}

/* Pricing Matrix subtab — preserves the existing Model Pricing layout
   one-for-one (matrix → signal → quarterly history → live ppt embed). */
function ModelPricingMatrixSubtab(){
  const[err,setErr]=useState(false);
  return(
    <>
      <ModelPricingMatrixTable/>
      <PricingShareSignalBlock/>
      <ModelPricingHistoryBlock/>
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

/* Quality / Value Scatter subtab — live clipped iframe over the sanand0
   llmpricing scatter (?quality=overall by default). The reverse-proxy at
   /api/llmpricing-proxy/[[path]] handles the HTML shell and all asset/data
   relative URLs (script.js, README.md, elo.csv, narrative.json) so the chart
   renders entirely through our origin. Trailing slash on the iframe src is
   intentional: it makes every relative URL the page emits land back on the
   same proxy. */
function LLMPricingScatterSubtab(){
  const[err,setErr]=useState(false);
  return(
    <>
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
        <span style={{width:7,height:7,borderRadius:"50%",background:"#0e7490",display:"inline-block"}}/>
        <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:".09em",fontWeight:700,color:"#0e7490"}}>Model Pricing · live quality/value scatter</span>
      </div>
      <div style={{marginBottom:10}}>
        <div style={{fontSize:16,fontWeight:700,color:"#111827",lineHeight:1.3}}>LLM Pricing Quality / Value Scatter</div>
        <div style={{fontSize:11,color:"#6b7280",marginTop:3}}>
          Live model quality vs pricing comparison using ELO score and input-token cost.
        </div>
      </div>

      {err?(
        <div style={{background:"#f9fafb",border:"1px dashed #d1d5db",borderRadius:8,padding:"32px 16px",textAlign:"center"}}>
          <div style={{fontSize:13,color:"#6b7280",fontWeight:500}}>LLM pricing scatter temporarily unavailable.</div>
          <button onClick={()=>setErr(false)}
            style={{marginTop:10,fontSize:11,padding:"5px 14px",border:"0.5px solid #d1d5db",borderRadius:6,background:"#fff",color:"#374151",cursor:"pointer",fontFamily:"inherit"}}>
            Retry
          </button>
        </div>
      ):(
        <div style={{borderRadius:8,overflow:"hidden",border:"0.5px solid #e5e7eb",background:"#fff"}}>
          <iframe
            src={"/api/llmpricing-proxy/?quality=overall&v="+Math.floor(Date.now()/3e5)}
            title="LLM Pricing — Quality / Value Scatter"
            loading="lazy"
            onError={()=>setErr(true)}
            style={{border:0,display:"block",width:"100%",height:"calc(100vh - 280px)",minHeight:640}}
          />
        </div>
      )}
      <div style={{fontSize:10,color:"#9ca3af",marginTop:6}}>
        External live proxy · source: sanand0.github.io/llmpricing · directional quality/value comparison, not a filed financial metric.
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
        <div style={{fontSize:14,fontWeight:700,color:"#111827",lineHeight:1.3}}>Period-average GPU pricing for equity correlation</div>
        <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>
          Arithmetic mean of daily minPricePerHour by calendar period — real historical GPU pricing only.
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

// Primary visible rows ordered by generation (A100 oldest → GB200 newest), per
// the customer's investor framing: "from A100 to … Grace Blackwell". A100 is
// promoted from secondary because the customer named it explicitly as a major
// generation marker. AMD MI3xx, Rubin, Groq and other accelerators are NOT
// included here because the upstream getdeploying.com basket does not yet
// track them — adding empty rows would violate "do not include empty future
// rows just to show the names".
const GPU_FIN_PRIMARY_ROWS=[
  {sku:"Nvidia A100",   shortLabel:"A100 40/80GB HBM2e"},
  {sku:"Nvidia H100",   shortLabel:"H100 80GB HBM3"},
  {sku:"Nvidia H200",   shortLabel:"H200 141GB HBM3e"},
  {sku:"Nvidia B200",   shortLabel:"B200 192GB HBM3e"},
  {sku:"Nvidia GB200",  shortLabel:"GB200 (Grace Blackwell)"},
];
const GPU_FIN_SECONDARY_ROWS=[
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
// GPU price growth — color convention is buyer/cost-analysis: a price drop
// is favorable, so negatives render green and increases render red. Same
// inverted convention as the Model Pricing matrix; matches customer spec
// for this tab. (Resilience-signal callout below the growth rows still
// flags "stable/up" GREEN to convey the investor-side ROI read.)
function fmtGrowth(v){
  if(v==null||!isFinite(v))return<span style={{color:"#d1d5db"}}>—</span>;
  const str=v<0?"("+Math.abs(v).toFixed(1)+"%)":(v>0?"+":"")+v.toFixed(1)+"%";
  const color=v>0?"#dc2626":v<0?"#059669":"#6b7280";
  return <span style={{color}}>{str}</span>;
}

function GPUFinancialCorrelationBlock({fHist,fHistErr}){
  const[mode,setMode]=useState("quarter"); // "quarter" default per investor framing
  const[showSecondary,setShowSecondary]=useState(false);
  const[illustrative,setIllustrative]=useState(false);
  const[diagOpen,setDiagOpen]=useState(false); // diagnostics off by default; the
  // illustrative-data toggle is internal-only and lives inside this disclosure
  // so the customer-facing main view never shows fabricated values.

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

                {/* Spacer */}
                <tr><td colSpan={periods.length+1} style={{height:8}}></td></tr>

                {/* Section D: Provider Count — vendor breadth observed per (SKU, period).
                   Not rendered in illustrative mode (placeholder values don't carry it). */}
                {!illustrative&&<>
                  <tr><td colSpan={periods.length+1} style={finSectionTh}>Provider Count</td></tr>
                  {renderFinProviderRows(GPU_FIN_PRIMARY_ROWS,series,periods)}
                  {showSecondary&&renderFinProviderRows(GPU_FIN_SECONDARY_ROWS,series,periods,true)}

                  {/* Spacer */}
                  <tr><td colSpan={periods.length+1} style={{height:8}}></td></tr>

                  {/* Section E: Price Resilience Signal — flags where price has
                     held flat or risen across 2 consecutive completed periods.
                     Customer's "for prices not to go down is a big deal" lens —
                     stable older-gen prices imply tight supply / strong ROI. */}
                  <tr><td colSpan={periods.length+1} style={finSectionTh}>Price Resilience Signal</td></tr>
                  {renderFinResilienceRows(GPU_FIN_PRIMARY_ROWS,growth,periods,series,partialKey)}
                  {showSecondary&&renderFinResilienceRows(GPU_FIN_SECONDARY_ROWS,growth,periods,series,partialKey,true)}
                </>}
              </tbody>
            </table>
          </div>

          {/* Show more / Collapse secondary rows — hidden in illustrative mode (no secondary data) */}
          {!illustrative&&(
            <div style={{padding:"6px 10px",borderTop:"0.5px solid #e5e7eb",background:"#fafafa",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6}}>
              <span style={{fontSize:10,color:"#9ca3af"}}>
                {showSecondary?"Primary + secondary GPUs":"Primary GPUs (A100 / H100 / H200 / B200 / GB200)"} · tracked basket is fixed at the strategic accelerators captured by the upstream; the full 90+ SKU vendor table lives in Infra Monitoring.
              </span>
              <button onClick={()=>setShowSecondary(s=>!s)}
                style={{fontSize:10,padding:"4px 10px",border:"0.5px solid #d1d5db",borderRadius:4,background:"#fff",color:"#374151",cursor:"pointer",fontFamily:"inherit",fontWeight:500}}>
                {showSecondary?"− Hide secondary (L40S)":"+ Show L40S"}
              </button>
            </div>
          )}
          {illustrative&&(
            <div style={{padding:"6px 10px",borderTop:"0.5px solid #e5e7eb",background:"#fffbeb",fontSize:10,color:"#92400e",fontWeight:500}}>
              ⚠ Illustrative mode is on — values are NOT live. Flip off in diagnostics to return to the real-only investor view.
            </div>
          )}
        </div>
      )}

      {/* Methodology footnote — concise, customer-spec wording. */}
      <div style={{fontSize:10,color:"#9ca3af",lineHeight:1.5,marginTop:6}}>
        <b style={{color:"#6b7280",fontWeight:600}}>Methodology:</b> GPU prices use real historical minPricePerHour observations, averaged by SKU and calendar period. QoQ/YoY compare only valid completed periods; QTD growth is suppressed. GPU prices are not summed, because there is no meaningful total price across SKUs. Provider count shows observed vendor breadth where available. Stable or rising prices in older GPUs can indicate tight supply or strong ROI.
      </div>

      {/* Internal diagnostics — illustrative-data toggle lives here so it
         never appears in the customer-facing main view by default. Off by
         default; intended for layout/QA preview only. */}
      <div style={{marginTop:8}}>
        <button onClick={()=>setDiagOpen(o=>!o)}
          style={{fontSize:10,padding:"3px 10px",border:"0.5px solid #d1d5db",borderRadius:4,background:"#fff",color:"#6b7280",cursor:"pointer",fontFamily:"inherit",fontWeight:500}}>
          {diagOpen?"Hide diagnostics":"Show diagnostics"}
        </button>
        {diagOpen&&(
          <div style={{marginTop:8,padding:"10px 12px",border:"0.5px dashed #d1d5db",borderRadius:6,background:"#fafafa",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <span style={{fontSize:10,color:"#6b7280"}}>Internal-only — does not affect the live customer-facing view.</span>
            <IllustrativeToggle illustrative={illustrative} setIllustrative={setIllustrative}/>
          </div>
        )}
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

// Provider count per (SKU, period) — integer count of distinct providers
// observed in the period. Comes from the API's avgProviderCount field
// (mean of daily provider counts within the period; rounded for display).
// Customer's "Where are the providers?" lens: lets the operator see vendor
// breadth without cluttering the price cells.
function renderFinProviderRows(rows,series,periods,dim){
  const fmtProv=v=>{
    if(v==null||!isFinite(v)||v<=0)return<span style={{color:"#d1d5db"}}>—</span>;
    const n=Math.round(v);
    return <span style={{color:"#374151"}}>{n}</span>;
  };
  return rows.map(row=>{
    const byPeriod=Object.fromEntries((series[row.sku]||[]).map(x=>[x.period,x]));
    return(
      <tr key={"prov-"+row.sku}>
        <td style={{...finTdRow,color:dim?"#6b7280":"#111827"}}>{row.shortLabel}</td>
        {periods.map(p=>{
          const s=byPeriod[p.period];
          return(
            <td key={p.period} style={finTdDim}
                title={s?Math.round(s.avgProviderCount||0)+" distinct providers observed (avg of daily counts in "+p.label+")":undefined}>
              {fmtProv(s?s.avgProviderCount:null)}
            </td>
          );
        })}
      </tr>
    );
  });
}

// Per-(SKU, period) price resilience signal. For period P, looks at QoQ at
// P (current vs P-1) AND QoQ at P-1 (P-1 vs P-2). If both are ≥0 → "Stable/up 2Q"
// (green; investor-bullish — aligns with the customer's "for prices not to go
// down is a big deal" point). If either is <0 → "Falling" (muted gray;
// neutral framing — not bearish per se, just no resilience signal). Suppressed
// to "—" for partial periods (QTD/MTD) and where the two-quarter look-back
// can't be computed.
function renderFinResilienceRows(rows,growth,periods,series,partialKey,dim){
  return rows.map(row=>{
    const row_g=growth[row.sku]||{};
    const byPeriod=Object.fromEntries((series[row.sku]||[]).map(x=>[x.period,x]));
    return(
      <tr key={"res-"+row.sku}>
        <td style={{...finTdRow,color:dim?"#6b7280":"#111827"}}>{row.shortLabel}</td>
        {periods.map((p,i)=>{
          // Suppress for the current partial period — a partial-quarter avg
          // can't honestly be compared against a full-quarter prior.
          const cur=byPeriod[p.period];
          if(cur&&cur[partialKey]){
            return <td key={p.period} style={finTdDim}><span style={{color:"#d1d5db"}}>—</span></td>;
          }
          const cqp=row_g[p.period];
          const priorPeriod=i>0?periods[i-1]:null;
          const pqp=priorPeriod?row_g[priorPeriod.period]:null;
          if(cqp==null||pqp==null||!isFinite(cqp)||!isFinite(pqp)){
            return <td key={p.period} style={finTdDim}><span style={{color:"#d1d5db"}}>—</span></td>;
          }
          const stable=cqp>=0&&pqp>=0;
          const label=stable?"Stable/up 2Q":"Falling";
          const bg=stable?"#ecfdf5":"#f3f4f6";
          const fg=stable?"#047857":"#6b7280";
          return(
            <td key={p.period} style={finTdDim}>
              <span style={{fontSize:9,fontWeight:600,padding:"1px 6px",borderRadius:3,background:bg,color:fg,whiteSpace:"nowrap"}} title={"QoQ "+p.label+": "+cqp.toFixed(1)+"% · prior QoQ: "+pqp.toFixed(1)+"%"}>{label}</span>
            </td>
          );
        })}
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

/* Period builders. Both return the same row shape so the table renderer
   can stay mode-agnostic:
     {id,label,year,(quarter|month),start,end,partial,shortCoverage,
      coverageObserved,coverageDenom,coverageUnit,total,google,openai,anthropic,other}

   Quarter rule: a week is wholly attributed to the calendar quarter of its
   start date (Monday). ISO weeks rarely cross quarter boundaries — when they
   do (e.g. Mar 31 → Apr 6) one quarter gets a small over-attribution and
   the neighbour gets a small under, but error is bounded at <1 week per year.
   This is the same convention HistoryTabCanonical uses; we keep both views
   consistent.

   Month rule: an ISO week routinely straddles a calendar month, so we split
   the week's tokens across the two months by day-count fraction. That keeps
   Σ months = Σ weeks exactly while attributing tokens to the calendar period
   they were actually earned in. */
function _bucketWeekProviderSums(w){
  const ys=w.allModels||Object.fromEntries((w.topModels||[]).map(tm=>[tm.slug,tm.tokens]));
  const out={google:0,openai:0,anthropic:0};
  for(const slug of Object.keys(ys)){
    const tokens=ys[slug];
    if(!tokens||tokens<=0)continue;
    const b=bucketProviderFromSlug(slug);
    if(b)out[b]+=tokens;
  }
  return out;
}

function buildQuarterlyPeriods(weeks){
  const QLBL=["Mar","Jun","Sep","Dec"];
  const groups=new Map();
  for(const w of weeks){
    const [y,m]=w.start.split("-").map(Number);
    const q=Math.floor((m-1)/3)+1;
    const id=y+"-Q"+q;
    if(!groups.has(id)){
      const startMonth=(q-1)*3;
      const start=y+"-"+String(startMonth+1).padStart(2,"0")+"-01";
      const endD=new Date(Date.UTC(y,startMonth+3,0));
      groups.set(id,{
        id,year:y,quarter:q,
        label:QLBL[q-1]+"-"+String(y).slice(2),
        start,end:endD.toISOString().slice(0,10),
        partial:false,weekCount:0,
        total:0,google:0,openai:0,anthropic:0,
      });
    }
    const g=groups.get(id);
    g.weekCount+=1;
    g.total+=(w.totalRaw||0);
    if(w.partial)g.partial=true;
    const buckets=_bucketWeekProviderSums(w);
    g.google+=buckets.google;
    g.openai+=buckets.openai;
    g.anthropic+=buckets.anthropic;
  }
  const out=Array.from(groups.values()).sort((a,b)=>a.id<b.id?-1:1);
  for(const g of out){
    g.other=Math.max(0,g.total-g.google-g.openai-g.anthropic);
    g.shortCoverage=!g.partial&&g.weekCount<12;
    g.coverageObserved=g.weekCount;
    g.coverageDenom=13;
    g.coverageUnit="w";
  }
  return out;
}

function buildMonthlyPeriods(weeks){
  const MNAMES=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const NOW=new Date();
  const TODAY_TS=Date.UTC(NOW.getUTCFullYear(),NOW.getUTCMonth(),NOW.getUTCDate());
  const todayKey=NOW.getUTCFullYear()+"-"+String(NOW.getUTCMonth()+1).padStart(2,"0");
  const groups=new Map();

  function ensure(y,m){
    const id=y+"-"+String(m).padStart(2,"0");
    if(!groups.has(id)){
      const startD=new Date(Date.UTC(y,m-1,1));
      const endD=new Date(Date.UTC(y,m,0));
      groups.set(id,{
        id,year:y,month:m,
        label:MNAMES[m-1]+"-"+String(y).slice(2),
        start:startD.toISOString().slice(0,10),
        end:endD.toISOString().slice(0,10),
        partial:false,
        daysObserved:0,daysInMonth:endD.getUTCDate(),
        total:0,google:0,openai:0,anthropic:0,
      });
    }
    return groups.get(id);
  }

  for(const w of weeks){
    const [sy,sm,sd]=w.start.split("-").map(Number);
    const startTs=Date.UTC(sy,sm-1,sd);
    // For an in-progress week the totalRaw reflects tokens accumulated only
    // through `forecastFromTimestamp` — i.e. up to "today". Days past today
    // haven't happened yet, so we must not distribute tokens to them. Cap
    // the day-window at the elapsed days for partial weeks; full weeks use
    // all 7. This prevents future months from appearing as MTD columns
    // (e.g. a Mon Apr 27 in-progress week was previously bleeding 3 days'
    // worth of tokens into May).
    const elapsed=Math.max(1,Math.min(7,Math.floor((TODAY_TS-startTs)/86400000)+1));
    const dayCount=w.partial?elapsed:7;

    const dayMonthCounts=new Map();
    for(let i=0;i<dayCount;i++){
      const d=new Date(startTs+i*86400000);
      const id=d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0");
      dayMonthCounts.set(id,(dayMonthCounts.get(id)||0)+1);
    }
    const buckets=_bucketWeekProviderSums(w);
    for(const [monthId,days] of dayMonthCounts){
      const fraction=days/dayCount;
      const [y,m]=monthId.split("-").map(Number);
      const g=ensure(y,m);
      g.total     +=(w.totalRaw||0)*fraction;
      g.google    +=buckets.google*fraction;
      g.openai    +=buckets.openai*fraction;
      g.anthropic +=buckets.anthropic*fraction;
      g.daysObserved+=days;
    }
  }

  // Partial = MTD applies ONLY to the current calendar month. Previous months
  // touched by an in-progress week are still complete (they happened before
  // today); we don't want to flag them MTD.
  for(const g of groups.values()){
    if(g.id===todayKey)g.partial=true;
  }

  const out=Array.from(groups.values()).sort((a,b)=>a.id<b.id?-1:1);
  for(const g of out){
    g.other=Math.max(0,g.total-g.google-g.openai-g.anthropic);
    g.shortCoverage=!g.partial&&g.daysObserved<g.daysInMonth;
    g.coverageObserved=g.daysObserved;
    g.coverageDenom=g.daysInMonth;
    g.coverageUnit="d";
  }
  return out;
}

function OpenRouterTokenDemandTable(){
  const[mode,setMode]=useState("quarter"); // "quarter" (default) | "month"
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

  const subtitle=mode==="month"
    ? "Month-aligned OpenRouter token demand, provider share, and growth — real historical chart data only."
    : "Quarter-aligned OpenRouter token demand, provider share, and growth — real historical chart data only.";

  const ModeToggle=(
    <div style={{display:"inline-flex",border:"0.5px solid #e5e7eb",borderRadius:6,overflow:"hidden",background:"#fff",flexShrink:0}}>
      {["quarter","month"].map(v=>{
        const active=mode===v;
        return(
          <button key={v} onClick={()=>setMode(v)}
            style={{fontSize:11,padding:"4px 12px",border:"none",background:active?"#111827":"#fff",color:active?"#fff":"#6b7280",cursor:"pointer",fontFamily:"inherit",fontWeight:500,textTransform:"capitalize"}}>
            {v==="quarter"?"Quarter":"Month"}
          </button>
        );
      })}
    </div>
  );

  const header=(
    <>
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
        <span style={{width:7,height:7,borderRadius:"50%",background:"#1d4ed8",display:"inline-block"}}/>
        <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:".09em",fontWeight:700,color:"#1d4ed8"}}>OpenRouter Token Demand</span>
      </div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,marginBottom:10,flexWrap:"wrap"}}>
        <div style={{flex:"1 1 auto",minWidth:0}}>
          <div style={{fontSize:16,fontWeight:700,color:"#111827",lineHeight:1.3}}>OpenRouter Token Demand by Provider</div>
          <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>{subtitle}</div>
        </div>
        {ModeToggle}
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

  // Periods: same row shape regardless of mode, so the renderer below stays
  // unified. Quarter view is the default; Month view shares everything except
  // the period builder, the growth-row label (QoQ ↔ MoM), the partial badge
  // (QTD ↔ MTD), and the short-coverage unit (w ↔ d).
  const periods=mode==="month"?buildMonthlyPeriods(weeks):buildQuarterlyPeriods(weeks);
  const byId=Object.fromEntries(periods.map(p=>[p.id,p]));

  const priorIdFn=mode==="month"
    ? (p)=>p.month===1?(p.year-1)+"-12":p.year+"-"+String(p.month-1).padStart(2,"0")
    : (p)=>p.quarter===1?(p.year-1)+"-Q4":p.year+"-Q"+(p.quarter-1);
  const yoyIdFn=mode==="month"
    ? (p)=>(p.year-1)+"-"+String(p.month).padStart(2,"0")
    : (p)=>(p.year-1)+"-Q"+p.quarter;

  const growth={primary:{},yoy:{}};
  for(const p of periods){
    growth.primary[p.id]={};
    growth.yoy[p.id]={};
    if(p.partial)continue; // QTD/MTD: full-period comparisons are not meaningful
    const prior=byId[priorIdFn(p)];
    const yoy  =byId[yoyIdFn(p)];
    for(const k of["google","openai","anthropic","other","total"]){
      // Compute against any non-QTD/MTD comparator that has data. A short-coverage
      // comparator still represents real observed tokens — flagging it on the
      // column header is enough; we don't also need to blank the cell.
      if(prior&&!prior.partial&&prior[k]>0){
        growth.primary[p.id][k]=((p[k]-prior[k])/prior[k])*100;
      }
      if(yoy&&!yoy.partial&&yoy[k]>0){
        growth.yoy[p.id][k]=((p[k]-yoy[k])/yoy[k])*100;
      }
    }
  }

  const partialBadge=mode==="month"?"MTD":"QTD";
  const primaryGrowthLabel=mode==="month"?"MoM Growth":"QoQ Growth";
  const periodWord=mode==="month"?"month":"quarter";

  // Display rules: a genuine 0 is rendered as "0" / "0.0%" so the Tokens and
  // Share rows agree (missing tokens with non-zero share would be incoherent
  // — e.g. OpenAI Jun-26 QTD ≈ 0 tokens reads "0" + "0.0%", not "—" + "0.0%").
  // "—" is reserved for genuinely absent values (null / non-finite) and for
  // shares whose denominator is zero (no period total to divide against).
  const fmtTok=v=>{
    if(v==null||!isFinite(v))return"—";
    if(v===0)return"0";
    if(v<0)return"—";
    if(v>=1e12)return(v/1e12).toFixed(2).replace(/\.?0+$/,"")+"T";
    if(v>=1e9) return(v/1e9) .toFixed(1).replace(/\.0$/,"")    +"B";
    if(v>=1e6) return(v/1e6) .toFixed(1).replace(/\.0$/,"")    +"M";
    return Math.round(v).toString();
  };
  const fmtShare=(num,den)=>{
    if(num==null||!isFinite(num))return"—";
    if(den==null||!isFinite(den)||den<=0)return"—";
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

  const renderSectionRow=(label,ps,style)=>(
    <tr key={"sec-"+label}>
      <td style={style}>{label}</td>
      {ps.map(p=>(<td key={p.id} style={{padding:"10px 10px 4px",background:"#f3f4f6",minWidth:COL_W}}/>))}
    </tr>
  );
  const renderTokenRow=b=>(
    <tr key={"tok-"+b.key}>
      <td style={tdFirst}>{b.label}</td>
      {periods.map(p=>(<td key={p.id} style={tdMain}>{fmtTok(p[b.key])}</td>))}
    </tr>
  );
  const renderShareRow=b=>(
    <tr key={"sh-"+b.key}>
      <td style={tdFirst}>{b.label}</td>
      {periods.map(p=>(<td key={p.id} style={tdDim}>{fmtShare(p[b.key],p.total)}</td>))}
    </tr>
  );
  const renderGrowthRow=(b,bucket)=>(
    <tr key={bucket+"-"+b.key}>
      <td style={tdFirst}>{b.label}</td>
      {periods.map(p=>(<td key={p.id} style={tdDim}>{fmtG(growth[bucket][p.id]?.[b.key])}</td>))}
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
          <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0,background:"#f3f4f6",minWidth:FIRST_COL_W+COL_W*Math.max(periods.length,4)}}>
            <thead>
              <tr>
                <th style={thFirst}></th>
                {periods.map(p=>(
                  <th key={p.id} style={thMain}>
                    {p.label}
                    {p.partial&&<span style={{marginLeft:3,fontSize:8,color:"#b45309",fontWeight:500}}>{partialBadge}</span>}
                    {p.shortCoverage&&<span title={p.coverageObserved+" / "+p.coverageDenom+" "+(p.coverageUnit==="d"?"days":"ISO weeks")+" observed (data window opened mid-"+periodWord+")"} style={{marginLeft:3,fontSize:8,color:"#b45309",fontWeight:500}}>{p.coverageObserved}{p.coverageUnit}</span>}
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
              {renderSectionRow("Tokens",periods,sectionTh)}
              {provBuckets.map(renderTokenRow)}
              <tr key="tok-total">
                <td style={tdFirstTotal}>Total</td>
                {periods.map(p=>(<td key={p.id} style={{...tdMain,fontWeight:700}}>{fmtTok(p.total)}</td>))}
              </tr>

              <tr><td colSpan={periods.length+1} style={{height:8,background:"#f9fafb"}}></td></tr>

              {renderSectionRow("Share of Tokens",periods,sectionTh)}
              {provBuckets.map(renderShareRow)}

              <tr><td colSpan={periods.length+1} style={{height:8,background:"#f9fafb"}}></td></tr>

              {renderSectionRow(primaryGrowthLabel,periods,sectionTh)}
              {provBuckets.map(b=>renderGrowthRow(b,"primary"))}
              <tr key="primary-total">
                <td style={tdFirstTotal}>Total</td>
                {periods.map(p=>(<td key={p.id} style={tdDim}>{fmtG(growth.primary[p.id]?.total)}</td>))}
              </tr>

              <tr><td colSpan={periods.length+1} style={{height:8,background:"#f9fafb"}}></td></tr>

              {renderSectionRow("YoY Growth",periods,sectionTh)}
              {provBuckets.map(b=>renderGrowthRow(b,"yoy"))}
              <tr key="yoy-total">
                <td style={tdFirstTotal}>Total</td>
                {periods.map(p=>(<td key={p.id} style={tdDim}>{fmtG(growth.yoy[p.id]?.total)}</td>))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div style={{fontSize:10,color:"#9ca3af",lineHeight:1.5,marginTop:6}}>
        <b style={{color:"#6b7280",fontWeight:600}}>Methodology:</b> {mode==="month"
          ? <>Month buckets aggregate weekly OpenRouter chart-native data into calendar months. ISO weeks that straddle a month boundary are split across the two months by day-count fraction (so Σ months = Σ weeks exactly). </>
          : <>Quarter buckets aggregate weekly OpenRouter chart-native data into calendar quarters (a week is attributed to the quarter of its Monday start). </>}
        Provider buckets group models by slug prefix and family-name match: Google / Gemini, OpenAI (incl. GPT/o-series), Anthropic (incl. Claude). Other = period total − the three named buckets. {mode==="month"?"MoM":"QoQ"} = current {periodWord} vs immediately prior calendar {periodWord}; YoY = current {periodWord} vs same calendar {periodWord} previous year. Growth values render <b>—</b> only when the comparator {periodWord} is the current in-progress period ({partialBadge}) or doesn't exist in the observed window. The current incomplete {periodWord} is labeled <b>{partialBadge}</b>; full-{periodWord} comparisons against {partialBadge} are not computed.
        <br/>
        <b style={{color:"#6b7280",fontWeight:600}}>Short-coverage {periodWord}s:</b> {periodWord==="month"?"Months":"Quarters"} at the start of the data window may have fewer than the full {mode==="month"?"calendar days":"~13 ISO weeks"} observed (the chart-native source begins mid-{periodWord}). These columns are tagged with their {mode==="month"?"day":"week"} count (e.g. <span style={{color:"#b45309",fontWeight:500}}>{mode==="month"?"3d":"10w"}</span>). {mode==="month"?"MoM":"QoQ"} growth into the next {periodWord} against a short-coverage comparator can be inflated by the {mode==="month"?"day":"week"}-count gap — read the magnitude with that in mind.
        <br/>
        <b style={{color:"#6b7280",fontWeight:600}}>Source coverage caveat:</b> The OpenRouter chart payload exposes the week's top-9 named models plus a single <i>Others</i> rollup — long-tail models below the top-9 cutoff are aggregated into Others and flow into this table's <i>Other</i> bucket. A 0 in a named provider's row therefore means <i>"no model in OR's tracked top-9 for that period"</i>, not "literally zero usage": tokens for that provider's smaller models are still counted in the period total and absorbed into Other.
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   GOOGLE / GEMINI ADOPTION (subset of AI Adoption table)
   First detailed section in the Google Cloud / Model API Usage tab.
   Reuses the SAME data source and period builder as the AI Adoption
   OpenRouter Token Demand table — just slices the Google bucket out.
   No new fetch, no new aggregation logic; only a render that focuses
   on Google / Gemini tokens, share of OR total, QoQ, YoY.

   Reused from AI Adoption / OpenRouterTokenDemandTable:
     - GET /api/openrouter-chart-weekly?full=1
     - bucketProviderFromSlug (transitively, via _bucketWeekProviderSums)
     - buildQuarterlyPeriods(weeks) — returns periods with .google + .total
     - quarter-end label convention (Mar/Jun/Sep/Dec)
     - QTD detection + growth suppression for partial periods
═══════════════════════════════════════════════════════ */
function GoogleGeminiAdoptionTable(){
  const[mode,setMode]=useState("quarter"); // "quarter" (default) | "month"
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

  const subtitle=mode==="month"
    ? "Google-specific cut of OpenRouter token demand by month — real historical chart data only."
    : "Google-specific cut of OpenRouter token demand — real historical chart data only.";

  const ModeToggle=(
    <div style={{display:"inline-flex",border:"0.5px solid #e5e7eb",borderRadius:6,overflow:"hidden",background:"#fff",flexShrink:0}}>
      {["quarter","month"].map(v=>{
        const active=mode===v;
        return(
          <button key={v} onClick={()=>setMode(v)}
            style={{fontSize:11,padding:"4px 12px",border:"none",background:active?"#111827":"#fff",color:active?"#fff":"#6b7280",cursor:"pointer",fontFamily:"inherit",fontWeight:500,textTransform:"capitalize"}}>
            {v==="quarter"?"Quarter":"Month"}
          </button>
        );
      })}
    </div>
  );

  const header=(
    <>
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
        <span style={{width:7,height:7,borderRadius:"50%",background:"#6366f1",display:"inline-block"}}/>
        <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:".09em",fontWeight:700,color:"#6366f1"}}>Google / Gemini · OpenRouter subset</span>
      </div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,marginBottom:10,flexWrap:"wrap"}}>
        <div style={{flex:"1 1 auto",minWidth:0}}>
          <div style={{fontSize:16,fontWeight:700,color:"#111827",lineHeight:1.3}}>Google / Gemini AI Adoption</div>
          <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>{subtitle}</div>
        </div>
        {ModeToggle}
      </div>
    </>
  );

  if(state.phase==="loading"){
    return(<div style={{marginBottom:16}}>{header}<div style={{...S.card}}><Shimmer rows={4}/></div></div>);
  }
  if(state.phase==="error"){
    return(
      <div style={{marginBottom:16}}>{header}
        <div style={{background:"#fff",border:"0.5px dashed #fca5a5",borderRadius:10,padding:"14px 16px"}}>
          <div style={{fontSize:12,color:"#991b1b",fontWeight:500}}>Google / Gemini adoption subset temporarily unavailable</div>
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
          <div style={{fontSize:12,color:"#111827",fontWeight:500}}>Subset populates as real OpenRouter weeks accumulate</div>
        </div>
      </div>
    );
  }

  // Period builder reused from the AI Adoption table: same data, same
  // bucketing, same shape. Quarter view → buildQuarterlyPeriods; Month
  // view → buildMonthlyPeriods (which day-fraction-splits ISO weeks that
  // straddle a month boundary so Σ months = Σ weeks exactly).
  const periods=mode==="month"?buildMonthlyPeriods(weeks):buildQuarterlyPeriods(weeks);
  const byId=Object.fromEntries(periods.map(p=>[p.id,p]));

  const priorIdFn=mode==="month"
    ? (p)=>p.month===1?(p.year-1)+"-12":p.year+"-"+String(p.month-1).padStart(2,"0")
    : (p)=>p.quarter===1?(p.year-1)+"-Q4":p.year+"-Q"+(p.quarter-1);
  const yoyIdFn=mode==="month"
    ? (p)=>(p.year-1)+"-"+String(p.month).padStart(2,"0")
    : (p)=>(p.year-1)+"-Q"+p.quarter;

  // Per-period growth on the Google bucket only. Same suppression rule as
  // the AI Adoption table: skip the QTD/MTD period; require a non-partial
  // comparator with non-zero google value.
  const growth={primary:{},yoy:{}};
  for(const p of periods){
    growth.primary[p.id]=null;
    growth.yoy[p.id]=null;
    if(p.partial)continue;
    const prior=byId[priorIdFn(p)];
    const yoy  =byId[yoyIdFn(p)];
    if(prior&&!prior.partial&&prior.google>0){
      growth.primary[p.id]=((p.google-prior.google)/prior.google)*100;
    }
    if(yoy&&!yoy.partial&&yoy.google>0){
      growth.yoy[p.id]=((p.google-yoy.google)/yoy.google)*100;
    }
  }

  const partialBadge=mode==="month"?"MTD":"QTD";
  const primaryGrowthLabel=mode==="month"?"MoM Growth":"QoQ Growth";

  // Format helpers — same display rules as AI Adoption (genuine 0 → "0",
  // missing → "—", positive growth = green, negative = red).
  const fmtTok=v=>{
    if(v==null||!isFinite(v))return"—";
    if(v===0)return"0";
    if(v<0)return"—";
    if(v>=1e12)return(v/1e12).toFixed(2).replace(/\.?0+$/,"")+"T";
    if(v>=1e9) return(v/1e9) .toFixed(1).replace(/\.0$/,"")    +"B";
    if(v>=1e6) return(v/1e6) .toFixed(1).replace(/\.0$/,"")    +"M";
    return Math.round(v).toString();
  };
  const fmtShare=(num,den)=>{
    if(num==null||!isFinite(num))return"—";
    if(den==null||!isFinite(den)||den<=0)return"—";
    return (num/den*100).toFixed(1)+"%";
  };
  const fmtG=v=>{
    if(v==null||!isFinite(v))return<span style={{color:"#d1d5db"}}>—</span>;
    const str=v<0?"("+Math.abs(v).toFixed(1)+"%)":(v>0?"+":"")+v.toFixed(1)+"%";
    const color=v>0?"#059669":v<0?"#dc2626":"#6b7280";
    return <span style={{color}}>{str}</span>;
  };

  const STICKY_BG="#f3f4f6";
  const STICKY_SHADOW="2px 0 0 #e5e7eb, 6px 0 6px -4px rgba(17,24,39,0.08)";
  const FIRST_COL_W=260;
  const COL_W=110;
  const stickyFirstBase={position:"sticky",left:0,background:STICKY_BG,boxShadow:STICKY_SHADOW,minWidth:FIRST_COL_W,maxWidth:FIRST_COL_W,width:FIRST_COL_W};
  const thMain={textAlign:"right",padding:"5px 10px",fontSize:10,color:"#6b7280",fontWeight:600,whiteSpace:"nowrap",minWidth:COL_W};
  const thFirst={...stickyFirstBase,textAlign:"left",padding:"5px 10px",fontSize:10,color:"#6b7280",fontWeight:600,whiteSpace:"nowrap",zIndex:3};
  const tdMain={textAlign:"right",padding:"4px 10px",fontSize:12,color:"#111827",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",whiteSpace:"nowrap",minWidth:COL_W};
  const tdDim ={textAlign:"right",padding:"4px 10px",fontSize:12,color:"#6b7280",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",whiteSpace:"nowrap",minWidth:COL_W};
  const tdFirst={...stickyFirstBase,textAlign:"left",padding:"6px 10px 6px 18px",fontSize:11,color:"#111827",fontWeight:600,whiteSpace:"nowrap",zIndex:2};

  const rows=[
    {key:"tokens",  label:"Google / Gemini Tokens",                   render:p=>(<td key={p.id} style={tdMain}>{fmtTok(p.google)}</td>)},
    {key:"share",   label:"Google / Gemini Share of OpenRouter Tokens",render:p=>(<td key={p.id} style={tdDim}>{fmtShare(p.google,p.total)}</td>)},
    {key:"primary", label:"Google / Gemini "+primaryGrowthLabel,       render:p=>(<td key={p.id} style={tdDim}>{fmtG(growth.primary[p.id])}</td>)},
    {key:"yoy",     label:"Google / Gemini YoY Growth",               render:p=>(<td key={p.id} style={tdDim}>{fmtG(growth.yoy[p.id])}</td>)},
  ];

  return(
    <div style={{marginBottom:16}}>
      {header}
      <div style={{border:"0.5px solid #e5e7eb",borderRadius:8,overflow:"hidden",background:"#f9fafb"}}>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0,background:"#f3f4f6",minWidth:FIRST_COL_W+COL_W*periods.length}}>
            <thead>
              <tr>
                <th style={thFirst}></th>
                {periods.map(p=>(
                  <th key={p.id} style={thMain}>
                    {p.label}
                    {p.partial&&<span style={{marginLeft:3,fontSize:8,color:"#b45309",fontWeight:500}}>{partialBadge}</span>}
                    {p.shortCoverage&&<span style={{marginLeft:3,fontSize:8,color:"#b45309",fontWeight:500}}>{p.coverageObserved}{p.coverageUnit}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r=>(
                <tr key={r.key}>
                  <td style={tdFirst}>{r.label}</td>
                  {periods.map(p=>r.render(p))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{fontSize:10,color:"#9ca3af",lineHeight:1.5,marginTop:6}}>
        OpenRouter is a third-party developer/router usage proxy. This is not total Gemini consumer usage or total Google Cloud API usage.
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   GOOGLE / GEMINI MODEL PRICING (subset of Model Pricing tab)
   Second detailed section in the Google Cloud / Model API Usage tab.
   Reuses /api/model-pricing-peer-matrix (the same endpoint that drives
   the full Model Pricing tab) and slices to the google-frontier and
   google-fast reps. No new fetch logic, no new pricing math, no new
   model-class definitions — the endpoint already maps these slots
   server-side via PEER_MODELS.
═══════════════════════════════════════════════════════ */
function GoogleGeminiPricingTable(){
  const[mode,setMode]=useState("quarter"); // "quarter" (default) | "month"
  const[metric,setMetric]=useState("input"); // "input" | "output"
  const[state,setState]=useState({phase:"loading",data:null,error:null});
  useEffect(()=>{
    let cancelled=false;
    fetch("/api/model-pricing-peer-matrix?v="+Math.floor(Date.now()/3e5))
      .then(r=>r.ok?r.json():Promise.reject(new Error("HTTP "+r.status)))
      .then(d=>{
        if(cancelled)return;
        if(!d||d.success===false){setState({phase:"error",data:null,error:d?.error||"Unknown error"});return;}
        setState({phase:"ready",data:d,error:null});
      })
      .catch(e=>{if(!cancelled)setState({phase:"error",data:null,error:e.message||"Fetch failed"});});
    return()=>{cancelled=true;};
  },[]);

  const subtitle = mode==="month"
    ? "Every Google/Gemini model in pricepertoken's history, by month."
    : "Every Google/Gemini model in pricepertoken's history, by quarter.";

  const SegToggle=({value,onChange,options})=>(
    <div style={{display:"inline-flex",border:"0.5px solid #e5e7eb",borderRadius:6,overflow:"hidden",background:"#fff",flexShrink:0}}>
      {options.map(o=>{
        const active=value===o.v;
        return(
          <button key={o.v} onClick={()=>onChange(o.v)}
            style={{fontSize:11,padding:"4px 12px",border:"none",background:active?"#111827":"#fff",color:active?"#fff":"#6b7280",cursor:"pointer",fontFamily:"inherit",fontWeight:500}}>
            {o.label}
          </button>
        );
      })}
    </div>
  );

  const header=(
    <>
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
        <span style={{width:7,height:7,borderRadius:"50%",background:"#0e7490",display:"inline-block"}}/>
        <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:".09em",fontWeight:700,color:"#0e7490"}}>Google / Gemini · All Models · Pricing</span>
      </div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,marginBottom:10,flexWrap:"wrap"}}>
        <div style={{flex:"1 1 auto",minWidth:0}}>
          <div style={{fontSize:16,fontWeight:700,color:"#111827",lineHeight:1.3}}>Google / Gemini — All Model Pricing</div>
          <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>{subtitle}</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <SegToggle value={metric} onChange={setMetric} options={[{v:"input",label:"Input"},{v:"output",label:"Output"}]}/>
          <SegToggle value={mode}   onChange={setMode}   options={[{v:"quarter",label:"Quarter"},{v:"month",label:"Month"}]}/>
        </div>
      </div>
    </>
  );

  if(state.phase==="loading"){
    return(<div style={{marginBottom:16}}>{header}<div style={{...S.card}}><Shimmer rows={8}/></div></div>);
  }
  if(state.phase==="error"){
    return(
      <div style={{marginBottom:16}}>{header}
        <div style={{background:"#fff",border:"0.5px dashed #fca5a5",borderRadius:10,padding:"14px 16px"}}>
          <div style={{fontSize:12,color:"#991b1b",fontWeight:500}}>Google / Gemini pricing temporarily unavailable</div>
          <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>{state.error||"/api/model-pricing-peer-matrix did not return success"}</div>
        </div>
      </div>
    );
  }

  const data=state.data;
  const periods = mode==="month" ? (data?.months||[]) : (data?.quarters||[]);
  const models  = data?.googleModels || [];

  if(!periods.length||!models.length){
    return(
      <div style={{marginBottom:16}}>{header}
        <div style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:10,padding:"14px 16px"}}>
          <div style={{fontSize:12,color:"#111827",fontWeight:500}}>Populates as upstream Google pricing history accumulates</div>
        </div>
      </div>
    );
  }

  // Tier classification — finance-model grouping for an investor-facing tab.
  // Display order: Frontier/Pro first, then Fast tiers, then Specialty, then
  // open-weights and other families. Each Gemini sub-tier matcher explicitly
  // excludes specialty markers so the display order can be customer-facing
  // without breaking classification (e.g. gemini-3-pro-image-preview must
  // land in Specialty, not Pro, even though Pro is checked first).
  const SPECIALTY_RE = /image|audio|tts|transcribe|computeruse|embedding|customtools|nativeaudio/;
  const TIERS = [
    {id:"pro",         label:"Gemini Pro / Frontier",     match: n => /^gemini/.test(n) && /pro/.test(n)   && !SPECIALTY_RE.test(n) },
    {id:"flash",       label:"Gemini Flash",              match: n => /^gemini/.test(n) && /flash/.test(n) && !/lite/.test(n) && !SPECIALTY_RE.test(n) },
    {id:"flashlite",   label:"Gemini Flash-Lite",         match: n => /^gemini/.test(n) && /flash/.test(n) &&  /lite/.test(n) && !SPECIALTY_RE.test(n) },
    {id:"specialty",   label:"Gemini Specialty / Modal",  match: n => /^gemini/.test(n) && SPECIALTY_RE.test(n) },
    {id:"gemma",       label:"Gemma (Open Weights)",      match: n => /^gemma/.test(n) },
    {id:"lyria",       label:"Lyria (Audio Generation)",  match: n => /^lyria/.test(n) },
    {id:"otherGemini", label:"Other Gemini",              match: n => /^gemini/.test(n) },
    {id:"other",       label:"Other",                     match: () => true },
  ];

  const classify = m => {
    for (const t of TIERS) if (t.match(m.norm)) return t.id;
    return "other";
  };
  const grouped = new Map(TIERS.map(t => [t.id, []]));
  for (const m of models) grouped.get(classify(m)).push(m);
  // Already pre-sorted by lastDate desc on the server; preserve.

  const fmtPrice=v=>{
    if(v==null||!isFinite(v))return"—";
    if(v>=10)return"$"+v.toFixed(2);
    if(v>=1) return"$"+v.toFixed(2);
    return "$"+v.toFixed(3);
  };
  const fmtChange=v=>{
    if(v==null||!isFinite(v))return<span style={{color:"#d1d5db"}}>—</span>;
    const pct=v*100;
    const str=pct<0?"("+Math.abs(pct).toFixed(1)+"%)":(pct>0?"+":"")+pct.toFixed(1)+"%";
    const color=pct>0?"#dc2626":pct<0?"#059669":"#6b7280";
    return <span style={{color}}>{str}</span>;
  };

  const MONTH_NAMES=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const labelOf = pid => {
    if (mode==="month") {
      const m=pid.match(/^(\d{4})-(\d{2})$/);
      if(!m) return pid;
      return MONTH_NAMES[parseInt(m[2],10)-1]+"-"+String(parseInt(m[1],10)).slice(2);
    }
    const m=pid.match(/^(\d{4})-Q(\d)$/);
    if(!m) return pid;
    return ["Mar","Jun","Sep","Dec"][parseInt(m[2],10)-1]+"-"+String(parseInt(m[1],10)).slice(2);
  };
  const partialBadge = mode==="month" ? "MTD" : "QTD";

  // Field-name keys read off the per-model entry: input/output for prices,
  // qoq*/mom* for primary growth, yoy* for year-over-year (monthly variant
  // pulls inputMonthly etc.).
  const priceKey   = mode==="month"
    ? (metric==="input" ? "inputMonthly" : "outputMonthly")
    : (metric==="input" ? "input"        : "output");
  const growthKey  = mode==="month"
    ? (metric==="input" ? "momInput"     : "momOutput")
    : (metric==="input" ? "qoqInput"     : "qoqOutput");
  const yoyKey     = mode==="month"
    ? (metric==="input" ? "yoyInputMonthly" : "yoyOutputMonthly")
    : (metric==="input" ? "yoyInput"        : "yoyOutput");

  // Display name — turn 'gemini-3-pro-preview' into 'Gemini 3 Pro Preview'
  const displayName = raw => raw
    .split(/[-_]/)
    .filter(Boolean)
    .map(w => w.length<=2 && /^\d/.test(w) ? w : w[0].toUpperCase()+w.slice(1))
    .join(" ");

  const STICKY_BG="#f3f4f6";
  const STICKY_SHADOW="2px 0 0 #e5e7eb, 6px 0 6px -4px rgba(17,24,39,0.08)";
  const FIRST_COL_W=300;
  const COL_W=98;
  const stickyFirstBase={position:"sticky",left:0,background:STICKY_BG,boxShadow:STICKY_SHADOW,minWidth:FIRST_COL_W,maxWidth:FIRST_COL_W,width:FIRST_COL_W};
  const thMain={textAlign:"right",padding:"5px 10px",fontSize:10,color:"#6b7280",fontWeight:600,whiteSpace:"nowrap",minWidth:COL_W};
  const thFirst={...stickyFirstBase,textAlign:"left",padding:"5px 10px",fontSize:10,color:"#6b7280",fontWeight:600,whiteSpace:"nowrap",zIndex:3};
  const tdMain={textAlign:"right",padding:"4px 10px",fontSize:12,color:"#111827",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",whiteSpace:"nowrap",minWidth:COL_W};
  const tdFirst={...stickyFirstBase,textAlign:"left",padding:"6px 10px 6px 18px",fontSize:11,whiteSpace:"nowrap",zIndex:2};
  const tierHeaderTd={...stickyFirstBase,textAlign:"left",padding:"7px 10px 5px 12px",fontSize:10,color:"#0e7490",fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",zIndex:2,background:"#e0f2fe"};
  const tierHeaderMain={textAlign:"right",padding:"7px 10px 5px 10px",fontSize:10,color:"#0e7490",fontWeight:600,whiteSpace:"nowrap",background:"#e0f2fe",minWidth:COL_W};

  // Compose final body rows: a tier-header row followed by per-model rows
  // (price + growth) within each non-empty tier. Models within a tier are
  // already lastDate-desc on the server.
  const bodyRows = [];
  for (const t of TIERS) {
    const list = grouped.get(t.id) || [];
    if (!list.length) continue;
    bodyRows.push({type:"tierHeader", id:t.id, label:t.label, count:list.length});
    for (const m of list) {
      bodyRows.push({type:"price",    model:m, label:displayName(m.model), sub:m.model});
      bodyRows.push({type:"growth",   model:m, label:" — "+(mode==="month"?"MoM":"QoQ")+" change", sub:m.model});
    }
  }

  const totalCols = FIRST_COL_W + COL_W * periods.length;

  return(
    <div style={{marginBottom:16}}>
      {header}
      <div style={{border:"0.5px solid #e5e7eb",borderRadius:8,overflow:"hidden",background:"#f9fafb"}}>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0,background:"#f3f4f6",minWidth:totalCols}}>
            <thead>
              <tr>
                <th style={thFirst}>{metric==="input"?"Input price / 1M tokens":"Output price / 1M tokens"}</th>
                {periods.map(p=>(
                  <th key={p.id} style={thMain}>
                    {labelOf(p.id)}
                    {p.partial&&<span style={{marginLeft:3,fontSize:8,color:"#b45309",fontWeight:500}}>{partialBadge}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((r,i)=>{
                if (r.type==="tierHeader") {
                  return(
                    <tr key={i}>
                      <td style={tierHeaderTd}>{r.label} <span style={{color:"#0891b2",fontWeight:500}}>· {r.count}</span></td>
                      {periods.map(p=>(<td key={p.id} style={tierHeaderMain}>{labelOf(p.id)}</td>))}
                    </tr>
                  );
                }
                if (r.type==="price") {
                  return(
                    <tr key={i}>
                      <td style={tdFirst} title={"First seen "+r.model.firstDate+" · last "+r.model.lastDate+" · "+r.model.obsCount+" obs"}>
                        <div style={{lineHeight:1.25}}>
                          <div style={{fontWeight:600,color:"#111827"}}>{r.label}</div>
                          <div style={{fontSize:10,color:"#9ca3af",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace"}}>{r.sub}</div>
                        </div>
                      </td>
                      {periods.map(p=>(<td key={p.id} style={tdMain}>{fmtPrice(r.model[priceKey]?.[p.id])}</td>))}
                    </tr>
                  );
                }
                if (r.type==="growth") {
                  const tdDim ={textAlign:"right",padding:"4px 10px",fontSize:12,color:"#6b7280",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",whiteSpace:"nowrap",minWidth:COL_W};
                  return(
                    <tr key={i}>
                      <td style={{...tdFirst,padding:"4px 10px 6px 30px",color:"#6b7280",fontSize:10}}>{r.label}</td>
                      {periods.map(p=>(<td key={p.id} style={tdDim}>{fmtChange(r.model[growthKey]?.[p.id])}</td>))}
                    </tr>
                  );
                }
                return null;
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{fontSize:10,color:"#9ca3af",lineHeight:1.5,marginTop:6}}>
        {models.length} Google/Gemini models from pricepertoken historical rows. Models sorted by most-recent observation per tier. Specialty includes image, audio, TTS, embedding, computer-use modes.
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
   TAB: Amazon (design-preview only — no live data yet)
   First section answers a single customer question:
     "Is there a way to track AWS usage trends?"
   No backend, no fetches, no charts. Empty-state copy
   only. Inner tab bar reuses the same pill styling as
   Model Pricing / GPU Hardware Pricing subtabs.
═══════════════════════════════════════════════════════ */
function AmazonTab(){
  // Inner views inside the Amazon > AWS area. "capacity" = the existing
  // capacity-footprint module; "pricing" = the new live AWS EC2 pricing
  // reverse-proxy embed.
  const[awsSubtab,setAwsSubtab]=useState("capacity");
  return(
    <>
      {/* Hero */}
      <div style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:12,padding:"18px 20px",marginBottom:14,display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}>
        <div style={{minWidth:0,flex:"1 1 320px"}}>
          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:6}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:"#92400e",display:"inline-block"}}/>
            <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:".09em",fontWeight:700,color:"#92400e"}}>Amazon</span>
          </div>
          <div style={{fontSize:22,fontWeight:700,color:"#111827",lineHeight:1.2}}>Amazon</div>
          <div style={{fontSize:12,color:"#6b7280",marginTop:5,lineHeight:1.45,maxWidth:640}}>
            AWS usage, pricing, and capacity signals — built from public market proxies.
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:"#9ca3af",display:"inline-block"}}/>
          <span style={{fontSize:10,padding:"3px 9px",borderRadius:999,fontWeight:600,background:"#f3f4f6",color:"#4b5563",border:"0.5px solid #e5e7eb"}}>Design preview · no live data yet</span>
        </div>
      </div>

      {/* Inner tab bar — Capacity Footprint and the new Pricing Trends pill,
         using the same underline-pill pattern as Model Pricing / GPU
         Hardware Pricing subtabs. */}
      <div style={{display:"flex",gap:4,marginBottom:14,borderBottom:"0.5px solid #e5e7eb"}}>
        {[
          {id:"capacity",label:"Capacity Footprint",sub:"public IPv4 capacity · daily snapshots"},
          {id:"pricing", label:"Pricing Trends",    sub:"live AWS EC2 on-demand pricing"},
        ].map(t=>{
          const active=awsSubtab===t.id;
          return(
            <button key={t.id} onClick={()=>setAwsSubtab(t.id)}
              style={{fontSize:12,padding:"8px 16px",border:"none",borderBottom:active?"2px solid #111827":"2px solid transparent",marginBottom:-1,background:"transparent",color:active?"#111827":"#6b7280",cursor:"pointer",fontFamily:"inherit",fontWeight:active?600:500,display:"flex",flexDirection:"column",alignItems:"flex-start",gap:1}}>
              <span>{t.label}</span>
              <span style={{fontSize:9,fontWeight:400,color:active?"#6b7280":"#9ca3af",textTransform:"lowercase"}}>{t.sub}</span>
            </button>
          );
        })}
      </div>

      {awsSubtab==="capacity"&&<AwsCapacityProxySection/>}
      {awsSubtab==="pricing"&&<AwsPricingTrendsSection/>}
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   AWS Public Network Capacity Proxy
   First real AWS usage-trend data module.
   Source: https://ip-ranges.amazonaws.com/ip-ranges.json
   Computes IPv4 address capacity from CIDR prefix lengths and
   surfaces the "absolute" public network footprint as a CAPACITY
   proxy — not a direct AWS-usage measurement. Wording rules
   enforced by the spec: never call this AWS usage / traffic /
   demand / revenue. It is "AWS Public Network Capacity Proxy",
   "public IP footprint", "capacity-footprint signal".
═══════════════════════════════════════════════════════ */
function AwsCapacityProxySection(){
  const[state,setState]=useState({phase:"loading",snap:null,servedFrom:null,error:null});
  // /summary powers the trend-driven KPI row + the slim feed-status strip.
  // Independent of /latest so a summary outage cannot blank Current
  // Breakdown (which still reads from /latest's by_service / by_region).
  const[summary,setSummary]=useState({phase:"loading",data:null,error:null});
  const[ts,setTs]=useState({phase:"loading",data:null,error:null});

  useEffect(()=>{
    let cancelled=false;
    fetch("/api/aws/ip-ranges/latest?v="+Math.floor(Date.now()/3e5))
      .then(r=>r.ok?r.json():Promise.reject(new Error("HTTP "+r.status)))
      .then(d=>{
        if(cancelled)return;
        if(!d||d.success===false||!d.snapshot){
          setState({phase:"error",snap:null,servedFrom:null,error:d?.error||"Empty response"});
          return;
        }
        setState({phase:"ready",snap:d.snapshot,servedFrom:d.served_from||null,error:null});
      })
      .catch(e=>{if(!cancelled)setState({phase:"error",snap:null,servedFrom:null,error:e.message||"Fetch failed"});});
    return()=>{cancelled=true;};
  },[]);

  useEffect(()=>{
    let cancelled=false;
    fetch("/api/aws/ip-ranges/summary?v="+Math.floor(Date.now()/3e5))
      .then(r=>r.ok?r.json():Promise.reject(new Error("HTTP "+r.status)))
      .then(d=>{
        if(cancelled)return;
        if(!d||d.success===false){setSummary({phase:"error",data:null,error:d?.error||"Empty response"});return;}
        setSummary({phase:"ready",data:d,error:null});
      })
      .catch(e=>{if(!cancelled)setSummary({phase:"error",data:null,error:e.message||"Fetch failed"});});
    return()=>{cancelled=true;};
  },[]);

  useEffect(()=>{
    let cancelled=false;
    const v=Math.floor(Date.now()/3e5);
    // demo=1 lets the chart render before real history accumulates by
    // synthesizing one prior point at -1.5% from the real latest. The
    // server treats demo as a no-op once 2+ real snapshots exist, so this
    // self-retires automatically — no UI change needed when real data
    // takes over.
    fetch("/api/aws/ip-ranges/timeseries?dimension=service&metric=ipv4_addresses&grain=daily&limit=8&demo=1&v="+v)
      .then(r=>r.ok?r.json():Promise.reject(new Error("HTTP "+r.status)))
      .then(d=>{
        if(cancelled)return;
        if(!d||d.success===false){setTs({phase:"error",data:null,error:d?.error||"Empty response"});return;}
        setTs({phase:"ready",data:d,error:null});
      })
      .catch(e=>{if(!cancelled)setTs({phase:"error",data:null,error:e.message||"Fetch failed"});});
    return()=>{cancelled=true;};
  },[]);

  // Comma form for absolute precision (investor-grade), compact form for
  // the secondary hint and chart Y-axis ticks.
  const fmtN=n=>(typeof n==="number"&&isFinite(n))?n.toLocaleString("en-US"):"—";
  const fmtCompact=n=>{
    if(typeof n!=="number"||!isFinite(n))return "—";
    if(n>=1e9)return (n/1e9).toFixed(2).replace(/\.?0+$/,"")+"B";
    if(n>=1e6)return (n/1e6).toFixed(2).replace(/\.?0+$/,"")+"M";
    if(n>=1e3)return (n/1e3).toFixed(1).replace(/\.0$/,"")+"K";
    return String(n);
  };

  const header=(
    <div style={{marginBottom:12}}>
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
        <span style={{width:7,height:7,borderRadius:"50%",background:"#0e7490",display:"inline-block"}}/>
        <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:".09em",fontWeight:700,color:"#0e7490"}}>AWS · capacity-footprint signal</span>
      </div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
        <div style={{minWidth:0,flex:"1 1 320px"}}>
          <div style={{fontSize:18,fontWeight:700,color:"#111827",lineHeight:1.3}}>AWS Public Network Capacity Proxy</div>
          <div style={{fontSize:12,color:"#6b7280",marginTop:4,lineHeight:1.5,maxWidth:760}}>
            Absolute IPv4 address capacity computed from AWS-published public IP ranges.
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:"#10b981",display:"inline-block"}}/>
          <span style={{fontSize:10,padding:"3px 9px",borderRadius:999,fontWeight:600,background:"#ecfdf5",color:"#065f46",border:"0.5px solid #a7f3d0",whiteSpace:"nowrap"}}>Live source · AWS ip-ranges.json</span>
        </div>
      </div>
    </div>
  );

  const sectionWrap=(inner)=>(
    <div style={{marginTop:18}}>
      {header}
      {inner}
    </div>
  );

  if(state.phase==="loading"){
    return sectionWrap(
      <div style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:12,padding:"18px 20px"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,fontSize:12,color:"#6b7280"}}>
          <Spin size={11} color="#0e7490"/> Loading AWS public network capacity…
        </div>
        <Shimmer rows={5}/>
      </div>
    );
  }

  if(state.phase==="error"){
    return sectionWrap(
      <div style={{background:"#fff",border:"0.5px dashed #fca5a5",borderRadius:10,padding:"14px 16px"}}>
        <div style={{fontSize:12,color:"#991b1b",fontWeight:600}}>AWS IP range data unavailable</div>
        <div style={{fontSize:11,color:"#6b7280",marginTop:3}}>{state.error||"/api/aws/ip-ranges/latest did not return a snapshot"}</div>
      </div>
    );
  }

  const s=state.snap;

  return sectionWrap(
    <>
      {/* Trend-driven hero KPI row */}
      <CapacityKpiRow latest={s} summary={summary} fmtN={fmtN} fmtCompact={fmtCompact}/>

      {/* Service-Level Public IPv4 Capacity Trend — main analytical module */}
      <ServiceCapacityTrend ts={ts} fmtN={fmtN} fmtCompact={fmtCompact}/>

      {/* Current Breakdown — OpenRouter-style period matrix */}
      <CurrentBreakdown/>

      {/* Single methodology card with two collapsed disclosures. Native
         <details> keeps the bundle small, the default-collapsed state
         keeps the section short, and the chevron rotation makes the
         affordance obvious without icons. */}
      <CapacityMethodologyCard/>
    </>
  );
}

/* No CapacityTable — Current Breakdown was upgraded to the matrix
   table below. The latest snapshot's static counts now live in the
   slim Data Feed Status strip; period-by-period IPv4 capacity lives
   in the matrix component. */

/* AWS Pricing Trends — live reverse-proxy embed of
   aws.amazon.com/ec2/pricing/on-demand/. Wrapper card with section
   label / title / subtitle / iframe / source note, plus a clean
   fallback if the iframe errors out. */
function AwsPricingTrendsSection(){
  const[err,setErr]=useState(false);
  // Cache-bust the iframe src once per page load so reloads pick up
  // upstream changes without forcing the proxy to be uncached.
  const[bust]=useState(()=>Math.floor(Date.now()/1000));
  const proxyUrl="/api/proxy/aws/ec2-on-demand-pricing/?v="+bust;

  return(
    <div style={{marginTop:18}}>
      {/* Header — same visual rhythm as the Capacity Footprint header. */}
      <div style={{marginBottom:12}}>
        <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
          <span style={{width:7,height:7,borderRadius:"50%",background:"#0e7490",display:"inline-block"}}/>
          <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:".09em",fontWeight:700,color:"#0e7490"}}>AWS · pricing signal</span>
        </div>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <div style={{minWidth:0,flex:"1 1 320px"}}>
            <div style={{fontSize:18,fontWeight:700,color:"#111827",lineHeight:1.3}}>AWS EC2 On-Demand Pricing</div>
            <div style={{fontSize:12,color:"#6b7280",marginTop:4,lineHeight:1.5,maxWidth:760}}>
              Live AWS EC2 on-demand instance and data-transfer pricing for US East (N. Virginia).
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
            <span style={{width:6,height:6,borderRadius:"50%",background:"#10b981",display:"inline-block"}}/>
            <span style={{fontSize:10,padding:"3px 9px",borderRadius:999,fontWeight:600,background:"#ecfdf5",color:"#065f46",border:"0.5px solid #a7f3d0",whiteSpace:"nowrap"}}>Live source · aws.amazon.com</span>
          </div>
        </div>
      </div>

      {/* Embed card or fallback. The iframe sandboxes are deliberately
         permissive (allow-scripts + allow-same-origin) because the proxied
         AWS page needs JS to render the data-transfer tables interactively
         (sortable headers, region filter dropdowns) and to load its own
         absolute-URL assets from awsstatic.com. */}
      {err?(
        <div style={{background:"#fff",border:"0.5px dashed #fca5a5",borderRadius:10,padding:"14px 16px"}}>
          <div style={{fontSize:12,color:"#991b1b",fontWeight:600}}>AWS EC2 pricing live embed temporarily unavailable.</div>
          <div style={{fontSize:11,color:"#6b7280",marginTop:3}}>
            You can open the source page directly:{" "}
            <a href="https://aws.amazon.com/ec2/pricing/on-demand/" target="_blank" rel="noopener" style={{color:"#0e7490"}}>aws.amazon.com/ec2/pricing/on-demand</a>.
          </div>
          <button onClick={()=>setErr(false)}
            style={{marginTop:10,fontSize:11,padding:"5px 14px",border:"0.5px solid #d1d5db",borderRadius:6,background:"#fff",color:"#374151",cursor:"pointer",fontFamily:"inherit"}}>
            Retry
          </button>
        </div>
      ):(
        <div style={{borderRadius:8,overflow:"hidden",border:"0.5px solid #e5e7eb",background:"#fff"}}>
          <iframe
            src={proxyUrl}
            title="AWS EC2 On-Demand Pricing"
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            onError={()=>setErr(true)}
            style={{border:0,display:"block",width:"100%",height:"calc(100vh - 240px)",minHeight:720,background:"#fff"}}
          />
        </div>
      )}

      {/* Source note + the honest caveat about the inner pricing-table
         widget. Spec says don't add custom summaries — this is just the
         provenance line and the one disclosure the user needs to interpret
         a possibly-blank instance pricing region. */}
      <div style={{fontSize:10,color:"#9ca3af",marginTop:6,lineHeight:1.5}}>
        Source: AWS EC2 On-Demand Pricing page. Live embedded reference; pricing is shown as published by AWS.
      </div>
      <div style={{fontSize:10,color:"#9ca3af",marginTop:3,lineHeight:1.5,maxWidth:760}}>
        Note: AWS's instance pricing widget enforces a strict frame-ancestors policy; if the table area appears blank, that section is blocked by AWS and the data-transfer pricing tables below it are still live.
      </div>
    </div>
  );
}

/* Trend-driven KPI hero row. Five cards driven by /api/aws/ip-ranges/summary:
     1. Latest Public IPv4 Capacity   (anchor — always available once
                                       /latest resolves)
     2. QTD Capacity Change           (Pending until ≥2 same-quarter snapshots)
     3. 30D Capacity Change           (or "since first snapshot" fallback when
                                       the captured window is shorter than 30
                                       days; Pending with only 1 snapshot)
     4. Services Expanding            (count / total tracked, same period as 30D)
     5. Regions Expanding             (count / total tracked, same period as 30D)

   No card ever fakes a 0 for a missing change — when data is insufficient
   the value reads "Pending" and the subtitle explains why.

   The row stays visible even when /summary is still loading or has
   errored — the latest-value anchor card always shows, and the change
   cards render Pending so the layout doesn't jump as fetches resolve. */
function CapacityKpiRow({latest,summary,fmtN,fmtCompact}){
  const sumPhase=summary?.phase||"loading";
  const sum=summary?.data||null;

  const fmtSigned=n=>{
    if(typeof n!=="number"||!isFinite(n))return "—";
    const sign=n>0?"+":n<0?"−":"";
    return sign+Math.abs(n).toLocaleString("en-US");
  };
  const fmtPct=p=>{
    if(typeof p!=="number"||!isFinite(p))return "—";
    const sign=p>0?"+":p<0?"−":"";
    return sign+(Math.abs(p)*100).toFixed(2)+"%";
  };
  const changeColor=n=>(typeof n==="number"&&n!==0)?(n>0?"#059669":"#dc2626"):"#6b7280";

  // Card 1 — Latest Public IPv4 Capacity (the scale anchor).
  const latestCap=latest?.total_ipv4_addresses;
  const card1={
    label:"Latest Public IPv4 Capacity",
    value: fmtN(latestCap),
    valueColor:"#111827",
    hint: typeof latestCap==="number"?(fmtCompact(latestCap)+" addresses"):null,
    sub:"Latest AWS-published public IPv4 address pool",
  };

  // Helper: build a Pending or change-block card. periodLabel becomes the
  // suffix on the percentage line (e.g. "+0.27% QTD") and on the subtitle
  // when present.
  function changeCard({label, block, pendingSub, periodSuffix}){
    if(!block||!block.available){
      return {
        label,
        value:"Pending",
        valueColor:"#6b7280",
        hint:null,
        sub:pendingSub,
      };
    }
    const abs=block.absolute_change;
    const pct=block.pct_change;
    return {
      label,
      value: fmtSigned(abs),
      valueColor: changeColor(abs),
      hint: typeof abs==="number" ? (fmtSigned(abs)+" addresses") : null,
      // Override hint with absolute formatted phrase; primary value already shows the signed integer.
      // Use it as a tighter restatement: the primary is the same number — keep this slot for context.
      sub: (typeof pct==="number" ? (fmtPct(pct)+ (periodSuffix?(" "+periodSuffix):"")) : "") +
           (block.baseline_date?(" · baseline "+block.baseline_date):""),
    };
  }

  // Card 2 — QTD.
  const card2 = changeCard({
    label:"QTD Capacity Change",
    block: sum?.qtd,
    pendingSub:"Appears once quarter baseline is available",
    periodSuffix:"QTD",
  });

  // Card 3 — 30D (or since-first fallback).
  const td = sum?.thirty_day;
  const tdLabel = td?.period_label === "30D" ? "30D" : (td?.period_label==="since first snapshot" ? "since first" : "");
  const card3 = changeCard({
    label: td?.period_label==="since first snapshot" ? "Capacity Change · Since First" : "30D Capacity Change",
    block: td,
    pendingSub:"Appears after more daily snapshots",
    periodSuffix: tdLabel,
  });

  // Cards 4 & 5 — breadth counts. Display "k / N" only when available.
  function breadthCard(label, expandingCount, totalTracked, periodLabel){
    if(typeof expandingCount!=="number"||typeof totalTracked!=="number"){
      return {label,value:"Pending",valueColor:"#6b7280",hint:null,sub:"Needs at least 2 daily snapshots"};
    }
    const periodNote = periodLabel==="30D" ? "Period: 30D" : (periodLabel==="since first snapshot" ? "Period: since first snapshot" : "Period: captured window");
    return {
      label,
      value: expandingCount + " / " + totalTracked,
      valueColor: expandingCount>0 ? "#059669" : "#6b7280",
      hint: null,
      sub: periodNote,
    };
  }
  const card4 = breadthCard("Services Expanding", sum?.breadth?.services_expanding, sum?.breadth?.total_services_tracked, sum?.breadth?.period_label);
  const card5 = breadthCard("Regions Expanding",  sum?.breadth?.regions_expanding,  sum?.breadth?.total_regions_tracked,  sum?.breadth?.period_label);

  // Render. Five cards with a consistent layout — same height regardless
  // of Pending vs change vs anchor — so the row reads cleanly.
  const cards=[card1,card2,card3,card4,card5];
  return(
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",gap:10,marginBottom:10}}>
      {cards.map((k,i)=>(
        <div key={i} style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:12,padding:"14px 16px"}}>
          <div style={{...S.lbl,color:"#6b7280"}}>{k.label}</div>
          <div style={{fontSize:20,fontWeight:700,color:k.valueColor,marginTop:4,fontFamily:"monospace",letterSpacing:"-.01em",lineHeight:1.1,wordBreak:"break-all"}}>{k.value}</div>
          {k.hint&&<div style={{fontSize:10,color:"#9ca3af",marginTop:2,fontFamily:"monospace"}}>{k.hint}</div>}
          <div style={{fontSize:10.5,color:"#6b7280",marginTop:6,lineHeight:1.45}}>{k.sub}</div>
        </div>
      ))}
    </div>
  );
}

/* Service-Level Public IPv4 Capacity Trend — main analytical module.
   With ≥2 snapshots, renders a multi-line recharts chart on a log
   Y-axis (AMAZON / EC2 dwarf the rest by orders of magnitude). With
   one snapshot, renders an empty-state card; never a fake chart.
   On time-series fetch failure, shows a small inline warning and
   leaves the rest of the section intact. */
const SERVICE_TREND_PALETTE=["#0e7490","#059669","#2563eb","#7c3aed","#d97706","#dc2626","#0891b2","#6b7280"];

function ServiceCapacityTrend({ts,fmtN,fmtCompact}){
  const isDemo = ts?.data?.demo === true;
  // Series-visibility state. Click a legend entry to toggle that service's
  // line on the chart; the entry keeps its slot in the legend (just dimmed
  // and strike-through) so the layout doesn't reflow as you toggle.
  const[hidden,setHidden]=useState(()=>new Set());
  const toggleSeries=name=>{
    if(!name)return;
    setHidden(prev=>{
      const next=new Set(prev);
      if(next.has(name))next.delete(name);else next.add(name);
      return next;
    });
  };
  const header=(
    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:10}}>
      <div style={{minWidth:0,flex:"1 1 320px"}}>
        <div style={{fontSize:15,fontWeight:700,color:"#111827",lineHeight:1.3}}>Service-Level Public IPv4 Capacity Trend</div>
        <div style={{fontSize:11.5,color:"#6b7280",marginTop:3,lineHeight:1.5,maxWidth:760}}>
          Daily captured AWS public IPv4 capacity by service from AWS ip-ranges.json.
        </div>
      </div>
      <span style={{fontSize:10,padding:"3px 9px",borderRadius:999,fontWeight:600,background:"#ecfeff",color:"#0e7490",border:"0.5px solid #a5f3fc",whiteSpace:"nowrap"}}>Daily snapshots · service footprint</span>
    </div>
  );

  const card=(inner)=>(
    <div style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:12,padding:"14px 16px",marginBottom:14}}>
      {header}
      {inner}
    </div>
  );

  if(ts.phase==="loading"){
    return card(<Shimmer rows={4}/>);
  }

  if(ts.phase==="error"){
    return card(
      <div style={{background:"#fffbeb",border:"0.5px solid #fde68a",borderRadius:8,padding:"10px 14px",fontSize:11.5,color:"#78350f",lineHeight:1.55}}>
        Service-level capacity trend unavailable. Latest snapshot is still shown.
      </div>
    );
  }

  const d=ts.data||{};
  const series=Array.isArray(d.series)?d.series:[];
  const count=d.snapshot_count||0;

  // Empty-state: one snapshot — no fake chart, just the readiness copy.
  if(count<2){
    return card(
      <div style={{padding:"6px 0"}}>
        <div style={{fontSize:13,fontWeight:600,color:"#111827",lineHeight:1.3}}>Trend has started</div>
        <div style={{fontSize:12,color:"#374151",marginTop:6,lineHeight:1.55,maxWidth:680}}>
          One daily snapshot has been captured. The service-level line chart will appear once at least two daily snapshots are available.
        </div>
        <div style={{fontSize:10.5,color:"#9ca3af",marginTop:6}}>
          Current service ranking is shown below in Current Breakdown.
        </div>
      </div>
    );
  }

  // ── Multi-snapshot: pivot series → recharts data, render log-scale chart.
  // Build a date axis from all distinct dates across all series. Each row
  // carries one column per service; missing values are intentionally null
  // so the line breaks rather than reads as a fake zero.
  const dateSet=new Set();
  for(const s of series) for(const p of (s.points||[])) dateSet.add(p.date);
  const dates=Array.from(dateSet).sort();
  const chartData=dates.map(date=>{
    const row={date};
    for(const s of series){
      const pt=(s.points||[]).find(p=>p.date===date);
      row[s.name] = pt && typeof pt.value==="number" ? pt.value : null;
    }
    return row;
  });

  // Tooltip — formatted via recharts' Tooltip formatter prop. Tighter and
  // monospace-aligned so multi-line readings stay readable.
  const tooltipFmt=(value,name)=>{
    if(value==null)return [<span style={{fontFamily:"monospace",color:"#9ca3af"}}>—</span>,name];
    return [<span style={{fontFamily:"monospace"}}>{fmtN(value)}</span>,name];
  };

  return card(
    <>
      <div style={{width:"100%",height:320}}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{top:8,right:16,bottom:0,left:0}}>
            <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3"/>
            <XAxis dataKey="date" tick={{fontSize:10,fill:"#6b7280"}} stroke="#e5e7eb"/>
            <YAxis scale="log" domain={["auto","auto"]} tick={{fontSize:10,fill:"#6b7280"}} tickFormatter={fmtCompact} stroke="#e5e7eb" width={48}/>
            <Tooltip formatter={tooltipFmt} labelStyle={{fontSize:11,fontWeight:600,color:"#111827"}} contentStyle={{fontSize:11,borderRadius:8,border:"0.5px solid #e5e7eb"}}/>
            <Legend
              wrapperStyle={{fontSize:10,paddingTop:6,cursor:"pointer",userSelect:"none"}}
              onClick={(entry)=>toggleSeries(entry?.dataKey||entry?.value)}
              formatter={(value)=>{
                const off=hidden.has(value);
                return(
                  <span style={{
                    cursor:"pointer",
                    color: off ? "#9ca3af" : "#374151",
                    textDecoration: off ? "line-through" : "none",
                    fontWeight: off ? 400 : 500,
                    userSelect:"none",
                  }}>{value}</span>
                );
              }}
            />
            {series.map((s,i)=>(
              <Line key={s.name} type="monotone" dataKey={s.name} stroke={SERVICE_TREND_PALETTE[i%SERVICE_TREND_PALETTE.length]} strokeWidth={1.5} dot={{r:2}} activeDot={{r:4}} connectNulls={false} isAnimationActive={false} hide={hidden.has(s.name)}/>
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

/* Current Breakdown — OpenRouter-style period matrix.
   Two pill toggles: Services/Regions and Quarter/Month. Fetches
   /api/aws/ip-ranges/matrix on toggle change and renders three
   row sections (Public IPv4 Capacity / QoQ-or-MoM Growth / YoY
   Growth) with periods as columns. Mirrors the visual style of
   the existing model-pricing matrix (sticky first column, gray
   section labels with underline, monospace right-aligned cells).
   Missing comparison periods always render "—" — never a fake 0%. */
function CurrentBreakdown(){
  const[dimension,setDimension]=useState("service");
  const[period,setPeriod]=useState("quarter");
  const[state,setState]=useState({phase:"loading",data:null,error:null});

  useEffect(()=>{
    let cancelled=false;
    setState(prev=>({phase:"loading",data:prev.data,error:null}));
    const v=Math.floor(Date.now()/3e5);
    fetch(`/api/aws/ip-ranges/matrix?dimension=${dimension}&period=${period}&metric=ipv4_addresses&limit=8&v=${v}`)
      .then(r=>r.ok?r.json():Promise.reject(new Error("HTTP "+r.status)))
      .then(d=>{
        if(cancelled)return;
        if(!d||d.success===false){setState({phase:"error",data:null,error:d?.error||"Empty response"});return;}
        setState({phase:"ready",data:d,error:null});
      })
      .catch(e=>{if(!cancelled)setState({phase:"error",data:null,error:e.message||"Fetch failed"});});
    return()=>{cancelled=true;};
  },[dimension,period]);

  // Pills row: dimension on the left, period on the right. Same styling
  // pattern as the AWS-subtab pill in the page header.
  const pillBtn=(active,onClick,label)=>(
    <button key={label} onClick={onClick}
      style={{fontSize:11,padding:"5px 12px",border:"0.5px solid "+(active?"#111827":"#e5e7eb"),borderRadius:999,background:active?"#111827":"#fff",color:active?"#fff":"#374151",cursor:"pointer",fontFamily:"inherit",fontWeight:active?600:500}}>
      {label}
    </button>
  );

  const pillsRow=(
    <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
      <div style={{display:"flex",gap:4,alignItems:"center"}}>
        {pillBtn(dimension==="service",()=>setDimension("service"),"Services")}
        {pillBtn(dimension==="region", ()=>setDimension("region"), "Regions")}
      </div>
      <span style={{color:"#d1d5db",fontSize:11}}>·</span>
      <div style={{display:"flex",gap:4,alignItems:"center"}}>
        {pillBtn(period==="quarter",()=>setPeriod("quarter"),"Quarter")}
        {pillBtn(period==="month",  ()=>setPeriod("month"),  "Month")}
        {pillBtn(period==="week",   ()=>setPeriod("week"),   "Week")}
      </div>
    </div>
  );

  const header=(
    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8,flexWrap:"wrap",marginBottom:8}}>
      <div style={{minWidth:0,flex:"1 1 280px"}}>
        <div style={{fontSize:14,fontWeight:700,color:"#111827",lineHeight:1.3}}>Current Breakdown</div>
        <div style={{fontSize:11,color:"#6b7280",marginTop:2,lineHeight:1.45}}>
          Quarterly and monthly AWS public IPv4 capacity by service and region.
        </div>
      </div>
      {pillsRow}
    </div>
  );

  if(state.phase==="loading"&&!state.data){
    return(
      <div style={{marginBottom:0}}>
        {header}
        <div style={{background:"#fff",border:"0.5px solid #e5e7eb",borderRadius:12,padding:"18px 20px"}}>
          <Shimmer rows={5}/>
        </div>
      </div>
    );
  }
  if(state.phase==="error"){
    return(
      <div style={{marginBottom:0}}>
        {header}
        <div style={{background:"#fff",border:"0.5px dashed #fca5a5",borderRadius:10,padding:"14px 16px"}}>
          <div style={{fontSize:12,color:"#991b1b",fontWeight:600}}>Capacity matrix unavailable</div>
          <div style={{fontSize:11,color:"#6b7280",marginTop:3}}>{state.error||"/api/aws/ip-ranges/matrix did not return data"}</div>
        </div>
      </div>
    );
  }

  const data=state.data||{periods:[],items:[]};
  const periods=data.periods||[];
  const items=data.items||[];

  // Single-period young-history note. Spec: render the table anyway, with
  // QoQ/MoM/YoY rows showing "—". Just add a small note above.
  const youngHistory=periods.length<=1;
  const titleSuffix=period==="quarter"?"by quarter":period==="week"?"by week":"by month";
  const tableTitle=dimension==="service"
    ? `Top AWS services by public IPv4 capacity ${titleSuffix}`
    : `Top AWS regions by public IPv4 capacity ${titleSuffix}`;

  // ── Style constants match the existing model-pricing matrix verbatim
  //    so the table reads as part of the same visual family. ──
  const STICKY_BG="#f3f4f6";
  const STICKY_SHADOW="2px 0 0 #e5e7eb, 6px 0 6px -4px rgba(17,24,39,0.08)";
  const FIRST_COL_W=180;
  const COL_W=110;
  const stickyFirstBase={position:"sticky",left:0,background:STICKY_BG,boxShadow:STICKY_SHADOW,minWidth:FIRST_COL_W,maxWidth:FIRST_COL_W,width:FIRST_COL_W};
  const stickySectionBase={position:"sticky",left:0,background:STICKY_BG};
  const thMain={textAlign:"right",padding:"5px 10px",fontSize:10,color:"#6b7280",fontWeight:600,whiteSpace:"nowrap",minWidth:COL_W};
  const thFirst={...stickyFirstBase,textAlign:"left",padding:"5px 10px",fontSize:10,color:"#6b7280",fontWeight:600,whiteSpace:"nowrap",zIndex:3};
  const tdMain={textAlign:"right",padding:"4px 10px",fontSize:12,color:"#111827",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",whiteSpace:"nowrap",minWidth:COL_W};
  const tdMissing={textAlign:"right",padding:"4px 10px",fontSize:12,color:"#d1d5db",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",whiteSpace:"nowrap",minWidth:COL_W};
  const tdFirst={...stickyFirstBase,textAlign:"left",padding:"6px 10px 6px 18px",fontSize:11,whiteSpace:"nowrap",zIndex:2};
  const sectionTh={...stickySectionBase,textAlign:"left",padding:"10px 10px 4px",fontSize:11,color:"#111827",fontWeight:700,textDecoration:"underline",textUnderlineOffset:"3px",zIndex:1};

  // ── Format helpers. Capacity uses compact form (101.76M / 659.39K) so
  //    every period column fits without horizontal compression; growth
  //    uses pct + tiny abs subtext like the existing OR matrix. ──
  const fmtCompactCap=v=>{
    if(typeof v!=="number"||!isFinite(v))return null;
    if(v>=1e9)return (v/1e9).toFixed(2).replace(/\.?0+$/,"")+"B";
    if(v>=1e6)return (v/1e6).toFixed(2).replace(/\.?0+$/,"")+"M";
    if(v>=1e3)return (v/1e3).toFixed(2).replace(/\.?0+$/,"")+"K";
    return String(v);
  };
  const fmtPct=p=>{
    if(typeof p!=="number"||!isFinite(p))return "—";
    const sign=p>0?"+":p<0?"−":"";
    return sign+(Math.abs(p)*100).toFixed(2)+"%";
  };
  const fmtAbsSigned=n=>{
    if(typeof n!=="number"||!isFinite(n)||n===0)return "";
    const sign=n>0?"+":"−";
    const a=Math.abs(n);
    let s;
    if(a>=1e6)s=(a/1e6).toFixed(2).replace(/\.?0+$/,"")+"M";
    else if(a>=1e3)s=(a/1e3).toFixed(1).replace(/\.0$/,"")+"K";
    else s=String(a);
    return sign+s+" addrs";
  };
  const growthColor=(p)=>(typeof p!=="number"||!isFinite(p))?"#d1d5db":(p>0?"#059669":p<0?"#dc2626":"#6b7280");

  // Section row — section-label cell sticky on the left, blank cells fill
  // the rest so the underline reads as part of the heading band.
  const renderSectionRow=label=>(
    <tr key={"sec-"+label}>
      <td style={sectionTh}>{label}</td>
      {periods.map(p=>(<td key={p.key} style={{padding:"10px 10px 4px",background:STICKY_BG,minWidth:COL_W}}/>))}
    </tr>
  );

  // Item label cell.
  const renderItemFirstCol=name=>(
    <td style={tdFirst}>
      <div style={{lineHeight:1.25}}>
        <div style={{fontWeight:600,color:"#111827"}}>{name}</div>
      </div>
    </td>
  );

  // Capacity row — absolute IPv4 capacity per period (compact).
  const renderCapacityRow=(item)=>(
    <tr key={"cap-"+item.name}>
      {renderItemFirstCol(item.name)}
      {periods.map(p=>{
        const v=item.values?.[p.key];
        const display=fmtCompactCap(v);
        return(<td key={p.key} style={display==null?tdMissing:tdMain}>{display==null?"—":display}</td>);
      })}
    </tr>
  );

  // Growth row — pct on top line, signed abs in tiny muted line below.
  const renderGrowthRow=(item, growthKey, absKey)=>(
    <tr key={growthKey+"-"+item.name}>
      {renderItemFirstCol(item.name)}
      {periods.map(p=>{
        const pct=item.growth?.[growthKey]?.[p.key];
        const abs=item.absolute_change?.[absKey]?.[p.key];
        const main=fmtPct(pct);
        const sub=fmtAbsSigned(abs);
        const color=growthColor(pct);
        return(
          <td key={p.key} style={{textAlign:"right",padding:"4px 10px",minWidth:COL_W,whiteSpace:"nowrap"}}>
            <div style={{fontSize:12,color,fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace"}}>{main}</div>
            {sub&&<div style={{fontSize:9.5,color:"#9ca3af",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",marginTop:1}}>{sub}</div>}
          </td>
        );
      })}
    </tr>
  );

  // Period-prior section label — adapts to the selected period mode.
  const periodPriorLabel =
    period==="quarter" ? "QoQ Growth"
    : period==="week"  ? "WoW Growth"
    : "MoM Growth";
  const periodPriorGrowthKey =
    period==="quarter" ? "qoq"
    : period==="week"  ? "wow"
    : "mom";
  const periodPriorAbsKey = periodPriorGrowthKey;

  return(
    <div style={{marginBottom:0}}>
      {header}

      {youngHistory&&(
        <div style={{fontSize:10.5,color:"#9ca3af",lineHeight:1.5,marginBottom:6}}>
          Growth rows will populate automatically as the daily 04:15 UTC capture builds weekly, monthly, and quarterly history.
        </div>
      )}

      <div style={{border:"0.5px solid #e5e7eb",borderRadius:8,overflow:"hidden",background:"#f9fafb"}}>
        {/* Compact title strip mirrors the existing matrix tables. */}
        <div style={{padding:"10px 12px",borderBottom:"1px solid #e5e7eb",background:"#fff"}}>
          <div style={{fontSize:13,fontWeight:600,color:"#111827",lineHeight:1.3}}>{tableTitle}</div>
          <div style={{fontSize:10.5,color:"#9ca3af",marginTop:2}}>
            Latest captured snapshot per period · top 8 by latest IPv4 capacity
          </div>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0,background:STICKY_BG,minWidth:FIRST_COL_W+COL_W*Math.max(periods.length,1)}}>
            <thead>
              <tr>
                <th style={thFirst}></th>
                {periods.map(p=>(
                  <th key={p.key} style={thMain}>{p.label}</th>
                ))}
                {periods.length===0&&<th style={thMain}>—</th>}
              </tr>
            </thead>
            <tbody>
              {renderSectionRow("Public IPv4 Capacity")}
              {items.map(renderCapacityRow)}

              <tr><td colSpan={periods.length+1} style={{height:8,background:"#f9fafb"}}></td></tr>

              {renderSectionRow(periodPriorLabel)}
              {items.map(it=>renderGrowthRow(it, periodPriorGrowthKey, periodPriorAbsKey))}

              <tr><td colSpan={periods.length+1} style={{height:8,background:"#f9fafb"}}></td></tr>

              {renderSectionRow("YoY Growth")}
              {items.map(it=>renderGrowthRow(it,"yoy","yoy"))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* Compact methodology card with two collapsed disclosure rows. Default
   layout is just a label, one-line summary, and two chevron-style
   summary rows — opens to ~150 words each. Native <details> keeps the
   markup small and accessible; CSS-only chevron rotation gives the
   affordance without bringing in an icon library. */
function CapacityMethodologyCard(){
  const summaryStyle={
    fontSize:12,
    fontWeight:600,
    color:"#374151",
    cursor:"pointer",
    listStyle:"none",
    padding:"8px 10px",
    borderRadius:6,
    display:"flex",
    alignItems:"center",
    gap:8,
    userSelect:"none",
  };
  const bodyStyle={fontSize:11.5,color:"#4b5563",lineHeight:1.6,padding:"4px 10px 10px 26px"};
  const liStyle={marginTop:3};
  const code=(s)=><span style={{fontFamily:"monospace",color:"#111827"}}>{s}</span>;

  // Hide the default disclosure triangle and inject a small CSS-only
  // chevron that rotates 90° on [open]. Scoped via a unique class so
  // we don't bleed into other native <details> on the page.
  const chevronCss=`
    .ipr-meth-row > summary{ list-style:none; }
    .ipr-meth-row > summary::-webkit-details-marker{ display:none; }
    .ipr-meth-row > summary::before{
      content:""; display:inline-block; width:6px; height:6px;
      border-right:1.5px solid #6b7280; border-bottom:1.5px solid #6b7280;
      transform:rotate(-45deg); transition:transform .15s ease;
      margin-right:2px;
    }
    .ipr-meth-row[open] > summary::before{ transform:rotate(45deg); }
    .ipr-meth-row > summary:hover{ background:#f3f4f6; }
  `;

  return(
    <div style={{background:"#f9fafb",border:"0.5px dashed #d1d5db",borderRadius:8,padding:"12px 14px",marginTop:14}}>
      <style>{chevronCss}</style>
      <div style={{...S.lbl,color:"#6b7280",marginBottom:6}}>Methodology</div>
      <div style={{fontSize:11.5,color:"#4b5563",lineHeight:1.55,marginBottom:8}}>
        AWS publishes current public IP ranges in {code("ip-ranges.json")}. We compute IPv4 address capacity from CIDR ranges and save daily snapshots to build history. Hero cards show latest public IPv4 capacity plus period changes from captured daily snapshots; change metrics remain pending until enough history exists. Quarterly and monthly breakdowns use the latest captured snapshot in each period; growth rows compare against the prior period or same period last year when available.
      </div>

      <details className="ipr-meth-row" style={{borderTop:"0.5px solid #e5e7eb"}}>
        <summary style={summaryStyle}>How to read the service trend chart</summary>
        <div style={bodyStyle}>
          Each line represents one AWS service from the public AWS IP-range file.
          <ul style={{margin:"6px 0 0 18px",padding:0}}>
            <li style={liStyle}>{code("AMAZON")}: broad AWS-owned public IP ranges that are not always tied to one specific product.</li>
            <li style={liStyle}>{code("EC2")}: public IPv4 capacity associated with Elastic Compute Cloud.</li>
            <li style={liStyle}>{code("CLOUDFRONT")}: public IPv4 capacity associated with AWS CloudFront edge delivery.</li>
            <li style={liStyle}>{code("S3")}: public IPv4 capacity associated with Amazon S3.</li>
            <li style={liStyle}>{code("GLOBALACCELERATOR")}: public IPv4 capacity associated with AWS Global Accelerator.</li>
            <li style={liStyle}>{code("CLOUDFRONT_ORIGIN_FACING")}: CloudFront ranges used for origin-facing connections.</li>
            <li style={liStyle}>{code("API_GATEWAY")}: public IPv4 capacity associated with API Gateway.</li>
            <li style={liStyle}>{code("IVS_REALTIME")}: public IPv4 capacity associated with Interactive Video Service real-time infrastructure.</li>
          </ul>
          <div style={{marginTop:8}}>Axes:</div>
          <ul style={{margin:"4px 0 0 18px",padding:0}}>
            <li style={liStyle}>X-axis: capture date.</li>
            <li style={liStyle}>Y-axis: public IPv4 address capacity.</li>
            <li style={liStyle}>Each point: the calculated IPv4 address count for that service on that captured date.</li>
            <li style={liStyle}>Flat line: no change in that service's published public IPv4 capacity during the captured period.</li>
            <li style={liStyle}>Upward line: AWS added public IPv4 capacity for that service.</li>
            <li style={liStyle}>Downward line: AWS removed or reclassified public IPv4 capacity for that service.</li>
          </ul>
          <div style={{marginTop:8,color:"#6b7280"}}>
            The chart uses a log scale because {code("AMAZON")} and {code("EC2")} are much larger than smaller services. Log scale makes smaller services visible instead of flattening them near zero.
          </div>
        </div>
      </details>

      <details className="ipr-meth-row" style={{borderTop:"0.5px solid #e5e7eb"}}>
        <summary style={summaryStyle}>What this signal means</summary>
        <div style={bodyStyle}>
          This is a public network capacity signal, not exact AWS usage.
          <div style={{marginTop:6}}>It can help answer:</div>
          <ul style={{margin:"4px 0 0 18px",padding:0}}>
            <li style={liStyle}>Is AWS's published public network footprint expanding?</li>
            <li style={liStyle}>Which services have the largest public IPv4 footprint?</li>
            <li style={liStyle}>Which services or regions are seeing capacity additions over time?</li>
          </ul>
          <div style={{marginTop:8}}>It cannot directly answer:</div>
          <ul style={{margin:"4px 0 0 18px",padding:0}}>
            <li style={liStyle}>Actual AWS customer usage.</li>
            <li style={liStyle}>Compute hours consumed.</li>
            <li style={liStyle}>Revenue.</li>
            <li style={liStyle}>Private/internal AWS capacity.</li>
            <li style={liStyle}>Customer workload growth.</li>
          </ul>
          <div style={{marginTop:8,color:"#374151",fontWeight:500}}>
            Best interpretation: this is an infrastructure-footprint proxy. It becomes more useful when combined with AWS pricing, spot-market, and financial data.
          </div>
        </div>
      </details>
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
    {id:"amazon",  label:"Amazon"},
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
          <>
            {/* First section — Google / Gemini cut of the OpenRouter chart-native
               token-demand data. Reuses the same data and period builder as
               the AI Adoption table; just renders the Google bucket. */}
            <GoogleGeminiAdoptionTable/>
            {/* Second section — Google / Gemini slice of the Model Pricing
               peer matrix. Reuses /api/model-pricing-peer-matrix; just
               renders the google-frontier and google-fast reps. */}
            <GoogleGeminiPricingTable/>
          </>
        )}
        {tab==="amazon"&&<AmazonTab/>}
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
