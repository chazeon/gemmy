// An error boundary around one section of the style panel: a section that throws shows its message and a retry button, and
// the other tabs stay up. It clears when the config changes (an edit or a new structure), so a section that failed on an
// old config is tried again on the new one. A class, since React has no hook form of an error boundary.
import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface BoundaryProps {
  children: ReactNode;
  // The value the boundary resets on: the panel's config.
  resetKey: unknown;
}

interface BoundaryState {
  error: unknown;
  resetKey: unknown;
  failed: boolean;
}

export class SectionBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey, failed: false };
  }

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error, failed: true };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    if (props.resetKey === state.resetKey) return null;
    return { error: null, failed: false, resetKey: props.resetKey };
  }

  retry = () => {
    this.setState({ error: null, failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error);
    return (
      <div role="alert" className="grid gap-2 text-xs">
        <p className="break-words text-muted-foreground">This section could not be shown: {message}</p>
        <div>
          <Button variant="outline" size="sm" onClick={this.retry}>
            Retry
          </Button>
        </div>
      </div>
    );
  }
}
