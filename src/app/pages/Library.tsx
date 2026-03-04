import { useEffect, useState, useRef, useMemo } from "react";
import { setPrefs } from "../../core/storage/prefs";
import { createTag, deleteTag, recordBookmarkOpen, bulkDeleteBookmarks, bulkMoveBookmarks } from "../../core/storage/local";
import { suggestTagIds } from "../../core/aiTags";
import { AI_CHAT_DOMAINS } from "../../core/constants";
import { useLibraryState } from "../hooks/useLibraryState";
import { useFolderOps } from "../hooks/useFolderOps";
import type { ConfirmDialogState } from "../hooks/useFolderOps";
import { useBookmarkOps } from "../hooks/useBookmarkOps";
import { browserSourceLabel, BOOKMARK_CAP } from "../../core/storage/importBrowser";
import type { LibraryState, Bookmark, Folder, TagDef } from "../../core/types";
import { useTheme } from "../theme";
import { useToast } from "../Toast";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachClosestEdge, extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import type { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { Folder as FolderIcon, Sun, Moon, Monitor, MoreVertical, GripVertical, Pencil, X, Check, ChevronDown, ChevronRight, HelpCircle, Plus, Download, Upload, CheckSquare, Trash2, FolderInput, Palette, Tag, Settings, Bell, Funnel, FolderSearch, Link2, Heart, StickyNote, Globe, BookmarkX } from "lucide-react";
import { BrandIcon } from "../BrandIcon";
import { useFilterPipeline } from "../hooks/useFilterPipeline";
import type { DashboardFilter } from "../hooks/useFilterPipeline";

/* ─── Helpers ───────────────────────────────────────────────────── */

function isAiDomain(domain: string): boolean {
  return AI_CHAT_DOMAINS.has(domain);
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

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "\u2026" : str;
}

/* ─── Drag data helpers ─────────────────────────────────────────── */

type DragItemData = Record<string | symbol, unknown> & {
  type: "bookmark" | "folder";
  bookmarkId?: string;
  folderId?: string;
};

/* ─── Folder color palette ──────────────────────────────────────── */

const FOLDER_COLORS: Record<string, { light: string; dark: string } | null> = {
  default: null,
  red:    { light: "#dc2626", dark: "#f87171" },
  orange: { light: "#ea580c", dark: "#fb923c" },
  yellow: { light: "#ca8a04", dark: "#facc15" },
  green:  { light: "#16a34a", dark: "#4ade80" },
  cyan:   { light: "#0891b2", dark: "#22d3ee" },
  blue:   { light: "#2563eb", dark: "#60a5fa" },
  purple: { light: "#9333ea", dark: "#c084fc" },
  pink:   { light: "#db2777", dark: "#f472b6" },
  grey:   { light: "#6b7280", dark: "#9ca3af" },
  black:  { light: "#1f2937", dark: "#6b7280" },
  white:  { light: "#9ca3af", dark: "#f9fafb" },
};

// Curated emoji for folder icons — covers common personal + professional themes
const FOLDER_EMOJIS = [
  "🗂️", "📚", "💼", "🎨", "🔬", "🏠", "✈️", "🌿",
  "📝", "🎯", "🔑", "💡", "📦", "🎵", "🌍", "⚡",
  "🏋️", "💰", "🎮", "🍕", "🔒", "📊", "🎬", "🌟",
  "🛒", "🏥", "🎓", "💻", "📱", "🔧", "🚀", "❤️",
];

// Searchable emoji dataset — { e: emoji, k: space-separated keywords }
const EMOJI_SEARCH_DATA: { e: string; k: string }[] = [
  { e: "🗂️", k: "folder files organize archive" }, { e: "📁", k: "folder directory" }, { e: "📂", k: "folder open" },
  { e: "📚", k: "books reading library study learn education" }, { e: "📖", k: "book reading open" }, { e: "📝", k: "notes writing memo text journal" },
  { e: "💼", k: "work briefcase business job career" }, { e: "🏢", k: "office company work business" }, { e: "🤝", k: "contacts people network team clients" },
  { e: "🎨", k: "art creative design paint color" }, { e: "🖼️", k: "images gallery art pictures photos" }, { e: "✏️", k: "pen drawing writing edit" },
  { e: "🔬", k: "science research lab microscope" }, { e: "🧪", k: "experiment test lab chemistry" }, { e: "🧬", k: "biology dna science research" },
  { e: "🏠", k: "home house personal family" }, { e: "🏡", k: "house garden property home" }, { e: "🛋️", k: "living room home interior" },
  { e: "✈️", k: "travel flight airplane trip vacation" }, { e: "🗺️", k: "map travel navigate location geography" }, { e: "🏖️", k: "vacation beach holiday summer" },
  { e: "🌿", k: "nature garden plants green outdoors" }, { e: "🌱", k: "growth learning new projects garden" }, { e: "🌊", k: "ocean water nature calm" },
  { e: "🎯", k: "goals target focus aim productivity" }, { e: "🏆", k: "goals achievement wins success" }, { e: "🚀", k: "startup launch project ambition" },
  { e: "🔑", k: "key access important passwords" }, { e: "🔒", k: "secure private secret locked" }, { e: "🔐", k: "security private locked password" },
  { e: "💡", k: "ideas inspiration light creativity" }, { e: "⚡", k: "fast energy quick power" }, { e: "🌟", k: "star important featured highlights" },
  { e: "📦", k: "box package storage shipping" }, { e: "🗃️", k: "archive files storage organize" }, { e: "📌", k: "pinned important reference" },
  { e: "🎵", k: "music audio sound song playlist" }, { e: "🎸", k: "guitar music instruments band" }, { e: "🎤", k: "podcast audio recording media" },
  { e: "🌍", k: "world global earth geography international" }, { e: "🌐", k: "web internet links online" }, { e: "🔗", k: "links urls web resources" },
  { e: "🏋️", k: "gym fitness health workout exercise" }, { e: "🧘", k: "wellness mindfulness health routine meditation" }, { e: "🏃", k: "running exercise fitness sport" },
  { e: "💰", k: "money finance budget savings investment" }, { e: "📈", k: "growth charts finance stocks analytics" }, { e: "📊", k: "stats data charts analytics reports" },
  { e: "🎮", k: "games gaming fun entertainment hobbies" }, { e: "🎬", k: "movies film video watch cinema" }, { e: "📸", k: "photos camera pictures memories" },
  { e: "🍕", k: "food recipes cooking eat pizza" }, { e: "🍳", k: "cooking recipes kitchen meals" }, { e: "☕", k: "coffee morning routine break drinks" },
  { e: "🛒", k: "shopping cart buy purchase store" }, { e: "🛍️", k: "shopping bags store fashion" }, { e: "🎁", k: "gifts wishlist presents shopping" },
  { e: "🏥", k: "health medical doctor hospital care" }, { e: "💊", k: "medicine health pharmacy wellness" }, { e: "🩺", k: "doctor medical health check" },
  { e: "🎓", k: "school university education graduation degree" }, { e: "📐", k: "design math engineering precision" }, { e: "🔭", k: "space science research astronomy" },
  { e: "💻", k: "computer code dev programming software" }, { e: "📱", k: "phone mobile apps devices" }, { e: "🤖", k: "ai automation tech bot machine" },
  { e: "🔧", k: "tools settings fix repair maintenance" }, { e: "⚙️", k: "settings config system preferences" }, { e: "🛠️", k: "tools build repair projects" },
  { e: "📰", k: "news articles reading media press" }, { e: "📜", k: "documents legal contracts history" }, { e: "📋", k: "clipboard lists tasks notes" },
  { e: "🗓️", k: "calendar schedule planning dates events" }, { e: "⏰", k: "time clock reminder schedule alarm" }, { e: "⌚", k: "time watch schedule productivity" },
  { e: "💬", k: "chat messages social communication" }, { e: "👥", k: "team people group collaboration community" }, { e: "❤️", k: "love favorites heart personal important" },
  { e: "🌙", k: "night dark personal private quiet" }, { e: "☀️", k: "morning bright day routine energy" }, { e: "🌈", k: "creative colorful fun inspiration" },
  { e: "🎪", k: "events activities entertainment fun" }, { e: "🏗️", k: "projects build work construction" }, { e: "💎", k: "valuable premium important gems best" },
  { e: "🧩", k: "puzzles problems solving games strategy" }, { e: "🦋", k: "change transformation growth personal" }, { e: "🔮", k: "future planning ideas vision" },
];

/* ─── HealthDashboard ───────────────────────────────────────────── */

function HealthDashboard({
  deadCount,
  favoritesCount,
  notesCount,
  deadLinkChecking,
  deadLinkProgress,
  deadLinkTotal,
  activeFilter,
  onDeadLinksClick,
  onStopDeadLinkCheck,
  onFavoritesClick,
  onNotesClick,
}: {
  deadCount: number;
  favoritesCount: number;
  notesCount: number;
  deadLinkChecking: boolean;
  deadLinkProgress: number;
  deadLinkTotal: number;
  activeFilter: DashboardFilter | null;
  onDeadLinksClick: () => void;
  onStopDeadLinkCheck: () => void;
  onFavoritesClick: () => void;
  onNotesClick: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 px-0.5 py-1">
      {favoritesCount > 0 && (
        <button
          onClick={onFavoritesClick}
          title="Bookmarks marked as favourite"
          className={cn(
            "inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full border transition-colors",
            activeFilter === "favorites"
              ? "bg-rose-500/10 text-rose-500 border-rose-500/30"
              : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
          )}
        >
          <Heart size={13} />
          {favoritesCount} favourite{favoritesCount !== 1 ? "s" : ""}
        </button>
      )}
      {notesCount > 0 && (
        <button
          onClick={onNotesClick}
          title="Bookmarks with saved notes"
          className={cn(
            "inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full border transition-colors",
            activeFilter === "notes"
              ? "bg-primary/10 text-primary border-primary/30"
              : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
          )}
        >
          <StickyNote size={13} />
          {notesCount} with notes
        </button>
      )}
      <button
        onClick={deadLinkChecking ? onStopDeadLinkCheck : onDeadLinksClick}
        title={
          deadLinkChecking
            ? "Click to stop the check"
            : deadCount > 0
            ? "URLs that returned 404 or are no longer accessible"
            : "Click to check all saved links for 404s"
        }
        className={cn(
          "inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full border transition-colors",
          deadLinkChecking
            ? "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
            : deadCount > 0 && activeFilter === "deadlinks"
            ? "bg-destructive/10 text-destructive border-destructive/30"
            : deadCount > 0
            ? "border-destructive/40 text-destructive hover:bg-destructive/10"
            : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
        )}
      >
        <Link2 size={13} />
        {deadLinkChecking
          ? `Checking ${deadLinkProgress}/${deadLinkTotal} — click to stop`
          : deadCount > 0
          ? `${deadCount} dead link${deadCount !== 1 ? "s" : ""}`
          : "Check links"}
      </button>
    </div>
  );
}

/* ─── DroppableFolder ───────────────────────────────────────────── */

function DroppableFolder({
  folder,
  depth,
  isActive,
  isRoot,
  hasChildren,
  isCollapsed,
  children,
  onSelect,
  onToggleCollapse,
  onRename,
  onDelete,
  onIconChange,
  isEmptyHighlighted,
  rootFolderCount,
}: {
  folder: Folder;
  depth: number;
  isActive: boolean;
  isRoot: boolean;
  hasChildren: boolean;
  isCollapsed: boolean;
  children: React.ReactNode;
  onSelect: () => void;
  onToggleCollapse: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onIconChange: (icon: string | undefined) => void;
  isEmptyHighlighted?: boolean;
  rootFolderCount?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLSpanElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");

  // Select all text after the draft value has been populated into the input
  useEffect(() => {
    if (isRenaming && renameDraft) {
      renameInputRef.current?.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const cleanups: (() => void)[] = [];

    cleanups.push(
      dropTargetForElements({
        element: el,
        getData: () => ({ type: "folder", folderId: folder.id }),
        canDrop: ({ source }) => {
          const data = source.data as DragItemData;
          if (data.type === "folder" && data.folderId === folder.id) return false;
          return true;
        },
        onDragEnter: () => setIsDragOver(true),
        onDragLeave: () => setIsDragOver(false),
        onDrop: () => setIsDragOver(false),
      })
    );

    if (!isRoot) {
      cleanups.push(
        draggable({
          element: el,
          dragHandle: handleRef.current ?? undefined,
          getInitialData: () => ({ type: "folder", folderId: folder.id }),
          onDragStart: () => setIsDragging(true),
          onDrop: () => setIsDragging(false),
        })
      );
    }

    return () => cleanups.forEach((fn) => fn());
  }, [folder.id, isRoot]);

  return (
    <div ref={ref}>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md transition-colors duration-150",
          isDragOver && "bg-accent border-l-2 border-l-primary",
          !isDragOver && "border-l-2 border-l-transparent",
        )}
        style={{ opacity: isDragging ? 0.4 : 1 }}
      >
        {!isRoot && (
          <span
            ref={handleRef}
            className="cursor-grab text-muted-foreground select-none opacity-0 group-hover:opacity-100 transition-opacity px-0.5"
            title="Drag to move folder"
          >
            <GripVertical size={12} />
          </span>
        )}
        {isRenaming ? (
          <div
            className="flex-1 flex items-center gap-1.5 rounded-md py-2 text-sm"
            style={{ paddingLeft: `${6 + depth * 6}px`, paddingRight: 4 }}
          >
            {!isRoot && <span className="w-3.5 shrink-0" />}
            {folder.icon ? (
              <span className="shrink-0 w-4.5 h-4.5 rounded flex items-center justify-center text-[13px] leading-none bg-muted/80">
                {folder.icon}
              </span>
            ) : (
              <FolderIcon size={14} className="shrink-0 text-muted-foreground" />
            )}
            <input
              ref={renameInputRef}
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameDraft.trim()) { onRename(renameDraft.trim()); setIsRenaming(false); }
                if (e.key === "Escape") setIsRenaming(false);
              }}
              className="flex-1 min-w-0 bg-transparent border-b border-primary outline-none text-sm py-0.5 px-0"
            />
            <button
              onClick={() => { if (renameDraft.trim()) { onRename(renameDraft.trim()); setIsRenaming(false); } }}
              className="shrink-0 p-1 rounded text-primary hover:text-primary/80 transition-colors"
              title="Confirm"
            >
              <Check size={12} />
            </button>
            <button
              onClick={() => setIsRenaming(false)}
              className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
              title="Cancel"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            onClick={onSelect}
            className={cn(
              "flex-1 flex items-center gap-1.5 text-left cursor-pointer border-none rounded-md py-2 text-sm transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "bg-transparent text-foreground hover:bg-accent/50",
            )}
            style={{ paddingLeft: `${6 + depth * 6}px`, paddingRight: 8 }}
          >
            {!isRoot && hasChildren ? (
              <span
                onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
                className={cn(
                  "w-3.5 flex items-center justify-center cursor-pointer shrink-0",
                  isActive ? "text-primary-foreground" : "text-muted-foreground",
                )}
              >
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </span>
            ) : !isRoot ? (
              <span className="w-3.5 shrink-0" />
            ) : null}
            {folder.icon ? (
              <span className="shrink-0 w-4.5 h-4.5 rounded flex items-center justify-center text-[13px] leading-none bg-muted/80">
                {folder.icon}
              </span>
            ) : (
              <FolderIcon
                size={14}
                className={cn("shrink-0", isActive ? "text-primary-foreground" : "text-muted-foreground")}
              />
            )}
            <span className="flex-1 truncate">{folder.name}</span>
            {isEmptyHighlighted && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-muted-foreground/35 shrink-0"
                title="Empty folder"
              />
            )}
            {isRoot && rootFolderCount !== undefined && (
              <span className={cn("ml-1 text-xs", isActive ? "text-primary-foreground" : "text-foreground")}>
                ({rootFolderCount})
              </span>
            )}
          </button>
        )}
        {!isRoot && !isRenaming && (
          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Popover open={pickerOpen} onOpenChange={(o) => { setPickerOpen(o); if (!o) setEmojiSearch(""); }}>
              <PopoverTrigger asChild>
                <button
                  className="p-1 cursor-pointer bg-transparent border-none text-muted-foreground hover:text-foreground transition-colors"
                  title="Change icon"
                >
                  {folder.icon
                    ? <span className="text-[13px] leading-none">{folder.icon}</span>
                    : <Palette size={12} />}
                </button>
              </PopoverTrigger>
              <PopoverContent side="right" align="start" className="p-3 w-auto">
                {/* Live preview */}
                <div className="flex items-center gap-2 mb-2.5 pb-2.5 border-b border-border">
                  {folder.icon
                    ? <span className="shrink-0 w-7 h-7 rounded flex items-center justify-center text-lg leading-none bg-muted/80">{folder.icon}</span>
                    : <FolderIcon size={18} className="shrink-0 text-muted-foreground" />}
                  <span className="text-sm font-medium truncate max-w-40">{folder.name}</span>
                  {folder.icon && (
                    <button onClick={() => onIconChange(undefined)} className="ml-auto p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors" title="Remove icon">
                      <X size={13} />
                    </button>
                  )}
                </div>
                {/* Search */}
                <input
                  type="text"
                  value={emojiSearch}
                  onChange={(e) => setEmojiSearch(e.target.value)}
                  placeholder="Search…"
                  className="w-full mb-2.5 px-2.5 py-1.5 text-sm border border-border rounded bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
                />
                {/* Emoji grid */}
                <div className="grid grid-cols-8 gap-1 max-h-52.5 overflow-y-auto">
                  {(emojiSearch.trim()
                    ? EMOJI_SEARCH_DATA.filter(({ k }) => k.includes(emojiSearch.toLowerCase().trim())).map(({ e }) => e)
                    : FOLDER_EMOJIS
                  ).map((emoji) => (
                    <button
                      key={emoji}
                      title={emoji}
                      onClick={() => { onIconChange(folder.icon === emoji ? undefined : emoji); setPickerOpen(false); setEmojiSearch(""); }}
                      className={cn(
                        "w-8 h-8 flex items-center justify-center text-[17px] rounded transition-colors hover:bg-accent",
                        folder.icon === emoji ? "bg-accent ring-1 ring-inset ring-foreground/20" : "",
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <button
              onClick={(e) => { e.stopPropagation(); setRenameDraft(folder.name); setIsRenaming(true); }}
              className="p-1 cursor-pointer bg-transparent border-none text-muted-foreground hover:text-foreground transition-colors"
              title="Rename"
            >
              <Pencil size={12} />
            </button>
            <button onClick={onDelete} className="p-1 cursor-pointer bg-transparent border-none text-destructive hover:text-destructive/80 transition-colors" title="Delete">
              <X size={12} />
            </button>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

/* ─── FolderTree ────────────────────────────────────────────────── */

type FolderTreeProps = {
  state: LibraryState;
  activeFolderId: string;
  onSelectFolder: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onIconChange: (id: string, icon: string | undefined) => void;
  emptyFolderIds?: Set<string>;
  rootFolderCount?: number;
};

function FolderTree({ state, activeFolderId, onSelectFolder, onRenameFolder, onDeleteFolder, onIconChange, emptyFolderIds, rootFolderCount }: FolderTreeProps) {
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => {
    // Collapse everything except root (so main folders are visible, subfolders hidden)
    const all = new Set(Object.keys(state.folders));
    all.delete(state.rootFolderId);
    // Un-collapse ancestors of the active folder so it stays visible in the tree
    const reveal = (id: string) => {
      const f = state.folders[id];
      if (f?.parentId) { all.delete(f.parentId); reveal(f.parentId); }
    };
    reveal(activeFolderId);
    return all;
  });

  const toggleFolder = (folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const renderFolder = (folderId: string, depth: number = 0): React.ReactNode => {
    const folder = state.folders[folderId];
    if (!folder) return null;
    const childFolders = Object.values(state.folders).filter((f) => f.parentId === folderId);
    const hasChildren = childFolders.length > 0;
    const isCollapsed = collapsedFolders.has(folderId);

    return (
      <DroppableFolder
        key={folderId}
        folder={folder}
        depth={depth}
        isActive={activeFolderId === folderId}
        isRoot={folderId === state.rootFolderId}
        hasChildren={hasChildren}
        isCollapsed={isCollapsed}
        onSelect={() => onSelectFolder(folderId)}
        onToggleCollapse={() => toggleFolder(folderId)}
        onRename={(name) => onRenameFolder(folderId, name)}
        onDelete={() => onDeleteFolder(folderId)}
        onIconChange={(icon) => onIconChange(folderId, icon)}
        isEmptyHighlighted={emptyFolderIds?.has(folderId)}
        rootFolderCount={folderId === state.rootFolderId ? rootFolderCount : undefined}
      >
        {hasChildren && !isCollapsed && (
          <div>{childFolders.map((f) => renderFolder(f.id, depth + 1))}</div>
        )}
      </DroppableFolder>
    );
  };

  return (
    <div className="p-2 rounded-lg">
      {renderFolder(state.rootFolderId)}
    </div>
  );
}

/* ─── SortableBookmarkItem ──────────────────────────────────────── */

function SortableBookmarkItem({
  bookmark,
  onOpen,
  onRename,
  onDelete,
  expandedNote,
  onToggleNote,
  onNoteChange,
  onSaveNote,
  onCancelNote,
  folderName,
  bulkMode,
  selected,
  onToggleSelect,
  isFocused,
  onFocusCard,
  tagDefs,
  isDark,
  onToggleTags,
  onSaveReminder,
  onToggleFavorite,
  isRenaming,
  onRenameConfirm,
  onRenameCancel,
}: {
  bookmark: Bookmark;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  expandedNote: { open: boolean; draft: string } | undefined;
  onToggleNote: () => void;
  onNoteChange: (draft: string) => void;
  onSaveNote: () => void;
  onCancelNote: () => void;
  folderName?: string;
  bulkMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  isFocused?: boolean;
  onFocusCard?: () => void;
  tagDefs?: Record<string, TagDef>;
  isDark?: boolean;
  onToggleTags?: () => void;
  onSaveReminder?: (reminderAt: number | null) => void;
  onToggleFavorite?: () => void;
  isRenaming?: boolean;
  onRenameConfirm?: (name: string) => void;
  onRenameCancel?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLSpanElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderDateDraft, setReminderDateDraft] = useState("");
  const [reminderTimeDraft, setReminderTimeDraft] = useState("09:00");
  const [renameDraft, setRenameDraft] = useState("");

  useEffect(() => {
    if (isRenaming) {
      setRenameDraft(bookmark.name);
    } else {
      setRenameDraft("");
    }
  }, [isRenaming, bookmark.name]);

  // Select all text after the draft value has been populated into the input
  useEffect(() => {
    if (isRenaming && renameDraft) {
      renameInputRef.current?.select();
    }
  }, [isRenaming, renameDraft]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    return combine(
      draggable({
        element: el,
        dragHandle: handleRef.current ?? undefined,
        getInitialData: () => ({ type: "bookmark", bookmarkId: bookmark.id, folderId: bookmark.folderId }),
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element: el,
        getData: ({ input, element }) =>
          attachClosestEdge(
            { type: "bookmark", bookmarkId: bookmark.id, folderId: bookmark.folderId },
            { element, input, allowedEdges: ["top", "bottom"] }
          ),
        canDrop: ({ source }) => {
          const data = source.data as DragItemData;
          return data.type === "bookmark" && data.bookmarkId !== bookmark.id;
        },
        onDragEnter: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDrag: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      })
    );
  }, [bookmark.id, bookmark.folderId]);

  const isSnippet = bookmark.type === "SNIPPET";
  const snippetPreview = isSnippet && bookmark.snippet?.text
    ? truncate(bookmark.snippet.text, 80)
    : null;

  return (
    <div
      ref={ref}
      tabIndex={0}
      onFocus={onFocusCard}
      data-bookmark-id={bookmark.id}
      className={cn(
        "group/card relative rounded-lg border p-3.5 transition-all outline-none",
        isSnippet ? "border-l-2 border-l-snippet" : "border-border/50",
        selected && "border-info ring-1 ring-info/30",
        !selected && !isSnippet && "hover:border-border hover:shadow-sm",
        isFocused && "ring-2 ring-primary",
      )}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      {closestEdge && (
        <div className={cn(
          "absolute left-0 right-0 h-0.5 bg-primary rounded-full",
          closestEdge === "top" ? "-top-0.5" : "-bottom-0.5",
        )} />
      )}

      <div className="flex items-start gap-3">
        {bulkMode && (
          <input
            type="checkbox"
            checked={selected ?? false}
            onChange={onToggleSelect}
            className="mt-1 shrink-0 cursor-pointer"
          />
        )}
        <span
          ref={handleRef}
          className="cursor-grab text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity"
          title="Drag to reorder or move to folder"
        >
          <GripVertical size={14} />
        </span>

        <FaviconImg domain={bookmark.domain} size={20} className="mt-0.5" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {isRenaming ? (
              <div className="flex flex-1 items-center gap-1 min-w-0">
                <input
                  ref={renameInputRef}
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && renameDraft.trim()) { onRenameConfirm?.(renameDraft.trim()); }
                    if (e.key === "Escape") onRenameCancel?.();
                  }}
                  className="flex-1 min-w-0 bg-transparent border-b border-primary outline-none font-semibold text-[15px] text-foreground py-0.5 px-0"
                />
                <button
                  onClick={() => { if (renameDraft.trim()) onRenameConfirm?.(renameDraft.trim()); }}
                  className="shrink-0 p-0.5 rounded text-primary hover:text-primary/80 transition-colors"
                  title="Confirm"
                >
                  <Check size={13} />
                </button>
                <button
                  onClick={onRenameCancel}
                  className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                  title="Cancel"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <button
                onClick={onOpen}
                className="font-semibold text-[15px] text-foreground hover:text-primary cursor-pointer bg-transparent border-none p-0 font-[inherit] truncate max-w-87.5 text-left transition-colors"
                title={bookmark.name}
              >
                {bookmark.name}
              </button>
            )}
            {isSnippet && (
              <Badge variant="outline" className="text-snippet border-snippet/30 bg-snippet/10 text-[10px] px-1.5 py-0">
                snippet
              </Badge>
            )}
            {bookmark.snippet?.chatContext?.role && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] px-1.5 py-0",
                  bookmark.snippet.chatContext.role === "assistant"
                    ? "text-primary border-primary/30 bg-primary/10"
                    : "text-info border-info/30 bg-info/10",
                )}
              >
                {bookmark.snippet.chatContext.role === "assistant" ? "AI Answer" : "AI Prompt"}
              </Badge>
            )}
            {!bookmark.snippet?.chatContext?.platform && isAiDomain(bookmark.domain) && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-primary border-primary/30 bg-primary/10">
                AI
              </Badge>
            )}
            {bookmark.media?.kind === "youtube" && bookmark.media.timestampLabel && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-red-500 border-red-500/30 bg-red-500/10 font-mono">
                ▶ {bookmark.media.timestampLabel}
              </Badge>
            )}
          </div>

          <div className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
            <span>{bookmark.domain}</span>
            <span>{relativeTime(bookmark.createdAt)}</span>
            {(bookmark.openCount ?? 0) > 0 && (
              <span>Opened {bookmark.openCount}×</span>
            )}
            {folderName && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                {folderName}
              </Badge>
            )}
            {bookmark.reminderAt && (
              <span className="inline-flex items-center gap-0.5 text-amber-500">
                <Bell size={12} />
                {reminderLabel(bookmark.reminderAt)}
              </span>
            )}
          </div>

          {snippetPreview && (
            <p className="text-sm text-muted-foreground mt-1.5 italic leading-relaxed truncate">
              &ldquo;{snippetPreview}&rdquo;
            </p>
          )}
          {bookmark.notes && bookmark.notes.trim() && (
            <p className="text-sm text-muted-foreground mt-1 italic truncate">
              {bookmark.notes.length > 60 ? bookmark.notes.slice(0, 60) + "…" : bookmark.notes}
            </p>
          )}
          {(bookmark.tags ?? []).length > 0 && tagDefs && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {(bookmark.tags ?? []).slice(0, 3).map((tagId) => {
                const tag = tagDefs[tagId];
                if (!tag) return null;
                const colorEntry = tag.color ? FOLDER_COLORS[tag.color] : null;
                const colorHex = colorEntry ? (isDark ? colorEntry.dark : colorEntry.light) : null;
                return (
                  <span
                    key={tagId}
                    className="inline-flex items-center text-xs px-2 py-0.5 rounded-full border font-normal"
                    style={colorHex ? { borderColor: colorHex + "60", color: colorHex, background: colorHex + "15" } : undefined}
                  >
                    #{tag.name}
                  </span>
                );
              })}
              {(bookmark.tags ?? []).length > 3 && (
                <span className="text-[10px] text-muted-foreground">+{bookmark.tags!.length - 3}</span>
              )}
            </div>
          )}
        </div>

        {onToggleFavorite && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleFavorite}
            className={cn(
              "h-7 w-7 shrink-0 transition-opacity",
              bookmark.isFavorite
                ? "text-rose-500"
                : "opacity-0 group-hover/card:opacity-100 text-muted-foreground"
            )}
            title={bookmark.isFavorite ? "Remove from favourites" : "Add to favourites"}
          >
            <Heart size={14} fill={bookmark.isFavorite ? "currentColor" : "none"} />
          </Button>
        )}
        {onSaveReminder && (
          <Popover open={reminderOpen} onOpenChange={(o) => {
            if (o && bookmark.reminderAt) {
              const d = new Date(bookmark.reminderAt);
              setReminderDateDraft(d.toISOString().slice(0, 10));
              setReminderTimeDraft(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
            }
            if (!o) { setReminderDateDraft(""); setReminderTimeDraft("09:00"); }
            setReminderOpen(o);
          }}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 shrink-0 transition-opacity",
                  bookmark.reminderAt
                    ? "text-amber-500"
                    : "opacity-0 group-hover/card:opacity-100 text-muted-foreground"
                )}
                title={bookmark.reminderAt ? "Edit reminder" : "Set reminder"}
              >
                <Bell size={14} />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-3" align="end" side="bottom">
              <p className="text-xs font-medium text-foreground mb-2">Set reminder</p>
              {bookmark.reminderAt && (
                <div className="flex items-center justify-between rounded bg-amber-500/10 border border-amber-500/20 px-2 py-1 mb-2">
                  <span className="text-xs text-amber-700 dark:text-amber-400">
                    Due {new Date(bookmark.reminderAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <button
                    onClick={() => { onSaveReminder(null); setReminderOpen(false); }}
                    className="ml-1 p-0.5 rounded hover:text-destructive text-muted-foreground"
                    title="Remove reminder"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              <div className="space-y-1 mb-2">
                {[{ label: "Tomorrow", days: 1 }, { label: "In 3 days", days: 3 }, { label: "In 1 week", days: 7 }].map(({ label, days }) => (
                  <button
                    key={days}
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() + days);
                      d.setHours(9, 0, 0, 0);
                      onSaveReminder(d.getTime());
                      setReminderOpen(false);
                    }}
                    className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                type="date"
                value={reminderDateDraft}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setReminderDateDraft(e.target.value)}
                className="w-full border border-border rounded px-2 py-1 text-xs bg-background text-foreground mb-1"
              />
              <input
                type="time"
                value={reminderTimeDraft}
                onChange={(e) => setReminderTimeDraft(e.target.value)}
                className="w-full border border-border rounded px-2 py-1 text-xs bg-background text-foreground mb-2"
              />
              <Button
                size="sm"
                className="w-full"
                disabled={!reminderDateDraft}
                onClick={() => {
                  const ms = new Date(`${reminderDateDraft}T${reminderTimeDraft || "09:00"}`).getTime();
                  if (!isNaN(ms)) { onSaveReminder(ms); setReminderOpen(false); setReminderDateDraft(""); setReminderTimeDraft("09:00"); }
                }}
              >
                Set reminder
              </Button>
            </PopoverContent>
          </Popover>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground opacity-0 group-hover/card:opacity-100 transition-opacity">
              <MoreVertical size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleNote}>Notes</DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleTags}>Tags</DropdownMenuItem>

            <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {expandedNote?.open && (
        <div className="mt-3 p-3 bg-muted rounded-md">
          <textarea
            value={expandedNote.draft || ""}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="Add notes..."
            className="w-full p-2 border border-input rounded-md text-sm font-sans min-h-15 bg-background text-foreground resize-y"
          />
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={onSaveNote}>Save</Button>
            <Button size="sm" variant="outline" onClick={onCancelNote}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}


/* ─── Page grouping ────────────────────────────────────────────── */

type PageGroup = {
  url: string;
  domain: string;
  title: string;
  bookmarks: Bookmark[];
};

function FaviconImg({ domain, size = 16, className = "" }: { domain: string; size?: number; className?: string }) {
  const [errored, setErrored] = useState(false);
  if (errored) return <Globe size={size} className={cn("text-muted-foreground/40 shrink-0", className)} />;
  return (
    <img
      src={`https://www.google.com/s2/favicons?sz=${size}&domain=${domain}`}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 rounded-sm", className)}
      onError={() => setErrored(true)}
    />
  );
}

function openBookmark(b: Bookmark): void {
  recordBookmarkOpen(b.id);
  if (b.type === "SNIPPET" && b.snippet) {
    chrome.storage.local.set(
      { ZP_HIGHLIGHT_REQUEST: { url: b.url, anchor: b.snippet, bookmarkId: b.id, timestamp: Date.now() } },
      () => {
        if (chrome.runtime.lastError) return;
        chrome.tabs.create({ url: b.url });
      },
    );
  } else {
    window.open(b.url, "_blank");
  }
}

function groupByUrl(bookmarks: Bookmark[]): PageGroup[] {
  const map = new Map<string, Bookmark[]>();
  for (const b of bookmarks) {
    const list = map.get(b.url) ?? [];
    list.push(b);
    map.set(b.url, list);
  }

  const groups: PageGroup[] = [];
  for (const [url, bms] of map) {
    bms.sort((a, b) => {
      if (a.type !== b.type) return a.type === "PAGE" ? -1 : 1;
      return Number(b.sortKey) - Number(a.sortKey);
    });
    const title = bms.find((b) => b.name.trim())?.name ?? url;
    groups.push({ url, domain: bms[0].domain, title, bookmarks: bms });
  }

  groups.sort((a, b) => {
    const aMax = Math.max(...a.bookmarks.map((bm) => Number(bm.sortKey)));
    const bMax = Math.max(...b.bookmarks.map((bm) => Number(bm.sortKey)));
    return bMax - aMax;
  });

  return groups;
}

function PageGroupHeader({ group, expanded, onToggle }: {
  group: PageGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "flex items-center gap-2 py-1.5 px-1 cursor-pointer rounded-md select-none w-full bg-transparent border-none text-left",
        expanded ? "bg-card" : "hover:bg-muted/50",
      )}
    >
      <span className="text-muted-foreground w-3.5 flex items-center justify-center">
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </span>
      <FaviconImg domain={group.domain} size={16} />
      <span className="flex-1 min-w-0 text-sm font-semibold text-foreground truncate">
        {group.title}
      </span>
      <span className="text-xs text-muted-foreground shrink-0">
        {group.bookmarks.length}
      </span>
    </button>
  );
}

/* ─── Folder helpers ───────────────────────────────────────────── */

function getDescendantFolderIds(
  folderId: string,
  folders: Record<string, import("../../core/types").Folder>
): Set<string> {
  const result = new Set<string>([folderId]);
  const queue = [folderId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const f of Object.values(folders)) {
      if (f.parentId === current && !result.has(f.id)) {
        result.add(f.id);
        queue.push(f.id);
      }
    }
  }
  return result;
}

/* ─── Reminder helpers ──────────────────────────────────────────── */

function reminderLabel(reminderAt: number): string {
  const diff = reminderAt - Date.now();
  if (diff <= 0) return "Due now";
  const days = Math.floor(diff / 86400000);
  const time = new Date(reminderAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `Due today ${time}`;
  if (days === 1) return `Due tomorrow ${time}`;
  return `Due in ${days}d ${time}`;
}

/* ─── RemindersSection ──────────────────────────────────────────── */

function RemindersSection({
  bookmarks,
  onDismiss,
  onSnooze,
  collapsed,
  onToggleCollapse,
}: {
  bookmarks: Bookmark[];
  onDismiss: (id: string) => void;
  onSnooze: (id: string, days: number) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  return (
    <div className="mb-4 rounded-lg border border-amber-300/50 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-700/40 overflow-hidden">
      <button
        onClick={onToggleCollapse}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Bell size={14} />
          Reminders ({bookmarks.length})
        </span>
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      </button>
      {!collapsed && (
        <div className="divide-y divide-amber-200/40 dark:divide-amber-800/30">
          {bookmarks.map((b) => (
            <div key={b.id} className="flex items-center gap-2 px-3 py-2">
              <FaviconImg domain={b.domain} size={16} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{b.name}</div>
                <div className="text-[10px] text-muted-foreground truncate">{b.domain}</div>
              </div>
              <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">{reminderLabel(b.reminderAt!)}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs px-2 text-muted-foreground hover:text-foreground"
                onClick={() => onDismiss(b.id)}
              >
                Dismiss
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-6 text-xs px-2">
                    Snooze ▾
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onSnooze(b.id, 1)}>Tomorrow</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onSnooze(b.id, 3)}>In 3 days</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onSnooze(b.id, 7)}>In 1 week</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── TagEditor ─────────────────────────────────────────────────── */

function TagEditor({
  currentTagIds,
  tagDefs,
  isDark,
  onSave,
  onClose,
  bookmarkUrl,
  bookmarkName,
}: {
  currentTagIds: string[];
  tagDefs: Record<string, TagDef>;
  isDark?: boolean;
  onSave: (ids: string[]) => void;
  onClose: () => void;
  bookmarkUrl?: string;
  bookmarkName?: string;
}) {
  const [input, setInput] = useState("");
  const [ids, setIds] = useState<string[]>(currentTagIds);
  const [aiSuggestedIds, setAiSuggestedIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!bookmarkUrl && !bookmarkName) return;
    suggestTagIds(
      { url: bookmarkUrl ?? "", title: bookmarkName ?? "" },
      tagDefs
    ).then(setAiSuggestedIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const query = input.trim().toLowerCase();
  const allTags = Object.values(tagDefs).sort((a, b) => a.name.localeCompare(b.name));
  const suggestions = query
    ? allTags.filter((t) => t.name.toLowerCase().includes(query) && !ids.includes(t.id))
    : allTags.filter((t) => !ids.includes(t.id));
  const exactMatch = allTags.find((t) => t.name.toLowerCase() === query);

  const addTag = (tagId: string) => {
    if (!ids.includes(tagId)) {
      const next = [...ids, tagId];
      setIds(next);
      onSave(next);
    }
    setInput("");
    inputRef.current?.focus();
  };

  const removeTag = (tagId: string) => {
    const next = ids.filter((t) => t !== tagId);
    setIds(next);
    onSave(next);
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "Enter" && query) {
      e.preventDefault();
      if (exactMatch) {
        addTag(exactMatch.id);
      } else {
        const newId = await createTag(query);
        addTag(newId);
      }
    }
    if (e.key === "Backspace" && !input && ids.length > 0) {
      removeTag(ids[ids.length - 1]);
    }
  };

  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="mt-2 p-2 bg-muted rounded-md space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap gap-1 items-center min-h-6">
        {ids.map((tagId) => {
          const tag = tagDefs[tagId];
          if (!tag) return null;
          const chipColorEntry = tag.color ? FOLDER_COLORS[tag.color] : null;
          const chipColorHex = chipColorEntry ? (isDark ? chipColorEntry.dark : chipColorEntry.light) : null;
          return (
            <span
              key={tagId}
              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border"
              style={chipColorHex
                ? { borderColor: chipColorHex + "60", color: chipColorHex, background: chipColorHex + "20" }
                : { borderColor: "hsl(var(--primary) / 0.2)", color: "hsl(var(--primary))", background: "hsl(var(--primary) / 0.1)" }
              }
            >
              #{tag.name}
              <button onClick={() => removeTag(tagId)} className="ml-0.5 leading-none opacity-70 hover:opacity-100">&times;</button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={ids.length === 0 ? "Type a tag name…" : "Add another…"}
          className="flex-1 min-w-20 bg-transparent border-none outline-none text-xs text-foreground placeholder:text-muted-foreground"
        />
      </div>
      {(() => {
        const suggestedChips = suggestions.filter((t) => aiSuggestedIds.includes(t.id));
        const otherChips = suggestions.filter((t) => !aiSuggestedIds.includes(t.id));
        const showCreate = !!(query && !exactMatch);
        if (suggestions.length === 0 && !showCreate) return null;
        return (
          <>
            {suggestedChips.length > 0 && (
              <div className="pt-1">
                <span className="text-[10px] text-muted-foreground mb-1.5 block">✦ Suggested</span>
                <div className="flex flex-wrap gap-1.5">
                  {suggestedChips.map((tag) => {
                    const colorEntry = tag.color ? FOLDER_COLORS[tag.color] : null;
                    const colorHex = colorEntry ? (isDark ? colorEntry.dark : colorEntry.light) : null;
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); addTag(tag.id); }}
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors hover:bg-accent"
                        style={{
                          ...(colorHex ? { borderColor: colorHex + "60", color: colorHex, background: colorHex + "15" } : {}),
                          boxShadow: colorHex ? `0 0 0 1.5px ${colorHex}` : "0 0 0 1.5px var(--primary)",
                        }}
                      >
                        + #{tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {(otherChips.length > 0 || showCreate) && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {otherChips.map((tag) => {
                  const colorEntry = tag.color ? FOLDER_COLORS[tag.color] : null;
                  const colorHex = colorEntry ? (isDark ? colorEntry.dark : colorEntry.light) : null;
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); addTag(tag.id); }}
                      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors hover:bg-accent"
                      style={colorHex ? { borderColor: colorHex + "60", color: colorHex, background: colorHex + "15" } : undefined}
                    >
                      + #{tag.name}
                    </button>
                  );
                })}
                {showCreate && (
                  <button
                    type="button"
                    onMouseDown={async (e) => { e.preventDefault(); const id = await createTag(query); addTag(id); }}
                    className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-dashed border-primary/50 text-primary hover:bg-primary/10 transition-colors"
                  >
                    + Create &ldquo;{query}&rdquo;
                  </button>
                )}
              </div>
            )}
          </>
        );
      })()}
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={onClose} className="h-6 text-xs px-2">Done</Button>
      </div>
    </div>
  );
}

/* ─── BookmarkList ──────────────────────────────────────────────── */

export type SortKey = "newest" | "oldest" | "name_asc" | "name_desc" | "last_opened" | "most_opened";

export function sortBookmarks(bookmarks: Bookmark[], sortBy: SortKey): Bookmark[] {
  return [...bookmarks].sort((a, b) => {
    switch (sortBy) {
      case "oldest":      return Number(a.sortKey) - Number(b.sortKey);
      case "name_asc":    return a.name.localeCompare(b.name);
      case "name_desc":   return b.name.localeCompare(a.name);
      case "last_opened": return (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0);
      case "most_opened": return (b.openCount ?? 0) - (a.openCount ?? 0);
      default:            return Number(b.sortKey) - Number(a.sortKey); // newest
    }
  });
}

// ── Keyboard nav helper ────────────────────────────────────────────

export function getAdjacentId(
  ids: string[],
  currentId: string | null,
  delta: 1 | -1,
): string | null {
  if (ids.length === 0) return null;
  if (!currentId) return delta === 1 ? ids[0] : ids[ids.length - 1];
  const idx = ids.indexOf(currentId);
  if (idx === -1) return ids[0];
  const next = idx + delta;
  if (next < 0 || next >= ids.length) return currentId; // clamp at edges
  return ids[next];
}

type BookmarkListProps = {
  bookmarks: Bookmark[];
  activeFolderId: string;
  isSearching: boolean;
  folders: Record<string, import("../../core/types").Folder>;
  onRenameBookmark: (id: string, name: string) => void;
  onDeleteBookmark: (id: string) => void;
  expandedNotes: Record<string, { open: boolean; draft: string }>;
  onSetExpandedNotes: (state: Record<string, { open: boolean; draft: string }>) => void;
  onSetNotes: (id: string, notes: string) => void;
  bulkMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  sortBy: SortKey;
  tagDefs: Record<string, TagDef>;
  onSetBookmarkTags: (bookmarkId: string, tagIds: string[]) => void;
  isDark?: boolean;
  onSaveReminder?: (bookmarkId: string, reminderAt: number | null) => void;
  onToggleFavorite?: (id: string) => void;
  searchFolderIds?: string[];
  defaultPageSize: number;
  filterKey: string;
};

function BookmarkList({ bookmarks, activeFolderId, isSearching, folders, onRenameBookmark, onDeleteBookmark, expandedNotes, onSetExpandedNotes, onSetNotes, bulkMode, selectedIds, onToggleSelect, sortBy, tagDefs, onSetBookmarkTags, isDark, onSaveReminder, onToggleFavorite, searchFolderIds = [], defaultPageSize, filterKey }: BookmarkListProps) {
  const [collapsedUrls, setCollapsedUrls] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [expandedTags, setExpandedTags] = useState<Record<string, boolean>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(defaultPageSize === 0 ? Infinity : defaultPageSize);

  useEffect(() => {
    setVisibleCount(defaultPageSize === 0 ? Infinity : defaultPageSize);
  }, [filterKey, defaultPageSize]);

  useEffect(() => {
    if (!focusedId) return;
    document.querySelector<HTMLElement>(`[data-bookmark-id="${focusedId}"]`)
      ?.focus({ preventScroll: false });
  }, [focusedId]);

  // Compute the set of folder IDs that should be visible:
  // - specific folders selected → those folders + descendants
  // - searching with no scope → all folders (null = no filter)
  // - not searching → current folder + descendants only
  const activeIds: Set<string> | null = useMemo(() => {
    if (searchFolderIds.length > 0) {
      return new Set(searchFolderIds);
    }
    if (isSearching) return null;
    return getDescendantFolderIds(activeFolderId, folders);
  }, [searchFolderIds, isSearching, activeFolderId, folders]);

  const filtered = sortBookmarks(
    bookmarks.filter((b) => activeIds === null || activeIds.has(b.folderId)),
    sortBy,
  );

  const visible = isFinite(visibleCount) ? filtered.slice(0, visibleCount) : filtered;
  const visibleIds = filtered.map((b) => b.id);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedId(getAdjacentId(visibleIds, focusedId, e.key === "ArrowDown" ? 1 : -1));
    }
    if ((e.key === "Enter" || e.key === "ArrowRight") && focusedId) {
      const b = filtered.find((x) => x.id === focusedId);
      if (b) handleOpenBookmark(b);
    }
    if ((e.key === "Delete" || e.key === "Backspace" || e.key === "ArrowLeft") && focusedId) {
      e.preventDefault();
      if (e.key === "ArrowLeft") {
        // Pre-focus the next card synchronously so Radix Dialog captures it as the
        // focus-return target. When the confirm dialog is cancelled, focus returns
        // to the next card instead of the document body, keeping ↑↓ navigation alive.
        const nextId = getAdjacentId(visibleIds, focusedId, 1) ?? getAdjacentId(visibleIds, focusedId, -1);
        if (nextId && nextId !== focusedId) {
          setFocusedId(nextId);
          document.querySelector<HTMLElement>(`[data-bookmark-id="${nextId}"]`)?.focus();
        }
      }
      onDeleteBookmark(focusedId);
    }
    if ((e.key === "e" || e.key === "E") && focusedId) {
      setRenamingId(focusedId);
    }
    if (e.key === "Escape") {
      setFocusedId(null);
    }
  };

  const handleOpenBookmark = (b: Bookmark) => {
    recordBookmarkOpen(b.id);
    if (b.type === "SNIPPET" && b.snippet) {
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
        () => {
          const err = chrome.runtime.lastError;
          if (err) { console.warn(`ZP: Failed to write highlight request: ${err.message}`); return; }
          chrome.tabs.create({ url: b.url });
        }
      );
    } else {
      window.open(b.url, "_blank");
    }
  };

  const toggleGroup = (url: string) => {
    setCollapsedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const renderBookmarkItem = (b: Bookmark, folderName?: string) => (
    <div key={b.id}>
      <SortableBookmarkItem
        bookmark={b}
        onOpen={() => handleOpenBookmark(b)}
        onRename={() => setRenamingId(b.id)}
        isRenaming={renamingId === b.id}
        onRenameConfirm={(name) => { onRenameBookmark(b.id, name); setRenamingId(null); }}
        onRenameCancel={() => setRenamingId(null)}
        onDelete={() => onDeleteBookmark(b.id)}
        folderName={folderName}
        bulkMode={bulkMode}
        selected={selectedIds.has(b.id)}
        onToggleSelect={() => onToggleSelect(b.id)}
        expandedNote={expandedNotes[b.id]}
        onToggleNote={() => {
          const s = expandedNotes[b.id] ?? { open: false, draft: "" };
          onSetExpandedNotes({
            ...expandedNotes,
            [b.id]: { ...s, open: !s.open, draft: s.draft || b.notes || "" },
          });
        }}
        onNoteChange={(draft) => {
          onSetExpandedNotes({ ...expandedNotes, [b.id]: { open: true, draft } });
        }}
        onSaveNote={() => onSetNotes(b.id, expandedNotes[b.id]?.draft || "")}
        onCancelNote={() => {
          onSetExpandedNotes({ ...expandedNotes, [b.id]: { open: false, draft: "" } });
        }}
        isFocused={focusedId === b.id}
        onFocusCard={() => setFocusedId(b.id)}
        tagDefs={tagDefs}
        isDark={isDark}
        onToggleTags={() => setExpandedTags((prev) => ({ ...prev, [b.id]: !prev[b.id] }))}
        onSaveReminder={onSaveReminder ? (reminderAt) => onSaveReminder(b.id, reminderAt) : undefined}
        onToggleFavorite={onToggleFavorite ? () => onToggleFavorite(b.id) : undefined}
      />
      {expandedTags[b.id] && (
        <TagEditor
          currentTagIds={b.tags ?? []}
          tagDefs={tagDefs}
          isDark={isDark}
          onSave={(ids) => onSetBookmarkTags(b.id, ids)}
          onClose={() => setExpandedTags((prev) => ({ ...prev, [b.id]: false }))}
          bookmarkUrl={b.url}
          bookmarkName={b.name}
        />
      )}
    </div>
  );

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-center">
        {isSearching
          ? <BookmarkX size={32} className="text-muted-foreground/40 mb-3" />
          : <FolderSearch size={32} className="text-muted-foreground/40 mb-3" />}
        <h3 className="text-base font-semibold text-foreground">
          {isSearching ? "No results" : "This folder is empty"}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {isSearching ? "Try a different search term." : "Save a page or snippet to get started."}
        </p>
      </div>
    );
  }

  const KeyHintBar = () =>
    focusedId ? (
      <div className="sticky bottom-0 mt-4 flex items-center justify-center gap-4 py-1.5 px-3 rounded-md bg-muted/70 backdrop-blur-sm text-[11px] text-muted-foreground select-none">
        {(
          [
            ["↑↓", "navigate"],
            ["→", "open"],
            ["←", "delete"],
            ["E", "rename"],
          ] as [string, string][]
        ).map(([k, d]) => (
          <span key={k} className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-background border border-border font-mono text-[10px] leading-tight">
              {k}
            </kbd>
            <span>{d}</span>
          </span>
        ))}
      </div>
    ) : null;

  if (isSearching) {
    return (
      <div onKeyDown={handleKeyDown}>
        <h3 className="mt-0 text-base font-semibold tracking-tight text-foreground">
          Search results ({filtered.length})
        </h3>
        <div className="space-y-2">
          {visible.map((b) => renderBookmarkItem(b, folders[b.folderId]?.name))}
        </div>
        {isFinite(visibleCount) && visibleCount < filtered.length && (
          <div className="pt-3 flex items-center justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVisibleCount((v) => Math.min(v + 50, filtered.length))}
            >
              Show 50 more
              <span className="ml-1.5 text-muted-foreground text-xs">
                ({filtered.length - visibleCount} remaining)
              </span>
            </Button>
          </div>
        )}
        <KeyHintBar />
      </div>
    );
  }

  const groups = groupByUrl(visible);

  return (
    <div onKeyDown={handleKeyDown}>
      <h3 className="mt-0 text-base font-semibold tracking-tight text-foreground">
        Bookmarks ({filtered.length})
      </h3>
      <div className="space-y-2">
        {groups.map((g) => {
          const subfolderName = (b: Bookmark) =>
            b.folderId !== activeFolderId ? folders[b.folderId]?.name : undefined;
          if (g.bookmarks.length === 1) {
            return renderBookmarkItem(g.bookmarks[0], subfolderName(g.bookmarks[0]));
          }
          const expanded = !collapsedUrls.has(g.url);
          return (
            <div key={g.url}>
              <PageGroupHeader
                group={g}
                expanded={expanded}
                onToggle={() => toggleGroup(g.url)}
              />
              {expanded && (
                <div className="space-y-2 ml-1">
                  {g.bookmarks.map((b) => renderBookmarkItem(b, subfolderName(b)))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {isFinite(visibleCount) && visibleCount < filtered.length && (
        <div className="pt-3 flex items-center justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVisibleCount((v) => Math.min(v + 50, filtered.length))}
          >
            Show 50 more
            <span className="ml-1.5 text-muted-foreground text-xs">
              ({filtered.length - visibleCount} remaining)
            </span>
          </Button>
        </div>
      )}
      <KeyHintBar />
    </div>
  );
}

/* ─── CommandPalette ─────────────────────────────────────────────── */

function CommandPalette({
  open,
  onOpenChange,
  allBookmarks,
  folders,
  rootFolderId,
  onNavigateToFolder,
  onOpenBookmark,
  onNewFolder,
  onCheckDeadLinks,
  onExport,
  onOpenSettings,
  onShowShortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allBookmarks: Bookmark[];
  folders: Record<string, Folder>;
  rootFolderId: string;
  onNavigateToFolder: (id: string) => void;
  onOpenBookmark: (b: Bookmark) => void;
  onNewFolder: () => void;
  onCheckDeadLinks: () => void;
  onExport: () => void;
  onOpenSettings: () => void;
  onShowShortcuts: () => void;
}) {
  const [query, setQuery] = useState("");

  const close = () => {
    onOpenChange(false);
    setQuery("");
  };

  const matchingBookmarks = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return allBookmarks
      .filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.domain.toLowerCase().includes(q) ||
          b.url.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [query, allBookmarks]);

  const matchingFolders = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return Object.values(folders)
      .filter((f) => f.id !== rootFolderId && f.name.toLowerCase().includes(q))
      .slice(0, 5);
  }, [query, folders, rootFolderId]);

  // Top-level folders for "Go to" suggestions when query is empty
  const topFolders = useMemo(
    () =>
      Object.values(folders)
        .filter((f) => f.id !== rootFolderId && f.parentId === rootFolderId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 5),
    [folders, rootFolderId],
  );

  const noMatches = query.trim().length > 0 && matchingBookmarks.length === 0 && matchingFolders.length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); else onOpenChange(true); }}>
      <DialogContent className="overflow-hidden p-0 shadow-lg sm:max-w-lg">
        <Command
          shouldFilter={false}
          className="**:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground **:[[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 **:[[cmdk-group]]:px-2 **:[[cmdk-input-wrapper]_svg]:h-5 **:[[cmdk-input-wrapper]_svg]:w-5 **:[[cmdk-input]]:h-12 **:[[cmdk-item]]:px-2 **:[[cmdk-item]]:py-3 **:[[cmdk-item]_svg]:h-5 **:[[cmdk-item]_svg]:w-5"
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search bookmarks, folders, or an action…"
          />
          <CommandList>
            {/* Actions — always visible regardless of query */}
            <CommandGroup heading={query ? "Actions" : "Quick actions"}>
              {!query &&
                topFolders.map((f) => (
                  <CommandItem
                    key={f.id}
                    value={`go to folder ${f.name}`}
                    onSelect={() => { onNavigateToFolder(f.id); close(); }}
                  >
                    <FolderIcon size={14} />
                    <span>Go to <strong>{f.name}</strong></span>
                  </CommandItem>
                ))}
              <CommandItem value="new folder create" onSelect={() => { onNewFolder(); close(); }}>
                <Plus size={14} />
                <span>New folder</span>
              </CommandItem>
              <CommandItem value="check dead links broken scan" onSelect={() => { onCheckDeadLinks(); close(); }}>
                <Link2 size={14} />
                <span>Check dead links</span>
              </CommandItem>
              <CommandItem value="export library download json" onSelect={() => { onExport(); close(); }}>
                <Download size={14} />
                <span>Export library</span>
              </CommandItem>
              <CommandItem value="settings preferences configure" onSelect={() => { onOpenSettings(); close(); }}>
                <Settings size={14} />
                <span>Settings</span>
              </CommandItem>
              <CommandItem value="keyboard shortcuts help reference" onSelect={() => { onShowShortcuts(); close(); }}>
                <HelpCircle size={14} />
                <span>Keyboard shortcuts</span>
                <CommandShortcut>?</CommandShortcut>
              </CommandItem>
            </CommandGroup>

            {/* Inline no-match note when query finds nothing */}
            {noMatches && (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                No bookmarks or folders match &ldquo;{query}&rdquo;.
              </p>
            )}

            {matchingBookmarks.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Bookmarks">
                  {matchingBookmarks.map((b) => (
                    <CommandItem
                      key={b.id}
                      value={`bookmark ${b.name} ${b.domain}`}
                      onSelect={() => { onOpenBookmark(b); close(); }}
                    >
                      <Link2 size={14} className="shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1">{b.name}</span>
                      <CommandShortcut className="text-muted-foreground/60 text-[10px] normal-case tracking-normal">
                        {b.domain}
                      </CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {matchingFolders.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Folders">
                  {matchingFolders.map((f) => (
                    <CommandItem
                      key={f.id}
                      value={`folder ${f.name}`}
                      onSelect={() => { onNavigateToFolder(f.id); close(); }}
                    >
                      <FolderIcon size={14} className="shrink-0 text-muted-foreground" />
                      <span>{f.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/* ─── TopBar ────────────────────────────────────────────────────── */

function TopBar({ onExport, onImport, bulkMode, onToggleBulk, onOpenSettings, onOpenCommandPalette }: {
  onExport: () => void;
  onImport: (file: File) => void;
  bulkMode: boolean;
  onToggleBulk: () => void;
  onOpenSettings: () => void;
  onOpenCommandPalette: () => void;
}) {
  const { preference, toggle } = useTheme();

  return (
    <div className="flex gap-1 items-center shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={bulkMode ? "destructive" : "ghost"}
            size="icon"
            onClick={onToggleBulk}
            className="h-9 w-9"
          >
            <CheckSquare size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{bulkMode ? "Cancel selection" : "Select items"}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" onClick={onExport} className="h-9 w-9">
            <Download size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Export</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" className="h-9 w-9 relative" asChild>
            <label>
              <Upload size={16} />
              <input type="file" accept=".json,.html,.htm" onChange={(e) => { if (e.target.files?.[0]) onImport(e.target.files[0]); e.target.value = ""; }} className="hidden" />
            </label>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Import (ZeroPin JSON or browser HTML)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={toggle} className="h-9 w-9">
            {preference === "system" ? <Monitor size={16} /> : preference === "dark" ? <Moon size={16} /> : <Sun size={16} />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{preference === "system" ? "System theme" : preference === "dark" ? "Dark mode" : "Light mode"}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenCommandPalette}
            className="h-9 px-2.5 gap-1.5 text-muted-foreground font-mono text-xs"
          >
            <span>⌘K</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Command palette (Ctrl+K)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={onOpenSettings} className="h-9 w-9">
            <Settings size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>
    </div>
  );
}

/* ─── BulkActionsBar ───────────────────────────────────────────── */

function BulkActionsBar({ count, folders, onSelectAll, onDeselectAll, onDelete, onMove, onBulkReminder, onBulkAddTags, onBulkRemoveTags, tagDefs }: {
  count: number;
  folders: Record<string, import("../../core/types").Folder>;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDelete: () => void;
  onMove: (targetFolderId: string) => void;
  onBulkReminder?: (days: number) => void;
  onBulkAddTags?: (tagIds: string[]) => void;
  onBulkRemoveTags?: (tagIds: string[]) => void;
  tagDefs?: Record<string, TagDef>;
}) {
  const { isDark } = useTheme();
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagMode, setTagMode] = useState<"add" | "remove">("add");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  const tagList = Object.values(tagDefs ?? {});
  const hasTagOps = (onBulkAddTags || onBulkRemoveTags) && tagList.length > 0;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-xl px-4 py-2.5 flex items-center gap-3 shadow-lg z-100 text-sm">
      <span className="font-semibold text-foreground">{count} selected</span>
      <Button variant="link" size="sm" onClick={onSelectAll} className="px-0 h-auto text-xs">
        Select All
      </Button>
      <Button variant="link" size="sm" onClick={onDeselectAll} className="px-0 h-auto text-xs">
        Deselect All
      </Button>
      <div className="relative">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFolderPicker(!showFolderPicker)}
        >
          <FolderInput size={14} />
          Move to...
        </Button>
        {showFolderPicker && (
          <div className="absolute bottom-full left-0 mb-1 bg-popover border border-border rounded-lg p-1 min-w-40 max-h-50 overflow-y-auto shadow-lg z-101">
            {Object.values(folders).map((f) => (
              <button
                key={f.id}
                onClick={() => { setShowFolderPicker(false); onMove(f.id); }}
                className="block w-full text-left px-2.5 py-1.5 bg-transparent border-none cursor-pointer text-sm text-foreground rounded-md hover:bg-accent transition-colors"
              >
                {f.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {hasTagOps && (
        <Popover open={tagPickerOpen} onOpenChange={(o) => { setTagPickerOpen(o); if (!o) setSelectedTagIds([]); }}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Tag size={13} />
              Tags
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="center" side="top">
            {/* Add / Remove toggle */}
            <div className="flex gap-1 mb-3 rounded-lg border border-border p-0.5 bg-muted">
              <button
                onClick={() => setTagMode("add")}
                className={cn("flex-1 text-xs py-1 rounded-md transition-colors", tagMode === "add" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                Add tags
              </button>
              <button
                onClick={() => setTagMode("remove")}
                className={cn("flex-1 text-xs py-1 rounded-md transition-colors", tagMode === "remove" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                Remove tags
              </button>
            </div>
            {/* Tag chips */}
            <div className="flex flex-wrap gap-1.5 mb-3 max-h-32 overflow-y-auto">
              {tagList.map((tag) => {
                const colorEntry = tag.color ? FOLDER_COLORS[tag.color] : null;
                const colorHex = colorEntry ? (isDark ? colorEntry.dark : colorEntry.light) : null;
                const active = selectedTagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => setSelectedTagIds((prev) => active ? prev.filter((id) => id !== tag.id) : [...prev, tag.id])}
                    className={cn("inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors", active ? "ring-1 ring-primary" : "opacity-70 hover:opacity-100")}
                    style={colorHex ? { borderColor: colorHex + "60", color: colorHex, background: colorHex + (active ? "30" : "15") } : undefined}
                  >
                    #{tag.name}
                  </button>
                );
              })}
            </div>
            <Button
              size="sm"
              className="w-full"
              disabled={selectedTagIds.length === 0}
              onClick={() => {
                if (tagMode === "add") onBulkAddTags?.(selectedTagIds);
                else onBulkRemoveTags?.(selectedTagIds);
                setTagPickerOpen(false);
                setSelectedTagIds([]);
              }}
            >
              {tagMode === "add" ? "Add to selected" : "Remove from selected"}
            </Button>
          </PopoverContent>
        </Popover>
      )}
      {onBulkReminder && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Bell size={13} />
              Remind
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => onBulkReminder(1)}>Tomorrow</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onBulkReminder(3)}>In 3 days</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onBulkReminder(7)}>In 1 week</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button variant="destructive" size="sm" onClick={onDelete}>
        <Trash2 size={14} />
        Delete
      </Button>
    </div>
  );
}

/* ─── AI domain detection ──────────────────────────────────────── */

/* ─── Library (main component) ──────────────────────────────────── */

// ── FilterBar ─────────────────────────────────────────────────────────────────

type FilterBarProps = {
  sortBy: SortKey;
  onSortChange: (v: SortKey) => void;
};

function FilterBar({
  sortBy, onSortChange,
}: FilterBarProps) {
  return (
    <div className="flex gap-2 items-center shrink-0">
      <Select value={sortBy} onValueChange={(v) => onSortChange(v as SortKey)}>
        <SelectTrigger className="w-auto h-9 text-xs shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="newest">Newest</SelectItem>
          <SelectItem value="oldest">Oldest</SelectItem>
          <SelectItem value="name_asc">Name A→Z</SelectItem>
          <SelectItem value="name_desc">Name Z→A</SelectItem>
          <SelectItem value="last_opened">Last Opened</SelectItem>
          <SelectItem value="most_opened">Most Opened</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ── FolderSidebarPanel ────────────────────────────────────────────────────────

type FolderSidebarPanelProps = {
  state: LibraryState;
  activeFolderId: string;
  isDark: boolean;
  tagsExpanded: boolean;
  onToggleTags: () => void;
  activeTagFilters: string[];
  availableTagIds: Set<string>;
  onTagFilterChange: (id: string) => void;
  allBookmarks: Bookmark[];
  sortedTagDefs: TagDef[];
  emptyFolderIds: Set<string>;
  rootFolderCount: number;
  onDeleteTag: (id: string) => void;
  onCreateFolder: () => void;
  onSelectFolder: (id: string) => Promise<void>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onDeleteFolder: (id: string) => void;
  onIconChange: (id: string, icon: string | undefined) => Promise<void>;
};

function FolderSidebarPanel({
  state, activeFolderId, isDark, tagsExpanded, onToggleTags,
  activeTagFilters, availableTagIds, onTagFilterChange, allBookmarks, sortedTagDefs,
  emptyFolderIds, rootFolderCount, onDeleteTag, onCreateFolder,
  onSelectFolder, onRenameFolder, onDeleteFolder, onIconChange,
}: FolderSidebarPanelProps) {
  return (
    <>
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Folders</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onCreateFolder}
              className="p-1 rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent>New folder</TooltipContent>
        </Tooltip>
      </div>
      <FolderTree
        state={state}
        activeFolderId={activeFolderId}
        onSelectFolder={onSelectFolder}
        onRenameFolder={onRenameFolder}
        onDeleteFolder={onDeleteFolder}
        onIconChange={onIconChange}
        emptyFolderIds={emptyFolderIds}
        rootFolderCount={rootFolderCount}
      />
      <div className="mt-4 pt-4 border-t border-border px-2">
        <button
          onClick={onToggleTags}
          className="flex items-center gap-1.5 w-full text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5 hover:text-foreground transition-colors"
        >
          {tagsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Tags
        </button>
        {tagsExpanded && (
          <div className="space-y-0.5">
            {sortedTagDefs.map((tag) => {
              const isActive = activeTagFilters.includes(tag.id);
              // Always hide tags not in the visible result set, unless the tag is active
              // (so user can click it to deactivate). When no filters/search are applied
              // availableTagIds contains every tag, so nothing is hidden.
              if (!isActive && !availableTagIds.has(tag.id)) return null;
              const colorEntry = tag.color ? FOLDER_COLORS[tag.color] : null;
              const colorHex = colorEntry ? (isDark ? colorEntry.dark : colorEntry.light) : null;
              const count = allBookmarks.filter((b) => (b.tags ?? []).includes(tag.id)).length;
              return (
                <div key={tag.id} className="group/tag relative flex items-center">
                  <button
                    onClick={() => onTagFilterChange(tag.id)}
                    className={cn(
                      "flex items-center gap-1.5 flex-1 rounded px-1.5 py-1 text-sm text-left transition-colors pr-6",
                      count === 0 ? "opacity-50" : "",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-accent/50 text-foreground",
                    )}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0 border border-border/50"
                      style={{ background: colorHex ?? "transparent" }}
                    />
                    <span className="truncate flex-1">#{tag.name}</span>
                    <span className="text-xs text-muted-foreground">{count}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteTag(tag.id); }}
                    className="absolute right-1 opacity-0 group-hover/tag:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground"
                    title="Delete tag"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
            {sortedTagDefs.length === 0 && (
              <p className="text-xs text-muted-foreground px-1.5 py-1">No tags yet</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default function Library() {
  const { showToast } = useToast();
  const { isDark } = useTheme();
  const {
    state,
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
  } = useLibraryState();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchFolderIds, setSearchFolderIds] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(276);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);
  const [tagsExpanded, setTagsExpanded] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingDivider = useRef(false);

  const [remindersCollapsed, setRemindersCollapsed] = useState(false);
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter | null>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingDivider.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const maxWidth = Math.floor(rect.width * 0.5);
      const newWidth = Math.min(maxWidth, Math.max(160, e.clientX - rect.left));
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => { isDraggingDivider.current = false; };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Hooks must be called before any conditional return.
  // Use a null-safe state for hook calls that require non-null state.
  const _safeState = state ?? ({
    bookmarks: {},
    folders: {},
    tagDefs: {},
    rootFolderId: "",
    schemaVersion: 0,
  } as unknown as LibraryState);

  const _currentFolderId = state ? (activeFolderId ?? state.rootFolderId) : "";
  const folderScopeSummary = useMemo(() => {
    if (!state || searchFolderIds.length === 0) return { short: "All folders", full: "All folders" };
    const names = Array.from(new Set(searchFolderIds))
      .map((id) => state.folders[id]?.name)
      .filter((name): name is string => Boolean(name))
      .sort((a, b) => a.localeCompare(b));
    if (names.length === 0) return { short: "All folders", full: "All folders" };
    const short =
      names.length <= 2
        ? names.map((name) => truncate(name, 18)).join(", ")
        : `${truncate(names[0], 18)}, ${truncate(names[1], 18)} +${names.length - 2}`;
    return { short, full: names.join(", ") };
  }, [state, searchFolderIds]);

  const dateScopeSummary = useMemo(() => {
    if (!dateFrom && !dateTo) return "Any date";
    return `${dateFrom || "…"} → ${dateTo || "…"}`;
  }, [dateFrom, dateTo]);

  const pipeline = useFilterPipeline(_safeState, prefs, {
    searchQuery,
    dateFrom,
    dateTo,
    activeTagFilters,
    dashboardFilter,
  });

  const bookmarkOps = useBookmarkOps({
    state: _safeState,
    refreshState,
    showToast,
    pendingSave,
    setPendingSaveState,
    pickerTagIds,
    setConfirmDialog,
  });

  const folderOps = useFolderOps({
    state: _safeState,
    refreshState,
    showToast,
    activeFolderId,
    setActiveFolderId,
    currentFolderId: _currentFolderId,
    isPickerMode,
    pendingSave,
    onPickerSave: bookmarkOps.handlePickerSave,
    setConfirmDialog,
    setDashboardFilter,
  });

  // Global keyboard shortcuts — must be before early return; references hook objects directly
  useEffect(() => {
    const anyDialogOpen = !!confirmDialog || settingsOpen || shortcutsOpen
      || folderOps.isFolderModalOpen || !!bookmarkOps.browserImportPreview;
    function onKey(e: KeyboardEvent) {
      // Ctrl+K / ⌘K — command palette (works even when dialogs open, closes them)
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((o) => !o);
        return;
      }
      if (e.key === "?" && !anyDialogOpen && (e.target as HTMLElement).tagName !== "INPUT" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
        setShortcutsOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDialog, settingsOpen, shortcutsOpen, folderOps.isFolderModalOpen, bookmarkOps.browserImportPreview]);

  // ── Early return after all hooks ────────────────────────────────────────────
  if (!state) return <div className="p-4 text-foreground">Loading\u2026</div>;

  const currentFolderId = _currentFolderId;
  const {
    allBookmarks,
    dueBookmarks,
    filtered,
    deadLinkBookmarks,
    favoriteBookmarks,
    notesBookmarks,
    emptyFolderIds,
    sortedTagDefs,
    rootFolderCount,
    isSearching,
    availableTagIds,
  } = pipeline;

  const {
    isFolderModalOpen,
    setFolderModalOpen,
    folderNameDraft,
    setFolderNameDraft,
    handleCreateFolder,
    handleCreateFolderSubmit,
    handleSelectFolder,
    handleRenameFolder,
    handleDeleteFolder,
    handleSetFolderIcon,
  } = folderOps;

  const {
    expandedNotes,
    setExpandedNotes,
    bulkMode,
    setBulkMode,
    selectedIds,
    setSelectedIds,
    browserImportPreview,
    setBrowserImportPreview,
    includeDups,
    setIncludeDups,
    deadLinkChecking,
    deadLinkProgress,
    deadLinkTotal,
    showDeadLinkModal,
    setShowDeadLinkModal,
    deadLinkModalResult,
    handleDeleteBookmark,
    handleCheckDeadLinks,
    handleStopDeadLinkCheck,
    handleRenameBookmark,
    handleSetBookmarkTags,
    handleDismissReminder,
    handleSnoozeReminder,
    handleBulkSetReminder,
    handleSaveReminderDirect,
    handleSetBookmarkNotes,
    handleBrowserImportConfirm,
    handleExport,
    handleImport,
    handleToggleFavorite,
    handleBulkAddTags,
    handleBulkRemoveTags,
  } = bookmarkOps;

  /* ─── Handlers ─────────────────────────────────────────────── */

  const handleDeleteTag = async (tagId: string) => {
    try {
      await deleteTag(tagId);
      setActiveTagFilters((prev) => prev.filter((t) => t !== tagId));
      await refreshState();
    } catch (err) {
      console.error("Failed to delete tag", err);
      showToast("Failed to delete tag", "error");
    }
  };

  /* ─── Render ───────────────────────────────────────────────── */

  return (
    <>
      <div className="h-screen w-screen bg-background overflow-hidden">
        <div className="w-full h-screen overflow-hidden bg-card flex flex-col">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-card border-b border-border p-3">
            {/* Row 1: brand | search | folder name */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2.5 shrink-0">
                <BrandIcon size={22} />
                <span className="font-bold text-lg tracking-tight text-foreground">ZeroPin</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-full"
                      onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("walkthrough.html") })}
                    >
                      <HelpCircle size={14} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>How to use</TooltipContent>
                </Tooltip>
              </div>
              <div className="relative flex-1">
                <Input
                  type="text"
                  placeholder="Search bookmarks\u2026"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); if (e.target.value.trim()) setDashboardFilter(null); }}
                  className="h-9 w-full pr-20"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-10 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    title="Clear search"
                  >
                    <X size={14} />
                  </button>
                )}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "absolute right-1 top-1/2 h-7 w-8 -translate-y-1/2 rounded-r-md border-l border-border/70 flex items-center justify-center bg-background/80 transition-colors",
                        searchFolderIds.length > 0
                          ? "text-primary bg-primary/5"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                      )}
                      title={searchFolderIds.length > 0 || dateFrom || dateTo ? "Filters active" : "Filters"}
                    >
                      <Funnel size={14} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-3" align="end">
                    <div className="text-xs font-medium text-muted-foreground mb-2">Date added</div>
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground block">From</label>
                        <input
                          type="date"
                          value={dateFrom}
                          max={dateTo || undefined}
                          onChange={(e) => setDateFrom(e.target.value)}
                          className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background text-foreground"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground block">To</label>
                        <input
                          type="date"
                          value={dateTo}
                          min={dateFrom || undefined}
                          onChange={(e) => setDateTo(e.target.value)}
                          className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background text-foreground"
                        />
                      </div>
                      {(dateFrom || dateTo) && (
                        <button
                          className="text-xs text-muted-foreground hover:text-foreground underline"
                          onClick={() => { setDateFrom(""); setDateTo(""); }}
                        >
                          Clear date filter
                        </button>
                      )}
                    </div>
                    <div className="my-2 border-t border-border" />
                    <div className="text-xs font-medium text-muted-foreground px-1 mb-1.5">Search in folders</div>
                    <button
                      onClick={() => setSearchFolderIds([])}
                      className={cn(
                        "flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm transition-colors",
                        searchFolderIds.length === 0
                          ? "bg-primary/10 text-primary font-medium"
                          : "hover:bg-muted text-foreground"
                      )}
                    >
                      <FolderIcon size={13} />
                      {state.folders[state.rootFolderId]?.name ?? "ZeroPin"}
                    </button>
                    <div className="my-1 border-t border-border" />
                    {(() => {
                      const renderTree = (parentId: string, depth: number): React.ReactNode[] => {
                        const children = Object.values(state.folders)
                          .filter((f) => f.parentId === parentId)
                          .sort((a, b) => a.name.localeCompare(b.name));
                        return children.flatMap((folder) => {
                          const isSelected = searchFolderIds.includes(folder.id);
                          return [
                            <button
                              key={folder.id}
                              onClick={() => {
                                const subtreeIds = getDescendantFolderIds(folder.id, state.folders);
                                setSearchFolderIds((prev) => {
                                  const next = new Set(prev);
                                  const shouldSelect = !next.has(folder.id);
                                  for (const id of subtreeIds) {
                                    if (shouldSelect) next.add(id);
                                    else next.delete(id);
                                  }
                                  return Array.from(next);
                                });
                              }}
                              style={{ paddingLeft: `${8 + depth * 5}px` }}
                              className={cn(
                                "flex items-center gap-2 w-full pr-2 py-1.5 rounded text-sm transition-colors",
                                isSelected
                                  ? "bg-primary/10 text-primary font-medium"
                                  : "hover:bg-muted text-foreground"
                              )}
                            >
                              <div className={cn("w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 text-[9px]", isSelected ? "bg-primary border-primary text-primary-foreground" : "border-border")}>
                                {isSelected && "✓"}
                              </div>
                              <span className="truncate">{folder.name}</span>
                            </button>,
                            ...renderTree(folder.id, depth + 1),
                          ];
                        });
                      };
                      return renderTree(state.rootFolderId, 0);
                    })()}
                  </PopoverContent>
                </Popover>
              </div>
              {/* Folder scope selector */}
              {false && state && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-9 w-9 shrink-0",
                      searchFolderIds.length > 0
                        ? "text-primary bg-primary/10 hover:bg-primary/20"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title={searchFolderIds.length > 0 ? `Searching in ${searchFolderIds.length} folder${searchFolderIds.length !== 1 ? "s" : ""}` : "Search scope: all folders"}
                  >
                    <FolderSearch size={16} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2" align="end">
                  <div className="text-xs font-medium text-muted-foreground px-1 mb-1.5">Search in folders</div>
                  <button
                    onClick={() => setSearchFolderIds([])}
                    className={cn(
                      "flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm transition-colors",
                      searchFolderIds.length === 0
                        ? "bg-primary/10 text-primary font-medium"
                        : "hover:bg-muted text-foreground"
                    )}
                  >
                    <FolderIcon size={13} />
                    {_safeState.folders[_safeState.rootFolderId]?.name ?? "ZeroPin"}
                  </button>
                  <div className="my-1 border-t border-border" />
                  {(() => {
                    const renderTree = (parentId: string, depth: number): React.ReactNode[] => {
                      const children = Object.values(_safeState.folders)
                        .filter((f) => f.parentId === parentId)
                        .sort((a, b) => a.name.localeCompare(b.name));
                      return children.flatMap((folder) => {
                        const isSelected = searchFolderIds.includes(folder.id);
                        return [
                          <button
                            key={folder.id}
                            onClick={() => {
                              const subtreeIds = getDescendantFolderIds(folder.id, _safeState.folders);
                              setSearchFolderIds((prev) => {
                                const next = new Set(prev);
                                const shouldSelect = !next.has(folder.id);
                                for (const id of subtreeIds) {
                                  if (shouldSelect) next.add(id);
                                  else next.delete(id);
                                }
                                return Array.from(next);
                              });
                            }}
                            style={{ paddingLeft: `${8 + depth * 5}px` }}
                            className={cn(
                              "flex items-center gap-2 w-full pr-2 py-1.5 rounded text-sm transition-colors",
                              isSelected
                                ? "bg-primary/10 text-primary font-medium"
                                : "hover:bg-muted text-foreground"
                            )}
                          >
                            <div className={cn("w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 text-[9px]", isSelected ? "bg-primary border-primary text-primary-foreground" : "border-border")}>
                              {isSelected && "✓"}
                            </div>
                            <span className="truncate">{folder.name}</span>
                          </button>,
                          ...renderTree(folder.id, depth + 1),
                        ];
                      });
                    };
                    return renderTree(_safeState.rootFolderId, 0);
                  })()}
                </PopoverContent>
              </Popover>
              )}
              <div className="text-right shrink-0">
                <div className="text-xs text-muted-foreground">Folder</div>
                <div className="text-sm font-semibold text-foreground">
                  {state.folders[currentFolderId]?.name ?? "ZeroPin"}
                </div>
              </div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground truncate" title={`Date: ${dateScopeSummary} • Folders: ${folderScopeSummary.full}`}>
              In dates: <span className="text-foreground">{dateScopeSummary}</span>
              <span className="mx-1">•</span>
              In folders: <span className="text-foreground">{folderScopeSummary.short}</span>
            </div>
            <div className="mt-2 flex items-start gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <FilterBar
                  sortBy={sortBy}
                  onSortChange={setSortBy}
                />
                <HealthDashboard
                  deadCount={deadLinkBookmarks.length}
                  favoritesCount={favoriteBookmarks.length}
                  notesCount={notesBookmarks.length}
                  deadLinkChecking={deadLinkChecking}
                  deadLinkProgress={deadLinkProgress}
                  deadLinkTotal={deadLinkTotal}
                  activeFilter={dashboardFilter}
                  onDeadLinksClick={() => { if (dashboardFilter === "deadlinks") { setDashboardFilter(null); } else { void handleCheckDeadLinks(); setDashboardFilter("deadlinks"); } }}
                  onStopDeadLinkCheck={handleStopDeadLinkCheck}
                  onFavoritesClick={() => setDashboardFilter((f) => f === "favorites" ? null : "favorites")}
                  onNotesClick={() => setDashboardFilter((f) => f === "notes" ? null : "notes")}
                />
              </div>
              <div className="shrink-0">
                <TopBar
                  onExport={handleExport}
                  onImport={handleImport}
                  bulkMode={bulkMode}
                  onToggleBulk={() => {
                    setBulkMode(!bulkMode);
                    if (bulkMode) setSelectedIds(new Set());
                  }}
                  onOpenSettings={() => {
                    setPrefsDraft(prefs);
                    setSettingsOpen(true);
                  }}
                  onOpenCommandPalette={() => setCommandPaletteOpen(true)}
                />
              </div>
            </div>
          </div>

          {/* Picker mode banner */}
          {isPickerMode && pendingSave && (
            <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/20">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-primary shrink-0">Saving to\u2026</span>
                <span className="text-sm text-foreground truncate flex-1">{pendingSave.title || pendingSave.url}</span>
                <Button size="sm" variant="ghost" onClick={() => window.close()}>Cancel</Button>
              </div>
              {pickerSuggestedIds.length > 0 && state?.tagDefs && (
                <div className="flex flex-wrap gap-1 mt-1.5 items-center">
                  <span className="text-[10px] text-muted-foreground mr-0.5">Suggested:</span>
                  {pickerSuggestedIds.map((id) => {
                    const tag = state.tagDefs![id];
                    if (!tag) return null;
                    const colorEntry = tag.color ? FOLDER_COLORS[tag.color] : null;
                    const colorHex = colorEntry ? (isDark ? colorEntry.dark : colorEntry.light) : null;
                    const selected = pickerTagIds.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setPickerTagIds((p) => selected ? p.filter((x) => x !== id) : [...p, id])}
                        className={cn(
                          "inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border transition-colors",
                          selected ? "ring-1 ring-primary" : "opacity-70 hover:opacity-100"
                        )}
                        style={colorHex ? { borderColor: colorHex + "60", color: colorHex, background: colorHex + (selected ? "30" : "15") } : undefined}
                      >
                        {selected ? "\u2713" : "+"} #{tag.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Two-column body */}
          <div ref={containerRef} className="flex flex-1 min-h-0">
            <div className="shrink-0 p-3 overflow-y-auto bg-sidebar" style={{ width: sidebarWidth }}>
              <FolderSidebarPanel
                state={state}
                activeFolderId={currentFolderId}
                isDark={isDark}
                tagsExpanded={tagsExpanded}
                onToggleTags={() => setTagsExpanded((v) => !v)}
                activeTagFilters={activeTagFilters}
                availableTagIds={availableTagIds}
                onTagFilterChange={(id) =>
                  setActiveTagFilters((prev) =>
                    prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
                  )
                }
                allBookmarks={allBookmarks}
                sortedTagDefs={sortedTagDefs}
                emptyFolderIds={emptyFolderIds}
                rootFolderCount={rootFolderCount}
                onDeleteTag={handleDeleteTag}
                onCreateFolder={handleCreateFolder}
                onSelectFolder={handleSelectFolder}
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={handleDeleteFolder}
                onIconChange={handleSetFolderIcon}
              />
            </div>
            {/* Drag divider */}
            <div
              onMouseDown={(e) => { isDraggingDivider.current = true; e.preventDefault(); }}
              className="w-1.5 shrink-0 border-r border-border cursor-col-resize hover:bg-primary/20 transition-colors"
              title="Drag to resize"
            />
            <div className="flex-1 min-w-0 p-4 overflow-y-auto bg-background">
              {!isSearching && dueBookmarks.length > 0 && (
                <RemindersSection
                  bookmarks={dueBookmarks}
                  onDismiss={handleDismissReminder}
                  onSnooze={handleSnoozeReminder}
                  collapsed={remindersCollapsed}
                  onToggleCollapse={() => setRemindersCollapsed((v) => !v)}
                />
              )}
              {dashboardFilter && (
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="text-xs text-muted-foreground">Showing:</span>
                  <span className="flex items-center gap-1 text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5">
                    {dashboardFilter === "deadlinks" && "Dead links"}
                    {dashboardFilter === "favorites" && "Favourite bookmarks"}
                    {dashboardFilter === "notes" && "Bookmarks with notes"}
                    <button onClick={() => setDashboardFilter(null)} className="ml-0.5 hover:text-primary/70">&times;</button>
                  </span>
                </div>
              )}
              {activeTagFilters.length > 0 && (
                <div className="flex items-center gap-1.5 mb-2 px-1 flex-wrap">
                  <span className="text-xs text-muted-foreground shrink-0">Filtered by:</span>
                  {activeTagFilters.map((tagId) => {
                    const tag = state.tagDefs?.[tagId];
                    if (!tag) return null;
                    return (
                      <span key={tagId} className="flex items-center gap-1 text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5">
                        #{tag.name}
                        <button
                          onClick={() => setActiveTagFilters((prev) => prev.filter((t) => t !== tagId))}
                          className="ml-0.5 hover:text-primary/70"
                        >&times;</button>
                      </span>
                    );
                  })}
                  {activeTagFilters.length > 1 && (
                    <button
                      onClick={() => setActiveTagFilters([])}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Clear all
                    </button>
                  )}
                </div>
              )}
              <BookmarkList
                bookmarks={filtered}
                activeFolderId={currentFolderId}
                isSearching={isSearching}
                folders={state.folders}
                onRenameBookmark={handleRenameBookmark}
                onDeleteBookmark={handleDeleteBookmark}
                expandedNotes={expandedNotes}
                onSetExpandedNotes={setExpandedNotes}
                onSetNotes={handleSetBookmarkNotes}
                bulkMode={bulkMode}
                selectedIds={selectedIds}
                onToggleSelect={(id) => {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                }}
                sortBy={sortBy}
                tagDefs={state.tagDefs ?? {}}
                onSetBookmarkTags={handleSetBookmarkTags}
                isDark={isDark}
                onSaveReminder={handleSaveReminderDirect}
                onToggleFavorite={handleToggleFavorite}
                searchFolderIds={searchFolderIds}
                defaultPageSize={prefs.defaultPageSize}
                filterKey={`${_currentFolderId}:${searchQuery}:${sortBy}:${dashboardFilter ?? ""}:${activeTagFilters.join(",")}`}
              />
            </div>
          </div>
        </div>

        {bulkMode && selectedIds.size > 0 && (
          <BulkActionsBar
            count={selectedIds.size}
            folders={state.folders}
            onSelectAll={() => {
              const visible = filtered.filter((b) => isSearching || b.folderId === currentFolderId);
              setSelectedIds(new Set(visible.map((b) => b.id)));
            }}
            onDeselectAll={() => setSelectedIds(new Set())}
            onDelete={() => {
              const count = selectedIds.size;
              setConfirmDialog({
                title: `Delete ${count} bookmark(s)?`,
                description: "This cannot be undone.",
                onConfirm: async () => {
                  await bulkDeleteBookmarks(Array.from(selectedIds));
                  chrome.runtime.sendMessage({ type: "ZP_REMINDERS_CHANGED" });
                  setSelectedIds(new Set());
                  setBulkMode(false);
                  await refreshState();
                  showToast(`${count} bookmark(s) deleted`);
                },
              });
            }}
            onMove={async (targetFolderId) => {
              try {
                await bulkMoveBookmarks(Array.from(selectedIds), targetFolderId);
                setSelectedIds(new Set());
                setBulkMode(false);
                await refreshState();
                showToast(`Moved ${selectedIds.size} bookmark(s)`);
              } catch (err) {
                console.error("Bulk move failed", err);
                showToast("Failed to move bookmarks", "error");
              }
            }}
            onBulkReminder={handleBulkSetReminder}
            onBulkAddTags={handleBulkAddTags}
            onBulkRemoveTags={handleBulkRemoveTags}
            tagDefs={state.tagDefs ?? {}}
          />
        )}

        {/* Dead link check completion modal */}
        <Dialog open={showDeadLinkModal} onOpenChange={setShowDeadLinkModal}>
          <DialogContent className="sm:max-w-sm overflow-y-auto max-h-[90vh]">
            <DialogHeader>
              <DialogTitle>Link check complete</DialogTitle>
              <DialogDescription className="sr-only">Results of the dead link check</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <p className="text-sm text-muted-foreground">
                ✓ {((deadLinkModalResult?.total ?? 0) - (deadLinkModalResult?.dead ?? 0))} links working
              </p>
              <p className="text-sm font-medium">
                💀 {deadLinkModalResult?.dead ?? 0} dead link{(deadLinkModalResult?.dead ?? 0) !== 1 ? "s" : ""} found
              </p>
            </div>
            <div className="flex gap-2 justify-end mt-2">
              <Button variant="outline" onClick={() => setShowDeadLinkModal(false)}>Dismiss</Button>
              {(deadLinkModalResult?.dead ?? 0) > 0 && (
                <Button onClick={() => { setShowDeadLinkModal(false); setDashboardFilter("deadlinks"); }}>
                  View dead links
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Generic confirm dialog — replaces window.confirm() */}
        <Dialog open={!!confirmDialog} onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{confirmDialog?.title}</DialogTitle>
              <DialogDescription>{confirmDialog?.description}</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setConfirmDialog(null)}>Cancel</Button>
              <Button variant="destructive" onClick={async () => {
                await confirmDialog?.onConfirm();
                setConfirmDialog(null);
              }}>Delete</Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={isFolderModalOpen} onOpenChange={setFolderModalOpen}>
          <DialogContent className="sm:max-w-80">
            <DialogHeader>
              <DialogTitle>New Folder</DialogTitle>
              <DialogDescription className="sr-only">Enter a name for the new folder</DialogDescription>
            </DialogHeader>
            <Input
              placeholder="Folder name"
              value={folderNameDraft}
              onChange={(e) => setFolderNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolderSubmit();
              }}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setFolderModalOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateFolderSubmit}>Create</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Settings dialog */}
        <Dialog open={settingsOpen} onOpenChange={(open) => { if (!open) setSettingsOpen(false); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Settings</DialogTitle>
              <DialogDescription>Adjust ZeroPin behaviour preferences.</DialogDescription>
            </DialogHeader>
            <div className="space-y-5 py-1">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <label className="font-medium">Highlight fade</label>
                  <span className="text-muted-foreground">{prefsDraft.highlightDurationMs / 1000}s</span>
                </div>
                <input
                  type="range"
                  min={1000} max={10000} step={1000}
                  value={prefsDraft.highlightDurationMs}
                  onChange={(e) => setPrefsDraft((d) => ({ ...d, highlightDurationMs: Number(e.target.value) }))}
                  className="w-full accent-primary"
                />
                <p className="text-xs text-muted-foreground">How long text stays highlighted after opening a snippet (1–10 s).</p>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <label className="font-medium">Snippet card dismiss</label>
                  <span className="text-muted-foreground">{prefsDraft.snippetDismissMs / 1000}s</span>
                </div>
                <input
                  type="range"
                  min={5000} max={30000} step={1000}
                  value={prefsDraft.snippetDismissMs}
                  onChange={(e) => setPrefsDraft((d) => ({ ...d, snippetDismissMs: Number(e.target.value) }))}
                  className="w-full accent-primary"
                />
                <p className="text-xs text-muted-foreground">How long the save-snippet card stays visible on AI pages (5–30 s).</p>
              </div>
              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-sm font-medium">Library display</p>
                <div className="flex items-center justify-between text-sm">
                  <label className="font-medium">Bookmarks shown by default</label>
                  <Select
                    value={String(prefsDraft.defaultPageSize)}
                    onValueChange={(v) => setPrefsDraft((d) => ({ ...d, defaultPageSize: Number(v) }))}
                  >
                    <SelectTrigger className="w-28 h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="500">500</SelectItem>
                      <SelectItem value="0">All</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">How many bookmarks to show before "Show more". Applies to folder views and search results.</p>
              </div>
              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-sm font-medium">Reminders</p>
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={prefsDraft.reminderNotificationEnabled}
                    onChange={(e) => setPrefsDraft((d) => ({ ...d, reminderNotificationEnabled: e.target.checked }))}
                    className="cursor-pointer"
                  />
                  Daily reminder notification
                </label>
                {prefsDraft.reminderNotificationEnabled && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground pl-5">
                    Notify at:
                    <input
                      type="time"
                      value={`${String(prefsDraft.reminderNotificationHour).padStart(2, "0")}:00`}
                      onChange={(e) => {
                        const h = parseInt(e.target.value.split(":")[0], 10);
                        if (!isNaN(h)) setPrefsDraft((d) => ({ ...d, reminderNotificationHour: h }));
                      }}
                      className="border border-border rounded px-1.5 py-0.5 bg-background text-foreground text-sm"
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">When enabled, ZeroPin sends one daily OS notification if you have due reminders. The Reminders section in the library is always available regardless of this setting.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button>
              <Button onClick={async () => {
                await setPrefs(prefsDraft);
                setPrefsState(prefsDraft);
                setSettingsOpen(false);
              }}>Save</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Command palette */}
        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          allBookmarks={allBookmarks}
          folders={state.folders}
          rootFolderId={state.rootFolderId}
          onNavigateToFolder={(id) => {
            setActiveFolderId(id);
            setCommandPaletteOpen(false);
          }}
          onOpenBookmark={(b) => {
            openBookmark(b);
            setCommandPaletteOpen(false);
          }}
          onNewFolder={() => {
            handleCreateFolder();
            setCommandPaletteOpen(false);
          }}
          onCheckDeadLinks={() => {
            void handleCheckDeadLinks();
            setDashboardFilter("deadlinks");
            setCommandPaletteOpen(false);
          }}
          onExport={() => {
            handleExport();
            setCommandPaletteOpen(false);
          }}
          onOpenSettings={() => {
            setPrefsDraft(prefs);
            setSettingsOpen(true);
            setCommandPaletteOpen(false);
          }}
          onShowShortcuts={() => {
            setShortcutsOpen(true);
            setCommandPaletteOpen(false);
          }}
        />

        {/* Keyboard shortcuts cheat-sheet */}
        <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
          <DialogContent className="sm:max-w-xs">
            <DialogHeader>
              <DialogTitle>Keyboard shortcuts</DialogTitle>
              <DialogDescription className="sr-only">Keyboard shortcuts reference</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 text-sm">
              {([
                ["↑ / ↓", "Navigate bookmarks"],
                ["→ / Enter", "Open focused bookmark"],
                ["←  / Delete", "Delete focused bookmark"],
                ["E", "Rename focused bookmark"],
                ["Ctrl K", "Command palette"],
                ["Esc", "Clear focus"],
                ["?", "Show this panel"],
              ] as [string, string][]).map(([key, desc]) => (
                <div key={key} className="flex items-center gap-3">
                  <kbd className="px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono text-xs shrink-0">{key}</kbd>
                  <span className="text-muted-foreground">{desc}</span>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        {/* Browser import preview dialog */}
        <Dialog open={!!browserImportPreview} onOpenChange={(open) => { if (!open) setBrowserImportPreview(null); }}>
          {browserImportPreview && (() => {
            const available = Math.max(0, BOOKMARK_CAP - browserImportPreview.currentBookmarkCount);
            const wantToImport = includeDups
              ? browserImportPreview.newCount + browserImportPreview.dupCount
              : browserImportPreview.newCount;
            const importableCount = Math.min(wantToImport, available);
            const capExceeded = wantToImport > available;
            return (
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>Import from {browserSourceLabel(browserImportPreview.source)}</DialogTitle>
                  <DialogDescription>Review before importing</DialogDescription>
                </DialogHeader>
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Detected browser</span>
                    <span className="font-medium">{browserSourceLabel(browserImportPreview.source)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Folders found</span>
                    <span className="font-medium">{browserImportPreview.parsedFolderCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bookmarks found</span>
                    <span className="font-medium">{browserImportPreview.parsedBookmarkCount}</span>
                  </div>
                  <div className="border-t border-border pt-2.5 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">New bookmarks</span>
                      <span className="font-medium text-success">{browserImportPreview.newCount}</span>
                    </div>
                    {browserImportPreview.dupCount > 0 && (
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-muted-foreground cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={includeDups}
                            onChange={(e) => setIncludeDups(e.target.checked)}
                            className="cursor-pointer"
                          />
                          Include {browserImportPreview.dupCount} duplicate{browserImportPreview.dupCount !== 1 ? "s" : ""} already in ZeroPin
                        </label>
                      </div>
                    )}
                  </div>
                  {capExceeded && (
                    <div className="bg-destructive/10 text-destructive rounded-md p-3 text-xs">
                      Bookmark limit ({BOOKMARK_CAP.toLocaleString()}) reached. Only {importableCount} of {wantToImport} bookmarks will be imported. Delete some existing bookmarks to import more.
                    </div>
                  )}
                  {importableCount === 0 && (
                    <div className="bg-muted rounded-md p-3 text-xs text-muted-foreground">
                      {browserImportPreview.newCount === 0 && !includeDups
                        ? "All bookmarks in this file are already in ZeroPin. Enable \"Include duplicates\" to import anyway."
                        : "Nothing to import — bookmark limit reached."}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 justify-end mt-2">
                  <Button variant="outline" onClick={() => setBrowserImportPreview(null)}>Cancel</Button>
                  <Button onClick={handleBrowserImportConfirm} disabled={importableCount === 0}>
                    Import {importableCount} bookmark{importableCount !== 1 ? "s" : ""}
                  </Button>
                </div>
              </DialogContent>
            );
          })()}
        </Dialog>
      </div>
    </>
  );
}
