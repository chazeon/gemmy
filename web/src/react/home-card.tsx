// The start screen's cards: the Open card and the type map form share one frame (its width, its padding, its title and
// its description). The card is a labelled group, so a screen reader names it and reads what it is for.
import { type ReactNode, useId } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const CARD_CLASS = "w-full gap-4 rounded-(--radius) border-border py-5 shadow-(--shadow)";

export function HomeCard({
  title,
  description,
  testId,
  children,
}: {
  title: string;
  description: string;
  testId?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <Card
      role="group"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-testid={testId}
      className={CARD_CLASS}
    >
      <CardHeader className="gap-1">
        <CardTitle id={titleId} className="text-[15px]">
          {title}
        </CardTitle>
        <CardDescription id={descriptionId} className="text-xs">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}
