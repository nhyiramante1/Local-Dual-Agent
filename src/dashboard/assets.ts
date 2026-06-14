export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Duet</title>
  <link rel="stylesheet" href="/dashboard.css">
</head>
<body>
  <header><h1>Duet</h1><span id="health">connecting</span></header>
  <main>
    <aside><h2>Runs</h2><div id="runs"></div></aside>
    <section>
      <div id="summary"><h2>Local orchestrator</h2><p>Select a run.</p></div>
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
:root{color-scheme:dark;font:14px system-ui;background:#0b0d10;color:#e9edf2}
*{box-sizing:border-box}body{margin:0}header{display:flex;align-items:center;justify-content:space-between;padding:18px 24px;border-bottom:1px solid #29303a}
h1,h2{margin:0 0 12px}main{display:grid;grid-template-columns:300px 1fr;min-height:calc(100vh - 70px)}
aside{padding:20px;border-right:1px solid #29303a}section{padding:24px;overflow:auto}
button{width:100%;text-align:left;border:1px solid #303946;background:#151a21;color:inherit;padding:10px;margin:4px 0;border-radius:7px}
button:hover{background:#202833}.card{border:1px solid #29303a;border-radius:8px;padding:12px;margin:8px 0}
.muted{color:#98a3b3}.ok{color:#64d58a}.bad{color:#ff7b72}pre{white-space:pre-wrap;background:#11151b;padding:14px;border-radius:8px;max-height:420px;overflow:auto}
@media(max-width:760px){main{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid #29303a}}
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
async function authenticate() {
  const ticket = location.hash.slice(1);
  if (!ticket) return;
  await fetch("/dashboard/session", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ticket})});
  history.replaceState(null,"",location.pathname+location.search);
}
async function loadRuns() {
  const runs=await api("/runs");
  q("runs").innerHTML=runs.map(r=>\`<button data-id="\${esc(r.id)}"><b>\${esc(r.goal)}</b><br><span class="muted">\${esc(r.status)} · \${esc(r.id)}</span></button>\`).join("");
  q("runs").querySelectorAll("button").forEach(b=>b.onclick=()=>selectRun(b.dataset.id));
  if(selected) await selectRun(selected);
}
async function selectRun(id) {
  selected=id;
  const detail=await api("/runs/"+encodeURIComponent(id));
  q("summary").innerHTML=\`<h2>\${esc(detail.run.goal)}</h2><div class="card">Status: <b>\${esc(detail.run.status)}</b><br>Lead: \${esc(detail.run.leadProvider)}<br>Usage: \${detail.usage.totalTurns} turns</div>\`;
  q("tasks").innerHTML=detail.tasks.map(t=>\`<div class="card"><b>\${esc(t.plan.title)}</b> <span class="muted">\${esc(t.provider)} → \${esc(t.reviewerProvider)}</span><br>\${esc(t.status)} · \${esc(t.plan.allowedPaths.join(", "))}</div>\`).join("");
  const [verification,messages,artifacts,conflicts]=await Promise.all([
    api("/runs/"+encodeURIComponent(id)+"/verification"),
    api("/runs/"+encodeURIComponent(id)+"/messages"),
    api("/runs/"+encodeURIComponent(id)+"/artifacts"),
    api("/runs/"+encodeURIComponent(id)+"/conflicts")
  ]);
  q("verification").innerHTML=verification.map(v=>\`<div class="card">\${v.passed?"PASS":"FAIL"} · \${esc(v.command.join(" "))} · \${v.durationMs}ms</div>\`).join("")||'<span class="muted">No verification results.</span>';
  q("messages").innerHTML=messages.map(m=>\`<div class="card"><b>\${esc(m.kind)}</b><br>\${esc(m.body).slice(0,1000)}</div>\`).join("")||'<span class="muted">No messages.</span>';
  q("artifacts").innerHTML=artifacts.map(a=>\`<div class="card">#\${a.id} · \${esc(a.kind)} · \${esc(a.taskId||"run")}</div>\`).join("")||'<span class="muted">No artifacts.</span>';
  q("conflicts").innerHTML=conflicts.map(t=>\`<div class="card bad">\${esc(t.id)} · \${esc(t.error||"integration conflict")}</div>\`).join("")||'<span class="muted">No conflicts.</span>';
  q("diff").textContent=(await api("/runs/"+encodeURIComponent(id)+"/diff")).diff;
}
async function connectEvents() {
  const url="/api/v1/events"+(selected?"?runId="+encodeURIComponent(selected):"");
  const stream=new EventSource(url);
  stream.addEventListener("duet.event",e=>{
    const item=JSON.parse(e.data);
    const line=document.createElement("div");
    line.className="card";
    line.textContent=\`[\${item.occurredAt}] \${item.type}\`;
    q("events").prepend(line);
    if(item.type==="run.updated"||item.type==="task.updated") loadRuns().catch(()=>{});
  });
  stream.addEventListener("duet.reset",()=>location.reload());
  stream.onerror=()=>setTimeout(connectEvents,2000);
}
await authenticate();
try{const h=await api("/health");q("health").textContent="healthy · "+h.instanceId;q("health").className="ok";await loadRuns();connectEvents()}
catch(error){q("health").textContent=error.message;q("health").className="bad"}
`;
