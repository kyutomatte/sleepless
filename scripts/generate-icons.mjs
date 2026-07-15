import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const iconsDir = join(root, "src-tauri", "icons");
const assetsDir = join(root, "src", "assets");
const iconsetDir = "/private/tmp/sleepless.iconset";

const palette = {
  transparent: [0, 0, 0, 0],
  ink: [29, 44, 49, 255],
  bg: [32, 41, 45, 255],
  cream: [255, 248, 234, 255],
  shade: [223, 233, 229, 255],
  mint: [134, 184, 173, 255],
  menu: [17, 17, 17, 255],
  white: [255, 255, 255, 255],
};

const awakeGhost = [
  "................",
  "................",
  ".....CCCCCC.....",
  "....CSSSSSSC....",
  "...CSSSSSSSSC...",
  "..CSSSSSSSSSSC..",
  "..CSSSSSSSSSSC..",
  "..CSSIISSSIISC..",
  "..CSSIISSSIISC..",
  "..CSSSSSSSSSSC..",
  "..CSSSSMMSSSSC..",
  "..CSSSSSSSSSSC..",
  "..CCSSSSSSSSCC..",
  "..C.CC..CC.CC...",
  "................",
  "................",
];

const sleepGhost = [
  "................",
  "................",
  ".....CCCCCC.....",
  "....CSSSSSSC....",
  "...CSSSSSSSSC...",
  "..CSSSSSSSSSSC..",
  "..CSSSSSSSSSSC..",
  "..CSSII..IISC...",
  "..CSSSSSSSSSSC..",
  "..CSSSSSSSSSSC..",
  "..CSSSSMMSSSSC..",
  "..CSSSSSSSSSSC..",
  "..CCSSSSSSSSCC..",
  "..C.CC..CC.CC...",
  "................",
  "................",
];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function pngBuffer(width, height, pixels) {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const target = y * (width * 4 + 1) + 1 + x * 4;
      raw[target] = pixels[source];
      raw[target + 1] = pixels[source + 1];
      raw[target + 2] = pixels[source + 2];
      raw[target + 3] = pixels[source + 3];
    }
  }

  return Buffer.concat([
    header,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function fillRect(pixels, width, x, y, w, h, color) {
  for (let row = y; row < y + h; row += 1) {
    for (let col = x; col < x + w; col += 1) {
      const index = (row * width + col) * 4;
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = color[3];
    }
  }
}

function drawPixelGhost(pixels, width, offsetX, offsetY, cell, pattern, mode) {
  for (let y = 0; y < pattern.length; y += 1) {
    for (let x = 0; x < pattern[y].length; x += 1) {
      const token = pattern[y][x];
      const color =
        token === "C"
          ? palette.cream
            : token === "S"
              ? palette.shade
              : token === "I"
                ? mode === "menu" ? palette.transparent : palette.ink
              : token === "M"
                ? mode === "menu" ? palette.transparent : palette.mint
                : null;
      if (color) {
        fillRect(pixels, width, offsetX + x * cell, offsetY + y * cell, cell, cell, color);
      }
    }
  }
}

function makeAppIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  fillRect(pixels, size, 0, 0, size, size, palette.bg);
  const margin = Math.max(4, Math.floor(size * 0.08));
  const radius = Math.floor(size * 0.12);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cornerX = x < radius ? radius : x >= size - radius ? size - radius - 1 : x;
      const cornerY = y < radius ? radius : y >= size - radius ? size - radius - 1 : y;
      const dx = x - cornerX;
      const dy = y - cornerY;
      if (dx * dx + dy * dy > radius * radius && (x < radius || x >= size - radius || y < radius || y >= size - radius)) {
        fillRect(pixels, size, x, y, 1, 1, palette.transparent);
      }
    }
  }
  const cell = Math.floor((size - margin * 2) / 16);
  const ghostSize = cell * 16;
  const offset = Math.floor((size - ghostSize) / 2);
  drawPixelGhost(pixels, size, offset, offset, cell, awakeGhost, "app");
  return pngBuffer(size, size, pixels);
}

function makeTrayIcon(pattern) {
  const size = 32;
  const pixels = Buffer.alloc(size * size * 4);
  drawPixelGhost(pixels, size, 0, 0, 2, pattern, "menu");
  return pngBuffer(size, size, pixels);
}

function svgGhost(pattern, eyesLabel) {
  const rects = [];
  for (let y = 0; y < pattern.length; y += 1) {
    for (let x = 0; x < pattern[y].length; x += 1) {
      const token = pattern[y][x];
      const fill =
        token === "C" ? "#fff8ea" : token === "S" ? "#dfe9e5" : token === "I" ? "#1d2c31" : token === "M" ? "#86b8ad" : null;
      if (fill) {
        rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" role="img" aria-label="8bit ghost ${eyesLabel}" shape-rendering="crispEdges">${rects.join("")}</svg>\n`;
}

function writePng(path, buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
}

mkdirSync(iconsDir, { recursive: true });
mkdirSync(assetsDir, { recursive: true });
mkdirSync(iconsetDir, { recursive: true });

const appIconSizes = {
  "32x32.png": 32,
  "128x128.png": 128,
  "128x128@2x.png": 256,
  "icon.png": 512,
  "Square30x30Logo.png": 30,
  "Square44x44Logo.png": 44,
  "Square71x71Logo.png": 71,
  "Square89x89Logo.png": 89,
  "Square107x107Logo.png": 107,
  "Square142x142Logo.png": 142,
  "Square150x150Logo.png": 150,
  "Square284x284Logo.png": 284,
  "Square310x310Logo.png": 310,
  "StoreLogo.png": 50,
};

for (const [name, size] of Object.entries(appIconSizes)) {
  writePng(join(iconsDir, name), makeAppIcon(size));
}

const iconsetSizes = {
  "icon_16x16.png": 16,
  "icon_16x16@2x.png": 32,
  "icon_32x32.png": 32,
  "icon_32x32@2x.png": 64,
  "icon_128x128.png": 128,
  "icon_128x128@2x.png": 256,
  "icon_256x256.png": 256,
  "icon_256x256@2x.png": 512,
  "icon_512x512.png": 512,
  "icon_512x512@2x.png": 1024,
};

for (const [name, size] of Object.entries(iconsetSizes)) {
  writePng(join(iconsetDir, name), makeAppIcon(size));
}

writePng(join(iconsDir, "tray-awake.png"), makeTrayIcon(awakeGhost));
writePng(join(iconsDir, "tray-sleep.png"), makeTrayIcon(sleepGhost));
writeFileSync(join(assetsDir, "ghost-awake.svg"), svgGhost(awakeGhost, "awake"));
writeFileSync(join(assetsDir, "ghost-sleep.svg"), svgGhost(sleepGhost, "sleeping"));
