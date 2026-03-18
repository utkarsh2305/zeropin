import { useState, useEffect } from "react";
import { getState } from "../../core/storage/local";
import { getPrefs, type Prefs } from "../../core/storage/prefs";
import { getPendingSave } from "../../core/storage/recents";
import type { PendingSave } from "../../core/storage/recents";
import { suggestTagIds } from "../../core/aiTags";
import type { LibraryState } from "../../core/types";

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_PREFS: Prefs = {
  highlightDurationMs: 3000,
  snippetDismissMs: 12000,
  reminderNotificationEnabled: false,
  reminderNotificationHour: 9,
  unreadTrackingEnabled: false,
  unreadThresholdDays: 60,
  defaultPageSize: 50,
  onboardingCompleted: false,
  onboardingCompletedAt: undefined,
  userProfileRole: "",
  userProfileDescription: "",
  userIntendedUse: "",
  summaryByokEnabled: false,
  summaryProvider: "openai",
  summaryModel: "",
  summaryBaseUrl: "",
  summaryApiKey: "",
  summaryEnableScheduled: false,
  summaryFrequency: "weekly",
  summaryTime: "09:00",
  summaryStyle: "balanced",
  summaryInputTokenBudget: 20000,
  summaryOutputTokenReserve: 3000,
  summaryMaxUrlsPerFolder: 15,
};

// ── Return type ───────────────────────────────────────────────────────────────

export interface LibraryStateResult {
  state: LibraryState | null;
  setState: React.Dispatch<React.SetStateAction<LibraryState | null>>;
  refreshState: () => Promise<void>;
  activeFolderId: string | null;
  setActiveFolderId: React.Dispatch<React.SetStateAction<string | null>>;
  prefs: Prefs;
  setPrefsState: (p: Prefs) => void;
  prefsDraft: Prefs;
  setPrefsDraft: React.Dispatch<React.SetStateAction<Prefs>>;
  isPickerMode: boolean;
  pendingSave: PendingSave | null;
  setPendingSaveState: (s: PendingSave | null) => void;
  pickerSuggestedIds: string[];
  pickerTagIds: string[];
  setPickerTagIds: React.Dispatch<React.SetStateAction<string[]>>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useLibraryState(): LibraryStateResult {
  const [state, setState] = useState<LibraryState | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [prefsDraft, setPrefsDraft] = useState<Prefs>(DEFAULT_PREFS);
  const [pendingSave, setPendingSaveState] = useState<PendingSave | null>(null);
  const [pickerSuggestedIds, setPickerSuggestedIds] = useState<string[]>([]);
  const [pickerTagIds, setPickerTagIds] = useState<string[]>([]);

  const isPickerMode =
    new URLSearchParams(window.location.search).get("mode") === "picker";

  // ── Initial load + storage change listener ────────────────────────────────

  useEffect(() => {
    getPrefs().then((p) => {
      setPrefsState(p);
      setPrefsDraft(p);
    });
    getState().then((s) => {
      setState(s);
      const params = new URLSearchParams(window.location.search);
      const folderParam = params.get("folder");
      if (folderParam && s.folders[folderParam]) {
        setActiveFolderId(folderParam);
      } else {
        setActiveFolderId(s.rootFolderId);
      }
    });

    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes["zp_state"]) {
        const newState = changes["zp_state"].newValue as LibraryState;
        setState(newState);
        setActiveFolderId((prev) => prev ?? newState.rootFolderId);
      }
    };

    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  // ── Picker mode — load pending save ───────────────────────────────────────

  useEffect(() => {
    if (!isPickerMode) return;
    getPendingSave().then((p) => setPendingSaveState(p));
  }, [isPickerMode]);

  // ── AI tag suggestions for pending save ───────────────────────────────────

  useEffect(() => {
    if (!pendingSave || !state) return;
    suggestTagIds(
      {
        url: pendingSave.url,
        title: pendingSave.title,
        snippet: pendingSave.selectionText,
      },
      state.tagDefs ?? {},
    ).then(setPickerSuggestedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSave?.id, state?.schemaVersion]);

  // ── Refresh helper ────────────────────────────────────────────────────────

  const refreshState = async (): Promise<void> => {
    const s = await getState();
    setState(s);
  };

  return {
    state,
    setState,
    refreshState,
    activeFolderId,
    setActiveFolderId,
    prefs,
    setPrefsState,
    prefsDraft,
    setPrefsDraft,
    isPickerMode,
    pendingSave,
    setPendingSaveState,
    pickerSuggestedIds,
    pickerTagIds,
    setPickerTagIds,
  };
}
