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
        <button class="aside-rail-btn" data-section="memory" title="Manager memory">&#128214;</button>
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
        <div class="aside-section" id="aside-sec-memory">
          <div class="aside-sec-head"><h2>Manager Memory</h2></div>
          <div id="manager-memory"></div>
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
            <div id="manager-voices" class="chat-agents" role="group" aria-label="Manager voice"></div>
            <button id="chat-clear" type="button" class="chat-clear" title="Start a fresh manager thread for the current run and voice">Clear context</button>
          </div>
        </div>
        <div id="chat-status" class="muted" role="status" aria-live="polite">Ask a question. Select a run for run-scoped context.</div>
        <div id="chat-turns" class="chat-turns" aria-live="polite"></div>
        <form id="chat-form" class="chat-form">
          <textarea id="chat-input" rows="1" maxlength="20000" placeholder="Ask the Manager&#x2026; (Enter sends, Shift+Enter for newline)" disabled></textarea>
          <button id="chat-send" type="button" disabled aria-label="Send" title="Send">
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
.chat-head{display:flex;align-items:center;justify-content:space-between;gap:14px}
#chat-status{display:none}
.chat-head p{margin:3px 0 0}
.chat-tools{display:flex;flex-direction:row;align-items:center;gap:10px;flex-shrink:0}
.chat-clear{width:auto;margin:0;padding:4px 12px;border-radius:999px;border:1px solid var(--line-2);background:var(--surface-2);color:var(--muted);font-size:12px;font-weight:500;text-align:center}
.chat-clear:hover:not(:disabled){background:var(--line);color:var(--text);border-color:var(--line-2)}
/* ── provider ribbon ── */
.chat-agents{position:relative;display:inline-flex;align-items:flex-end;flex-direction:column;gap:6px;flex-shrink:0}
.chat-agents button{width:auto;margin:0;border-radius:999px;font-size:12px;font-weight:600;text-align:center;transition:background .12s,color .12s,border-color .12s,box-shadow .12s}
.provider-current{display:inline-flex;align-items:center;gap:7px;padding:5px 10px;border:1px solid var(--acc-bd);background:var(--acc-bg);color:var(--accent)}
.provider-current:hover{border-color:var(--accent);box-shadow:0 0 0 3px var(--acc-bg)}
.provider-current-label{color:var(--text)}
.provider-chevron{font-size:10px;color:var(--muted)}
.provider-menu{position:absolute;top:calc(100% + 6px);right:0;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px;max-width:min(520px,calc(100vw - 36px));padding:5px;border:1px solid var(--line);background:var(--surface-2);border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,.16);z-index:20}
.provider-choice{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border:1px solid transparent;background:transparent;color:var(--muted)}
.provider-choice:hover:not(:disabled){background:var(--line);color:var(--text)}
.provider-choice.active{background:var(--accent);color:#fff}
.provider-choice.unavailable{opacity:.62;border-color:var(--line)}
.provider-latency{font-size:9px;text-transform:uppercase;letter-spacing:.04em;border:1px solid var(--line-2);border-radius:999px;padding:1px 5px;color:var(--muted);background:var(--surface)}
.provider-latency.fast{color:var(--ok);border-color:var(--ok-bd);background:var(--ok-bg)}
.provider-latency.slow{color:var(--warn);border-color:var(--warn-bd);background:var(--warn-bg)}
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
.tool-trace{display:flex;flex-direction:column;gap:5px;margin:6px 0 4px}
.tool-trace-row{border:1px solid var(--line);background:var(--surface-2);border-radius:8px;padding:6px 8px;color:var(--muted);font-size:11px;line-height:1.45}
.tool-trace-row b{color:var(--text)}
.tool-trace-head{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.tool-trace-status{display:inline-flex;align-items:center;border-radius:999px;border:1px solid var(--line);padding:1px 6px;font-size:10px;text-transform:uppercase;letter-spacing:.04em;background:#eef2ff;color:#3550b8}
.tool-trace-status.ok{background:#edf8f1;color:#1c7f4a}
.tool-trace-status.info{background:#eef2ff;color:#3550b8}
.tool-trace-status.warn{background:#fff6e7;color:#9a5b00}
.tool-trace-status.fail{background:#fff0f0;color:#b42318}
.tool-trace-meta{color:var(--muted)}
.tool-trace-note{margin-top:4px}
.tool-trace-details{margin-top:5px}
.tool-trace-details summary{cursor:pointer;color:var(--accent);font-size:11px;user-select:none}
.tool-trace-details[open] summary{margin-bottom:4px}
.tool-trace-row .tool-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--text)}
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
.run-progress-state{align-self:flex-start;max-width:560px;border:1px solid var(--line);border-radius:10px;background:var(--surface-2);padding:14px 16px;margin:12px 2px}
.run-progress-title{font-weight:650;font-size:15px;margin-bottom:5px}
.plan-dismiss{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;float:right;border:1px solid var(--line);border-radius:999px;background:var(--surface-2);color:var(--muted,#888);cursor:pointer;font-size:14px;line-height:1;padding:0;margin-left:8px}
.plan-dismiss:hover{color:var(--text,#eee);background:var(--line)}
.chat-turn.working{opacity:.85}
.activity-stack{display:flex;flex-direction:column;gap:4px}
.activity-current{color:var(--text);font-size:12px}
.activity-secondary{color:var(--muted);font-size:11px}
.activity-trail{display:flex;flex-wrap:wrap;gap:6px}
.activity-chip{display:inline-flex;align-items:center;border-radius:999px;border:1px solid var(--line-2);padding:2px 7px;font-size:10px;color:var(--muted);background:var(--surface-2)}
.chat-turn.soft .body{color:var(--text,#ddd)}
.note.soft{display:inline-block;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#999);background:var(--surface-2,#222);border:1px solid var(--line,#333);border-radius:6px;padding:1px 6px;margin-bottom:6px}
.provider-advice{margin-top:8px;font-size:12px;color:var(--muted)}
.memory-summary{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.memory-pill{border:1px solid var(--line-2);border-radius:999px;padding:3px 8px;background:var(--surface-2);font-size:11px;color:var(--muted)}
.memory-pill.provider_health{border-color:var(--warn);color:var(--text)}
.memory-item{border:1px solid var(--line);border-radius:9px;background:var(--surface);padding:8px 9px;margin-bottom:7px;font-size:12px;color:var(--muted)}
.memory-item b{color:var(--text)}
.memory-item.provider_health{border-color:var(--warn-bd);background:var(--warn-bg)}
.memory-time{display:block;color:var(--faint);font:11px ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:4px}
.working-dots{display:inline-flex;gap:4px;align-items:center;height:14px}
.working-dots span{width:6px;height:6px;border-radius:50%;background:var(--muted,#888);display:inline-block;animation:working-bounce 1.2s infinite ease-in-out both}
.working-dots span:nth-child(2){animation-delay:.16s}
.working-dots span:nth-child(3){animation-delay:.32s}
@keyframes working-bounce{0%,80%,100%{transform:scale(.5);opacity:.4}40%{transform:scale(1);opacity:1}}
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
/* ── pill chat input ── */
.chat-form{display:flex;align-items:flex-end;gap:8px;background:var(--surface-2);border:1px solid var(--line-2);border-radius:24px;padding:6px 6px 6px 14px;transition:border-color .15s}
.chat-form:focus-within{border-color:var(--accent)}
.chat-form textarea{flex:1;resize:none;min-height:24px;max-height:160px;overflow-y:auto;border:none;background:transparent;color:var(--text);padding:4px 0;font:inherit;line-height:1.5;outline:none}
.chat-form textarea::placeholder{color:var(--faint)}
#chat-send{width:34px;height:34px;border-radius:50%;background:var(--accent);border:none;color:#fff;display:flex;align-items:center;justify-content:center;margin:0;flex-shrink:0;padding:0;cursor:pointer;transition:opacity .12s}
#chat-send:disabled{opacity:.4;cursor:not-allowed}
#chat-send:not(:disabled):hover{opacity:.82}
#chat-send svg{pointer-events:none}
#chat-send.stop-mode{background:var(--text)}
#chat-send.stop-mode svg{width:14px;height:14px}
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
  .chat-agents{flex:1;align-items:flex-start}
  .provider-menu{justify-content:flex-start;width:100%}
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
  activityRetained: false,
  activityDisplayUntil: 0,
  lastShownToolStep: 0,
  polling: null,
  pendingTurn: null,
  planOperations: new Map(),
  activeActivity: null,
  activeActivityRaw: null,
  activityHideTimer: null,
  statusError: null,
  sharedContext: []
};
let managerProviderMenuOpen = false;
let managerProviders = [
  { id: "codex", label: "Codex", available: true, latency: "slow" },
  { id: "claude", label: "Claude", available: true, latency: "slow" }
];
let eventStream = null;
let eventRunId = null;
let eventCursor = 0;
const renderedEventSeqs = new Set();
let activeAttempt = null; // { provider, role, taskId, taskOrdinal, startedAt }
let activeTimer = null;
let runTasks = []; // task list from last selectRun
let selectedRunDetail = null;
let bootInstanceId = null; // service instance seen at page load; a change means a restart
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
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 30000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  fetchOptions.signal = controller.signal;
  let response;
  try {
    response = await fetch("/api/v1" + path, fetchOptions);
  } catch (err) {
    if (err && err.name === "AbortError") {
      // A timeout after a good boot almost always means a stale/black-holed
      // pooled connection (common behind a VPN after a service restart) while
      // the SSE stream may still look alive. A full reload drops the pool and
      // reconnects fresh; reloadOnce has a cooldown so it cannot loop.
      if (bootInstanceId) reloadOnce();
      throw new Error("Request timed out — the service may be slow or unreachable.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  // Session expired (commonly after a service restart wipes in-memory sessions).
  // Re-auth once with the saved access token and replay the original request so
  // open windows self-heal instead of failing. The same idempotency key is safe
  // to reuse: a 401 is rejected before any work, so no idempotency record exists.
  if (response.status === 401 && !options._retried && await reauth()) {
    return api(path, Object.assign({}, options, { _retried: true }));
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || response.statusText);
  return payload.data;
}
let reauthInFlight = null;
function reauth() {
  const savedAccessToken = localStorage.getItem(DASHBOARD_ACCESS_KEY);
  if (!savedAccessToken) return Promise.resolve(false);
  // Dedupe concurrent 401s into a single re-auth round-trip.
  if (!reauthInFlight) {
    reauthInFlight = (async () => {
      try {
        const r = await fetch("/dashboard/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accessToken: savedAccessToken }),
        });
        if (!r.ok) localStorage.removeItem(DASHBOARD_ACCESS_KEY);
        return r.ok;
      } catch {
        return false;
      }
    })().finally(() => { reauthInFlight = null; });
  }
  return reauthInFlight;
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
  // Pending runs (a plan was created but execution never started, so there are
  // no worktrees) can be closed in one click: the backend cancels + deletes.
  const discardable = new Set(["awaiting_plan_approval","approved"]);
  q("runs").innerHTML=runs.map(r=>{
    const del=deletable.has(r.status)
      ?'<button class="run-delete-btn" data-delete-run="'+esc(r.id)+'" title="Delete run" aria-label="Delete">&#10005;</button>'
      :discardable.has(r.status)
        ?'<button class="run-delete-btn" data-discard-run="'+esc(r.id)+'" title="Close run (cancel and remove)" aria-label="Close run">&#10005;</button>'
        :"";
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
  q("runs").querySelectorAll("[data-discard-run]").forEach(b=>b.onclick=async(e)=>{
    e.stopPropagation();
    if(!confirm("Close this run? It will be cancelled and removed. This cannot be undone."))return;
    try{
      await api("/runs/"+encodeURIComponent(b.dataset.discardRun)+"/discard",{method:"POST",idempotencyKey:requestKey("dashboard-discard-run"),body:{}});
      if(selected===b.dataset.discardRun){selected=null;}
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
  selectedRunDetail = detail.run;
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
function managerActivityLabel(activity) {
  if (!activity) return "Working…";
  if (activity.phase === "tool") {
    const map = {
      list_runs: "Reviewing runs", inspect_run: "Inspecting a run",
      check_path: "Checking a path", check_git_repo: "Checking the git repo",
      resolve_alias: "Resolving an alias", search_files: "Searching files",
      create_plan_proposal: "Preparing a plan suggestion",
      set_strategy_proposal: "Preparing a strategy suggestion",
      set_alias_proposal: "Preparing an alias suggestion",
      request_agent_consultation: "Preparing a consultation"
    };
    return (map[activity.tool] || ("Using " + activity.tool)) + "…";
  }
  if (activity.phase === "summarizing") return "Writing the answer…";
  return "Thinking…";
}
function renderActivityTrail(activity) {
  const history = Array.isArray(activity?.history) ? activity.history : [];
  const tools = history
    .filter(item => item && item.phase === "tool" && item.tool)
    .filter((item, index, list) => index === 0 || list[index - 1].tool !== item.tool);
  if (tools.length <= 1) return "";
  const priorTools = tools.slice(0, -1).slice(-3);
  if (!priorTools.length) return "";
  const chips = priorTools
    .map(item => '<span class="activity-chip">'+esc(managerActivityLabel(item).replace(/Ã¢â‚¬Â¦|â€¦/g, ""))+'</span>')
    .join("");
  return '<div class="activity-trail">' + chips + '</div>';
}
function activeOperationMatchesCurrentView() {
  const op = chat.activeOperation;
  if (!op) return false;
  const cid = currentConversationId();
  return Boolean(cid && op.conversationId === cid);
}
function renderManagerWorking() {
  if (!activeOperationMatchesCurrentView()) return "";
  const rawActivity = chat.activeActivityRaw || chat.activeActivity;
  const latestTool = latestToolActivity(rawActivity);
  const primaryActivity = latestTool || chat.activeActivity;
  const label = managerActivityLabel(primaryActivity);
  const secondary =
    rawActivity &&
    latestTool &&
    rawActivity.phase === "summarizing"
      ? '<span class="activity-secondary">'+esc(managerActivityLabel(rawActivity))+'</span>'
      : "";
  const trail = renderActivityTrail(rawActivity);
  return '<div class="chat-turn manager working" id="manager-working"><div class="manager-avatar"></div>'
    +'<div class="turn-content"><div class="meta"><b>Manager: '+esc(chat.agent)+'</b>'+badge("working")
    +'<span class="when">live</span></div>'
    +'<div class="body"><span class="working-dots"><span></span><span></span><span></span></span><span class="activity-stack"><span class="activity-current">'+esc(label)+'</span>'+secondary+trail+'</span></div></div></div>';
}
function updateManagerWorking() {
  const host = q("chat-turns");
  if (!host) return;
  const existing = document.getElementById("manager-working");
  const html = renderManagerWorking();
  if (!html) { if (existing) existing.remove(); return; }
  if (existing) { existing.outerHTML = html; }
  else { host.insertAdjacentHTML("beforeend", html); host.scrollTop = host.scrollHeight; }
}
function latestToolActivity(activity) {
  const history = Array.isArray(activity?.history) ? activity.history : [];
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];
    if (item && item.phase === "tool" && item.tool) return item;
  }
  return activity?.phase === "tool" ? activity : null;
}
function chooseVisibleActivity(activity) {
  if (!activity) return null;
  const now = Date.now();
  const latestTool = latestToolActivity(activity);
  if (latestTool && Number(latestTool.step) > Number(chat.lastShownToolStep || 0)) {
    chat.lastShownToolStep = Number(latestTool.step);
    chat.activityDisplayUntil = now + 900;
    return latestTool;
  }
  if (now < Number(chat.activityDisplayUntil || 0) && latestTool) {
    return latestTool;
  }
  return activity;
}
function clearWorkingBubbleNow() {
  if (chat.activityHideTimer) {
    clearTimeout(chat.activityHideTimer);
    chat.activityHideTimer = null;
  }
  chat.activityRetained = false;
  chat.activityDisplayUntil = 0;
  chat.lastShownToolStep = 0;
  chat.activeActivity = null;
  chat.activeActivityRaw = null;
  if (chat.activeOperation) chat.activeOperation = null;
  const working = document.getElementById("manager-working");
  if (working) working.remove();
}
function scheduleWorkingBubbleClear(delayMs = 900) {
  if (chat.activityHideTimer) clearTimeout(chat.activityHideTimer);
  chat.activityRetained = true;
  chat.activityHideTimer = setTimeout(() => {
    chat.activityHideTimer = null;
    clearWorkingBubbleNow();
  }, delayMs);
}
function renderRunProgressEmptyState() {
  if (!selected || !selectedRunDetail) return "";
  const status = String(selectedRunDetail.status || "");
  const lead = selectedRunDetail.leadProvider || "agent";
  if (status === "planning") {
    return '<div class="run-progress-state"><div class="run-progress-title">'+esc(lead)+' is planning</div><div class="kv">The planner is creating a plan for this run. Watch the Timeline for live progress.</div></div>';
  }
  if (status === "awaiting_plan_approval") {
    return '<div class="run-progress-state"><div class="run-progress-title">Plan ready for approval</div><div class="kv">Review the Plan panel, then approve the plan when it looks right.</div></div>';
  }
  return "";
}
function currentConversationId() {
  return currentConversation()?.id || null;
}
function renderSharedContext(items) {
  const host = q("manager-memory");
  if (!host) return;
  const visible = (items || []).slice(0, 8);
  if (!visible.length) {
    host.innerHTML = '<span class="empty">No shared manager notes yet.</span>';
    return;
  }
  const counts = visible.reduce((acc, item) => {
    const kind = item.kind || "note";
    acc[kind] = (acc[kind] || 0) + 1;
    return acc;
  }, {});
  host.innerHTML = '<div class="memory-summary">'
    + Object.keys(counts).map(kind => '<span class="memory-pill '+esc(kind)+'">'+esc(kind.replaceAll("_", " "))+' '+esc(counts[kind])+'</span>').join("")
    + '</div>'
    + visible.map(item => {
      const when = item.createdAt ? new Date(item.createdAt) : null;
      const ts = when && !isNaN(when.getTime()) ? '<span class="memory-time">'+esc(when.toLocaleString())+'</span>' : "";
      return '<div class="memory-item '+esc(item.kind || "note")+'">'
        + '<b>'+esc((item.provider || "shared") + " · " + (item.kind || "note").replaceAll("_", " "))+'</b>'
        + '<div>'+visibleText(item.content || "", 500)+'</div>'
        + ts
        + '</div>';
    }).join("");
}
function managerProviderById(id) {
  return managerProviders.find((provider) => provider.id === id) || null;
}
function firstAvailableManagerProvider() {
  return managerProviders.find((provider) => provider.available) || null;
}
function normalizeSelectedManagerProvider() {
  const current = managerProviderById(chat.agent);
  if (current?.available) return;
  const fallback = firstAvailableManagerProvider();
  if (fallback) chat.agent = fallback.id;
}
function renderManagerProviders() {
  const host = q("manager-voices");
  if (!host) return;
  const current = managerProviders.find((provider) => provider.id === chat.agent)
    || { id: chat.agent, label: chat.agent, available: true, latency: "balanced" };
  const choices = managerProviderMenuOpen
    ? managerProviders.filter((provider) => provider.id !== current.id)
    : [];
  const latencyLabel = current.latency ? '<span class="provider-latency '+esc(current.latency)+'">'+esc(current.latency)+'</span>' : "";
  host.classList.toggle("open", managerProviderMenuOpen);
  host.innerHTML =
    '<button id="chat-provider-current" class="provider-current" type="button" data-provider-menu-toggle="1" aria-expanded="'+(managerProviderMenuOpen ? "true" : "false")+'" title="Choose manager provider">'
      +'<span class="provider-current-label">'+esc(current.label)+'</span>'
      +latencyLabel
      +'<span class="provider-chevron">'+(managerProviderMenuOpen ? "▲" : "▼")+'</span>'
    +'</button>'
    +'<div class="provider-menu" '+(managerProviderMenuOpen && choices.length ? "" : "hidden")+'>'
    +choices.map((provider) =>
      '<button id="chat-'+esc(provider.id)+'" class="provider-choice'+(provider.available ? "" : " unavailable")+'" type="button" data-agent="'+esc(provider.id)+'" title="'+esc(provider.available ? provider.label : provider.label+" is not configured")+'">'
        +'<span>'+esc(provider.label)+(provider.available ? "" : " *")+'</span>'
        +(provider.latency ? '<span class="provider-latency '+esc(provider.latency)+'">'+esc(provider.latency)+'</span>' : "")
      +'</button>'
    ).join("")
    +'</div>';
  updateAgentButtons();
}
function updateAgentButtons() {
  for (const button of document.querySelectorAll("[data-agent]")) {
    button.classList.toggle("active", button.dataset.agent === chat.agent);
  }
}
function renderPlanOperationNotices() {
  const conversationId = currentConversationId();
  if (!conversationId) return "";
  const notices = Array.from(chat.planOperations.values())
    .filter(item => item.conversationId === conversationId);
  if (!notices.length) return "";
  return notices.map(item => {
    const title = item.status === "succeeded"
      ? "Plan ready"
      : item.status === "failed"
        ? "Plan generation failed"
        : item.status === "cancelled" || item.status === "interrupted"
          ? "Plan generation stopped"
          : "Plan generation running";
    const body = item.status === "succeeded"
      ? "The planner finished. You can open the run, or show the plan here without leaving this chat."
      : item.status === "failed"
        ? visibleText(item.error || "The planner operation failed.", 700)
        : "A planner agent is working in the background. You can keep chatting with the Manager while it runs.";
    const actions = item.status === "succeeded" && item.runId
      ? '<div class="proposal-actions"><button type="button" data-plan-open="'+esc(item.runId)+'">Open run</button><button type="button" data-plan-show="'+esc(item.operationId)+'" data-run-id="'+esc(item.runId)+'">Show plan here</button></div>'
      : "";
    const plan = item.planHtml ? '<div class="proposal-copy">Plan</div>'+item.planHtml : "";
    // Terminal notices (failed/succeeded/stopped) can be cleared by the operator;
    // a running planner has no X so it is not dismissed mid-flight.
    const isTerminal = item.status === "failed" || item.status === "succeeded"
      || item.status === "cancelled" || item.status === "interrupted";
    const dismissX = isTerminal
      ? '<button type="button" class="plan-dismiss" title="Dismiss" aria-label="Dismiss" data-plan-dismiss="'+esc(item.operationId)+'">&#x2715;</button>'
      : "";
    return '<div class="run-progress-state" data-plan-operation="'+esc(item.operationId)+'">'
      +'<div class="run-progress-title">'+esc(title)+' '+badge(item.status || "running")+dismissX+'</div>'
      +'<div class="kv">'+body+'</div>'
      +(item.runId ? '<div class="kv">run <b>'+esc(item.runId)+'</b></div>' : "")
      +actions
      +plan
      +'</div>';
  }).join("");
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
  return Boolean((chat.activeOperation && !chat.activityRetained) || chat.pendingTurn);
}
async function loadChat() {
  clearTimeout(chat.polling);
  normalizeSelectedManagerProvider();
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
      chat.sharedContext = [];
      renderSharedContext(chat.sharedContext);
      const scope = selected ? esc(chat.agent)+" manager" : "global";
      q("chat-turns").innerHTML=(renderPendingTurn() || renderRunProgressEmptyState() || '<span class="empty">No '+scope+' conversation yet. Send a message to start one.</span>');
      setChatEnabled(!chatIsBusyForCurrentView());
      return;
    }
    await refreshConversation(conversation.id);
  } catch(error) {
    q("chat-turns").innerHTML = '<span class="empty">Could not load '+esc(chat.agent)+' manager conversation: '+esc(error.message)+'</span>';
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
  chat.sharedContext = data.sharedContext || [];
  renderSharedContext(chat.sharedContext);
  renderTurns(data.turns, data.proposals || [], data.proposalHistory || []);
  const failed = [...data.turns].reverse().find(turn => turn.role === "manager" && turn.status === "failed");
  const failure = failedTurnStatus(failed);
  if (failure) {
    chat.statusError = {
      conversationId: data.conversation.id,
      message: failure.message,
      soft: failure.soft,
    };
    setChatStatus(failure.message, !failure.soft);
  }
  else if (chat.statusError && chat.statusError.conversationId === data.conversation.id) {
    setChatStatus(chat.statusError.message, !chat.statusError.soft);
  }
  else setChatStatus("Ready. Manager voice: "+data.conversation.interfaceAgent+".");
  setChatEnabled(!chatIsBusyForCurrentView());
  return data;
}
function renderChatShell() {
  renderManagerProviders();
  setChatEnabled(!chatIsBusyForCurrentView());
}
function composerSendIcon() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
}
function composerStopIcon() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
}
function updateComposerAction() {
  const button = q("chat-send");
  const input = q("chat-input");
  const busy = chatIsBusyForCurrentView();
  const cancellable = Boolean(chat.activeOperation);
  button.classList.toggle("stop-mode", busy);
  button.setAttribute("aria-label", busy ? "Stop" : "Send");
  button.title = busy ? "Stop active work" : "Send";
  button.innerHTML = busy ? composerStopIcon() : composerSendIcon();
  button.disabled = busy ? !cancellable : input.disabled;
}
function setChatStatus(message, bad=false) {
  const cid = currentConversationId();
  if (
    /^Ready\./.test(String(message)) &&
    chat.statusError &&
    chat.statusError.conversationId === cid
  ) {
    message = chat.statusError.message;
    bad = !chat.statusError.soft;
  }
  q("chat-status").className = bad ? "bad" : "muted";
  q("chat-status").textContent = message;
}
function setChatEnabled(enabled) {
  q("chat-input").disabled = !enabled;
  q("chat-clear").disabled = !enabled;
  updateComposerAction();
}
async function stopActiveWork() {
  const result = await api("/service/cancel-active", {
    method: "POST",
    idempotencyKey: requestKey("dashboard-cancel-active"),
    body: {}
  });
  if (result.cancellationRequested) {
    setChatStatus("Stop requested. Active work is being cancelled.");
    if (chat.activeOperation) {
      chat.pendingTurn = null;
      setChatEnabled(false);
    }
  } else {
    setChatStatus("Nothing is running right now.");
    setChatEnabled(!chatIsBusyForCurrentView());
  }
  refreshRuns({ preserveSelection: true }).catch(() => {});
  const conv = currentConversation();
  if (conv) refreshConversation(conv.id).catch(() => {});
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
function parseUsageJson(turn) {
  if (!turn || !turn.usageJson) return null;
  try { return JSON.parse(turn.usageJson); }
  catch { return null; }
}
function compactToolArgs(args) {
  if (!args || typeof args !== "object") return "";
  const bits = [];
  if (args.namePattern) bits.push('name "'+String(args.namePattern)+'"');
  if (args.kind) bits.push("kind "+String(args.kind));
  if (args.path) bits.push("path "+String(args.path));
  if (args.contentPattern) bits.push(String(args.contentPattern));
  return bits.length ? " ("+bits.map(esc).join(", ")+")" : "";
}
function toolTraceName(trace) {
  return String(trace?.name || trace?.tool || "tool");
}
function toolTraceArguments(trace) {
  return trace?.arguments || trace?.args || null;
}
function toolTraceStatus(trace) {
  const result = trace && trace.result;
  if (trace?.ok === false) {
    const code = typeof result?.code === "string" ? result.code : "";
    return { label: code ? code.replaceAll("_", " ").toLowerCase() : "failed", tone: "fail" };
  }
  if (toolTraceName(trace) === "search_files") {
    const count = Number(result?.matchCount);
    if (Number.isFinite(count)) {
      if (count === 0) return { label: "0 matches", tone: "warn" };
      if (count === 1) return { label: "1 match", tone: "ok" };
      return { label: count + " matches", tone: "ok" };
    }
  }
  if (typeof result?.code === "string" && result.code !== "OK") {
    return { label: result.code.replaceAll("_", " ").toLowerCase(), tone: "info" };
  }
  return { label: "ok", tone: "ok" };
}
function compactToolResultSummary(trace) {
  const result = trace && trace.result;
  if (!result || typeof result !== "object") return "";
  if (toolTraceName(trace) === "search_files") {
    const count = Number.isFinite(Number(result.matchCount)) ? Number(result.matchCount) : 0;
    const scanned = Number.isFinite(Number(result.entriesScanned)) ? " scanned "+Number(result.entriesScanned) : "";
    const truncated = result.truncated ? " truncated" : "";
    return '<span>'+esc(count+" match"+(count===1?"":"es")+scanned+truncated)+'</span>';
  }
  if (typeof result.message === "string" && result.message) {
    const code = typeof result.code === "string" ? result.code.replaceAll("_", " ").toLowerCase()+": " : "";
    return '<span>'+esc(code + result.message)+'</span>';
  }
  if (result.path) return '<span class="tool-path">'+esc(String(result.path))+'</span>';
  if (result.repoPath) return '<span class="tool-path">'+esc(String(result.repoPath))+'</span>';
  return "";
}
function compactToolResultDetails(trace) {
  const result = trace && trace.result;
  if (!result || typeof result !== "object") return "";
  if (toolTraceName(trace) === "search_files") {
    const folders = Array.isArray(result.folderMatches) ? result.folderMatches.filter(m => m && m.path).slice(0, 3) : [];
    const matches = Array.isArray(result.matches) ? result.matches.filter(m => m && m.path).slice(0, 3) : [];
    const folderPaths = folders.length
      ? '<div><b>top folders</b><br>'+folders.map(m => '<span class="tool-path">'+esc(String(m.path))+'</span>').join("<br>")+'</div>'
      : "";
    const paths = matches.length
      ? '<div><b>sample files</b><br>'+matches.map(m => '<span class="tool-path">'+esc(String(m.path))+'</span>').join("<br>")+'</div>'
      : "";
    return folderPaths + paths;
  }
  return "";
}
function visibleToolTraceItems(trace) {
  if (!Array.isArray(trace) || !trace.length) return [];
  const hasSuccessfulSearch = trace.some((item) =>
    toolTraceName(item) === "search_files" &&
    item?.ok !== false &&
    Number(item?.result?.matchCount) > 0
  );
  return trace.filter((item) => {
    if (toolTraceName(item) !== "search_files") return true;
    if (item?.ok === false && hasSuccessfulSearch) return false;
    return true;
  });
}
function renderToolTrace(turn) {
  const usage = parseUsageJson(turn);
  const trace = visibleToolTraceItems(Array.isArray(usage?.toolTrace) ? usage.toolTrace : []);
  if (!trace.length) return "";
  return '<div class="tool-trace">'
    + trace.slice(0, 6).map(item => {
      const name = toolTraceName(item);
      const status = toolTraceStatus(item);
      const elapsed = Number.isFinite(Number(item.elapsedMs)) ? " · "+Number(item.elapsedMs)+"ms" : "";
      const args = compactToolArgs(toolTraceArguments(item));
      const summary = compactToolResultSummary(item);
      const details = compactToolResultDetails(item);
      return '<div class="tool-trace-row">'
        +'<div class="tool-trace-head"><b>'+esc(name)+'</b><span class="tool-trace-status '+esc(status.tone)+'">'+esc(status.label)+'</span><span class="tool-trace-meta">'+esc(elapsed)+(args || "")+'</span></div>'
        +(summary ? '<div class="tool-trace-note">'+summary+'</div>' : '')
        +(details ? '<details class="tool-trace-details"><summary>Show details</summary><div class="tool-trace-note">'+details+'</div></details>' : '')
        +'</div>';
    }).join("")
    + '</div>';
}
function renderTurns(turns, proposals = [], proposalHistory = []) {
  if (!turns.length) {
    q("chat-turns").innerHTML=renderPendingTurn() + renderManagerWorking() + renderPlanOperationNotices() || '<span class="empty">No turns yet.</span>';
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
    // "Soft" failures (rate limit, budget) are expected throttling, not errors -
    // render them as a calm informational bubble rather than a red error.
    let soft = false;
    let note = "";
    let body;
    if (failed && turn.errorJson) {
      let code = "error", message = turn.errorJson;
      try { const parsed = JSON.parse(turn.errorJson); code = parsed.code || code; message = parsed.message || message; }
      catch { /* fall back to the raw, bounded error text */ }
      soft = isSoftFailureCode(code);
      const noteLabel = soft ? failureNoteLabel(code) : code;
      note = '<div class="note'+(soft?' soft':'')+'">'+esc(noteLabel)+'</div>';
      body = visibleText(message, 4000) + providerSwitchAdvice(code, turn.interfaceAgent || chat.agent);
    } else {
      body = turn.role === "manager"
        ? renderMarkdown(turn.content || "")
        : visibleText(turn.content, 4000);
    }
    const when = turn.createdAt ? new Date(turn.createdAt) : null;
    const ts = when && !isNaN(when.getTime()) ? '<span class="when">'+esc(when.toLocaleTimeString())+'</span>' : "";
    const cards = (proposalsByTurn.get(turn.id) || []).map(renderProposalCard).join("");
    const statusBadge = soft ? '' : badge(turn.status);
    const meta = '<div class="meta"><b>'+esc(who)+'</b>'+statusBadge+'<span>#'+esc(turn.seq)+'</span>'+ts+'</div>';
    const copyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const copyBtn = '<div class="turn-copy-row"><button class="turn-copy-btn" data-turn-copy="'+esc(turn.content||'')+'">'+copyIcon+'</button></div>';
    const stateClass = failed ? (soft ? " soft" : " failed") : "";
    const toolTrace = turn.role === "manager" ? renderToolTrace(turn) : "";
    const inner = meta+note+'<div class="body">'+body+'</div>'+toolTrace+((!failed||soft) ? copyBtn : '')+cards;
    if (turn.role === "manager") {
      return '<div class="chat-turn manager'+stateClass+'"><div class="manager-avatar"></div><div class="turn-content">'+inner+'</div></div>';
    }
    return '<div class="chat-turn '+esc(turn.role)+stateClass+'">'+inner+'</div>';
  }).join("");
  q("chat-turns").innerHTML = turnsHtml + renderPendingTurn() + renderManagerWorking() + renderPlanOperationNotices();
  q("chat-turns").scrollTop = q("chat-turns").scrollHeight;
}
function actionLabel(action) {
  return String(action || "").replaceAll("_", " ");
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
  if (proposal.action === "agent_consultation") {
    let meta = {};
    try { meta = JSON.parse(proposal.commandJson); } catch {}
    return '<div class="proposal-card" data-proposal-id="'+esc(proposal.id)+'" data-command="'+esc(proposal.commandCli)+'">'
      +'<div class="proposal-title">Suggested action&nbsp;'+badge("agent consultation")+badge("consent")+'</div>'
      +'<div class="muted">'+visibleText(proposal.summary, 600)+'</div>'
      +'<div class="proposal-kv"><b>Agents:</b> '+visibleText((meta.agents||[]).join ? meta.agents.join(", ") : "", 200)+'</div>'
      +'<div class="proposal-kv"><b>Profile:</b> '+esc(meta.profile||"balanced")+'&nbsp;&nbsp;<b>Mode:</b> '+esc(meta.mode||"independent")+'</div>'
      +'<div class="proposal-copy">This records consent intent only. Asking Claude/Codex is deferred until the consultation executor is added.</div>'
      +'<div class="proposal-actions"><button type="button" data-proposal-copy="'+esc(proposal.id)+'">Copy CLI</button><button type="button" data-proposal-dismiss="'+esc(proposal.id)+'">Dismiss</button></div>'
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
  if (!prepared.available && /no longer active|already been started|expired/i.test(prepared.blockedReason || "")) {
    return '<div><b>Suggestion is no longer active</b></div><div class="kv">It may already be running or it was replaced by a newer state.</div>'
      + (prepared.run ? '<div class="kv">run <b>'+esc(prepared.run.id)+'</b> '+badge(prepared.run.status)+' version '+esc(prepared.run.version)+'</div>' : "");
  }
  const state = prepared.available ? '<span class="ok">Ready to copy</span>' : '<span class="bad">Not ready</span>';
  const run = prepared.run ? '<div class="kv">run <b>'+esc(prepared.run.id)+'</b> '+badge(prepared.run.status)+' version '+esc(prepared.run.version)+'</div>' : "";
  const task = prepared.task ? '<div class="kv">task <b>'+esc(prepared.task.id)+'</b> '+badge(prepared.task.status)+' version '+esc(prepared.task.version)+'</div>' : "";
  const blocked = prepared.blockedReason ? '<div class="bad">'+visibleText(prepared.blockedReason, 500)+'</div>' : "";
  const requirements = (prepared.requirements || []).map(item => '<li>'+visibleText(item, 500)+'</li>').join("");
  const warnings = (prepared.warnings || []).map(item => '<li>'+visibleText(item, 500)+'</li>').join("");
  const start = prepared.available && prepared.tier === "ordinary"
    ? '<div class="proposal-confirm"><input type="text" autocomplete="off" placeholder="Type start" aria-label="Type start to confirm" data-proposal-start-input="'+esc(prepared.proposalId)+'"><button type="button" disabled data-proposal-start="'+esc(prepared.proposalId)+'" data-proposal-action="'+esc(prepared.action || "")+'" data-run-version="'+esc(prepared.run?.version ?? "")+'" data-task-version="'+esc(prepared.task?.version ?? "")+'">Start operation</button></div>'
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
  let prepared;
  try {
    prepared = await api("/chat/conversations/"+encodeURIComponent(conversation.id)+"/proposals/"+encodeURIComponent(proposalId)+"/prepare");
  } catch (error) {
    // A proposal that has already been started/dismissed/expired is no longer
    // preparable — that is expected, not an error worth alarming the operator.
    if (/no longer active|already been started|not in conversation|expired/i.test(error.message || "")) {
      const panel = q("chat-turns").querySelector('[data-proposal-readiness="'+CSS.escape(proposalId)+'"]');
      if (panel) panel.innerHTML = '<div class="muted">This suggestion has already been started or is no longer pending.</div>';
      setChatStatus("This suggestion is no longer pending (it may already be running).");
      return;
    }
    throw error;
  }
  const panel = q("chat-turns").querySelector('[data-proposal-readiness="'+CSS.escape(proposalId)+'"]');
  if (panel) panel.innerHTML = renderReadiness(prepared);
  if (!prepared.available && /no longer active|already been started|expired/i.test(prepared.blockedReason || "")) {
    const card = panel?.closest(".proposal-card");
    card?.querySelectorAll("[data-proposal-prepare], [data-proposal-start], [data-proposal-copy]").forEach((button) => {
      button.disabled = true;
    });
    setChatStatus("This suggestion is no longer active. Watch the run in the sidebar and Timeline.");
    return;
  }
  setChatStatus(prepared.available ? "Suggestion checked. Copy the CLI command if you choose to proceed." : "Suggestion checked, but it is not currently ready.");
}
function renderInlinePlan(detail) {
  const plan = detail.run?.plan;
  const tasks = detail.tasks || [];
  if (!plan && !tasks.length) return '<div class="muted">No plan details are available yet.</div>';
  const summary = plan?.summary ? '<p>'+visibleText(plan.summary, 1200)+'</p>' : "";
  const taskRows = tasks.slice(0, 6).map(task =>
    '<li><b>'+esc(task.id)+': '+visibleText(task.plan?.title || "Task", 160)+'</b>'
    +'<div class="kv">'+visibleText(task.plan?.objective || "", 400)+'</div>'
    +'<div class="muted">paths: '+esc((task.plan?.allowedPaths || []).join(", ") || "none")+'</div></li>'
  ).join("");
  const risks = (plan?.risks || []).slice(0, 5).map(risk => '<li>'+visibleText(risk, 300)+'</li>').join("");
  return summary
    +(taskRows ? '<ol>'+taskRows+'</ol>' : "")
    +(risks ? '<div class="proposal-copy">Risks</div><ul>'+risks+'</ul>' : "");
}
async function showPlanInChat(operationId, runId) {
  const notice = chat.planOperations.get(operationId);
  if (!notice) return;
  const detail = await api("/runs/"+encodeURIComponent(runId));
  notice.planHtml = renderInlinePlan(detail);
  chat.planOperations.set(operationId, notice);
  const conversation = currentConversation();
  if (conversation) await refreshConversation(conversation.id);
}
async function watchPlanOperation(operationId, conversationId) {
  const original = chat.planOperations.get(operationId);
  if (!original) return;
  try {
    while (true) {
      const operation = await api("/operations/"+encodeURIComponent(operationId));
      const notice = chat.planOperations.get(operationId) || original;
      notice.status = operation.status;
      if (operation.resultJson) {
        try {
          const result = JSON.parse(operation.resultJson);
          if (result?.id) notice.runId = result.id;
        } catch {}
      }
      if (operation.errorJson) {
        try {
          const parsed = JSON.parse(operation.errorJson);
          notice.error = parsed.message || parsed.code || operation.errorJson;
        } catch {
          notice.error = operation.errorJson;
        }
      }
      chat.planOperations.set(operationId, notice);
      if (!["queued","running"].includes(operation.status)) {
        await loadRuns().catch(()=>{});
        const conversation = currentConversation();
        if (conversation?.id === conversationId) {
          await refreshConversation(conversationId);
          setChatStatus(
            operation.status === "succeeded"
              ? "Plan ready. You can keep chatting, open the run, or show the plan here."
              : "Plan generation "+operation.status+".",
            operation.status !== "succeeded",
          );
        }
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    const notice = chat.planOperations.get(operationId) || original;
    notice.status = "failed";
    notice.error = error.message || String(error);
    chat.planOperations.set(operationId, notice);
    const conversation = currentConversation();
    if (conversation?.id === conversationId) {
      setChatStatus(notice.error, true);
      await refreshConversation(conversationId).catch(()=>{});
    }
  }
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
  // create_plan kicks off a planner run; other actions are quick mutations.
  const isPlan = (button.dataset.proposalAction || "") === "create_plan";
  const panel = q("chat-turns").querySelector('[data-proposal-readiness="'+CSS.escape(proposalId)+'"]');
  if (panel) panel.innerHTML = isPlan
    ? '<div><b>Generating plan…</b></div><div class="kv">A planner agent is working — this can take a minute. The run appears in the sidebar; watch the Timeline for live progress.</div>'
    : '<div><b>Operation started</b></div><div class="kv">operation <b>'+esc(operation.id)+'</b> '+badge(operation.status)+'</div>';
  if (isPlan) {
    chat.planOperations.set(operation.id, {
      operationId: operation.id,
      conversationId: conversation.id,
      proposalId,
      status: operation.status || "queued",
      runId: operation.runId || null,
    });
    setChatStatus("Plan generation started. You can keep chatting while the planner works.");
    setChatEnabled(true);
    refreshConversation(conversation.id).catch(()=>{});
    watchPlanOperation(operation.id, conversation.id).catch(()=>{});
    return;
  }
  await pollOperation(operation.id, conversation.id, "Duet operation");
  // Surface the result reliably by opening the new run (its Plan and Timeline
  // panels render the plan dependably — far more robust than injecting a bubble
  // into a chat thread that pollOperation may have just re-rendered).
  try {
    const completedOp = await api("/operations/"+encodeURIComponent(operation.id));
    if (completedOp.status === "succeeded" && completedOp.resultJson) {
      const result = JSON.parse(completedOp.resultJson);
      if (result && result.id) {
        await loadRuns();
        await selectRun(result.id);
        setChatStatus("Plan ready — opened run "+result.id.slice(0,8)+". Review it in the Plan and Timeline panels.");
        return;
      }
    }
  } catch {}
  await loadRuns().catch(()=>{});
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
  const planOpen = event.target.closest("[data-plan-open]");
  const planShow = event.target.closest("[data-plan-show]");
  const planDismiss = event.target.closest("[data-plan-dismiss]");
  if (!prepare && !start && !copy && !dismiss && !approve && !turnCopy && !planOpen && !planShow && !planDismiss) return;
  try {
    if (planDismiss) {
      const operationId = planDismiss.dataset.planDismiss;
      chat.planOperations.delete(operationId);
      const node = q("chat-turns").querySelector('[data-plan-operation="'+CSS.escape(operationId)+'"]');
      if (node) node.remove();
      return;
    }
    if (planOpen) {
      await selectRun(planOpen.dataset.planOpen);
      return;
    }
    if (planShow) {
      await showPlanInChat(planShow.dataset.planShow, planShow.dataset.runId);
      return;
    }
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
function isSoftFailureCode(code) {
  return code === "RATE_LIMITED" || code === "BUDGET_EXCEEDED"
    || code === "PROVIDER_AUTH_REQUIRED" || code === "PROVIDER_TOOL_CALL_FAILED"
    || code === "PROVIDER_CONFIGURATION_ERROR" || code === "PROVIDER_BILLING_EXHAUSTED";
}
function failureNoteLabel(code) {
  if (code === "RATE_LIMITED") return "rate limited";
  if (code === "BUDGET_EXCEEDED") return "limit reached";
  if (code === "PROVIDER_AUTH_REQUIRED") return "auth required";
  if (code === "PROVIDER_TOOL_CALL_FAILED") return "tool call failed";
  if (code === "PROVIDER_CONFIGURATION_ERROR") return "provider setup";
  if (code === "PROVIDER_BILLING_EXHAUSTED") return "out of credits";
  return code;
}
function providerSwitchAdvice(code, provider) {
  if (!isSoftFailureCode(code) || code === "BUDGET_EXCEEDED") return "";
  const preferredProvider = managerProviders.find((item) =>
    item.available && item.id !== provider && item.id !== "codex" && item.id !== "claude"
  ) ?? managerProviders.find((item) => item.available && item.id !== provider);
  const preferred = preferredProvider?.label ?? "another manager";
  return '<div class="provider-advice">No automatic retry was sent. You can switch managers and try '+esc(preferred)+'.</div>';
}
function parseFailureStatus(errorJson, fallback="Manager turn failed.") {
  if (!errorJson) return null;
  try {
    const parsed = JSON.parse(errorJson);
    const code = parsed.code || "error";
    return {
      message: parsed.message || code || fallback,
      soft: isSoftFailureCode(code),
    };
  } catch {
    return { message: errorJson, soft: false };
  }
}
function failedTurnStatus(turn) {
  if (!turn || turn.status !== "failed" || !turn.errorJson) return null;
  return parseFailureStatus(turn.errorJson);
}
async function pollOperation(operationId, conversationId, label="Manager turn") {
  if (chat.activityHideTimer) {
    clearTimeout(chat.activityHideTimer);
    chat.activityHideTimer = null;
  }
  chat.activityRetained = false;
  chat.activityDisplayUntil = 0;
  chat.lastShownToolStep = 0;
  chat.activeOperation = { id: operationId, conversationId };
  chat.activeActivity = null;
  chat.activeActivityRaw = null;
  setChatEnabled(false);
  setChatStatus(label+" running...");
  // Show the working indicator immediately so fast turns still signal liveness.
  updateManagerWorking();
  try {
    while (true) {
      const operation = await api("/operations/"+encodeURIComponent(operationId));
      if (operation.activity) {
        chat.activeActivityRaw = operation.activity || null;
        chat.activeActivity = chooseVisibleActivity(operation.activity) || null;
        updateManagerWorking();
      }
      if (["queued","running"].includes(operation.status)) {
        // keep polling
      }
      if (!["queued","running"].includes(operation.status)) {
        chat.pendingTurn = null;
        if (operation.status === "succeeded") {
          if (chat.statusError?.conversationId === conversationId) chat.statusError = null;
          await refreshConversation(conversationId);
          if (currentConversation()?.id === conversationId) {
            setChatStatus("Ready. Manager voice: "+chat.agent+".");
          }
        } else if (operation.status === "cancelled") {
          const message = "Active work cancelled.";
          chat.statusError = { conversationId, message, soft: true };
          await refreshConversation(conversationId);
          if (currentConversation()?.id === conversationId) setChatStatus(message, false);
        } else {
          const failure = parseFailureStatus(operation.errorJson, label+" "+operation.status+".");
          const message = failure
            ? (failure.soft ? failure.message : label+" "+operation.status+". "+failure.message)
            : label+" "+operation.status+".";
          chat.statusError = { conversationId, message, soft: Boolean(failure?.soft) };
          await refreshConversation(conversationId);
          if (currentConversation()?.id === conversationId) setChatStatus(message, !failure?.soft);
        }
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch (error) {
    setChatStatus(error.message, true);
    refreshConversation(conversationId).catch(()=>{});
  } finally {
    chat.pendingTurn = null;
    if (chat.activeOperation?.id === operationId) {
      if (chat.activeActivity) scheduleWorkingBubbleClear();
      else clearWorkingBubbleNow();
    }
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
  chat.activeOperation = { id: operation.id, conversationId: conversation.id };
  chat.pendingTurn = null;
  const pollPromise = pollOperation(operation.id, conversation.id);
  await refreshConversation(conversation.id);
  await pollPromise;
}
q("chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = q("chat-input").value.trim();
  if (!text || chatIsBusyForCurrentView()) return;
  const original = q("chat-input").value;
  const existingConversation = currentConversation();
  if (existingConversation && chat.statusError?.conversationId === existingConversation.id) {
    chat.statusError = null;
  }
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
    q("chat-turns").insertAdjacentHTML("beforeend", renderPendingTurn());
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
    const conv = currentConversation();
    if (conv) refreshConversation(conv.id).catch(()=>{});
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
  updateComposerAction();
});
q("chat-send").onclick = async () => {
  if (chatIsBusyForCurrentView()) {
    await stopActiveWork().catch(error => showError(error.message));
    return;
  }
  if (q("chat-form").requestSubmit) q("chat-form").requestSubmit();
  else q("chat-form").dispatchEvent(new Event("submit", { cancelable: true }));
};
q("manager-voices").addEventListener("click", async (event) => {
  const toggle = event.target.closest("[data-provider-menu-toggle]");
  if (toggle) {
    managerProviderMenuOpen = !managerProviderMenuOpen;
    renderManagerProviders();
    return;
  }
  const button = event.target.closest("[data-agent]");
  if (!button) return;
  const provider = managerProviderById(button.dataset.agent);
  if (provider && !provider.available) {
    setChatStatus(provider.label+" is not configured. Add its API key or choose another manager.");
    return;
  }
  chat.agent = button.dataset.agent;
  managerProviderMenuOpen = false;
  await loadChat().catch(error => setChatStatus(error.message, true));
});
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
    const p=item.payload||{};
    let label="";
    switch(item.type){
      case "provider.attempt_started": label="▶ "+(p.provider||"agent")+" — "+(p.role||"worker"); break;
      case "provider.attempt_finished": label="■ "+(p.provider||"agent")+" — "+(p.status||"done"); break;
      case "provider.turn_completed": label="✓ turn done"; break;
      case "task.updated": label="task → "+(p.status||"?"); break;
      case "run.updated": label="run → "+(p.status||"?"); break;
      case "chat.turn.created": label="message received"; break;
      case "chat.turn.completed": label="manager replied"; break;
      case "chat.proposal.created": label="proposal created — "+(p.action||""); break;
      case "chat.proposal.started": label="proposal started"; break;
      case "operation.created": case "operation.updated": label=""; break;
      default: label=item.type;
    }
    if(!label) { renderedEventSeqs.delete(item.seq); } else {
    const line=document.createElement("div");
    line.className="ev "+sev;
    const parsed=new Date(item.occurredAt);
    const ts=isNaN(parsed.getTime())?item.occurredAt:parsed.toLocaleTimeString();
    line.innerHTML='<time>'+esc(ts)+'</time><span class="ty">'+esc(label)+'</span>';
    q("events").prepend(line);
    }
    if((item.type && item.type.indexOf("run.")===0)||item.type==="task.updated") loadRuns().catch(()=>{});
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
      const TERMINAL_OP = new Set(["succeeded","failed","cancelled","interrupted"]);
      if(chat.activeOperation && chat.activeOperation.id === item.operationId && item.payload && TERMINAL_OP.has(item.payload.status)) {
        refreshConversation(chat.activeOperation.conversationId).catch(()=>{});
      }
    }
  });
  stream.addEventListener("duet.reset",()=>location.reload());
  stream.onerror=()=>{
    if(eventStream===stream) setConn("reconnecting");
    setTimeout(async ()=>{
      if (eventStream !== stream) return;
      // A dropped stream usually means the service restarted (e.g. npm run up).
      // After a restart the browser may hold stale pooled connections that hang
      // (notably behind a VPN). A full reload drops the pool, re-auths, and picks
      // up fresh assets. Reload when the instance changed OR when health is
      // unreachable after we had a good boot — both indicate a stale connection.
      try {
        const h = await api("/health", { timeoutMs: 5000 });
        if (bootInstanceId && h.instanceId && h.instanceId !== bootInstanceId) {
          return reloadOnce();
        }
      } catch (e) {
        if (bootInstanceId) return reloadOnce();
      }
      if (eventStream === stream) { stream.close(); eventStream=null; connectEvents(); }
    },2000);
  };
}
// Reload at most once per cooldown so a genuinely-down service cannot loop.
function reloadOnce() {
  const now = Date.now();
  const last = Number(sessionStorage.getItem("duet-last-reload") || "0");
  if (now - last < 15000) return;
  sessionStorage.setItem("duet-last-reload", String(now));
  location.reload();
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
  const sectionNames=["runs","tasks","timeline","verification","messages","artifacts","conflicts","diff","memory"];
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
try{const h=await api("/health");bootInstanceId=h.instanceId;if(Array.isArray(h.managerProviders)){managerProviders=h.managerProviders;normalizeSelectedManagerProvider();renderManagerProviders();}q("health").textContent="healthy - "+h.instanceId;q("health").className="pill ok";await loadRuns({selectCurrent:true});if(!selected){connectEvents();await loadChat();}}
catch(error){q("health").textContent=error.message;q("health").className="pill bad"}
`;
