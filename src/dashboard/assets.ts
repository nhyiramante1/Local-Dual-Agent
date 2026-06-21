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
    <div class="header-right">
      <button id="theme-toggle" type="button" class="theme-btn" title="Toggle light / dark mode">&#9728;</button>
      <span id="health" class="pill">connecting...</span>
    </div>
  </header>
  <main>
    <aside><h2>Runs</h2><div id="runs"></div></aside>
    <section>
      <div id="summary"><h2>Local orchestrator</h2><p class="muted">Select a run.</p></div>
      <h2>Manager Chat</h2>
      <div id="chat" class="chat card">
        <div class="chat-head">
          <div>
            <div class="chat-title"><b>Manager</b><span id="chat-conn" class="conn" title="Live updates">connecting</span></div>
            <p class="muted">Ask about your runs, or select one for run-scoped context. Approve, run, cancel, resolve, cleanup, and merge still happen in the CLI.</p>
            <p class="faint chat-quota">Manager chat may consume provider quota.</p>
          </div>
          <div class="chat-agents" role="group" aria-label="Manager voice">
            <button id="chat-codex" type="button" data-agent="codex">Codex</button>
            <button id="chat-claude" type="button" data-agent="claude">Claude</button>
            <button id="chat-openai" type="button" data-agent="openai">OpenAI</button>
          </div>
        </div>
        <div id="chat-status" class="muted" role="status" aria-live="polite">Ask a question. Select a run for run-scoped context.</div>
        <div id="chat-turns" class="chat-turns" aria-live="polite"></div>
        <form id="chat-form" class="chat-form">
          <textarea id="chat-input" rows="1" maxlength="20000" placeholder="Ask the Manager&#x2026; (Enter sends, Shift+Enter for newline)" disabled></textarea>
          <button id="chat-send" type="submit" disabled aria-label="Send">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </form>
      </div>
      <h2>Tasks</h2><div id="tasks"></div>
      <h2>Timeline</h2><div id="events"></div>
      <h2>Verification</h2><div id="verification"></div>
      <h2>Messages</h2><div id="messages"></div>
      <h2>Artifacts</h2><div id="artifacts"></div>
      <h2>Conflicts</h2><div id="conflicts"></div>
      <h2>Diff</h2><pre id="diff"></pre>
    </section>
  </main>
  <div id="approval-modal" class="modal-overlay" hidden aria-modal="true" role="dialog" aria-labelledby="approval-modal-title">
    <div class="modal">
      <div class="modal-head">
        <h2 id="approval-modal-title">Approve in browser</h2>
        <button type="button" id="approval-modal-close" aria-label="Close">&#x2715;</button>
      </div>
      <div id="approval-modal-body" class="modal-body"></div>
      <div id="approval-modal-error" class="bad" hidden></div>
      <div class="modal-foot">
        <label for="approval-confirm-input">Type the first 8 characters of the hash to confirm</label>
        <div class="proposal-confirm">
          <input id="approval-confirm-input" type="text" autocomplete="off" maxlength="8" placeholder="e.g. a1b2c3d4" spellcheck="false">
          <button type="button" id="approval-confirm-submit" disabled>Approve</button>
        </div>
      </div>
    </div>
  </div>
  <script type="module" src="/dashboard.js"></script>
</body>
</html>`;

export const dashboardCss = `
/* ── tokens: dark (default) ── */
:root{
  --bg:#0b0d10;--surface:#13171d;--surface-2:#171c23;--line:#262d38;--line-2:#313a47;
  --text:#e7ecf2;--muted:#9aa6b6;--faint:#6b7686;
  --accent:#5b8cff;--ok:#5fd38a;--warn:#f0b657;--bad:#ff7b72;
  --ok-bg:#13251b;--ok-bd:#2f5f43;--ok-c:#0b1f13;
  --warn-bg:#241d11;--warn-bd:#5f4d28;
  --bad-bg:#251515;--bad-bd:#5f3232;--bad-c:#23100e;
  --acc-bg:#172033;--acc-bd:#304364;
  --run-c:#9cc2ff;--run-bd:#2c4a78;--run-bg:#142031;
  --mgd-c:#a99cff;--mgd-bd:#41397a;--mgd-bg:#171430;
  --ev-info-bd:#3a4d6b;
  color-scheme:dark;
}
/* ── tokens: light ── */
[data-theme="light"]{
  --bg:#f4f6f9;--surface:#ffffff;--surface-2:#eef0f4;--line:#dde1e8;--line-2:#c4c9d4;
  --text:#1c2028;--muted:#4e5a6b;--faint:#8390a0;
  --accent:#3b72e8;--ok:#17864a;--warn:#a0660a;--bad:#c9291e;
  --ok-bg:#edf7f2;--ok-bd:#80c8a0;--ok-c:#ffffff;
  --warn-bg:#fdf5e6;--warn-bd:#d4a060;
  --bad-bg:#fdf0ef;--bad-bd:#e09090;--bad-c:#ffffff;
  --acc-bg:#eef3fd;--acc-bd:#a0b8f0;
  --run-c:#1a4db8;--run-bd:#a0c0f0;--run-bg:#e8f0fc;
  --mgd-c:#5040a0;--mgd-bd:#b0a8e0;--mgd-bg:#f0eeff;
  --ev-info-bd:#6090c8;
  color-scheme:light;
}
/* ── reset ── */
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;transition:background .18s,color .18s}
h1{font-size:18px;font-weight:600;margin:0;letter-spacing:.2px}
h2{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.8px;color:var(--faint);margin:0 0 10px}
/* ── layout ── */
header{display:flex;align-items:center;justify-content:space-between;padding:14px 22px;border-bottom:1px solid var(--line);background:var(--surface)}
.brand{display:flex;align-items:center;gap:10px}
.dot{width:9px;height:9px;border-radius:50%;background:var(--accent);flex-shrink:0}
.sub{color:var(--faint);font-size:12px}
.header-right{display:flex;align-items:center;gap:10px}
.theme-btn{display:flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;margin:0;border-radius:50%;border:1px solid var(--line-2);background:var(--surface-2);color:var(--muted);cursor:pointer;font-size:15px;transition:background .12s,border-color .12s,color .12s}
.theme-btn:hover{background:var(--line);color:var(--text);border-color:var(--line-2)}
main{display:grid;grid-template-columns:300px 1fr;min-height:calc(100vh - 56px)}
aside{padding:18px;border-right:1px solid var(--line);background:var(--surface)}
section{padding:22px 26px;overflow:auto}
section>h2{margin-top:24px}section>h2:first-child{margin-top:0}
#summary{margin-bottom:4px}
#summary h2{font-size:16px;text-transform:none;letter-spacing:0;color:var(--text);margin-bottom:10px}
/* ── shared components ── */
.pill{font-size:12px;font-weight:500;padding:4px 11px;border-radius:999px;border:1px solid var(--line-2);color:var(--muted)}
.pill.ok{color:var(--ok);border-color:var(--ok-bd);background:var(--ok-bg)}
.pill.bad{color:var(--bad);border-color:var(--bad-bd);background:var(--bad-bg)}
button{display:block;width:100%;text-align:left;border:1px solid var(--line);background:var(--surface-2);color:inherit;padding:10px 12px;margin:0 0 8px;border-radius:9px;cursor:pointer;transition:background .12s,border-color .12s}
button:hover:not(:disabled){background:var(--line);border-color:var(--line-2)}
button:disabled{cursor:not-allowed;opacity:.55}
button.sel{border-color:var(--accent);background:var(--acc-bg)}
button b{font-weight:600}
.card{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:0 0 8px;background:var(--surface)}
.muted{color:var(--muted)}.ok{color:var(--ok)}.bad{color:var(--bad)}
.faint{color:var(--faint)}
.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kv{color:var(--muted);font-size:13px}.kv b{color:var(--text);font-weight:500}
.badge{display:inline-block;font-size:11px;font-weight:600;letter-spacing:.3px;padding:2px 8px;border-radius:6px;border:1px solid var(--line-2);color:var(--muted)}
.badge.s-running{color:var(--run-c);border-color:var(--run-bd);background:var(--run-bg)}
.badge.s-approved{color:var(--ok);border-color:var(--ok-bd);background:var(--ok-bg)}
.badge.s-awaiting{color:var(--warn);border-color:var(--warn-bd);background:var(--warn-bg)}
.badge.s-merged{color:var(--mgd-c);border-color:var(--mgd-bd);background:var(--mgd-bg)}
.badge.s-ok{color:var(--ok);border-color:var(--ok-bd);background:var(--ok-bg)}
.badge.s-failed{color:var(--bad);border-color:var(--bad-bd);background:var(--bad-bg)}
.badge.s-cancelled{color:var(--muted);border-color:var(--line-2);background:var(--surface-2)}
.badge.s-conflict{color:var(--warn);border-color:var(--warn-bd);background:var(--warn-bg)}
.ev{display:flex;gap:10px;align-items:baseline;padding:7px 11px;margin:0 0 5px;border-left:2px solid var(--line-2);border-radius:0 6px 6px 0;background:var(--surface)}
.ev time{color:var(--faint);font:12px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}
.ev .ty{font-weight:500}
.ev-info{border-left-color:var(--ev-info-bd)}
.ev-warning{border-left-color:var(--warn);background:var(--warn-bg)}
.ev-error{border-left-color:var(--bad);background:var(--bad-bg)}
.vr{display:flex;align-items:center;gap:9px;padding:9px 12px;margin:0 0 6px;border:1px solid var(--line);border-radius:9px;background:var(--surface)}
.vr .tag{font-size:11px;font-weight:700;padding:2px 7px;border-radius:5px}
.vr.pass .tag{color:var(--ok-c);background:var(--ok)}
.vr.fail .tag{color:var(--bad-c);background:var(--bad)}
pre{white-space:pre-wrap;background:var(--surface-2);border:1px solid var(--line);padding:14px;border-radius:10px;max-height:440px;overflow:auto;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.empty{color:var(--faint);font-size:13px;font-style:italic}
/* ── chat container ── */
.chat{display:grid;gap:14px}
.chat-title{display:flex;align-items:center;gap:8px}
.chat-quota{font-size:12px}
.conn{font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px;border:1px solid var(--line-2);color:var(--faint)}
.conn-ok{color:var(--ok);border-color:var(--ok-bd);background:var(--ok-bg)}
.conn-bad{color:var(--warn);border-color:var(--warn-bd);background:var(--warn-bg)}
.chat-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
.chat-head p{margin:3px 0 0}
/* ── provider segmented toggle ── */
.chat-agents{display:inline-flex;background:var(--surface-2);border:1px solid var(--line);border-radius:999px;padding:3px;gap:2px;flex-shrink:0}
.chat-agents button{width:auto;margin:0;padding:4px 13px;border-radius:999px;border:1px solid transparent;background:transparent;font-size:12px;font-weight:500;color:var(--muted);text-align:center;transition:background .12s,color .12s,border-color .12s}
.chat-agents button:hover:not(:disabled){background:var(--line);color:var(--text);border-color:transparent}
.chat-agents button.active{background:var(--accent);color:#fff;border-color:transparent}
/* ── bubble turn list ── */
.chat-turns{display:flex;flex-direction:column;gap:10px;max-height:420px;overflow:auto;padding:4px 2px}
.chat-turn{border:1px solid var(--line);border-radius:14px;padding:10px 13px;background:var(--surface-2);max-width:88%}
.chat-turn.user{border-color:var(--acc-bd);background:var(--acc-bg);border-radius:14px 14px 4px 14px;align-self:flex-end}
.chat-turn.manager{display:flex;gap:10px;border-color:var(--ok-bd);background:var(--ok-bg);border-radius:14px 14px 14px 4px;align-self:flex-start;max-width:94%}
.chat-turn.failed{border-color:var(--bad-bd);background:var(--bad-bg);border-radius:14px}
.manager-avatar{width:26px;height:26px;border-radius:50%;background:var(--accent);opacity:.65;flex-shrink:0;margin-top:2px}
.turn-content{flex:1;min-width:0}
.chat-turn .meta{display:flex;align-items:center;gap:8px;margin-bottom:5px;color:var(--faint);font-size:12px;flex-wrap:wrap}
.chat-turn .meta time,.chat-turn .meta .when{color:var(--faint);font:11px ui-monospace,SFMono-Regular,Menlo,monospace}
.chat-turn .note{color:var(--faint);font-size:12px;margin-bottom:4px}
.chat-turn .body{white-space:pre-wrap;overflow-wrap:anywhere}
/* ── proposal card (elevated, accent left border) ── */
.proposal-card{margin-top:10px;border:1px solid var(--line-2);border-left:3px solid var(--accent);border-radius:0 10px 10px 0;padding:10px 12px;background:var(--surface)}
.proposal-card .proposal-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--accent)}
.proposal-card .proposal-copy{margin:7px 0;color:var(--muted);font-size:12px}
.proposal-card code{display:block;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}
.proposal-actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.proposal-actions button{width:auto;margin:0;padding:6px 10px;text-align:center;font-size:12px}
.proposal-readiness{margin-top:9px;border-top:1px solid var(--line);padding-top:8px;font-size:12px}
.proposal-readiness ul{margin:6px 0 0 18px;padding:0}
.proposal-readiness li{margin:2px 0}
.proposal-confirm{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;margin-top:8px}
.proposal-confirm input{color:var(--text);background:var(--surface-2);border:1px solid var(--line-2);border-radius:7px;padding:7px 9px;font:inherit}
.proposal-confirm button{width:auto;margin:0;padding:7px 10px;text-align:center}
/* ── proposal history ── */
.proposal-history{margin-top:14px;border-top:1px solid var(--line);padding-top:10px}
.proposal-history summary{cursor:pointer;font-size:12px;color:var(--muted);user-select:none;list-style:none}
.proposal-history summary::-webkit-details-marker{display:none}
.proposal-history-item{display:flex;align-items:baseline;gap:8px;padding:5px 0;border-bottom:1px solid var(--line);font-size:12px}
.proposal-history-item:last-child{border-bottom:none}
.proposal-history-item .phi-action{font-weight:600}
.proposal-history-item .phi-op{color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.phi-op.ok{color:var(--ok)}
.phi-op.bad{color:var(--bad)}
/* ── approval modal ── */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:100}
.modal-overlay[hidden]{display:none}
.modal{background:var(--surface);border:1px solid var(--line-2);border-radius:12px;padding:20px;width:min(600px,92vw);max-height:80vh;display:grid;gap:14px;overflow:auto}
.modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.modal-head h2{font-size:14px;text-transform:none;letter-spacing:0;color:var(--text);margin:0}
.modal-head button{width:auto;margin:0;padding:4px 10px;color:var(--faint);border-color:transparent;background:transparent}
.modal-head button:hover{color:var(--text);background:var(--surface-2);border-color:var(--line)}
.modal-body{font-size:13px;display:grid;gap:8px}
.modal-body pre{margin:0;max-height:200px}
.modal-foot{display:grid;gap:8px}
.modal-foot label{font-size:12px;color:var(--muted)}
.approval-task-list{margin:4px 0 0 18px;padding:0;font-size:12px}
.approval-hash-label{font-size:12px;margin-top:4px}
code.inline-code{display:inline;padding:2px 5px}
/* ── pill chat input ── */
.chat-form{display:flex;align-items:flex-end;gap:8px;background:var(--surface-2);border:1px solid var(--line-2);border-radius:24px;padding:6px 6px 6px 14px;transition:border-color .15s}
.chat-form:focus-within{border-color:var(--accent)}
.chat-form textarea{flex:1;resize:none;min-height:24px;max-height:160px;overflow-y:auto;border:none;background:transparent;color:var(--text);padding:4px 0;font:inherit;line-height:1.5;outline:none}
.chat-form textarea::placeholder{color:var(--faint)}
#chat-send{width:34px;height:34px;border-radius:50%;background:var(--accent);border:none;color:#fff;display:flex;align-items:center;justify-content:center;margin:0;flex-shrink:0;padding:0;cursor:pointer;transition:opacity .12s}
#chat-send:disabled{opacity:.4;cursor:not-allowed}
#chat-send:not(:disabled):hover{opacity:.82}
#chat-send svg{pointer-events:none}
/* ── responsive ── */
@media(max-width:760px){main{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid var(--line)}.chat-head{display:grid}.chat-agents{flex-wrap:wrap;border-radius:12px}}
`;

export const dashboardJs = `
(function(){var t=localStorage.getItem("duet-theme")||"dark";document.documentElement.setAttribute("data-theme",t)})();
const q = (id) => document.getElementById(id);
let selected = new URL(location.href).searchParams.get("run");
const chat = {
  agent: "codex",
  conversations: new Map(),
  activeOperation: null,
  polling: null
};
let eventStream = null;
let eventRunId = null;
let eventCursor = 0;
const renderedEventSeqs = new Set();
function requestKey(prefix) {
  const id = globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random();
  return prefix + "-" + id;
}
async function api(path, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  const fetchOptions = { method: options.method || "GET", credentials: "same-origin", headers };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    fetchOptions.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  const response = await fetch("/api/v1" + path, fetchOptions);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || response.statusText);
  return payload.data;
}
function esc(value){const d=document.createElement("div");d.textContent=String(value??"");return d.innerHTML.replaceAll('"',"&quot;").replaceAll("'","&#39;")}
function statusClass(value){const s=String(value??"").toLowerCase();
  if(s.includes("conflict")||s.includes("blocked")||s.includes("attention"))return"s-conflict";
  if(s.includes("fail"))return"s-failed";
  if(s.includes("cancel"))return"s-cancelled";
  if(s.includes("await")||s.includes("paused")||s==="pending")return"s-awaiting";
  if(s==="merged")return"s-merged";
  if(s.includes("approved"))return"s-approved";
  if(s.includes("running")||s.includes("implementing")||s.includes("reviewing")||s.includes("revising")||s.includes("verifying")||s.includes("leased")||s.includes("planning")||s==="queued")return"s-running";
  if(s==="completed"||s==="integrated"||s==="ready"||s==="passed"||s==="succeeded")return"s-ok";
  return"";
}
function badge(value){return '<span class="badge '+statusClass(value)+'">'+esc(value)+'</span>'}
function visibleText(value, max) {
  const text = String(value ?? "");
  if (text.length <= max) return esc(text);
  return esc(text.slice(0, max)) + '\\n[truncated in view from ' + text.length + ' chars]';
}
async function authenticate() {
  const ticket = location.hash.slice(1);
  if (!ticket) return;
  await fetch("/dashboard/session", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ticket})});
  history.replaceState(null,"",location.pathname+location.search);
}
async function loadRuns(options = {}) {
  const runs=await api("/runs");
  q("runs").innerHTML=runs.map(r=>'<button data-id="'+esc(r.id)+'" class="'+(r.id===selected?"sel":"")+'"><b>'+esc(r.goal)+'</b><br><span class="muted">'+esc(r.id)+'</span> '+badge(r.status)+'</button>').join("")||'<span class="empty">No runs yet.</span>';
  q("runs").querySelectorAll("button").forEach(b=>b.onclick=()=>selectRun(b.dataset.id));
  if(selected && options.selectCurrent) await selectRun(selected);
}
async function selectRun(id) {
  const changed = selected !== id || eventRunId !== id;
  selected=id;
  if (changed) {
    q("events").innerHTML="";
    renderedEventSeqs.clear();
    eventCursor=0;
    if (eventStream) eventStream.close();
    eventStream=null;
    eventRunId=null;
  }
  q("runs").querySelectorAll("button").forEach(b=>b.classList.toggle("sel",b.dataset.id===id));
  const detail=await api("/runs/"+encodeURIComponent(id));
  q("summary").innerHTML='<h2>'+esc(detail.run.goal)+'</h2><div class="card"><div class="row">'+badge(detail.run.status)+'<span class="kv">lead <b>'+esc(detail.run.leadProvider)+'</b></span><span class="kv">'+detail.usage.totalTurns+' turns</span></div></div>';
  q("tasks").innerHTML=detail.tasks.map(t=>'<div class="card"><div class="row"><b>'+esc(t.plan.title)+'</b>'+badge(t.status)+'</div><div class="kv">'+esc(t.provider)+' -> '+esc(t.reviewerProvider)+'</div><div class="muted">'+esc(t.plan.allowedPaths.join(", "))+'</div></div>').join("")||'<span class="empty">No tasks.</span>';
  const [verification,messages,artifacts,conflicts]=await Promise.all([
    api("/runs/"+encodeURIComponent(id)+"/verification"),
    api("/runs/"+encodeURIComponent(id)+"/messages"),
    api("/runs/"+encodeURIComponent(id)+"/artifacts"),
    api("/runs/"+encodeURIComponent(id)+"/conflicts")
  ]);
  q("verification").innerHTML=verification.map(v=>'<div class="vr '+(v.passed?"pass":"fail")+'"><span class="tag">'+(v.passed?"PASS":"FAIL")+'</span><span>'+esc(v.command.join(" "))+'</span><span class="muted">'+v.durationMs+'ms</span></div>').join("")||'<span class="empty">No verification results.</span>';
  q("messages").innerHTML=messages.map(m=>'<div class="card"><b>'+esc(m.kind)+'</b><div class="muted">'+visibleText(m.body,1000)+'</div></div>').join("")||'<span class="empty">No messages.</span>';
  q("artifacts").innerHTML=artifacts.map(a=>'<div class="card"><span class="muted">#'+a.id+'</span> '+esc(a.kind)+' <span class="muted">- '+esc(a.taskId||"run")+'</span></div>').join("")||'<span class="empty">No artifacts.</span>';
  q("conflicts").innerHTML=conflicts.map(t=>'<div class="card"><div class="row"><b>'+esc(t.id)+'</b><span class="badge s-conflict">conflict</span></div><div class="bad">'+esc(t.error||"integration conflict")+'</div></div>').join("")||'<span class="empty">No conflicts.</span>';
  q("diff").textContent=(await api("/runs/"+encodeURIComponent(id)+"/diff")).diff||"";
  await loadChat();
  connectEvents();
}
function conversationKey(runId, agent) {
  return (runId || "global") + ":" + agent;
}
function currentConversation() {
  if (!selected) return null;
  return chat.conversations.get(conversationKey(selected, chat.agent)) || null;
}
function rememberConversation(conversation) {
  const key = conversationKey(conversation.runId, conversation.interfaceAgent);
  const existing = chat.conversations.get(key);
  const updatedAt = String(conversation.updatedAt || "");
  const existingUpdatedAt = String(existing?.updatedAt || "");
  if (
    !existing ||
    updatedAt > existingUpdatedAt ||
    (updatedAt === existingUpdatedAt && String(conversation.id) > String(existing.id))
  ) {
    chat.conversations.set(key, conversation);
  }
}
function isCurrentConversation(conversation) {
  return Boolean(
    conversation.interfaceAgent === chat.agent &&
    (selected ? conversation.runId === selected : !conversation.runId)
  );
}
function chatIsBusyForCurrentView() {
  return Boolean(chat.activeOperation);
}
async function loadChat() {
  clearTimeout(chat.polling);
  renderChatShell();
  const params = selected ? "?runId="+encodeURIComponent(selected) : "";
  const conversations = await api("/chat/conversations"+params);
  for (const item of conversations) {
    if (!selected && item.runId) continue;
    rememberConversation(item);
  }
  const conversation = currentConversation();
  if (!conversation) {
    const scope = selected ? esc(chat.agent)+" manager" : "global";
    q("chat-turns").innerHTML='<span class="empty">No '+scope+' conversation yet. Send a message to start one.</span>';
    setChatStatus("Ready. Manager voice: "+chat.agent+".");
    setChatEnabled(!chatIsBusyForCurrentView());
    return;
  }
  await refreshConversation(conversation.id);
}
async function ensureConversation() {
  const existing = currentConversation();
  if (existing) return existing;
  const body = {
    interfaceAgent: chat.agent,
    title: selected ? "Dashboard manager chat" : "Global manager chat",
  };
  if (selected) body.runId = selected;
  const created = await api("/chat/conversations", {
    method: "POST",
    idempotencyKey: requestKey("dashboard-chat-conversation"),
    body,
  });
  rememberConversation(created);
  return created;
}
async function refreshConversation(conversationId) {
  const data = await api("/chat/conversations/"+encodeURIComponent(conversationId));
  rememberConversation(data.conversation);
  if (!isCurrentConversation(data.conversation)) return data;
  renderTurns(data.turns, data.proposals || [], data.proposalHistory || []);
  const failed = [...data.turns].reverse().find(turn => turn.role === "manager" && turn.status === "failed");
  const failure = failedTurnMessage(failed);
  if (failure) setChatStatus(failure, true);
  else setChatStatus("Ready. Manager voice: "+data.conversation.interfaceAgent+".");
  setChatEnabled(!chatIsBusyForCurrentView());
  return data;
}
function renderChatShell() {
  q("chat-codex").classList.toggle("active", chat.agent === "codex");
  q("chat-claude").classList.toggle("active", chat.agent === "claude");
  const openaiBtn = q("chat-openai");
  if (openaiBtn) openaiBtn.classList.toggle("active", chat.agent === "openai");
  setChatEnabled(!chatIsBusyForCurrentView());
}
function setChatStatus(message, bad=false) {
  q("chat-status").className = bad ? "bad" : "muted";
  q("chat-status").textContent = message;
}
function setChatEnabled(enabled) {
  q("chat-input").disabled = !enabled;
  q("chat-send").disabled = !enabled;
}
function setConn(state) {
  const el = q("chat-conn");
  if (!el) return;
  if (state === "live") { el.textContent = "live"; el.className = "conn conn-ok"; }
  else if (state === "reconnecting") { el.textContent = "reconnecting"; el.className = "conn conn-bad"; }
  else { el.textContent = "connecting"; el.className = "conn"; }
}
function renderTurns(turns, proposals = [], proposalHistory = []) {
  if (!turns.length) {
    q("chat-turns").innerHTML='<span class="empty">No turns yet.</span>';
    return;
  }
  const proposalsByTurn = new Map();
  for (const proposal of proposals) {
    const list = proposalsByTurn.get(proposal.turnId) || [];
    list.push(proposal);
    proposalsByTurn.set(proposal.turnId, list);
  }
  const turnsHtml = turns.map(turn => {
    const who = turn.role === "manager"
      ? "Manager: "+(turn.interfaceAgent || chat.agent)
      : (turn.role === "user" ? "You" : turn.role);
    const failed = turn.status === "failed";
    let note = "";
    let body;
    if (failed && turn.errorJson) {
      let code = "error", message = turn.errorJson;
      try { const parsed = JSON.parse(turn.errorJson); code = parsed.code || code; message = parsed.message || message; }
      catch { /* fall back to the raw, bounded error text */ }
      note = '<div class="note">'+esc(code)+'</div>';
      body = visibleText(message, 4000);
    } else {
      body = visibleText(turn.content, 4000);
    }
    const when = turn.createdAt ? new Date(turn.createdAt) : null;
    const ts = when && !isNaN(when.getTime()) ? '<span class="when">'+esc(when.toLocaleTimeString())+'</span>' : "";
    const cards = (proposalsByTurn.get(turn.id) || []).map(renderProposalCard).join("");
    const meta = '<div class="meta"><b>'+esc(who)+'</b>'+badge(turn.status)+'<span>#'+esc(turn.seq)+'</span>'+ts+'</div>';
    const inner = meta+note+'<div class="body">'+body+'</div>'+cards;
    if (turn.role === "manager") {
      return '<div class="chat-turn manager'+(failed?" failed":"")+'"><div class="manager-avatar"></div><div class="turn-content">'+inner+'</div></div>';
    }
    return '<div class="chat-turn '+esc(turn.role)+(failed?" failed":"")+'">'+inner+'</div>';
  }).join("");
  q("chat-turns").innerHTML = turnsHtml + renderProposalHistory(proposalHistory);
  q("chat-turns").scrollTop = q("chat-turns").scrollHeight;
  enrichHistoryOutcomes().catch(() => {});
}
function actionLabel(action) {
  return String(action || "").replaceAll("_", " ");
}
function renderProposalHistory(proposals) {
  const inactive = proposals.filter(p => p.status !== 'proposed');
  if (!inactive.length) return '';
  const items = inactive.map(p => {
    const opLink = p.operationId
      ? ' <span class="phi-op" data-phi-operation="'+esc(p.operationId)+'">\\u2192 op '+esc(p.operationId.slice(0,8))+'</span>'
      : '';
    const when = p.createdAt ? new Date(p.createdAt) : null;
    const ts = when && !isNaN(when.getTime()) ? '<span class="phi-op">'+esc(when.toLocaleTimeString())+'</span>' : '';
    return '<div class="proposal-history-item">'
      +'<span class="phi-action">'+esc(actionLabel(p.action))+'</span>'
      +badge(p.status)
      +opLink
      +ts
      +'</div>';
  }).join('');
  const count = inactive.length;
  return '<details class="proposal-history"><summary>'+count+' past suggestion'+(count===1?'':'s')+'</summary>'+items+'</details>';
}
async function enrichHistoryOutcomes() {
  const spans = q("chat-turns").querySelectorAll("[data-phi-operation]");
  for (const span of spans) {
    const opId = span.dataset.phiOperation;
    if (!opId) continue;
    try {
      const op = await api("/operations/"+encodeURIComponent(opId));
      if (!["queued","running"].includes(op.status)) {
        span.textContent = "\\u2192 op "+opId.slice(0,8)+" "+op.status;
        span.className = (op.status === "succeeded") ? "phi-op ok"
          : (op.status === "failed" || op.status === "cancelled" || op.status === "interrupted") ? "phi-op bad"
          : "phi-op";
      }
    } catch { /* operation not found or network error — leave label as-is */ }
  }
}
function renderProposalCard(proposal) {
  const target = proposal.taskId ? "task "+proposal.taskId : (proposal.runId ? "run "+proposal.runId : "current context");
  const isMerge = proposal.action === "merge_run";
  const isFingerprint = proposal.tier === "fingerprint";
  const stage = proposal.action === "approve_plan" ? "plan" : proposal.action === "approve_merge" ? "merge" : null;
  let fingerprintSection = "";
  if (isMerge) {
    fingerprintSection = '<div class="proposal-copy bad">This is a high-consequence action. Run <code class="inline-code">duet merge '+esc(proposal.runId || "RUN_ID")+'</code> in your terminal — merge stays CLI-only.</div>';
  } else if (isFingerprint && stage) {
    fingerprintSection = '<div class="proposal-copy bad">Fingerprint approval required.</div>';
  } else if (isFingerprint) {
    fingerprintSection = '<div class="proposal-copy bad">This suggestion still requires CLI fingerprint confirmation before it can take effect.</div>';
  }
  const approveBtn = stage && !isMerge && proposal.runId
    ? '<button type="button" data-proposal-approve="'+esc(proposal.id)+'" data-run-id="'+esc(proposal.runId)+'" data-stage="'+esc(stage)+'">Approve in browser</button>'
    : "";
  return '<div class="proposal-card" data-proposal-id="'+esc(proposal.id)+'" data-command="'+esc(proposal.commandCli)+'">'+
    '<div class="proposal-title">Suggested action&nbsp;'+badge(actionLabel(proposal.action))+badge(proposal.tier || "ordinary")+'<span class="kv">'+esc(target)+'</span></div>'+
    '<div class="muted">'+visibleText(proposal.summary, 600)+'</div>'+
    '<div class="proposal-copy">Run this in your terminal if you choose to proceed.</div>'+
    fingerprintSection+
    (isMerge ? '' : '<code>'+visibleText(proposal.commandCli, 1000)+'</code>')+
    '<div class="proposal-readiness" data-proposal-readiness="'+esc(proposal.id)+'"></div>'+
    '<div class="proposal-actions"><button type="button" data-proposal-prepare="'+esc(proposal.id)+'">Check readiness</button><button type="button" data-proposal-copy="'+esc(proposal.id)+'">Copy CLI</button>'+approveBtn+'<button type="button" data-proposal-dismiss="'+esc(proposal.id)+'">Dismiss</button></div>'+
  '</div>';
}
function renderReadiness(prepared) {
  const state = prepared.available ? '<span class="ok">Ready to copy</span>' : '<span class="bad">Not ready</span>';
  const run = prepared.run ? '<div class="kv">run <b>'+esc(prepared.run.id)+'</b> '+badge(prepared.run.status)+' version '+esc(prepared.run.version)+'</div>' : "";
  const task = prepared.task ? '<div class="kv">task <b>'+esc(prepared.task.id)+'</b> '+badge(prepared.task.status)+' version '+esc(prepared.task.version)+'</div>' : "";
  const blocked = prepared.blockedReason ? '<div class="bad">'+visibleText(prepared.blockedReason, 500)+'</div>' : "";
  const requirements = (prepared.requirements || []).map(item => '<li>'+visibleText(item, 500)+'</li>').join("");
  const warnings = (prepared.warnings || []).map(item => '<li>'+visibleText(item, 500)+'</li>').join("");
  const start = prepared.available && prepared.tier === "ordinary"
    ? '<div class="proposal-confirm"><input type="text" autocomplete="off" placeholder="Type start" aria-label="Type start to confirm" data-proposal-start-input="'+esc(prepared.proposalId)+'"><button type="button" disabled data-proposal-start="'+esc(prepared.proposalId)+'" data-run-version="'+esc(prepared.run?.version ?? "")+'" data-task-version="'+esc(prepared.task?.version ?? "")+'">Start operation</button></div>'
    : "";
  return '<div><b>'+state+'</b></div>'+run+task+blocked+
    (requirements ? '<div class="proposal-copy">Requirements</div><ul>'+requirements+'</ul>' : "")+
    (warnings ? '<div class="proposal-copy">Warnings</div><ul>'+warnings+'</ul>' : "")+
    start;
}
async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "readonly");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  try { document.execCommand("copy"); }
  finally { area.remove(); }
}
async function dismissProposal(proposalId) {
  const conversation = currentConversation();
  if (!conversation) return;
  await api("/chat/conversations/"+encodeURIComponent(conversation.id)+"/proposals/"+encodeURIComponent(proposalId)+"/dismiss", {
    method: "POST",
    idempotencyKey: requestKey("dashboard-proposal-dismiss"),
    body: {}
  });
  setChatStatus("Suggestion dismissed.");
  await refreshConversation(conversation.id);
}
async function prepareProposal(proposalId) {
  const conversation = currentConversation();
  if (!conversation) return;
  const prepared = await api("/chat/conversations/"+encodeURIComponent(conversation.id)+"/proposals/"+encodeURIComponent(proposalId)+"/prepare");
  const panel = q("chat-turns").querySelector('[data-proposal-readiness="'+CSS.escape(proposalId)+'"]');
  if (panel) panel.innerHTML = renderReadiness(prepared);
  setChatStatus(prepared.available ? "Suggestion checked. Copy the CLI command if you choose to proceed." : "Suggestion checked, but it is not currently ready.");
}
async function startProposal(proposalId, button) {
  const conversation = currentConversation();
  if (!conversation) return;
  const body = { confirm: "start" };
  if (button.dataset.runVersion) body.expectedRunVersion = Number(button.dataset.runVersion);
  if (button.dataset.taskVersion) body.expectedTaskVersion = Number(button.dataset.taskVersion);
  const operation = await api("/chat/conversations/"+encodeURIComponent(conversation.id)+"/proposals/"+encodeURIComponent(proposalId)+"/start", {
    method: "POST",
    idempotencyKey: requestKey("dashboard-proposal-start"),
    body
  });
  const panel = q("chat-turns").querySelector('[data-proposal-readiness="'+CSS.escape(proposalId)+'"]');
  if (panel) panel.innerHTML = '<div><b>Operation started</b></div><div class="kv">operation <b>'+esc(operation.id)+'</b> '+badge(operation.status)+'</div>';
  await pollOperation(operation.id, conversation.id, "Duet operation");
  if (selected) await selectRun(selected);
}
let approvalModal = { proposalId: null, runId: null, stage: null, bindingHash: null, runVersion: null };
function openApprovalModal(proposalId, runId, stage) {
  approvalModal = { proposalId, runId, stage, bindingHash: null, runVersion: null };
  const modal = q("approval-modal");
  const body = q("approval-modal-body");
  const input = q("approval-confirm-input");
  const submit = q("approval-confirm-submit");
  const err = q("approval-modal-error");
  body.innerHTML = '<div class="muted">Loading approval preview…</div>';
  input.value = "";
  submit.disabled = true;
  err.hidden = true;
  err.textContent = "";
  modal.hidden = false;
  api("/runs/"+encodeURIComponent(runId)+"/approval-preview?stage="+encodeURIComponent(stage)).then(preview => {
    approvalModal.bindingHash = preview.bindingHash;
    approvalModal.runVersion = preview.runVersion;
    const taskRows = stage === "plan"
      ? (preview.tasks || []).map(t => '<li>'+esc(t.id)+' — paths: '+esc((t.allowedPaths||[]).join(", ") || "none")+'</li>').join("")
      : (preview.tasks || []).map(t => '<li>'+esc(t.id)+' commit '+esc(t.taskCommit||"—")+'</li>').join("");
    const runInfo = stage === "plan"
      ? '<div><span class="muted">branch</span> '+esc(preview.run.baseBranch||"—")+'&nbsp;&nbsp;<span class="muted">base</span> '+esc((preview.run.baseCommit||"").slice(0,12))+'…</div>'
      : '<div><span class="muted">integration</span> '+esc(preview.run.integrationBranch||"—")+'&nbsp;&nbsp;<span class="muted">commit</span> '+esc((preview.run.finalCommit||"").slice(0,12))+'…</div>';
    body.innerHTML =
      '<div><span class="muted">Stage</span> <b>'+esc(stage)+'</b></div>'+
      '<div>'+esc(preview.run.goal||"")+'</div>'+
      runInfo+
      (taskRows ? '<ul class="approval-task-list">'+taskRows+'</ul>' : '')+
      '<div class="approval-hash-label muted">Binding hash — verify this matches what the CLI would show</div>'+
      '<pre>'+esc(preview.bindingHash)+'</pre>';
  }).catch(err2 => {
    body.innerHTML = '<div class="bad">Failed to load preview: '+esc(err2.message)+'</div>';
  });
}
q("approval-modal-close").onclick = () => { q("approval-modal").hidden = true; };
q("approval-modal").addEventListener("click", (e) => { if (e.target === q("approval-modal")) q("approval-modal").hidden = true; });
q("approval-confirm-input").addEventListener("input", () => {
  const val = q("approval-confirm-input").value;
  q("approval-confirm-submit").disabled = !approvalModal.bindingHash || val !== approvalModal.bindingHash.slice(0, 8);
});
q("approval-confirm-submit").addEventListener("click", async () => {
  const { proposalId, runId, stage, bindingHash, runVersion } = approvalModal;
  if (!runId || !stage || !bindingHash) return;
  const err = q("approval-modal-error");
  const input = q("approval-confirm-input");
  const submit = q("approval-confirm-submit");
  err.hidden = true;
  submit.disabled = true;
  try {
    await api("/runs/"+encodeURIComponent(runId)+"/approve", {
      method: "POST",
      idempotencyKey: requestKey("dashboard-approve"),
      body: { stage, bindingHash, runVersion, confirm: input.value },
    });
    if (proposalId) {
      const conversation = currentConversation();
      if (conversation) {
        await api("/chat/conversations/"+encodeURIComponent(conversation.id)+"/proposals/"+encodeURIComponent(proposalId)+"/dismiss", {
          method: "POST",
          idempotencyKey: requestKey("dashboard-approve-dismiss"),
          body: {},
        });
      }
    }
    q("approval-modal").hidden = true;
    setChatStatus("Approved. The run state has been updated.");
    if (selected) await selectRun(selected);
  } catch (error) {
    err.textContent = error.message;
    err.hidden = false;
    input.value = "";
    submit.disabled = true;
  }
});
q("chat-turns").addEventListener("click", async (event) => {
  const prepare = event.target.closest("[data-proposal-prepare]");
  const start = event.target.closest("[data-proposal-start]");
  const copy = event.target.closest("[data-proposal-copy]");
  const dismiss = event.target.closest("[data-proposal-dismiss]");
  const approve = event.target.closest("[data-proposal-approve]");
  if (!prepare && !start && !copy && !dismiss && !approve) return;
  try {
    if (prepare) {
      await prepareProposal(prepare.dataset.proposalPrepare);
    } else if (start) {
      await startProposal(start.dataset.proposalStart, start);
    } else if (copy) {
      const card = copy.closest(".proposal-card");
      const command = card?.dataset.command || "";
      await copyText(command);
      setChatStatus("Command copied. Paste it into your terminal if you choose to run it.");
    } else if (dismiss) {
      await dismissProposal(dismiss.dataset.proposalDismiss);
    } else if (approve) {
      openApprovalModal(approve.dataset.proposalApprove, approve.dataset.runId, approve.dataset.stage);
    }
  } catch (error) {
    setChatStatus(error.message, true);
  }
});
q("chat-turns").addEventListener("input", (event) => {
  const input = event.target.closest("[data-proposal-start-input]");
  if (!input) return;
  const card = input.closest(".proposal-card");
  const button = card?.querySelector('[data-proposal-start="'+CSS.escape(input.dataset.proposalStartInput)+'"]');
  if (button) button.disabled = input.value.trim() !== "start";
});
function failedTurnMessage(turn) {
  if (!turn || turn.status !== "failed" || !turn.errorJson) return null;
  try {
    const parsed = JSON.parse(turn.errorJson);
    return parsed.message || parsed.code || "Manager turn failed.";
  } catch {
    return turn.errorJson;
  }
}
async function pollOperation(operationId, conversationId, label="Manager turn") {
  chat.activeOperation = { id: operationId, conversationId };
  setChatEnabled(false);
  setChatStatus(label+" running...");
  try {
    while (true) {
      const operation = await api("/operations/"+encodeURIComponent(operationId));
      if (!["queued","running"].includes(operation.status)) {
        await refreshConversation(conversationId);
        if (operation.status === "succeeded") {
          if (currentConversation()?.id === conversationId) {
            setChatStatus("Ready. Manager voice: "+chat.agent+".");
          }
        } else {
          let message = label+" "+operation.status+".";
          if (operation.errorJson) {
            try { message += " " + JSON.parse(operation.errorJson).message; }
            catch { message += " " + operation.errorJson; }
          }
          if (currentConversation()?.id === conversationId) setChatStatus(message, true);
        }
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    setChatStatus(error.message, true);
  } finally {
    if (chat.activeOperation?.id === operationId) chat.activeOperation = null;
    setChatEnabled(Boolean(selected) && !chatIsBusyForCurrentView());
  }
}
async function sendChat(message) {
  const conversation = await ensureConversation();
  const operation = await api("/chat/conversations/"+encodeURIComponent(conversation.id)+"/turns", {
    method: "POST",
    idempotencyKey: requestKey("dashboard-chat-turn"),
    body: { message }
  });
  await refreshConversation(conversation.id);
  await pollOperation(operation.id, conversation.id);
}
q("chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = q("chat-input").value.trim();
  if (!text || !selected || chatIsBusyForCurrentView()) return;
  q("chat-input").value = "";
  q("chat-input").style.height = "auto";
  setChatEnabled(false);
  setChatStatus("Sending...");
  try {
    await sendChat(text);
  } catch (error) {
    setChatStatus(error.message, true);
    setChatEnabled(Boolean(selected) && !chatIsBusyForCurrentView());
  }
});
q("chat-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (q("chat-form").requestSubmit) q("chat-form").requestSubmit();
    else q("chat-form").dispatchEvent(new Event("submit", { cancelable: true }));
  }
});
q("chat-input").addEventListener("input", function() {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 160) + "px";
});
q("chat-codex").onclick = async () => {
  chat.agent = "codex";
  await loadChat().catch(error => setChatStatus(error.message, true));
};
q("chat-claude").onclick = async () => {
  chat.agent = "claude";
  await loadChat().catch(error => setChatStatus(error.message, true));
};
q("chat-openai").onclick = async () => {
  chat.agent = "openai";
  await loadChat().catch(error => setChatStatus(error.message, true));
};
/* ── theme toggle ── */
(function() {
  const saved = localStorage.getItem("duet-theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  const btn = q("theme-toggle");
  if (btn) btn.innerHTML = saved === "light" ? "&#9790;" : "&#9728;";
})();
q("theme-toggle").onclick = () => {
  const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("duet-theme", next);
  q("theme-toggle").innerHTML = next === "light" ? "&#9790;" : "&#9728;";
};
async function connectEvents() {
  const targetRunId = selected || "";
  if (eventStream && eventRunId === targetRunId) return;
  if (eventStream) eventStream.close();
  eventRunId=targetRunId;
  const params=[];
  if(selected) params.push("runId="+encodeURIComponent(selected));
  if(eventCursor>0) params.push("after="+encodeURIComponent(String(eventCursor)));
  const url="/api/v1/events"+(params.length?"?"+params.join("&"):"");
  setConn("connecting");
  const stream=new EventSource(url);
  eventStream=stream;
  stream.onopen=()=>{ if(eventStream===stream) setConn("live"); };
  stream.addEventListener("duet.event",e=>{
    const item=JSON.parse(e.data);
    if (renderedEventSeqs.has(item.seq)) return;
    renderedEventSeqs.add(item.seq);
    eventCursor=Math.max(eventCursor, Number(item.seq)||0);
    const sev=item.severity==="error"?"ev-error":item.severity==="warning"?"ev-warning":"ev-info";
    const line=document.createElement("div");
    line.className="ev "+sev;
    const parsed=new Date(item.occurredAt);
    const ts=isNaN(parsed.getTime())?item.occurredAt:parsed.toLocaleTimeString();
    line.innerHTML='<time>'+esc(ts)+'</time><span class="ty">'+esc(item.type)+'</span>';
    q("events").prepend(line);
    if(item.type==="run.updated"||item.type==="task.updated") loadRuns().catch(()=>{});
    if(item.type && item.type.startsWith("chat.turn.")) {
      const conversation = currentConversation();
      if (conversation && item.payload && item.payload.conversationId === conversation.id) {
        refreshConversation(conversation.id).catch(()=>{});
      }
    }
    if(item.type==="operation.updated" && item.operationId) {
      if(q("chat-turns").querySelector('[data-phi-operation="'+CSS.escape(item.operationId)+'"]')) {
        enrichHistoryOutcomes().catch(()=>{});
      }
    }
  });
  stream.addEventListener("duet.reset",()=>location.reload());
  stream.onerror=()=>{ if(eventStream===stream) setConn("reconnecting"); setTimeout(()=>{ if (eventStream === stream) { stream.close(); eventStream=null; connectEvents(); } },2000); };
}
await authenticate();
renderChatShell();
try{const h=await api("/health");q("health").textContent="healthy - "+h.instanceId;q("health").className="pill ok";await loadRuns({selectCurrent:true});if(!selected){connectEvents();await loadChat();}}
catch(error){q("health").textContent=error.message;q("health").className="pill bad"}
`;
