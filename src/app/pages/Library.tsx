import { useEffect, useState, useRef, useCallback } from "react";
import { getState, setLastUsedFolder, deleteBookmark, createFolder, exportState, importState, renameFolder, deleteFolderIfEmpty, renameBookmark, moveBookmark, reorderBookmarks, moveFolderToParent, setBookmarkNotes, bulkDeleteBookmarks, bulkMoveBookmarks, recordBookmarkOpen } from "../../core/storage/local";
import type { LibraryState, Bookmark, Folder } from "../../core/types";
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
import { Folder as FolderIcon, Sun, Moon, Monitor, MoreVertical, GripVertical, Pencil, X, ChevronDown, ChevronRight, HelpCircle, FolderPlus, Download, Upload, CheckSquare, Trash2, FolderInput } from "lucide-react";
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
  onRename: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLSpanElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

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
          <FolderIcon size={14} className={cn("shrink-0", isActive ? "text-primary-foreground" : "text-muted-foreground")} />
          {folder.name}
        </button>
        {!isRoot && (
          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={onRename} className="p-1 cursor-pointer bg-transparent border-none text-muted-foreground hover:text-foreground transition-colors" title="Rename">
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
};

function FolderTree({ state, activeFolderId, onSelectFolder, onRenameFolder, onDeleteFolder }: FolderTreeProps) {
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
        onSelect={() => onSelectFolder(folderId)}
        onToggleCollapse={() => toggleFolder(folderId)}
        onRename={() => {
          const newName = prompt("New folder name:", folder.name);
          if (newName) onRenameFolder(folderId, newName);
        }}
        onDelete={() => onDeleteFolder(folderId)}
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
      className={cn(
        "group/card relative rounded-lg border p-3 transition-all",
        isSnippet ? "border-l-2 border-l-snippet" : "border-border/50",
        selected && "border-info ring-1 ring-info/30",
        !selected && !isSnippet && "hover:border-border hover:shadow-sm",
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
          </div>

          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
            <span>{bookmark.domain}</span>
            <span>{relativeTime(bookmark.createdAt)}</span>
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

/* ─── BookmarkList ──────────────────────────────────────────────── */

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
};

function BookmarkList({ bookmarks, activeFolderId, isSearching, folders, onRenameBookmark, onDeleteBookmark, expandedNotes, onSetExpandedNotes, onSetNotes, bulkMode, selectedIds, onToggleSelect }: BookmarkListProps) {
  const [collapsedUrls, setCollapsedUrls] = useState<Set<string>>(new Set());

  const filtered = bookmarks
    .filter((b) => isSearching || b.folderId === activeFolderId)
    .sort((a, b) => Number(b.sortKey) - Number(a.sortKey));

  const handleOpenBookmark = (b: Bookmark) => {
    recordBookmarkOpen(b.id);
    if (b.type === "SNIPPET" && b.snippet) {
      chrome.tabs.create({ url: b.url }, (newTab) => {
        if (!newTab.id) return;
        const tabId = newTab.id;
        chrome.storage.local.set(
          {
            ZP_HIGHLIGHT_REQUEST: {
              tabId,
              url: b.url,
              anchor: b.snippet,
              bookmarkId: b.id,
              timestamp: Date.now(),
            },
          },
          () => {
            const err = chrome.runtime.lastError;
            if (err) console.warn(`ZP: Failed to write highlight request: ${err.message}`);
          }
        );
      });
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
    <SortableBookmarkItem
      key={b.id}
      bookmark={b}
      onOpen={() => handleOpenBookmark(b)}
      onRename={() => {
        const newName = prompt("New name:", b.name);
        if (newName) onRenameBookmark(b.id, newName);
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
    />
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
      <div>
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
    <div>
      <h3 className="mt-0 text-base font-semibold tracking-tight text-foreground">
        Bookmarks ({filtered.length})
      </h3>
      <div className="space-y-2">
        {groups.map((g) => {
          if (g.bookmarks.length === 1) {
            return renderBookmarkItem(g.bookmarks[0]);
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
                  {g.bookmarks.map((b) => renderBookmarkItem(b))}
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

function TopBar({ searchQuery, onSearchChange, onCreateFolder, onExport, onImport, bulkMode, onToggleBulk }: {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onCreateFolder: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  bulkMode: boolean;
  onToggleBulk: () => void;
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
              <input type="file" accept=".json" onChange={(e) => { if (e.target.files?.[0]) onImport(e.target.files[0]); }} className="hidden" />
            </label>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Import</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={toggle} className="h-9 w-9">
            {preference === "system" ? <Monitor size={16} /> : preference === "dark" ? <Moon size={16} /> : <Sun size={16} />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{preference === "system" ? "System theme" : preference === "dark" ? "Dark mode" : "Light mode"}</TooltipContent>
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

export default function Library() {
  const { showToast } = useToast();
  const [state, setState] = useState<LibraryState | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isFolderModalOpen, setFolderModalOpen] = useState(false);
  const [folderNameDraft, setFolderNameDraft] = useState("");
  const [expandedNotes, setExpandedNotes] = useState<Record<string, { open: boolean; draft: string }>>({});
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<"all" | "web" | "ai_answer" | "ai_prompt">("all");

  useEffect(() => {
    getState().then((s) => {
      setState(s);
      const params = new URLSearchParams(window.location.search);
      const folderParam = params.get("folder");
      if (folderParam && s.folders[folderParam]) {
        setActiveFolderId(folderParam);
      } else {
        setActiveFolderId(s.inboxFolderId ?? s.rootFolderId);
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

  if (!state) return <div className="p-4 text-foreground">Loading\u2026</div>;

  const currentFolderId = activeFolderId ?? state.rootFolderId;
  const allBookmarks = Object.values(state.bookmarks);

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

  const isSearching = searchQuery.trim().length > 0;
  const filtered = isSearching
    ? sourceFiltered.filter((b) => {
        const q = searchQuery.toLowerCase();
        return (
          b.name.toLowerCase().includes(q) ||
          b.url.toLowerCase().includes(q) ||
          b.domain.toLowerCase().includes(q) ||
          (b.snippet?.text ?? "").toLowerCase().includes(q) ||
          (b.notes ?? "").toLowerCase().includes(q)
        );
      })
    : sourceFiltered;

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
    } catch (err) {
      console.error("Failed to create folder", err);
      showToast("Failed to create folder", "error");
    }
  };

  const handleDeleteBookmark = async (id: string) => {
    if (!confirm("Delete bookmark?")) return;
    try {
      await deleteBookmark(id);
      await refreshState();
      showToast("Bookmark deleted");
    } catch (err) {
      console.error("Failed to delete bookmark", err);
      showToast("Failed to delete bookmark", "error");
    }
  };

  const handleSelectFolder = async (id: string) => {
    setActiveFolderId(id);
    try { await setLastUsedFolder(id); } catch { /* no-op */ }
  };

  const handleRenameFolder = async (id: string, name: string) => {
    try {
      await renameFolder(id, name);
      await refreshState();
      showToast("Folder renamed");
    } catch (err) {
      console.error("Failed to rename folder", err);
      showToast("Failed to rename folder", "error");
    }
  };

  const handleDeleteFolder = async (id: string) => {
    if (!confirm("Delete folder?")) return;
    try {
      await deleteFolderIfEmpty(id);
      await refreshState();
      showToast("Folder deleted");
    } catch (err) {
      console.error("Failed to delete folder", err);
      showToast("Folder must be empty to delete", "error");
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
      chrome.tabs.create({ url: b.url }, (newTab) => {
        if (!newTab.id) return;
        const tabId = newTab.id;
        chrome.storage.local.set(
          {
            ZP_HIGHLIGHT_REQUEST: {
              tabId,
              url: b.url,
              anchor: b.snippet,
              bookmarkId: b.id,
              timestamp: Date.now(),
            },
          },
          () => {
            const err = chrome.runtime.lastError;
            if (err) console.warn(`ZP: Failed to write highlight request: ${err.message}`);
          }
        );
      });
    } else {
      window.open(b.url, "_blank");
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
            </div>
          </div>

          {/* Two-column body */}
          <div className="flex" style={{ height: "calc(92vh - 110px)" }}>
            <div className="w-60 border-r border-border p-3 overflow-y-auto bg-sidebar">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2.5">Folders</div>
              <FolderTree
                state={state}
                activeFolderId={currentFolderId}
                onSelectFolder={handleSelectFolder}
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={handleDeleteFolder}
              />
            </div>
            <div className="flex-1 p-4 overflow-y-auto bg-background">
              {!isSearching && <RecentPins bookmarks={allBookmarks} onOpen={handleOpenBookmark} />}
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
            onDelete={async () => {
              if (!confirm(`Delete ${selectedIds.size} bookmark(s)?`)) return;
              try {
                await bulkDeleteBookmarks(Array.from(selectedIds));
                setSelectedIds(new Set());
                setBulkMode(false);
                await refreshState();
                showToast(`${selectedIds.size} bookmark(s) deleted`);
              } catch (err) {
                console.error("Bulk delete failed", err);
                showToast("Failed to delete bookmarks", "error");
              }
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
      </div>
    </>
  );
}
