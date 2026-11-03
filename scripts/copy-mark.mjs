// Copies the layered menu-bar mark (wings, diamond, outline, check) from the
// Swift app's resources into assets/mark/, where the Electron tray composites it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "menubar", "Resources");
const dest = path.join(root, "assets", "mark");
const layers = [
  "RepoesSweepWings.png",
  "RepoesSweepDiamond.png",
  "RepoesSweepDiamondOutline.png",
  "RepoesSweepCheck.png",
  "RepoesSweepMark.png",
];

fs.mkdirSync(dest, { recursive: true });
let copied = 0;
for (const name of layers) {
  const from = path.join(src, name);
  if (!fs.existsSync(from)) continue;
  fs.copyFileSync(from, path.join(dest, name));
  copied++;
}
const present = layers.filter((n) => fs.existsSync(path.join(dest, n))).length;
if (present === 0) {
  console.error(`No mark layers in ${src} or ${dest}; the tray falls back to a plain dot.`);
} else {
  console.log(`assets/mark: ${present} layers (${copied} copied from menubar/Resources)`);
}
