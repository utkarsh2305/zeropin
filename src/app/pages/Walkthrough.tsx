import { useState, type ReactNode } from "react";
import { useTheme } from "../theme";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrandIcon } from "../BrandIcon";
import {
  Sun,
  Moon,
  Monitor,
  FileText,
  Scissors,
  Search,
  FolderOpen,
  Tag,
  Bell,
  CalendarDays,
  FolderSearch,
} from "lucide-react";

/* ─── Types ──────────────────────────────────────────────────────── */

type ScenarioId = "save-page" | "save-snippet" | "open-highlight" | "organize" | "tags-reminders";

interface Step {
  description: string;
  instruction: string;
}

interface Scenario {
  id: ScenarioId;
  title: string;
  icon: ReactNode;
  steps: Step[];
}

/* ─── Scenario definitions ───────────────────────────────────────── */

const scenarios: Scenario[] = [
  {
    id: "save-page",
    title: "Save a page",
    icon: <FileText size={14} />,
    steps: [
      {
        description: "You're browsing a useful article you want to save for later.",
        instruction: "Right-click anywhere on the page to open the browser context menu.",
      },
      {
        description: "The context menu shows ZeroPin options.",
        instruction: 'Click "Save to ZeroPin".',
      },
      {
        description: "ZeroPin saves the page — URL, title, and favicon.",
        instruction: "The bookmark appears instantly in your Library.",
      },
      {
        description: "Find your saved page in the Inbox folder.",
        instruction: "Click any bookmark to open it, or use ⋮ to rename, tag, or move it.",
      },
    ],
  },
  {
    id: "save-snippet",
    title: "Save a snippet",
    icon: <Scissors size={14} />,
    steps: [
      {
        description: "Select the text you want to save.",
        instruction: "Drag to highlight the important paragraph on the page.",
      },
      {
        description: "Right-click with text selected to open the context menu.",
        instruction: 'Click "Save selection to ZeroPin".',
      },
      {
        description: "ZeroPin saves the snippet with its exact position on the page.",
        instruction: "The snippet includes the selected text and surrounding context.",
      },
      {
        description: "Snippet bookmarks are marked with an amber border and snippet badge.",
        instruction: "Click the snippet bookmark to navigate back — ZeroPin will highlight your saved text.",
      },
    ],
  },
  {
    id: "open-highlight",
    title: "Open & highlight",
    icon: <Search size={14} />,
    steps: [
      {
        description: "Your saved snippet bookmarks appear in the Library with an amber border and snippet badge.",
        instruction: "Click on the snippet bookmark to open it.",
      },
      {
        description: "The original page opens in a new tab.",
        instruction: "Watch as the page scrolls to and highlights your saved text.",
      },
      {
        description: "Your saved snippet is highlighted in yellow on the page, exactly where you saved it!",
        instruction: "This works even if the page content has changed slightly.",
      },
    ],
  },
  {
    id: "organize",
    title: "Organize",
    icon: <FolderOpen size={14} />,
    steps: [
      {
        description: "Reorder bookmarks using the grip handle on the left of each card.",
        instruction: "Grab the ⠿ handle and drag up or down to reorder.",
      },
      {
        description: "Drag a bookmark onto a folder in the sidebar to move it there.",
        instruction: "Drop it on any folder name — the folder highlights to show it's a valid target.",
      },
      {
        description: "The ⋮ menu gives full control over each bookmark.",
        instruction: "Rename, add notes, manage tags, set reminders — all from here.",
      },
      {
        description: "Select multiple bookmarks for bulk actions.",
        instruction: "Click the checkbox to select, then move or delete all at once.",
      },
    ],
  },
  {
    id: "tags-reminders",
    title: "Tags & Reminders",
    icon: <Tag size={14} />,
    steps: [
      {
        description: "Hover any bookmark card to reveal the bell icon.",
        instruction: "Click the bell to set a reminder for when you want to revisit.",
      },
      {
        description: "Choose a quick preset or pick a custom date.",
        instruction: "Tomorrow, In 3 days, In 1 week — or tap the calendar for a specific date.",
      },
      {
        description: "Due reminders surface at the top of your Library.",
        instruction: "Dismiss when done, or snooze — nothing gets buried.",
      },
      {
        description: "Tags let you organise bookmarks across all folders. Smart suggestions match the page domain (GitHub → 'dev', YouTube → 'video').",
        instruction: "Click a tag in the sidebar to filter all bookmarks by that tag. Click again to clear.",
      },
      {
        description: "The filter bar narrows results by source, date added range, or folder scope.",
        instruction: "Use the FolderSearch toggle to scope search to the current folder, the Source dropdown, or the date picker.",
      },
    ],
  },
];

/* ─── FakeBrowserChrome ──────────────────────────────────────────── */

function FakeBrowserChrome({ tabTitle, url }: { tabTitle: string; url: string }) {
  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-end px-3 pt-2 bg-sidebar rounded-t-[10px]">
        <div className="bg-card px-4 py-1.5 rounded-t-lg text-xs text-foreground max-w-50 truncate font-medium">
          {tabTitle}
        </div>
        <div className="flex-1" />
        <div className="flex gap-1.5 pb-1.5">
          <span className="w-3 h-3 rounded-full" style={{ background: "#ff5f57" }} />
          <span className="w-3 h-3 rounded-full" style={{ background: "#febc2e" }} />
          <span className="w-3 h-3 rounded-full" style={{ background: "#28c840" }} />
        </div>
      </div>

      {/* URL bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-card border-b border-border">
        <div className="flex gap-1.5 text-muted-foreground text-xs">
          <span>&larr;</span> <span>&rarr;</span> <span>&#x21bb;</span>
        </div>
        <div className="flex-1 bg-input border border-border/50 rounded-full px-3 py-1 text-xs text-muted-foreground truncate">
          {url}
        </div>
        <div className="w-5 h-5 rounded bg-primary flex items-center justify-center text-[10px] text-primary-foreground font-bold">
          ZP
        </div>
      </div>
    </div>
  );
}

/* ─── Fake Webpage Content ───────────────────────────────────────── */

function FakeArticlePage({
  showSelection,
  showHighlight,
}: {
  showSelection?: boolean;
  showHighlight?: boolean;
}) {
  const highlightStyle = showHighlight
    ? { background: "#fff176", padding: "2px 0", borderRadius: 2 }
    : {};
  const selectionStyle = showSelection
    ? { background: "#338fff", color: "#fff", padding: "2px 0", borderRadius: 2 }
    : {};

  return (
    <div className="px-6 py-5" style={{ fontFamily: "Georgia, serif", lineHeight: 1.7 }}>
      <h2 className="text-xl font-bold text-foreground mt-0">
        Understanding Modern Web Architecture
      </h2>
      <div className="text-[11px] text-muted-foreground mb-4">
        by Jane Smith · Published {new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} · 8 min read
      </div>
      <p className="text-[13px] text-foreground">
        Web applications have evolved significantly over the past decade. The shift from
        server-rendered pages to single-page applications brought new challenges in state
        management, routing, and performance optimization.
      </p>
      <p className="text-[13px] text-foreground">
        <span style={{ ...selectionStyle, ...highlightStyle }}>
          One of the most impactful changes has been the adoption of component-based
          architectures, where UI elements are broken into reusable, self-contained pieces
          that manage their own state and lifecycle.
        </span>
      </p>
      <p className="text-[13px] text-foreground">
        This approach enables teams to work independently on different parts of the
        application, promotes code reuse, and makes testing significantly easier.
      </p>
    </div>
  );
}

function FakeLibraryView({
  highlightSnippet,
  showBell,
  activeTag,
  showFilterBar,
  showDragState,
  showCardMenu,
  showReminderPopover,
  showDueReminders,
  showMultiSelect,
}: {
  highlightSnippet?: boolean;
  showBell?: boolean;
  activeTag?: string;
  showFilterBar?: boolean;
  showDragState?: boolean;
  showCardMenu?: boolean;
  showReminderPopover?: boolean;
  showDueReminders?: boolean;
  showMultiSelect?: boolean;
}) {
  const fakeFolders = [
    { name: "ZeroPin", active: false, depth: 0 },
    { name: "Inbox", active: true, depth: 1 },
    { name: "Research", active: false, depth: 1 },
    { name: "Tutorials", active: false, depth: 1 },
  ];

  const fakeTags = [
    { name: "dev", active: activeTag === "dev" },
    { name: "css", active: activeTag === "css" },
  ];

  const fakeBookmarks = [
    {
      name: "Understanding Modern Web Architecture",
      domain: "blog.example.com",
      isSnippet: true,
      snippet: "One of the most impactful changes has been the adoption of component-based architectures\u2026",
      time: "2h ago",
      tag: "dev",
    },
    {
      name: "React Performance Tips",
      domain: "react.dev",
      isSnippet: false,
      time: "1d ago",
      tag: "dev",
    },
    {
      name: "CSS Grid Layout Guide",
      domain: "css-tricks.com",
      isSnippet: false,
      time: "3d ago",
      tag: "css",
    },
  ];

  const visibleBookmarks = activeTag
    ? fakeBookmarks.filter((b) => b.tag === activeTag)
    : fakeBookmarks;

  return (
    <div className="flex flex-col h-full font-sans">
      {/* Filter bar */}
      {showFilterBar && (
        <div className="flex gap-1.5 items-center px-2 py-1.5 border-b border-border/50 bg-card shrink-0">
          <div className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] bg-primary/10 text-primary">
            <FolderSearch size={9} />
            <span>Current folder</span>
          </div>
          <div className="flex items-center gap-0.5 border border-border/60 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground">
            All ▾
          </div>
          <div className="flex items-center gap-0.5 border border-border/60 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground">
            <CalendarDays size={9} />
          </div>
          <div className="flex items-center gap-0.5 border border-border/60 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground">
            Newest ▾
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-40 border-r border-border/50 p-2 bg-sidebar overflow-y-auto shrink-0">
          <div className="text-[10px] font-bold text-muted-foreground mb-1.5">Folders</div>
          {fakeFolders.map((f) => (
            <div
              key={f.name}
              className={cn(
                "py-0.5 text-[11px] rounded-sm mb-px",
                f.active ? "bg-primary text-primary-foreground" : "text-foreground",
                showDragState && f.name === "Research" && "bg-primary/15 ring-1 ring-primary"
              )}
              style={{ paddingLeft: 6 + f.depth * 12, paddingRight: 6 }}
            >
              <FolderOpen size={10} className="inline mr-1 -mt-px" />
              {f.name}
            </div>
          ))}
          <div className="mt-2 pt-2 border-t border-border/50">
            <div className="text-[10px] font-bold text-muted-foreground mb-1.5">Tags</div>
            {fakeTags.map((t) => (
              <div
                key={t.name}
                className={cn(
                  "py-0.5 px-1.5 text-[10px] rounded-sm mb-px flex items-center gap-1",
                  t.active ? "bg-primary/10 text-primary font-semibold" : "text-foreground"
                )}
              >
                <Tag size={8} />
                #{t.name}
              </div>
            ))}
          </div>
        </div>

        {/* Bookmarks */}
        <div className="flex-1 p-2.5 overflow-y-auto bg-background relative">
          {/* Due reminders section */}
          {showDueReminders && (
            <div className="mb-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-2">
              <div className="flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-400 mb-1.5">
                <Bell size={10} />
                Reminders (1)
              </div>
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="flex-1 text-foreground truncate">Understanding Modern Web Architecture</span>
                <button className="text-[9px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:bg-accent">Dismiss</button>
                <button className="text-[9px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:bg-accent">Snooze ▾</button>
              </div>
            </div>
          )}

          <div className="text-xs font-bold text-foreground mb-2">
            Bookmarks ({visibleBookmarks.length})
          </div>

          {visibleBookmarks.map((b, i) => (
            <div
              key={i}
              className={cn(
                "p-2 mb-1.5 bg-card border rounded-md transition-shadow relative",
                b.isSnippet ? "border-l-2 border-l-snippet" : "border-border/50",
                highlightSnippet && i === 0 && "ring-2 ring-primary/25",
                showDragState && i === 0 && "-translate-y-2 shadow-lg ring-1 ring-primary opacity-80"
              )}
              style={{ cursor: highlightSnippet && i === 0 ? "pointer" : "default" }}
            >
              <div className="flex items-center gap-1.5">
                {showMultiSelect && (
                  <div className={cn(
                    "w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center",
                    i <= 1 ? "border-primary bg-primary" : "border-border"
                  )}>
                    {i <= 1 && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                )}
                <span className="text-muted-foreground text-[11px]">&#x22ee;&#x22ee;</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-semibold text-primary truncate">
                      {b.name}
                    </span>
                    {b.isSnippet && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-auto border-snippet text-snippet shrink-0">
                        snippet
                      </Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground flex gap-1.5">
                    <span>{b.domain}</span>
                    <span>{b.time}</span>
                  </div>
                  {b.snippet && (
                    <div className="text-[10px] text-muted-foreground italic mt-0.5 truncate">
                      &ldquo;{b.snippet}&rdquo;
                    </div>
                  )}
                </div>
                {(showBell || showReminderPopover) && i === 0 && (
                  <Bell size={11} className="text-amber-500 shrink-0" />
                )}
                <span className="text-muted-foreground text-[13px]">&#x22ee;</span>
              </div>

              {/* ⋮ dropdown menu on first card */}
              {showCardMenu && i === 0 && (
                <div className="absolute right-6 top-1 bg-card border border-border rounded-md shadow-lg z-30 py-1 min-w-32 text-[10px]">
                  <div className="px-3 py-1 hover:bg-accent text-foreground">Rename</div>
                  <div className="px-3 py-1 hover:bg-accent text-foreground">Add notes</div>
                  <div className="px-3 py-1 hover:bg-accent text-foreground">Tags</div>
                  <div className="px-3 py-1 hover:bg-accent text-foreground">Set reminder</div>
                  <div className="h-px bg-border my-1" />
                  <div className="px-3 py-1 hover:bg-accent text-destructive">Delete</div>
                </div>
              )}

              {/* Reminder popover on first card */}
              {showReminderPopover && i === 0 && (
                <div className="absolute right-2 top-8 bg-card border border-border rounded-md shadow-lg z-30 p-2 w-44 text-[10px]">
                  <div className="font-semibold text-foreground mb-2">Set reminder</div>
                  <div className="space-y-1">
                    <button className="w-full text-left px-2 py-1 rounded hover:bg-accent text-foreground">Tomorrow</button>
                    <button className="w-full text-left px-2 py-1 rounded hover:bg-accent text-foreground">In 3 days</button>
                    <button className="w-full text-left px-2 py-1 rounded bg-primary/10 text-primary font-medium">In 1 week</button>
                  </div>
                  <input
                    type="date"
                    readOnly
                    className="mt-2 w-full border border-border rounded px-1.5 py-1 text-[9px] bg-background text-foreground"
                  />
                </div>
              )}
            </div>
          ))}

          {/* Multi-select bulk actions bar */}
          {showMultiSelect && (
            <div className="absolute bottom-0 left-0 right-0 bg-primary text-primary-foreground px-3 py-2 flex items-center gap-3 text-[10px] font-medium">
              <span>2 selected</span>
              <button className="px-2 py-0.5 rounded border border-primary-foreground/30 hover:bg-primary-foreground/10">Move</button>
              <button className="px-2 py-0.5 rounded border border-primary-foreground/30 hover:bg-primary-foreground/10">Delete</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Callout overlays ───────────────────────────────────────────── */

function PulseCallout({ x, y, label }: { x: number; y: number; label?: string }) {
  return (
    <div
      className="absolute pointer-events-none z-40"
      style={{ left: x, top: y, transform: "translate(-50%,-50%)" }}
    >
      <div className="relative flex items-center justify-center">
        <div className="w-5 h-5 rounded-full bg-primary/60 animate-ping absolute" />
        <div className="w-3 h-3 rounded-full bg-primary relative" />
      </div>
      {label && (
        <div className="absolute left-4 top-1/2 -translate-y-1/2 whitespace-nowrap rounded px-1.5 py-0.5 text-[9px] font-semibold text-primary-foreground bg-primary">
          {label}
        </div>
      )}
    </div>
  );
}

function BoxCallout({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <div
      className="absolute pointer-events-none z-40 rounded"
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        border: "1.5px solid var(--color-primary)",
        background: "color-mix(in srgb, var(--color-primary) 12%, transparent)",
      }}
    />
  );
}

/* ─── FakeContextMenu ────────────────────────────────────────────── */

function FakeContextMenu({
  items,
  position,
  onClickItem,
}: {
  items: { label?: string; highlight?: boolean; separator?: boolean }[];
  position: { top: number; left: number };
  onClickItem: (label: string) => void;
}) {
  return (
    <div
      className="absolute bg-card border border-border rounded-md shadow-lg min-w-55 py-1 z-50 text-xs font-sans"
      style={{ top: position.top, left: position.left }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="h-px bg-border my-1" />
        ) : (
          <div
            key={i}
            onClick={() => onClickItem(item.label ?? "")}
            className={cn(
              "px-3.5 py-1.5 cursor-pointer transition-colors hover:bg-accent",
              item.highlight ? "text-primary font-semibold" : "text-foreground"
            )}
          >
            {item.label}
          </div>
        )
      )}
    </div>
  );
}

/* ─── FakeToast ──────────────────────────────────────────────────── */

function FakeToast({ message }: { message: string }) {
  return (
    <div className="absolute bottom-3 right-3 bg-success text-white px-4 py-2 rounded-md text-xs font-sans shadow-lg animate-in fade-in duration-300 z-60">
      {message}
    </div>
  );
}

/* ─── BrowserMockup ──────────────────────────────────────────────── */

const calloutMap: Record<string, ReactNode> = {
  "save-page-0":      <PulseCallout x={380} y={110} label="Right-click here" />,
  "save-page-2":      <PulseCallout x={685} y={255} label="Saved!" />,
  "save-page-3":      <BoxCallout   x={170} y={38}  w={480} h={52}  />,
  "save-snippet-0":   <BoxCallout   x={27}  y={108} w={420} h={50}  />,
  "save-snippet-3":   <BoxCallout   x={285} y={36}  w={72}  h={18}  />,
  "open-highlight-0": <PulseCallout x={295} y={63}  label="Click to open" />,
  "open-highlight-2": <BoxCallout   x={27}  y={108} w={420} h={50}  />,
  "organize-0":       <PulseCallout x={173} y={64}  label="Drag handle" />,
  "organize-1":       <BoxCallout   x={4}   y={40}  w={152} h={22}  />,
  "organize-2":       <BoxCallout   x={170} y={37}  w={495} h={135} />,
  "organize-3":       <PulseCallout x={172} y={64}  label="Select" />,
  "tags-reminders-0": <PulseCallout x={466} y={64}  label="Bell icon" />,
  "tags-reminders-1": <BoxCallout   x={170} y={50}  w={310} h={120} />,
  "tags-reminders-2": <BoxCallout   x={160} y={0}   w={530} h={50}  />,
  "tags-reminders-3": <PulseCallout x={30}  y={115} label="Filter by tag" />,
  "tags-reminders-4": <BoxCallout   x={0}   y={0}   w={530} h={32}  />,
};

function BrowserMockup({
  scenario,
  step,
  onAdvance,
}: {
  scenario: Scenario;
  step: number;
  onAdvance: () => void;
}) {
  const sid = scenario.id;
  const isLastStep = step === scenario.steps.length - 1;

  const showContextMenu = (sid === "save-page" && step === 1) || (sid === "save-snippet" && step === 1);
  const showSelection = sid === "save-snippet" && step <= 1;
  const showHighlight = sid === "open-highlight" && step === 2;
  const showToast =
    (sid === "save-page" && step === 2) ||
    (sid === "save-snippet" && step === 2);
  const showLibrary =
    (sid === "save-page" && step === 3) ||
    (sid === "save-snippet" && step === 3) ||
    sid === "open-highlight" ||
    sid === "organize" ||
    sid === "tags-reminders";
  const showArticleInHighlight = sid === "open-highlight" && step >= 1;

  const contextMenuItems =
    sid === "save-page"
      ? [
          { label: "Back" },
          { label: "Forward" },
          { label: "Reload" },
          { separator: true },
          { label: "Save to ZeroPin", highlight: true },
          { separator: true },
          { label: "View Page Source" },
          { label: "Inspect" },
        ]
      : [
          { label: "Copy" },
          { label: "Search Google for\u2026" },
          { separator: true },
          { label: "Save selection to ZeroPin", highlight: true },
          { separator: true },
          { label: "Inspect" },
        ];

  const tabTitle =
    showLibrary && !showArticleInHighlight
      ? "ZeroPin"
      : "Understanding Modern Web Architecture";

  const fakeUrl =
    showLibrary && !showArticleInHighlight
      ? "chrome-extension://abc123/library.html"
      : "https://blog.example.com/modern-web-architecture";

  return (
    <div className="border border-border rounded-xl overflow-hidden relative bg-background shadow-lg">
      <FakeBrowserChrome tabTitle={tabTitle} url={fakeUrl} />

      {/* Page content area */}
      <div
        className={cn("h-75 relative overflow-hidden", !isLastStep && "cursor-pointer")}
        onClick={!isLastStep ? onAdvance : undefined}
      >
        <div key={`${sid}-${step}`} className="absolute inset-0 animate-in fade-in duration-200">
          {showLibrary && !showArticleInHighlight ? (
            <FakeLibraryView
              highlightSnippet={sid === "open-highlight" && step === 0}
              showBell={sid === "tags-reminders" && step === 0}
              showReminderPopover={sid === "tags-reminders" && step === 1}
              showDueReminders={sid === "tags-reminders" && step === 2}
              activeTag={(sid === "tags-reminders" && step === 3) ? "dev" : undefined}
              showFilterBar={sid === "tags-reminders" && step === 4}
              showDragState={sid === "organize" && step === 1}
              showCardMenu={sid === "organize" && step === 2}
              showMultiSelect={sid === "organize" && step === 3}
            />
          ) : (
            <FakeArticlePage showSelection={showSelection} showHighlight={showHighlight} />
          )}

          {showContextMenu && (
            <FakeContextMenu
              items={contextMenuItems}
              position={{ top: 80, left: sid === "save-snippet" ? 140 : 180 }}
              onClickItem={(label) => {
                if (label.includes("ZeroPin")) onAdvance();
              }}
            />
          )}

          {showToast && <FakeToast message="Saved to Library!" />}
        </div>

        {calloutMap[`${sid}-${step}`]}
      </div>
    </div>
  );
}

/* ─── ExplanationPanel ───────────────────────────────────────────── */

function ExplanationPanel({
  scenario,
  step,
  onNext,
  onPrev,
}: {
  scenario: Scenario;
  step: number;
  onNext: () => void;
  onPrev: () => void;
}) {
  const s = scenario.steps[step];
  const isFirst = step === 0;
  const isLast = step === scenario.steps.length - 1;

  return (
    <div className="mt-4 p-4 bg-card border border-border/50 rounded-lg">
      <div className="flex items-center justify-between mb-2.5">
        <div className="text-[11px] text-muted-foreground font-semibold">
          Step {step + 1} of {scenario.steps.length}
        </div>
        <div className="flex gap-1">
          {scenario.steps.map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-2 h-2 rounded-full transition-colors",
                i === step ? "bg-primary" : "bg-border"
              )}
            />
          ))}
        </div>
      </div>

      <p className="text-sm text-foreground font-semibold mb-1.5">{s.description}</p>
      <p className="text-[13px] text-muted-foreground">{s.instruction}</p>

      <div className="flex gap-2 mt-3.5">
        {!isFirst && (
          <Button variant="outline" size="sm" onClick={onPrev}>
            Back
          </Button>
        )}
        {!isLast && (
          <Button size="sm" onClick={onNext}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}

/* ─── Walkthrough (main) ─────────────────────────────────────────── */

export default function Walkthrough() {
  const { preference, toggle } = useTheme();
  const [activeScenario, setActiveScenario] = useState<ScenarioId>("save-page");
  const [step, setStep] = useState(0);

  const scenario = scenarios.find((s) => s.id === activeScenario)!;

  const selectScenario = (id: ScenarioId) => {
    setActiveScenario(id);
    setStep(0);
  };

  const advance = () => {
    if (step < scenario.steps.length - 1) setStep(step + 1);
  };

  const goBack = () => {
    if (step > 0) setStep(step - 1);
  };

  return (
    <div className="min-h-screen bg-background flex justify-center p-6">
      <div className="w-180 max-w-[96vw] font-sans">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <BrandIcon size={24} />
            <div>
              <div className="font-extrabold text-xl text-foreground">
                How to Use ZeroPin
              </div>
              <div className="text-xs text-muted-foreground">
                Interactive walkthrough — click through each scenario
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={toggle} title={preference === "system" ? "System theme" : preference === "dark" ? "Dark mode" : "Light mode"}>
            {preference === "system" ? <Monitor size={16} /> : preference === "dark" ? <Moon size={16} /> : <Sun size={16} />}
          </Button>
        </div>

        {/* Scenario buttons */}
        <div className="flex gap-2 mb-5 flex-wrap">
          {scenarios.map((s) => (
            <Button
              key={s.id}
              variant={activeScenario === s.id ? "default" : "outline"}
              size="sm"
              onClick={() => selectScenario(s.id)}
              className="gap-1.5"
            >
              {s.icon}
              {s.title}
            </Button>
          ))}
        </div>

        {/* Browser mockup */}
        <BrowserMockup scenario={scenario} step={step} onAdvance={advance} />

        {/* Explanation */}
        <ExplanationPanel scenario={scenario} step={step} onNext={advance} onPrev={goBack} />

        {/* Footer tip */}
        <div className="mt-6 text-xs text-muted-foreground text-center">
          Tip: You can also click directly on the browser mockup to advance through steps.
        </div>
      </div>
    </div>
  );
}
