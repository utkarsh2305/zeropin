import { useEffect, useState, useRef, useCallback } from "react";
import { getPrefs, setPrefs, type Prefs } from "../../core/storage/prefs";
import { getState, setLastUsedFolder, deleteBookmark, createFolder, exportState, importState, renameFolder, deleteFolderCascade, renameBookmark, moveBookmark, reorderBookmarks, moveFolderToParent, setBookmarkNotes, bulkDeleteBookmarks, bulkMoveBookmarks, recordBookmarkOpen, setFolderColor, addPageBookmark, addSelectionBookmark, createTag, deleteTag, setBookmarkTags } from "../../core/storage/local";
import { getPendingSave, setPendingSave, updateRecents } from "../../core/storage/recents";
import type { PendingSave } from "../../core/storage/recents";
import { parseBrowserHtml, detectBrowserSource, buildImportPreview, browserSourceLabel, commitBrowserImport, BOOKMARK_CAP } from "../../core/storage/importBrowser";
import type { BrowserImportPreview } from "../../core/storage/importBrowser";
import type { LibraryState, Bookmark, Folder, TagDef } from "../../core/types";
import { useTheme } from "../theme";
import { useToast } from "../Toast";
import { draggable, dropTargetForElements, monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachClosestEdge, extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import type { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { reorder } from "@atlaskit/pragmatic-drag-and-drop/reorder";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Folder as FolderIcon, Sun, Moon, Monitor, MoreVertical, GripVertical, Pencil, X, ChevronDown, ChevronRight, HelpCircle, FolderPlus, Download, Upload, CheckSquare, Trash2, FolderInput, Palette, Settings } from "lucide-react";
import { BrandIcon } from "../BrandIcon";

/* ─── Helpers ───────────────────────────────────────────────────── */

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

/* ─── DroppableFolder ───────────────────────────────────────────── */

function DroppableFolder({
  folder,
  depth,
  isActive,
  isRoot,
  hasChildren,
  isCollapsed,
  isDark,
  children,
  onSelect,
  onToggleCollapse,
  onRename,
  onDelete,
  onColorChange,
}: {
  folder: Folder;
  depth: number;
  isActive: boolean;
  isRoot: boolean;
  hasChildren: boolean;
  isCollapsed: boolean;
  isDark: boolean;
  children: React.ReactNode;
  onSelect: () => void;
  onToggleCollapse: () => void;
  onRename: () => void;
  onDelete: () => void;
  onColorChange: (color: string | undefined) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLSpanElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pickerOpen]);

  const colorEntry = folder.color ? FOLDER_COLORS[folder.color] : null;
  const colorHex = colorEntry ? (isDark ? colorEntry.dark : colorEntry.light) : undefined;

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
        <button
          onClick={onSelect}
          className={cn(
            "flex-1 flex items-center gap-1.5 text-left cursor-pointer border-none rounded-md py-1.5 text-sm transition-colors",
            isActive
              ? "bg-primary text-primary-foreground"
              : "bg-transparent text-foreground hover:bg-accent/50",
          )}
          style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: 8 }}
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
          <FolderIcon
            size={14}
            className={cn("shrink-0", isActive ? "text-primary-foreground" : !colorHex ? "text-muted-foreground" : undefined)}
            style={!isActive && colorHex ? { color: colorHex } : undefined}
          />
          {folder.name}
        </button>
        {!isRoot && (
          <div className="relative flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => setPickerOpen((v) => !v)}
              className="p-1 cursor-pointer bg-transparent border-none text-muted-foreground hover:text-foreground transition-colors"
              title="Change color"
            >
              <Palette size={12} style={colorHex ? { color: colorHex } : undefined} />
            </button>
            <button onClick={onRename} className="p-1 cursor-pointer bg-transparent border-none text-muted-foreground hover:text-foreground transition-colors" title="Rename">
              <Pencil size={12} />
            </button>
            <button onClick={onDelete} className="p-1 cursor-pointer bg-transparent border-none text-destructive hover:text-destructive/80 transition-colors" title="Delete">
              <X size={12} />
            </button>
            {pickerOpen && (
              <div
                ref={pickerRef}
                className="absolute z-50 bottom-full right-0 mb-1 p-2 bg-popover border border-border rounded-lg shadow-lg"
                style={{ minWidth: 130 }}
              >
                <div className="grid grid-cols-6 gap-1.5">
                  {Object.entries(FOLDER_COLORS).map(([key, val]) => (
                    <button
                      key={key}
                      title={key}
                      onClick={() => {
                        onColorChange(key === "default" ? undefined : key);
                        setPickerOpen(false);
                      }}
                      className={cn(
                        "w-4 h-4 rounded-full border transition-transform hover:scale-110",
                        folder.color === key || (!folder.color && key === "default")
                          ? "border-foreground/60 ring-1 ring-foreground/40"
                          : "border-border/50",
                      )}
                      style={{
                        background: val
                          ? (isDark ? val.dark : val.light)
                          : "transparent",
                        ...(key === "default" ? { backgroundImage: "repeating-linear-gradient(45deg, #ccc 0, #ccc 1px, transparent 0, transparent 50%)", backgroundSize: "4px 4px" } : {}),
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
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
  isDark: boolean;
  onSelectFolder: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onColorChange: (id: string, color: string | undefined) => void;
  onRequestRename: (title: string, currentName: string, onCommit: (name: string) => void) => void;
};

function FolderTree({ state, activeFolderId, isDark, onSelectFolder, onRenameFolder, onDeleteFolder, onColorChange, onRequestRename }: FolderTreeProps) {
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

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
        isDark={isDark}
        onSelect={() => onSelectFolder(folderId)}
        onToggleCollapse={() => toggleFolder(folderId)}
        onRename={() => {
          onRequestRename("Rename folder", folder.name, (name) => onRenameFolder(folderId, name));
        }}
        onDelete={() => onDeleteFolder(folderId)}
        onColorChange={(color) => onColorChange(folderId, color)}
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
}) {
  const ref = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLSpanElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);

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
      className={cn(
        "group/card relative rounded-lg border p-3 transition-all outline-none",
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

      <div className="flex items-start gap-2">
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

        <img
          src={`https://www.google.com/s2/favicons?sz=16&domain=${bookmark.domain}`}
          alt=""
          width={16}
          height={16}
          className="shrink-0 mt-0.5 rounded-sm"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <button
              onClick={onOpen}
              className="font-semibold text-sm text-foreground hover:text-primary cursor-pointer bg-transparent border-none p-0 font-[inherit] truncate max-w-87.5 text-left transition-colors"
              title={bookmark.name}
            >
              {bookmark.name}
            </button>
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

          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
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
          </div>

          {snippetPreview && (
            <p className="text-xs text-muted-foreground mt-1.5 italic leading-relaxed truncate">
              &ldquo;{snippetPreview}&rdquo;
            </p>
          )}
          {bookmark.notes && bookmark.notes.trim() && (
            <p className="text-xs text-muted-foreground mt-1 italic truncate">
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
                    className="inline-flex items-center text-[10px] px-1.5 py-0 rounded-full border font-normal"
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

/* ─── RecentPins ───────────────────────────────────────────────── */

function RecentPins({ bookmarks, onOpen }: { bookmarks: Bookmark[]; onOpen: (b: Bookmark) => void }) {
  const [collapsed, setCollapsed] = useState(false);

  const recent = [...bookmarks]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);

  if (recent.length === 0) return null;

  return (
    <div className="mb-4">
      <button
        className="flex items-center gap-1.5 cursor-pointer mb-2 bg-transparent border-none p-0"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className={cn("text-muted-foreground transition-transform duration-200", collapsed && "-rotate-90")}>
          <ChevronDown size={12} />
        </span>
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Recently Pinned</span>
      </button>
      {!collapsed && (
        <ScrollArea className="w-full">
          <div className="flex gap-2 py-1 pr-4">
            {recent.map((b) => (
              <Tooltip key={b.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onOpen(b)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/50 border border-border/50 rounded-full cursor-pointer text-xs text-foreground whitespace-nowrap shrink-0 max-w-52 shadow-sm hover:shadow-md hover:border-border transition-all"
                  >
                    <img
                      src={`https://www.google.com/s2/favicons?sz=16&domain=${b.domain}`}
                      alt=""
                      width={14}
                      height={14}
                      className="rounded-sm shrink-0"
                    />
                    <span className="overflow-hidden text-ellipsis">
                      {truncate(b.name, 28)}
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>{b.name}</TooltipContent>
              </Tooltip>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
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
      <img
        src={`https://www.google.com/s2/favicons?sz=16&domain=${group.domain}`}
        width={16}
        height={16}
        className="shrink-0"
      />
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

/* ─── TagEditor ─────────────────────────────────────────────────── */

function TagEditor({
  currentTagIds,
  tagDefs,
  isDark,
  onSave,
  onClose,
}: {
  currentTagIds: string[];
  tagDefs: Record<string, TagDef>;
  isDark?: boolean;
  onSave: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");
  const [ids, setIds] = useState<string[]>(currentTagIds);
  const inputRef = useRef<HTMLInputElement>(null);

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
          return (
            <span key={tagId} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              #{tag.name}
              <button onClick={() => removeTag(tagId)} className="hover:text-destructive ml-0.5 leading-none">&times;</button>
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
      {(suggestions.length > 0 || (query && !exactMatch)) && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {suggestions.map((tag) => {
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
          {query && !exactMatch && (
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
  onRequestRename: (title: string, currentName: string, onCommit: (name: string) => void) => void;
  sortBy: SortKey;
  tagDefs: Record<string, TagDef>;
  onSetBookmarkTags: (bookmarkId: string, tagIds: string[]) => void;
  isDark?: boolean;
};

function BookmarkList({ bookmarks, activeFolderId, isSearching, folders, onRenameBookmark, onDeleteBookmark, expandedNotes, onSetExpandedNotes, onSetNotes, bulkMode, selectedIds, onToggleSelect, onRequestRename, sortBy, tagDefs, onSetBookmarkTags, isDark }: BookmarkListProps) {
  const [collapsedUrls, setCollapsedUrls] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [expandedTags, setExpandedTags] = useState<Record<string, boolean>>({});

  const activeIds = isSearching ? null : getDescendantFolderIds(activeFolderId, folders);

  const filtered = sortBookmarks(
    bookmarks.filter((b) => isSearching || activeIds!.has(b.folderId)),
    sortBy,
  );

  const visibleIds = filtered.map((b) => b.id);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedId(getAdjacentId(visibleIds, focusedId, e.key === "ArrowDown" ? 1 : -1));
    }
    if (e.key === "Enter" && focusedId) {
      const b = filtered.find((x) => x.id === focusedId);
      if (b) handleOpenBookmark(b);
    }
    if ((e.key === "Delete" || e.key === "Backspace") && focusedId) {
      e.preventDefault();
      onDeleteBookmark(focusedId);
    }
    if ((e.key === "e" || e.key === "E") && focusedId) {
      const b = filtered.find((x) => x.id === focusedId);
      if (b) onRequestRename("Rename bookmark", b.name, (name) => onRenameBookmark(focusedId, name));
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
        onRename={() => {
          onRequestRename("Rename bookmark", b.name, (name) => onRenameBookmark(b.id, name));
        }}
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
      />
      {expandedTags[b.id] && (
        <TagEditor
          currentTagIds={b.tags ?? []}
          tagDefs={tagDefs}
          isDark={isDark}
          onSave={(ids) => onSetBookmarkTags(b.id, ids)}
          onClose={() => setExpandedTags((prev) => ({ ...prev, [b.id]: false }))}
        />
      )}
    </div>
  );

  if (filtered.length === 0) {
    return (
      <div>
        <h3 className="mt-0 text-base font-semibold tracking-tight text-foreground">
          {isSearching ? "Search results (0)" : "Bookmarks (0)"}
        </h3>
        <p className="text-sm text-muted-foreground py-5">
          {isSearching ? "No matching bookmarks found." : "No bookmarks in this folder."}
        </p>
      </div>
    );
  }

  if (isSearching) {
    return (
      <div onKeyDown={handleKeyDown}>
        <h3 className="mt-0 text-base font-semibold tracking-tight text-foreground">
          Search results ({filtered.length})
        </h3>
        <div className="space-y-2">
          {filtered.map((b) => renderBookmarkItem(b, folders[b.folderId]?.name))}
        </div>
      </div>
    );
  }

  const groups = groupByUrl(filtered);

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
    </div>
  );
}

/* ─── TopBar ────────────────────────────────────────────────────── */

function TopBar({ searchQuery, onSearchChange, onCreateFolder, onExport, onImport, bulkMode, onToggleBulk, onOpenSettings }: {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onCreateFolder: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  bulkMode: boolean;
  onToggleBulk: () => void;
  onOpenSettings: () => void;
}) {
  const { preference, toggle } = useTheme();

  return (
    <div className="flex gap-2 flex-wrap items-center">
      <Input
        type="text"
        placeholder="Search bookmarks\u2026"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="flex-1 min-w-50 h-9"
      />
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
      <Button onClick={onCreateFolder} size="sm" className="h-9">
        <FolderPlus size={14} />
        Folder
      </Button>
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

function BulkActionsBar({ count, folders, onSelectAll, onDeselectAll, onDelete, onMove }: {
  count: number;
  folders: Record<string, import("../../core/types").Folder>;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDelete: () => void;
  onMove: (targetFolderId: string) => void;
}) {
  const [showFolderPicker, setShowFolderPicker] = useState(false);

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
      <Button variant="destructive" size="sm" onClick={onDelete}>
        <Trash2 size={14} />
        Delete
      </Button>
    </div>
  );
}

/* ─── AI domain detection ──────────────────────────────────────── */

const AI_CHAT_DOMAINS = new Set([
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "bard.google.com",
  "copilot.microsoft.com",
  "poe.com",
  "perplexity.ai",
]);

function isAiDomain(domain: string): boolean {
  return AI_CHAT_DOMAINS.has(domain);
}

/* ─── Library (main component) ──────────────────────────────────── */

function countFolderContents(
  folders: Record<string, Folder>,
  bookmarks: Record<string, Bookmark>,
  folderId: string,
): { bookmarkCount: number; childFolderCount: number } {
  const descendants = new Set<string>();
  const collect = (id: string) => {
    for (const f of Object.values(folders)) {
      if (f.parentId === id) { descendants.add(f.id); collect(f.id); }
    }
  };
  collect(folderId);
  const bookmarkCount = Object.values(bookmarks).filter(
    (b) => b.folderId === folderId || descendants.has(b.folderId),
  ).length;
  return { bookmarkCount, childFolderCount: descendants.size };
}

function RenameDialogBody({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (val: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();
  return (
    <>
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && trimmed) { e.preventDefault(); onCommit(trimmed); }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        ref={(el) => el?.select()}
      />
      <div className="flex justify-end gap-2 mt-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => { if (trimmed) onCommit(trimmed); }} disabled={!trimmed}>OK</Button>
      </div>
    </>
  );
}

export default function Library() {
  const { showToast } = useToast();
  const { isDark } = useTheme();
  const [state, setState] = useState<LibraryState | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isFolderModalOpen, setFolderModalOpen] = useState(false);
  const [folderNameDraft, setFolderNameDraft] = useState("");
  const [expandedNotes, setExpandedNotes] = useState<Record<string, { open: boolean; draft: string }>>({});
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<"all" | "web" | "ai_answer" | "ai_prompt">("all");
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const [browserImportPreview, setBrowserImportPreview] = useState<BrowserImportPreview | null>(null);
  const [includeDups, setIncludeDups] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [renameDialog, setRenameDialog] = useState<{
    title: string;
    currentName: string;
    onConfirm: (name: string) => void;
  } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [tagsExpanded, setTagsExpanded] = useState(true);
  const [prefs, setPrefsState] = useState<Prefs>({ highlightDurationMs: 3000, snippetDismissMs: 12000 });
  const [prefsDraft, setPrefsDraft] = useState<Prefs>({ highlightDurationMs: 3000, snippetDismissMs: 12000 });
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingDivider = useRef(false);

  const isPickerMode = new URLSearchParams(window.location.search).get("mode") === "picker";
  const [pendingSave, setPendingSaveState] = useState<PendingSave | null>(null);

  useEffect(() => {
    getPrefs().then((p) => { setPrefsState(p); setPrefsDraft(p); });
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

    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes["zp_state"]) {
        const newState = changes["zp_state"].newValue as LibraryState;
        setState(newState);
        setActiveFolderId((prev) => prev ?? newState.rootFolderId);
      }
    };

    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  useEffect(() => {
    if (!isPickerMode) return;
    getPendingSave().then((p) => setPendingSaveState(p));
  }, [isPickerMode]);

  // Global ? shortcut for shortcuts cheat-sheet
  useEffect(() => {
    const anyDialogOpen = !!confirmDialog || !!renameDialog || settingsOpen || shortcutsOpen || isFolderModalOpen || !!browserImportPreview;
    function onKey(e: KeyboardEvent) {
      if (e.key === "?" && !anyDialogOpen && (e.target as HTMLElement).tagName !== "INPUT" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
        setShortcutsOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDialog, renameDialog, settingsOpen, shortcutsOpen, isFolderModalOpen, browserImportPreview]);

  /* ─── DnD monitor ──────────────────────────────────────────── */

  const stateRef = useRef(state);
  stateRef.current = state;

  const handleDrop = useCallback(async ({ source, location }: { source: { data: Record<string | symbol, unknown> }; location: { current: { dropTargets: { data: Record<string | symbol, unknown> }[] } } }) => {
    const target = location.current.dropTargets[0];
    if (!target) return;

    const sourceData = source.data as DragItemData;
    const targetData = target.data as DragItemData;
    const currentState = stateRef.current;
    if (!currentState) return;

    const doRefresh = async () => { const s = await getState(); setState(s); };

    if (sourceData.type === "bookmark" && targetData.type === "folder") {
      if (sourceData.folderId !== targetData.folderId && sourceData.bookmarkId) {
        try {
          await moveBookmark(sourceData.bookmarkId, targetData.folderId!);
          await doRefresh();
          showToast("Moved to " + (currentState.folders[targetData.folderId!]?.name ?? "folder"));
        } catch (err) {
          console.error("Failed to move bookmark", err);
        }
      }
      return;
    }

    if (sourceData.type === "bookmark" && targetData.type === "bookmark" && sourceData.bookmarkId !== targetData.bookmarkId) {
      const edge = extractClosestEdge(target.data);
      const folderBookmarks = Object.values(currentState.bookmarks)
        .filter((b) => b.folderId === sourceData.folderId)
        .sort((a, b) => Number(b.sortKey) - Number(a.sortKey));
      const startIndex = folderBookmarks.findIndex((b) => b.id === sourceData.bookmarkId);
      let finishIndex = folderBookmarks.findIndex((b) => b.id === targetData.bookmarkId);
      if (startIndex !== -1 && finishIndex !== -1) {
        if (edge === "bottom" && startIndex < finishIndex) {
          // Already correct
        } else if (edge === "top" && startIndex > finishIndex) {
          // Already correct
        } else if (edge === "bottom") {
          finishIndex = finishIndex + 1;
        } else if (edge === "top") {
          finishIndex = finishIndex - 1;
        }
        finishIndex = Math.max(0, Math.min(finishIndex, folderBookmarks.length - 1));
        const reordered = reorder({ list: folderBookmarks, startIndex, finishIndex });
        try {
          await reorderBookmarks(reordered.map((b) => b.id));
          await doRefresh();
        } catch (err) {
          console.error("Failed to reorder", err);
        }
      }
      return;
    }

    if (sourceData.type === "folder" && targetData.type === "folder" && sourceData.folderId !== targetData.folderId) {
      try {
        await moveFolderToParent(sourceData.folderId!, targetData.folderId!);
        await doRefresh();
        showToast("Folder moved");
      } catch (err) {
        console.error("Failed to move folder", err);
        showToast("Cannot move folder there", "error");
      }
    }
  }, [showToast]);

  useEffect(() => {
    return monitorForElements({
      onDrop: handleDrop,
    });
  }, [handleDrop]);

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

  if (!state) return <div className="p-4 text-foreground">Loading\u2026</div>;

  const currentFolderId = activeFolderId ?? state.rootFolderId;
  const allBookmarks = Object.values(state.bookmarks);

  const sortedTagDefs = Object.values(state.tagDefs ?? {}).sort((a, b) => a.name.localeCompare(b.name));

  const sourceFiltered = sourceFilter === "all"
    ? allBookmarks
    : allBookmarks.filter((b) => {
        const cc = b.snippet?.chatContext;
        const hasAiMeta = cc?.platform && cc.platform !== "unknown";
        const domainIsAi = isAiDomain(b.domain);
        if (sourceFilter === "web") return !hasAiMeta && !domainIsAi;
        if (sourceFilter === "ai_answer") return cc?.role === "assistant" || (domainIsAi && cc?.role !== "user");
        if (sourceFilter === "ai_prompt") return cc?.role === "user";
        return true;
      });

  const tagFiltered = activeTagFilter
    ? sourceFiltered.filter((b) => (b.tags ?? []).includes(activeTagFilter))
    : sourceFiltered;

  const isSearching = searchQuery.trim().length > 0;
  const filtered = isSearching
    ? tagFiltered.filter((b) => {
        const q = searchQuery.toLowerCase();
        return (
          b.name.toLowerCase().includes(q) ||
          b.url.toLowerCase().includes(q) ||
          b.domain.toLowerCase().includes(q) ||
          (b.snippet?.text ?? "").toLowerCase().includes(q) ||
          (b.notes ?? "").toLowerCase().includes(q)
        );
      })
    : tagFiltered;

  const refreshState = async () => {
    const s = await getState();
    setState(s);
  };

  /* ─── Handlers ─────────────────────────────────────────────── */

  const handleCreateFolder = () => { setFolderNameDraft(""); setFolderModalOpen(true); };

  const handleCreateFolderSubmit = async () => {
    const name = folderNameDraft.trim();
    if (!name) return;
    try {
      await createFolder({ parentId: currentFolderId, name });
      await refreshState();
      setFolderModalOpen(false);
      setFolderNameDraft("");
      showToast(`Folder "${name}" created`);
      notifyFoldersChanged();
    } catch (err) {
      console.error("Failed to create folder", err);
      showToast("Failed to create folder", "error");
    }
  };

  const handleDeleteBookmark = (id: string) => {
    setConfirmDialog({
      title: "Delete bookmark?",
      description: "This cannot be undone.",
      onConfirm: async () => {
        await deleteBookmark(id);
        await refreshState();
        showToast("Bookmark deleted");
      },
    });
  };

  const handleSelectFolder = async (id: string) => {
    setActiveFolderId(id);
    if (isPickerMode && pendingSave) {
      await handlePickerSave(id);
    } else {
      try { await setLastUsedFolder(id); } catch { /* no-op */ }
    }
  };

  const handlePickerSave = async (folderId: string) => {
    if (!pendingSave) return;
    try {
      if (pendingSave.selectionText) {
        await addSelectionBookmark({
          url: pendingSave.url,
          title: pendingSave.title,
          selectedText: pendingSave.selectionText,
          anchor: pendingSave.anchor,
          folderId,
        });
      } else if (pendingSave.ytResult?.kind === "youtube") {
        const media = {
          kind: "youtube" as const,
          videoId: pendingSave.ytResult.videoId,
          timestampSec: pendingSave.ytResult.timestampSec,
          timestampLabel: pendingSave.ytResult.timestampLabel,
          canonicalUrl: pendingSave.ytResult.canonicalUrl,
          openUrl: pendingSave.ytResult.openUrl,
          captureMethod: pendingSave.ytResult.captureMethod,
        };
        await addPageBookmark(pendingSave.ytResult.openUrl, pendingSave.title, media, folderId);
      } else {
        await addPageBookmark(pendingSave.url, pendingSave.title, undefined, folderId);
      }

      await updateRecents(folderId);
      await setPendingSave(null);
      setPendingSaveState(null);
      await refreshState();

      chrome.runtime.sendMessage({ type: "ZP_FOLDERS_CHANGED" }).catch(() => {});

      const folderName = state?.folders[folderId]?.name ?? "folder";
      showToast(`Saved to ${folderName}`);

      setTimeout(() => window.close(), 1200);
    } catch (err) {
      console.error("ZP: picker save failed", err);
      showToast("Save failed", "error");
    }
  };

  function notifyFoldersChanged() {
    chrome.runtime.sendMessage({ type: "ZP_FOLDERS_CHANGED" }).catch(() => {});
  }

  const handleRenameFolder = async (id: string, name: string) => {
    try {
      await renameFolder(id, name);
      await refreshState();
      showToast("Folder renamed");
      notifyFoldersChanged();
    } catch (err) {
      console.error("Failed to rename folder", err);
      showToast("Failed to rename folder", "error");
    }
  };

  const handleDeleteFolder = (id: string) => {
    const folder = state.folders[id];
    if (!folder) return;
    const { bookmarkCount, childFolderCount } = countFolderContents(state.folders, state.bookmarks, id);
    const isEmpty = bookmarkCount === 0 && childFolderCount === 0;
    const description = isEmpty
      ? "This action cannot be undone."
      : `This folder contains ${bookmarkCount} bookmark(s) and ${childFolderCount} subfolder(s). All will be permanently deleted.`;
    setConfirmDialog({
      title: `Delete "${folder.name}"?`,
      description,
      onConfirm: async () => {
        await deleteFolderCascade(id);
        if (currentFolderId === id) setActiveFolderId(state.rootFolderId);
        await refreshState();
        showToast("Folder deleted");
        notifyFoldersChanged();
      },
    });
  };

  const handleSetFolderColor = async (id: string, color: string | undefined) => {
    try {
      await setFolderColor(id, color);
      await refreshState();
      notifyFoldersChanged();
    } catch (err) {
      console.error("Failed to set folder color", err);
    }
  };

  const handleRenameBookmark = async (id: string, name: string) => {
    try {
      await renameBookmark(id, name);
      await refreshState();
      showToast("Bookmark renamed");
    } catch (err) {
      console.error("Failed to rename bookmark", err);
      showToast("Failed to rename bookmark", "error");
    }
  };

  const handleSetBookmarkTags = async (bookmarkId: string, tagIds: string[]) => {
    try {
      await setBookmarkTags(bookmarkId, tagIds);
      await refreshState();
    } catch (err) {
      console.error("Failed to update tags", err);
      showToast("Failed to update tags", "error");
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    try {
      await deleteTag(tagId);
      if (activeTagFilter === tagId) setActiveTagFilter(null);
      await refreshState();
    } catch (err) {
      console.error("Failed to delete tag", err);
      showToast("Failed to delete tag", "error");
    }
  };

  const handleSetBookmarkNotes = async (id: string, notes: string) => {
    try {
      await setBookmarkNotes(id, notes);
      await refreshState();
      setExpandedNotes((prev) => ({ ...prev, [id]: { open: false, draft: "" } }));
      showToast("Notes saved");
    } catch (err) {
      console.error("Failed to save notes", err);
      showToast("Failed to save notes", "error");
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

  const handleBrowserFileSelected = async (file: File) => {
    try {
      const html = await file.text();
      const source = detectBrowserSource(html);
      const parsed = parseBrowserHtml(html);
      if (parsed.bookmarks.length === 0) {
        showToast("No bookmarks found in this file", "error");
        return;
      }
      const preview = await buildImportPreview(parsed, source);
      setIncludeDups(false);
      setBrowserImportPreview(preview);
    } catch (err) {
      console.error("Failed to parse browser bookmarks", err);
      showToast("Failed to read file", "error");
    }
  };

  const handleBrowserImportConfirm = async () => {
    if (!browserImportPreview) return;
    const available = BOOKMARK_CAP - browserImportPreview.currentBookmarkCount;
    const willImport = Math.min(
      (includeDups ? browserImportPreview.newCount + browserImportPreview.dupCount : browserImportPreview.newCount),
      Math.max(0, available),
    );
    if (willImport === 0) {
      setBrowserImportPreview(null);
      return;
    }
    try {
      const { imported, dupSkipped, capSkipped } = await commitBrowserImport(
        browserImportPreview._folders,
        browserImportPreview._bookmarks,
        browserImportPreview.source,
        includeDups,
      );
      setBrowserImportPreview(null);
      await refreshState();
      const parts: string[] = [`Imported ${imported} bookmark${imported !== 1 ? "s" : ""}`];
      if (dupSkipped > 0) parts.push(`${dupSkipped} duplicate${dupSkipped !== 1 ? "s" : ""} skipped`);
      if (capSkipped > 0) parts.push(`${capSkipped} skipped (cap reached)`);
      showToast(parts.join(" · "));
    } catch (err) {
      console.error("Failed to import browser bookmarks", err);
      showToast("Import failed", "error");
    }
  };

  const handleExport = async () => {
    try {
      const data = await exportState();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zeropin-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Library exported");
    } catch (err) {
      console.error("Failed to export", err);
      showToast("Failed to export", "error");
    }
  };

  const handleImport = async (file: File) => {
    const isHtml = file.name.toLowerCase().endsWith(".html") || file.name.toLowerCase().endsWith(".htm");
    if (isHtml) {
      await handleBrowserFileSelected(file);
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importState(data);
      await refreshState();
      showToast("Library imported!");
    } catch (err) {
      console.error("Failed to import", err);
      showToast("Failed to import", "error");
    }
  };

  /* ─── Render ───────────────────────────────────────────────── */

  return (
    <>
      <div className="h-screen w-screen bg-background flex justify-center items-start p-4">
        <div className="w-215 max-w-[96vw] h-[92vh] border border-border rounded-xl overflow-hidden bg-card shadow-lg">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-card border-b border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
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
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Folder</div>
                <div className="text-sm font-semibold text-foreground">
                  {state.folders[currentFolderId]?.name ?? "ZeroPin"}
                </div>
              </div>
            </div>
            <div className="mt-2.5 flex gap-2 items-start">
              <div className="flex-1">
                <TopBar
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onCreateFolder={handleCreateFolder}
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
                />
              </div>
              <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as typeof sourceFilter)}>
                <SelectTrigger className="w-auto h-9 text-xs shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="web">Web</SelectItem>
                  <SelectItem value="ai_answer">AI Answers</SelectItem>
                  <SelectItem value="ai_prompt">AI Prompts</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
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
          </div>

          {/* Picker mode banner */}
          {isPickerMode && pendingSave && (
            <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/20 flex items-center gap-3">
              <span className="text-sm font-medium text-primary shrink-0">Saving to\u2026</span>
              <span className="text-sm text-foreground truncate flex-1">{pendingSave.title || pendingSave.url}</span>
              <Button size="sm" variant="ghost" onClick={() => window.close()}>Cancel</Button>
            </div>
          )}

          {/* Two-column body */}
          <div ref={containerRef} className="flex" style={{ height: "calc(92vh - 110px)" }}>
            <div className="flex-shrink-0 p-3 overflow-y-auto bg-sidebar" style={{ width: sidebarWidth }}>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2.5">Folders</div>
              <FolderTree
                state={state}
                activeFolderId={currentFolderId}
                isDark={isDark}
                onSelectFolder={handleSelectFolder}
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={handleDeleteFolder}
                onColorChange={handleSetFolderColor}
                onRequestRename={(title, currentName, onCommit) =>
                  setRenameDialog({ title, currentName, onConfirm: onCommit })
                }
              />
              {/* Tags section */}
              <div className="mt-4 px-2">
                <button
                  onClick={() => setTagsExpanded((v) => !v)}
                  className="flex items-center gap-1.5 w-full text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5 hover:text-foreground transition-colors"
                >
                  {tagsExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  Tags
                </button>
                {tagsExpanded && (
                  <div className="space-y-0.5">
                    {sortedTagDefs.map((tag) => {
                      const colorEntry = tag.color ? FOLDER_COLORS[tag.color] : null;
                      const colorHex = colorEntry ? (isDark ? colorEntry.dark : colorEntry.light) : null;
                      const count = allBookmarks.filter((b) => (b.tags ?? []).includes(tag.id)).length;
                      return (
                        <div key={tag.id} className="group/tag relative flex items-center">
                          <button
                            onClick={() => setActiveTagFilter(activeTagFilter === tag.id ? null : tag.id)}
                            className={cn(
                              "flex items-center gap-1.5 flex-1 rounded px-1.5 py-1 text-sm text-left transition-colors pr-6",
                              count === 0 ? "opacity-50" : "",
                              activeTagFilter === tag.id
                                ? "bg-primary/10 text-primary"
                                : "hover:bg-accent/50 text-foreground",
                            )}
                          >
                            <span
                              className="w-2 h-2 rounded-full shrink-0 border border-border/50"
                              style={{ background: colorHex ?? "transparent" }}
                            />
                            <span className="truncate flex-1">#{tag.name}</span>
                            <span className="text-[10px] text-muted-foreground">{count}</span>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteTag(tag.id); }}
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
            </div>
            {/* Drag divider */}
            <div
              onMouseDown={(e) => { isDraggingDivider.current = true; e.preventDefault(); }}
              className="w-1.5 flex-shrink-0 border-r border-border cursor-col-resize hover:bg-primary/20 transition-colors"
              title="Drag to resize"
            />
            <div className="flex-1 min-w-0 p-4 overflow-y-auto bg-background">
              {!isSearching && <RecentPins bookmarks={allBookmarks} onOpen={handleOpenBookmark} />}
              {activeTagFilter && state.tagDefs?.[activeTagFilter] && (
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="text-xs text-muted-foreground">Filtered by tag:</span>
                  <span className="flex items-center gap-1 text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5">
                    #{state.tagDefs[activeTagFilter].name}
                    <button onClick={() => setActiveTagFilter(null)} className="ml-0.5 hover:text-primary/70">&times;</button>
                  </span>
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
                onRequestRename={(title, currentName, onCommit) =>
                  setRenameDialog({ title, currentName, onConfirm: onCommit })
                }
                sortBy={sortBy}
                tagDefs={state.tagDefs ?? {}}
                onSetBookmarkTags={handleSetBookmarkTags}
                isDark={isDark}
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
          />
        )}

        {/* Rename dialog — replaces window.prompt() */}
        {renameDialog && (
          <Dialog open onOpenChange={(open) => { if (!open) setRenameDialog(null); }}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>{renameDialog.title}</DialogTitle>
                <DialogDescription className="sr-only">Rename this item</DialogDescription>
              </DialogHeader>
              <RenameDialogBody
                key={renameDialog.currentName}
                initialValue={renameDialog.currentName}
                onCommit={(val) => { renameDialog.onConfirm(val); setRenameDialog(null); }}
                onCancel={() => setRenameDialog(null)}
              />
            </DialogContent>
          </Dialog>
        )}

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
                ["Enter", "Open focused bookmark"],
                ["E", "Rename focused bookmark"],
                ["Delete / Backspace", "Delete focused bookmark"],
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
