# ADR 0005: Desktop shell

Status: ACCEPTED (implementation scheduled for Phase 10)

## Context

Atomscope runs as a browser frontend against a Python backend bound to 127.0.0.1. For a desktop
distribution the options were evaluated on this workstation:

| Option | Toolchain here | Size / memory | Security model | Notes |
|---|---|---|---|---|
| Electron | Node 22 + npm package (Chromium binaries downloaded from the official electron release feed by the npm package) | ~150 MB, Chromium process per window | contextIsolation, sandbox, no nodeIntegration; IPC via preload | Mature packaging (electron-builder), consistent WebGL2 on all platforms |
| Tauri | needs Rust toolchain (not installed; `cargo`/`rustc` absent) | ~10 MB shell, uses system WebView (WebKitGTK here) | Rust-side command allowlist | WebGL2 performance and feature parity depend on the system WebView; Linux WebKitGTK has had WebGL2 gaps; adds a second systems language to the project |
| pywebview | Python; needs PyGObject/WebKitGTK bindings on Linux (`gi` not importable in the venv; no PyPI wheels for the GTK stack) | small | Python only | same WebView caveats as Tauri, harder to package cross-platform |
| Browser shell | none | none | relies on the OS browser | "atomscope serve" opens the default browser; zero packaging effort |

## Decision

1. Keep the browser shell (`atomscope serve` + default browser) as the primary developer and
   power-user mode.
2. For the packaged desktop application use **Electron** as a thin shell: it starts the bundled
   Python backend (PyInstaller-frozen `atomscope` including ASE/RDKit/Open Babel), waits for the
   loopback health endpoint, then loads the built frontend. Chromium guarantees the WebGL2 renderer
   behaves identically to the development browser, which matters more for a scientific renderer
   than the smaller footprint of WebView-based shells. Rust is not introduced merely for Tauri.
3. Security in the shell: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a
   per-launch bearer token shared between shell and backend (planned for the API), strict CSP,
   external links opened in the system browser.

## Consequences

- Packaging work (Phase 10): PyInstaller spec for the backend, electron-builder config,
  CI artifacts for Linux/macOS/Windows.
- Memory cost of Chromium is accepted; the backend remains a separate process so a renderer crash
  never loses calculation state (which lives on disk anyway).
