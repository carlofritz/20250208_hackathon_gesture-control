import { HARBOR_ACTION_BY_ID, normalizeHarborSettings } from "../config/harbor-integration.js";

const BLOCKED_RESEARCH_HOSTS = [
  "google.com",
  "googleapis.com",
  "googleusercontent.com",
  "gstatic.com",
  "youtube.com",
  "youtu.be",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
];

const VOICE_LOCAL_ACTION_IDS = new Set([
  "voice_tts_ping",
  "voice_transcribe_note",
  "conversation_live_elevenlabs",
]);
const REMOTE_ACTION_IDS = new Set([
  "remote_read_screenshot_summarize",
]);
const MCP_ACTION_IDS = new Set([
  "mcp_fetch_brief",
  "mcp_memory_save",
  "mcp_memory_recall",
  "mcp_filesystem_log",
  "mcp_filesystem_nested_workflow",
  "mcp_calendar_next",
]);
const ELEVENLABS_HELLO_WORLD_TEXT = "Hello world.";
const REMOTE_BRIDGE_COMMAND_TIMEOUT_MS = 15000;

function truncate(text, max = 2000) {
  const safeText = String(text || "");
  if (safeText.length <= max) {
    return safeText;
  }
  return `${safeText.slice(0, max)}...`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function humanDuration(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function normalizeHand(handedness) {
  const lower = String(handedness || "").toLowerCase();
  if (lower.includes("left")) return "left";
  if (lower.includes("right")) return "right";
  return "unknown";
}

function replaceTemplate(template, values) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return String(values[key] ?? "");
    }
    return "";
  });
}

function permissionGranted(value) {
  return value === "granted-once" || value === "granted-always";
}

function isGoogleLikeHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host) return true;
  return BLOCKED_RESEARCH_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function normalizeSearchUrl(rawUrl) {
  const cleaned = String(rawUrl || "").replaceAll("&amp;", "&").trim();
  if (!cleaned.startsWith("http")) {
    return "";
  }

  try {
    const parsed = new URL(cleaned);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }

    if (isGoogleLikeHost(parsed.hostname)) {
      return "";
    }

    if (cleaned.includes("/aclk?") || cleaned.includes("doubleclick") || cleaned.includes("googleadservices")) {
      return "";
    }

    return parsed.toString();
  } catch {
    return "";
  }
}

function extractUrlsFromHtml(html) {
  const source = String(html || "");
  const urls = [];
  const regex = /href="(https?:\/\/[^"#]+)"/gi;
  let match = null;

  while ((match = regex.exec(source)) !== null) {
    const normalized = normalizeSearchUrl(match[1]);
    if (!normalized) {
      continue;
    }
    urls.push(normalized);
  }

  return [...new Set(urls)];
}

function parseJsonArrayFromText(input) {
  const text = String(input || "");
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    return [];
  }

  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getPageTitle(page) {
  return page?.title || document.title || "Untitled page";
}

function getPageText(page) {
  const candidate = page?.text || page?.textContent || page?.content || "";
  return String(candidate || "");
}

function deriveSignedUrl(payload = {}) {
  return payload?.signed_url || payload?.signedUrl || payload?.url || "";
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(String(reader.result || ""));
    };
    reader.onerror = () => {
      reject(new Error("Failed to encode audio payload."));
    };
    reader.readAsDataURL(blob);
  });
}

function toolResultPreview(result, max = 1400) {
  if (typeof result === "string") {
    return truncate(result, max);
  }
  return truncate(JSON.stringify(result, null, 2), max);
}

export class HarborSdkBridge {
  constructor(options = {}) {
    this.eventBus = options.eventBus ?? null;
    this.getPoseLabel = typeof options.getPoseLabel === "function"
      ? options.getPoseLabel
      : (slotIndex) => `pose_${slotIndex}`;

    this.settings = normalizeHarborSettings(options.settings ?? {});
    this.session = null;
    this.sessionKey = "";
    this.inFlight = false;
    this.lastRunAt = new Map();
    this.currentAudio = null;
    this.onTriggerBound = (event) => {
      void this.handleTriggerEvent(event);
    };
    this.started = false;
  }

  start() {
    if (this.started) {
      return;
    }
    window.addEventListener("harbor:gesture-trigger", this.onTriggerBound);
    this.started = true;
    this.emitStatus("Listening for harbor:gesture-trigger events.");
  }

  stop() {
    if (this.started) {
      window.removeEventListener("harbor:gesture-trigger", this.onTriggerBound);
      this.started = false;
    }

    if (this.session && typeof this.session.destroy === "function") {
      this.session.destroy();
    }

    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }

    this.session = null;
    this.sessionKey = "";
  }

  setSettings(nextSettings = {}) {
    const previousKey = `${this.settings.provider}::${this.settings.model}`;
    this.settings = normalizeHarborSettings(nextSettings);
    const nextKey = `${this.settings.provider}::${this.settings.model}`;

    if (nextKey !== previousKey && this.session && typeof this.session.destroy === "function") {
      this.session.destroy();
      this.session = null;
      this.sessionKey = "";
    }

    this.emitState();
  }

  getSettings() {
    return normalizeHarborSettings(this.settings);
  }

  getExecutionSnapshot() {
    return {
      provider: this.settings.provider,
      model: this.settings.model,
      safetyMode: this.settings.safetyMode,
      cooldownMs: this.settings.cooldownMs,
      armed: this.settings.armed,
    };
  }

  getRemoteBridgeSessionId() {
    const sessionId = this.settings?.remoteBridge?.sessionId;
    const normalized = String(sessionId || "").trim().replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64);
    return normalized || "default";
  }

  async checkAvailability() {
    const hasAi = typeof window.ai !== "undefined";
    const hasAgent = typeof window.agent !== "undefined";
    const hasReadability = typeof window.agent?.browser?.activeTab?.readability === "function";
    const hasScreenshot = typeof window.agent?.browser?.activeTab?.screenshot === "function";
    const hasTabsCreate = typeof window.agent?.browser?.tabs?.create === "function";
    const hasTabReadability = typeof window.agent?.browser?.tab?.readability === "function";
    const hasTabHtml = typeof window.agent?.browser?.tab?.getHtml === "function";
    const remoteSessionId = this.getRemoteBridgeSessionId();
    let remoteHelpersConnected = 0;
    let remoteStatusOk = false;

    try {
      const response = await fetch(`/api/bridge/status?session=${encodeURIComponent(remoteSessionId)}`);
      if (response.ok) {
        const payload = await response.json();
        remoteHelpersConnected = Number(payload?.helpersConnected ?? 0);
        remoteStatusOk = true;
      }
    } catch {
      remoteHelpersConnected = 0;
      remoteStatusOk = false;
    }

    const ok = hasAi && hasAgent;
    const message = ok
      ? [
          `Harbor APIs detected.`,
          `activeTab.readability=${hasReadability ? "yes" : "no"}`,
          `activeTab.screenshot=${hasScreenshot ? "yes" : "no"}`,
          `tabs.create=${hasTabsCreate ? "yes" : "no"}`,
          `tab.readability=${hasTabReadability ? "yes" : "no"}`,
          `tab.getHtml=${hasTabHtml ? "yes" : "no"}`,
          `remote.session=${remoteSessionId}`,
          `remote.helpers=${remoteStatusOk ? remoteHelpersConnected : "unreachable"}`,
        ].join(" ")
      : "Harbor APIs not detected. Load with Harbor extension + Web Agents API extension enabled. Voice TTS/STT actions still work through local /api/elevenlabs routes.";

    this.emitStatus(message, ok ? "info" : "error");

    return {
      ok,
      hasAi,
      hasAgent,
      hasReadability,
      hasScreenshot,
      hasTabsCreate,
      hasTabReadability,
      hasTabHtml,
      remoteSessionId,
      remoteStatusOk,
      remoteHelpersConnected,
      message,
    };
  }

  resolvePoseSlot(payload = {}) {
    if (Number.isInteger(payload.pose?.slotIndex)) {
      return payload.pose.slotIndex;
    }

    if (Number.isInteger(payload.triggerPoseSlot)) {
      return payload.triggerPoseSlot;
    }

    return null;
  }

  resolvePoseLabel(payload, poseSlot) {
    const fromPayload = payload?.pose?.label;
    if (typeof fromPayload === "string" && fromPayload.trim()) {
      return fromPayload.trim();
    }

    return this.getPoseLabel(poseSlot);
  }

  resolveModifier(payload, poseSlot) {
    const defaults = {
      detected: false,
      gesture: null,
      expectedGesture: null,
      handedness: null,
      source: "none",
    };

    if (!this.settings.modifier?.enabled) {
      return defaults;
    }

    if (this.settings.modifier.strategy !== "secondary_hand") {
      return defaults;
    }

    const expectedGesture =
      this.settings.modifier?.perPoseGesture?.[poseSlot] || this.settings.modifier.gesture;
    const primaryHand = normalizeHand(payload.handedness);
    const hands = Array.isArray(payload.hands) ? payload.hands : [];
    const secondaryHands = hands.filter((hand) => {
      if (hand?.isPrimary === true) return false;
      const handLabel = normalizeHand(hand?.handedness);
      if (primaryHand === "unknown") return true;
      return handLabel !== primaryHand;
    });

    const matched = secondaryHands.find((hand) => Array.isArray(hand.gestures) && hand.gestures.includes(expectedGesture));
    if (matched) {
      return {
        detected: true,
        gesture: expectedGesture,
        expectedGesture,
        handedness: normalizeHand(matched.handedness),
        source: "secondary-hand",
      };
    }

    if (payload.modifier?.detected && payload.modifier.gesture === expectedGesture) {
      return {
        detected: true,
        gesture: expectedGesture,
        expectedGesture,
        handedness: normalizeHand(payload.modifier.handedness),
        source: "payload",
      };
    }

    return {
      ...defaults,
      expectedGesture,
    };
  }

  resolveActionRouting(poseSlot, payload) {
    const baseActionId = this.settings.mapping[poseSlot] ?? "none";
    const modifier = this.resolveModifier(payload, poseSlot);

    let actionId = baseActionId;
    if (modifier.detected) {
      const alternateActionId = this.settings.modifier?.perPoseAltAction?.[poseSlot];
      if (alternateActionId && alternateActionId !== "none") {
        actionId = alternateActionId;
      }
    }

    return {
      baseActionId,
      actionId,
      modifier,
    };
  }

  passSafetyGate({ action, poseSlot, poseLabel, modifier }) {
    if (this.settings.safetyMode === "confirm_each") {
      const details = [
        `Run "${action.label}" for pose ${poseSlot} (${poseLabel})?`,
        action.description || "No action description.",
        action.requiredScopes?.length
          ? `Scopes: ${action.requiredScopes.join(", ")}`
          : "Scopes: none",
      ];

      if (modifier?.detected) {
        details.push(`Modifier: ${modifier.gesture} (${modifier.handedness || "unknown"} hand)`);
      }

      const accepted = window.confirm(details.join("\n"));
      if (!accepted) {
        return { ok: false, reason: "Action rejected in confirmation dialog." };
      }
      return { ok: true };
    }

    if (!this.settings.armed) {
      return { ok: false, reason: "Cooldown mode is not armed." };
    }

    const now = Date.now();
    const lastAt = this.lastRunAt.get(poseSlot) ?? -Infinity;
    const elapsed = now - lastAt;
    if (elapsed < this.settings.cooldownMs) {
      return {
        ok: false,
        reason: `Pose ${poseSlot} is cooling down (${humanDuration(this.settings.cooldownMs - elapsed)} left).`,
      };
    }

    this.lastRunAt.set(poseSlot, now);
    return { ok: true };
  }

  ensureApis(action) {
    if (VOICE_LOCAL_ACTION_IDS.has(action.id)) {
      return;
    }

    if (REMOTE_ACTION_IDS.has(action.id)) {
      if (typeof fetch !== "function") {
        throw new Error("Remote relay requires fetch() support.");
      }
      return;
    }

    if (typeof window.agent === "undefined") {
      throw new Error("Harbor APIs are not available on this page.");
    }

    if (MCP_ACTION_IDS.has(action.id)) {
      if (typeof window.agent?.tools?.list !== "function" || typeof window.agent?.tools?.call !== "function") {
        throw new Error("MCP tool APIs are unavailable. Enable mcp:tools.list and mcp:tools.call.");
      }
      if (action.requiresBrowserApi && typeof window.agent?.browser?.activeTab?.readability !== "function") {
        throw new Error("activeTab.readability() is unavailable. Enable browserInteraction.");
      }
      return;
    }

    if (typeof window.ai === "undefined") {
      throw new Error("AI session APIs are unavailable on this page.");
    }

    if (action.id === "agent_run_brief") {
      if (typeof window.agent?.run !== "function") {
        throw new Error("agent.run() is unavailable. Enable toolCalling feature flag.");
      }
      return;
    }

    if (!action.requiresBrowserApi) {
      return;
    }

    const browser = window.agent?.browser;
    if (!browser) {
      throw new Error("Browser capability API is not available.");
    }

    if (action.id.startsWith("research_agent")) {
      if (typeof browser.tabs?.create !== "function") {
        throw new Error("browser.tabs.create() is unavailable. Enable browserControl.");
      }
      if (typeof browser.tab?.getHtml !== "function") {
        throw new Error("browser.tab.getHtml() is unavailable. Enable browserControl.");
      }
      if (typeof browser.tab?.readability !== "function") {
        throw new Error("browser.tab.readability() is unavailable. Enable browserControl.");
      }
    }

    if (
      action.id === "read_summarize"
      || action.id.startsWith("screenshot_analyze")
      || action.id.startsWith("conversation_")
    ) {
      if (typeof browser.activeTab?.readability !== "function") {
        throw new Error("activeTab.readability() is unavailable. Enable browserInteraction.");
      }
    }

    if (action.id.startsWith("screenshot_analyze")) {
      if (typeof browser.activeTab?.screenshot !== "function") {
        throw new Error("activeTab.screenshot() is unavailable. Enable browserInteraction.");
      }
    }
  }

  async ensurePermissions(requiredScopes) {
    if (!requiredScopes?.length) {
      return;
    }

    let missingScopes = [...requiredScopes];
    if (typeof window.agent?.permissions?.list === "function") {
      try {
        const existing = await window.agent.permissions.list();
        const scopeStates = existing?.scopes ?? {};
        missingScopes = requiredScopes.filter((scope) => !permissionGranted(scopeStates[scope]));
      } catch {
        missingScopes = [...requiredScopes];
      }
    }

    if (!missingScopes.length) {
      return;
    }

    if (typeof window.agent?.requestPermissions !== "function") {
      throw new Error("Permission request API is unavailable.");
    }

    const result = await window.agent.requestPermissions({
      scopes: missingScopes,
      reason: "Gesture-triggered browser actions need scoped permissions.",
    });

    const denied = missingScopes.filter((scope) => !permissionGranted(result?.scopes?.[scope]));
    if (!result?.granted || denied.length > 0) {
      throw new Error(`Permission denied for scopes: ${denied.join(", ") || missingScopes.join(", ")}.`);
    }
  }

  isAgentRunFallbackError(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "").toLowerCase();

    if (code === "ERR_FEATURE_DISABLED" || code === "ERR_SCOPE_REQUIRED" || code === "ERR_PERMISSION_DENIED") {
      return true;
    }

    return (
      message.includes("agent.run")
      || message.includes("toolcalling")
      || message.includes("model:tools")
      || message.includes("permission denied")
    );
  }

  async getTextSession() {
    const nextKey = `${this.settings.provider}::${this.settings.model}`;
    if (this.session && this.sessionKey === nextKey) {
      return this.session;
    }

    if (this.session && typeof this.session.destroy === "function") {
      this.session.destroy();
      this.session = null;
    }

    if (typeof window.ai?.createTextSession !== "function") {
      throw new Error("Text session API is unavailable.");
    }

    this.session = await window.ai.createTextSession({
      provider: this.settings.provider,
      model: this.settings.model,
    });
    this.sessionKey = nextKey;
    return this.session;
  }

  async withTemporarySession(options, runner) {
    const session = await window.ai.createTextSession({
      provider: this.settings.provider,
      model: this.settings.model,
      ...options,
    });
    try {
      return await runner(session);
    } finally {
      if (session && typeof session.destroy === "function") {
        session.destroy();
      }
    }
  }

  async promptModel(prompt) {
    const session = await this.getTextSession();
    return session.prompt(prompt);
  }

  async readActiveTab() {
    if (typeof window.agent?.browser?.activeTab?.readability !== "function") {
      throw new Error("activeTab.readability() is unavailable. Enable browserInteraction.");
    }

    return window.agent.browser.activeTab.readability();
  }

  async captureScreenshot() {
    if (typeof window.agent?.browser?.activeTab?.screenshot !== "function") {
      throw new Error("activeTab.screenshot() is unavailable. Enable browserInteraction.");
    }

    return window.agent.browser.activeTab.screenshot();
  }

  async listMcpToolNames() {
    if (typeof window.agent?.tools?.list !== "function") {
      throw new Error("agent.tools.list() is unavailable.");
    }
    const tools = await window.agent.tools.list();
    return (tools || []).map((tool) => tool?.name).filter(Boolean);
  }

  async resolveMcpToolName(candidates = []) {
    const names = await this.listMcpToolNames();
    for (const candidate of candidates) {
      if (names.includes(candidate)) {
        return candidate;
      }
    }

    for (const candidate of candidates) {
      const shortName = String(candidate || "").split("/").pop();
      if (!shortName) {
        continue;
      }
      const found = names.find((name) => String(name || "").endsWith(`/${shortName}`));
      if (found) {
        return found;
      }
    }

    throw new Error(`No compatible MCP tool found. Tried: ${candidates.join(", ")}.`);
  }

  async callMcpTool(candidates, args = {}) {
    if (typeof window.agent?.tools?.call !== "function") {
      throw new Error("agent.tools.call() is unavailable.");
    }

    const tool = await this.resolveMcpToolName(candidates);
    return window.agent.tools.call({
      tool,
      args,
    });
  }

  buildResearchQuery(context, pageTitle) {
    const templateValues = {
      poseId: context.poseSlot,
      poseLabel: context.poseLabel,
      triggerId: context.payload.triggerId ?? "",
      pageTitle,
      timestamp: context.payload.timestamp ?? new Date().toISOString(),
    };

    const rendered = replaceTemplate(this.settings.research.queryTemplate, templateValues).trim();
    if (rendered) {
      return rendered;
    }

    return `Research and summarize with citations: ${pageTitle}`;
  }

  buildSearchUrl(query) {
    const template = this.settings.research.searchEngineUrlTemplate;
    const encodedQuery = encodeURIComponent(query);

    if (template.includes("{{query}}")) {
      return template.replaceAll("{{query}}", encodedQuery);
    }

    return `https://www.google.com/search?q=${encodedQuery}`;
  }

  buildAgentRunTask(context, pageTitle, pageText) {
    const baseTask = [
      "You are a concise browser copilot.",
      `Trigger: pose ${context.poseSlot} (${context.poseLabel}).`,
      `Page title: ${pageTitle}`,
      "Give: 1) short summary, 2) one safe next action, 3) one risk check.",
    ];

    if (pageText?.trim()) {
      baseTask.push("Page context:");
      baseTask.push(truncate(pageText, 1600));
    } else {
      baseTask.push("No page text context is available.");
    }

    return baseTask.join("\n\n");
  }

  async extractUrlsWithModelFallback(html, maxUrls) {
    if (typeof window.ai?.createTextSession !== "function") {
      return [];
    }

    return this.withTemporarySession(
      {
        systemPrompt:
          "You extract organic result links from search HTML and return only a JSON array of URLs.",
      },
      async (session) => {
        const prompt = [
          `Extract up to ${maxUrls} organic result URLs from this search results HTML.`,
          "Return only a JSON array of URL strings.",
          "Exclude search engine, ads, and social media domains.",
          "",
          truncate(html, 24000),
        ].join("\n");

        const response = await session.prompt(prompt);
        const parsed = parseJsonArrayFromText(response)
          .map((item) => normalizeSearchUrl(item))
          .filter(Boolean);

        return [...new Set(parsed)].slice(0, maxUrls);
      },
    );
  }

  async collectSearchResultUrls(searchTabId, maxUrls) {
    const htmlResult = await window.agent.browser.tab.getHtml(searchTabId);
    const html = String(htmlResult?.html || "");

    if (html.length < 80) {
      throw new Error("Search result HTML is empty or too short.");
    }

    const regexUrls = extractUrlsFromHtml(html).slice(0, maxUrls);
    if (regexUrls.length >= Math.min(2, maxUrls)) {
      return regexUrls;
    }

    const modelUrls = await this.extractUrlsWithModelFallback(html, maxUrls);
    const merged = [...new Set([...regexUrls, ...modelUrls])];
    return merged.slice(0, maxUrls);
  }

  async synthesizeResearch(query, sources, mode = "default") {
    const formattedSources = sources
      .map((source, index) => {
        return [
          `[Source ${index + 1}]`,
          `Title: ${source.title}`,
          `URL: ${source.url}`,
          `Content: ${truncate(source.text, 5500)}`,
        ].join("\n");
      })
      .join("\n\n---\n\n");

    const modeLine = mode === "alt"
      ? "Use a deeper lens: include conflicting points and uncertainties."
      : "Focus on direct, high-signal conclusions first.";

    const prompt = [
      "You are a browser research assistant.",
      `User intent: ${query}`,
      modeLine,
      "Synthesize these sources into a concise answer with inline citations like [1], [2].",
      "End with one short risk check and one suggested next action.",
      "",
      formattedSources,
    ].join("\n\n");

    return this.promptModel(prompt);
  }

  async runReadSummarizeAction(context) {
    const page = await this.readActiveTab();
    const pageTitle = getPageTitle(page);
    const pageText = truncate(getPageText(page), 4800);

    const prompt = [
      "You are a browser automation assistant.",
      `Trigger: pose ${context.poseSlot} (${context.poseLabel}).`,
      `Page title: ${pageTitle}`,
      "Summarize the page briefly and suggest two safe next actions.",
      "Page content:",
      pageText,
    ].join("\n\n");

    const output = await this.promptModel(prompt);
    return {
      output,
      meta: {
        pageTitle,
        textChars: pageText.length,
      },
    };
  }

  async runScreenshotAnalyzeAction(context, mode = "default") {
    const screenshot = await this.captureScreenshot();
    let page = null;
    try {
      page = await this.readActiveTab();
    } catch {
      page = null;
    }

    const pageTitle = getPageTitle(page);
    const pageText = truncate(getPageText(page), 3200);
    const screenshotChars = screenshot?.dataUrl?.length ?? 0;
    const modeLine = mode === "alt"
      ? "Prioritize risk and ambiguity detection over productivity suggestions."
      : "Focus on current state and a safe next step.";

    const prompt = [
      "You are assisting a browser gesture workflow.",
      `Trigger: pose ${context.poseSlot} (${context.poseLabel}).`,
      `A screenshot was captured (data URL length: ${screenshotChars}).`,
      modeLine,
      `Page title: ${pageTitle}`,
      "Assume this may be a text-only model. Use page text context to infer what the user is viewing.",
      "Provide: 1) current-state summary, 2) one recommended next step, 3) one risk check.",
      "Page content:",
      pageText || "No readability content available.",
    ].join("\n\n");

    const output = await this.promptModel(prompt);

    window.dispatchEvent(
      new CustomEvent("harbor:gesture-screenshot", {
        detail: {
          triggerId: context.payload.triggerId,
          poseSlot: context.poseSlot,
          poseLabel: context.poseLabel,
          timestamp: new Date().toISOString(),
          dataUrl: screenshot?.dataUrl ?? null,
          mode,
        },
      }),
    );

    return {
      output,
      meta: {
        pageTitle,
        screenshotChars,
        mode,
      },
    };
  }

  async runResearchAgentAction(context, mode = "default") {
    const sourceCount = this.settings.research.sourceCountDefault;
    const activePage = await this.readActiveTab();
    const pageTitle = getPageTitle(activePage);
    const query = this.buildResearchQuery(context, pageTitle);
    const searchUrl = this.buildSearchUrl(query);

    const openedResultTabs = [];
    let searchTabId = null;
    let sources = [];

    try {
      this.emitStatus(`Research: opening search page for "${query.slice(0, 70)}"...`);
      const searchTab = await window.agent.browser.tabs.create({ url: searchUrl, active: false });
      searchTabId = searchTab?.id ?? null;
      await sleep(2200);

      if (!Number.isInteger(searchTabId)) {
        throw new Error("Search tab was not created.");
      }

      const resultUrls = await this.collectSearchResultUrls(searchTabId, sourceCount);
      if (!resultUrls.length) {
        throw new Error("Could not extract any research result URLs.");
      }

      this.emitStatus(`Research: opening ${resultUrls.length} result tabs...`);
      for (const url of resultUrls) {
        try {
          const tab = await window.agent.browser.tabs.create({ url, active: false });
          if (Number.isInteger(tab?.id)) {
            openedResultTabs.push({ id: tab.id, url });
          }
        } catch {
          // Continue with remaining URLs.
        }
      }

      await sleep(2600);
      if (!openedResultTabs.length) {
        throw new Error("No result tabs could be opened.");
      }

      this.emitStatus(`Research: reading ${openedResultTabs.length} pages...`);
      for (const tab of openedResultTabs) {
        try {
          const page = await window.agent.browser.tab.readability(tab.id);
          const text = truncate(getPageText(page), 6000);
          if (!text.trim()) {
            continue;
          }

          sources.push({
            url: tab.url,
            title: page?.title || new URL(tab.url).hostname,
            text,
          });
        } catch {
          // Skip unreadable pages.
        }
      }

      if (!sources.length) {
        throw new Error("No readable content extracted from opened tabs.");
      }

      this.emitStatus("Research: synthesizing answer with citations...");
      const output = await this.synthesizeResearch(query, sources, mode);
      return {
        output,
        meta: {
          pageTitle,
          query,
          mode,
          sourceCountRequested: sourceCount,
          sourceCountRead: sources.length,
          sources: sources.map((source) => ({ title: source.title, url: source.url })),
        },
      };
    } finally {
      if (this.settings.research.closeTabsAfterRun) {
        for (const tab of openedResultTabs) {
          try {
            await window.agent.browser.tabs.close(tab.id);
          } catch {
            // Ignore close failures.
          }
        }

        if (Number.isInteger(searchTabId)) {
          try {
            await window.agent.browser.tabs.close(searchTabId);
          } catch {
            // Ignore close failures.
          }
        }
      }
    }
  }

  async runAgentRunBriefAction(context) {
    let page = null;
    try {
      page = await this.readActiveTab();
    } catch {
      page = null;
    }

    const pageTitle = getPageTitle(page);
    const pageText = truncate(getPageText(page), 2400);
    const task = this.buildAgentRunTask(context, pageTitle, pageText);

    if (typeof window.agent?.run !== "function") {
      throw new Error("agent.run() is unavailable. Enable toolCalling feature flag.");
    }

    const tokenChunks = [];
    const toolTrace = [];
    let finalOutput = "";
    const eventCounts = {
      status: 0,
      thinking: 0,
      tool_call: 0,
      tool_result: 0,
      token: 0,
      final: 0,
      error: 0,
    };

    for await (const event of window.agent.run({
      task,
      provider: this.settings.provider,
      maxToolCalls: 3,
      useAllTools: false,
    })) {
      const type = String(event?.type || "");
      if (Object.prototype.hasOwnProperty.call(eventCounts, type)) {
        eventCounts[type] += 1;
      }

      if (type === "status") {
        this.emitStatus(`agent.run status: ${truncate(event?.message || "", 120)}`);
        continue;
      }

      if (type === "thinking") {
        this.emitStatus(`agent.run thinking: ${truncate(event?.content || "", 120)}`);
        continue;
      }

      if (type === "tool_call") {
        toolTrace.push({
          phase: "call",
          tool: String(event?.tool || "unknown"),
          details: truncate(JSON.stringify(event?.args ?? {}), 260),
        });
        continue;
      }

      if (type === "tool_result") {
        toolTrace.push({
          phase: "result",
          tool: String(event?.tool || "unknown"),
          details: truncate(JSON.stringify(event?.result ?? event?.error ?? {}), 260),
        });
        continue;
      }

      if (type === "token") {
        tokenChunks.push(String(event?.token || ""));
        continue;
      }

      if (type === "final") {
        finalOutput = String(event?.output || "").trim();
        continue;
      }

      if (type === "error") {
        const streamError = new Error(event?.error?.message || "agent.run failed.");
        if (event?.error?.code) {
          streamError.code = event.error.code;
        }
        throw streamError;
      }
    }

    const output = finalOutput || tokenChunks.join("").trim() || "agent.run completed with no output.";
    return {
      output,
      meta: {
        mode: "agent.run",
        pageTitle,
        pageTextChars: pageText.length,
        task: truncate(task, 320),
        eventCounts,
        toolTrace: toolTrace.slice(0, 8),
      },
    };
  }

  buildRemoteBridgeCommand(context) {
    const commandId = typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    return {
      id: commandId,
      action: "remote_read_screenshot_summarize",
      origin: window.location.origin,
      timestamp: new Date().toISOString(),
      provider: this.settings.provider,
      model: this.settings.model,
      poseSlot: context.poseSlot,
      poseLabel: context.poseLabel,
      options: {
        maxContextChars: 6400,
        timeoutMs: REMOTE_BRIDGE_COMMAND_TIMEOUT_MS,
      },
    };
  }

  async sendRemoteBridgeCommand(command, sessionId) {
    const response = await fetch("/api/bridge/command", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        command,
      }),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new Error(payload?.error || `Remote bridge command failed (${response.status}).`);
    }

    return payload || {};
  }

  async runRemoteReadScreenshotSummarizeAction(context) {
    const sessionId = this.getRemoteBridgeSessionId();
    const command = this.buildRemoteBridgeCommand(context);
    this.emitStatus(
      `Remote bridge: dispatching ${command.action} to session "${sessionId}" (cmd ${command.id.slice(0, 8)}).`,
    );

    const bridgePayload = await this.sendRemoteBridgeCommand(command, sessionId);
    const result = bridgePayload?.result;

    if (!result || typeof result !== "object") {
      throw new Error("Remote bridge returned no result payload.");
    }

    if (result.ok === false) {
      const remoteError = new Error(result.errorMessage || "Remote helper execution failed.");
      if (result.errorCode) {
        remoteError.code = result.errorCode;
      }
      throw remoteError;
    }

    const output = String(result.output || "").trim() || "Remote helper completed with no output.";
    const resultMeta = result.meta && typeof result.meta === "object" ? result.meta : {};
    const targetTitle = resultMeta.targetTitle || resultMeta.pageTitle || "Remote page";

    return {
      output,
      meta: {
        ...resultMeta,
        pageTitle: targetTitle,
        remoteBridge: true,
        remoteSessionId: sessionId,
        commandId: command.id,
        targetUrl: resultMeta.targetUrl || null,
        targetTitle,
      },
    };
  }

  async runMcpFetchBriefAction() {
    const page = await this.readActiveTab();
    const pageTitle = getPageTitle(page);
    const pageUrl = window.location.href;
    const result = await this.callMcpTool(
      ["fetch/fetch", "http/fetch", "web-fetch/fetch_url", "fetch/get"],
      { url: pageUrl },
    );

    return {
      output: `Fetched context for "${pageTitle}".\n${toolResultPreview(result)}`,
      meta: {
        pageTitle,
        pageUrl,
      },
    };
  }

  async runMcpMemorySaveAction() {
    const page = await this.readActiveTab();
    const pageTitle = getPageTitle(page);
    const pageUrl = window.location.href;
    const pageText = truncate(getPageText(page), 2200);
    const result = await this.callMcpTool(
      ["memory/save_memory", "memory/set", "memory/upsert"],
      {
        key: pageUrl,
        value: {
          title: pageTitle,
          url: pageUrl,
          summary: pageText,
          savedAt: new Date().toISOString(),
        },
      },
    );

    return {
      output: `Saved memory for "${pageTitle}".`,
      meta: {
        pageTitle,
        pageUrl,
        result: toolResultPreview(result, 480),
      },
    };
  }

  async runMcpMemoryRecallAction() {
    const pageTitle = document.title || "Untitled page";
    const pageUrl = window.location.href;
    const result = await this.callMcpTool(
      ["memory/search_memories", "memory/search", "memory/query"],
      {
        query: `${pageTitle} ${pageUrl}`,
        limit: 3,
      },
    );

    return {
      output: `Memory recall for "${pageTitle}":\n${toolResultPreview(result)}`,
      meta: {
        pageTitle,
        pageUrl,
      },
    };
  }

  async runMcpFilesystemLogAction() {
    const pageTitle = document.title || "Untitled page";
    const pageUrl = window.location.href;
    const line = `${new Date().toISOString()} | ${pageTitle} | ${pageUrl}\n`;
    const result = await this.callMcpTool(
      ["filesystem/append_file", "filesystem/write_file", "fs/append_file"],
      {
        path: "gesture-log.md",
        content: line,
        append: true,
      },
    );

    return {
      output: `Appended a local log entry for "${pageTitle}".`,
      meta: {
        pageTitle,
        pageUrl,
        filePath: "gesture-log.md",
        result: toolResultPreview(result, 480),
      },
    };
  }

  async runMcpFilesystemNestedWorkflowAction(context) {
    const page = await this.readActiveTab();
    const pageTitle = getPageTitle(page);
    const pageUrl = window.location.href;
    const nowIso = new Date().toISOString();
    const workflowDir = "gesture-workflow";
    const statePath = `${workflowDir}/state.json`;
    const queuePath = `${workflowDir}/queue.md`;
    const nextPath = `${workflowDir}/next-action.md`;

    // Step 1: read existing state if present (best-effort).
    let previousStateRaw = "";
    let previousState = null;
    try {
      const stateResult = await this.callMcpTool(
        ["filesystem/read_file", "fs/read_file", "filesystem/read"],
        { path: statePath },
      );
      previousStateRaw = String(
        stateResult?.content ?? stateResult?.text ?? stateResult?.value ?? JSON.stringify(stateResult),
      );
      try {
        previousState = JSON.parse(previousStateRaw);
      } catch {
        previousState = null;
      }
    } catch {
      previousStateRaw = "";
      previousState = null;
    }

    const runCount = Number(previousState?.runCount ?? 0) + 1;
    const eventLine = `- ${nowIso} | pose=${context.poseSlot} (${context.poseLabel}) | ${pageTitle} | ${pageUrl}\n`;

    // Step 2: append queue/event log.
    await this.callMcpTool(
      ["filesystem/append_file", "fs/append_file", "filesystem/write_file"],
      {
        path: queuePath,
        content: eventLine,
        append: true,
      },
    );

    // Step 3: write updated structured state.
    const nextState = {
      runCount,
      lastRunAt: nowIso,
      lastPose: {
        slot: context.poseSlot,
        label: context.poseLabel,
      },
      lastPage: {
        title: pageTitle,
        url: pageUrl,
      },
      previousStateAvailable: Boolean(previousStateRaw),
    };
    await this.callMcpTool(
      ["filesystem/write_file", "fs/write_file", "filesystem/write"],
      {
        path: statePath,
        content: `${JSON.stringify(nextState, null, 2)}\n`,
        append: false,
      },
    );

    // Step 4: write a deterministic "next step" handoff file.
    const nextActionText = [
      `# Next Step`,
      ``,
      `Triggered at: ${nowIso}`,
      `Pose: ${context.poseSlot} (${context.poseLabel})`,
      `Page: ${pageTitle}`,
      `URL: ${pageUrl}`,
      ``,
      `Suggested follow-up: run MCP fetch brief, then summarize and speak.`,
    ].join("\n");
    await this.callMcpTool(
      ["filesystem/write_file", "fs/write_file", "filesystem/write"],
      {
        path: nextPath,
        content: `${nextActionText}\n`,
        append: false,
      },
    );

    return {
      output: `Filesystem workflow complete (run #${runCount}). Updated ${statePath}, ${queuePath}, and ${nextPath}.`,
      meta: {
        pageTitle,
        pageUrl,
        runCount,
        workflowDir,
        files: [statePath, queuePath, nextPath],
      },
    };
  }

  async runMcpCalendarNextAction() {
    const result = await this.callMcpTool(
      ["calendar/list_events", "caldav/list_events", "calendar/next_events"],
      {
        limit: 3,
      },
    );

    return {
      output: `Upcoming events:\n${toolResultPreview(result)}`,
      meta: {
        source: "mcp-calendar",
      },
    };
  }

  async runAskModelAction(context) {
    const pageTitle = document.title || "Untitled page";
    const templateValues = {
      poseId: context.poseSlot,
      poseLabel: context.poseLabel,
      triggerId: context.payload.triggerId ?? "",
      handedness: context.payload.handedness ?? "unknown",
      pageTitle,
      timestamp: context.payload.timestamp ?? new Date().toISOString(),
    };
    const prompt = replaceTemplate(this.settings.askPromptTemplate, templateValues);
    const output = await this.promptModel(prompt);

    return {
      output,
      meta: {
        pageTitle,
      },
    };
  }

  async buildConversationBrief(context) {
    const page = await this.readActiveTab();
    const pageTitle = getPageTitle(page);
    const pageText = truncate(getPageText(page), 5600);
    const prompt = [
      "You are a site-aware voice assistant.",
      `Trigger: pose ${context.poseSlot} (${context.poseLabel}).`,
      `Page title: ${pageTitle}`,
      "Write a concise spoken response (4-6 sentences) explaining what this page is about,",
      "why it matters, and one suggested next action.",
      "Page content:",
      pageText || "No readable page text available.",
    ].join("\n\n");

    const brief = await this.promptModel(prompt);
    return {
      pageTitle,
      brief,
      pageTextChars: pageText.length,
    };
  }

  async speakWithElevenLabs(text) {
    const payload = {
      text,
    };
    if (this.settings.elevenLabs.voiceId) {
      payload.voice_id = this.settings.elevenLabs.voiceId;
    }

    const response = await fetch("/api/elevenlabs/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let message = `TTS request failed (${response.status}).`;
      try {
        const errorBody = await response.json();
        if (errorBody?.error) {
          message = errorBody.error;
        }
      } catch {
        // Ignore JSON parse failures.
      }
      throw new Error(message);
    }

    const audioBlob = await response.blob();
    const objectUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(objectUrl);
    audio.onended = () => {
      URL.revokeObjectURL(objectUrl);
    };

    if (this.currentAudio) {
      this.currentAudio.pause();
    }
    this.currentAudio = audio;

    try {
      await audio.play();
    } catch {
      throw new Error("Audio playback blocked. Interact with the page, then retry.");
    }

    return {
      audioBytes: audioBlob.size,
    };
  }

  async recordMicrophoneClip(options = {}) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture is unavailable in this browser.");
    }

    if (typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder is unavailable in this browser.");
    }

    const durationMsRaw = Number.parseInt(options.durationMs, 10);
    const durationMs = Number.isFinite(durationMsRaw) ? Math.max(800, durationMsRaw) : 2600;
    const preferredMimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    const supportedMimeType = preferredMimeTypes.find(
      (mimeType) => typeof MediaRecorder.isTypeSupported !== "function" || MediaRecorder.isTypeSupported(mimeType),
    );

    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    const chunks = [];

    return new Promise((resolve, reject) => {
      const recorder = supportedMimeType
        ? new MediaRecorder(micStream, { mimeType: supportedMimeType })
        : new MediaRecorder(micStream);

      const cleanup = () => {
        micStream.getTracks().forEach((track) => track.stop());
      };

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onerror = () => {
        cleanup();
        reject(new Error("Microphone recorder failed."));
      };

      recorder.onstop = () => {
        cleanup();
        if (!chunks.length) {
          reject(new Error("No audio captured from microphone."));
          return;
        }

        const mimeType = recorder.mimeType || supportedMimeType || "audio/webm";
        const audioBlob = new Blob(chunks, { type: mimeType });
        resolve({
          blob: audioBlob,
          durationMs,
          mimeType,
        });
      };

      try {
        recorder.start();
      } catch (_error) {
        cleanup();
        reject(new Error("Failed to start microphone recording."));
        return;
      }

      window.setTimeout(() => {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      }, durationMs);
    });
  }

  async transcribeWithElevenLabs(audioCapture) {
    const payload = {
      audio_base64: await blobToDataUrl(audioCapture.blob),
      filename: `gesture-note-${Date.now()}.webm`,
      mime_type: audioCapture.mimeType || audioCapture.blob.type || "audio/webm",
      tag_audio_events: true,
    };

    const response = await fetch("/api/elevenlabs/stt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let message = `STT request failed (${response.status}).`;
      try {
        const errorBody = await response.json();
        if (errorBody?.error) {
          message = errorBody.error;
        }
      } catch {
        // Ignore JSON parse failures.
      }
      throw new Error(message);
    }

    const result = await response.json();
    return {
      text: String(result?.text || "").trim(),
      languageCode: result?.language_code || null,
      languageProbability: result?.language_probability ?? null,
      transcriptionId: result?.transcription_id || null,
      raw: result,
    };
  }

  async runVoiceTtsPingAction(context) {
    const prompt = `${ELEVENLABS_HELLO_WORLD_TEXT} Gesture pose ${context.poseSlot} (${context.poseLabel}) received. Voice output is active.`;
    const audio = await this.speakWithElevenLabs(prompt);

    return {
      output: prompt,
      meta: {
        voiceMode: "tts_ping",
        audioBytes: audio.audioBytes,
      },
    };
  }

  async runVoiceTranscribeNoteAction() {
    this.emitStatus("Voice STT: recording microphone note...");
    const audioCapture = await this.recordMicrophoneClip({ durationMs: 2600 });

    this.emitStatus("Voice STT: transcribing note...");
    const transcript = await this.transcribeWithElevenLabs(audioCapture);
    const output = transcript.text || "[No speech recognized]";

    return {
      output,
      meta: {
        voiceMode: "stt_note",
        audioBytes: audioCapture.blob.size,
        durationMs: audioCapture.durationMs,
        languageCode: transcript.languageCode,
        languageProbability: transcript.languageProbability,
        transcriptionId: transcript.transcriptionId,
      },
    };
  }

  async requestElevenLabsSignedUrl() {
    const endpoint = new URL("/api/elevenlabs/agent/signed-url", window.location.origin);
    if (this.settings.elevenLabs.agentId) {
      endpoint.searchParams.set("agent_id", this.settings.elevenLabs.agentId);
    }

    const response = await fetch(endpoint.toString(), {
      method: "GET",
    });

    if (!response.ok) {
      let message = `Signed URL request failed (${response.status}).`;
      try {
        const errorBody = await response.json();
        if (errorBody?.error) {
          message = errorBody.error;
        }
      } catch {
        // Ignore JSON parse failures.
      }
      throw new Error(message);
    }

    const body = await response.json();
    const signedUrl = deriveSignedUrl(body);
    if (!signedUrl) {
      throw new Error("Signed URL response did not include a usable URL.");
    }

    return signedUrl;
  }

  async playElevenLabsHelloWorldCue() {
    try {
      const audio = await this.speakWithElevenLabs(ELEVENLABS_HELLO_WORLD_TEXT);
      return {
        played: true,
        audioBytes: audio.audioBytes,
      };
    } catch (error) {
      this.emitStatus(`ElevenLabs hello-world cue skipped: ${error?.message || "unavailable"}`);
      return {
        played: false,
        error: error?.message || "unavailable",
      };
    }
  }

  async runConversationSiteBriefAction(context) {
    const helloWorldCue = await this.playElevenLabsHelloWorldCue();
    const summary = await this.buildConversationBrief(context);
    try {
      const audio = await this.speakWithElevenLabs(summary.brief);
      return {
        output: summary.brief,
        meta: {
          pageTitle: summary.pageTitle,
          pageTextChars: summary.pageTextChars,
          voiceMode: "site_brief_tts",
          audioBytes: audio.audioBytes,
          helloWorldCue,
          voiceFallback: false,
        },
      };
    } catch (error) {
      return {
        output: `${summary.brief}\n\n[TTS fallback] ${error?.message || "Voice playback unavailable."}`,
        meta: {
          pageTitle: summary.pageTitle,
          pageTextChars: summary.pageTextChars,
          voiceMode: "site_brief_text_fallback",
          helloWorldCue,
          voiceFallback: true,
          ttsError: error?.message || "Voice playback unavailable.",
        },
      };
    }
  }

  async runConversationLiveAction(context) {
    const helloWorldCue = await this.playElevenLabsHelloWorldCue();
    let summary;
    try {
      summary = await this.buildConversationBrief(context);
    } catch (error) {
      const fallbackTitle = document.title || "Untitled page";
      summary = {
        pageTitle: fallbackTitle,
        brief: `Opening live ElevenLabs conversation for "${fallbackTitle}".`,
        pageTextChars: 0,
        contextFallback: true,
        contextError: error?.message || "Context unavailable",
      };
      this.emitStatus(`Live conversation context fallback: ${summary.contextError}`);
    }

    const signedUrl = await this.requestElevenLabsSignedUrl();
    let openedVia = "window.open";
    let popupBlocked = false;

    if (typeof window.agent?.browser?.tabs?.create === "function") {
      await window.agent.browser.tabs.create({
        url: signedUrl,
        active: true,
      });
      openedVia = "browser.tabs.create";
    } else {
      const popup = window.open(signedUrl, "_blank", "noopener,noreferrer");
      if (popup) {
        openedVia = "window.open";
      } else {
        popupBlocked = true;
        window.location.assign(signedUrl);
        openedVia = "window.location.assign";
      }
    }

    return {
      output: `${summary.brief}\n\nOpened live conversation in a new tab.`,
      meta: {
        pageTitle: summary.pageTitle,
        pageTextChars: summary.pageTextChars,
        voiceMode: "live_elevenlabs",
        helloWorldCue,
        contextFallback: Boolean(summary.contextFallback),
        contextError: summary.contextError || null,
        popupBlocked,
        signedUrlHost: new URL(signedUrl).host,
        openedVia,
      },
    };
  }

  async runAction(actionId, context) {
    if (actionId === "voice_tts_ping") {
      return this.runVoiceTtsPingAction(context);
    }

    if (actionId === "voice_transcribe_note") {
      return this.runVoiceTranscribeNoteAction(context);
    }

    if (actionId === "read_summarize") {
      return this.runReadSummarizeAction(context);
    }

    if (actionId === "screenshot_analyze") {
      return this.runScreenshotAnalyzeAction(context, "default");
    }

    if (actionId === "screenshot_analyze_alt") {
      return this.runScreenshotAnalyzeAction(context, "alt");
    }

    if (actionId === "research_agent") {
      return this.runResearchAgentAction(context, "default");
    }

    if (actionId === "research_agent_alt") {
      return this.runResearchAgentAction(context, "alt");
    }

    if (actionId === "agent_run_brief") {
      return this.runAgentRunBriefAction(context);
    }

    if (actionId === "remote_read_screenshot_summarize") {
      return this.runRemoteReadScreenshotSummarizeAction(context);
    }

    if (actionId === "mcp_fetch_brief") {
      return this.runMcpFetchBriefAction(context);
    }

    if (actionId === "mcp_memory_save") {
      return this.runMcpMemorySaveAction(context);
    }

    if (actionId === "mcp_memory_recall") {
      return this.runMcpMemoryRecallAction(context);
    }

    if (actionId === "mcp_filesystem_log") {
      return this.runMcpFilesystemLogAction(context);
    }

    if (actionId === "mcp_filesystem_nested_workflow") {
      return this.runMcpFilesystemNestedWorkflowAction(context);
    }

    if (actionId === "mcp_calendar_next") {
      return this.runMcpCalendarNextAction(context);
    }

    if (actionId === "conversation_site_brief") {
      return this.runConversationSiteBriefAction(context);
    }

    if (actionId === "conversation_live_elevenlabs") {
      return this.runConversationLiveAction(context);
    }

    if (actionId === "ask_model") {
      return this.runAskModelAction(context);
    }

    return {
      output: "Action is disabled.",
      meta: {},
    };
  }

  async handleTriggerEvent(event) {
    const payload = event?.detail ?? {};
    const execution = this.getExecutionSnapshot();
    const poseSlot = this.resolvePoseSlot(payload);
    if (!Number.isInteger(poseSlot)) {
      this.emitSkipped({
        poseSlot: null,
        actionId: "none",
        reason: "No pose slot on trigger payload.",
        execution,
        payload,
      });
      return;
    }

    const poseLabel = this.resolvePoseLabel(payload, poseSlot);
    const routing = this.resolveActionRouting(poseSlot, payload);
    const action = HARBOR_ACTION_BY_ID.get(routing.actionId) ?? HARBOR_ACTION_BY_ID.get("none");

    if (!action || action.id === "none") {
      this.emitSkipped({
        poseSlot,
        actionId: "none",
        reason: `No action mapped for pose ${poseSlot}.`,
        execution,
        payload,
      });
      return;
    }

    if (this.inFlight) {
      this.emitSkipped({
        poseSlot,
        actionId: action.id,
        reason: "Previous action still running.",
        execution,
        payload,
      });
      return;
    }

    const safety = this.passSafetyGate({
      action,
      poseSlot,
      poseLabel,
      modifier: routing.modifier,
    });

    if (!safety.ok) {
      this.emitSkipped({
        poseSlot,
        actionId: action.id,
        reason: safety.reason,
        execution,
        payload,
      });
      return;
    }

    const context = {
      payload,
      poseSlot,
      poseLabel,
      baseActionId: routing.baseActionId,
      modifier: routing.modifier,
    };

    this.inFlight = true;
    const modifierTag = routing.modifier.detected ? ` (modifier: ${routing.modifier.gesture})` : "";
    this.emitStatus(`Running ${action.label} for pose ${poseSlot} (${poseLabel})${modifierTag}...`);

    try {
      this.ensureApis(action);
      await this.ensurePermissions(action.requiredScopes);
      const result = await this.runAction(action.id, context);

      this.emitResult({
        poseSlot,
        poseLabel,
        actionId: action.id,
        baseActionId: routing.baseActionId,
        output: result.output,
        meta: result.meta,
        modifier: routing.modifier,
        execution,
        payload,
      });
      this.emitStatus(`Completed ${action.label} for pose ${poseSlot}.`);
    } catch (error) {
      if (action.id === "agent_run_brief" && this.isAgentRunFallbackError(error)) {
        try {
          this.emitStatus("agent.run unavailable; falling back to Read page + summarize.");
          const fallbackAction = HARBOR_ACTION_BY_ID.get("read_summarize");
          if (!fallbackAction) {
            throw new Error("Fallback action is not configured.");
          }

          this.ensureApis(fallbackAction);
          await this.ensurePermissions(fallbackAction.requiredScopes);
          const fallbackResult = await this.runReadSummarizeAction(context);

          this.emitResult({
            poseSlot,
            poseLabel,
            actionId: action.id,
            baseActionId: routing.baseActionId,
            output: fallbackResult.output,
            meta: {
              ...fallbackResult.meta,
              fallbackFrom: action.id,
              fallbackActionId: fallbackAction.id,
              fallbackReason: error?.message || "agent.run unavailable.",
            },
            modifier: routing.modifier,
            execution,
            payload,
          });
          this.emitStatus(`Completed ${action.label} for pose ${poseSlot} using fallback.`);
          return;
        } catch (fallbackError) {
          const composedError = new Error(
            `Primary action failed: ${error?.message || "Unknown error"}. Fallback failed: ${fallbackError?.message || "Unknown error"}.`,
          );
          this.emitError({
            poseSlot,
            poseLabel,
            actionId: action.id,
            baseActionId: routing.baseActionId,
            modifier: routing.modifier,
            execution,
            error: composedError,
            primaryError: error,
            fallbackError,
            payload,
          });
          this.emitStatus(`Action failed for pose ${poseSlot}: ${composedError.message}`, "error");
          return;
        }
      }

      this.emitError({
        poseSlot,
        poseLabel,
        actionId: action.id,
        baseActionId: routing.baseActionId,
        modifier: routing.modifier,
        execution,
        error,
        payload,
      });
      this.emitStatus(`Action failed for pose ${poseSlot}: ${error?.message || "Unknown error"}`, "error");
    } finally {
      this.inFlight = false;
    }
  }

  emitState() {
    this.eventBus?.emit("harbor:bridge-state", {
      settings: this.getSettings(),
    });
  }

  emitStatus(message, type = "info") {
    this.eventBus?.emit("harbor:bridge-status", {
      type,
      message,
    });
  }

  emitResult(detail) {
    this.eventBus?.emit("harbor:bridge-result", detail);
  }

  emitError(detail) {
    this.eventBus?.emit("harbor:bridge-error", detail);
  }

  emitSkipped(detail) {
    this.eventBus?.emit("harbor:bridge-skipped", detail);
  }
}
