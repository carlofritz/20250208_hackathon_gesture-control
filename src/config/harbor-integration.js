export const HARBOR_SETTINGS_STORAGE_KEY = "gesture-control.harbor-settings.v2";

export const HARBOR_ACTIONS = [
  {
    id: "none",
    label: "No action",
    description: "Do not run any SDK action.",
    requiredScopes: [],
    requiresBrowserApi: false,
  },
  {
    id: "read_summarize",
    label: "Read page + summarize",
    description: "Read active tab content and summarize via model.",
    requiredScopes: ["model:prompt", "browser:activeTab.read"],
    requiresBrowserApi: true,
  },
  {
    id: "screenshot_analyze",
    label: "Screenshot + summarize",
    description: "Capture screenshot and produce quick page brief.",
    requiredScopes: ["model:prompt", "browser:activeTab.screenshot", "browser:activeTab.read"],
    requiresBrowserApi: true,
  },
  {
    id: "screenshot_analyze_alt",
    label: "Screenshot + risk scan (alt)",
    description: "Capture screenshot and run stricter risk-focused analysis.",
    requiredScopes: ["model:prompt", "browser:activeTab.screenshot", "browser:activeTab.read"],
    requiresBrowserApi: true,
  },
  {
    id: "research_agent",
    label: "Research agent",
    description: "Open search/results tabs and synthesize cited findings.",
    requiredScopes: ["model:prompt", "browser:activeTab.read", "browser:tabs.create", "browser:tabs.read"],
    requiresBrowserApi: true,
  },
  {
    id: "research_agent_alt",
    label: "Research agent (alt)",
    description: "Run deeper research mode with broader synthesis.",
    requiredScopes: ["model:prompt", "browser:activeTab.read", "browser:tabs.create", "browser:tabs.read"],
    requiresBrowserApi: true,
  },
  {
    id: "agent_run_brief",
    label: "Agent run brief",
    description: "Use agent.run() to produce a concise, tool-capable answer.",
    requiredScopes: ["model:tools", "model:prompt"],
    requiresBrowserApi: false,
  },
  {
    id: "remote_read_screenshot_summarize",
    label: "Remote tab summarize",
    description: "Dispatch read+screenshot+summary to a target tab helper session.",
    requiredScopes: [],
    requiresBrowserApi: false,
  },
  {
    id: "mcp_fetch_brief",
    label: "MCP fetch + brief",
    description: "Read current page URL/title, fetch related content via MCP, and summarize.",
    requiredScopes: ["mcp:tools.call", "browser:activeTab.read"],
    requiresBrowserApi: true,
  },
  {
    id: "mcp_memory_save",
    label: "MCP memory save",
    description: "Persist current page context into MCP memory.",
    requiredScopes: ["mcp:tools.call", "browser:activeTab.read"],
    requiresBrowserApi: true,
  },
  {
    id: "mcp_memory_recall",
    label: "MCP memory recall",
    description: "Recall related memory entries for current page context.",
    requiredScopes: ["mcp:tools.call", "browser:activeTab.read"],
    requiresBrowserApi: true,
  },
  {
    id: "mcp_filesystem_log",
    label: "MCP filesystem log",
    description: "Append a local log line for the current page using filesystem MCP.",
    requiredScopes: ["mcp:tools.call", "browser:activeTab.read"],
    requiresBrowserApi: true,
  },
  {
    id: "mcp_filesystem_nested_workflow",
    label: "MCP filesystem workflow",
    description: "Run nested workflow steps via filesystem MCP: read state, append event, update next-step files.",
    requiredScopes: ["mcp:tools.call", "browser:activeTab.read"],
    requiresBrowserApi: true,
  },
  {
    id: "mcp_calendar_next",
    label: "MCP calendar next",
    description: "Read upcoming events through an MCP calendar server (e.g. CalDAV).",
    requiredScopes: ["mcp:tools.call"],
    requiresBrowserApi: false,
  },
  {
    id: "voice_tts_ping",
    label: "Voice TTS ping",
    description: "Speak a short confirmation through ElevenLabs TTS.",
    requiredScopes: [],
    requiresBrowserApi: false,
  },
  {
    id: "voice_transcribe_note",
    label: "Voice STT note",
    description: "Record a short mic note and transcribe it with ElevenLabs STT.",
    requiredScopes: [],
    requiresBrowserApi: false,
  },
  {
    id: "conversation_site_brief",
    label: "Site conversation brief",
    description: "Read page, generate concise answer, and speak with ElevenLabs TTS.",
    requiredScopes: ["model:prompt", "browser:activeTab.read"],
    requiresBrowserApi: true,
  },
  {
    id: "conversation_live_elevenlabs",
    label: "Live ElevenLabs conversation",
    description: "Open ElevenLabs live voice conversation (adds page context when Harbor APIs are available).",
    requiredScopes: [],
    requiresBrowserApi: false,
  },
  {
    id: "ask_model",
    label: "Ask model",
    description: "Run custom prompt template against the active context.",
    requiredScopes: ["model:prompt"],
    requiresBrowserApi: false,
  },
];

export const HARBOR_ACTION_BY_ID = new Map(HARBOR_ACTIONS.map((action) => [action.id, action]));

export const HARBOR_MODIFIER_GESTURES = ["fist", "pinch", "open_palm", "thumbs_up", "victory"];

export const DEFAULT_HARBOR_SETTINGS = {
  mapping: {
    0: "read_summarize",
    1: "screenshot_analyze",
    2: "conversation_site_brief",
  },
  modifier: {
    enabled: true,
    strategy: "secondary_hand",
    gesture: "fist",
    perPoseGesture: {
      0: "fist",
      1: "pinch",
      2: "fist",
    },
    perPoseAltAction: {
      0: "research_agent_alt",
      1: "screenshot_analyze_alt",
      2: "conversation_live_elevenlabs",
    },
  },
  research: {
    sourceCountDefault: 5,
    closeTabsAfterRun: true,
    searchEngineUrlTemplate: "https://www.google.com/search?q={{query}}",
    queryTemplate: "Research this topic and summarize with citations: {{pageTitle}}",
  },
  elevenLabs: {
    agentId: "",
    voiceId: "",
  },
  remoteBridge: {
    sessionId: "default",
  },
  safetyMode: "confirm_each",
  cooldownMs: 2000,
  armed: false,
  provider: "ollama",
  model: "llama3.2",
  askPromptTemplate:
    "Pose {{poseId}} ({{poseLabel}}) fired on {{pageTitle}}. Give a concise action recommendation and why.",
};

function normalizeMode(mode) {
  return mode === "cooldown" ? "cooldown" : "confirm_each";
}

function normalizeAction(actionId) {
  if (HARBOR_ACTION_BY_ID.has(actionId)) {
    return actionId;
  }
  return "none";
}

function normalizeMapping(mapping = {}) {
  return {
    0: normalizeAction(mapping[0] ?? mapping["0"] ?? DEFAULT_HARBOR_SETTINGS.mapping[0]),
    1: normalizeAction(mapping[1] ?? mapping["1"] ?? DEFAULT_HARBOR_SETTINGS.mapping[1]),
    2: normalizeAction(mapping[2] ?? mapping["2"] ?? DEFAULT_HARBOR_SETTINGS.mapping[2]),
  };
}

function normalizeModifierGesture(gesture) {
  const value = String(gesture || "").trim();
  if (HARBOR_MODIFIER_GESTURES.includes(value)) {
    return value;
  }
  return DEFAULT_HARBOR_SETTINGS.modifier.gesture;
}

function normalizeModifierStrategy(strategy) {
  return strategy === "secondary_hand" ? strategy : "secondary_hand";
}

function normalizeModifierPerPoseAltAction(mapping = {}) {
  return {
    0: normalizeAction(
      mapping[0] ?? mapping["0"] ?? DEFAULT_HARBOR_SETTINGS.modifier.perPoseAltAction[0],
    ),
    1: normalizeAction(
      mapping[1] ?? mapping["1"] ?? DEFAULT_HARBOR_SETTINGS.modifier.perPoseAltAction[1],
    ),
    2: normalizeAction(
      mapping[2] ?? mapping["2"] ?? DEFAULT_HARBOR_SETTINGS.modifier.perPoseAltAction[2],
    ),
  };
}

function normalizeModifierPerPoseGesture(mapping = {}, fallbackGesture) {
  return {
    0: normalizeModifierGesture(
      mapping[0] ?? mapping["0"] ?? DEFAULT_HARBOR_SETTINGS.modifier.perPoseGesture[0] ?? fallbackGesture,
    ),
    1: normalizeModifierGesture(
      mapping[1] ?? mapping["1"] ?? DEFAULT_HARBOR_SETTINGS.modifier.perPoseGesture[1] ?? fallbackGesture,
    ),
    2: normalizeModifierGesture(
      mapping[2] ?? mapping["2"] ?? DEFAULT_HARBOR_SETTINGS.modifier.perPoseGesture[2] ?? fallbackGesture,
    ),
  };
}

function normalizeModifier(raw = {}) {
  const gesture = normalizeModifierGesture(raw.gesture);
  const perPoseGesture = normalizeModifierPerPoseGesture(raw.perPoseGesture, gesture);

  return {
    enabled: raw.enabled !== false,
    strategy: normalizeModifierStrategy(raw.strategy),
    gesture,
    perPoseGesture,
    perPoseAltAction: normalizeModifierPerPoseAltAction(raw.perPoseAltAction),
  };
}

function normalizeResearch(raw = {}) {
  const sourceCountRaw = Number.parseInt(raw.sourceCountDefault, 10);
  const sourceCountDefault = Number.isFinite(sourceCountRaw)
    ? Math.max(1, Math.min(8, sourceCountRaw))
    : DEFAULT_HARBOR_SETTINGS.research.sourceCountDefault;

  const searchEngineUrlTemplate =
    typeof raw.searchEngineUrlTemplate === "string" && raw.searchEngineUrlTemplate.trim()
      ? raw.searchEngineUrlTemplate.trim()
      : DEFAULT_HARBOR_SETTINGS.research.searchEngineUrlTemplate;

  const queryTemplate =
    typeof raw.queryTemplate === "string" && raw.queryTemplate.trim()
      ? raw.queryTemplate.trim()
      : DEFAULT_HARBOR_SETTINGS.research.queryTemplate;

  return {
    sourceCountDefault,
    closeTabsAfterRun: raw.closeTabsAfterRun !== false,
    searchEngineUrlTemplate,
    queryTemplate,
  };
}

function normalizeElevenLabs(raw = {}) {
  const agentId = typeof raw.agentId === "string" ? raw.agentId.trim() : "";
  const voiceId = typeof raw.voiceId === "string" ? raw.voiceId.trim() : "";
  return {
    agentId,
    voiceId,
  };
}

function normalizeRemoteBridge(raw = {}) {
  const sessionIdRaw = typeof raw.sessionId === "string" ? raw.sessionId.trim() : "";
  const cleaned = sessionIdRaw.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64);
  return {
    sessionId: cleaned || DEFAULT_HARBOR_SETTINGS.remoteBridge.sessionId,
  };
}

export function normalizeHarborSettings(raw = {}) {
  const cooldownRaw = Number.parseInt(raw.cooldownMs, 10);
  const cooldownMs = Number.isFinite(cooldownRaw)
    ? Math.max(0, Math.min(5000, cooldownRaw))
    : DEFAULT_HARBOR_SETTINGS.cooldownMs;

  const provider = typeof raw.provider === "string" && raw.provider.trim()
    ? raw.provider.trim()
    : DEFAULT_HARBOR_SETTINGS.provider;

  const model = typeof raw.model === "string" && raw.model.trim()
    ? raw.model.trim()
    : DEFAULT_HARBOR_SETTINGS.model;

  const askPromptTemplate = typeof raw.askPromptTemplate === "string" && raw.askPromptTemplate.trim()
    ? raw.askPromptTemplate.trim()
    : DEFAULT_HARBOR_SETTINGS.askPromptTemplate;

  return {
    mapping: normalizeMapping(raw.mapping),
    modifier: normalizeModifier(raw.modifier),
    research: normalizeResearch(raw.research),
    elevenLabs: normalizeElevenLabs(raw.elevenLabs),
    remoteBridge: normalizeRemoteBridge(raw.remoteBridge),
    safetyMode: normalizeMode(raw.safetyMode),
    cooldownMs,
    armed: Boolean(raw.armed),
    provider,
    model,
    askPromptTemplate,
  };
}
