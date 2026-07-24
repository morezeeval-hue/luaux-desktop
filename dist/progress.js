/* Local-only progress: same schema shape as the LuauX web/iOS apps
 * (done / exercises / studioProofs / missionSteps / activity), persisted
 * in localStorage. No accounts, no network, no server. */
window.LuauProgress = (function () {
  "use strict";
  const KEY = "luaux.desktop.progress.v1";
  let listeners = [];

  function blank() {
    return { done: {}, exercises: {}, studioProofs: {}, missionSteps: {}, activity: {}, bookmarks: [] };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return Object.assign(blank(), JSON.parse(raw));
    } catch (e) { /* corrupt or unavailable storage, start fresh */ }
    return blank();
  }

  let state = load();

  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  let syncTimer = null;
  function scheduleDebouncedSync() {
    if (!window.LuauAuth || !window.LuauAuth.isSignedIn()) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      pushProgress();
    }, 2000);
  }

  function persist() {
    localStorage.setItem(KEY, JSON.stringify(state));
    listeners.forEach((fn) => fn());
    scheduleDebouncedSync();
  }

  async function pushProgress() {
    const token = window.LuauAuth && window.LuauAuth.getToken();
    if (!token) return;
    try {
      const res = await fetch("https://luau.prestigex.space/api/progress", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ progress: state }),
      });
      if (res.status === 401 && window.LuauAuth) {
        window.LuauAuth.signOut();
      }
    } catch (e) {
      console.warn("[LuauProgress] pushProgress failed:", e);
    }
  }

  async function syncOnSignIn() {
    const token = window.LuauAuth && window.LuauAuth.getToken();
    if (!token) return;
    try {
      const res = await fetch("https://luau.prestigex.space/api/progress", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ progress: state }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.progress) {
          state = Object.assign(blank(), data.progress);
          localStorage.setItem(KEY, JSON.stringify(state));
          listeners.forEach((fn) => fn());
        }
      }
    } catch (e) {
      console.warn("[LuauProgress] syncOnSignIn failed:", e);
    }
  }

  async function pullProgress() {
    const token = window.LuauAuth && window.LuauAuth.getToken();
    if (!token) return;
    try {
      const res = await fetch("https://luau.prestigex.space/api/progress", {
        headers: { "Authorization": "Bearer " + token },
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.progress) {
          state = Object.assign(blank(), data.progress);
          localStorage.setItem(KEY, JSON.stringify(state));
          listeners.forEach((fn) => fn());
        }
      }
    } catch (e) {
      console.warn("[LuauProgress] pullProgress failed:", e);
    }
  }

  function recordActivity() {
    state.activity[dayKey()] = (state.activity[dayKey()] || 0) + 1;
  }

  function setDone(map, key, done) {
    map[key] = { done: !!done, updatedAt: Date.now() };
    recordActivity();
    persist();
  }

  function toggle(map, key) {
    const current = map[key] && map[key].done === true;
    map[key] = { done: !current, updatedAt: Date.now() };
    recordActivity();
    persist();
  }

  return {
    onChange(fn) { listeners.push(fn); },

    isSectionDone(id) { return !!(state.done[id] && state.done[id].done); },
    setSectionDone(id, done) { setDone(state.done, id, done); },

    isExerciseDone(id) { return !!(state.exercises[id] && state.exercises[id].done); },
    setExerciseDone(id, done = true) { setDone(state.exercises, id, done); },

    isProofStepDone(id) { return !!(state.studioProofs[id] && state.studioProofs[id].done); },
    toggleProofStep(id) { toggle(state.studioProofs, id); },

    isMissionStepDone(id) { return !!(state.missionSteps[id] && state.missionSteps[id].done); },
    toggleMissionStep(id) { toggle(state.missionSteps, id); },

    isBookmarked(id) { return state.bookmarks.includes(id); },
    toggleBookmark(id) {
      const i = state.bookmarks.indexOf(id);
      if (i >= 0) state.bookmarks.splice(i, 1); else state.bookmarks.push(id);
      persist();
    },
    get bookmarks() { return state.bookmarks.slice(); },

    proofCompleted(proof) {
      return proof.stepIds.length > 0 && proof.stepIds.every((id) => this.isProofStepDone(id));
    },
    missionCompleted(mission) {
      return mission.stepIds.length > 0 && mission.stepIds.every((id) => this.isMissionStepDone(id));
    },

    chapterProgress(unit) {
      const data = LuauData.current;
      const steps = data.journeySteps(unit);
      const done = steps.filter((s) => this.isStepDone(s)).length;
      return { done, total: steps.length };
    },
    isStepDone(step) {
      if (step.kind === "read") return this.isSectionDone(step.section.id);
      if (step.kind === "exercise") return this.isExerciseDone(step.exercise.id);
      return this.proofCompleted(step.proof);
    },
    chapterCompleted(unit) {
      const p = this.chapterProgress(unit);
      return p.total > 0 && p.done === p.total;
    },

    get streak() {
      let count = 0;
      let day = new Date();
      if (!state.activity[dayKey(day)]) {
        const yesterday = new Date(day); yesterday.setDate(day.getDate() - 1);
        if (!state.activity[dayKey(yesterday)]) return 0;
        day = yesterday;
      }
      while (state.activity[dayKey(day)]) {
        count += 1;
        day = new Date(day); day.setDate(day.getDate() - 1);
      }
      return count;
    },

    get completedSectionCount() {
      return Object.values(state.done).filter((v) => v.done).length;
    },
    get completedExerciseCount() {
      return Object.values(state.exercises).filter((v) => v.done).length;
    },

    journeyProgress() {
      const data = LuauData.current;
      const proofsDone = Object.values(data.learning.units).filter((u) => this.proofCompleted(u.proof)).length;
      const missionsDone = data.learning.missions.filter((m) => this.missionCompleted(m)).length;
      return {
        done: this.completedSectionCount + this.completedExerciseCount + proofsDone + missionsDone,
        total: data.textbook.sections.length + Object.keys(data.learning.exercises).length + Object.keys(data.learning.units).length + data.learning.missions.length,
      };
    },

    currentUnit() {
      const data = LuauData.current;
      return data.textbook.units.find((u) => !this.chapterCompleted(u)) || null;
    },

    nextStep() {
      const unit = this.currentUnit();
      if (!unit) return null;
      return LuauData.current.journeySteps(unit).find((s) => !this.isStepDone(s)) || null;
    },

    resetAll() {
      state = blank();
      persist();
    },

    syncOnSignIn,
    pushProgress,
    pullProgress,
  };
})();
