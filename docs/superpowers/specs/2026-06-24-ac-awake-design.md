# AC Awake Mac App Design

## Goal

Build a small macOS desktop app that keeps the Mac awake while AC power is connected.

## Scope

The app targets AC-power operation only. It does not promise battery-powered closed-lid operation, because macOS treats lid-close sleep differently from ordinary idle sleep and public assertions are constrained by power state.

## Architecture

Use Tauri v2 with a Vite React TypeScript frontend. Redux Toolkit stores the UI state: whether the awake session is active, whether the app is busy, and the latest status or error message.

The Tauri backend exposes commands that start and stop an AC-power sleep-prevention process. The first implementation uses the system `caffeinate -s` behavior because the local macOS manual states this assertion prevents system sleep only while on AC power.

## User Experience

The first screen is the working control surface, not a landing page. It shows a clear on/off control, the current mode, and plain status text for AC-only behavior.

## Testing

Frontend state is tested with Vitest before UI wiring. Rust backend verification is done through Tauri release build. Full app verification is `pnpm test -- --run`, `pnpm build`, and `pnpm tauri build`.
