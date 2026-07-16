import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { copyFile, cp } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import packageJson from "../package.json" with { type: "json" };

const root = resolve(import.meta.dirname, "..");
const version = packageJson.version;
const targetTriple = process.env.TAURI_TARGET ?? "aarch64-apple-darwin";
const appName = "Sleepless.app";
const volumeName = "Sleepless";
const outName = `Sleepless_${version}_aarch64.dmg`;

const appPath = resolve(
  root,
  "src-tauri",
  "target",
  targetTriple,
  "release",
  "bundle",
  "macos",
  appName,
);
const dmgDir = resolve(
  root,
  "src-tauri",
  "target",
  targetTriple,
  "release",
  "bundle",
  "dmg",
);
const outputDmg = resolve(dmgDir, outName);
const backgroundPath = resolve(root, "src-tauri", "dmg", "background.png");
const workDir = resolve(root, "src-tauri", "target", "dmg-work");
const sparseImage = resolve(workDir, "Sleepless.sparseimage");
const mountPoint = resolve(workDir, "mnt");

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
}

function escapeAppleScriptPath(path) {
  return path.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function main() {
  if (!existsSync(appPath)) {
    throw new Error(`Missing app bundle. Build it first: ${appPath}`);
  }
  if (!existsSync(backgroundPath)) {
    throw new Error(`Missing DMG background: ${backgroundPath}`);
  }

  rmSync(workDir, { force: true, recursive: true });
  mkdirSync(mountPoint, { recursive: true });
  mkdirSync(dmgDir, { recursive: true });

  run("codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    "--timestamp=none",
    appPath,
  ]);

  run("hdiutil", [
    "create",
    "-size",
    "40m",
    "-fs",
    "HFS+",
    "-volname",
    volumeName,
    "-type",
    "SPARSE",
    "-ov",
    sparseImage,
  ]);

  let attached = false;
  try {
    run("hdiutil", [
      "attach",
      sparseImage,
      "-mountpoint",
      mountPoint,
      "-nobrowse",
    ]);
    attached = true;

    await cp(appPath, resolve(mountPoint, appName), {
      recursive: true,
      preserveTimestamps: true,
    });
    symlinkSync("/Applications", resolve(mountPoint, "Applications"));
    mkdirSync(resolve(mountPoint, ".background"), { recursive: true });
    await copyFile(backgroundPath, resolve(mountPoint, ".background", "background.png"));
    run("chflags", ["hidden", resolve(mountPoint, ".background")]);

    run("osascript", [
      "-e",
      `
set dmgPath to POSIX file "${escapeAppleScriptPath(mountPoint)}" as alias
tell application "Finder"
  open dmgPath
  delay 1
  set dmgWindow to container window of dmgPath
  set current view of dmgWindow to icon view
  set toolbar visible of dmgWindow to false
  set statusbar visible of dmgWindow to false
  set the bounds of dmgWindow to {100, 100, 820, 560}
  set viewOptions to the icon view options of dmgWindow
  set arrangement of viewOptions to not arranged
  set icon size of viewOptions to 96
  set text size of viewOptions to 14
  set background picture of viewOptions to file ".background:background.png" of dmgPath
  set position of item "Sleepless.app" of dmgPath to {170, 170}
    set position of item "Applications" of dmgPath to {550, 170}
  update dmgPath without registering applications
  delay 1
  close dmgWindow
end tell
      `.trim(),
    ]);
    rmSync(resolve(mountPoint, ".fseventsd"), { force: true, recursive: true });
  } finally {
    if (attached) {
      run("hdiutil", ["detach", mountPoint]);
    }
  }

  rmSync(outputDmg, { force: true });
  run("hdiutil", [
    "convert",
    sparseImage,
    "-format",
    "UDZO",
    "-imagekey",
    "zlib-level=9",
    "-o",
    outputDmg,
  ]);
  run("hdiutil", ["verify", outputDmg]);

  console.log(`Created ${basename(outputDmg)} at ${dirname(outputDmg)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
