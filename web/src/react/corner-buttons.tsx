// The corner button, bottom-right: the details button (react/details-button.tsx, which opens the details card), the customize
// button (react/customize-button.tsx, on a phone only: the dock's opener there) and the keyboard help (?), in its island. The
// island moves left of the dock when the dock is open (style.css). The island takes the pointer; the page behind it does not.
// The inspector's toggle is a tab on the page's right edge on a wide screen (react/inspector-toggle.tsx).
import { CustomizeButton } from "./customize-button";
import { DetailsButton } from "./details-button";
import { HelpButton } from "./help";

export function CornerButtons() {
  return (
    <div id="corner-buttons" className="island">
      <DetailsButton />
      <CustomizeButton />
      <HelpButton />
    </div>
  );
}
