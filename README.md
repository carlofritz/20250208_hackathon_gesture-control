# Gesture Control Prototype (Vanilla + MediaPipe)

Standalone browser prototype for gesture-driven triggers and pose snapshots.

## What it does
- Uses webcam + MediaPipe Hand Landmarker in the browser.
- Classifies heuristic gestures (`open_palm`, `pinch`, `victory`, `fist`, `thumbs_up`).
- Captures 3 hardcoded default gesture slots (`0=thumbs_up`, `1=palm`, `2=peace`) from a live preview using `Enter`.
- Includes a `Settings` popup with guided keyboard-first capture and a `3,2,1` countdown.
- Allows multiple `Enter` captures for a single slot to improve match accuracy.
- Allows renaming pose slots from the popup (`Pose name (optional)`).
- Auto-saves pose snapshots (labels + MediaPipe keypoints) and can restore from a dropdown in `Settings`.
- Shows large countdown numbers and hand skeleton overlay inside the defaults preview while recording.
- Uses a lean single-column UI where pose controls sit directly under the live stage and logs/triggers are expandable.
- Shows top-level execution safety controls above the camera stream (`confirm each` or `cooldown + arm`).
- Saves raw landmarks, normalized landmarks, embedding, and model/runtime metadata.
- Shows live pose classification badge (`0`, `1`, `2`) in the top-right of the camera view.
- Emits SDK-ready events (`harbor:gesture-trigger`) for pipeline automation.
- Includes direct ElevenLabs gesture actions:
  - `voice_tts_ping`: calls local `/api/elevenlabs/tts`
  - `voice_transcribe_note`: records a short mic note and calls local `/api/elevenlabs/stt`
- Includes a built-in Harbor integration panel:
  - maps pose `0/1/2` to SDK actions (`read_summarize`, `screenshot_analyze`, `conversation_site_brief` by default)
  - supports per-pose meta gestures and per-pose alt actions (`pose + meta => +1 route`)
  - supports provider/model selection (`ollama` + `llama3.2` default, one-click `phi3.5` fallback)
  - supports research depth settings and ElevenLabs agent/voice overrides

## Pose capture flow
1. Start camera.
2. Hold hand in the small preview window.
3. Press `Enter` to snap the current pose into its default slot (`thumbs_up/palm/peace`).
4. For higher accuracy, open `Settings`, press `Enter` to start capture, press `Enter` multiple times per pose, and press `Tab` to move pose-to-pose.
5. Optional: rename each pose in `Settings` with `Pose name (optional)`.
6. Optional: restore a previous defaults snapshot from `Settings > Restore defaults snapshot`.
7. Optional: click `Copy Hardcoded JSON` and paste into `src/config/hardcoded-poses.js`.

## Estimation logic saved per sample
Each recorded sample stores:
- `rawLandmarks`: direct MediaPipe 21-point output.
- `estimation.normalizedLandmarks`: wrist-centered, scale-normalized coordinates.
- `estimation.embedding`: flattened 63-value vector from normalized landmarks.
- `estimation.pairDistances`: geometric distances (thumb-index, index-middle, etc.).
- `estimation.classifierMetrics`: post-logic metrics from gesture classifier.
- `mediapipe`: model/delegate/runtime settings used at capture.

## Project layout
- `index.html`: app shell
- `src/app.js`: app wiring, camera loop, pose capture, UI updates
- `src/core/mediapipe-hand-tracker.js`: MediaPipe tracking wrapper + runtime metadata
- `src/core/gesture-classifier.js`: landmark-to-gesture logic
- `src/core/pose-estimation.js`: normalization, embeddings, snapshot serialization
- `src/core/pose-library.js`: 3-slot pose store with multi-sample matching, persistence, export
- `src/core/pose-preview.js`: live preview + saved slot preview rendering
- `src/core/trigger-engine.js`: trigger state machine
- `src/core/overlay.js`: landmark overlay
- `src/config/triggers.js`: trigger definitions
- `src/config/harbor-integration.js`: Harbor action catalog + persisted integration settings
- `src/config/pose-classes.js`: class mapping for slots `0/1/2`
- `src/config/hardcoded-poses.js`: hardcoded pose template source
- `src/integrations/harbor-trigger-adapter.js`: dispatches trigger events to Harbor boundary
- `src/integrations/harbor-sdk-bridge.js`: executes mapped actions through `window.agent/window.ai`
- `tests/unit/`: unit tests for pose matching, trigger logic, adapter payloads, settings normalization, bridge routing
- `tests/e2e/`: Playwright smoke tests
- `harbor-test/`: generated Harbor testing harness (mock + fixtures + examples)

## Run locally
From this folder:

```bash
# Start local app + ElevenLabs bridge in the background
npm run up

# Check status / health
npm run status

# Tail local server logs
npm run logs

# Stop background server
npm run down
```

If port `4173` is already in use, start with a different port:

```bash
PORT=4273 npm run up
```

Or set `PORT=4273` in `.env`.

Then open:

```text
http://localhost:4173
```

Camera permission is required.

This is the only local backend process required for the gesture + ElevenLabs flow.
Harbor extension features run in-browser and do not require another local server here.

For live-pitch flow and fallback handling, use `demo_runbook.md`.

## Testing
Unit and smoke test scripts:

```bash
# run unit tests
npm run test:unit

# same as test:unit (default test gate)
npm run test

# e2e smoke test (requires Playwright + extension paths)
npm run test:e2e:smoke
```

Notes:
- Unit tests use the Harbor mock harness and run without browser extensions.
- E2E uses `tests/e2e/smoke.spec.ts` with Harbor fixture in `harbor-test/fixtures/harbor.ts`.
- For extension-backed E2E, set:
  - `HARBOR_EXTENSION_PATH=/path/to/harbor/extension/dist-chrome`
  - `WEB_AGENTS_EXTENSION_PATH=/path/to/harbor/web-agents-api/dist-chrome`
- If Playwright is missing locally, install:
  - `npm install -D @playwright/test`

## ElevenLabs setup
1. Fill your credentials in `.env` (a template is in `.env.example`).
2. At minimum set `ELEVENLABS_API_KEY`.
3. Optional defaults:
   - `ELEVENLABS_AGENT_ID` for signed URL requests
   - `ELEVENLABS_VOICE_ID` for TTS
   - `ELEVENLABS_TTS_MODEL_ID` and `ELEVENLABS_STT_MODEL_ID`

## ElevenLabs API routes
When running `npm run up` (or `npm run start`), these local routes are available:

- `GET /api/elevenlabs/health`
- `POST /api/elevenlabs/agent/create`
- `GET /api/elevenlabs/agent/signed-url?agent_id=...`
- `POST /api/elevenlabs/tts`
- `POST /api/elevenlabs/stt`

In **Settings**, map any pose to `Voice TTS ping` or `Voice STT note` to run these directly from gestures.

`POST /api/elevenlabs/tts` body example:

```json
{
  "text": "Hello from gesture control",
  "voice_id": "your_voice_id",
  "model_id": "eleven_multilingual_v2",
  "output_format": "mp3_44100_128"
}
```

`POST /api/elevenlabs/stt` body example:

```json
{
  "audio_base64": "<base64-audio-or-data-url>",
  "filename": "sample.webm",
  "mime_type": "audio/webm",
  "model_id": "scribe_v1"
}
```

## ElevenLabs CLI smoke tests
Use these after filling `.env`:

```bash
# Create an agent from tools/agent.create.template.json
npm run agent:create

# Get signed conversation URL for an agent
npm run agent:signed-url -- <agent_id>

# Generate speech audio file
npm run tts -- "Hello world" outputs/hello.mp3 <voice_id>

# Transcribe local audio file
npm run stt -- ./path/to/audio.wav outputs/transcript.json
```

## Harbor SDK bridge
The app now includes a default in-page bridge that listens for trigger events and executes mapped Harbor actions.

Default action set:
- Pose `0`: `read_summarize` (reads active page and summarizes)
- Pose `1`: `screenshot_analyze` (captures screenshot + summarizes current state)
- Pose `2`: `conversation_site_brief` (reads page and speaks a concise brief)

Modifier behavior:
- Secondary hand with per-pose meta gesture switches to per-pose alternate action.
- Default meta gestures: pose0=`fist`, pose1=`pinch`, pose2=`thumbs_up`.
- Default alternates: `research_agent_alt`, `screenshot_analyze_alt`, `conversation_live_elevenlabs`.

It still emits raw events for external listeners:

```js
window.addEventListener("harbor:gesture-trigger", async (event) => {
  const payload = event.detail;
  console.log("Gesture trigger payload", payload);
  // payload.modifier: { detected, gesture, handedness, source }
  // payload.hands: compact per-hand gesture summary
});
```

Screenshot action also emits:

```js
window.addEventListener("harbor:gesture-screenshot", (event) => {
  const { poseSlot, dataUrl } = event.detail;
  console.log("Screenshot captured by pose", poseSlot, dataUrl?.slice(0, 48));
});
```
