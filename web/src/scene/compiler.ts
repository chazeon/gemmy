// The structure compiler on a page: compile.js, a second script the page loads only when it carries a gemmy-compiler
// meta (the hosted site and gemmy serve, not a single-file page). Loaded on first use and kept, so a second structure
// does not load it again. The viewer itself never imports the compiler: the type below is erased in the bundle.
import type { CompilerApi } from "../compiler/entry";

// The compiler's functions, as compile.js registers them (the entry's own object, minus the reader's ready promise).
export type Compiler = Omit<CompilerApi, "ready">;

// The meta's content as the page has it, or null when the page has no compiler. Not checked: compilerUrl checks it.
export function compilerMeta(): string | null {
  const content = document.querySelector<HTMLMetaElement>('meta[name="gemmy-compiler"]')?.content;
  return content ? content : null;
}

// The address as the page may show it: the origin and the path, with no query, fragment or credentials.
export function shownAddress(address: URL): string {
  return address.origin === "null" ? `${address.protocol}${address.pathname}` : `${address.origin}${address.pathname}`;
}

// The rules a compiler address must pass, in the order they are checked. Each gives the reason the address fails, or
// null. A reason shows the address through shownAddress.
type AddressRule = (address: URL, page: URL) => string | null;

const ADDRESS_RULES: readonly AddressRule[] = [
  (address, page) =>
    page.protocol === "file:"
      ? `The compiler (${shownAddress(address)}) cannot load from a file: page. A hosted page must be served over http.`
      : null,
  (address) =>
    address.protocol === "http:" || address.protocol === "https:"
      ? null
      : `The compiler's address ${shownAddress(address)} is not http or https, so the page will not load it.`,
  (address, page) =>
    address.origin === page.origin
      ? null
      : `The compiler's address ${shownAddress(address)} is on another site (${address.origin}); the page loads it from its own site only.`,
];

// The compiler's address on this page: the meta's content resolved against the page's address, and checked by the
// ADDRESS_RULES. The one resolver and validator of the address: it throws with the reason when the page may not load it.
export function compilerUrl(content: string, pageHref: string): string {
  let address: URL;
  try {
    address = new URL(content, pageHref);
  } catch {
    throw new Error("The page's compiler meta is not a valid address.");
  }
  const page = new URL(pageHref);
  for (const rule of ADDRESS_RULES) {
    const reason = rule(address, page);
    if (reason !== null) throw new Error(reason);
  }
  return address.href;
}

// Whether the page can compile: it has a compiler meta whose address the page may load. Never throws. A bad meta is not
// available here; loadCompiler says why, when a structure is opened.
export function compilerAvailable(): boolean {
  const content = compilerMeta();
  if (content === null) return false;
  try {
    compilerUrl(content, location.href);
    return true;
  } catch {
    return false;
  }
}

// The address of attempt `attempt` (0 is the first try, which loads the href as it is). A retry adds a `retry` query,
// the rest of the query kept, so an HTTP cache that holds the failed answer is not used.
export function retryHref(href: string, attempt: number): string {
  if (attempt === 0) return href;
  const url = new URL(href);
  url.searchParams.set("retry", String(attempt));
  return url.href;
}

// The message of a failed load: the address without its query or credentials, a hint when the page cannot load scripts
// at all (a file: page), and the reason. The raw cause stays on the thrown error's `cause`, for the console.
export function compilerLoadMessage(href: string, reason: string, protocol: string): string {
  const hint = protocol === "file:" ? " A hosted page must be served over http, not opened as a file." : "";
  return `Could not load the compiler (${shownAddress(new URL(href))}).${hint} Reason: ${reason}.`;
}

// A failed load whose message is a reason the page can show. Any other error shows a generic reason.
class LoadProblem extends Error {}

function reasonOf(error: unknown): string {
  return error instanceof LoadProblem ? error.message : "the browser could not fetch or run it";
}

// The reply to the script's request, as the page checks it before the text runs.
export interface ScriptReply {
  url: string;
  status: number;
  contentType: string | null;
}

const JAVASCRIPT_TYPES: ReadonlySet<string> = new Set(["text/javascript", "application/javascript"]);

// The reason the reply may not run, or null when it may: a 2xx status, the page's own site (the final address, after any
// redirect), and a JavaScript type. Pure, so the node tests cover it.
export function scriptReplyProblem(reply: ScriptReply, pageHref: string): string | null {
  const isSuccess = reply.status >= 200 && reply.status < 300;
  if (!isSuccess) return `the server answered ${reply.status}`;
  if (new URL(reply.url).origin !== new URL(pageHref).origin) return "it was served from another site";
  const mediaType = (reply.contentType ?? "").split(";")[0].trim().toLowerCase();
  if (!JAVASCRIPT_TYPES.has(mediaType)) return `it is served as ${mediaType || "no type"}, not JavaScript`;
  return null;
}

let loading: Promise<Compiler> | null = null;
let attempts = 0;

// The compiler, loaded once. A failed load is cleared, so the next try loads it again, at a new address.
export function loadCompiler(): Promise<Compiler> {
  loading ??= startCompiler().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

async function startCompiler(): Promise<Compiler> {
  const content = compilerMeta();
  if (content === null) throw new Error("This page has no compiler.");
  const href = retryHref(compilerUrl(content, location.href), attempts);
  attempts += 1;
  try {
    const text = await fetchScriptText(href);
    await runScript(text);
    const registered = globalThis.__gemmyCompiler;
    if (registered === undefined) throw new LoadProblem("compile.js did not register the compiler");
    await registered.ready;
    return registered;
  } catch (error) {
    delete globalThis.__gemmyCompiler;
    throw new Error(compilerLoadMessage(href, reasonOf(error), location.protocol), { cause: error });
  }
}

// The script's text, fetched and checked before it runs. A redirect is an error (redirect: "error"): the address the
// page checked is the one it runs, and the reply's final address and type are checked as well.
async function fetchScriptText(href: string): Promise<string> {
  const reply = await fetch(href, { redirect: "error", credentials: "same-origin" });
  const problem = scriptReplyProblem(
    { url: reply.url, status: reply.status, contentType: reply.headers.get("content-type") },
    location.href,
  );
  if (problem !== null) throw new LoadProblem(problem);
  return reply.text();
}

// Runs the text as a module script, from a blob: address. The address is revoked once the script has loaded, so no page
// URL is left for the script to come from again.
function runScript(text: string): Promise<void> {
  const address = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
  const script = document.createElement("script");
  script.type = "module";
  script.src = address;
  const loaded = new Promise<void>((resolve, reject) => {
    script.onload = () => resolve();
    script.onerror = () => reject(new LoadProblem("the script could not run"));
  });
  document.head.append(script);
  return loaded.finally(() => {
    URL.revokeObjectURL(address);
    script.remove();
  });
}
