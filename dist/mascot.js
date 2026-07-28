/* Pilot, the LuauX red panda.
 *
 * A mascot has one job here: make the app feel like someone is on the other
 * side of it. So Pilot has moods rather than poses, and which mood shows is
 * derived from the progress document rather than chosen at each call site —
 * the mascot can never contradict the numbers next to it.
 *
 * The artwork is six drawn frames under `mascot/`, one per mood, each on a
 * square transparent canvas with the character centred, so switching mood
 * never makes it jump or resize. An earlier version drew the character in
 * SVG paths from this file; that was the wrong tool and it is gone.
 */
window.LuauMascot = (function () {
  "use strict";

  const MOODS = ["calm", "happy", "cheer", "cross", "think", "sleep"];

  /* Below this the full body stops being a character and becomes a smudge,
     so small placements get a head crop instead. This is the same reason app
     icons of full-body mascots are always cropped to the face. */
  const HEAD_BELOW = 46;

  function src(mood, size) {
    if (size < HEAD_BELOW) return "mascot/pilot-" + mood + "-head.png";
    return "mascot/pilot-" + mood + (size <= 160 ? "@128" : "") + ".png";
  }

  const ALT = {
    calm: "Pilot, waiting",
    happy: "Pilot, pleased",
    cheer: "Pilot, celebrating",
    cross: "Pilot, annoyed",
    think: "Pilot, thinking",
    sleep: "Pilot, asleep",
  };

  /** The mascot as an <img>. `size` is a pixel length. */
  function svg(mood, size, extraClass) {
    const m = MOODS.includes(mood) ? mood : "calm";
    const px = size || 48;
    /* If a frame is missing the mascot removes itself rather than leaving a
       broken-image box in the middle of the interface. */
    return `<img class="mascot mascot-${m} ${extraClass || ""}" src="${src(m, px)}"
      width="${px}" height="${px}" alt="${ALT[m]}" draggable="false"
      onerror="this.remove()">`;
  }

  /* What Pilot should be feeling. `cross` is the one that has to be earned:
     it only appears on a day that would break a streak the learner has. */
  function moodFromProgress(p) {
    if (!p) return "calm";
    if (p.streak >= 3 && p.todayActive) return "cheer";
    if (p.todayActive) return "happy";
    if (p.streak > 0 && !p.todayActive) return "cross";
    if (p.everStarted) return "think";
    return "calm";
  }

  /** A line Pilot says, matched to the mood. Kept short: it is a nudge. */
  function line(mood, p) {
    switch (mood) {
      case "cheer": return `${p && p.streak ? p.streak + " days running." : "On a run."} Keep going.`;
      case "happy": return "Good session. Same time tomorrow?";
      case "cross": return `${p && p.streak ? p.streak + "-day streak" : "Your streak"} is about to go. One lesson saves it.`;
      case "think": return "Pick up where you left off.";
      case "sleep": return "Resting. Start a lesson to wake me.";
      default:      return "Ready when you are.";
    }
  }

  return { svg, moods: MOODS, moodFromProgress, line };
})();
