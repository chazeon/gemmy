// The page's open-other-files flag: whether the viewer takes files from the user beyond its own scenes. One flag controls all
// of them together: the file island's + (react/file-island.tsx), the start screen's Open file… button and drop hint
// (react/home.tsx), and a file dropped on the page (ui/openers.ts). It is off by default. A page turns it on with its meta tag (gemmy-open, which the hosted site writes:
// gemmy.view.render_page), or the address does with ?open=1 (?open=0 turns it off, whatever the meta says).
import { signal } from "@preact/signals-core";

const OPEN_PARAM = "open";

function readFlag(): boolean {
  const param = new URLSearchParams(location.search).get(OPEN_PARAM);
  if (param === "1") return true;
  if (param === "0") return false;
  return document.querySelector<HTMLMetaElement>('meta[name="gemmy-open"]')?.content === "1";
}

export const allowOpen = signal(readFlag());
