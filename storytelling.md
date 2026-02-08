# Gestures as a Human Browser Primitive

## Core claim
Gestures can be treated as a **human browser primitive**: a direct, low-latency input channel that triggers scoped AI/browser capabilities without relying on page-specific UI.

## Why this fits the track
- The Web Agent API defines what AI can see, do, and decide in the browser.
- Our CV pipeline adds a user-native control layer that maps hand poses (`0/1/2`) to agent actions.
- This makes execution boundaries explicit:
  - **Per-pose mapping** decides intent routing.
  - **Permission prompts** scope capability access.
  - **Safety mode** (confirm each or cooldown+arm) controls autonomy level.

## Current runtime model
- The gesture app runs as a normal web app in the browser (served locally via `python3 -m http.server`).
- MediaPipe hand tracking and pose classification run client-side in browser JS.
- Trigger events are emitted as browser events (`harbor:gesture-trigger`).
- Harbor/Web Agent API is consumed from page globals (`window.agent`, `window.ai`) injected by extensions.

## Integration path (no Harbor changes)
1. Gesture engine classifies pose slot `0/1/2`.
2. Trigger engine emits `trigger:fired` and dispatches `harbor:gesture-trigger`.
3. Harbor bridge maps pose -> action (`read_summarize`, `screenshot_analyze`, `ask_model`).
4. Bridge requests required permissions, then executes via existing APIs:
   - `window.agent.browser.activeTab.readability()`
   - `window.agent.browser.activeTab.screenshot()`
   - `window.ai.createTextSession({ provider: "ollama", model: "phi3.5" })`

## Demo story arc
1. User arms gesture mode.
2. Pose `1` captures the page state and summarizes it.
3. Pose `2` asks a custom task-level prompt.
4. Pose `0` gives a safe next-step recommendation.
5. User can inspect logs, remap gestures, and change safety mode live.

## What this surfaces for judges
- Permission design tradeoff: per-trigger confirmation vs cooldown autonomy.
- Agent-vs-task boundaries: mapping layer makes this explicit.
- Legibility and control: visible pose indicator, status panel, runtime logs, deterministic action mapping.
- Restraint: actions are scoped, interruptible, and intentionally limited in v0.
