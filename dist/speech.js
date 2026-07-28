/* Speech for the guided tutor.
 *
 * One interface, two backends. Piper is the real one: a neural voice that
 * runs on this machine, fetched once when it is first chosen and offline
 * from then on. The voice the operating system already has stays behind it,
 * so a lesson still speaks before anything is downloaded, on a build
 * without Piper, or if a voice fails to load.
 *
 * Rules that hold whichever backend is in use:
 *   - the transcript is always on screen, audio never carries meaning alone
 *   - muting is honoured immediately, mid-sentence
 *   - nothing here ever blocks the lesson from continuing
 */
window.LuauSpeech = (function () {
  "use strict";

  const MUTE_KEY = "luaux.speech.muted";
  const VOICE_KEY = "luaux.speech.voice";
  const DEFAULT_PIPER_VOICE = "en_US-ryan-high";

  let muted = localStorage.getItem(MUTE_KEY) === "1";
  let preferred = localStorage.getItem(VOICE_KEY) || "";
  let listeners = [];

  const systemSupported = typeof window.speechSynthesis !== "undefined";
  const tauri = window.__TAURI__ || null;
  const invoke = tauri && tauri.core ? tauri.core.invoke : null;

  /* Piper state. `piper` stays null until the backend has answered once,
     so nothing waits on it at startup. */
  let piper = null;              // { available, reason, voices: [] }
  let installing = null;         // voice id currently downloading
  let progress = null;           // { voice, label, received, total }

  /* Every request carries a token. A result whose token is stale belongs to
     a beat the learner has already moved past, so it is dropped rather than
     played over the top of the current one. */
  let token = 0;
  let audio = null;
  let lastError = "";        // why the neural voice last fell back, if it did

  function notify() { listeners.forEach((fn) => fn()); }

  /* ------------------------------------------------------------- system */

  /* macOS ships a pile of novelty voices (Albert, Boing, Bubbles, Bells,
     Zarvox…) and lists them ahead of the real ones alphabetically. Taking
     the first English voice therefore lands on a cartoon robot, which is
     exactly what a learner hears if the neural voice ever falls back.
     These are never spoken with and never offered. */
  const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|grandma|grandpa|junior|kathy|princess|ralph|fred|rocko|shelley|sandy|eddy|flo|reed|rishi|grandpa|deranged|hysterical|bruce|agnes|victoria)\b/i;

  /* System voices arrive asynchronously in some engines, so ask again on
     the change event rather than caching an empty list at startup. */
  function systemVoices() {
    if (!systemSupported) return [];
    return window.speechSynthesis.getVoices()
      .filter((v) => /^en(-|_)/i.test(v.lang))
      .filter((v) => !NOVELTY.test(v.name))
      .map((v) => ({
        id: "system:" + v.voiceURI,
        label: v.name,
        accent: /GB|UK/i.test(v.lang) ? "British" : /US/i.test(v.lang) ? "American" : v.lang,
        backend: "system",
        installed: true,
        _v: v,
      }));
  }

  /* Which system voice to speak with when nothing better is available. The
     engine's own default is the right answer where it is marked; list order
     is not, it is alphabetical. */
  function bestSystemVoice() {
    const list = systemVoices();
    return list.find((v) => v._v && v._v.default)
      || list.find((v) => /samantha|alex\b|daniel|karen|moira|tessa|serena/i.test(v.label))
      || list[0]
      || null;
  }

  if (systemSupported && typeof window.speechSynthesis.onvoiceschanged !== "undefined") {
    window.speechSynthesis.onvoiceschanged = notify;
  }

  function speakSystem(text) {
    if (!systemSupported) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = systemVoices().find((x) => x.id === preferred) || bestSystemVoice();
      if (v && v._v) { u.voice = v._v; u.lang = v._v.lang; }
      u.rate = 1.0;
      u.pitch = 1.0;
      window.speechSynthesis.speak(u);
    } catch (e) {
      // A failing voice must never stop a lesson.
    }
  }

  /* -------------------------------------------------------------- piper */

  function piperVoices() {
    if (!piper || !piper.available) return [];
    return piper.voices.map((v) => ({
      id: v.id,
      label: v.label,
      accent: v.accent,
      gender: v.gender,
      backend: "piper",
      installed: v.installed,
      bytes: v.bytes,
    }));
  }

  async function refresh() {
    if (!invoke) return;
    try {
      piper = await invoke("piper_status");
    } catch (e) {
      piper = { available: false, reason: String(e), voices: [] };
    }
    notify();
  }

  if (invoke) {
    refresh();
    if (tauri.event && tauri.event.listen) {
      tauri.event.listen("piper-progress", (e) => { progress = e.payload; notify(); });
    }
  }

  function speakPiper(text, voiceID) {
    const mine = ++token;
    invoke("piper_speak", { id: voiceID, text })
      .then((bytes) => {
        if (mine !== token || muted) return;
        stopAudio();
        const blob = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
        audio = new Audio(URL.createObjectURL(blob));
        audio.onended = () => { if (audio) URL.revokeObjectURL(audio.src); };
        audio.play().catch(() => {});
      })
      .catch((e) => {
        /* A voice that will not load should not silence the lesson, but a
           silent fallback is how "why does it sound robotic" goes
           undiagnosed. Keep the reason and let the settings card show it. */
        lastError = String(e && e.message ? e.message : e);
        if (mine === token && !muted) speakSystem(text);
        notify();
      });
  }

  function stopAudio() {
    if (!audio) return;
    try { audio.pause(); URL.revokeObjectURL(audio.src); } catch (e) {}
    audio = null;
  }

  /* --------------------------------------------------------------- api */

  function all() { return piperVoices().concat(systemVoices()); }

  function chosen() {
    const list = all();
    const selected = list.find((v) => v.id === preferred);
    const defaultNeural = list.find((v) => v.id === DEFAULT_PIPER_VOICE && v.installed);
    return (selected && selected.backend === "piper" && selected.installed ? selected : null)
      || defaultNeural
      || selected
      || list.find((v) => v.backend === "piper" && v.installed)
      || list.find((v) => v.backend === "system")
      || list[0]
      || null;
  }

  return {
    onChange(fn) { listeners.push(fn); },

    isSupported() { return systemSupported || !!invoke; },
    isMuted() { return muted; },
    setMuted(v) {
      muted = !!v;
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
      if (muted) this.stop();
      notify();
    },

    voices() { return all(); },
    currentVoice() { return chosen(); },
    setVoice(id) {
      preferred = id || "";
      localStorage.setItem(VOICE_KEY, preferred);
      notify();
    },

    /* What the settings screen needs to explain the state of things. */
    piperAvailable() { return !!(piper && piper.available); },
    piperReason() { return piper ? piper.reason : ""; },
    /* Non-empty once the neural voice has failed and the system voice took
       over, so the learner is told rather than left wondering. */
    lastError() { return lastError; },
    /* Where the engine reads its data from, so a failure on someone else's
       machine can be reported rather than guessed at. */
    dataDir() { return piper ? piper.data_dir || "" : ""; },
    speakingBackend() { const v = chosen(); return v ? v.backend : "none"; },
    installing() { return installing; },
    progress() { return progress; },
    refresh,

    /* Fetches a voice. Resolves once it is on disk and verified, or
       rejects with something worth showing the learner. */
    async install(id) {
      if (!invoke || installing) return;
      installing = id;
      progress = null;
      notify();
      try {
        await invoke("piper_install", { id });
        await refresh();
      } finally {
        installing = null;
        progress = null;
        notify();
      }
    },

    /* Deletes a downloaded voice and moves off it if it was in use. */
    async remove(id) {
      if (!invoke) return;
      await invoke("piper_remove", { id });
      if (preferred === id) this.setVoice("");
      lastError = "";
      await refresh();
    },

    /* Speaks a beat. Returns immediately; the lesson never waits on audio. */
    speak(text) {
      if (muted || !text) return;
      this.stop();
      const v = chosen();
      if (v && v.backend === "piper" && v.installed) speakPiper(text, v.id);
      else speakSystem(text);
    },

    stop() {
      token += 1;
      stopAudio();
      if (systemSupported) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
    },
  };
})();
