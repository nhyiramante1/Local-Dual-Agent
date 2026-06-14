export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Duet</title>
  <link rel="stylesheet" href="/dashboard.css">
</head>
<body>
  <header>
    <div class="brand"><span class="dot"></span><h1>Duet</h1><span class="sub">local orchestrator</span></div>
    <span id="health" class="pill">connecting…</span>
  </header>
  <main>
    <aside><h2>Runs</h2><div id="runs"></div></aside>
    <section>
      <div id="summary"><h2>Local orchestrator</h2><p class="muted">Select a run.</p></div>
      <h2>Tasks</h2><div id="tasks"></div>
      <h2>Timeline</h2><div id="events"></div>
      <h2>Verification</h2><div id="verification"></div>
      <h2>Messages</h2><div id="messages"></div>
      <h2>Artifacts</h2><div id="artifacts"></div>
      <h2>Conflicts</h2><div id="conflicts"></div>
      <h2>Diff</h2><pre id="diff"></pre>
    </section>
  </main>
  <script type="module" src="/dashboard.js"></script>
</body>
</html>`;

export const dashboardCss = `
:root{
  --bg:#0b0d10;--surface:#13171d;--surface-2:#171c23;--line:#262d38;--line-2:#313a47;
  --text:#e7ecf2;--muted:#9aa6b6;--faint:#6b7686;
  --accent:#5b8cff;--ok:#5fd38a;--warn:#f0b657;--bad:#ff7b72;
  color-scheme:dark;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
h1{font-size:18px;font-weight:600;margin:0;letter-spacing:.2px}
h2{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.8px;color:var(--faint);margin:0 0 10px}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 22px;border-bottom:1px solid var(--line);background:var(--surface)}
.brand{display:flex;align-items:center;gap:10px}
.dot{width:9px;height:9px;border-radius:50%;background:var(--accent)}
.sub{color:var(--faint);font-size:12px}
main{display:grid;grid-template-columns:300px 1fr;min-height:calc(100vh - 56px)}
aside{padding:18px;border-right:1px solid var(--line);background:var(--surface)}
section{padding:22px 26px;overflow:auto}
section>h2{margin-top:24px}section>h2:first-child{margin-top:0}
#summary{margin-bottom:4px}
#summary h2{font-size:16px;text-transform:none;letter-spacing:0;color:var(--text);margin-bottom:10px}
.pill{font-size:12px;font-weight:500;padding:4px 11px;border-radius:999px;border:1px solid var(--line-2);color:var(--muted)}
.pill.ok{color:var(--ok);border-color:#2f5f43;background:#13251b}
.pill.bad{color:var(--bad);border-color:#5f3232;background:#251515}
button{display:block;width:100%;text-align:left;border:1px solid var(--line);background:var(--surface-2);color:inherit;padding:10px 12px;margin:0 0 8px;border-radius:9px;cursor:pointer;transition:background .12s,border-color .12s}
button:hover{background:#1d242d;border-color:var(--line-2)}
button.sel{border-color:var(--accent);background:#172033}
button b{font-weight:600}
.card{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:0 0 8px;background:var(--surface)}
.muted{color:var(--muted)}.ok{color:var(--ok)}.bad{color:var(--bad)}
.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kv{color:var(--muted);font-size:13px}.kv b{color:var(--text);font-weight:500}
.badge{display:inline-block;font-size:11px;font-weight:600;letter-spacing:.3px;padding:2px 8px;border-radius:6px;border:1px solid var(--line-2);color:var(--muted)}
.badge.s-running{color:#9cc2ff;border-color:#2c4a78;background:#142031}
.badge.s-approved{color:#7fd6a6;border-color:#2f5f43;background:#13251b}
.badge.s-awaiting{color:#f0c879;border-color:#5f4d28;background:#241d11}
.badge.s-merged{color:#a99cff;border-color:#41397a;background:#171430}
.badge.s-ok{color:#7fd6a6;border-color:#2f5f43;background:#13251b}
.badge.s-failed{color:#ff9a93;border-color:#5f3232;background:#251515}
.badge.s-cancelled{color:#9aa6b6;border-color:#3a4350;background:#181d24}
.badge.s-conflict{color:#ffb37a;border-color:#5f4328;background:#241a11}
.ev{display:flex;gap:10px;align-items:baseline;padding:7px 11px;margin:0 0 5px;border-left:2px solid var(--line-2);border-radius:0 6px 6px 0;background:var(--surface)}
.ev time{color:var(--faint);font:12px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}
.ev .ty{font-weight:500}
.ev-info{border-left-color:#3a4d6b}
.ev-warning{border-left-color:var(--warn);background:#1f1a12}
.ev-error{border-left-color:var(--bad);background:#1f1414}
.vr{display:flex;align-items:center;gap:9px;padding:9px 12px;margin:0 0 6px;border:1px solid var(--line);border-radius:9px;background:var(--surface)}
.vr .tag{font-size:11px;font-weight:700;padding:2px 7px;border-radius:5px}
.vr.pass .tag{color:#0b1f13;background:var(--ok)}
.vr.fail .tag{color:#23100e;background:var(--bad)}
pre{white-space:pre-wrap;background:#0e1217;border:1px solid var(--line);padding:14px;border-radius:10px;max-height:440px;overflow:auto;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.empty{color:var(--faint);font-size:13px;font-style:italic}
@media(max-width:760px){main{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid var(--line)}}
`;

export const dashboardJs = `
const q = (id) => document.getElementById(id);
let selected = new URL(location.href).searchParams.get("run");
async function api(path) {
  const response = await fetch("/api/v1" + path, {credentials:"same-origin"});
  if (!response.ok) throw new Error((await response.json()).error?.message || response.statusText);
  return (await response.json()).data;
}
function esc(value){const d=document.createElement("div");d.textContent=String(value??"");return d.innerHTML.replaceAll('"',"&quot;").replaceAll("'","&#39;")}
function statusClass(value){const s=String(value??"").toLowerCase();
  if(s.includes("conflict")||s.includes("blocked")||s.includes("attention"))return"s-conflict";
  if(s.includes("fail"))return"s-failed";
  if(s.includes("cancel"))return"s-cancelled";
  if(s.includes("await")||s.includes("paused")||s==="pending")return"s-awaiting";
  if(s==="merged")return"s-merged";
  if(s.includes("approved"))return"s-approved";
  if(s.includes("running")||s.includes("implementing")||s.includes("reviewing")||s.includes("revising")||s.includes("verifying")||s.includes("leased")||s.includes("planning"))return"s-running";
  if(s==="completed"||s==="integrated"||s==="ready"||s==="passed")return"s-ok";
  return"";
}
function badge(value){return \`<span class="badge \${statusClass(value)}">\${esc(value)}</span>\`}
async function authenticate() {
  const ticket = location.hash.slice(1);
  if (!ticket) return;
  await fetch("/dashboard/session", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ticket})});
  history.replaceState(null,"",location.pathname+location.search);
}
async function loadRuns() {
  const runs=await api("/runs");
  q("runs").innerHTML=runs.map(r=>\`<button data-id="\${esc(r.id)}" class="\${r.id===selected?"sel":""}"><b>\${esc(r.goal)}</b><br><span class="muted">\${esc(r.id)}</span> \${badge(r.status)}</button>\`).join("")||'<span class="empty">No runs yet.</span>';
  q("runs").querySelectorAll("button").forEach(b=>b.onclick=()=>selectRun(b.dataset.id));
  if(selected) await selectRun(selected);
}
async function selectRun(id) {
  selected=id;
  q("runs").querySelectorAll("button").forEach(b=>b.classList.toggle("sel",b.dataset.id===id));
  const detail=await api("/runs/"+encodeURIComponent(id));
  q("summary").innerHTML=\`<h2>\${esc(detail.run.goal)}</h2><div class="card"><div class="row">\${badge(detail.run.status)}<span class="kv">lead <b>\${esc(detail.run.leadProvider)}</b></span><span class="kv">\${detail.usage.totalTurns} turns</span></div></div>\`;
  q("tasks").innerHTML=detail.tasks.map(t=>\`<div class="card"><div class="row"><b>\${esc(t.plan.title)}</b>\${badge(t.status)}</div><div class="kv">\${esc(t.provider)} → \${esc(t.reviewerProvider)}</div><div class="muted">\${esc(t.plan.allowedPaths.join(", "))}</div></div>\`).join("")||'<span class="empty">No tasks.</span>';
  const [verification,messages,artifacts,conflicts]=await Promise.all([
    api("/runs/"+encodeURIComponent(id)+"/verification"),
    api("/runs/"+encodeURIComponent(id)+"/messages"),
    api("/runs/"+encodeURIComponent(id)+"/artifacts"),
    api("/runs/"+encodeURIComponent(id)+"/conflicts")
  ]);
  q("verification").innerHTML=verification.map(v=>\`<div class="vr \${v.passed?"pass":"fail"}"><span class="tag">\${v.passed?"PASS":"FAIL"}</span><span>\${esc(v.command.join(" "))}</span><span class="muted">\${v.durationMs}ms</span></div>\`).join("")||'<span class="empty">No verification results.</span>';
  q("messages").innerHTML=messages.map(m=>\`<div class="card"><b>\${esc(m.kind)}</b><div class="muted">\${esc(m.body).slice(0,1000)}</div></div>\`).join("")||'<span class="empty">No messages.</span>';
  q("artifacts").innerHTML=artifacts.map(a=>\`<div class="card"><span class="muted">#\${a.id}</span> \${esc(a.kind)} <span class="muted">· \${esc(a.taskId||"run")}</span></div>\`).join("")||'<span class="empty">No artifacts.</span>';
  q("conflicts").innerHTML=conflicts.map(t=>\`<div class="card"><div class="row"><b>\${esc(t.id)}</b><span class="badge s-conflict">conflict</span></div><div class="bad">\${esc(t.error||"integration conflict")}</div></div>\`).join("")||'<span class="empty">No conflicts.</span>';
  q("diff").textContent=(await api("/runs/"+encodeURIComponent(id)+"/diff")).diff||"";
}
async function connectEvents() {
  const url="/api/v1/events"+(selected?"?runId="+encodeURIComponent(selected):"");
  const stream=new EventSource(url);
  stream.addEventListener("duet.event",e=>{
    const item=JSON.parse(e.data);
    const sev=item.severity==="error"?"ev-error":item.severity==="warning"?"ev-warning":"ev-info";
    const line=document.createElement("div");
    line.className="ev "+sev;
    const parsed=new Date(item.occurredAt);
    const ts=isNaN(parsed.getTime())?item.occurredAt:parsed.toLocaleTimeString();
    line.innerHTML=\`<time>\${esc(ts)}</time><span class="ty">\${esc(item.type)}</span>\`;
    q("events").prepend(line);
    if(item.type==="run.updated"||item.type==="task.updated") loadRuns().catch(()=>{});
  });
  stream.addEventListener("duet.reset",()=>location.reload());
  stream.onerror=()=>setTimeout(connectEvents,2000);
}
await authenticate();
try{const h=await api("/health");q("health").textContent="healthy · "+h.instanceId;q("health").className="pill ok";await loadRuns();connectEvents()}
catch(error){q("health").textContent=error.message;q("health").className="pill bad"}
`;
