import { EventBus } from "./core/event-bus.js";
import { MediapipeHandTracker } from "./core/mediapipe-hand-tracker.js";
import { classifyHandGestures } from "./core/gesture-classifier.js";
import { TriggerEngine } from "./core/trigger-engine.js";
import { drawOverlay } from "./core/overlay.js";
import { PoseLibrary } from "./core/pose-library.js";
import { drawLivePosePreview, drawStoredPosePreview } from "./core/pose-preview.js";
import { estimatePoseFeatures } from "./core/pose-estimation.js";
import { HarborTriggerAdapter } from "./integrations/harbor-trigger-adapter.js";
import { HarborSdkBridge } from "./integrations/harbor-sdk-bridge.js";
import { TRIGGER_CONFIG } from "./config/triggers.js";
import { HARDCODED_POSES } from "./config/hardcoded-poses.js";
import { POSE_CLASSES, POSE_CLASS_BY_SLOT } from "./config/pose-classes.js";
import {
  DEFAULT_HARBOR_SETTINGS,
  HARBOR_ACTIONS,
  HARBOR_MODIFIER_GESTURES,
  HARBOR_SETTINGS_STORAGE_KEY,
  normalizeHarborSettings,
} from "./config/harbor-integration.js";

const elements = {
  video: document.getElementById("camera"),
  overlay: document.getElementById("overlay"),
  poseIndicator: document.getElementById("poseIndicator"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  status: document.getElementById("status"),
  gestureSummary: document.getElementById("gestureSummary"),
  triggerList: document.getElementById("triggerList"),
  logList: document.getElementById("logList"),
  posePreview: document.getElementById("posePreview"),
  poseSlots: document.getElementById("poseSlots"),
  clearPosesBtn: document.getElementById("clearPosesBtn"),
  copyPosesBtn: document.getElementById("copyPosesBtn"),
  openDefaultsBtn: document.getElementById("openDefaultsBtn"),
  defaultsModal: document.getElementById("defaultsModal"),
  defaultsPreview: document.getElementById("defaultsPreview"),
  defaultsCountdown: document.getElementById("defaultsCountdown"),
  defaultsStep: document.getElementById("defaultsStep"),
  defaultsLabelInput: document.getElementById("defaultsLabelInput"),
  defaultsSnapshotSelect: document.getElementById("defaultsSnapshotSelect"),
  defaultsRestoreSnapshotBtn: document.getElementById("defaultsRestoreSnapshotBtn"),
  defaultsSampleCount: document.getElementById("defaultsSampleCount"),
  defaultsSlotHint: document.getElementById("defaultsSlotHint"),
  defaultsRecordStatus: document.getElementById("defaultsRecordStatus"),
  defaultsActionBtn: document.getElementById("defaultsActionBtn"),
  closeDefaultsBtn: document.getElementById("closeDefaultsBtn"),
  harborBridgeStatus: document.getElementById("harborBridgeStatus"),
  harborLastResult: document.getElementById("harborLastResult"),
  integrationPresetSelect: document.getElementById("integrationPresetSelect"),
  applyIntegrationPresetBtn: document.getElementById("applyIntegrationPresetBtn"),
  remoteBridgeSessionInput: document.getElementById("remoteBridgeSessionInput"),
  copyTargetHelperSnippetBtn: document.getElementById("copyTargetHelperSnippetBtn"),
  poseMapLabel0: document.getElementById("poseMapLabel0"),
  poseMapLabel1: document.getElementById("poseMapLabel1"),
  poseMapLabel2: document.getElementById("poseMapLabel2"),
  poseMapSelect0: document.getElementById("poseMapSelect0"),
  poseMapSelect1: document.getElementById("poseMapSelect1"),
  poseMapSelect2: document.getElementById("poseMapSelect2"),
  poseAltMapLabel0: document.getElementById("poseAltMapLabel0"),
  poseAltMapLabel1: document.getElementById("poseAltMapLabel1"),
  poseAltMapLabel2: document.getElementById("poseAltMapLabel2"),
  poseAltMapSelect0: document.getElementById("poseAltMapSelect0"),
  poseAltMapSelect1: document.getElementById("poseAltMapSelect1"),
  poseAltMapSelect2: document.getElementById("poseAltMapSelect2"),
  poseMetaGestureLabel0: document.getElementById("poseMetaGestureLabel0"),
  poseMetaGestureLabel1: document.getElementById("poseMetaGestureLabel1"),
  poseMetaGestureLabel2: document.getElementById("poseMetaGestureLabel2"),
  poseMetaGestureSelect0: document.getElementById("poseMetaGestureSelect0"),
  poseMetaGestureSelect1: document.getElementById("poseMetaGestureSelect1"),
  poseMetaGestureSelect2: document.getElementById("poseMetaGestureSelect2"),
  modifierEnabledToggle: document.getElementById("modifierEnabledToggle"),
  harborProviderInput: document.getElementById("harborProviderInput"),
  harborModelInput: document.getElementById("harborModelInput"),
  askPromptTemplate: document.getElementById("askPromptTemplate"),
  researchSourceCountInput: document.getElementById("researchSourceCountInput"),
  researchCloseTabsToggle: document.getElementById("researchCloseTabsToggle"),
  researchQueryTemplate: document.getElementById("researchQueryTemplate"),
  elevenLabsAgentIdInput: document.getElementById("elevenLabsAgentIdInput"),
  elevenLabsVoiceIdInput: document.getElementById("elevenLabsVoiceIdInput"),
  safetyModeSelect: document.getElementById("safetyModeSelect"),
  safetyCooldownGroup: document.getElementById("safetyCooldownGroup"),
  safetyArmGroup: document.getElementById("safetyArmGroup"),
  cooldownRange: document.getElementById("cooldownRange"),
  cooldownValue: document.getElementById("cooldownValue"),
  armCooldownToggle: document.getElementById("armCooldownToggle"),
  usePhiFallbackBtn: document.getElementById("usePhiFallbackBtn"),
  saveIntegrationBtn: document.getElementById("saveIntegrationBtn"),
  checkHarborBtn: document.getElementById("checkHarborBtn"),
};

const INTEGRATION_PRESETS = {
  hackathon_combo: {
    mapping: {
      0: "screenshot_analyze",
      1: "research_agent",
      2: "mcp_filesystem_nested_workflow",
    },
    modifier: {
      enabled: true,
      perPoseGesture: {
        0: "fist",
        1: "pinch",
        2: "thumbs_up",
      },
      perPoseAltAction: {
        0: "conversation_site_brief",
        1: "agent_run_brief",
        2: "conversation_live_elevenlabs",
      },
    },
  },
  remote_news_demo: {
    mapping: {
      0: "remote_read_screenshot_summarize",
      1: "read_summarize",
      2: "conversation_site_brief",
    },
    modifier: {
      enabled: false,
      perPoseGesture: {
        0: "fist",
        1: "fist",
        2: "fist",
      },
      perPoseAltAction: {
        0: "none",
        1: "none",
        2: "none",
      },
    },
  },
  fs_nested_recommended: {
    mapping: {
      0: "mcp_fetch_brief",
      1: "mcp_filesystem_nested_workflow",
      2: "mcp_filesystem_log",
    },
    modifier: {
      enabled: true,
      perPoseGesture: {
        0: "fist",
        1: "pinch",
        2: "thumbs_up",
      },
      perPoseAltAction: {
        0: "mcp_filesystem_log",
        1: "mcp_fetch_brief",
        2: "mcp_calendar_next",
      },
    },
  },
  fs_only: {
    mapping: {
      0: "mcp_filesystem_nested_workflow",
      1: "mcp_filesystem_log",
      2: "mcp_fetch_brief",
    },
    modifier: {
      enabled: false,
      perPoseGesture: {
        0: "fist",
        1: "fist",
        2: "fist",
      },
      perPoseAltAction: {
        0: "none",
        1: "none",
        2: "none",
      },
    },
  },
  legacy_demo: {
    mapping: {
      0: "read_summarize",
      1: "screenshot_analyze",
      2: "conversation_site_brief",
    },
    modifier: {
      enabled: true,
      perPoseGesture: {
        0: "fist",
        1: "pinch",
        2: "thumbs_up",
      },
      perPoseAltAction: {
        0: "research_agent_alt",
        1: "screenshot_analyze_alt",
        2: "conversation_live_elevenlabs",
      },
    },
  },
};

const eventBus = new EventBus();
const triggerEngine = new TriggerEngine(eventBus);
triggerEngine.register(TRIGGER_CONFIG);

const harborAdapter = new HarborTriggerAdapter(eventBus);
harborAdapter.start();

const poseLibrary = new PoseLibrary({
  eventBus,
  maxPoses: 3,
  initialPoses: HARDCODED_POSES,
  slotLabels: POSE_CLASSES.map((item) => item.label),
  matchThreshold: 0.13,
  maxSamplesPerSlot: 24,
});

function loadHarborSettings() {
  const fallback = normalizeHarborSettings(DEFAULT_HARBOR_SETTINGS);

  try {
    const stored = localStorage.getItem(HARBOR_SETTINGS_STORAGE_KEY);
    if (!stored) {
      return fallback;
    }

    const parsed = JSON.parse(stored);
    return normalizeHarborSettings(parsed);
  } catch {
    return fallback;
  }
}

function persistHarborSettings(settings) {
  try {
    localStorage.setItem(HARBOR_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors in private mode or blocked storage environments.
  }
}

const harborBridge = new HarborSdkBridge({
  eventBus,
  settings: loadHarborSettings(),
  getPoseLabel: (slotIndex) => poseLibrary.getSlotLabel(slotIndex),
});
harborBridge.start();

const defaultsRecorder = {
  isOpen: false,
  isCountdown: false,
  isRecording: false,
  guidedStarted: false,
  selectedSlotIndex: 0,
  slotOrder: [0, 1, 2],
  sessionToken: 0,
};

let tracker = null;
let running = false;
let stream = null;
let frameId = 0;
let latestHands = [];

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function setStatus(text, isError = false) {
  elements.status.textContent = text;
  elements.status.classList.toggle("error", isError);
}

function appendLog(text, type = "info") {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()}  ${text}`;
  if (type === "error") {
    item.classList.add("error");
  }

  elements.logList.prepend(item);
  while (elements.logList.children.length > 40) {
    elements.logList.removeChild(elements.logList.lastChild);
  }
}

function setHarborBridgeStatus(text, type = "info") {
  if (!elements.harborBridgeStatus) {
    return;
  }

  elements.harborBridgeStatus.textContent = text;
  elements.harborBridgeStatus.classList.remove("status-error", "status-ok");
  if (type === "error") {
    elements.harborBridgeStatus.classList.add("status-error");
  } else if (type === "ok") {
    elements.harborBridgeStatus.classList.add("status-ok");
  }
}

function setHarborLastResult(text, type = "info") {
  if (!elements.harborLastResult) {
    return;
  }

  elements.harborLastResult.textContent = text;
  if (type === "error") {
    elements.harborLastResult.classList.add("status-error");
  } else {
    elements.harborLastResult.classList.remove("status-error");
  }
}

function getPoseMapSelect(slotIndex) {
  if (slotIndex === 0) return elements.poseMapSelect0;
  if (slotIndex === 1) return elements.poseMapSelect1;
  return elements.poseMapSelect2;
}

function getPoseMapLabel(slotIndex) {
  if (slotIndex === 0) return elements.poseMapLabel0;
  if (slotIndex === 1) return elements.poseMapLabel1;
  return elements.poseMapLabel2;
}

function getPoseAltMapSelect(slotIndex) {
  if (slotIndex === 0) return elements.poseAltMapSelect0;
  if (slotIndex === 1) return elements.poseAltMapSelect1;
  return elements.poseAltMapSelect2;
}

function getPoseAltMapLabel(slotIndex) {
  if (slotIndex === 0) return elements.poseAltMapLabel0;
  if (slotIndex === 1) return elements.poseAltMapLabel1;
  return elements.poseAltMapLabel2;
}

function getPoseMetaGestureSelect(slotIndex) {
  if (slotIndex === 0) return elements.poseMetaGestureSelect0;
  if (slotIndex === 1) return elements.poseMetaGestureSelect1;
  return elements.poseMetaGestureSelect2;
}

function getPoseMetaGestureLabel(slotIndex) {
  if (slotIndex === 0) return elements.poseMetaGestureLabel0;
  if (slotIndex === 1) return elements.poseMetaGestureLabel1;
  return elements.poseMetaGestureLabel2;
}

function updatePoseMapLabels() {
  for (const slotIndex of [0, 1, 2]) {
    const labelElement = getPoseMapLabel(slotIndex);
    const altLabelElement = getPoseAltMapLabel(slotIndex);
    const metaLabelElement = getPoseMetaGestureLabel(slotIndex);
    const poseClass = getPoseClass(slotIndex);

    if (labelElement) {
      labelElement.textContent = `Pose ${slotIndex} (${poseClass.label})`;
    }

    if (altLabelElement) {
      altLabelElement.textContent = `Pose ${slotIndex} alt (+1) (${poseClass.label})`;
    }

    if (metaLabelElement) {
      metaLabelElement.textContent = `Pose ${slotIndex} meta gesture (${poseClass.label})`;
    }
  }
}

function renderHarborActionOptions() {
  for (const slotIndex of [0, 1, 2]) {
    const primarySelect = getPoseMapSelect(slotIndex);
    const altSelect = getPoseAltMapSelect(slotIndex);
    const metaSelect = getPoseMetaGestureSelect(slotIndex);
    if (!primarySelect && !altSelect && !metaSelect) {
      continue;
    }

    if (primarySelect) {
      primarySelect.innerHTML = "";
    }
    if (altSelect) {
      altSelect.innerHTML = "";
    }
    if (metaSelect) {
      metaSelect.innerHTML = "";
    }

    for (const action of HARBOR_ACTIONS) {
      if (primarySelect) {
        const option = document.createElement("option");
        option.value = action.id;
        option.textContent = action.label;
        primarySelect.appendChild(option);
      }

      if (altSelect) {
        const option = document.createElement("option");
        option.value = action.id;
        option.textContent = action.label;
        altSelect.appendChild(option);
      }
    }

    if (metaSelect) {
      for (const gesture of HARBOR_MODIFIER_GESTURES) {
        const option = document.createElement("option");
        option.value = gesture;
        option.textContent = gesture;
        metaSelect.appendChild(option);
      }
    }
  }

}

function formatCooldown(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function getExecutionSummary(execution = {}) {
  const settings = harborBridge.getSettings();
  const provider = execution.provider || settings.provider;
  const model = execution.model || settings.model;
  const safetyMode = execution.safetyMode || settings.safetyMode;
  const cooldownMs = Number.isFinite(execution.cooldownMs) ? execution.cooldownMs : settings.cooldownMs;

  return {
    provider,
    model,
    safetyMode,
    cooldownMs,
    armed: typeof execution.armed === "boolean" ? execution.armed : settings.armed,
  };
}

function syncSafetyUi(settings) {
  const cooldownMode = settings.safetyMode === "cooldown";

  elements.cooldownRange.disabled = !cooldownMode;
  elements.armCooldownToggle.disabled = !cooldownMode;
  if (elements.safetyCooldownGroup) {
    elements.safetyCooldownGroup.style.display = cooldownMode ? "" : "none";
  }
  if (elements.safetyArmGroup) {
    elements.safetyArmGroup.style.display = cooldownMode ? "" : "none";
  }
}

function renderHarborSettings(settings) {
  const safeSettings = normalizeHarborSettings(settings);

  for (const slotIndex of [0, 1, 2]) {
    const select = getPoseMapSelect(slotIndex);
    if (select) {
      select.value = safeSettings.mapping[slotIndex];
    }

    const altSelect = getPoseAltMapSelect(slotIndex);
    if (altSelect) {
      altSelect.value = safeSettings.modifier.perPoseAltAction[slotIndex];
    }

    const metaSelect = getPoseMetaGestureSelect(slotIndex);
    if (metaSelect) {
      metaSelect.value = safeSettings.modifier.perPoseGesture[slotIndex];
    }
  }

  elements.modifierEnabledToggle.checked = safeSettings.modifier.enabled;
  elements.harborProviderInput.value = safeSettings.provider;
  elements.harborModelInput.value = safeSettings.model;
  elements.askPromptTemplate.value = safeSettings.askPromptTemplate;
  elements.researchSourceCountInput.value = String(safeSettings.research.sourceCountDefault);
  elements.researchCloseTabsToggle.checked = safeSettings.research.closeTabsAfterRun;
  elements.researchQueryTemplate.value = safeSettings.research.queryTemplate;
  elements.elevenLabsAgentIdInput.value = safeSettings.elevenLabs.agentId;
  elements.elevenLabsVoiceIdInput.value = safeSettings.elevenLabs.voiceId;
  if (elements.remoteBridgeSessionInput) {
    elements.remoteBridgeSessionInput.value = safeSettings.remoteBridge.sessionId;
  }
  elements.safetyModeSelect.value = safeSettings.safetyMode;
  elements.cooldownRange.value = String(safeSettings.cooldownMs);
  elements.cooldownValue.textContent = formatCooldown(safeSettings.cooldownMs);
  elements.armCooldownToggle.checked = safeSettings.armed;

  syncSafetyUi(safeSettings);
  updatePoseMapLabels();
}

function readHarborSettingsFromUi() {
  const mapping = {
    0: getPoseMapSelect(0)?.value ?? "none",
    1: getPoseMapSelect(1)?.value ?? "none",
    2: getPoseMapSelect(2)?.value ?? "none",
  };

  const modifierMapping = {
    0: getPoseAltMapSelect(0)?.value ?? "none",
    1: getPoseAltMapSelect(1)?.value ?? "none",
    2: getPoseAltMapSelect(2)?.value ?? "none",
  };

  const modifierGesture = {
    0: getPoseMetaGestureSelect(0)?.value ?? "fist",
    1: getPoseMetaGestureSelect(1)?.value ?? "fist",
    2: getPoseMetaGestureSelect(2)?.value ?? "fist",
  };

  return normalizeHarborSettings({
    mapping,
    modifier: {
      enabled: elements.modifierEnabledToggle.checked,
      strategy: "secondary_hand",
      gesture: modifierGesture[0],
      perPoseGesture: modifierGesture,
      perPoseAltAction: modifierMapping,
    },
    research: {
      sourceCountDefault: Number.parseInt(elements.researchSourceCountInput.value, 10),
      closeTabsAfterRun: elements.researchCloseTabsToggle.checked,
      queryTemplate: elements.researchQueryTemplate.value,
    },
    elevenLabs: {
      agentId: elements.elevenLabsAgentIdInput.value,
      voiceId: elements.elevenLabsVoiceIdInput.value,
    },
    remoteBridge: {
      sessionId: elements.remoteBridgeSessionInput?.value || "default",
    },
    provider: elements.harborProviderInput.value,
    model: elements.harborModelInput.value,
    askPromptTemplate: elements.askPromptTemplate.value,
    safetyMode: elements.safetyModeSelect.value,
    cooldownMs: Number.parseInt(elements.cooldownRange.value, 10),
    armed: elements.armCooldownToggle.checked,
  });
}

function applyHarborSettingsFromUi(options = {}) {
  const { log = false } = options;
  const settings = readHarborSettingsFromUi();
  harborBridge.setSettings(settings);
  persistHarborSettings(settings);
  renderHarborSettings(settings);

  if (log) {
    appendLog(
      [
        `Updated Harbor mapping:`,
        `base[0]=${settings.mapping[0]}, base[1]=${settings.mapping[1]}, base[2]=${settings.mapping[2]}`,
        `alt[0]=${settings.modifier.perPoseAltAction[0]}, alt[1]=${settings.modifier.perPoseAltAction[1]}, alt[2]=${settings.modifier.perPoseAltAction[2]}`,
        `meta[0]=${settings.modifier.perPoseGesture[0]}, meta[1]=${settings.modifier.perPoseGesture[1]}, meta[2]=${settings.modifier.perPoseGesture[2]}`,
        `modifier=${settings.modifier.enabled ? "enabled" : "disabled"}`,
        `research_sources=${settings.research.sourceCountDefault}`,
        `safety=${settings.safetyMode}`,
        `remote_session=${settings.remoteBridge.sessionId}`,
        `model=${settings.provider}/${settings.model}`,
      ].join(" "),
    );
  }
}

function applyIntegrationPreset(presetId) {
  const preset = INTEGRATION_PRESETS[presetId];
  if (!preset) {
    appendLog(`Unknown preset: ${presetId}`, "error");
    return;
  }

  const base = harborBridge.getSettings();
  const merged = normalizeHarborSettings({
    ...base,
    mapping: {
      ...base.mapping,
      ...preset.mapping,
    },
    modifier: {
      ...base.modifier,
      enabled: preset.modifier.enabled,
      perPoseGesture: {
        ...base.modifier.perPoseGesture,
        ...preset.modifier.perPoseGesture,
      },
      perPoseAltAction: {
        ...base.modifier.perPoseAltAction,
        ...preset.modifier.perPoseAltAction,
      },
    },
  });

  harborBridge.setSettings(merged);
  persistHarborSettings(merged);
  renderHarborSettings(merged);

  const label = elements.integrationPresetSelect?.selectedOptions?.[0]?.textContent || presetId;
  appendLog(`Applied integration preset: ${label}`);
}

function setModelSelection(provider, model, logMessage) {
  elements.harborProviderInput.value = provider;
  elements.harborModelInput.value = model;
  applyHarborSettingsFromUi();
  if (logMessage) {
    appendLog(logMessage);
  }
}

function getPrimaryHand(hands) {
  if (!hands.length) {
    return null;
  }

  return [...hands].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
}

function getBestPoseMatch(hands) {
  const matches = hands.map((hand) => hand.poseMatch).filter(Boolean);
  if (!matches.length) {
    return null;
  }

  return matches.sort((a, b) => a.distance - b.distance)[0];
}

function defaultPoseMatchFromGestures(gestures) {
  const orderedClasses = [...POSE_CLASSES].sort((a, b) => a.slotIndex - b.slotIndex);
  for (const poseClass of orderedClasses) {
    if (!gestures.includes(poseClass.gesture)) {
      continue;
    }

    const resolvedPoseClass = getPoseClass(poseClass.slotIndex);
    if (!resolvedPoseClass) {
      continue;
    }

    return {
      slotIndex: poseClass.slotIndex,
      label: resolvedPoseClass.label,
      distance: 0,
      vectorDistance: 0,
      pairDistance: 0,
      sampleCount: poseLibrary.getSlot(poseClass.slotIndex)?.samples?.length ?? 0,
      source: "default-gesture",
    };
  }

  return null;
}

function updatePoseIndicator(match) {
  const indicator = elements.poseIndicator;
  if (!indicator) {
    return;
  }

  if (!match || ![0, 1, 2].includes(match.slotIndex)) {
    indicator.className = "pose-indicator pose-none";
    indicator.textContent = "-";
    indicator.title = "No pose match";
    return;
  }

  indicator.className = `pose-indicator pose-${match.slotIndex}`;
  indicator.textContent = String(match.slotIndex);
  const source = match.source || "unknown";
  const samples = Number.isFinite(match.sampleCount) ? ` | samples ${match.sampleCount}` : "";
  indicator.title = `pose ${match.slotIndex} (${match.label}) | dist ${match.distance} | ${source}${samples}`;
}

function setDefaultsRecordStatus(text) {
  if (elements.defaultsRecordStatus) {
    elements.defaultsRecordStatus.textContent = text;
  }
}

function setDefaultsCountdown(value) {
  const countdown = elements.defaultsCountdown;
  if (!countdown) {
    return;
  }

  if (value === null || value === undefined || value === "") {
    countdown.textContent = "";
    countdown.classList.add("hidden");
    return;
  }

  countdown.textContent = String(value);
  countdown.classList.remove("hidden");
}

function formatSnapshotReason(reason) {
  const text = String(reason || "saved");
  return text.replaceAll("-", " ").replaceAll(":", " ");
}

function formatSnapshotOption(snapshot) {
  const date = new Date(snapshot.createdAt);
  const timeLabel = Number.isNaN(date.getTime()) ? "unknown time" : date.toLocaleTimeString();
  const counts = Array.isArray(snapshot.sampleCounts)
    ? snapshot.sampleCounts.map((count, index) => `${index}:${count}`).join(" ")
    : "0:0 1:0 2:0";
  return `${timeLabel} · ${formatSnapshotReason(snapshot.reason)} · ${counts}`;
}

function renderDefaultsSnapshotOptions(selectedId = "") {
  if (!elements.defaultsSnapshotSelect) {
    return;
  }

  const snapshots = [...poseLibrary.listSnapshots()].sort((a, b) => b.createdAt - a.createdAt);
  elements.defaultsSnapshotSelect.innerHTML = "";

  if (!snapshots.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No snapshots yet";
    elements.defaultsSnapshotSelect.appendChild(option);
    return;
  }

  for (const snapshot of snapshots) {
    const option = document.createElement("option");
    option.value = snapshot.id;
    option.textContent = formatSnapshotOption(snapshot);
    elements.defaultsSnapshotSelect.appendChild(option);
  }

  const preferredId = selectedId || snapshots[0].id;
  const hasPreferred = snapshots.some((snapshot) => snapshot.id === preferredId);
  elements.defaultsSnapshotSelect.value = hasPreferred ? preferredId : snapshots[0].id;
}

function restoreSelectedDefaultsSnapshot() {
  if (!elements.defaultsSnapshotSelect) {
    return;
  }

  const snapshotId = elements.defaultsSnapshotSelect.value;
  if (!snapshotId) {
    setDefaultsRecordStatus("No snapshot selected.");
    return;
  }

  const restored = poseLibrary.restoreSnapshot(snapshotId);
  if (!restored) {
    setDefaultsRecordStatus("Snapshot could not be restored.");
    appendLog("Failed to restore pose snapshot.", "error");
    return;
  }

  renderPoseSlots();
  updateDefaultsSlotUi();
  renderDefaultsSnapshotOptions(snapshotId);
  setDefaultsRecordStatus("Snapshot restored. Continue recording or press Tab to move slots.");
  appendLog(`Restored pose snapshot ${snapshotId}.`);
}

function getPoseClass(slotIndex) {
  const basePoseClass = POSE_CLASS_BY_SLOT.get(slotIndex);
  const label = poseLibrary.getSlotLabel(slotIndex);
  if (basePoseClass) {
    return {
      ...basePoseClass,
      label,
    };
  }

  return {
    slotIndex,
    label,
    gesture: null,
    colorClass: "pose-none",
  };
}

function getDefaultClassSummary() {
  return [...POSE_CLASSES]
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map((poseClass) => {
      const resolved = getPoseClass(poseClass.slotIndex);
      return `${poseClass.slotIndex}=${resolved.label}`;
    })
    .join(", ");
}

function getSelectedDefaultsSlot() {
  return defaultsRecorder.selectedSlotIndex;
}

function setSelectedDefaultsSlot(slotIndex, options = {}) {
  const { announce = true } = options;
  if (!defaultsRecorder.slotOrder.includes(slotIndex)) {
    return;
  }

  defaultsRecorder.selectedSlotIndex = slotIndex;
  updateDefaultsSlotUi();
  if (defaultsRecorder.isOpen && elements.defaultsLabelInput) {
    elements.defaultsLabelInput.focus();
    elements.defaultsLabelInput.select();
  }

  if (announce) {
    const poseClass = getPoseClass(slotIndex);
    setDefaultsRecordStatus(
      `Pose ${slotIndex} (${poseClass.label}) selected. Press Enter to start capture. Press Enter again for samples. Press Tab for next pose.`,
    );
  }
}

function stepDefaultsSlot(direction = 1) {
  const slots = defaultsRecorder.slotOrder;
  const currentSlot = getSelectedDefaultsSlot();
  const currentIndex = Math.max(0, slots.indexOf(currentSlot));
  const nextIndex = (currentIndex + direction + slots.length) % slots.length;
  setSelectedDefaultsSlot(slots[nextIndex]);
}

function updateDefaultsActionButton() {
  if (!elements.defaultsActionBtn) {
    return;
  }

  if (defaultsRecorder.isCountdown) {
    elements.defaultsActionBtn.textContent = "Counting Down...";
    elements.defaultsActionBtn.disabled = true;
    return;
  }

  if (defaultsRecorder.isRecording) {
    elements.defaultsActionBtn.textContent = "Capture Sample (Enter)";
    elements.defaultsActionBtn.disabled = false;
    return;
  }

  elements.defaultsActionBtn.textContent = "Start Capture (Enter)";
  elements.defaultsActionBtn.disabled = false;
}

function updateDefaultsSlotUi() {
  const slotIndex = getSelectedDefaultsSlot();
  const poseClass = getPoseClass(slotIndex);
  const slot = poseLibrary.getSlot(slotIndex);
  const sampleCount = slot?.samples?.length ?? 0;

  if (elements.defaultsStep) {
    elements.defaultsStep.textContent = `Pose ${slotIndex + 1} / ${defaultsRecorder.slotOrder.length}`;
  }

  elements.defaultsSampleCount.textContent = String(sampleCount);
  elements.defaultsLabelInput.value = poseClass.label;
  elements.defaultsSlotHint.textContent = `Pose ${slotIndex}: ${poseClass.label}. Press Enter to start and capture. Press Tab to move to the next pose.`;
  updateDefaultsActionButton();
}

function saveSelectedSlotLabel(options = {}) {
  const { silent = false } = options;
  const slotIndex = getSelectedDefaultsSlot();
  const currentLabel = poseLibrary.getSlotLabel(slotIndex);
  const typedLabel = String(elements.defaultsLabelInput.value ?? "").trim();
  const nextLabel = typedLabel || currentLabel;

  if (nextLabel === currentLabel) {
    elements.defaultsLabelInput.value = currentLabel;
    return;
  }

  poseLibrary.setSlotLabel(slotIndex, nextLabel);
  renderPoseSlots();
  updateDefaultsSlotUi();
  renderDefaultsSnapshotOptions();
  if (!silent) {
    setDefaultsRecordStatus(`Pose ${slotIndex} renamed to "${nextLabel}".`);
  }
}

function renderTriggerList() {
  elements.triggerList.innerHTML = "";
  for (const trigger of TRIGGER_CONFIG) {
    const item = document.createElement("li");
    const source = Number.isInteger(trigger.poseSlot) ? `pose ${trigger.poseSlot}` : trigger.gesture;
    const fallbackAction = trigger.action?.defaultActionId ?? "none";
    item.textContent = `${trigger.id}: ${source} (${trigger.hand}), hold ${trigger.holdMs}ms, cooldown ${trigger.cooldownMs}ms, fallback ${fallbackAction}`;
    elements.triggerList.appendChild(item);
  }
}

function renderPoseSlots() {
  const poses = poseLibrary.list();
  elements.poseSlots.innerHTML = "";

  poses.forEach((slot, index) => {
    const poseClass = getPoseClass(index);
    const samples = slot?.samples ?? [];
    const latestSample = samples.length ? samples[samples.length - 1] : null;
    const sampleCount = samples.length;

    const card = document.createElement("article");
    card.className = "pose-slot";

    const canvas = document.createElement("canvas");
    canvas.width = 132;
    canvas.height = 86;
    drawStoredPosePreview({
      canvas,
      pose: latestSample,
      mirror: true,
    });

    const meta = document.createElement("div");
    meta.className = "pose-meta";

    if (!latestSample) {
      meta.textContent = `slot ${index} (${poseClass.label}): empty`;
    } else {
      const modelDelegate = latestSample.mediapipe?.delegate || "n/a";
      const captureDate = new Date(latestSample.capturedAt).toLocaleTimeString();
      meta.textContent = `slot ${index} (${poseClass.label}) · ${sampleCount} samples · ${latestSample.handedness} · ${modelDelegate} · ${captureDate}`;
    }

    card.appendChild(canvas);
    card.appendChild(meta);
    elements.poseSlots.appendChild(card);
  });

  updatePoseMapLabels();
}

function syncOverlaySize() {
  const { videoWidth, videoHeight } = elements.video;
  if (!videoWidth || !videoHeight) {
    return;
  }

  if (elements.overlay.width !== videoWidth || elements.overlay.height !== videoHeight) {
    elements.overlay.width = videoWidth;
    elements.overlay.height = videoHeight;
  }
}

function updateGestureSummary(hands) {
  if (!hands.length) {
    elements.gestureSummary.textContent = "none";
    return;
  }

  const summary = hands.map((hand) => {
    const gestures = hand.gestures.length ? hand.gestures.join("|") : "none";
    const matched = hand.poseMatch ? ` [${hand.poseMatch.slotIndex}]` : "";
    return `${hand.handedness}:${gestures}${matched}`;
  });

  elements.gestureSummary.textContent = summary.join(" / ");
}

function captureCurrentPose() {
  if (!running || !tracker) {
    appendLog("Start camera before capturing a pose.", "error");
    return;
  }

  const hand = getPrimaryHand(latestHands);
  if (!hand) {
    appendLog("No hand in preview. Hold a hand in frame and press Enter again.", "error");
    return;
  }

  const targetMatch = defaultPoseMatchFromGestures(hand.gestures);
  if (!targetMatch) {
    appendLog(`Pose must match one default class (${getDefaultClassSummary()}).`, "error");
    return;
  }

  const snapshot = poseLibrary.captureAt(targetMatch.slotIndex, hand, tracker.getRuntimeInfo());
  renderPoseSlots();
  updateDefaultsSlotUi();
  renderDefaultsSnapshotOptions();

  appendLog(
    `Captured slot ${snapshot.slotIndex} (${snapshot.label}) using ${snapshot.mediapipe?.delegate || "unknown"} delegate.`,
  );
}

function captureSampleForSelectedSlot() {
  if (!defaultsRecorder.isRecording) {
    return;
  }

  if (!running || !tracker) {
    setDefaultsRecordStatus("Camera is not running.");
    return;
  }

  const slotIndex = getSelectedDefaultsSlot();
  const poseClass = getPoseClass(slotIndex);
  const hand = getPrimaryHand(latestHands);

  if (!hand) {
    setDefaultsRecordStatus(`No hand found. Keep ${poseClass.label} in frame and press Enter again.`);
    return;
  }

  const snapshot = poseLibrary.captureAt(slotIndex, hand, tracker.getRuntimeInfo());
  renderPoseSlots();
  updateDefaultsSlotUi();
  renderDefaultsSnapshotOptions();

  const sampleCount = poseLibrary.getSlot(slotIndex)?.samples?.length ?? 0;
  setDefaultsRecordStatus(
    `Recording pose ${slotIndex} (${poseClass.label}). Captured sample ${sampleCount}. Press Enter for more or Tab for the next pose.`,
  );
  appendLog(`Recorded sample ${sampleCount} for slot ${slotIndex} (${snapshot.label}).`);
}

function stopDefaultsRecording(options = {}) {
  const { silent = false } = options;
  const wasActive = defaultsRecorder.isRecording || defaultsRecorder.isCountdown;

  defaultsRecorder.sessionToken += 1;
  defaultsRecorder.isRecording = false;
  defaultsRecorder.isCountdown = false;
  setDefaultsCountdown(null);
  updateDefaultsActionButton();

  if (!silent) {
    setDefaultsRecordStatus(wasActive ? "Recording stopped." : "Idle.");
  }
}

async function startDefaultsRecording() {
  if (!running || !tracker) {
    setDefaultsRecordStatus("Start camera before recording defaults.");
    appendLog("Cannot start default recording. Camera is not active.", "error");
    return;
  }

  const slotIndex = getSelectedDefaultsSlot();
  const poseClass = getPoseClass(slotIndex);

  defaultsRecorder.sessionToken += 1;
  const token = defaultsRecorder.sessionToken;

  defaultsRecorder.isCountdown = true;
  defaultsRecorder.isRecording = false;
  defaultsRecorder.guidedStarted = true;
  updateDefaultsActionButton();

  for (const n of [3, 2, 1]) {
    if (token !== defaultsRecorder.sessionToken) {
      setDefaultsCountdown(null);
      updateDefaultsActionButton();
      return;
    }
    setDefaultsCountdown(n);
    setDefaultsRecordStatus(`Pose ${slotIndex} (${poseClass.label}) starts in ${n}...`);
    await wait(1000);
  }

  if (token !== defaultsRecorder.sessionToken) {
    setDefaultsCountdown(null);
    updateDefaultsActionButton();
    return;
  }

  defaultsRecorder.isCountdown = false;
  defaultsRecorder.isRecording = true;
  setDefaultsCountdown(null);
  updateDefaultsActionButton();

  setDefaultsRecordStatus(
    `Recording pose ${slotIndex} (${poseClass.label}). Press Enter multiple times to add samples. Press Tab when ready for the next pose.`,
  );
}

function openDefaultsModal() {
  defaultsRecorder.isOpen = true;
  defaultsRecorder.guidedStarted = false;
  defaultsRecorder.selectedSlotIndex = 0;
  elements.defaultsModal.classList.remove("hidden");
  elements.defaultsModal.setAttribute("aria-hidden", "false");
  setDefaultsCountdown(null);
  updateDefaultsSlotUi();
  renderDefaultsSnapshotOptions();
  setDefaultsRecordStatus("Guided setup: press Enter to start pose 0. Press Tab to switch poses anytime.");
  elements.defaultsLabelInput.focus();
  elements.defaultsLabelInput.select();
}

function closeDefaultsModal() {
  saveSelectedSlotLabel({ silent: true });
  stopDefaultsRecording({ silent: true });
  defaultsRecorder.isOpen = false;
  defaultsRecorder.guidedStarted = false;
  elements.defaultsModal.classList.add("hidden");
  elements.defaultsModal.setAttribute("aria-hidden", "true");
  setDefaultsCountdown(null);
  updateDefaultsActionButton();
}

function handleDefaultsAction() {
  if (!defaultsRecorder.isOpen) {
    return;
  }

  if (defaultsRecorder.isCountdown) {
    return;
  }

  saveSelectedSlotLabel({ silent: true });

  if (defaultsRecorder.isRecording) {
    captureSampleForSelectedSlot();
    return;
  }

  void startDefaultsRecording();
}

async function copyHardcodedJson() {
  const exportString = poseLibrary.buildHardcodedExportString();

  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard API unavailable in this browser.");
    }

    await navigator.clipboard.writeText(exportString);
    appendLog("Copied hardcoded pose export to clipboard.");
  } catch (error) {
    appendLog(`Copy failed: ${error.message}`, "error");
  }
}

function buildTargetHelperSnippet() {
  const settings = harborBridge.getSettings();
  const sessionId = encodeURIComponent(settings.remoteBridge?.sessionId || "default");
  const helperUrl = `${window.location.origin}/src/integrations/target-helper.js?session=${sessionId}`;
  return [
    "(() => {",
    "  try {",
    "    if (window.__gestureTargetHelper && typeof window.__gestureTargetHelper.stop === 'function') {",
    "      window.__gestureTargetHelper.stop();",
    "    }",
    "    const oldScript = document.querySelector('script[data-gesture-target-helper=\"1\"]');",
    "    if (oldScript) oldScript.remove();",
    "    const script = document.createElement('script');",
    `    script.src = ${JSON.stringify(helperUrl)};`,
    "    script.async = true;",
    "    script.dataset.gestureTargetHelper = '1';",
    "    (document.head || document.documentElement).appendChild(script);",
    "  } catch (error) {",
    "    console.error('Failed to install target helper', error);",
    "  }",
    "})();",
  ].join("\n");
}

async function copyTargetHelperSnippet() {
  const snippet = buildTargetHelperSnippet();
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard API unavailable in this browser.");
    }
    await navigator.clipboard.writeText(snippet);
    appendLog("Copied target helper snippet. Paste it in the target tab DevTools console.");
  } catch (error) {
    appendLog(`Failed to copy target helper snippet: ${error.message}`, "error");
  }
}

async function startCamera() {
  if (running) {
    return;
  }

  elements.startBtn.disabled = true;

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia is not available in this browser.");
    }

    setStatus("Requesting camera...");

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    elements.video.srcObject = stream;
    await elements.video.play();
    syncOverlaySize();

    setStatus("Loading MediaPipe model...");

    tracker = new MediapipeHandTracker();
    await tracker.init();

    running = true;
    elements.stopBtn.disabled = false;
    setStatus("Running");

    appendLog("Camera started. Gesture detection is live.");
    frameId = requestAnimationFrame(loop);
  } catch (error) {
    appendLog(`Failed to start: ${error.message}`, "error");
    setStatus(`Error: ${error.message}`, true);

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }

    if (tracker) {
      tracker.close();
      tracker = null;
    }

    running = false;
    elements.stopBtn.disabled = true;
    elements.startBtn.disabled = false;
  }
}

function stopCamera() {
  if (!running && !stream) {
    return;
  }

  stopDefaultsRecording({ silent: true });

  running = false;
  cancelAnimationFrame(frameId);

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  if (tracker) {
    tracker.close();
    tracker = null;
  }

  latestHands = [];

  drawOverlay({ canvas: elements.overlay, hands: [], mirror: true });
  updatePoseIndicator(null);

  drawLivePosePreview({
    canvas: elements.posePreview,
    video: elements.video,
    hand: null,
    mirror: true,
  });

  drawLivePosePreview({
    canvas: elements.defaultsPreview,
    video: elements.video,
    hand: null,
    mirror: true,
    drawSkeleton: true,
  });
  setDefaultsCountdown(null);

  updateGestureSummary([]);

  elements.stopBtn.disabled = true;
  elements.startBtn.disabled = false;

  setStatus("Stopped");
  appendLog("Camera stopped.");
}

function loop(timestamp) {
  if (!running || !tracker) {
    return;
  }

  syncOverlaySize();

  const detectedHands = tracker.detect(elements.video, timestamp);

  const hands = detectedHands.map((hand) => {
    const classification = classifyHandGestures(hand.landmarks, hand.handedness);
    const poseFeatures = estimatePoseFeatures(hand.landmarks);

    const enriched = {
      ...hand,
      ...classification,
      poseFeatures,
    };

    const savedTemplateMatch = poseLibrary.matchHand(enriched);
    const fallbackMatch = defaultPoseMatchFromGestures(classification.gestures);

    return {
      ...enriched,
      poseMatch: savedTemplateMatch ?? fallbackMatch,
    };
  });

  latestHands = hands;
  const bestPoseMatch = getBestPoseMatch(hands);

  triggerEngine.processFrame({
    timestamp,
    hands,
  });

  drawOverlay({
    canvas: elements.overlay,
    hands,
    mirror: true,
  });

  const primaryHand = getPrimaryHand(hands);

  drawLivePosePreview({
    canvas: elements.posePreview,
    video: elements.video,
    hand: primaryHand,
    mirror: true,
  });

  if (defaultsRecorder.isOpen) {
    drawLivePosePreview({
      canvas: elements.defaultsPreview,
      video: elements.video,
      hand: primaryHand,
      mirror: true,
      drawSkeleton: true,
    });
  }

  updatePoseIndicator(bestPoseMatch);
  updateGestureSummary(hands);

  frameId = requestAnimationFrame(loop);
}

function handleKeyDown(event) {
  if (event.key === "Escape" && defaultsRecorder.isOpen) {
    event.preventDefault();
    closeDefaultsModal();
    return;
  }

  if (defaultsRecorder.isOpen && event.key === "Tab") {
    event.preventDefault();

    if (defaultsRecorder.isCountdown) {
      return;
    }

    saveSelectedSlotLabel({ silent: true });
    stepDefaultsSlot(event.shiftKey ? -1 : 1);
    return;
  }

  if (event.key !== "Enter" || event.repeat) {
    return;
  }

  event.preventDefault();

  if (defaultsRecorder.isOpen) {
    const targetId = event.target?.id;

    if (targetId === "closeDefaultsBtn") {
      closeDefaultsModal();
      return;
    }

    if (targetId === "defaultsRestoreSnapshotBtn" || targetId === "defaultsSnapshotSelect") {
      restoreSelectedDefaultsSnapshot();
      return;
    }

    handleDefaultsAction();
    return;
  }

  const tagName = event.target?.tagName;
  const editable = event.target?.isContentEditable;
  if (tagName === "INPUT" || tagName === "TEXTAREA" || editable) {
    return;
  }

  captureCurrentPose();
}

eventBus.on("trigger:fired", (event) => {
  const { trigger, hand, heldMs } = event.detail;
  const source = Number.isInteger(trigger.poseSlot) ? `pose ${trigger.poseSlot}` : trigger.gesture;
  const matched = hand?.poseMatch ? ` match=${hand.poseMatch.slotIndex}` : "";
  appendLog(`Fired ${trigger.id} via ${source} (${hand.handedness}, held ${Math.round(heldMs)}ms).${matched}`);
});

eventBus.on("trigger:dispatched", (event) => {
  const payload = event.detail;
  const poseSuffix = Number.isInteger(payload.pose?.slotIndex) ? ` pose=${payload.pose.slotIndex}` : "";
  const modifierSuffix = payload.modifier?.detected
    ? ` modifier=${payload.modifier.gesture}(${payload.modifier.handedness || "unknown"})`
    : "";
  appendLog(`Dispatched harbor:gesture-trigger for ${payload.triggerId}.${poseSuffix}${modifierSuffix}`);
});

eventBus.on("trigger:dispatch-error", (event) => {
  const message = event.detail?.error?.message || "Unknown dispatch error";
  appendLog(`Dispatch error: ${message}`, "error");
});

eventBus.on("pose:sample-captured", (event) => {
  const { slotIndex, sampleCount, snapshot } = event.detail;
  renderDefaultsSnapshotOptions();
  appendLog(
    `Saved sample ${sampleCount} for slot ${slotIndex} (${snapshot.label}). Estimation logic: ${snapshot.estimation?.logic}.`,
  );
});

eventBus.on("pose:slot-cleared", (event) => {
  renderDefaultsSnapshotOptions();
  appendLog(`Cleared slot ${event.detail.slotIndex}.`);
});

eventBus.on("pose:label-updated", (event) => {
  renderDefaultsSnapshotOptions();
  appendLog(`Renamed slot ${event.detail.slotIndex} to "${event.detail.label}".`);
  updatePoseMapLabels();
});

eventBus.on("pose:snapshot-restored", (event) => {
  const snapshotId = event.detail?.snapshot?.id || "unknown";
  renderDefaultsSnapshotOptions(snapshotId);
});

eventBus.on("harbor:bridge-status", (event) => {
  const { message, type } = event.detail;
  setHarborBridgeStatus(message, type === "error" ? "error" : "ok");
});

eventBus.on("harbor:bridge-skipped", (event) => {
  const { poseSlot, actionId, reason, execution } = event.detail;
  const exec = getExecutionSummary(execution);
  const slotText = Number.isInteger(poseSlot) ? `pose ${poseSlot}` : "unknown pose";
  appendLog(
    `Skipped ${actionId} for ${slotText}: ${reason} [model ${exec.provider}/${exec.model}, safety ${exec.safetyMode}]`,
  );
});

eventBus.on("harbor:bridge-result", (event) => {
  const { poseSlot, actionId, baseActionId, output, meta, modifier, execution } = event.detail;
  const exec = getExecutionSummary(execution);
  const preview = String(output || "").replace(/\s+/g, " ").trim().slice(0, 220);
  const title = meta?.pageTitle ? ` (${meta.pageTitle})` : "";
  const baseTag = baseActionId && baseActionId !== actionId ? ` (base ${baseActionId})` : "";
  const modifierTag = modifier?.detected ? ` via ${modifier.gesture}` : "";
  const sourcesTag = Number.isInteger(meta?.sourceCountRead)
    ? ` [sources ${meta.sourceCountRead}/${meta.sourceCountRequested}]`
    : "";
  const ttsFallbackTag = meta?.voiceFallback ? " [tts fallback]" : "";
  const modelTag = ` [${exec.provider}/${exec.model}]`;
  setHarborLastResult(
    `Pose ${poseSlot} -> ${actionId}${baseTag}: ${preview || "no output"}${title}${sourcesTag}${ttsFallbackTag}${modelTag}`,
  );
  appendLog(
    `Completed Harbor action ${actionId} for pose ${poseSlot}${modifierTag}.${sourcesTag}${ttsFallbackTag} [model ${exec.provider}/${exec.model}, safety ${exec.safetyMode}]`,
  );
});

eventBus.on("harbor:bridge-error", (event) => {
  const { poseSlot, actionId, baseActionId, modifier, error, execution } = event.detail;
  const exec = getExecutionSummary(execution);
  const message = error?.message || "Unknown error";
  const baseTag = baseActionId && baseActionId !== actionId ? ` (base ${baseActionId})` : "";
  const modifierTag = modifier?.detected ? ` via ${modifier.gesture}` : "";
  setHarborLastResult(
    `Pose ${poseSlot} -> ${actionId}${baseTag} failed: ${message} [${exec.provider}/${exec.model}]`,
    "error",
  );
  appendLog(
    `Harbor action ${actionId} failed for pose ${poseSlot}${modifierTag}: ${message} [model ${exec.provider}/${exec.model}, safety ${exec.safetyMode}]`,
    "error",
  );
});

window.addEventListener("resize", syncOverlaySize);
window.addEventListener("beforeunload", () => {
  stopCamera();
  harborBridge.stop();
});
window.addEventListener("keydown", handleKeyDown);

elements.startBtn.addEventListener("click", () => {
  void startCamera();
});

elements.stopBtn.addEventListener("click", stopCamera);

elements.clearPosesBtn.addEventListener("click", () => {
  poseLibrary.clearAll();
  renderPoseSlots();
  updateDefaultsSlotUi();
  renderDefaultsSnapshotOptions();
  appendLog("Cleared all saved poses.");
});

elements.copyPosesBtn.addEventListener("click", () => {
  void copyHardcodedJson();
});

elements.openDefaultsBtn.addEventListener("click", openDefaultsModal);

elements.closeDefaultsBtn.addEventListener("click", closeDefaultsModal);

elements.defaultsActionBtn.addEventListener("click", () => {
  handleDefaultsAction();
});

elements.defaultsLabelInput.addEventListener("change", () => {
  saveSelectedSlotLabel({ silent: true });
});

elements.defaultsSnapshotSelect?.addEventListener("change", () => {
  setDefaultsRecordStatus("Snapshot selected. Press Restore Snapshot to roll back.");
});

elements.defaultsRestoreSnapshotBtn?.addEventListener("click", () => {
  restoreSelectedDefaultsSnapshot();
});

for (const slotIndex of [0, 1, 2]) {
  getPoseMapSelect(slotIndex)?.addEventListener("change", () => {
    applyHarborSettingsFromUi();
  });

  getPoseAltMapSelect(slotIndex)?.addEventListener("change", () => {
    applyHarborSettingsFromUi();
  });

  getPoseMetaGestureSelect(slotIndex)?.addEventListener("change", () => {
    applyHarborSettingsFromUi();
  });
}

elements.modifierEnabledToggle.addEventListener("change", () => {
  applyHarborSettingsFromUi();
});

elements.harborProviderInput.addEventListener("change", () => {
  applyHarborSettingsFromUi();
});

elements.harborModelInput.addEventListener("change", () => {
  applyHarborSettingsFromUi();
});

elements.usePhiFallbackBtn.addEventListener("click", () => {
  setModelSelection("ollama", "phi3.5", "Switched model to phi3.5 fallback.");
});

elements.askPromptTemplate.addEventListener("change", () => {
  applyHarborSettingsFromUi();
});

elements.researchSourceCountInput.addEventListener("change", () => {
  applyHarborSettingsFromUi();
});

elements.researchCloseTabsToggle.addEventListener("change", () => {
  applyHarborSettingsFromUi();
});

elements.researchQueryTemplate.addEventListener("change", () => {
  applyHarborSettingsFromUi();
});

elements.elevenLabsAgentIdInput.addEventListener("change", () => {
  applyHarborSettingsFromUi();
});

elements.elevenLabsVoiceIdInput.addEventListener("change", () => {
  applyHarborSettingsFromUi();
});

elements.remoteBridgeSessionInput?.addEventListener("change", () => {
  applyHarborSettingsFromUi();
});

elements.safetyModeSelect.addEventListener("change", () => {
  applyHarborSettingsFromUi();
});

elements.cooldownRange.addEventListener("input", () => {
  const ms = Number.parseInt(elements.cooldownRange.value, 10);
  elements.cooldownValue.textContent = formatCooldown(Number.isFinite(ms) ? ms : 0);
});

elements.cooldownRange.addEventListener("change", () => {
  applyHarborSettingsFromUi();
});

elements.armCooldownToggle.addEventListener("change", () => {
  applyHarborSettingsFromUi();
});

elements.saveIntegrationBtn.addEventListener("click", () => {
  applyHarborSettingsFromUi({ log: true });
});

elements.applyIntegrationPresetBtn?.addEventListener("click", () => {
  const presetId = elements.integrationPresetSelect?.value || "hackathon_combo";
  applyIntegrationPreset(presetId);
});

elements.checkHarborBtn.addEventListener("click", () => {
  void harborBridge.checkAvailability();
});

elements.copyTargetHelperSnippetBtn?.addEventListener("click", () => {
  void copyTargetHelperSnippet();
});

renderHarborActionOptions();
renderHarborSettings(harborBridge.getSettings());
renderTriggerList();
renderPoseSlots();
updatePoseIndicator(null);
updateDefaultsSlotUi();
renderDefaultsSnapshotOptions();
drawLivePosePreview({
  canvas: elements.posePreview,
  video: elements.video,
  hand: null,
  mirror: true,
});

drawLivePosePreview({
  canvas: elements.defaultsPreview,
  video: elements.video,
  hand: null,
  mirror: true,
  drawSkeleton: true,
});

setStatus("Idle");
setDefaultsCountdown(null);
setDefaultsRecordStatus("Press Settings, then Enter to start pose capture.");
setHarborBridgeStatus("Integration ready. Configure mapping and check Harbor APIs.");
setHarborLastResult("No action result yet.");
appendLog("Ready. Start camera to begin gesture tracking.");
appendLog(`Defaults: ${getDefaultClassSummary()}. Press Enter to capture.`);
appendLog("Use Settings for guided defaults capture. Enter captures, Tab switches pose.");
appendLog("Settings now support per-pose meta gestures and snapshot restore of full keypoints.");
appendLog("Execution safety is above the camera. Default model is ollama/llama3.2; use Phi fallback if needed.");
void harborBridge.checkAvailability();
