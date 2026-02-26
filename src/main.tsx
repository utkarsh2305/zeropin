import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { getState, recordBookmarkOpen, setLastUsedFolder } from "./core/storage/local";
import { ThemeContext, useDarkMode } from "./app/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sun, Moon, Monitor, ExternalLink, Library, Folder, Search, Bell, Globe, Pin } from "lucide-react";
import { BrandIcon } from "./app/BrandIcon";
import type { Bookmark, LibraryState } from "./core/types";
import "./app.css";

function PopupFaviconImg({ domain }: { domain: string }) {
  const [errored, setErrored] = useState(false);
  if (errored) return <Globe size={16} className="text-muted-foreground/40 shrink-0 mt-0.5" />;
  return (
    <img
      src={`https://www.google.com/s2/favicons?sz=16&domain=${domain}`}
      alt=""
      width={16}
      height={16}
      className="w-4 h-4 shrink-0 rounded-sm mt-0.5"
      onError={() => setErrored(true)}
    />
  );
}

function isDue(b: Bookmark): boolean {
  if (!b.reminderAt) return false;
  if (b.reminderAt > Date.now()) return false;
  if (b.reminderSnoozedUntil && b.reminderSnoozedUntil > Date.now()) return false;
  return true;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function Popup() {
  const themeValue = useDarkMode();
  const { preference, toggle } = themeValue;
  const [state, setState] = useState<LibraryState | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    getState().then(setState);

    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes["zp_state"]) {
        setState(changes["zp_state"].newValue as LibraryState);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  // Derived values
  const allBookmarks = state ? Object.values(state.bookmarks) : [];
  const pinCount = allBookmarks.length;
  const folderCount = state ? Object.keys(state.folders).length : 0;

  const q = searchQuery.trim().toLowerCase();
  const isSearching = q.length > 0;
  const searchResults = isSearching
    ? allBookmarks
        .filter(
          (b) =>
            b.name.toLowerCase().includes(q) ||
            b.url.toLowerCase().includes(q) ||
            b.domain.toLowerCase().includes(q) ||
            (b.snippet?.text ?? "").toLowerCase().includes(q) ||
            (b.notes ?? "").toLowerCase().includes(q)
        )
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 8)
    : [];
  const recentPins = [...allBookmarks].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const displayList = isSearching ? searchResults : recentPins;

  const allDue = allBookmarks.filter(isDue).sort((a, b) => (a.reminderAt ?? 0) - (b.reminderAt ?? 0));
  const dueToShow = allDue.slice(0, 3);
  const hasMoreDue = allDue.length > 3;

  // Current folder
  const currentFolder = state
    ? state.folders[state.lastUsedFolderId ?? ""] ??
      state.folders[state.rootFolderId]
    : null;

  const sortedFolders = state
    ? Object.values(state.folders).sort((a, b) => Number(a.sortKey) - Number(b.sortKey))
    : [];

  const openPin = (b: Bookmark) => {
    recordBookmarkOpen(b.id);
    if (b.type === "SNIPPET" && b.snippet) {
      // Set storage BEFORE creating the tab so the on-load poll always finds it.
      // Doing this inside chrome.tabs.create's callback is unreliable: the popup
      // window is destroyed when the new tab steals focus, killing the callback.
      chrome.storage.local.set(
        {
          ZP_HIGHLIGHT_REQUEST: {
            url: b.url,
            anchor: b.snippet,
            bookmarkId: b.id,
            // eslint-disable-next-line react-hooks/purity
            timestamp: Date.now(),
          },
        },
        () => { chrome.tabs.create({ url: b.url }); }
      );
    } else {
      chrome.tabs.create({ url: b.url });
    }
  };

  const openCurrentFolder = () => {
    const folderId = currentFolder?.id ?? "";
    chrome.tabs.create({
      url: chrome.runtime.getURL(`library.html?folder=${folderId}`),
    });
  };

  const openLibrary = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
  };

  const themeIcon =
    preference === "system" ? <Monitor size={14} /> : preference === "dark" ? <Moon size={14} /> : <Sun size={14} />;
  const themeLabel =
    preference === "system" ? "System theme" : preference === "dark" ? "Dark mode" : "Light mode";

  // Loading skeleton
  if (!state) {
    return (
      <ThemeContext.Provider value={themeValue}>
        <TooltipProvider>
          <div className="w-100 bg-background text-foreground">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <div className="flex items-center gap-2">
                <BrandIcon size={18} />
                <span className="text-base font-semibold">ZeroPin</span>
              </div>
            </div>
            <div className="px-3 py-3 space-y-3">
              <div className="h-8 bg-muted/50 rounded-md animate-pulse" />
              <div className="h-6 bg-muted/50 rounded-md animate-pulse w-3/4" />
              <div className="space-y-2">
                <div className="h-12 bg-muted/50 rounded-md animate-pulse" />
                <div className="h-12 bg-muted/50 rounded-md animate-pulse" />
                <div className="h-12 bg-muted/50 rounded-md animate-pulse" />
              </div>
            </div>
          </div>
        </TooltipProvider>
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={themeValue}>
      <TooltipProvider>
        <div className="w-100 bg-background text-foreground">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <div className="flex items-center gap-2">
              <BrandIcon size={18} />
              <span className="text-base font-semibold">ZeroPin</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {pinCount} pin{pinCount !== 1 ? "s" : ""} · {folderCount} folder{folderCount !== 1 ? "s" : ""}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggle}>
                    {themeIcon}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{themeLabel}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-border">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search pins…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>

          {/* Current Folder switcher */}
          <div className="flex items-center gap-1.5 w-full px-3 py-1.5 border-b border-border">
            <Folder size={14} className="text-muted-foreground shrink-0" />
            <span className="text-muted-foreground text-sm shrink-0">Folder:</span>
            <Select
              value={currentFolder?.id ?? ""}
              onValueChange={async (id) => { try { await setLastUsedFolder(id); } catch { /* ignore */ } }}
            >
              <SelectTrigger className="h-7 text-sm flex-1 border-none shadow-none px-1 focus:ring-0 focus:ring-offset-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sortedFolders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              onClick={openCurrentFolder}
              className="text-muted-foreground opacity-50 hover:opacity-100 transition-opacity shrink-0 p-0.5"
              title="Open folder in Library"
            >
              <ExternalLink size={12} />
            </button>
          </div>

          {/* Due Reminders — only shown when there are due reminders */}
          {allDue.length > 0 && (
            <div className="px-3 py-2 border-b border-border">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-amber-500">
                  <Bell size={10} />
                  <span>Due Reminders</span>
                </div>
                {hasMoreDue && (
                  <button
                    onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("library.html") })}
                    className="text-[10px] text-amber-500 hover:text-amber-400 transition-colors"
                  >
                    {allDue.length - 3} more in Library →
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                {dueToShow.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => openPin(b)}
                    className="flex items-start gap-2 px-2 py-1.5 rounded-md text-left hover:bg-amber-500/10 transition-colors w-full"
                  >
                    <PopupFaviconImg domain={b.domain} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm truncate">{b.name}</span>
                        {b.type === "SNIPPET" && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-auto border-snippet text-snippet shrink-0">
                            snippet
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">{b.domain}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Pin list */}
          <div className="px-3 py-2">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
              {isSearching ? `Search Results (${searchResults.length})` : "Recently Pinned"}
            </div>
            {displayList.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-center gap-2">
                <Pin size={20} className="text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">
                  {isSearching
                    ? "No matching pins."
                    : "No pins yet. Right-click any page and select \"Save to ZeroPin\"."}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {displayList.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => openPin(b)}
                    className="flex items-start gap-2 px-2 py-1.5 rounded-md text-left hover:bg-accent/50 transition-colors w-full"
                  >
                    <PopupFaviconImg domain={b.domain} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm truncate">{b.name}</span>
                        {b.type === "SNIPPET" && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-auto border-snippet text-snippet shrink-0">
                            snippet
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{relativeTime(b.createdAt)}</span>
                        <span className="truncate">{b.domain}</span>
                      </div>
                      {b.notes && b.notes.trim() && (
                        <div className="text-[10px] text-muted-foreground mt-0.5 truncate italic">
                          {b.notes.length > 60 ? b.notes.slice(0, 60) + "…" : b.notes}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Open Full Library */}
          <div className="px-3 py-2.5 border-t border-border">
            <Button variant="outline" className="w-full gap-2" onClick={openLibrary}>
              <Library size={14} />
              Open Full Library
              <ExternalLink size={12} className="ml-auto opacity-50" />
            </Button>
          </div>
        </div>
      </TooltipProvider>
    </ThemeContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Popup />);
