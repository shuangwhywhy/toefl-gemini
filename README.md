# AI TOEFL Trainer

This repository now exposes the same app in three shapes from one codebase:

- `web`: standalone Vite SPA for browser delivery
- `macOS`: Tauri desktop app bundle
- `iOS`: Tauri mobile target backed by the generated Xcode project

The frozen legacy reference file [index-readonly-old.jsx](/Users/yizhouqiang/MyProjects/AI/toefl-gemini/index-readonly-old.jsx) stays untouched. Runtime code lives under [src](/Users/yizhouqiang/MyProjects/AI/toefl-gemini/src), and all LLM requests go through the unified Gemini SDK queue in [src/services/llm](/Users/yizhouqiang/MyProjects/AI/toefl-gemini/src/services/llm).

## Web

Use the browser build when you want the same product as a normal web app:

```bash
pnpm web:dev
pnpm web:build
pnpm web:preview
```

The production web bundle is emitted to [dist](/Users/yizhouqiang/MyProjects/AI/toefl-gemini/dist).

## macOS

Use the desktop shell when you want the packaged native app:

```bash
pnpm tauri:dev
pnpm tauri:build
```

The debug app bundle is generated at [AI TOEFL Trainer.app](/Users/yizhouqiang/MyProjects/AI/toefl-gemini/src-tauri/target/debug/bundle/macos/AI%20TOEFL%20Trainer.app).

## iOS

The iOS target has been initialized and the Xcode project now exists at [toefl-gemini.xcodeproj](/Users/yizhouqiang/MyProjects/AI/toefl-gemini/src-tauri/gen/apple/toefl-gemini.xcodeproj).

Useful commands:

```bash
pnpm ios:init
pnpm ios:dev
pnpm ios:build
```

iOS-specific Tauri overrides live in [tauri.ios.conf.json](/Users/yizhouqiang/MyProjects/AI/toefl-gemini/src-tauri/tauri.ios.conf.json), and microphone permission text lives in [Info.ios.plist](/Users/yizhouqiang/MyProjects/AI/toefl-gemini/src-tauri/Info.ios.plist).

Before running on a real device or producing an IPA, set your Apple development team either in Tauri config or via the `APPLE_DEVELOPMENT_TEAM` environment variable, because iOS code signing is required by Xcode/Tauri.
