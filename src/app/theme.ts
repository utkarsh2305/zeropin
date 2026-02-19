import { createContext, useContext, useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";

export interface ThemeContextValue {
  isDark: boolean;
  preference: ThemePreference;
  toggle: () => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  isDark: false,
  preference: "system",
  toggle: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

/* ─── Shared hook for all entry points ─────────────────────────── */

const PREFS_KEY = "zp_ui_prefs";
const OLD_PREFS_KEY = "zr_ui_prefs";

function getSystemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useDarkMode(): ThemeContextValue {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [systemDark, setSystemDark] = useState(getSystemDark);

  // Load stored preference (with migration from old boolean format)
  useEffect(() => {
    chrome.storage.local.get([PREFS_KEY, OLD_PREFS_KEY], (items) => {
      let prefs = items[PREFS_KEY] as { darkMode?: boolean | ThemePreference } | undefined;
      if (!prefs && items[OLD_PREFS_KEY]) {
        prefs = items[OLD_PREFS_KEY] as { darkMode?: boolean };
        chrome.storage.local.set({ [PREFS_KEY]: prefs });
        chrome.storage.local.remove(OLD_PREFS_KEY);
      }
      if (prefs?.darkMode !== undefined) {
        if (typeof prefs.darkMode === "boolean") {
          const migrated: ThemePreference = prefs.darkMode ? "dark" : "light";
          setPreference(migrated);
          chrome.storage.local.set({ [PREFS_KEY]: { darkMode: migrated } });
        } else {
          setPreference(prefs.darkMode);
        }
      }
    });
  }, []);

  // Listen for OS theme changes
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const isDark = preference === "system" ? systemDark : preference === "dark";

  // Apply dark class to <html>
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  // Toggle cycles: system → dark → light → system
  const toggle = () => {
    setPreference((prev) => {
      const next: ThemePreference =
        prev === "system" ? "dark" :
        prev === "dark" ? "light" : "system";
      chrome.storage.local.set({ [PREFS_KEY]: { darkMode: next } });
      return next;
    });
  };

  return { isDark, preference, toggle };
}
