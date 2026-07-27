/* Speech for the guided tutor.
 *
 * One interface, two backends. Today it uses the voice the operating system
 * already has, which needs no download and works offline immediately. Piper
 * is the intended backend: a local neural model, better voices, still fully
 * offline, with the chosen voice fetched once on first run. It slots in
 * behind `speak` and `voices` without the player knowing which is active.
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

  const supported = typeof window.speechSynthesis !== "undefined";

  function notify() { listeners.forEach((fn) => fn()); }

  /* System voices arrive asynchronously in some engines, so ask again on
     the change event rather than caching an empty list at startup. */
  function systemVoices() {
    if (!supported) return [];
    return window.speechSynthesis.getVoices()
      .filter((v) => /^en(-|_)/i.test(v.lang))
      .map((v) => ({
        id: v.voiceURI,
        label: v.name,
        accent: /GB|UK/i.test(v.lang) ? "British" : /US/i.test(v.lang) ? "American" : v.lang,
        backend: "system",
        _v: v,
      }));
  }

  if (supported && typeof window.speechSynthesis.onvoiceschanged !== "undefined") {
    window.speechSynthesis.onvoiceschanged = notify;
  }

  function pick() {
    const all = systemVoices();
    return all.find((v) => v.id === preferred) || all[0] || null;
  }

  return {
    onChange(fn) { listeners.push(fn); },

    isSupported() { return supported; },
    isMuted() { return muted; },
    setMuted(v) {
      muted = !!v;
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
      if (muted) this.stop();
      notify();
    },

    voices() { return systemVoices(); },
    currentVoice() { return pick(); },
    setVoice(id) {
      preferred = id || "";
      localStorage.setItem(VOICE_KEY, preferred);
      notify();
    },

    /* Speaks a beat. Returns immediately; the lesson never waits on audio. */
    speak(text) {
      if (!supported || muted || !text) return;
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const v = pick();
        if (v && v._v) { u.voice = v._v; u.lang = v._v.lang; }
        u.rate = 1.0;
        u.pitch = 1.0;
        window.speechSynthesis.speak(u);
      } catch (e) {
        // A failing voice must never stop a lesson.
      }
    },

    stop() {
      if (!supported) return;
      try { window.speechSynthesis.cancel(); } catch (e) {}
    },
  };
})();
