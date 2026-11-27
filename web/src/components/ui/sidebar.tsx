// shadcn/ui sidebar (registry style new-york-v4, MIT, https://ui.shadcn.com), copied into the repo and kept as shadcn
// ships it, with this repo's import paths, for the dock (react/inspector/inspector.tsx). The edits to the copy, all here:
// - only the parts the page draws are kept (the provider, Sidebar, SidebarContent and SidebarGroup), and the Sidebar is
//   its desktop markup alone: a phone has its own sheet (react/inspector/inspector.tsx), so the stock mobile Sheet, the
//   mobile state, the rail, the trigger and the menu parts are gone;
// - no ctrl/cmd+B shortcut and no sidebar_state cookie: the page has neither (docs/ui.md); the dock's open state is the
//   page's own (ui/panels.ts), which the provider is controlled by (react/overlay.tsx);
// - the desktop markup shows from the page's `wide` breakpoint (641 px, tailwind.css), not md (768 px);
// - the width is the page's --sidebar-width (style.css: the dock's width), set once there, not by the provider;
// - the container's slide takes its duration from the page's --slide-duration (style.css: 0 until data-ready, 200 ms after,
//   0 for reduced motion) in place of duration-200, on the gap and the fixed container;
// - the root is fixed, so it takes no cell of the island layer's grid (style.css, #ui: three rows). A static root is a grid
//   item with an implicit row, which stops the start screen (#home) 8 px short of the window's bottom edge. Its visible part,
//   the fixed container, is out of flow already, as #lens-column and #inspector-tab are.
// - the content scrolls only up and down (overflow-y-auto overflow-x-hidden, not overflow-auto): a text selection dragged past
//   the dock's edge autoscrolls its scroll box, and a sideways scroll would cut the labels off (docs/ui.md).
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const SIDEBAR_WIDTH_ICON = "3rem";

type SidebarContextProps = {
  state: "expanded" | "collapsed";
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

function SidebarProvider({
  open,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  open: boolean;
}) {
  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed";

  const contextValue = React.useMemo<SidebarContextProps>(() => ({ state }), [state]);

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        className={cn("group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar", className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "offcanvas" | "icon";
}) {
  const { state } = useSidebar();

  return (
    <div
      className="group peer fixed hidden text-sidebar-foreground wide:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          "relative w-(--sidebar-width) bg-transparent transition-[width] duration-(--slide-duration) ease-linear",
          "group-data-[collapsible=offcanvas]:w-0",
          "group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
        )}
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          "fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-(--slide-duration) ease-linear wide:flex",
          side === "left"
            ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
            : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
          // Adjust the padding for floating and inset variants.
          variant === "floating" || variant === "inset"
            ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l",
          className,
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow-sm"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden group-data-[collapsible=icon]:overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  );
}

export { Sidebar, SidebarContent, SidebarGroup, SidebarProvider };
