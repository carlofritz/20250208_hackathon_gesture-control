# Demo Runbook (45-Minute Submission)

## Goal
Demonstrate **gesture-triggered browser AI execution boundaries** with explicit permissions and user control.

## Story in one line
Hand poses become a human browser primitive that gates what AI can read, what it can do, and when it can act.

## Pre-demo checklist (2 minutes)
1. Start app: `npm run start` (or `python3 -m http.server <port>` if only frontend needed).
2. Confirm Harbor + Web Agents API extensions are enabled.
3. Confirm Web Agents API feature flags needed for your actions are on:
   - `textGeneration`
   - `browserInteraction`
   - `browserControl` (only if using research/live-tab features)
4. In app UI:
   - Safety mode above stream: `Confirm each`
   - Mapping: `0=read_summarize`, `1=screenshot_analyze`, `2=conversation_site_brief`
   - Model: `ollama / llama3.2`
5. Start camera and verify pose indicator (`0/1/2`) changes.

## 3-minute live script
1. **Execution boundary setup**
   - Point to the safety bar above the camera.
   - Say: "I start in confirm mode, so every action is user-approved."
2. **Pose 0: Read + summarize**
   - Trigger pose `0`, approve prompt.
   - Show resulting summary in runtime/result panel.
   - Narrate: "AI only reads active tab readability content."
3. **Pose 1: Screenshot + summarize**
   - Trigger pose `1`, approve prompt.
   - Narrate: "Now it uses screenshot-capable browser context."
4. **Pose 2: Accessibility voice brief**
   - Trigger pose `2`, approve prompt.
   - If audio plays, call out voice layer for accessibility.
   - If TTS fails, show text fallback and call out graceful degradation.
5. **Model portability**
   - Click `Use Phi Fallback`.
   - Trigger one pose again and show logs with model switch.

## Judge-facing talking points
- **Clarity of boundaries:** pose -> mapped action -> permission gate -> explicit result.
- **Thoughtful browser context use:** readability/screenshot used intentionally per task.
- **Permission design:** confirm-by-default, optional cooldown for advanced users.
- **Legibility and control:** visible pose state, runtime logs, inspectable outcomes.
- **Judgment/restraint:** read-only actions first; mutable automation is intentionally not default.

## If something breaks (fallback script)
1. Keep safety in `Confirm each`.
2. Use only:
   - pose `0`: `read_summarize`
   - pose `1`: `screenshot_analyze`
3. Set pose `2` to `ask_model` if ElevenLabs is unavailable.
4. Skip research/live-tab actions in live demo.

## Last-minute verification
- Trigger each mapped pose once.
- Confirm one denied permission path shows clear error message.
- Confirm one canceled confirm-dialog path logs a skipped action.
