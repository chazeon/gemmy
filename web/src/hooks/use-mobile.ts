// shadcn/ui use-mobile hook (registry style new-york-v4, MIT, https://ui.shadcn.com), copied into the repo and kept as
// shadcn ships it, with this repo's import paths. One edit: the breakpoint is the page's phone width (ui/panels.ts), so
// "mobile" is at most PHONE_MAX_WIDTH, the same test as the page's phone rules.
import * as React from "react";
import { PHONE_MAX_WIDTH } from "@/ui/panels";

export function useIsMobile(mobileBreakpoint = PHONE_MAX_WIDTH + 1) {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${mobileBreakpoint - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < mobileBreakpoint);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < mobileBreakpoint);
    return () => mql.removeEventListener("change", onChange);
  }, [mobileBreakpoint]);

  return !!isMobile;
}
