/* Pilot, the LuauX gecko.
 *
 * A mascot has one job here: make the app feel like someone is on the other
 * side of it. So Pilot has moods rather than poses, and every mood maps to
 * something the learner actually did — kept a streak, broke one, got a
 * question wrong, finished a unit.
 *
 * Built from primitives at a fixed 64x64 viewBox so the same drawing works as
 * a 20px sidebar chip, a 96px empty state and an app icon. Colour comes from
 * the existing accent, so the mascot never fights the interface it lives in.
 */
window.LuauMascot = (function () {
  "use strict";

  const MOODS = ["calm", "happy", "cheer", "cross", "think", "sleep"];

  /* Eyes carry almost all of the expression, so they are drawn per mood
     rather than reused with a filter over the top. */
  function eyes(mood) {
    if (mood === "sleep") {
      return `<path d="M20 30q4 4 8 0" class="m-line"/><path d="M36 30q4 4 8 0" class="m-line"/>`;
    }
    if (mood === "cheer") {
      return `<path d="M20 32q4-6 8 0" class="m-line"/><path d="M36 32q4-6 8 0" class="m-line"/>`;
    }
    const pupil = mood === "think"
      ? { lx: 25.4, rx: 41.4, y: 29.4 }        // glancing up and away
      : { lx: 24.6, rx: 40.6, y: 30.6 };
    const squint = mood === "cross" ? 3.1 : 4.2;
    return `
      <ellipse cx="24" cy="30" rx="5.2" ry="${squint + 1}" class="m-eye"/>
      <ellipse cx="40" cy="30" rx="5.2" ry="${squint + 1}" class="m-eye"/>
      <circle cx="${pupil.lx}" cy="${pupil.y}" r="2.5" class="m-pupil"/>
      <circle cx="${pupil.rx}" cy="${pupil.y}" r="2.5" class="m-pupil"/>
      <circle cx="${pupil.lx - 0.9}" cy="${pupil.y - 1}" r="0.85" class="m-glint"/>
      <circle cx="${pupil.rx - 0.9}" cy="${pupil.y - 1}" r="0.85" class="m-glint"/>`;
  }

  function brows(mood) {
    if (mood === "cross") {
      // Angled inward: the one mood that has to read instantly at 20px.
      return `<path d="M18.5 22.5l8 3.2" class="m-brow"/><path d="M45.5 22.5l-8 3.2" class="m-brow"/>`;
    }
    if (mood === "think") {
      return `<path d="M18.5 24l8-1.6" class="m-brow"/><path d="M45.5 22l-8 1" class="m-brow"/>`;
    }
    if (mood === "happy" || mood === "cheer") {
      return `<path d="M19 21.5q4-2.4 8-0.4" class="m-brow"/><path d="M45 21.5q-4-2.4-8-0.4" class="m-brow"/>`;
    }
    return "";
  }

  function mouth(mood) {
    switch (mood) {
      case "cheer": return `<path d="M26 40q6 7 12 0q-6 3-12 0z" class="m-mouth-fill"/>`;
      case "happy": return `<path d="M26.5 39.5q5.5 5 11 0" class="m-line"/>`;
      case "cross": return `<path d="M27 42q5-3.5 10 0" class="m-line"/>`;
      case "think": return `<path d="M28 41h7" class="m-line"/>`;
      case "sleep": return `<path d="M29 40.5q3 2.5 6 0" class="m-line"/>`;
      default:      return `<path d="M27.5 40q4.5 3 9 0" class="m-line"/>`;
    }
  }

  /* Three spines along the crown. Drawn as a single path sitting behind the
     head, which is what gives the silhouette its notch and keeps the shape
     readable when the whole mascot is 20 pixels wide. A ring behind the
     head read as a pineapple top; spines read as a lizard. */
  const CREST = `
    <path d="M21 20.5 L24.5 7.5 L29.5 18 L32 4 L35.5 18 L40 7.5 L43.5 20.5 Z"
          class="m-crest"/>`;

  /* Head and crest only. A tail was tried and cut: at the sizes this is used
     at it read as a handle stuck to one side, and the asymmetry made the mark
     sit badly in a square icon. The crest carries the identity on its own. */
  function body() {
    return `
      <path d="M32 14c11.6 0 19 8.4 19 19.5 0 12-8.2 19.5-19 19.5S13 45.5 13 33.5C13 22.4 20.4 14 32 14z"
            class="m-head"/>
      <ellipse cx="20.5" cy="38.5" rx="3.4" ry="2.4" class="m-cheek"/>
      <ellipse cx="43.5" cy="38.5" rx="3.4" ry="2.4" class="m-cheek"/>`;
  }

  /** Returns the mascot as inline SVG. `size` is a CSS length. */
  function svg(mood, size, extraClass) {
    const m = MOODS.includes(mood) ? mood : "calm";
    return `<svg class="mascot mascot-${m} ${extraClass || ""}" viewBox="0 0 64 64"
      width="${size || 48}" height="${size || 48}" role="img" aria-label="Pilot, the LuauX gecko">
      ${CREST}
      ${body()}
      ${eyes(m)}
      ${brows(m)}
      ${mouth(m)}
    </svg>`;
  }

  /* What Pilot should be feeling, derived from progress rather than chosen at
     each call site, so the mascot cannot contradict the numbers on screen. */
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
