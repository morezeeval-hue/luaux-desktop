/* Guided mode: the tutor walks a section, then asks about it.
 *
 * A section plays as a short session with a visible end: the beats first,
 * then its questions, then a summary. Wrong answers push their concept into
 * the drill queue held in LuauProgress, so Practice can come back to the
 * idea rather than replaying the whole lesson.
 *
 * Rendering is deliberately plain. The learner should always see one thing
 * to read and one thing to do.
 */
window.LuauGuided = (function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let state = null;   // { sectionID, stage, beat, q, answers[], drilled[] }

  function script(sectionID) {
    const all = LuauData.current.lessonScripts;
    return all && all.sections ? all.sections[String(sectionID)] : null;
  }

  function has(sectionID) { return !!script(sectionID); }

  function start(sectionID) {
    const s = script(sectionID);
    if (!s) return false;
    state = { sectionID, stage: "beat", beat: 0, q: 0, answers: [], picked: null, checked: false };
    LuauSpeech.speak(s.beats[0].say);
    return true;
  }

  /* ---------------------------------------------------------------- chrome */

  /* The neural voice is worth having but it is a download, so it is offered
     once, where the tutor actually starts talking, rather than fetched
     behind the learner's back or buried in settings. */
  const OFFER_KEY = "luaux.speech.offered";

  function offerHTML() {
    const S = window.LuauSpeech;
    if (!S || typeof S.piperAvailable !== "function" || !S.piperAvailable()) return "";
    if (localStorage.getItem(OFFER_KEY) === "1") return "";
    const voices = S.voices().filter((v) => v.backend === "piper");
    if (!voices.length || voices.some((v) => v.installed)) return "";

    const busy = S.installing();
    if (busy) {
      const p = S.progress();
      const pct = p && p.total ? Math.round((p.received / p.total) * 100) : 0;
      return `<div class="g-offer"><span>Downloading the tutor voice, ${pct}%. The lesson carries on meanwhile.</span></div>`;
    }
    const first = voices[0];
    return `<div class="g-offer">
      <span>A real tutor voice is available, ${Math.round(first.bytes / 1e6)} MB once, then offline.</span>
      <button class="g-offer-yes" id="g-voice-get">Download ${esc(first.label)}</button>
      <button class="g-offer-no" id="g-voice-no">Not now</button>
    </div>`;
  }

  function shell(sectionID, bodyHTML, progressFraction) {
    const data = LuauData.current;
    const section = data.section(sectionID);
    const unit = data.unitForSection(sectionID);
    const pct = Math.round(Math.max(0, Math.min(1, progressFraction)) * 100);
    return `<div class="guided">
      <header class="g-head">
        <button class="g-exit" id="g-exit" aria-label="Leave lesson">Leave</button>
        <div class="g-meter"><i style="width:${pct}%"></i></div>
        <button class="g-mute" id="g-mute" aria-pressed="${LuauSpeech.isMuted()}">
          ${LuauSpeech.isMuted() ? "Sound off" : "Sound on"}
        </button>
      </header>
      <div class="g-where">${unit ? esc(unit.name) : ""} &middot; ${esc(section ? section.title : "")}</div>
      ${offerHTML()}
      ${bodyHTML}
    </div>`;
  }

  /* ----------------------------------------------------------------- beats */

  function renderBeat() {
    const s = script(state.sectionID);
    const beat = s.beats[state.beat];
    const total = s.beats.length + s.questions.length;
    const body = `
      <div class="g-card g-beat">
        <p class="g-say">${esc(beat.say)}</p>
        ${beat.code ? `<pre class="g-code"><code>${window.LuauHighlight(beat.code)}</code></pre>` : ""}
      </div>
      <div class="g-actions">
        <button class="g-secondary" id="g-again">Say it again</button>
        <button class="g-primary" id="g-next">${state.beat < s.beats.length - 1 ? "Next" : "Start the questions"}</button>
      </div>`;
    return shell(state.sectionID, body, state.beat / total);
  }

  /* ------------------------------------------------------------- questions */

  function renderQuestion() {
    const s = script(state.sectionID);
    const q = s.questions[state.q];
    const total = s.beats.length + s.questions.length;
    const done = s.beats.length + state.q;

    let input = "";
    if (q.type === "choice" || q.type === "bug") {
      input = '<div class="g-options">' + q.options.map((o, i) =>
        `<button class="g-option${state.picked === i ? " picked" : ""}${
          state.checked ? (i === q.answer ? " right" : (state.picked === i ? " wrong" : "")) : ""
        }" data-opt="${i}"${state.checked ? " disabled" : ""}>${esc(o)}</button>`).join("") + "</div>";
    } else if (q.type === "order") {
      const picked = Array.isArray(state.picked) ? state.picked : [];
      const remaining = q.options.map((_, i) => i).filter((i) => !picked.includes(i));
      input = `<p class="g-order-help">Choose each step in the intended order.</p>
        <ol class="g-order-picked">${picked.map((i) => `<li>${esc(q.options[i])}</li>`).join("")}</ol>
        <div class="g-options">${remaining.map((i) =>
          `<button class="g-option" data-order="${i}"${state.checked ? " disabled" : ""}>${esc(q.options[i])}</button>`
        ).join("")}</div>
        ${state.checked ? "" : '<button class="g-order-reset" id="g-order-reset">Clear order</button>'}`;
    } else {
      input = `<input class="g-input" id="g-answer" autocomplete="off" spellcheck="false"
        placeholder="${q.type === "blank" ? "Fill in the blank" : "Type your answer"}"${state.checked ? " disabled" : ""}
        value="${state.picked == null ? "" : esc(state.picked)}">`;
    }

    let feedback = "";
    if (state.checked) {
      const ok = isCorrect(q, state.picked);
      feedback = `<div class="g-feedback ${ok ? "ok" : "no"}">
        <div class="g-verdict">${ok ? "Correct" : "Not quite"}</div>
        <div class="g-explain">${esc(q.explain)}</div>
      </div>`;
    }

    const body = `
      <div class="g-card">
        <p class="g-ask">${esc(q.ask)}</p>
        ${q.code ? `<pre class="g-code"><code>${window.LuauHighlight(q.code)}</code></pre>` : ""}
        ${input}
      </div>
      ${feedback}
      <div class="g-actions">
        ${state.checked
          ? `<button class="g-primary" id="g-continue">${state.q < s.questions.length - 1 ? "Next question" : "Finish"}</button>`
          : `<button class="g-primary" id="g-check">Check</button>`}
      </div>`;
    return shell(state.sectionID, body, done / total);
  }

  /* Answer checking stays deliberately forgiving on the typed questions:
     case and surrounding space never decide whether someone understood. */
  function isCorrect(q, given) {
    if (q.type === "choice" || q.type === "bug") return given === q.answer;
    if (q.type === "order") return Array.isArray(q.answer) && Array.isArray(given) &&
      given.length === q.answer.length && given.every((item, index) => item === q.answer[index]);
    const norm = (v) => String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, " ");
    const want = [q.answer].concat(q.accept || []).map(norm);
    return want.includes(norm(given));
  }

  /* --------------------------------------------------------------- summary */

  function renderSummary() {
    const s = script(state.sectionID);
    const right = state.answers.filter(Boolean).length;
    const total = state.answers.length;
    const missed = s.questions.filter((q, i) => !state.answers[i]);
    const data = LuauData.current;
    const i = data.journeyIndex("read", state.sectionID);
    const next = i >= 0 ? data.neighbours(i).next : null;

    const body = `
      <div class="g-card g-summary">
        <div class="g-score">${right} of ${total}</div>
        <p class="g-say">${right === total
          ? "Every question right. That section is solid."
          : "Worth another look at " + missed.length + (missed.length === 1 ? " idea" : " ideas") + ". They will come back in Practice."}</p>
        ${missed.length ? '<ul class="g-missed">' + missed.map((q) =>
          `<li>${esc(q.ask)}</li>`).join("") + "</ul>" : ""}
      </div>
      <div class="g-actions">
        <button class="g-secondary" id="g-redo">Run it again</button>
        ${next ? `<button class="g-primary" id="g-onward">Continue the course</button>` : ""}
      </div>`;
    return shell(state.sectionID, body, 1);
  }

  /* ----------------------------------------------------------------- wiring */

  function render() {
    if (!state) return "";
    if (state.stage === "beat") return renderBeat();
    if (state.stage === "question") return renderQuestion();
    return renderSummary();
  }

  function bind(rerender, leave) {
    const exit = $("#g-exit");
    if (exit) exit.addEventListener("click", () => { LuauSpeech.stop(); state = null; leave(); });

    const mute = $("#g-mute");
    if (mute) mute.addEventListener("click", () => { LuauSpeech.setMuted(!LuauSpeech.isMuted()); rerender(); });

    const getVoice = $("#g-voice-get");
    if (getVoice) getVoice.addEventListener("click", () => {
      const first = LuauSpeech.voices().filter((v) => v.backend === "piper")[0];
      if (!first) return;
      LuauSpeech.install(first.id)
        .then(() => { LuauSpeech.setVoice(first.id); localStorage.setItem(OFFER_KEY, "1"); })
        .catch(() => {})
        .then(() => rerender());
      rerender();
    });
    const noVoice = $("#g-voice-no");
    if (noVoice) noVoice.addEventListener("click", () => {
      localStorage.setItem(OFFER_KEY, "1");
      rerender();
    });

    const s = script(state.sectionID);

    if (state.stage === "beat") {
      const again = $("#g-again");
      if (again) again.addEventListener("click", () => LuauSpeech.speak(s.beats[state.beat].say));
      const next = $("#g-next");
      if (next) next.addEventListener("click", () => {
        if (state.beat < s.beats.length - 1) {
          state.beat += 1;
          LuauSpeech.speak(s.beats[state.beat].say);
        } else {
          state.stage = "question";
          state.picked = null;
          state.checked = false;
          LuauSpeech.speak(s.questions[0].ask);
        }
        rerender();
      });
      return;
    }

    if (state.stage === "question") {
      const q = s.questions[state.q];
      document.querySelectorAll("[data-opt]").forEach((el) =>
        el.addEventListener("click", () => { state.picked = Number(el.dataset.opt); rerender(); }));
      document.querySelectorAll("[data-order]").forEach((el) =>
        el.addEventListener("click", () => {
          const picked = Array.isArray(state.picked) ? state.picked : [];
          picked.push(Number(el.dataset.order));
          state.picked = picked;
          rerender();
        }));
      const resetOrder = $("#g-order-reset");
      if (resetOrder) resetOrder.addEventListener("click", () => { state.picked = []; rerender(); });

      const field = $("#g-answer");
      if (field) {
        field.addEventListener("input", () => { state.picked = field.value; });
        field.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !state.checked) { state.picked = field.value; check(); }
        });
        if (!state.checked) field.focus();
      }
      const checkBtn = $("#g-check");
      if (checkBtn) checkBtn.addEventListener("click", check);

      const cont = $("#g-continue");
      if (cont) cont.addEventListener("click", () => {
        if (state.q < s.questions.length - 1) {
          state.q += 1;
          state.picked = s.questions[state.q].type === "order" ? [] : null;
          state.checked = false;
          LuauSpeech.speak(s.questions[state.q].ask);
        } else {
          state.stage = "summary";
          LuauProgress.markGuidedDone(state.sectionID);
          LuauProgress.setSectionDone(state.sectionID, true);
          LuauSpeech.stop();
        }
        rerender();
      });

      function check() {
        if (state.checked) return;
        if (state.picked == null || state.picked === "" || (Array.isArray(state.picked) && !state.picked.length)) return;
        state.checked = true;
        const ok = isCorrect(q, state.picked);
        state.answers[state.q] = ok;
        LuauProgress.recordAnswer(q.concept, ok);
        rerender();
      }
      return;
    }

    const redo = $("#g-redo");
    if (redo) redo.addEventListener("click", () => { start(state.sectionID); rerender(); });
    const onward = $("#g-onward");
    if (onward) onward.addEventListener("click", () => { const id = state.sectionID; state = null; leave(id); });
  }

  return {
    has, start, render, bind,
    isActive() { return !!state; },
    sectionID() { return state ? state.sectionID : null; },
    stop() { LuauSpeech.stop(); state = null; },
  };
})();
