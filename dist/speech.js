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

  function notify() { listeners.forEach((fn) => fn()); }

  /* ------------------------------------------------------------- system */

  /* System voices arrive asynchronously in some engines, so ask again on
     the change event rather than caching an empty list at startup. */
  function systemVoices() {
    if (!systemSupported) return [];
    return window.speechSynthesis.getVoices()
      .filter((v) => /^en(-|_)/i.test(v.lang))
      .map((v) => ({
        id: "system:" + v.voiceURI,
        label: v.name,
        accent: /GB|UK/i.test(v.lang) ? "British" : /US/i.test(v.lang) ? "American" : v.lang,
        backend: "system",
        installed: true,
        _v: v,
      }));
  }

  if (systemSupported && typeof window.speechSynthesis.onvoiceschanged !== "undefined") {
    window.speechSynthesis.onvoiceschanged = notify;
  }

  function speakSystem(text) {
    if (!systemSupported) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = systemVoices().find((x) => x.id === preferred) || systemVoices()[0];
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
      .catch(() => {
        // A voice that will not load should not silence the lesson.
        if (mine === token && !muted) speakSystem(text);
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
    return list.find((v) => v.id === preferred)
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
