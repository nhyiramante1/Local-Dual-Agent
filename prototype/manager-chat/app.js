/*
 * Manager-chat prototype controller — vanilla, fixture-driven, standalone.
 *
 * Nothing here calls a network or a real service. Every "result" is scripted
 * from window.DUET_FIXTURES. The point is to exercise the INTERACTION MODEL:
 *   - Manager is a role/voice (the selected interface agent), not a third agent.
 *   - /switch changes the interface agent only; planner/implementer/reviewer
 *     are independent and never change here.
 *   - Three confirmation tiers: strong (fingerprint -> typed confirm -> ticket
 *     minted & consumed), ordinary (plain confirm), immediate (reads).
 */
(function () {
  "use strict";
  var F = window.DUET_FIXTURES;
  var state = { roles: Object.assign({}, F.roles), consumed: {} };

  var stream = document.getElementById("stream");
  var rolesEl = document.getElementById("roles");
  var runSummary = document.getElementById("run-summary");
  var chipsEl = document.getElementById("chips");
  var input = document.getElementById("input");
  var sendBtn = document.getElementById("send");

  function esc(v) {
    var d = document.createElement("div");
    d.textContent = String(v == null ? "" : v);
    return d.innerHTML;
  }
  function cap(s) {
    s = String(s || "");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function stamp() {
    return new Date().toLocaleTimeString();
  }
  function mkToken() {
    return "tkt_" + Math.random().toString(36).slice(2, 10);
  }
  function mgrTag() {
    return '<span class="tag mgr">Manager: ' + cap(state.roles.interface) + "</span>";
  }
  function taskIds() {
    return F.tasks.map(function (t) { return t.id; });
  }

  // --- message rendering -----------------------------------------------------
  function addMessage(opts) {
    var wrap = document.createElement("div");
    wrap.className = "msg " + opts.role;
    if (opts.metaHtml) {
      var meta = document.createElement("div");
      meta.className = "meta";
      meta.innerHTML = opts.metaHtml;
      wrap.appendChild(meta);
    }
    var body = document.createElement("div");
    body.className = "body";
    if (opts.html !== undefined) body.innerHTML = opts.html;
    else if (opts.text !== undefined) body.textContent = opts.text;
    if (opts.node) body.appendChild(opts.node);
    wrap.appendChild(body);
    stream.appendChild(wrap);
    stream.scrollTop = stream.scrollHeight;
    return wrap;
  }
  function youMsg(text) {
    addMessage({ role: "you", text: text });
  }
  function managerMsg(html, node) {
    addMessage({ role: "manager", metaHtml: mgrTag(), html: html, node: node });
  }
  function agentMsg(agent, subrole, text) {
    var cls = subrole === "implementer" ? "imp" : "rev";
    addMessage({
      role: "agent",
      metaHtml:
        '<span class="tag ' + cls + '">' + agent.toUpperCase() + " · " + subrole.toUpperCase() + "</span>",
      text: text,
    });
  }
  function systemMsg(text) {
    addMessage({ role: "system", text: text });
  }

  // --- rail ------------------------------------------------------------------
  function renderRun() {
    var r = F.run;
    runSummary.innerHTML =
      '<div style="font-weight:500;margin-bottom:6px">' + esc(r.goal) + "</div>" +
      '<div class="kv"><span>status</span><span class="badge s-running">' + esc(r.status) + "</span></div>" +
      '<div class="kv"><span>version</span><span>' + esc(r.version) + "</span></div>" +
      '<div class="kv"><span>base</span><span class="muted">' + esc(r.baseBranch) + "@" + esc(r.baseCommit) + "</span></div>" +
      '<div class="kv"><span>id</span><span class="muted">' + esc(r.id) + "</span></div>";
  }
  function roleRow(label, agent, active) {
    return (
      '<div class="role ' + (active ? "active" : "") + '">' +
      '<div class="who"><span class="lbl">' + label + "</span>" +
      '<span class="name agent-' + esc(agent) + '">' + cap(agent) + "</span></div>" +
      (active ? '<span class="badge s-running">voicing manager</span>' : "") +
      "</div>"
    );
  }
  function renderRoles() {
    var r = state.roles;
    rolesEl.innerHTML =
      roleRow("Interface agent", r.interface, true) +
      roleRow("Planner", r.planner, false) +
      roleRow("Implementer", r.implementer, false) +
      roleRow("Reviewer", r.reviewer, false) +
      '<div class="switch-row">' +
      '<button data-switch="claude">/switch claude</button>' +
      '<button data-switch="codex">/switch codex</button>' +
      "</div>";
    var btns = rolesEl.querySelectorAll("[data-switch]");
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.onclick = function () {
          send("/switch " + b.getAttribute("data-switch"));
        };
      })(btns[i]);
    }
  }
  var CHIPS = ["/status", "/tasks", "/plan add a /readyz endpoint", "/run", "/retry task-2", "/approve plan", "/merge", "/switch codex", "/help"];
  function renderChips() {
    chipsEl.innerHTML = CHIPS.map(function (c) {
      return '<span class="chip">' + esc(c) + "</span>";
    }).join("");
    var chips = chipsEl.querySelectorAll(".chip");
    for (var i = 0; i < chips.length; i++) {
      (function (el) {
        el.onclick = function () {
          send(el.textContent);
        };
      })(chips[i]);
    }
  }

  // --- command routing -------------------------------------------------------
  var READ = { help: 1, status: 1, tasks: 1, diff: 1, logs: 1 };
  var ORDINARY = { plan: 1, run: 1, resume: 1, retry: 1, resolve: 1, cancel: 1, cleanup: 1 };
  var STRONG = { approve: 1, merge: 1 };

  function send(raw) {
    raw = (raw || "").trim();
    if (!raw) return;
    youMsg(raw);
    input.value = "";
    var parsed = parse(raw);
    if (!parsed) {
      managerMsg(esc(F.replies.unknown));
      return;
    }
    dispatch(parsed);
  }
  function parse(raw) {
    if (raw.charAt(0) === "/") {
      var bits = raw.slice(1).split(/\s+/);
      return { cmd: bits[0].toLowerCase(), args: bits.slice(1) };
    }
    return nlParse(raw);
  }
  function nlParse(text) {
    var t = text.toLowerCase();
    if (/\bswitch\b|\btalk to\b|\bvoice\b/.test(t)) {
      if (t.indexOf("codex") >= 0) return { cmd: "switch", args: ["codex"] };
      if (t.indexOf("claude") >= 0) return { cmd: "switch", args: ["claude"] };
    }
    // Approval stage must be explicit — never guess plan vs merge.
    if (t.indexOf("approve") >= 0 && t.indexOf("merge") >= 0) return { cmd: "approve", args: ["merge"] };
    if (t.indexOf("approve") >= 0 && t.indexOf("plan") >= 0) return { cmd: "approve", args: ["plan"] };
    if (t.indexOf("approve") >= 0) return { cmd: "approve", args: [] };
    if (/\b(final merge|merge it|do the merge|perform the merge)\b/.test(t)) return { cmd: "merge", args: [] };
    if (/\bmerge\b/.test(t)) return { cmd: "merge", args: [] };
    if (/\b(run|execute|start)\b/.test(t)) return { cmd: "run", args: [] };
    if (/\bresume\b/.test(t)) return { cmd: "resume", args: [] };
    if (/\bretry\b/.test(t)) return { cmd: "retry", args: pickTask(t) };
    if (/\bresolve\b/.test(t)) return { cmd: "resolve", args: pickTask(t) };
    if (/\b(cancel|stop|abort)\b/.test(t)) return { cmd: "cancel", args: pickTask(t) };
    if (/\bclean\s?up\b/.test(t)) return { cmd: "cleanup", args: [] };
    if (/\bplan\b/.test(t)) return { cmd: "plan", args: [text] };
    if (/\b(status|state|how)\b/.test(t)) return { cmd: "status", args: [] };
    if (/\btasks?\b/.test(t)) return { cmd: "tasks", args: [] };
    if (/\b(diff|changes?)\b/.test(t)) return { cmd: "diff", args: [] };
    if (/\b(logs?|messages?)\b/.test(t)) return { cmd: "logs", args: [] };
    if (/\bhelp\b/.test(t)) return { cmd: "help", args: [] };
    return null;
  }
  // Pull a known task id out of free text, e.g. "retry task-2".
  function pickTask(t) {
    var hit = taskIds().filter(function (id) { return t.indexOf(id.toLowerCase()) >= 0; });
    return hit.length ? [hit[0]] : [];
  }
  function dispatch(p) {
    if (p.cmd === "switch") return doSwitch(p.args);
    if (READ[p.cmd]) return doRead(p.cmd);
    if (ORDINARY[p.cmd]) return proposeOrdinary(p.cmd, p.args);
    if (STRONG[p.cmd]) return proposeStrong(p.cmd, p.args);
    managerMsg(esc(F.replies.unknown));
  }

  // --- reads (immediate) -----------------------------------------------------
  function doRead(cmd) {
    if (cmd === "help") {
      managerMsg(
        "<b>Commands</b>" +
          '<div class="kv"><span>reads</span><span class="muted">/status /tasks /diff /logs</span></div>' +
          '<div class="kv"><span>actions</span><span class="muted">/plan &lt;goal&gt; /run /resume /retry &lt;task&gt; /resolve &lt;task&gt; /cancel [task] /cleanup</span></div>' +
          '<div class="kv"><span>approvals</span><span class="muted">/approve plan · /approve merge · /merge</span></div>' +
          '<div class="kv"><span>control</span><span class="muted">/switch claude|codex</span></div>'
      );
      return;
    }
    if (cmd === "status") {
      managerMsg(esc(F.replies.status));
      return;
    }
    if (cmd === "tasks") {
      var rows = F.tasks
        .map(function (t) {
          return (
            '<div class="kv"><span>' + esc(t.id) + " · " + esc(t.title) + "</span>" +
            '<span class="badge s-' + esc(t.status) + '">' + esc(t.status) + "</span></div>"
          );
        })
        .join("");
      managerMsg("<b>Tasks</b>" + rows);
      return;
    }
    if (cmd === "diff") {
      var pre = document.createElement("pre");
      pre.style.cssText =
        "white-space:pre-wrap;background:#0e1217;border:1px solid #262d38;padding:11px;border-radius:8px;font:12px ui-monospace,Menlo,monospace;margin:6px 0 0;overflow:auto";
      pre.textContent = F.diff;
      managerMsg(esc(F.replies.diff), pre);
      return;
    }
    if (cmd === "logs") {
      var msgs = F.messages
        .map(function (m) {
          return '<div class="kv"><span>' + esc(m.kind) + '</span><span class="muted">' + esc(m.body) + "</span></div>";
        })
        .join("");
      managerMsg("<b>Messages</b>" + msgs);
      return;
    }
  }

  // --- switch (control, immediate) ------------------------------------------
  function doSwitch(args) {
    var target = (args[0] || "").toLowerCase();
    if (target !== "claude" && target !== "codex") {
      managerMsg("Which interface agent — claude or codex?");
      return;
    }
    if (state.roles.interface === target) {
      managerMsg(cap(target) + " is already voicing the Manager.");
      return;
    }
    state.roles.interface = target;
    renderRoles();
    systemMsg("Interface agent → " + cap(target) + ". Planner, implementer and reviewer unchanged.");
    managerMsg("Switched. You're now talking to me as " + cap(target) + ". Task-provider assignments are untouched.");
  }

  // --- ordinary tier (plain confirm, no ticket) ------------------------------
  // Targets are preserved, validated and displayed so the operator sees the
  // exact durable command they are approving.
  function proposeOrdinary(cmd, args) {
    args = args || [];
    var target = "";
    var label = cmd;
    if (cmd === "plan") {
      var goal = args.join(" ").trim();
      if (!goal) { managerMsg("What should I plan? Try <code>/plan &lt;goal&gt;</code>."); return; }
      target = goal;
      label = "plan · “" + goal + "”";
    } else if (cmd === "retry" || cmd === "resolve") {
      var taskId = args[0] === "--task" ? args[1] : args[0];
      if (!taskId) {
        managerMsg("Which task? Try <code>/" + cmd + " &lt;taskId&gt;</code> — known tasks: " + esc(taskIds().join(", ")) + ".");
        return;
      }
      if (taskIds().indexOf(taskId) < 0) {
        managerMsg("No task “" + esc(taskId) + "”. Known tasks: " + esc(taskIds().join(", ")) + ".");
        return;
      }
      target = taskId;
      label = cmd + " · " + taskId;
    } else if (cmd === "cancel") {
      var ct = args[0] === "--task" ? args[1] : args[0];
      if (ct) {
        if (taskIds().indexOf(ct) < 0) { managerMsg("No task “" + esc(ct) + "” to cancel."); return; }
        target = ct;
        label = "cancel · " + ct;
      } else {
        label = "cancel · whole run";
      }
    }
    var node = document.createElement("div");
    node.className = "proposal ordinary";
    node.innerHTML =
      '<h3><span class="lvl ordinary">ORDINARY</span> Confirm: ' + esc(label) + "</h3>" +
      '<p class="note">Plain confirmation — no fingerprint, no action ticket. The live service does not ticket-gate <b>' +
      esc(cmd) + "</b>.</p>" +
      '<div class="actions"><button class="primary act-confirm">Confirm</button>' +
      '<button class="act-dismiss">Dismiss</button></div>';
    var confirm = node.querySelector(".act-confirm");
    var dismiss = node.querySelector(".act-dismiss");
    confirm.onclick = function () {
      confirm.disabled = true;
      dismiss.disabled = true;
      var detail = target ? " (" + target + ")" : "";
      var res = document.createElement("div");
      res.className = "result ok";
      res.textContent = "Confirmed — " + (F.replies[cmd + "_done"] || "requested.");
      node.appendChild(res);
      systemMsg(stamp() + "  operation." + cmd + detail + " requested (no ticket)");
      managerMsg(esc(F.replies[cmd + "_done"] || "Done."));
      if (cmd === "run") simulateRun();
    };
    dismiss.onclick = function () {
      confirm.disabled = true;
      dismiss.disabled = true;
      var res = document.createElement("div");
      res.className = "result";
      res.textContent = "Dismissed.";
      node.appendChild(res);
    };
    managerMsg("That's a state change. Quick confirm — no ticket needed:", node);
  }

  // Surface a little duet activity so implementer/reviewer roles are visible.
  function simulateRun() {
    setTimeout(function () {
      agentMsg(state.roles.implementer, "implementer", "Picking up task-2: drafting the /healthz unit test.");
    }, 600);
    setTimeout(function () {
      agentMsg(state.roles.reviewer, "reviewer", "Reviewing task-2 against acceptance criteria.");
    }, 1500);
    setTimeout(function () {
      systemMsg(stamp() + "  provider.turn_completed · task-2");
    }, 2100);
  }

  // --- strong tier (fingerprint -> typed confirm -> single-use ticket) -------
  // Mirrors the real CLI: the fingerprint is shown first; the operator types the
  // stage word to confirm; ONLY THEN is a 60s single-use action ticket minted
  // and immediately consumed. The stage must be exactly "plan" or "merge".
  function proposeStrong(cmd, args) {
    var stage, action, title;
    if (cmd === "merge") {
      stage = "merge";
      action = "merge";
      title = "Final merge";
    } else {
      stage = (args[0] || "").toLowerCase();
      if (stage !== "plan" && stage !== "merge") {
        managerMsg("Which approval — <code>/approve plan</code> or <code>/approve merge</code>? I won't guess the stage.");
        return;
      }
      action = "approve_" + stage;
      title = "Approve " + stage;
    }
    var fp = F.fingerprints[stage];
    var node = document.createElement("div");
    node.className = "proposal strong";
    node.innerHTML =
      '<h3><span class="lvl strong">STRONG</span> ' + esc(title) + "</h3>" +
      '<div class="kv"><span>stage</span><span>' + esc(stage) + "</span></div>" +
      '<div class="kv"><span>fingerprint</span><span class="fp">' + esc(fp) + "</span></div>" +
      '<p class="note">Strong tier — review the fingerprint, then type <b>' + esc(stage) +
      "</b> to confirm. Only then is a single-use, fingerprint-bound action ticket minted and consumed. " +
      "The live service ticket-gates exactly plan approval, merge approval and final merge.</p>" +
      '<div class="confirm-line">' +
      '<input class="confirm-input" type="text" autocomplete="off" placeholder="type &quot;' + esc(stage) + '&quot; to confirm">' +
      '<button class="primary act-confirm">Confirm</button>' +
      '<button class="act-dismiss">Dismiss</button></div>' +
      '<div class="ticket-slot"></div>';
    var confirm = node.querySelector(".act-confirm");
    var dismiss = node.querySelector(".act-dismiss");
    var field = node.querySelector(".confirm-input");
    var slot = node.querySelector(".ticket-slot");
    var done = false;
    confirm.onclick = function () {
      if (done) return;
      if (field.value.trim() !== stage) {
        slot.innerHTML = '<div class="result rej">Did not match — type exactly "' + esc(stage) + '" to confirm.</div>';
        return;
      }
      done = true;
      var token = mkToken(); // minted only AFTER confirmation, mirroring the CLI
      state.consumed[token] = true;
      confirm.disabled = true;
      field.disabled = true;
      slot.innerHTML =
        '<div class="kv"><span>action ticket</span><span class="ticket consumed">' + esc(token) + "</span></div>" +
        '<div class="result ok">Confirmed. Ticket ' + esc(token) + " minted &amp; consumed against fingerprint " + esc(fp) + ".</div>";
      var replayBtn = document.createElement("button");
      replayBtn.className = "act-replay";
      replayBtn.textContent = "Replay ticket";
      slot.appendChild(replayBtn);
      replayBtn.onclick = function () {
        var rej = document.createElement("div");
        rej.className = "result rej";
        rej.textContent = "Replay rejected — action ticket " + token + " was already consumed (single-use).";
        slot.appendChild(rej);
        replayBtn.disabled = true;
      };
      systemMsg(stamp() + "  " + (action === "merge" ? "integration.merge" : "approval.recorded") + " (ticket " + token + " consumed)");
      managerMsg(esc(F.replies[action + "_done"] || F.replies.merge_done));
    };
    dismiss.onclick = function () {
      if (done) return;
      confirm.disabled = true;
      dismiss.disabled = true;
      field.disabled = true;
      slot.innerHTML = '<div class="result">Cancelled — no ticket was minted.</div>';
    };
    field.addEventListener("keydown", function (e) {
      if (e.key === "Enter") confirm.onclick();
    });
    managerMsg("This needs your approval. Review the fingerprint, then type the stage to confirm:", node);
  }

  // --- boot ------------------------------------------------------------------
  sendBtn.onclick = function () {
    send(input.value);
  };
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") send(input.value);
  });

  renderRun();
  renderRoles();
  renderChips();
  systemMsg("Prototype — every response is fixture data. No live service, no real mutations.");
  managerMsg(
    "Hi — I'm the Manager, currently voiced by " + cap(state.roles.interface) +
      ". Ask for status, propose an action, or approve one. Reads run instantly; " +
      "ordinary actions ask for a plain confirm; approvals show a fingerprint and need you to type the stage."
  );
})();
