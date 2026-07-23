/* Loads the verified course JSONs (same files bundled in the iOS app,
 * sourced 1:1 from the LuauX server) and exposes lookups + journey order. */
window.LuauData = (function () {
  "use strict";
  let store = null;

  async function loadJSON(name) {
    const res = await fetch("data/" + name + ".json");
    if (!res.ok) throw new Error("Missing bundled data: " + name + ".json");
    return res.json();
  }

  async function load() {
    const [textbook, learning, path, blueprints, launchpad, builderos, challenges, playbook, serverAuthority] =
      await Promise.all([
        loadJSON("textbook"), loadJSON("learning"), loadJSON("path"),
        loadJSON("blueprints"), loadJSON("launchpad"), loadJSON("builderos"),
        loadJSON("challenges"), loadJSON("playbook"), loadJSON("server_authority"),
      ]);

    const sectionsByID = new Map(textbook.sections.map((s) => [s.id, s]));

    store = {
      textbook, learning, path, blueprints, launchpad, builderos, challenges, playbook, serverAuthority,

      section(id) { return sectionsByID.get(id) || null; },

      unit(id) { return textbook.units.find((u) => u.id === id) || null; },

      unitForSection(id) { return textbook.units.find((u) => id >= u.from && id <= u.to) || null; },

      sectionsIn(unit) {
        const out = [];
        for (let id = unit.from; id <= unit.to; id++) {
          const s = sectionsByID.get(id);
          if (s) out.push(s);
        }
        return out;
      },

      skillUnit(unitID) { return learning.units[String(unitID)] || null; },

      exercisesIn(unitID) {
        return Object.values(learning.exercises)
          .filter((e) => e.unitId === unitID)
          .sort((a, b) => (a.id < b.id ? -1 : 1));
      },

      exercise(id) { return learning.exercises[id] || null; },

      blueprint(sectionID) { return blueprints.sections[String(sectionID)] || null; },

      docsURL(item) { return path.meta.docsBase + item.p; },

      /* Journey steps for one chapter: sections in course order, with the
       * unit's exercises attached to the sections the source pairs them
       * with, and the Studio proof as the chapter's checkpoint. */
      journeySteps(unit) {
        const pairedSections = learning.exerciseSections[String(unit.id)] || [];
        const unitExercises = this.exercisesIn(unit.id);
        const steps = [];
        for (const section of this.sectionsIn(unit)) {
          steps.push({ kind: "read", section });
          const idx = pairedSections.indexOf(section.id);
          if (idx >= 0 && idx < unitExercises.length) {
            steps.push({ kind: "exercise", exercise: unitExercises[idx] });
          }
        }
        const skill = this.skillUnit(unit.id);
        if (skill) steps.push({ kind: "proof", proof: skill.proof, unitID: unit.id });
        return steps;
      },

      stepID(step) {
        if (step.kind === "read") return "read-" + step.section.id;
        if (step.kind === "exercise") return "ex-" + step.exercise.id;
        return "proof-" + step.proof.id;
      },

      stepTitle(step) {
        if (step.kind === "read") return step.section.title;
        if (step.kind === "exercise") return step.exercise.name;
        return step.proof.title;
      },

      allExercises() {
        return Object.values(learning.exercises).sort((a, b) =>
          a.unitId !== b.unitId ? a.unitId - b.unitId : (a.id < b.id ? -1 : 1));
      },

      stripHTML(html) {
        let text = html.replace(/<[^>]+>/g, " ");
        const entities = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
        for (const k in entities) text = text.split(k).join(entities[k]);
        return text.replace(/\s+/g, " ").trim();
      },

      search(rawQuery) {
        const q = rawQuery.trim().toLowerCase();
        if (q.length < 2) return [];
        const hits = [];
        for (const s of textbook.sections) {
          const plain = this.stripHTML(s.html).toLowerCase();
          if (s.title.toLowerCase().includes(q) || plain.includes(q)) {
            const unit = this.unitForSection(s.id);
            hits.push({ kind: "section", section: s, title: s.title, subtitle: unit ? unit.name : "" });
          }
        }
        for (const track of path.tracks) {
          for (const item of track.items) {
            if (item.n.toLowerCase().includes(q) || item.c.toLowerCase().includes(q)) {
              hits.push({ kind: "path", item, track, title: item.n, subtitle: track.name });
            }
          }
        }
        for (const ex of this.allExercises()) {
          if (ex.name.toLowerCase().includes(q) || ex.prompt.toLowerCase().includes(q)) {
            hits.push({ kind: "exercise", exercise: ex, title: ex.name, subtitle: "Exercise · Unit " + ex.unitId });
          }
        }
        return hits;
      },
    };
    return store;
  }

  return { load, get current() { return store; } };
})();
