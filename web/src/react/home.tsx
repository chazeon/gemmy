// The start screen (the home tab): the Open card centred over the stage, and the examples gallery of a hosted site below
// the first screen, where a scroll reveals it. The state and the actions are in ui/home.ts; this draws them. The screen is
// the first item of the overlay's grid (#home in style.css spans the whole window), so the islands drawn after it keep
// their own clicks.
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { FileUp, Link, SquareArrowUpRightExit } from "lucide-react";
import { compilerAvailable } from "../scene/compiler";
import { type Example, type Gallery, thumbnailAddressOf } from "../scene/examples";
import {
  type CardState,
  addressShown,
  card,
  gallery,
  openAddress,
  openExample,
  openFile,
  openServed,
  takeFocusRequest,
} from "../ui/home";
import type { TypePrompt } from "../ui/types-needed";
import { allowOpen } from "../ui/open-files";
import { HomeCard } from "./home-card";
import { ICON, ICON_SMALL } from "./icons";
import { TypeMapForm } from "./type-map-form";
import { useSignal } from "./use-signal";

// The Open card's words: a viewer that can compile a structure says so, one that only shows scenes says that.
const OPEN_COPY = {
  compiles: {
    title: "Open a scene or structure",
    description: "A POSCAR, CIF, extxyz or LAMMPS file, with an optional config. Or a scene.json.",
    dropHint: "or drop a structure, its config, or a scene.json anywhere",
  },
  viewOnly: {
    title: "Open a scene",
    description: "A gemmy scene.json, from this computer or the web",
    dropHint: "or drop a scene.json or .json.gz anywhere",
  },
} as const;

// Each type map prompt is a new form, so its labels never carry over from another prompt. The form's key is the prompt's
// number in the order the prompts were first drawn (a retry of a failed apply is a new prompt object, and its draft
// restores what was typed).
const promptNumbers = new WeakMap<TypePrompt, number>();
let promptCount = 0;
function formKeyOf(prompt: TypePrompt): number {
  let key = promptNumbers.get(prompt);
  if (key === undefined) {
    promptCount += 1;
    key = promptCount;
    promptNumbers.set(prompt, key);
  }
  return key;
}

// The fade at the window's bottom edge: its opacity follows the distance still to scroll, so it is full while more of the
// page is below and goes at the end. Set on the scroll, not in React state, so a scroll does not draw the screen again.
const FADE_PX = 64;
// The hook makes the refs the screen draws with: the scrolling window, the content it measures and the fade itself.
function useBottomFade() {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scroller.current;
    const fade = shade.current;
    const body = content.current;
    if (!element || !fade || !body) return;
    const update = () => {
      const below = element.scrollHeight - element.scrollTop - element.clientHeight;
      fade.style.opacity = String(Math.min(1, Math.max(0, below / FADE_PX)));
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    const resized = new ResizeObserver(update);
    resized.observe(element);
    resized.observe(body);
    return () => {
      element.removeEventListener("scroll", update);
      resized.disconnect();
    };
  }, []);
  return { scroller, content, shade };
}

export function Home() {
  const state = useSignal(card);
  if (!state.shown) return null;
  return <HomeScreen state={state} />;
}

function HomeScreen({ state }: { state: CardState }) {
  const found = useSignal(gallery);
  const { scroller, content, shade } = useBottomFade();
  return (
    <div id="home" ref={scroller} data-testid="home" className="hit">
      <div ref={content}>
        <div className="home-first">
          <div className="home-card grid w-full max-w-[420px] justify-items-stretch gap-3">
            <OpenCard state={state} />
            {state.typePrompt !== null && <TypeMapForm key={formKeyOf(state.typePrompt)} prompt={state.typePrompt} />}
          </div>
          {state.served !== null && (
            <Button variant="secondary" className="home-served" onClick={openServed}>
              Served by gemmy serve: {state.served}
            </Button>
          )}
        </div>
        {found && <ExamplesGallery found={found} />}
      </div>
      <div ref={shade} className="home-fade" aria-hidden="true" />
    </div>
  );
}

// The Open card: a file to choose or drop, or one address box for a scene URL or a gist, with the status and the error
// of the last try. New tab asks for the address box; the request is taken once, after the card is drawn. On a page that
// compiles, the card also takes a structure (with its config).
function OpenCard({ state }: { state: CardState }) {
  const address = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // The address box, or on a page without one (a gemmy serve page) the start screen's first action.
    if (takeFocusRequest())
      (address.current ?? document.querySelector<HTMLElement>("#home button, #home a[href], #home input"))?.focus();
  });
  const copy = OPEN_COPY[compilerAvailable() ? "compiles" : "viewOnly"];
  // The file button and the address box are the page's open-other-files and its address (ui/open-files.ts, ui/home.ts).
  const files = useSignal(allowOpen);
  const addressBox = useSignal(addressShown);
  return (
    <HomeCard title={copy.title} description={copy.description}>
      {files && (
        <button
          type="button"
          onClick={openFile}
          className="grid cursor-pointer justify-items-center gap-1 rounded-lg border border-dashed border-border px-4 py-5 text-center transition-colors outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <FileUp {...ICON} className="mb-1 text-muted-foreground" />
          <span className="text-sm font-medium">Open file…</span>
          <span className="text-xs text-muted-foreground">{copy.dropHint}</span>
        </button>
      )}
      {files && addressBox && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      {addressBox && (
        <form
          className="flex h-9 items-center gap-2 rounded-md border border-border pr-1 pl-3 transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25"
          onSubmit={(event) => {
            event.preventDefault();
            openAddress(address.current?.value ?? "");
          }}
        >
          <Link {...ICON_SMALL} className="shrink-0 text-muted-foreground" />
          <input
            ref={address}
            id="scene-address"
            type="text"
            inputMode="url"
            autoComplete="off"
            aria-label="Scene URL, or gist address or id"
            placeholder="Scene URL or gist"
            className="h-full min-w-0 flex-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" size="sm" className="h-7 px-3">
            Open
          </Button>
        </form>
      )}
      {state.status !== "" && (
        <p role="status" className="text-xs text-muted-foreground">
          {state.status}
        </p>
      )}
      {state.error !== null && (
        <p role="alert" className="font-mono text-xs break-words whitespace-pre-wrap text-destructive">
          {state.error}
        </p>
      )}
    </HomeCard>
  );
}

// The gallery: a card per example, with its picture (a site build's thumbnail, see examples.json). Its columns follow the
// window's width (CSS: .examples), and its top shows at the first screen's bottom edge (CSS: .home-gallery).
function ExamplesGallery({ found }: { found: Gallery }) {
  return (
    <section className="home-gallery" aria-labelledby="examples-title">
      <h2 id="examples-title" className="text-[15px] font-semibold">
        Examples
      </h2>
      <ul id="examples-grid" className="examples">
        {found.examples.map((example) => (
          <ExampleCard key={example.name} found={found} example={example} />
        ))}
      </ul>
    </section>
  );
}

// A card: the picture fills it, and the title stays steady at the bottom left in a soft halo of the card's background.
// On hover or focus a cover comes up under the title, and the description and the open icon show beside it. A touch
// screen has no hover, so it shows the title alone (style.css hides the description there).
function ExampleCard({ found, example }: { found: Gallery; example: Example }) {
  return (
    <li className="flex min-w-0">
      <button
        type="button"
        className="example outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        data-example={example.name}
        onClick={() => openExample(found, example)}
      >
        <span className="thumb">
          <img src={thumbnailAddressOf(found, example)} alt="" loading="lazy" />
        </span>
        <span className="cover" aria-hidden="true" />
        <span className="caption">
          <span className="description">{example.description}</span>
          <span className="title-row">
            <strong className="title">{example.title}</strong>
            <SquareArrowUpRightExit className="go" {...ICON} aria-hidden="true" />
          </span>
        </span>
      </button>
    </li>
  );
}
