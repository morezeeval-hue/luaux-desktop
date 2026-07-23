/* LuauX Desktop: vanilla JS shell. One purpose: let the learner study the
 * verified LuauX course and run real Luau, offline, with no account. */
(function () {
  "use strict";
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const KW = { local:1,function:1,end:1,if:1,then:1,else:1,elseif:1,for:1,in:1,do:1,while:1,repeat:1,until:1,return:1,and:1,or:1,not:1,nil:1,true:1,false:1,break:1,continue:1 };
  const BI = { print:1,pairs:1,ipairs:1,setmetatable:1,getmetatable:1,require:1,task:1,game:1,script:1,self:1,typeof:1,tostring:1,tonumber:1,workspace:1,Vector3:1,CFrame:1,Instance:1,RunService:1,TextService:1,warn:1,next:1 };
  function highlight(code) {
    let i = 0, n = code.length, out = "";
    while (i < n) {
      const c = code[i];
      if (c === "-" && code[i + 1] === "-") { let j = i; while (j < n && code[j] !== "\n") j++; out += '<span class="c">' + esc(code.slice(i, j)) + "</span>"; i = j; continue; }
      if (c === '"' || c === "'") { const q = c; let k = i + 1; while (k < n && code[k] !== q) { if (code[k] === "\\") k++; k++; } k = Math.min(k + 1, n); out += '<span class="s">' + esc(code.slice(i, k)) + "</span>"; i = k; continue; }
      if (c >= "0" && c <= "9") { let m = i; while (m < n && /[0-9.xXa-fA-F]/.test(code[m])) m++; out += '<span class="n">' + code.slice(i, m) + "</span>"; i = m; continue; }
      if (/[A-Za-z_]/.test(c)) { let p = i; while (p < n && /[A-Za-z0-9_]/.test(code[p])) p++; const w = code.slice(i, p); out += KW[w] ? '<span class="k">' + w + "</span>" : BI[w] ? '<span class="f">' + w + "</span>" : w; i = p; continue; }
      out += esc(c); i++;
    }
    return out;
  }

  const NAV = [
    { id: "home", label: "Home", ic: "◐" },
    { id: "learn", label: "Journey", ic: "▤" },
    { id: "practice", label: "Practice", ic: "▷" },
    { id: "more", label: "More", ic: "▥" },
  ];
  const MORE_VIEWS = ["reference", "playbook", "you"];

  let route = { view: "home" };

  function go(view, params) {
    route = Object.assign({ view }, params || {});
    render();
  }
  window.LuauNav = { go };

  function renderSidebar() {
    const el = $("#sidebar");
    el.innerHTML =
      '<div class="brand">{ } LuauX</div>' +
      NAV.map((n) => `<button class="navbtn ${(route.view === n.id || (n.id === "more" && MORE_VIEWS.includes(route.view))) ? "active" : ""}" data-nav="${n.id}"><span class="ic">${n.ic}</span>${n.label}</button>`).join("") +
      '<div class="spacer"></div>' +
      `<div class="streak">🔥 ${LuauProgress.streak}-day streak</div>`;
    el.querySelectorAll("[data-nav]").forEach((btn) => btn.addEventListener("click", () => go(btn.dataset.nav)));
  }

  function ring(fraction, size = 56, stroke = 5) {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const off = c * (1 - Math.max(0, Math.min(1, fraction)));
    return `<div class="progress-ring" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}">
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${stroke}"/>
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"/>
      </svg>
      <div class="pct">${Math.round(fraction * 100)}%</div>
    </div>`;
  }

  // ---------- Views ----------

  function viewHome() {
    const data = LuauData.current;
    const journey = LuauProgress.journeyProgress();
    const step = LuauProgress.nextStep();
    const unit = step ? (step.kind === "read" ? data.unitForSection(step.section.id) : step.kind === "exercise" ? data.unit(step.exercise.unitId) : data.unit(step.unitID)) : null;

    let html = '<h1 class="pagetitle">LuauX</h1><p class="subtitle">Offline course. No account, no server.</p>';
    html += `<div class="card row">${ring(journey.total ? journey.done / journey.total : 0)}
      <div><div style="font-weight:600;font-size:15px">${journey.done} of ${journey.total} milestones</div>
      <div style="font-size:12px;color:var(--secondary)">🔥 ${LuauProgress.streak}-day streak</div></div></div>`;

    if (step) {
      html += `<div class="card" id="continue-card" style="cursor:pointer">
        <div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.04em">Continue Journey</div>
        <div style="font-weight:600;font-size:17px;margin-top:6px">${esc(data.stepTitle(step))}</div>
        <div style="font-size:12px;color:var(--secondary);margin-top:4px">${step.kind === "read" ? "Read" : step.kind === "exercise" ? "Code" : "Studio Proof"}${unit ? " · Unit " + unit.id : ""}</div>
      </div>`;
    } else {
      html += `<div class="card">🎓 <strong>Journey complete.</strong> Every section, exercise, and proof is done.</div>`;
    }

    if (LuauProgress.bookmarks.length) {
      html += `<h3 style="margin-top:24px">Bookmarks</h3>`;
      for (const id of LuauProgress.bookmarks) {
        const s = data.section(id);
        if (s) html += `<div class="chapter" data-open-section="${id}"><div class="info"><div class="name">🔖 ${esc(s.title)}</div></div></div>`;
      }
    }

    $("#main").innerHTML = html;
    if (step) $("#continue-card").addEventListener("click", () => openStep(step));
    $("#main").querySelectorAll("[data-open-section]").forEach((el) =>
      el.addEventListener("click", () => go("lesson", { sectionID: Number(el.dataset.openSection) })));
  }

  function openStep(step) {
    if (step.kind === "read") go("lesson", { sectionID: step.section.id });
    else if (step.kind === "exercise") go("runner", { exerciseID: step.exercise.id });
    else go("chapter", { unitID: step.unitID });
  }

  function viewLearn() {
    const data = LuauData.current;
    let html = '<h1 class="pagetitle">Journey</h1><p class="subtitle">10 units, in the recommended order. Nothing is locked.</p>';
    html += '<input class="searchbox" id="search" placeholder="Search lessons, docs, exercises…">';
    html += '<div id="search-results"></div><div id="chapter-list">';
    for (const unit of data.textbook.units) {
      const p = LuauProgress.chapterProgress(unit);
      const completed = p.total > 0 && p.done === p.total;
      const current = !completed && data.currentUnit && data.currentUnit.id === unit.id;
      const skill = data.skillUnit(unit.id);
      html += `<div class="chapter ${completed ? "done" : current ? "current" : ""}" data-unit="${unit.id}">
        <div class="badge">${completed ? "✓" : unit.id}</div>
        <div class="info"><div class="name">${esc(unit.name)}</div><div class="skill">${skill ? esc(skill.skill) : ""}</div></div>
        <div class="count">${p.done}/${p.total}</div>
      </div>`;
    }
    html += "</div>";
    html += `<h3 style="margin-top:26px">Finale · Build Missions</h3>`;
    for (const m of data.learning.missions) {
      const done = LuauProgress.missionCompleted(m);
      html += `<div class="chapter" data-mission="${esc(m.id)}"><div class="badge">${done ? "✓" : "🏁"}</div>
        <div class="info"><div class="name">${esc(m.code)} · ${esc(m.title)}</div><div class="skill">${esc(m.summary)}</div></div></div>`;
    }
    html += `<h3 style="margin-top:26px">Roblox Studio</h3>
      <div class="chapter" data-launchpad="1"><div class="badge">🔨</div><div class="info"><div class="name">${esc(data.launchpad.title)}</div><div class="skill">${data.launchpad.stations.length} stations</div></div></div>
      <div class="chapter" data-builder="1"><div class="badge">🗺</div><div class="info"><div class="name">Builder Paths</div><div class="skill">Milestone plans that pair lessons with real builds</div></div></div>`;

    $("#main").innerHTML = html;
    $("#main").querySelectorAll("[data-unit]").forEach((el) => el.addEventListener("click", () => go("chapter", { unitID: Number(el.dataset.unit) })));
    $("#main").querySelectorAll("[data-mission]").forEach((el) => el.addEventListener("click", () => go("mission", { missionID: el.dataset.mission })));
    const launchpadEl = $("[data-launchpad]"); if (launchpadEl) launchpadEl.addEventListener("click", () => go("launchpad"));
    const builderEl = $("[data-builder]"); if (builderEl) builderEl.addEventListener("click", () => go("builder"));

    $("#search").addEventListener("input", (e) => {
      const q = e.target.value;
      const results = $("#search-results"), list = $("#chapter-list");
      if (q.trim().length < 2) { results.innerHTML = ""; list.style.display = ""; return; }
      list.style.display = "none";
      const hits = data.search(q);
      results.innerHTML = hits.length
        ? hits.map((h) => `<div class="hit" data-hit='${esc(JSON.stringify(h.kind === "section" ? { k: "s", id: h.section.id } : h.kind === "exercise" ? { k: "e", id: h.exercise.id } : { k: "p", url: data.docsURL(h.item) }))}'>
            <div class="t">${esc(h.title)}</div><div class="s">${esc(h.subtitle)}</div></div>`).join("")
        : '<p style="color:var(--secondary);font-size:13px">No results.</p>';
      results.querySelectorAll("[data-hit]").forEach((el) => el.addEventListener("click", () => {
        const hit = JSON.parse(el.dataset.hit);
        if (hit.k === "s") go("lesson", { sectionID: hit.id });
        else if (hit.k === "e") go("runner", { exerciseID: hit.id });
        else window.open(hit.url, "_blank");
      }));
    });
  }

  function viewChapter(unitID) {
    const data = LuauData.current, unit = data.unit(unitID);
    if (!unit) return go("learn");
    const skill = data.skillUnit(unit.id);
    const steps = data.journeySteps(unit);

    let html = `<h1 class="pagetitle">Unit ${unit.id} · ${esc(unit.name)}</h1>`;
    if (skill) html += `<p class="subtitle">${esc(skill.outcome)}</p>`;
    html += '<div class="steplist">';
    for (const step of steps) {
      const done = LuauProgress.isStepDone(step);
      const kind = step.kind === "read" ? "Read" : step.kind === "exercise" ? "Code" : "Studio Proof";
      const icon = done ? "✓" : step.kind === "read" ? "▤" : step.kind === "exercise" ? "▷" : "◆";
      html += `<div class="step" data-step-open="1" data-step='${esc(JSON.stringify(step.kind === "read" ? { k: "read", id: step.section.id } : step.kind === "exercise" ? { k: "ex", id: step.exercise.id } : { k: "proof" }))}'>
        <div class="dot">${icon}</div><div><div class="title">${esc(data.stepTitle(step))}</div><div class="kind">${kind}</div></div></div>`;
    }
    html += "</div>";

    if (skill && skill.proof) {
      const proof = skill.proof;
      html += `<h3 style="margin-top:22px">Studio Proof · ${esc(proof.title)}</h3>`;
      if (proof.brief) html += `<p class="subtitle">${esc(proof.brief)}</p>`;
      (proof.checks || []).forEach((check, i) => {
        const stepID = proof.stepIds[i] || (proof.id + ":step:" + i);
        const done = LuauProgress.isProofStepDone(stepID);
        html += `<div class="step" data-toggle-proof="${esc(stepID)}"><div class="dot">${done ? "✓" : "○"}</div><div class="title">${esc(check)}</div></div>`;
      });
      html += `<p class="subtitle" style="margin-top:8px">Complete these in Roblox Studio, then check them off as evidence.</p>`;
    }

    $("#main").innerHTML = html;
    $("#main").querySelectorAll("[data-step-open]").forEach((el) => el.addEventListener("click", () => {
      const s = JSON.parse(el.dataset.step);
      if (s.k === "read") go("lesson", { sectionID: s.id });
      else if (s.k === "ex") go("runner", { exerciseID: s.id });
      else document.querySelector("[data-toggle-proof]")?.scrollIntoView({ behavior: "smooth" });
    }));
    $("#main").querySelectorAll("[data-toggle-proof]").forEach((el) => el.addEventListener("click", () => {
      LuauProgress.toggleProofStep(el.dataset.toggleProof);
      viewChapter(unitID);
    }));
  }

  function viewLesson(sectionID) {
    const data = LuauData.current, section = data.section(sectionID);
    if (!section) return go("learn");
    const unit = data.unitForSection(sectionID);
    const bp = data.blueprint(sectionID);
    const bookmarked = LuauProgress.isBookmarked(sectionID);
    const done = LuauProgress.isSectionDone(sectionID);

    let html = `<div style="display:flex;justify-content:space-between;align-items:start">
      <div><div style="font-size:12px;color:var(--secondary)">${unit ? esc(unit.name) : ""}</div><h1 class="pagetitle" style="margin-top:2px">${esc(section.title)}</h1></div>
      <div style="display:flex;gap:8px">
        <button class="btn ghost" id="bookmark-btn">${bookmarked ? "🔖" : "🔗"} ${bookmarked ? "Bookmarked" : "Bookmark"}</button>
        ${bp ? '<button class="btn ghost" id="blueprint-btn">📋 Blueprint</button>' : ""}
      </div></div>
      <div class="lesson-body" style="margin-top:14px">${section.html}</div>
      <div class="lesson-actions">
        <button class="btn primary ${done ? "done" : ""}" id="complete-btn">${done ? "✓ Completed" : "Mark Complete"}</button>
      </div>`;
    $("#main").innerHTML = html;
    $("#main").querySelectorAll("pre").forEach((el) => {
      if (!el.querySelector("code")) el.innerHTML = highlight(el.textContent);
    });
    $("#bookmark-btn").addEventListener("click", () => { LuauProgress.toggleBookmark(sectionID); viewLesson(sectionID); });
    $("#complete-btn").addEventListener("click", () => { LuauProgress.setSectionDone(sectionID, !done); viewLesson(sectionID); });
    const bpBtn = $("#blueprint-btn"); if (bpBtn) bpBtn.addEventListener("click", () => showBlueprint(bp));
  }

  function showBlueprint(bp) {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:50";
    let body = `<div style="background:var(--bg);border-radius:16px;max-width:560px;max-height:80vh;overflow-y:auto;padding:24px" onclick="event.stopPropagation()">
      <h2 style="margin-top:0">Blueprint</h2><p><strong>Mission:</strong> ${esc(bp.mission)}</p>`;
    if (bp.mentalModel) body += `<h4>${esc(bp.mentalModel.title)}</h4>` + bp.mentalModel.body.map((b) => `<p>${esc(b)}</p>`).join("");
    if (bp.build) {
      body += `<h4>Build · ${esc(bp.build.title)}</h4><ol>` + bp.build.steps.map((s) => `<li>${esc(s)}</li>`).join("") + "</ol>";
      if (bp.build.code) body += `<pre><code>${highlight(bp.build.code)}</code></pre>`;
    }
    if (bp.verify) body += "<h4>Verify</h4><ul>" + bp.verify.map((v) => `<li>${esc(v)}</li>`).join("") + "</ul>";
    if (bp.debug) {
      body += `<h4>Debug · ${esc(bp.debug.title)}</h4><p>${esc(bp.debug.symptom)}</p>`;
      if (bp.debug.code) body += `<pre><code>${highlight(bp.debug.code)}</code></pre>`;
      body += `<p style="color:var(--secondary)">${esc(bp.debug.diagnosis)}</p>`;
    }
    if (bp.explain) body += `<h4>Explain</h4><p>${esc(bp.explain)}</p>`;
    if (bp.extend) body += `<h4>Extend</h4><p>${esc(bp.extend)}</p>`;
    if (bp.sources) body += "<h4>Sources</h4>" + bp.sources.map((s) => `<p><a href="${esc(s.url)}" target="_blank">${esc(s.label)} ↗</a></p>`).join("");
    body += '<button class="btn primary" onclick="this.closest(\'div[style]\').parentElement.remove()">Close</button></div>';
    overlay.innerHTML = body;
    overlay.addEventListener("click", () => overlay.remove());
    document.body.appendChild(overlay);
  }

  function viewMission(missionID) {
    const data = LuauData.current;
    const mission = data.learning.missions.find((m) => m.id === missionID);
    if (!mission) return go("learn");
    let html = `<h1 class="pagetitle">${esc(mission.title)}</h1><p class="subtitle">${esc(mission.code)} · ${esc(mission.summary)}</p>`;
    if (mission.deliverable) html += `<div class="card"><strong>Deliverable</strong><p>${esc(mission.deliverable)}</p></div>`;
    (mission.acceptance || []).forEach((item, i) => {
      const stepID = mission.stepIds[i] || (mission.id + ":step:" + i);
      const done = LuauProgress.isMissionStepDone(stepID);
      html += `<div class="step" data-toggle-mission="${esc(stepID)}"><div class="dot">${done ? "✓" : "○"}</div><div class="title">${esc(item)}</div></div>`;
    });
    $("#main").innerHTML = html;
    $("#main").querySelectorAll("[data-toggle-mission]").forEach((el) => el.addEventListener("click", () => {
      LuauProgress.toggleMissionStep(el.dataset.toggleMission);
      viewMission(missionID);
    }));
  }

  function viewLaunchpad() {
    const data = LuauData.current;
    let html = `<h1 class="pagetitle">${esc(data.launchpad.title)}</h1><p class="subtitle">${esc(data.launchpad.intro)}</p>`;
    for (const st of data.launchpad.stations) {
      html += `<details class="details-panel"><summary><span class="pill">${esc(st.number)}</span> ${esc(st.title)}</summary>
        <div class="body"><p>${esc(st.body)}</p>${(st.checks||[]).map((c)=>`<p>✓ ${esc(c)}</p>`).join("")}
        ${(st.sources||[]).map((s)=>`<p><a href="${esc(s.url)}" target="_blank">${esc(s.label)} ↗</a></p>`).join("")}</div></details>`;
    }
    $("#main").innerHTML = html;
  }

  function viewBuilder() {
    const data = LuauData.current;
    let html = `<h1 class="pagetitle">Builder Paths</h1><p class="subtitle">Milestone plans pairing lessons with real builds.</p>`;
    for (const key of Object.keys(data.builderos)) {
      const p = data.builderos[key];
      html += `<h3>${esc(p.name)}</h3><p class="subtitle">${esc(p.audience)}</p>`;
      const milestoneSets = p.milestones ? { "": p.milestones } : (p.templates || {});
      for (const tkey in milestoneSets) {
        const list = milestoneSets[tkey];
        if (p.templates && p.templates[tkey]) html += `<h4>${esc(p.templates[tkey].name)}</h4>`;
        list.forEach((m, i) => {
          html += `<div class="step"><div class="dot">${i + 1}</div><div><div class="title">${esc(m.title)}</div><div class="kind">${esc(m.why)}</div></div></div>`;
        });
      }
    }
    $("#main").innerHTML = html;
  }

  function viewPractice() {
    const data = LuauData.current;
    let html = '<h1 class="pagetitle">Practice</h1><p class="subtitle">Real Luau, executed locally in a WebAssembly VM.</p>';
    html += `<div class="chapter" data-run="sandbox"><div class="badge">▷</div><div class="info"><div class="name">General Sandbox</div><div class="skill">Free-form Luau, executed locally</div></div></div>`;
    html += `<h3 style="margin-top:20px">Performance Drills</h3>`;
    for (const ch of data.challenges) {
      if (ch.id === "sandbox") continue;
      html += `<div class="chapter" data-run="${esc(ch.id)}"><div class="badge">📈</div><div class="info"><div class="name">${esc(ch.name)}</div><div class="skill">${esc(ch.level||"")} ${ch.goal ? "· " + esc(ch.goal) : ""}</div></div></div>`;
    }
    for (const unit of data.textbook.units) {
      const exs = data.exercisesIn(unit.id);
      if (!exs.length) continue;
      html += `<h3 style="margin-top:20px">Unit ${unit.id} · ${esc(unit.name)}</h3>`;
      for (const ex of exs) {
        const done = LuauProgress.isExerciseDone(ex.id);
        html += `<div class="chapter" data-runex="${esc(ex.id)}"><div class="badge">${done ? "✓" : "▷"}</div><div class="info"><div class="name">${esc(ex.name)}</div></div></div>`;
      }
    }
    $("#main").innerHTML = html;
    $("#main").querySelectorAll("[data-run]").forEach((el) => el.addEventListener("click", () => go("runner", { challengeID: el.dataset.run })));
    $("#main").querySelectorAll("[data-runex]").forEach((el) => el.addEventListener("click", () => go("runner", { exerciseID: el.dataset.runex })));
  }

  function viewRunner(params) {
    const data = LuauData.current;
    let mode, code, prompt = null, harness = null, title;
    if (params.exerciseID) {
      const ex = data.exercise(params.exerciseID);
      mode = "exercise"; code = ex.starter; prompt = ex.prompt; harness = ex.harness; title = ex.name;
    } else {
      const ch = data.challenges.find((c) => c.id === params.challengeID);
      mode = "challenge"; code = ch.code; title = ch.name;
      window.__currentChallenge = ch;
    }
    window.__currentMode = mode;
    window.__currentExerciseID = params.exerciseID;

    document.title = "LuauX · " + title;
    $("#main").innerHTML = `<div class="runner">
      ${prompt ? `<div class="prompt">${esc(prompt)}</div>` : ""}
      <textarea id="editor" spellcheck="false">${esc(code)}</textarea>
      <div class="console" id="console">${LuauRuntime.isReady ? "Output appears here." : "Starting Luau runtime…"}</div>
      <div class="controls">
        <button class="btn primary" id="run-btn">▷ Run</button>
        ${mode === "exercise" || (window.__currentChallenge && window.__currentChallenge.badPattern) ? '<button class="btn ghost" id="verify-btn">✓ Verify</button>' : ""}
        <button class="btn ghost" id="reset-btn">↺ Reset</button>
      </div></div>`;

    $("#run-btn").addEventListener("click", () => runCode(false, harness));
    const verifyBtn = $("#verify-btn"); if (verifyBtn) verifyBtn.addEventListener("click", () => runCode(true, harness));
    $("#reset-btn").addEventListener("click", () => { $("#editor").value = code; $("#console").textContent = ""; });
  }

  function consoleLine(text, cls) {
    const c = $("#console");
    const div = document.createElement("div");
    if (cls) div.className = cls;
    div.textContent = text;
    c.appendChild(div);
    c.scrollTop = c.scrollHeight;
  }

  async function runCode(verify, harness) {
    const editorCode = $("#editor").value;
    $("#console").textContent = "";
    consoleLine(verify ? "[Verifying…]" : "[Running…]", "system");
    const source = verify && harness ? editorCode + "\n" + harness : editorCode;
    try {
      const result = await LuauRuntime.run(source);
      result.stdout.forEach((l) => consoleLine(l));
      result.stderr.forEach((l) => consoleLine(l, "stderr"));
      if (result.error) consoleLine(result.error, "stderr");
      consoleLine("[exit code " + result.exitCode + "]", "system");
      if (verify) evaluateVerification(result);
    } catch (err) {
      consoleLine(String(err.message || err), "stderr");
    }
  }

  function evaluateVerification(result) {
    if (window.__currentMode === "exercise") {
      const ok = result.exitCode === 0 && !result.error;
      if (ok) {
        LuauProgress.setExerciseDone(window.__currentExerciseID);
        alert("Exercise Completed! Your code passed all runtime assertions.");
      } else {
        alert("Not yet: an assertion failed or the script hit a syntax/runtime error. Check the console.");
      }
      return;
    }
    const ch = window.__currentChallenge;
    if (!ch || !ch.badPattern) return;
    const text = result.stdout.join("\n");
    const bad = firstCapture(ch.badPattern, text), good = firstCapture(ch.goodPattern, text);
    if (result.exitCode !== 0 || bad == null || good == null || good <= 0) {
      alert("Not yet: " + data0strip(ch.failHint || "the benchmark output did not match the expected format."));
      return;
    }
    const margin = bad / good;
    const passed = margin >= ch.threshold;
    alert((passed ? "Passed! " : "Not yet: ") + `Slow: ${bad.toFixed(3)}ms · Fast: ${good.toFixed(3)}ms · Speedup: ${margin.toFixed(2)}x (target ${ch.threshold}x)\n\n` + data0strip(passed ? ch.successMsg : ch.failHint));
  }
  function data0strip(html) { return LuauData.current.stripHTML(html || ""); }
  function firstCapture(pattern, text) {
    const m = new RegExp(pattern).exec(text);
    return m && m[1] != null ? parseFloat(m[1]) : null;
  }

  function viewReference() {
    const data = LuauData.current;
    let html = `<h1 class="pagetitle">Reference</h1><p class="subtitle">${esc(data.path.meta.tagline)}<br><span style="font-size:12px">Source: ${esc(data.path.meta.source)}</span></p>`;
    for (const track of data.path.tracks) {
      html += `<div class="chapter" data-track="${esc(track.id)}"><div class="badge">${track.no}</div><div class="info"><div class="name">${esc(track.name)}</div><div class="skill">${esc(track.blurb)}</div></div></div>`;
    }
    $("#main").innerHTML = html;
    $("#main").querySelectorAll("[data-track]").forEach((el) => el.addEventListener("click", () => go("track", { trackID: el.dataset.track })));
  }

  function viewTrack(trackID) {
    const data = LuauData.current;
    const track = data.path.tracks.find((t) => t.id === trackID);
    if (!track) return go("reference");
    let html = `<h1 class="pagetitle">${esc(track.name)}</h1><p class="subtitle">${esc(track.blurb)}</p>`;
    for (const item of track.items) {
      html += `<details class="details-panel"><summary><span class="pill">${esc(item.t)}</span> ${esc(item.n)}</summary>
        <div class="body"><p>${esc(item.c)}</p>${item.prt ? `<p style="color:var(--secondary)">↳ ${esc(item.prt)}</p>` : ""}
        <p><a href="${esc(data.docsURL(item))}" target="_blank">Open in Roblox Docs ↗</a></p></div></details>`;
    }
    $("#main").innerHTML = html;
  }

  function playbookSectionHTML(playbook) {
    let html = `<h2 style="margin-top:30px">${esc(playbook.title)}</h2><p class="subtitle">${esc(playbook.intro)}</p>`;
    for (const topic of playbook.topics) {
      html += `<details class="details-panel"><summary><strong>${esc(topic.title)}</strong><div style="font-size:12px;color:var(--secondary);margin-top:2px">${esc(topic.summary)}</div></summary>
        <div class="body"><ul>${topic.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`;
      if (topic.metrics) html += topic.metrics.map((m) => `<p><strong>${esc(m.term)}</strong>: ${esc(m.meaning)}</p>`).join("");
      if (topic.sources) html += topic.sources.map((s) => `<p><a href="${esc(s.url)}" target="_blank">${esc(s.label)} ↗</a></p>`).join("");
      html += "</div></details>";
    }
    html += `<p style="margin-top:10px;font-size:11.5px;color:var(--secondary)">${esc(playbook.note)}</p>`;
    return html;
  }

  function viewExtras() {
    const data = LuauData.current;
    let html = '<h1 class="pagetitle">Extras</h1><p class="subtitle">Supplementary modules: game production practice and platform updates, kept separate from the verified course content.</p>';
    html += playbookSectionHTML(data.playbook);
    html += playbookSectionHTML(data.serverAuthority);
    $("#main").innerHTML = html;
  }

  function viewYou() {
    const data = LuauData.current;
    const journey = LuauProgress.journeyProgress();
    let html = `<h1 class="pagetitle">You</h1>`;
    html += `<div class="card">
      <div class="row" style="margin-bottom:10px"><span style="width:150px;color:var(--secondary);font-size:13px">Sections</span><span>${LuauProgress.completedSectionCount} / ${data.textbook.sections.length}</span></div>
      <div class="row" style="margin-bottom:10px"><span style="width:150px;color:var(--secondary);font-size:13px">VM exercises</span><span>${LuauProgress.completedExerciseCount} / ${Object.keys(data.learning.exercises).length}</span></div>
      <div class="row" style="margin-bottom:10px"><span style="width:150px;color:var(--secondary);font-size:13px">Milestones</span><span>${journey.done} / ${journey.total}</span></div>
      <div class="row"><span style="width:150px;color:var(--secondary);font-size:13px">Streak</span><span>${LuauProgress.streak} days</span></div>
    </div>`;
    html += `<div class="card"><div class="row" style="margin-bottom:10px"><span style="width:150px;color:var(--secondary);font-size:13px">Course revision</span><span style="font-family:monospace;font-size:12px">${esc(data.learning.revision.slice(0,12))}</span></div>
      <div class="row"><span style="width:150px;color:var(--secondary);font-size:13px">Documentation</span><a href="${esc(data.path.meta.docsBase)}" target="_blank">${esc(data.path.meta.source)}</a></div></div>`;
    html += `<button class="btn ghost" id="tour-btn" style="margin-top:10px">Show App Tour Again</button>`;
    html += `<button class="btn ghost" id="reset-btn" style="margin-top:10px;color:var(--red)">Reset All Progress</button>`;
    $("#main").innerHTML = html;
    $("#tour-btn").addEventListener("click", () => tourStep(0));
    $("#reset-btn").addEventListener("click", () => {
      if (confirm("Reset all progress? Course content is unchanged.")) { LuauProgress.resetAll(); render(); }
    });
  }

  function viewMore() {
    const journey = LuauProgress.journeyProgress();
    let html = '<h1 class="pagetitle">More</h1><p class="subtitle">Docs, extra reading, and your stats.</p>';
    html += `<div class="chapter" data-go="reference"><div class="badge">▥</div><div class="info">
      <div class="name">Reference</div><div class="skill">Look up syntax, functions, and Roblox APIs</div></div></div>`;
    html += `<div class="chapter" data-go="playbook"><div class="badge">✦</div><div class="info">
      <div class="name">Extras</div><div class="skill">Game production practice and platform deep-dives</div></div></div>`;
    html += `<div class="chapter" data-go="you"><div class="badge">◔</div><div class="info">
      <div class="name">You</div><div class="skill">${journey.done} of ${journey.total} milestones · ${LuauProgress.streak}-day streak</div></div></div>`;
    $("#main").innerHTML = html;
    $("#main").querySelectorAll("[data-go]").forEach((el) => el.addEventListener("click", () => go(el.dataset.go)));
  }

  function render() {
    renderSidebar();
    const main = $("#main");
    main.className = ["lesson", "runner"].includes(route.view) ? "" : "narrow";
    switch (route.view) {
      case "home": viewHome(); break;
      case "learn": viewLearn(); break;
      case "chapter": viewChapter(route.unitID); break;
      case "lesson": viewLesson(route.sectionID); break;
      case "mission": viewMission(route.missionID); break;
      case "launchpad": viewLaunchpad(); break;
      case "builder": viewBuilder(); break;
      case "practice": viewPractice(); break;
      case "runner": viewRunner(route); break;
      case "reference": viewReference(); break;
      case "track": viewTrack(route.trackID); break;
      case "playbook": viewExtras(); break;
      case "you": viewYou(); break;
      case "more": viewMore(); break;
      default: viewHome();
    }
    main.scrollTop = 0;
  }

  LuauProgress.onChange(() => { if (route.view === "home" || route.view === "learn") render(); });

  const ONBOARD_KEY = "luaux.desktop.onboarded.v1";

  const TOUR_STEPS = [
    { navId: null, title: "Welcome to LuauX", body: "An offline course for Luau and Roblox game development. No account, no server: everything you do is saved only on this computer." },
    { navId: "home", title: "Home", body: "Your home base. Always shows what to continue next, your streak, and any bookmarks." },
    { navId: "learn", title: "Journey", body: "Ten units of lessons, in a suggested order. Nothing is locked, jump anywhere." },
    { navId: "practice", title: "Practice", body: "Coding exercises that run on a real Luau engine, right on this computer." },
    { navId: "more", title: "More", body: "Reference docs, extra reading, and your stats live here." },
  ];

  function removeTourUI() {
    const dim = document.getElementById("tour-dim"); if (dim) dim.remove();
    const card = document.getElementById("tour-card"); if (card) card.remove();
  }

  function tourStep(i) {
    removeTourUI();
    if (i >= TOUR_STEPS.length) { localStorage.setItem(ONBOARD_KEY, "1"); return; }
    const step = TOUR_STEPS[i];
    if (step.navId) go(step.navId);

    const dim = document.createElement("div");
    dim.id = "tour-dim";
    const card = document.createElement("div");
    card.id = "tour-card";

    if (step.navId) {
      const target = document.querySelector(`[data-nav="${step.navId}"]`);
      const rect = target.getBoundingClientRect();
      dim.style.cssText = `position:fixed;left:${rect.left - 6}px;top:${rect.top - 6}px;width:${rect.width + 12}px;height:${rect.height + 12}px;border-radius:10px;box-shadow:0 0 0 9999px rgba(0,0,0,.65);z-index:100;pointer-events:none`;
      card.style.cssText = `position:fixed;left:${Math.min(rect.right + 16, window.innerWidth - 300)}px;top:${rect.top}px;background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:18px;width:250px;z-index:101;box-shadow:0 12px 32px rgba(0,0,0,.35)`;
    } else {
      dim.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100";
      card.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:var(--bg);border:1px solid var(--border);border-radius:16px;padding:26px;width:320px;z-index:101;box-shadow:0 12px 32px rgba(0,0,0,.35)";
    }

    card.innerHTML = `<div style="font-weight:700;font-size:16px;margin-bottom:8px">${esc(step.title)}</div>
      <div style="font-size:13px;color:var(--secondary);line-height:1.5;margin-bottom:16px">${esc(step.body)}</div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <button id="tour-skip" style="background:transparent;border:none;color:var(--secondary);cursor:pointer;font-size:12px;padding:4px">Skip</button>
        <button id="tour-next" class="btn primary" style="padding:7px 16px">${i === TOUR_STEPS.length - 1 ? "Done" : "Next"}</button>
      </div>`;
    document.body.appendChild(dim);
    document.body.appendChild(card);
    $("#tour-skip").addEventListener("click", () => { removeTourUI(); localStorage.setItem(ONBOARD_KEY, "1"); });
    $("#tour-next").addEventListener("click", () => tourStep(i + 1));
  }

  function showUpdateBanner(update) {
    const bar = document.createElement("div");
    bar.style.cssText = "position:fixed;bottom:20px;right:20px;background:var(--accent);color:#fff;padding:16px 18px;border-radius:14px;max-width:300px;z-index:90;box-shadow:0 8px 24px rgba(0,0,0,.35)";
    bar.innerHTML = `<div style="font-weight:700;margin-bottom:4px">Update available: v${esc(update.version)}</div>
      <div style="font-size:12px;opacity:.9;margin-bottom:12px">Installs on restart. Your progress stays intact.</div>
      <button id="update-install-btn" style="background:#fff;color:var(--accent);border:none;padding:7px 14px;border-radius:8px;font-weight:700;cursor:pointer">Install &amp; Restart</button>
      <button id="update-dismiss-btn" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5);margin-left:8px;padding:7px 12px;border-radius:8px;cursor:pointer">Later</button>`;
    document.body.appendChild(bar);
    $("#update-dismiss-btn", bar).addEventListener("click", () => bar.remove());
    $("#update-install-btn", bar).addEventListener("click", async () => {
      bar.innerHTML = '<div style="font-weight:600">Downloading update…</div>';
      try {
        await update.downloadAndInstall();
        await window.__TAURI__.process.relaunch();
      } catch (err) {
        bar.innerHTML = `<div style="font-weight:600">Update failed</div><div style="font-size:12px;opacity:.9">${esc(err.message || String(err))}</div>`;
      }
    });
  }

  async function checkForUpdate() {
    if (!window.__TAURI__ || !window.__TAURI__.updater) return;
    try {
      const update = await window.__TAURI__.updater.check();
      if (update) showUpdateBanner(update);
    } catch (err) {
      // Offline or update server unreachable: fail silently, the app works fully offline.
    }
  }

  window.addEventListener("DOMContentLoaded", async () => {
    try {
      await LuauData.load();
      render();
      if (!localStorage.getItem(ONBOARD_KEY)) tourStep(0);
      checkForUpdate();
    } catch (err) {
      $("#main").innerHTML = `<h1 class="pagetitle">Couldn't load course data</h1><p class="subtitle">${esc(err.message)}</p>`;
    }
  });
})();
