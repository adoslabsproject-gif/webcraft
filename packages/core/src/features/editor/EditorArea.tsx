import Editor, { type OnMount } from '@monaco-editor/react';
import { FileText, FileX, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/app-store';
import { ChatView } from '../chat/ChatView';
import { DbStudioView } from '../db-studio/DbStudioView';
import { DevServerView } from '../dev-server/DevServerView';
import { RunButton } from '../run/RunButton';
import { ToolLibraryView } from '../tool-library/ToolLibraryView';
import { EditorTabs } from './EditorTabs';
import { setEditor } from './editor-controller';
import { InlineEditPrompt } from './InlineEditPrompt';
import { registerInlineEditAction } from './inline-edit';
import { useEditor } from './use-editor';

/// Editor area — Monaco editor backed by real file I/O via tauri-plugin-fs.
///
/// Cmd+S / Ctrl+S triggers save() which writes the buffer to disk and
/// clears the dirty marker on the tab. Binary files show a placeholder
/// instead of throwing a UTF-8 error.
export function EditorArea() {
  const { active, content, language, loading, error, kind, onChange, save } = useEditor();
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [inlinePromptOpen, setInlinePromptOpen] = useState(false);
  // Special tab kind (e.g. DB Studio) shortcuts the file-editor branch entirely.
  const activeEditorTab = useAppStore(
    (s) => s.editorTabs.find((t) => t.id === s.activeEditorTabId) ?? null,
  );
  const tabKind = activeEditorTab?.kind ?? 'file';

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isSave = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's';
      if (isSave) {
        e.preventDefault();
        void save();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  return (
    <div className="relative flex h-full flex-col bg-neutral-900">
      <InlineEditPrompt open={inlinePromptOpen} onClose={() => setInlinePromptOpen(false)} />
      <div className="flex items-center justify-between">
        <div className="flex-1 overflow-hidden">
          <EditorTabs />
        </div>
        <div className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-2">
          <RunButton />
        </div>
      </div>
      {tabKind === 'db-studio' ? (
        <DbStudioView />
      ) : tabKind === 'chat' ? (
        <ChatView />
      ) : tabKind === 'dev-server' ? (
        <DevServerView />
      ) : tabKind === 'tool-library' ? (
        <ToolLibraryView />
      ) : !active ? (
        <EmptyState />
      ) : loading ? (
        <div className="flex h-full items-center justify-center gap-2 text-[var(--color-fg-subtle)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">Loading {active.label}…</span>
        </div>
      ) : error ? (
        <div className="p-4 text-xs text-[var(--color-danger)]">{error}</div>
      ) : kind === 'binary' ? (
        <BinaryPlaceholder name={active.label} path={active.path} />
      ) : (
        <Editor
          height="100%"
          path={active.path}
          language={language}
          value={content}
          theme="vs-dark"
          onChange={onChange}
          onMount={(editor) => {
            editorRef.current = editor;
            setEditor(editor);
            registerInlineEditAction(editor, () => setInlinePromptOpen(true));
          }}
          options={{
            minimap: { enabled: true },
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
            scrollBeyondLastLine: false,
            renderWhitespace: 'selection',
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: true, indentation: true },
            // Copilot/Cursor-style ghost completions
            inlineSuggest: { enabled: true, mode: 'subwordSmart' },
            suggestOnTriggerCharacters: true,
            quickSuggestions: { other: true, comments: true, strings: true },
          }}
        />
      )}
    </div>
  );
}

/// Welcome screen — shown when no file is open. The fastest path into the
/// product is a single prompt, so it leads with "build a website" example
/// prompts that open the AI chat pre-filled and ready to send.
///
/// Each prompt is a COMPLETE project brief — structure, design system,
/// content, quality bar, and run instructions — so a single Enter produces
/// a finished, polished site on the first attempt, no follow-up questions.
const EXAMPLE_PROMPTS: { title: string; prompt: string }[] = [
  {
    title: '🎨 Portfolio site',
    prompt: `Build a COMPLETE personal portfolio website in plain HTML/CSS/JS (no frameworks, no build step). Do not ask me any questions — invent tasteful placeholder content (name "Alex Moretti", role "Product Designer & Front-end Developer") and finish everything in one pass.

STRUCTURE (single index.html + styles.css + main.js):
- Sticky translucent navbar: logo left, links (Work, About, Contact) right, smooth-scroll.
- Hero: full-viewport, animated gradient background (CSS keyframes), name in a huge display font, one-line tagline, CTA button "See my work" with hover lift.
- Work: responsive grid (3/2/1 columns) of 6 project cards — CSS-generated thumbnail (gradient + big emoji), title, 1-line description, tag pills. Cards lift + shadow on hover, fade-in on scroll (IntersectionObserver).
- About: two-column (portrait placeholder as CSS gradient circle with initials, bio text), skills as animated progress bars that fill when scrolled into view.
- Contact: form (name, email, message) with inline JS validation and a success state; social icons as inline SVG.
- Footer: minimal, copyright.

DESIGN SYSTEM: dark theme #0a0a0f background, surface #14141c, accent electric violet #7c5cff with hover #9b82ff, text #e8e8f0 / muted #8b8b9e. Typography: 'Syne' for display, 'Inter' for body via @font-face system fallbacks (no external requests). 8px spacing scale, 12px radius, generous whitespace. Subtle grain overlay. Respect prefers-reduced-motion.

QUALITY BAR: fully responsive down to 360px, semantic HTML5, no console errors, Lighthouse-friendly (lazy sections, no layout shift).

Create all files, then start a dev server on the folder and tell me the URL.`,
  },
  {
    title: '🍝 Restaurant landing',
    prompt: `Create a COMPLETE landing page for an Italian restaurant called "Trattoria Aurora" in plain HTML/CSS/JS. No questions — invent the full menu and copy in English with Italian dish names, finish in one pass.

STRUCTURE (index.html + styles.css + main.js):
- Announcement bar (open hours), sticky navbar that turns solid on scroll.
- Hero: full-screen, warm dark overlay on a CSS-only ambient background (layered gradients simulating candlelight), script-style headline, "Book a table" CTA scrolling to the form.
- Menu: tabbed sections (Antipasti, Primi, Secondi, Dolci, Vini) switchable with JS, each with 5 items — name, description, price aligned right with dotted leader lines.
- Gallery: 6-tile mosaic grid, tiles are CSS gradient "photos" with emoji centerpiece, lightbox on click (pure JS).
- Story: two-column section with drop-cap paragraph and a pull-quote.
- Booking: form (date, time, guests, name, phone) with validation, min-date = today, success toast.
- Footer: address, hours, phone, map placeholder, social SVG icons.

DESIGN: cream #f7f2ea background, ink #211d19 text, terracotta #c0502e accents, olive #6b7048 details. Serif display 'Playfair Display'-style stack for headings, humanist sans for body. Ornamental thin-line dividers. Fully responsive, reduced-motion safe, zero console errors.

Create all files, start a dev server and give me the URL.`,
  },
  {
    title: '🚀 SaaS landing page',
    prompt: `Scaffold and RUN a complete SaaS landing page with React 19 + Vite + Tailwind CSS v4 for a fictional product "Flowdeck — async standups for dev teams". No questions; invent all copy; finish in one pass.

SETUP: create the Vite React project in a new folder "flowdeck-landing", install deps (tailwindcss @tailwindcss/vite lucide-react), wire Tailwind v4 via the Vite plugin.

PAGE (componentized: Navbar, Hero, Logos, Features, HowItWorks, Pricing, FAQ, CTA, Footer):
- Navbar: sticky, blur backdrop, logo, links, "Start free" button.
- Hero: headline with gradient text span, subcopy, email-capture inline form, product mockup built from styled divs (browser chrome + fake dashboard with bars/avatars) — no images.
- Logos strip: 5 fictional company names in muted gray.
- Features: 6 cards with lucide icons, title, 2-line copy, hover glow.
- How it works: 3 numbered steps with connecting line.
- Pricing: 3 tiers (Free / Team $8 / Scale $19), middle tier highlighted "Most popular", feature checklists, monthly/yearly toggle that updates prices (-20% yearly).
- FAQ: 6-item accordion (single-open behavior).
- Final CTA band + footer with 4 link columns.

DESIGN: near-black #09090b, white text, indigo→cyan gradient accents, 1px zinc-800 borders, rounded-2xl, max-w-6xl container, generous py-24 sections. Polished focus states, responsive at every breakpoint.

After creating everything run "pnpm install" and start the dev server, then give me the URL. The page must render with ZERO console errors on first load.`,
  },
  {
    title: '📝 Blog',
    prompt: `Build a COMPLETE static personal blog "Notes from the Terminal" in plain HTML/CSS/JS — no frameworks, no build step, everything hand-crafted. No questions; write 4 full sample posts yourself (300+ words each, about dev topics); finish in one pass.

STRUCTURE:
- index.html: masthead with blog title + tagline, dark/light toggle (persisted in localStorage, respects prefers-color-scheme on first visit), list of post cards (title, date, reading time computed by JS, 2-line excerpt, tag pills).
- posts/post-1.html … post-4.html: article layout with serif body at 68ch measure, styled headings, code blocks with a copy button, blockquotes, prev/next links, back to index.
- about.html: short bio page.
- styles.css shared, CSS custom properties for both themes; main.js for the toggle + reading time + active nav.

DESIGN: paper #faf8f5 / ink #1a1816 light theme; #121110 / #e6e2dc dark. Accent burnt orange #d9552a. Typographic scale 1.25, drop caps on articles, hairline dividers. Fully responsive, print stylesheet for articles, zero console errors.

Create every file with the complete post content, then start a dev server on the folder and give me the URL.`,
  },
  {
    title: '🛒 E-commerce demo',
    prompt: `Build and RUN a complete e-commerce demo "Monoform — minimal everyday objects" with React 19 + Vite. No questions; invent 9 products; finish in one pass.

SETUP: new folder "monoform-shop", Vite React project, install deps, start it at the end.

FEATURES:
- Header: logo, search input filtering products live, cart button with item-count badge.
- Product grid: 9 products (name, price, CSS-gradient tile with emoji as the "photo", category), category filter chips, sort dropdown (price asc/desc, name).
- Product quick-view modal on click: bigger tile, description, quantity stepper, "Add to cart".
- Cart drawer sliding from the right: line items with thumbnail, quantity steppers, remove, subtotal, shipping (free over €80 — show progress bar toward it), total.
- Checkout view: form with validation (email, address, card number formatted in groups of 4, expiry MM/YY, CVC), order summary, fake "Place order" → success screen with order number.
- Cart state in React context, persisted to localStorage.

DESIGN: gallery-white #fafafa, black text, one accent #2f5af5, .5px hairline borders, uppercase micro-labels with letter-spacing, buttons with press states. Responsive: grid 3/2/1, drawer becomes full-screen on mobile. Zero console errors.

Create everything, run pnpm install, start the dev server, give me the URL.`,
  },
  {
    title: '📊 Admin dashboard',
    prompt: `Create a COMPLETE admin dashboard "Nimbus Analytics" in plain HTML/CSS/JS (single-page, no frameworks, no chart libraries — all charts hand-drawn SVG). No questions; generate realistic fake data in a data.js file; finish in one pass.

LAYOUT (index.html + styles.css + data.js + main.js):
- Fixed sidebar: logo, nav items with inline SVG icons (Overview, Revenue, Users, Reports, Settings), collapsed-to-icons mode under 900px, active state.
- Topbar: page title, date-range select (7/30/90 days — switching re-renders all charts from data.js), avatar menu.
- KPI row: 4 stat cards (Revenue, Active users, Conversion, Churn) with value, trend arrow, % delta vs previous period, and an inline SVG sparkline.
- Charts row: (1) revenue line chart — SVG path with smooth curve, gradient area fill, hover tooltip following the pointer with exact values; (2) traffic sources donut chart with legend and center total.
- Bar chart: weekly signups, animated grow-in, y-axis gridlines.
- Table: 12-row "Recent orders" — sortable columns (click header toggles asc/desc with arrow), status badges (paid/pending/failed), search filter, sticky header.

DESIGN: deep slate #0e1420 surfaces #16202e, text #dbe4f0, accent cyan #22d3ee + violet #8b5cf6 for series, 12px radius cards with soft inner border. Charts must be crisp on retina (vector), tooltips must never overflow the viewport. Fully responsive; zero console errors.

Create all files, start a dev server on the folder, give me the URL.`,
  },
];

function EmptyState() {
  const openChatTab = useAppStore((s) => s.openChatTab);
  const setChatPrefill = useAppStore((s) => s.setChatPrefill);

  function startWithPrompt(prompt: string) {
    setChatPrefill(prompt);
    openChatTab();
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-8 text-[var(--color-fg-dim)]">
      <div className="flex flex-col items-center gap-2">
        <FileText className="h-10 w-10" />
        <p className="text-sm font-medium text-[var(--color-fg-muted)]">
          Build an entire website from a single prompt
        </p>
        <p className="text-xs">
          Pick an example below, or open a file from the Explorer to edit by hand.
        </p>
      </div>
      <button
        type="button"
        onClick={() => openChatTab()}
        className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-500/25 transition-colors hover:bg-indigo-500"
      >
        Open AI Chat
        <kbd className="rounded bg-indigo-500/50 px-1.5 py-0.5 font-mono text-[10px]">⌘L</kbd>
      </button>
      <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {EXAMPLE_PROMPTS.map((example) => (
          <button
            key={example.title}
            type="button"
            onClick={() => startWithPrompt(example.prompt)}
            className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-2.5 text-left transition-colors hover:border-indigo-500/50 hover:bg-[var(--color-bg-hover)]"
          >
            <div className="text-xs font-medium text-[var(--color-fg)]">{example.title}</div>
            <div className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-[var(--color-fg-subtle)]">
              {example.prompt}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function BinaryPlaceholder({ name, path }: { name: string; path: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-[var(--color-fg-dim)]">
      <FileX className="h-12 w-12 text-[var(--color-fg-subtle)]" />
      <p className="text-sm text-[var(--color-fg-muted)]">Binary file — cannot display</p>
      <p className="font-mono text-[11px] text-[var(--color-fg-subtle)]">{name}</p>
      <p className="select-text max-w-md font-mono text-[10px] text-[var(--color-fg-dim)]">
        {path}
      </p>
    </div>
  );
}
