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
} from "lucide-react";

/* ─── Types ──────────────────────────────────────────────────────── */

type ScenarioId = "save-page" | "save-snippet" | "open-highlight" | "organize";

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
        instruction: "Right-click anywhere on the page to open the context menu.",
      },
      {
        description: "The context menu appears with ZeroPin options.",
        instruction: 'Click "Save to ZeroPin".',
      },
      {
        description: "The page has been saved to your Library's Inbox folder!",
        instruction: "You can find it later in your Library. Click another scenario to continue.",
      },
    ],
  },
  {
    id: "save-snippet",
    title: "Save a snippet",
    icon: <Scissors size={14} />,
    steps: [
      {
        description: "You've found an important paragraph you want to save with context.",
        instruction: "Select the highlighted text on the page.",
      },
      {
        description: "With text selected, right-click to open the context menu.",
        instruction: 'Click "Save selection to ZeroPin".',
      },
      {
        description: "The snippet has been saved! It includes the selected text and its position on the page.",
        instruction: "When you open this bookmark later, the text will be highlighted automatically.",
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
        description: "Your Library has folders and bookmarks that you can organize.",
        instruction: "Drag a bookmark using the grip handle to reorder it.",
      },
      {
        description: "You can also drag bookmarks to different folders in the sidebar.",
        instruction: "Drag a bookmark onto a folder to move it there.",
      },
      {
        description: "Create new folders, rename items, add notes, and use the menu for more actions.",
        instruction: "Use Export/Import to back up your library, and toggle dark mode with the sun/moon button.",
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
        by Jane Smith · Published Feb 12, 2026 · 8 min read
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

function FakeLibraryView({ highlightSnippet }: { highlightSnippet?: boolean }) {
  const fakeFolders = [
    { name: "ZeroPin", active: false, depth: 0 },
    { name: "Inbox", active: true, depth: 1 },
    { name: "Research", active: false, depth: 1 },
    { name: "Tutorials", active: false, depth: 1 },
  ];

  const fakeBookmarks = [
    {
      name: "Understanding Modern Web Architecture",
      domain: "blog.example.com",
      isSnippet: true,
      snippet: "One of the most impactful changes has been the adoption of component-based architectures\u2026",
      time: "2h ago",
    },
    {
      name: "React Performance Tips",
      domain: "react.dev",
      isSnippet: false,
      time: "1d ago",
    },
    {
      name: "CSS Grid Layout Guide",
      domain: "css-tricks.com",
      isSnippet: false,
      time: "3d ago",
    },
  ];

  return (
    <div className="flex h-full font-sans">
      {/* Sidebar */}
      <div className="w-40 border-r border-border/50 p-2 bg-sidebar">
        <div className="text-[10px] font-bold text-muted-foreground mb-1.5">Folders</div>
        {fakeFolders.map((f) => (
          <div
            key={f.name}
            className={cn(
              "py-0.5 text-[11px] rounded-sm mb-px",
              f.active ? "bg-primary text-primary-foreground" : "text-foreground"
            )}
            style={{ paddingLeft: 6 + f.depth * 12, paddingRight: 6 }}
          >
            <FolderOpen size={10} className="inline mr-1 -mt-px" />
            {f.name}
          </div>
        ))}
      </div>

      {/* Bookmarks */}
      <div className="flex-1 p-2.5 overflow-y-auto bg-background">
        <div className="text-xs font-bold text-foreground mb-2">
          Bookmarks ({fakeBookmarks.length})
        </div>
        {fakeBookmarks.map((b, i) => (
          <div
            key={i}
            className={cn(
              "p-2 mb-1.5 bg-card border rounded-md transition-shadow",
              b.isSnippet ? "border-l-2 border-l-snippet" : "border-border/50",
              highlightSnippet && i === 0 && "ring-2 ring-primary/25"
            )}
            style={{ cursor: highlightSnippet && i === 0 ? "pointer" : "default" }}
          >
            <div className="flex items-center gap-1.5">
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
              <span className="text-muted-foreground text-[13px]">&#x22ee;</span>
            </div>
          </div>
        ))}
      </div>
    </div>
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
  const showSelection = sid === "save-snippet" && step >= 0 && step <= 1;
  const showHighlight = (sid === "save-snippet" && step === 2) || (sid === "open-highlight" && step === 2);
  const showToast =
    (sid === "save-page" && step === 2) ||
    (sid === "save-snippet" && step === 2);
  const showLibrary = sid === "open-highlight" || sid === "organize";
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
        {showLibrary && !showArticleInHighlight ? (
          <FakeLibraryView highlightSnippet={sid === "open-highlight" && step === 0} />
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
