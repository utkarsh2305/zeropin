import sharp from "sharp";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(__dirname, "icon.svg");
const outDir = resolve(__dirname, "..", "public", "icons");

const sizes = [16, 32, 48, 128];

const svg = readFileSync(svgPath);

for (const size of sizes) {
  const outPath = resolve(outDir, `icon${size}.png`);
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`Generated ${outPath} (${size}x${size})`);
}

console.log("Done!");
