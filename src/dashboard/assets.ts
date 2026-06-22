export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
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
    <aside>
      <div class="aside-rail">
        <button class="aside-rail-btn rail-top" id="sidebar-toggle" title="Expand sidebar">&#9654;</button>
        <button class="aside-rail-btn" data-section="runs" title="Runs">&#9776;</button>
        <button class="aside-rail-btn" data-section="tasks" title="Tasks">&#10003;</button>
        <button class="aside-rail-btn" data-section="timeline" title="Timeline">&#9711;</button>
        <button class="aside-rail-btn" data-section="verification" title="Verification">&#9881;</button>
        <button class="aside-rail-btn" data-section="messages" title="Plan">&#9999;</button>
        <button class="aside-rail-btn" data-section="artifacts" title="Artifacts">&#9671;</button>
        <button class="aside-rail-btn" data-section="conflicts" title="Conflicts">&#9651;</button>
        <button class="aside-rail-btn" data-section="diff" title="Diff">&#177;</button>
      </div>
      <div class="aside-inner">
        <div id="summary"><p class="muted aside-hint">Select a run.</p></div>
        <div class="aside-section" id="aside-sec-runs">
          <div class="aside-sec-head"><span class="aside-dot"></span><h2>Runs</h2></div>
          <div id="runs"></div>
        </div>
        <div class="aside-section" id="aside-sec-tasks">
          <div class="aside-sec-head"><h2>Tasks</h2></div>
          <div id="tasks"></div>
        </div>
        <div class="aside-section" id="aside-sec-timeline">
          <div class="aside-sec-head"><h2>Timeline</h2></div>
          <div id="timeline-active"></div>
          <div id="events"></div>
        </div>
        <div class="aside-section" id="aside-sec-verification">
          <div class="aside-sec-head"><h2>Verification</h2></div>
          <div id="verification"></div>
        </div>
        <div class="aside-section" id="aside-sec-messages">
          <div class="aside-sec-head"><h2>Plan</h2></div>
          <div id="messages"></div>
        </div>
        <div class="aside-section" id="aside-sec-artifacts">
          <div class="aside-sec-head"><h2>Artifacts</h2></div>
          <div id="artifacts"></div>
        </div>
        <div class="aside-section" id="aside-sec-conflicts">
          <div class="aside-sec-head"><h2>Conflicts</h2></div>
          <div id="conflicts"></div>
        </div>
        <div class="aside-section" id="aside-sec-diff">
          <div class="aside-sec-head"><h2>Diff</h2></div>
          <pre id="diff"></pre>
        </div>
      </div>
    </aside>
    <section>
      <div class="chat-resize-handle" id="chat-resize-handle"></div>
      <div id="chat" class="chat card">
        <div class="chat-head">
          <div>
            <div class="chat-title"><b>Manager</b><span id="chat-conn" class="conn" title="Live updates">connecting</span></div>
          </div>
          <div class="chat-tools">
            <div class="chat-agents" role="group" aria-label="Manager voice">
              <button id="chat-codex" type="button" data-agent="codex">Codex</button>
              <button id="chat-claude" type="button" data-agent="claude">Claude</button>
              <button id="chat-openai" type="button" data-agent="openai">OpenAI</button>
            </div>
            <button id="chat-clear" type="button" class="chat-clear" title="Start a fresh manager thread for the current run and voice">Clear context</button>
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
main{display:grid;grid-template-columns:300px 1fr;height:calc(100vh - 56px);overflow:hidden;transition:grid-template-columns .2s}
aside{display:flex;flex-direction:row;border-right:1px solid var(--line);background:var(--surface);overflow:hidden}
.aside-rail{width:48px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;padding:6px 0;gap:2px;border-right:1px solid var(--line)}
.aside-rail-btn{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:8px;border:none;background:transparent;color:var(--faint);cursor:pointer;padding:0;margin:0;font-size:15px;transition:background .12s,color .12s}
.aside-rail-btn:hover{background:var(--line);color:var(--text)}
.aside-rail-btn.active{background:var(--acc-bg);color:var(--accent)}
.aside-rail-btn.rail-top{border-radius:6px;margin-bottom:6px}
.aside-inner{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
#summary{padding:10px 14px 0;flex-shrink:0}
.aside-hint{font-size:12px;margin:0;color:var(--faint)}
.aside-section{display:none;flex:1;flex-direction:column;overflow:hidden}
.aside-section.active{display:flex}
.aside-sec-head{display:flex;align-items:center;gap:8px;padding:12px 14px 8px;border-bottom:1px solid var(--line);flex-shrink:0}
.aside-sec-head h2{margin:0}
.aside-dot{width:7px;height:7px;border-radius:50%;background:var(--accent);flex-shrink:0}
.aside-section>div:last-child,.aside-section>pre{flex:1;overflow-y:auto;padding:10px 14px}
main.sidebar-collapsed{grid-template-columns:48px 1fr}
main.sidebar-collapsed .aside-inner{display:none}
section{display:flex;flex-direction:column;height:100%;overflow:hidden;padding:12px 20px 16px}
.chat-resize-handle{height:4px;background:var(--line);cursor:ns-resize;flex-shrink:0;border-radius:2px;margin:0 0 10px;transition:background .15s}
.chat-resize-handle:hover{background:var(--accent)}
#chat{flex:1;display:flex;flex-direction:column;overflow:hidden;margin:0}
#summary{margin-bottom:4px}
#summary h2{font-size:16px;text-transform:none;letter-spacing:0;color:var(--text);margin-bottom:10px}
.timeline-details>summary{display:flex;align-items:center;gap:8px;cursor:pointer;list-style:none;margin-bottom:6px}
.timeline-details>summary::-webkit-details-marker{display:none}
.timeline-details>summary h2{margin:0;pointer-events:none}
.timeline-details>summary::after{content:"▸";font-size:10px;color:var(--faint);transition:transform .15s}
.timeline-details[open]>summary::after{transform:rotate(90deg)}
#timeline-active{font-size:13px;padding:0 0 8px;border-bottom:1px solid var(--line-2);margin-bottom:6px}
#timeline-active:empty{display:none}
.tl-row{display:flex;align-items:center;gap:6px;line-height:1.4}
.tl-dot{font-size:15px;flex-shrink:0}
.tl-dot.active{color:var(--accent);animation:tl-pulse 1.4s ease-in-out infinite}
.tl-dot.done{color:var(--ok)}
.tl-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tl-elapsed{color:var(--faint);font-variant-numeric:tabular-nums;flex-shrink:0}
@keyframes tl-pulse{0%,100%{opacity:1}50%{opacity:.3}}
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
.run-row{position:relative;margin:0 0 6px}.run-btn{display:flex;flex-direction:column;gap:5px;padding:10px 32px 10px 11px;margin:0;text-align:left;width:100%}.run-delete-btn{position:absolute;top:6px;right:6px;background:none;border:none;cursor:pointer;color:var(--muted);font-size:11px;line-height:1;padding:2px 5px;border-radius:3px;opacity:.6}.run-delete-btn:hover{opacity:1;color:#e53e3e;background:var(--hover)}
.run-goal{font-size:13px;font-weight:500;color:var(--text);line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.run-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.run-id{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--faint)}
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
.conn-muted{color:var(--muted);border-color:var(--line);background:var(--hover)}
.error-banner{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#c53030;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;z-index:9999;max-width:480px;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.25)}
.chat-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
#chat-status{display:none}
.chat-head p{margin:3px 0 0}
.chat-tools{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0}
.chat-clear{width:auto;margin:0;padding:4px 12px;border-radius:999px;border:1px solid var(--line-2);background:var(--surface-2);color:var(--muted);font-size:12px;font-weight:500;text-align:center}
.chat-clear:hover:not(:disabled){background:var(--line);color:var(--text);border-color:var(--line-2)}
/* ── provider segmented toggle ── */
.chat-agents{display:inline-flex;background:var(--surface-2);border:1px solid var(--line);border-radius:999px;padding:3px;gap:2px;flex-shrink:0}
.chat-agents button{width:auto;margin:0;padding:4px 13px;border-radius:999px;border:1px solid transparent;background:transparent;font-size:12px;font-weight:500;color:var(--muted);text-align:center;transition:background .12s,color .12s,border-color .12s}
.chat-agents button:hover:not(:disabled){background:var(--line);color:var(--text);border-color:transparent}
.chat-agents button.active{background:var(--accent);color:#fff;border-color:transparent}
/* ── bubble turn list ── */
.chat-turns{display:flex;flex-direction:column;gap:8px;flex:1;overflow-y:auto;padding:4px 2px;min-height:60px}
.chat-turn{max-width:88%}
.chat-turn.user{background:var(--acc-bg);border:1px solid var(--acc-bd);border-radius:14px 14px 4px 14px;padding:9px 13px;align-self:flex-end}
.chat-turn.manager{align-self:flex-start;max-width:96%;padding:4px 0}
.chat-turn.failed{background:var(--bad-bg);border:1px solid var(--bad-bd);border-radius:10px;padding:9px 13px}
.manager-avatar{display:none}
.turn-content{flex:1;min-width:0}
.chat-turn .meta{display:flex;align-items:center;gap:8px;margin-bottom:6px;color:var(--faint);font-size:11px;flex-wrap:wrap}
.chat-turn .meta time,.chat-turn .meta .when{color:var(--faint);font:11px ui-monospace,SFMono-Regular,Menlo,monospace}
.chat-turn .note{color:var(--faint);font-size:12px;margin-bottom:4px}
.chat-turn .body{overflow-wrap:anywhere;font-size:13px;line-height:1.65}
.chat-turn .body p{margin:0 0 8px}.chat-turn .body p:last-child{margin:0}
.chat-turn .body h1,.chat-turn .body h2,.chat-turn .body h3{font-size:13px;font-weight:600;text-transform:none;letter-spacing:0;color:var(--text);margin:10px 0 4px}
.chat-turn .body ul,.chat-turn .body ol{margin:4px 0 8px 18px;padding:0}
.chat-turn .body li{margin:2px 0}
.chat-turn .body code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--surface-2);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
.chat-turn .body pre{margin:6px 0;padding:10px 12px;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;overflow-x:auto}
.chat-turn .body pre code{background:none;border:none;padding:0}
.chat-turn .body hr{border:none;border-top:1px solid var(--line);margin:10px 0}
.chat-turn .body strong{font-weight:600;color:var(--text)}
.chat-turn .body em{font-style:italic;color:var(--muted)}
.turn-copy-row{display:flex;justify-content:flex-end;margin-top:4px}.chat-turn.user .turn-copy-row{justify-content:flex-end}.chat-turn.manager .turn-copy-row{justify-content:flex-start}
.turn-copy-btn{background:none;border:none;padding:3px 5px;border-radius:5px;cursor:pointer;color:var(--faint);display:flex;align-items:center;gap:4px;font-size:11px;transition:color .12s,background .12s;width:auto;margin:0}
.turn-copy-btn:hover{color:var(--accent);background:var(--acc-bg)}
.turn-copy-btn svg{flex-shrink:0}
/* ── plan card ── */
.plan-card{padding:10px 14px;display:flex;flex-direction:column;gap:8px;overflow-y:auto}
.plan-summary{font-size:13px;line-height:1.6;color:var(--text);padding-bottom:8px;border-bottom:1px solid var(--line)}
.plan-section-head{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--accent);margin-top:6px}
.plan-task{padding:8px 0;border-bottom:1px solid var(--line)}
.plan-task:last-of-type{border-bottom:none}
.plan-task-title{font-size:13px;font-weight:600;color:var(--text);margin-bottom:3px}
.plan-risk{font-size:12px;padding:4px 0;border-bottom:1px solid var(--line)}
.plan-risk:last-child{border-bottom:none}
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
.proposal-history summary{cursor:pointer;font-size:12px;color:var(--muted);user-select:none;list-style:none;display:flex;align-items:center;gap:6px}.proposal-history summary::before{content:"\\25B8";font-size:10px;transition:transform .15s}.proposal-history[open] summary::before{transform:rotate(90deg)}
.proposal-history summary::-webkit-details-marker{display:none}
.proposal-history-item{display:flex;align-items:baseline;gap:8px;padding:5px 0;border-bottom:1px solid var(--line);font-size:12px}
.proposal-history-item:last-child{border-bottom:none}
.proposal-history-item .phi-action{font-weight:600}
.proposal-history-item .phi-op{color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.chat-form{display:grid;grid-template-columns:1fr 96px;gap:8px;align-items:stretch}
.chat-form textarea{resize:vertical;min-height:74px;color:var(--text);background:#0e1217;border:1px solid var(--line-2);border-radius:9px;padding:10px 12px;font:inherit}
.chat-form textarea:focus{outline:none;border-color:var(--accent)}
.chat-form button{margin:0;text-align:center}
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
.phi-op.ok{color:var(--ok)}
.phi-op.bad{color:var(--bad)}
/* ── pill chat input ── */
.chat-form{display:flex;align-items:flex-end;gap:8px;background:var(--surface-2);border:1px solid var(--line-2);border-radius:24px;padding:6px 6px 6px 14px;transition:border-color .15s}
.chat-form:focus-within{border-color:var(--accent)}
.chat-form textarea{flex:1;resize:none;min-height:24px;max-height:160px;overflow-y:auto;border:none;background:transparent;color:var(--text);padding:4px 0;font:inherit;line-height:1.5;outline:none}
.chat-form textarea::placeholder{color:var(--faint)}
#chat-send{width:34px;height:34px;border-radius:50%;background:var(--accent);border:none;color:#fff;display:flex;align-items:center;justify-content:center;margin:0;flex-shrink:0;padding:0;cursor:pointer;transition:opacity .12s}
#chat-send:disabled{opacity:.4;cursor:not-allowed}
#chat-send:not(:disabled):hover{opacity:.82}
#chat-send svg{pointer-events:none}
/* ── responsive: phone (bottom tab bar + section drawer, chat as home) ── */
@media(max-width:760px){
  header{padding:10px 14px}
  .brand .sub{display:none}
  main{display:flex;flex-direction:column;height:calc(100dvh - 53px)}
  aside{flex:none}
  /* icon rail becomes a fixed bottom tab bar */
  .aside-rail{position:fixed;left:0;right:0;bottom:0;z-index:60;width:auto;height:calc(56px + env(safe-area-inset-bottom,0px));flex-direction:row;justify-content:space-around;align-items:flex-start;gap:2px;padding:4px 4px env(safe-area-inset-bottom,0px);border-right:0;border-top:1px solid var(--line);background:var(--surface);box-shadow:0 -2px 12px rgba(0,0,0,.18)}
  .aside-rail-btn{width:44px;height:44px;font-size:18px;border-radius:10px}
  .aside-rail-btn.rail-top{display:none}
  /* section list becomes a drawer between header and tab bar */
  .aside-inner{position:fixed;left:0;right:0;top:53px;bottom:56px;z-index:55;background:var(--bg);display:none;border-bottom:0}
  main:not(.sidebar-collapsed) .aside-inner{display:flex}
  main.sidebar-collapsed{grid-template-columns:1fr}
  #summary{display:none}
  .aside-sec-head{padding:14px 16px 10px}
  .aside-section>div:last-child,.aside-section>pre{padding:12px 16px}
  /* chat fills the screen and clears the bottom tab bar */
  section{padding:10px 0 calc(66px + env(safe-area-inset-bottom,0px));flex:1;min-height:0}
  .chat-resize-handle{display:none}
  #chat{border:0;padding:0}
  .chat-head{flex-direction:row;align-items:center;gap:6px}
  .chat-head>div:first-child{display:none}
  #chat-status{display:none}
  .chat-tools{flex-direction:row;align-items:center;justify-content:space-between;gap:10px;width:100%}
  .chat-agents{flex:1;justify-content:space-between}
  .chat-agents button{flex:1}
  .chat-clear{width:auto;flex-shrink:0}
  .chat-turn{max-width:92%}
  .chat-turn.manager{max-width:100%;padding:4px 14px}
  #chat-input{font-size:16px}
  /* larger touch targets in the run list */
  .run-btn{padding:13px 36px 13px 13px}
  .run-delete-btn{padding:6px 9px;font-size:13px;opacity:.8}
  /* approval modal stays usable at phone width */
  .modal{width:min(600px,94vw);padding:16px;max-height:88vh}
  .proposal-confirm{grid-template-columns:1fr}
  .proposal-confirm button{width:100%}
}
`;

export const dashboardJs = `
(function(){var t=localStorage.getItem("duet-theme")||"dark";document.documentElement.setAttribute("data-theme",t)})();
const q = (id) => document.getElementById(id);
const DASHBOARD_ACCESS_KEY = "duet-dashboard-access";
const DEFAULT_MANAGER_PROVIDER = "__DUET_DEFAULT_MANAGER_PROVIDER__";
let selected = new URL(location.href).searchParams.get("run");
const chat = {
  agent: DEFAULT_MANAGER_PROVIDER,
  conversations: new Map(),
  activeOperation: null,
  polling: null,
  pendingTurn: null
};
let eventStream = null;
let eventRunId = null;
let eventCursor = 0;
const renderedEventSeqs = new Set();
let activeAttempt = null; // { provider, role, taskId, taskOrdinal, startedAt }
let activeTimer = null;
let runTasks = []; // task list from last selectRun
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
  const hash = location.hash.slice(1);
  let body = null;
  let persistentAccess = false;
  if (hash.startsWith("access=")) {
    body = { accessToken: decodeURIComponent(hash.slice("access=".length)) };
    persistentAccess = true;
    localStorage.setItem(DASHBOARD_ACCESS_KEY, body.accessToken);
  } else if (hash) {
    body = { ticket: hash };
  } else {
    const savedAccessToken = localStorage.getItem(DASHBOARD_ACCESS_KEY);
    if (savedAccessToken) {
      body = { accessToken: savedAccessToken };
      persistentAccess = true;
    }
  }
  if (!body) return;
  const response = await fetch("/dashboard/session", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  if (!response.ok) {
    if (persistentAccess) localStorage.removeItem(DASHBOARD_ACCESS_KEY);
    throw new Error("Dashboard access is invalid or expired.");
  }
  if (!persistentAccess) history.replaceState(null,"",location.pathname+location.search);
}
async function loadRuns(options = {}) {
  const runs=await api("/runs");
  const deletable = new Set(["failed","cancelled","merged","cleaned_up"]);
  q("runs").innerHTML=runs.map(r=>{
    const del=deletable.has(r.status)?'<button class="run-delete-btn" data-delete-run="'+esc(r.id)+'" title="Delete run" aria-label="Delete">&#10005;</button>':"";
    return '<div class="run-row"><button data-id="'+esc(r.id)+'" class="run-btn'+(r.id===selected?" sel":"")+'"><span class="run-goal">'+esc(r.goal)+'</span><span class="run-meta">'+badge(r.status)+'<span class="run-id">'+esc(r.id.slice(0,8))+'</span></span></button>'+del+'</div>';
  }).join("")||'<span class="empty">No runs yet.</span>';
  q("runs").querySelectorAll(".run-btn").forEach(b=>b.onclick=()=>selectRun(b.dataset.id));
  q("runs").querySelectorAll("[data-delete-run]").forEach(b=>b.onclick=async(e)=>{
    e.stopPropagation();
    if(!confirm("Delete this run? This cannot be undone."))return;
    try{
      await api("/runs/"+encodeURIComponent(b.dataset.deleteRun),{method:"DELETE"});
      if(selected===b.dataset.deleteRun){selected=null;}
      await loadRuns();
    }catch(err){showError(err.message);}
  });
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
    clearActiveRow();
  }
  q("runs").querySelectorAll("button").forEach(b=>b.classList.toggle("sel",b.dataset.id===id));
  const detail=await api("/runs/"+encodeURIComponent(id));
  runTasks = detail.tasks || [];
  q("summary").innerHTML='<h2>'+esc(detail.run.goal)+'</h2><div class="card"><div class="row">'+badge(detail.run.status)+'<span class="kv">lead <b>'+esc(detail.run.leadProvider)+'</b></span><span class="kv">'+detail.usage.totalTurns+' turns</span></div></div>';
  q("tasks").innerHTML=runTasks.map(t=>'<div class="card"><div class="row"><b>'+esc(t.plan.title)+'</b>'+badge(t.status)+'</div><div class="kv">'+esc(t.provider)+' -> '+esc(t.reviewerProvider)+'</div><div class="muted">'+esc(t.plan.allowedPaths.join(", "))+'</div></div>').join("")||'<span class="empty">No tasks.</span>';
  const [verification,messages,artifacts,conflicts]=await Promise.all([
    api("/runs/"+encodeURIComponent(id)+"/verification"),
    api("/runs/"+encodeURIComponent(id)+"/messages"),
    api("/runs/"+encodeURIComponent(id)+"/artifacts"),
    api("/runs/"+encodeURIComponent(id)+"/conflicts")
  ]);
  q("verification").innerHTML=verification.map(v=>'<div class="vr '+(v.passed?"pass":"fail")+'"><span class="tag">'+(v.passed?"PASS":"FAIL")+'</span><span>'+esc(v.command.join(" "))+'</span><span class="muted">'+v.durationMs+'ms</span></div>').join("")||'<span class="empty">No verification results.</span>';
  q("messages").innerHTML=messages.map(m=>{
    if(m.kind==="plan"){
      let plan={summary:"",tasks:[],risks:[]};
      try{plan=JSON.parse(m.body);}catch{}
      const taskList=plan.tasks.map(t=>'<div class="plan-task"><div class="plan-task-title">'+esc(t.title)+'</div><div class="muted">'+esc(t.objective||"")+'</div></div>').join("");
      const riskList=plan.risks&&plan.risks.length?'<div class="plan-section-head">Risks</div>'+plan.risks.map(r=>'<div class="plan-risk muted">'+esc(r)+'</div>').join(""):"";
      return '<div class="plan-card"><div class="plan-summary">'+esc(plan.summary)+'</div><div class="plan-section-head">Tasks</div>'+taskList+riskList+'</div>';
    }
    return '<div class="card"><b>'+esc(m.kind)+'</b><div class="muted">'+visibleText(m.body,1000)+'</div></div>';
  }).join("")||'<span class="empty">No plan yet.</span>';
  q("artifacts").innerHTML=artifacts.map(a=>'<div class="card"><span class="muted">#'+a.id+'</span> '+esc(a.kind)+' <span class="muted">- '+esc(a.taskId||"run")+'</span></div>').join("")||'<span class="empty">No artifacts.</span>';
  q("conflicts").innerHTML=conflicts.map(t=>'<div class="card"><div class="row"><b>'+esc(t.id)+'</b><span class="badge s-conflict">conflict</span></div><div class="bad">'+esc(t.error||"integration conflict")+'</div></div>').join("")||'<span class="empty">No conflicts.</span>';
  q("diff").textContent=(await api("/runs/"+encodeURIComponent(id)+"/diff")).diff||"";
  await loadChat();
  const terminalStatuses = new Set(["failed","cancelled","merged","cleaned_up"]);
  if (terminalStatuses.has(detail.run.status)) {
    if (eventStream) { eventStream.close(); eventStream=null; }
    setConn("idle");
    q("events").innerHTML='<div class="ev ev-info"><span class="ty muted">Run is '+esc(detail.run.status)+' — no live events</span></div>';
  } else {
    connectEvents();
  }
}
function conversationKey(runId, agent) {
  return (runId || "global") + ":" + agent;
}
function currentConversation() {
  return chat.conversations.get(conversationKey(selected, chat.agent)) || null;
}
function pendingMatchesCurrentView() {
  return Boolean(
    chat.pendingTurn &&
    chat.pendingTurn.agent === chat.agent &&
    ((chat.pendingTurn.runId || null) === (selected || null))
  );
}
function renderPendingTurn() {
  if (!pendingMatchesCurrentView()) return "";
  const pending = chat.pendingTurn;
  const ts = pending.createdAt
    ? '<span class="when">'+esc(new Date(pending.createdAt).toLocaleTimeString())+'</span>'
    : "";
  return '<div class="chat-turn user"><div class="turn-content">'
    +'<div class="meta"><b>You</b>'+badge("pending")+'<span>#…</span>'+ts+'</div>'
    +'<div class="body">'+visibleText(pending.content, 4000)+'</div>'
    +'</div></div>';
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
  q("chat-turns").innerHTML = '<span class="empty">Loading '+esc(chat.agent)+' manager conversation&#x2026;</span>';
  setChatEnabled(false);
  try {
    const params = selected ? "?runId="+encodeURIComponent(selected) : "";
    const conversations = await api("/chat/conversations"+params);
    for (const item of conversations) {
      if (!selected && item.runId) continue;
      rememberConversation(item);
    }
    const conversation = currentConversation();
    if (!conversation) {
      const scope = selected ? esc(chat.agent)+" manager" : "global";
      q("chat-turns").innerHTML=(renderPendingTurn() || '<span class="empty">No '+scope+' conversation yet. Send a message to start one.</span>');
      setChatEnabled(!chatIsBusyForCurrentView());
      return;
    }
    await refreshConversation(conversation.id);
  } catch(error) {
    showError(error.message);
    setChatEnabled(!chatIsBusyForCurrentView());
  }
}
async function clearChatContext() {
  if (chatIsBusyForCurrentView()) return;
  const body = {
    interfaceAgent: chat.agent,
    title: selected ? "Dashboard manager chat" : "Global manager chat",
  };
  if (selected) body.runId = selected;
  setChatEnabled(false);
  setChatStatus("Clearing context...");
  try {
    const conversation = await api("/chat/conversations", {
      method: "POST",
      idempotencyKey: requestKey("dashboard-chat-clear"),
      body,
    });
    rememberConversation(conversation);
    chat.pendingTurn = null;
    await refreshConversation(conversation.id);
    setChatStatus("Context cleared. Ready. Manager voice: "+chat.agent+".");
    if (currentConversation()?.id === conversation.id && selected === conversation.runId) {
      q("chat-turns").scrollTop = q("chat-turns").scrollHeight;
    }
  } catch (error) {
    setChatStatus(error.message, true);
  } finally {
    setChatEnabled(!chatIsBusyForCurrentView());
  }
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
  q("chat-clear").disabled = !enabled;
}
function showError(message) {
  let banner = document.getElementById("error-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "error-banner";
    banner.className = "error-banner";
    document.body.appendChild(banner);
  }
  banner.textContent = message;
  banner.hidden = false;
  clearTimeout(banner._t);
  banner._t = setTimeout(() => { banner.hidden = true; }, 6000);
}
function setConn(state) {
  const el = q("chat-conn");
  if (!el) return;
  if (state === "live") { el.textContent = "live"; el.className = "conn conn-ok"; }
  else if (state === "reconnecting") { el.textContent = "reconnecting"; el.className = "conn conn-bad"; }
  else if (state === "idle") { el.textContent = "idle"; el.className = "conn conn-muted"; }
  else { el.textContent = "connecting"; el.className = "conn"; }
}
function renderMarkdown(text) {
  const lines = String(text).split("\\n");
  let html = "", inCode = false, codeLang = "", codeBuf = [], inList = null;
  function flushList() { if(inList){html+="</"+inList+">";inList=null;} }
  function inlineFormat(s) {
    return s
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/\`([^\`]+)\`/g,'<code>$1</code>')
      .replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>')
      .replace(/__([^_]+)__/g,'<strong>$1</strong>')
      .replace(/\\*([^*]+)\\*/g,'<em>$1</em>')
      .replace(/_([^_]+)_/g,'<em>$1</em>');
  }
  for (let i=0;i<lines.length;i++) {
    const line=lines[i];
    if (!inCode && line.startsWith("\`\`\`")) {
      flushList(); inCode=true; codeLang=line.slice(3).trim(); codeBuf=[]; continue;
    }
    if (inCode) {
      if (line.startsWith("\`\`\`")) {
        html+='<pre><code>'+(codeBuf.map(l=>l.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")).join("\\n"))+'</code></pre>';
        inCode=false; codeBuf=[]; codeLang="";
      } else { codeBuf.push(line); }
      continue;
    }
    if (/^#{1,3}\s/.test(line)) { flushList(); const lvl=line.match(/^(#{1,3})/)[1].length; html+='<h'+lvl+'>'+inlineFormat(line.replace(/^#{1,3}\s/,""))+'</h'+lvl+'>'; continue; }
    if (/^[-*]\s/.test(line)) { if(inList!=="ul"){flushList();html+="<ul>";inList="ul";} html+='<li>'+inlineFormat(line.slice(2))+'</li>'; continue; }
    if (/^\d+\.\s/.test(line)) { if(inList!=="ol"){flushList();html+="<ol>";inList="ol";} html+='<li>'+inlineFormat(line.replace(/^\d+\.\s/,""))+'</li>'; continue; }
    if (/^---+$/.test(line.trim())) { flushList(); html+='<hr>'; continue; }
    flushList();
    if (line.trim()==="") { html+='<p></p>'; } else { html+='<p>'+inlineFormat(line)+'</p>'; }
  }
  if (inCode && codeBuf.length) html+='<pre><code>'+(codeBuf.map(l=>l.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")).join("\\n"))+'</code></pre>';
  flushList();
  return html;
}
function renderTurns(turns, proposals = [], proposalHistory = []) {
  if (!turns.length) {
    q("chat-turns").innerHTML=renderPendingTurn() || '<span class="empty">No turns yet.</span>';
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
      body = turn.role === "manager"
        ? renderMarkdown(turn.content || "")
        : visibleText(turn.content, 4000);
    }
    const when = turn.createdAt ? new Date(turn.createdAt) : null;
    const ts = when && !isNaN(when.getTime()) ? '<span class="when">'+esc(when.toLocaleTimeString())+'</span>' : "";
    const cards = (proposalsByTurn.get(turn.id) || []).map(renderProposalCard).join("");
    const meta = '<div class="meta"><b>'+esc(who)+'</b>'+badge(turn.status)+'<span>#'+esc(turn.seq)+'</span>'+ts+'</div>';
    const copyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const copyBtn = '<div class="turn-copy-row"><button class="turn-copy-btn" data-turn-copy="'+esc(turn.content||'')+'">'+copyIcon+'</button></div>';
    const inner = meta+note+'<div class="body">'+body+'</div>'+(!failed ? copyBtn : '')+cards;
    if (turn.role === "manager") {
      return '<div class="chat-turn manager'+(failed?" failed":"")+'"><div class="manager-avatar"></div><div class="turn-content">'+inner+'</div></div>';
    }
    return '<div class="chat-turn '+esc(turn.role)+(failed?" failed":"")+'">'+inner+'</div>';
  }).join("");
  q("chat-turns").innerHTML = turnsHtml + renderPendingTurn() + renderProposalHistory(proposalHistory);
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
  if (proposal.action === "set_strategy") {
    let meta = {};
    try { meta = JSON.parse(proposal.commandJson); } catch {}
    return '<div class="proposal-card" data-proposal-id="'+esc(proposal.id)+'" data-command="'+esc(proposal.commandCli)+'">'
      +'<div class="proposal-title">Suggested action&nbsp;'+badge("set strategy")+badge("ordinary")+'</div>'
      +'<div class="muted">'+visibleText(proposal.summary, 600)+'</div>'
      +'<div class="proposal-kv"><b>Lead:</b> '+esc(meta.lead||"claude")+'&nbsp;&nbsp;<b>Profile:</b> '+esc(meta.profile||"balanced")+'</div>'
      +'<div class="proposal-copy">Approve to store this as the preferred strategy for the next run. No terminal command needed.</div>'
      +'<div class="proposal-confirm"><input type="text" autocomplete="off" placeholder="Type start" aria-label="Type start to confirm" data-proposal-start-input="'+esc(proposal.id)+'"><button type="button" disabled data-proposal-start="'+esc(proposal.id)+'" data-run-version="" data-task-version="">Start operation</button></div>'
      +'<div class="proposal-actions"><button type="button" data-proposal-dismiss="'+esc(proposal.id)+'">Dismiss</button></div>'
      +'</div>';
  }
  if (proposal.action === "create_plan") {
    let meta = {};
    try { meta = JSON.parse(proposal.commandJson); } catch {}
    return '<div class="proposal-card" data-proposal-id="'+esc(proposal.id)+'" data-command="'+esc(proposal.commandCli)+'">'
      +'<div class="proposal-title">Suggested action&nbsp;'+badge("create plan")+badge("ordinary")+'</div>'
      +'<div class="muted">'+visibleText(proposal.summary, 600)+'</div>'
      +'<div class="proposal-kv"><b>Goal:</b> '+visibleText(meta.goal||"", 300)+'</div>'
      +'<div class="proposal-kv"><b>Repo:</b> '+esc(meta.repoPath||"")+'</div>'
      +'<div class="proposal-kv"><b>Lead:</b> '+esc(meta.lead||"claude")+'&nbsp;&nbsp;<b>Profile:</b> '+esc(meta.profile||"balanced")+'</div>'
      +'<div class="proposal-copy">Run this in your terminal, or check readiness to reveal Start.</div>'
      +'<code>'+visibleText(proposal.commandCli, 1000)+'</code>'
      +'<div class="proposal-readiness" data-proposal-readiness="'+esc(proposal.id)+'"></div>'
      +'<div class="proposal-actions"><button type="button" data-proposal-prepare="'+esc(proposal.id)+'">Check readiness</button><button type="button" data-proposal-copy="'+esc(proposal.id)+'">Copy CLI</button><button type="button" data-proposal-dismiss="'+esc(proposal.id)+'">Dismiss</button></div>'
      +'</div>';
  }
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
  try {
    const completedOp = await api("/operations/"+encodeURIComponent(operation.id));
    if (completedOp.status === "succeeded" && completedOp.resultJson) {
      const result = JSON.parse(completedOp.resultJson);
      if (result && result.id) {
        const msgs = await api("/runs/"+encodeURIComponent(result.id)+"/messages");
        const planMsg = (msgs.value || msgs).find(m => m.kind === "plan");
        if (planMsg) {
          const card = q("chat-turns").querySelector('[data-proposal-id="'+CSS.escape(proposalId)+'"]');
          if (card) {
            let plan = { summary: "", tasks: [], risks: [] };
            try { plan = JSON.parse(planMsg.body); } catch {}
            const taskList = plan.tasks.map(t =>
              '<div class="plan-task"><div class="plan-task-title">'+esc(t.title)+'</div><div class="muted" style="font-size:12px">'+esc(t.objective||"")+'</div></div>'
            ).join("");
            const riskList = plan.risks && plan.risks.length
              ? '<div class="plan-section-head" style="margin-top:10px">Risks</div>'+plan.risks.map(r=>'<div class="plan-risk muted">'+esc(r)+'</div>').join("")
              : "";
            const bubble = document.createElement("div");
            bubble.className = "chat-turn manager";
            bubble.innerHTML = '<div class="turn-content"><div class="meta"><b>Plan</b>'+badge("ready")+'</div><div class="body"><div class="plan-card" style="padding:0"><div class="plan-summary">'+esc(plan.summary)+'</div><div class="plan-section-head">Tasks</div>'+taskList+riskList+'</div></div></div>';
            card.after(bubble);
          }
        }
      }
    }
  } catch {}
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
      ? '<div><span class="muted">branch</span> '+esc(preview.run.baseBranch||"—")+'  <span class="muted">base</span> '+esc((preview.run.baseCommit||"").slice(0,12)+'…')+'</div>'
      : '<div><span class="muted">integration</span> '+esc(preview.run.integrationBranch||"—")+'  <span class="muted">commit</span> '+esc((preview.run.finalCommit||"").slice(0,12)+'…')+'</div>';
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
  err.style.display = "none";
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
  const turnCopy = event.target.closest("[data-turn-copy]");
  if (!prepare && !start && !copy && !dismiss && !approve && !turnCopy) return;
  try {
    if (turnCopy) {
      await copyText(turnCopy.dataset.turnCopy || "");
      const svg = turnCopy.querySelector("svg");
      if (svg) { turnCopy.textContent="copied"; setTimeout(()=>{ turnCopy.innerHTML=""; turnCopy.appendChild(svg); },1200); }
      return;
    }
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
        chat.pendingTurn = null;
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
    chat.pendingTurn = null;
    if (chat.activeOperation?.id === operationId) chat.activeOperation = null;
    setChatEnabled(!chatIsBusyForCurrentView());
  }
}
async function sendChat(message) {
  const conversation = await ensureConversation();
  const operation = await api("/chat/conversations/"+encodeURIComponent(conversation.id)+"/turns", {
    method: "POST",
    idempotencyKey: requestKey("dashboard-chat-turn"),
    body: { message }
  });
  chat.pendingTurn = null;
  await refreshConversation(conversation.id);
  await pollOperation(operation.id, conversation.id);
}
q("chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = q("chat-input").value.trim();
  if (!text || chatIsBusyForCurrentView()) return;
  const original = q("chat-input").value;
  chat.pendingTurn = {
    agent: chat.agent,
    runId: selected || null,
    content: text,
    createdAt: new Date().toISOString()
  };
  q("chat-input").value = "";
  q("chat-input").style.height = "auto";
  setChatEnabled(false);
  setChatStatus("Sending...");
  if (currentConversation()) {
    const historyEl = q("chat-turns").querySelector(".proposal-history");
    if (historyEl) {
      historyEl.insertAdjacentHTML("beforebegin", renderPendingTurn());
    } else {
      q("chat-turns").insertAdjacentHTML("beforeend", renderPendingTurn());
    }
    q("chat-turns").scrollTop = q("chat-turns").scrollHeight;
  } else {
    q("chat-turns").innerHTML = renderPendingTurn();
  }
  try {
    await sendChat(text);
  } catch (error) {
    chat.pendingTurn = null;
    q("chat-input").value = original;
    q("chat-input").style.height = "auto";
    q("chat-input").style.height = Math.min(q("chat-input").scrollHeight, 160) + "px";
    setChatStatus(error.message, true);
    setChatEnabled(!chatIsBusyForCurrentView());
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
q("chat-clear").onclick = async () => {
  await clearChatContext().catch(error => showError(error.message));
};
/* ── theme toggle ── */
(function() {
  const saved = localStorage.getItem("duet-theme") || "light";
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
function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return m > 0 ? m + "m " + ss + "s" : ss + "s";
}
function renderActiveRow() {
  const el = q("timeline-active");
  if (!el || !activeAttempt) return;
  const elapsed = fmtElapsed(Date.now() - activeAttempt.startedAt);
  const ordinal = activeAttempt.taskOrdinal != null ? " task " + activeAttempt.taskOrdinal + " of " + runTasks.length : "";
  el.innerHTML = '<div class="tl-row"><span class="tl-dot active">&#9679;</span><span class="tl-label">' + esc(activeAttempt.provider) + " &mdash; " + esc(activeAttempt.role) + ordinal + '</span><span class="tl-elapsed">' + elapsed + "</span></div>";
}
function clearActiveRow() {
  if (activeTimer) { clearInterval(activeTimer); activeTimer = null; }
  activeAttempt = null;
  const el = q("timeline-active");
  if (el) el.innerHTML = "";
}
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
    const TERMINAL = new Set(["failed","cancelled","merged","cleaned_up"]);
    if(item.type==="provider.attempt_started" && item.payload) {
      if(activeTimer) { clearInterval(activeTimer); activeTimer=null; }
      const taskId = item.taskId || null;
      const taskOrdinal = taskId ? runTasks.findIndex(t=>t.id===taskId)+1 || null : null;
      activeAttempt = { provider: item.payload.provider||"agent", role: item.payload.role||"worker", taskId, taskOrdinal: taskOrdinal||null, startedAt: Date.now() };
      renderActiveRow();
      activeTimer = setInterval(renderActiveRow, 1000);
    }
    if(item.type==="provider.attempt_finished") {
      if(activeTimer) { clearInterval(activeTimer); activeTimer=null; }
      const finished = activeAttempt;
      activeAttempt = null;
      if(finished) {
        const el = q("timeline-active");
        const elapsed = fmtElapsed(Date.now() - finished.startedAt);
        const ordinal = finished.taskOrdinal != null ? " task " + finished.taskOrdinal : "";
        if(el) el.innerHTML = '<div class="tl-row"><span class="tl-dot done">&#10003;</span><span class="tl-label">' + esc(finished.provider) + " &mdash; " + esc(finished.role) + ordinal + '</span><span class="tl-elapsed">' + elapsed + "</span></div>";
        setTimeout(()=>{ const e=q("timeline-active"); if(e&&!activeAttempt) e.innerHTML=""; }, 3000);
      }
    }
    if(item.type==="run.updated" && item.payload && TERMINAL.has(item.payload.status)) clearActiveRow();
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
(function(){
  const chatHandle=document.getElementById("chat-resize-handle");
  const chatEl=document.getElementById("chat");
  const section=chatEl&&chatEl.parentElement;
  if(chatHandle&&chatEl&&section){
    let dragging=false,startY=0,startH=0;
    chatHandle.addEventListener("mousedown",e=>{dragging=true;startY=e.clientY;startH=chatEl.offsetHeight;document.body.style.cursor="ns-resize";e.preventDefault();});
    document.addEventListener("mousemove",e=>{if(!dragging)return;const delta=startY-e.clientY;chatEl.style.flex="none";chatEl.style.height=Math.max(200,Math.min(window.innerHeight*0.9,startH+delta))+"px";});
    document.addEventListener("mouseup",()=>{if(dragging){dragging=false;document.body.style.cursor="";}});
  }
})();
(function(){
  const toggleBtn=document.getElementById("sidebar-toggle");
  const mainEl=document.querySelector("main");
  const sectionNames=["runs","tasks","timeline","verification","messages","artifacts","conflicts","diff"];
  let activeSection=localStorage.getItem("duet-aside-section")||"runs";
  function setSection(name){
    activeSection=name;
    sectionNames.forEach(function(s){
      const sec=document.getElementById("aside-sec-"+s);
      if(sec)sec.classList.toggle("active",s===name);
      const rail=document.querySelector(".aside-rail-btn[data-section='"+s+"']");
      if(rail)rail.classList.toggle("active",s===name);
    });
    try{localStorage.setItem("duet-aside-section",name);}catch(e){}
  }
  const isMobile=function(){return window.matchMedia("(max-width:760px)").matches;};
  function setCollapsed(collapsed,persist){
    if(!mainEl)return;
    mainEl.classList.toggle("sidebar-collapsed",collapsed);
    if(toggleBtn){toggleBtn.innerHTML=collapsed?"&#9654;":"&#9664;";toggleBtn.title=collapsed?"Expand sidebar":"Collapse sidebar";}
    if(persist!==false){try{localStorage.setItem("duet-sidebar-collapsed",collapsed?"1":"0");}catch(e){}}
  }
  // On a phone the chat is the home view, so the section drawer starts closed.
  // Skip persistence so this does not clobber the saved desktop preference.
  if(isMobile())setCollapsed(true,false);
  else setCollapsed(localStorage.getItem("duet-sidebar-collapsed")==="1");
  setSection(activeSection);
  if(toggleBtn)toggleBtn.addEventListener("click",function(){setCollapsed(!mainEl.classList.contains("sidebar-collapsed"));});
  document.querySelectorAll(".aside-rail-btn[data-section]").forEach(function(btn){
    btn.addEventListener("click",function(){
      const name=btn.getAttribute("data-section");
      // On mobile, tapping the already-open section's tab returns to chat.
      if(isMobile()&&activeSection===name&&!mainEl.classList.contains("sidebar-collapsed")){
        setCollapsed(true,false);
        return;
      }
      setCollapsed(false);
      setSection(name);
    });
  });
})();
await authenticate();
renderChatShell();
try{const h=await api("/health");q("health").textContent="healthy - "+h.instanceId;q("health").className="pill ok";await loadRuns({selectCurrent:true});if(!selected){connectEvents();await loadChat();}}
catch(error){q("health").textContent=error.message;q("health").className="pill bad"}
`;
