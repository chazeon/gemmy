// The element colour schemes the page offers, in the dropdown's order (after Auto). A scheme is one JSON file in this
// folder: {"id", "name", "description", "source", "colours": {symbol: "#rrggbb"}}, where the name is what the dropdown
// shows, the description is one line, and the source says where the colours came from and under what licence. The
// themes are derived by scripts/gen_themes.py; VESTA and Jmol by scripts/gen_element_styles.py. To add a theme: write
// its file here, import it, and add it to SCHEMES. The radii are shared by every scheme (element-styles.json).
import cvd from "./cvd.json";
import dark from "./dark.json";
import hokusai from "./hokusai.json";
import jmol from "./jmol.json";
import klimt from "./klimt.json";
import midcentury from "./midcentury.json";
import modern from "./modern.json";
import nippon from "./nippon.json";
import opencolor from "./opencolor.json";
import pastel from "./pastel.json";
import print from "./print.json";
import renoir from "./renoir.json";
import tailwind from "./tailwind.json";
import vangogh from "./vangogh.json";
import vesta from "./vesta.json";
import watercolour from "./watercolour.json";
import zhongguo from "./zhongguo.json";

export interface SchemeFile {
  id: string;
  name: string;
  description: string;
  source: string;
  colours: Record<string, string>;
}

export const SCHEMES: readonly SchemeFile[] = [
  vesta,
  jmol,
  modern,
  tailwind,
  print,
  dark,
  pastel,
  watercolour,
  midcentury,
  opencolor,
  cvd,
  nippon,
  zhongguo,
  hokusai,
  klimt,
  vangogh,
  renoir,
];
