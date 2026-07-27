/* Local spoken answers through faster-whisper small.en. */
window.LuauWhisper = (function () {
  "use strict";
  const tauri = window.__TAURI__ || null;
  const invoke = tauri && tauri.core ? tauri.core.invoke : null;
  let status = null, installing = false, recording = null, transcribing = false, error = "";
  const listeners = [];
  const esc = (value) => String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function notify() { listeners.forEach((fn) => fn()); }
  async function refresh() {
    if (!invoke) return;
    try { status = await invoke("whisper_status"); error = ""; }
    catch (e) { status = { available: false, installed: false, reason: String(e) }; }
    notify();
  }
  if (invoke) refresh();

  function controlHTML() {
    if (!invoke) return "";
    if (!status) return '<p class="g-order-help">Checking local speech input…</p>';
    if (!status.available) return '<p class="g-order-help">Local Whisper is unavailable: ' + esc(status.reason || "Python 3 is required.") + '</p>';
    if (!status.installed) return '<div class="g-offer"><span>Spoken answers use local Whisper small.en. Install about 700 MB once; recordings never leave this computer.</span><button class="g-offer-yes" id="g-whisper-install"' + (installing ? " disabled" : "") + ">" + (installing ? "Installing Whisper…" : "Install Whisper small.en") + "</button>" + (error ? '<p class="g-order-help" style="color:var(--red)">' + esc(error) + "</p>" : "") + "</div>";
    const label = transcribing ? "Transcribing locally…" : recording ? "Stop and transcribe" : "Speak an answer";
    return '<button class="g-secondary" id="g-speak-answer"' + (transcribing ? " disabled" : "") + ">" + label + "</button><p class=\"g-order-help\">Whisper small.en stays on this computer. Tap the button to record your answer.</p>" + (error ? '<p class="g-order-help" style="color:var(--red)">' + esc(error) + "</p>" : "");
  }
  async function install() {
    installing = true; error = ""; notify();
    try { await invoke("whisper_install"); await refresh(); }
    catch (e) { error = String(e); }
    finally { installing = false; notify(); }
  }
  async function toggle(onTranscript) {
    if (recording) { recording.stop(); return; }
    error = "";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      const recorder = new MediaRecorder(stream);
      recording = recorder;
      recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
      recorder.addEventListener("stop", async () => {
        recording = null; stream.getTracks().forEach((track) => track.stop()); transcribing = true; notify();
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
          const text = await invoke("whisper_transcribe", { audio: bytes });
          if (text && text.trim()) onTranscript(text.trim()); else error = "I could not hear an answer. Try again or type it.";
        } catch (_) { error = "Could not transcribe that recording. Type your answer instead."; }
        finally { transcribing = false; notify(); }
      });
      recorder.start(); notify();
    } catch (_) { error = "Allow microphone access to speak an answer."; notify(); }
  }
  function bind(onTranscript) {
    const installButton = document.querySelector("#g-whisper-install");
    if (installButton) installButton.addEventListener("click", install);
    const speakButton = document.querySelector("#g-speak-answer");
    if (speakButton) speakButton.addEventListener("click", () => toggle(onTranscript));
  }
  return { controlHTML, bind, onChange(fn) { listeners.push(fn); }, refresh };
})();
