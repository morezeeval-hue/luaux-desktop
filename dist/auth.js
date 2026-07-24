/* LuauX Desktop — Discord OAuth & Auth Service
 * Mirrors progress.js style. Stores bearer token in localStorage. */
window.LuauAuth = (function () {
  "use strict";
  const KEY_TOKEN = "luaux.desktop.auth_token";
  const KEY_USER = "luaux.desktop.auth_user";
  let listeners = [];
  let token = localStorage.getItem(KEY_TOKEN) || null;
  let user = null;

  try {
    const rawUser = localStorage.getItem(KEY_USER);
    if (rawUser) user = JSON.parse(rawUser);
  } catch (e) {}

  function notify() {
    listeners.forEach((fn) => fn());
  }

  function setToken(newToken) {
    token = newToken;
    if (token) {
      localStorage.setItem(KEY_TOKEN, token);
      fetchUser().then(() => {
        if (window.LuauProgress && typeof window.LuauProgress.syncOnSignIn === "function") {
          window.LuauProgress.syncOnSignIn();
        }
      });
    } else {
      localStorage.removeItem(KEY_TOKEN);
      localStorage.removeItem(KEY_USER);
      user = null;
    }
    notify();
  }

  async function fetchUser() {
    if (!token) return null;
    try {
      const res = await fetch("https://luau.prestigex.space/api/auth/me", {
        headers: { Authorization: "Bearer " + token },
      });
      if (res.status === 401) {
        setToken(null);
        return null;
      }
      if (res.ok) {
        const data = await res.json();
        if (data && data.user) {
          user = data.user;
          localStorage.setItem(KEY_USER, JSON.stringify(user));
          notify();
          return user;
        }
      }
    } catch (err) {
      console.warn("[LuauAuth] fetchUser failed:", err);
    }
    return user;
  }

  // Setup Tauri OAuth listener if running in Tauri environment
  if (window.__TAURI__ && window.__TAURI__.event) {
    window.__TAURI__.event.listen("oauth-callback", (event) => {
      const payload = event.payload || {};
      if (payload.token) {
        setToken(payload.token);
      } else if (payload.error) {
        console.warn("[LuauAuth] OAuth failed or was cancelled");
      }
    });
  }

  // Auto-fetch user on init if token exists
  if (token && !user) {
    fetchUser();
  }

  return {
    onChange(fn) {
      listeners.push(fn);
    },
    getToken() {
      return token;
    },
    isSignedIn() {
      return !!token;
    },
    currentUser() {
      return user ? user.username || user.email : null;
    },
    signIn() {
      if (window.__TAURI__ && window.__TAURI__.core) {
        window.__TAURI__.core.invoke("open_discord_auth").catch((err) => {
          console.error("[LuauAuth] open_discord_auth failed:", err);
        });
      } else {
        // Browser dev fallback
        window.open("https://luau.prestigex.space/api/auth/discord", "_blank");
      }
    },
    signOut() {
      setToken(null);
    },
    fetchUser,
  };
})();
