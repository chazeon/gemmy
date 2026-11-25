// The start screen (the home tab): the Open card centred over the stage, and the examples gallery of a hosted site below
// the first screen, where a scroll reveals it. The state and the actions are in ui/home.ts; this draws them. The screen is
// the first item of the overlay's grid (#home in style.css spans the whole window), so the islands drawn after it keep
// their own clicks.
import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { FileUp, Link, SquareArrowUpRightExit } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type Example, type Gallery, thumbnailAddressOf } from "../scene/examples";
import {
  type CardState,
  card,
  gallery,
  openAddress,
  openExample,
  openFile,
  openServed,
  takeFocusRequest,
} from "../ui/home";
import { useSignal } from "./use-signal";

// The fade at the window's bottom edge: its opacity follows the distance still to scroll, so it is full while more of the
// page is below and goes at the end. Set on the scroll, not in React state, so a scroll does not draw the screen again.
const FADE_PX = 64;
function useBottomFade(
  scroller: RefObject<HTMLDivElement | null>,
  content: RefObject<HTMLDivElement | null>,
  fade: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    const element = scroller.current;
    const shade = fade.current;
    const body = content.current;
    if (!element || !shade || !body) return;
    const update = () => {
      const below = element.scrollHeight - element.scrollTop - element.clientHeight;
      shade.style.opacity = String(Math.min(1, Math.max(0, below / FADE_PX)));
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
  }, [scroller, content, fade]);
}

export function Home() {
  const state = useSignal(card);
  if (!state.shown) return null;
  return <HomeScreen state={state} />;
}

function HomeScreen({ state }: { state: CardState }) {
  const found = useSignal(gallery);
  const address = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  useBottomFade(scroller, content, shade);
  // New tab asks for the address box; the request is taken once, after the screen is drawn.
  useEffect(() => {
    if (takeFocusRequest()) address.current?.focus();
  });

  return (
    <div id="home" ref={scroller} data-testid="home">
      <div ref={content}>
        <div className="home-first">
          <Card className="home-card w-full max-w-[420px] gap-4 rounded-(--radius) border-border py-5 shadow-(--shadow)">
            <CardHeader className="gap-1">
              <CardTitle className="text-[15px]">Open a scene</CardTitle>
              <CardDescription className="text-xs">A gemmy scene.json, from this computer or the web</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <button
                type="button"
                onClick={openFile}
                className="grid cursor-pointer justify-items-center gap-1 rounded-lg border border-dashed border-border px-4 py-5 text-center transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              >
                <FileUp size={20} strokeWidth={1.75} className="mb-1 text-muted-foreground" />
                <span className="text-sm font-medium">Choose a file</span>
                <span className="text-xs text-muted-foreground">or drop a scene.json or .json.gz anywhere</span>
              </button>
              <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>
              <form
                className="flex h-9 items-center gap-2 rounded-md border border-border pr-1 pl-3 transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25"
                onSubmit={(event) => {
                  event.preventDefault();
                  openAddress(address.current?.value ?? "");
                }}
              >
                <Link size={16} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />
                <input
                  ref={address}
                  id="scene-address"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  aria-label="Scene URL, or gist address or id"
                  placeholder="Scene URL or gist"
                  className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-foreground outline-none [font-family:inherit] placeholder:text-muted-foreground"
                />
                <Button type="submit" size="sm" className="h-7 px-3">
                  Open
                </Button>
              </form>
              {state.status !== "" && (
                <p role="status" className="m-0 text-xs text-muted-foreground">
                  {state.status}
                </p>
              )}
              {state.error !== null && (
                <p role="alert" className="m-0 font-mono text-xs break-words whitespace-pre-wrap text-destructive">
                  {state.error}
                </p>
              )}
            </CardContent>
          </Card>
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

// The gallery: a card per example, with its picture (a site build's thumbnail, see examples.json). Its columns follow the
// window's width (CSS: .examples), and its top shows at the first screen's bottom edge (CSS: .home-gallery).
function ExamplesGallery({ found }: { found: Gallery }) {
  return (
    <section className="home-gallery" aria-labelledby="examples-title">
      <h2 id="examples-title" className="m-0 text-[15px] font-semibold">
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

// A card: the picture fills it, the title sits on a small frosted label at its foot, and the description (on hover or
// focus, always on a touch screen) on a label above it.
function ExampleCard({ found, example }: { found: Gallery; example: Example }) {
  return (
    <li className="flex min-w-0">
      <button type="button" className="example" data-example={example.name} onClick={() => openExample(found, example)}>
        <span className="thumb">
          <img src={thumbnailAddressOf(found, example)} alt="" loading="lazy" />
        </span>
        <span className="cover" aria-hidden="true" />
        <span className="caption">
          <span className="description">{example.description}</span>
          <span className="title-row">
            <strong className="title">{example.title}</strong>
            <SquareArrowUpRightExit className="go" size={20} strokeWidth={1.75} aria-hidden="true" />
          </span>
        </span>
      </button>
    </li>
  );
}
