(function bootstrapGestureTargetHelper() {
  const GLOBAL_KEY = "__gestureTargetHelper";
  const previous = window[GLOBAL_KEY];
  if (previous && typeof previous.stop === "function") {
    try {
      previous.stop();
    } catch {
      // Ignore stale helper shutdown errors.
    }
  }

  const currentScript = document.currentScript;
  let sessionId = "default";
  let serverOrigin = window.location.origin;

  try {
    const scriptUrl = new URL(currentScript?.src || "", window.location.href);
    serverOrigin = scriptUrl.origin || serverOrigin;
    const querySession = scriptUrl.searchParams.get("session") || scriptUrl.searchParams.get("targetSessionId");
    if (querySession) {
      sessionId = querySession;
    }
  } catch {
    // Keep defaults.
  }

  sessionId = String(sessionId || "").trim().replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64) || "default";

  const state = {
    connected: false,
    stopped: false,
    permissionsReady: false,
    reconnectTimer: null,
    eventSource: null,
    lastStatus: "idle",
    lastCommandId: null,
    lastError: null,
    lastPingAt: 0,
  };

  function log(message, extra) {
    if (typeof extra !== "undefined") {
      console.log(`[GestureTargetHelper:${sessionId}] ${message}`, extra);
      return;
    }
    console.log(`[GestureTargetHelper:${sessionId}] ${message}`);
  }

  function setStatus(message) {
    state.lastStatus = String(message || "");
    log(state.lastStatus);
  }

  function truncate(text, max = 4200) {
    const value = String(text || "");
    if (value.length <= max) {
      return value;
    }
    return `${value.slice(0, max)}...`;
  }

  function isPermissionGranted(grant) {
    return grant === "granted-once" || grant === "granted-always";
  }

  async function ensurePermissions() {
    if (state.permissionsReady) {
      return;
    }
    if (typeof window.agent?.requestPermissions !== "function") {
      throw new Error("window.agent.requestPermissions() is unavailable.");
    }

    const scopes = [
      "model:prompt",
      "browser:activeTab.read",
      "browser:activeTab.screenshot",
    ];

    const result = await window.agent.requestPermissions({
      scopes,
      reason: "Remote gesture helper needs page read + screenshot + summary permissions.",
    });

    const denied = scopes.filter((scope) => !isPermissionGranted(result?.scopes?.[scope]));
    if (!result?.granted || denied.length) {
      throw new Error(`Permission denied: ${denied.join(", ") || scopes.join(", ")}.`);
    }

    state.permissionsReady = true;
  }

  async function postResult(commandId, result) {
    const response = await fetch(`${serverOrigin}/api/bridge/result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        commandId,
        result,
      }),
    });

    if (!response.ok) {
      let errorMessage = `Failed to post helper result (${response.status}).`;
      try {
        const payload = await response.json();
        if (payload?.error) {
          errorMessage = payload.error;
        }
      } catch {
        // Ignore parse errors.
      }
      throw new Error(errorMessage);
    }
  }

  async function summarizeCurrentTab(command) {
    await ensurePermissions();

    if (typeof window.ai?.createTextSession !== "function") {
      throw new Error("window.ai.createTextSession() is unavailable.");
    }
    if (typeof window.agent?.browser?.activeTab?.readability !== "function") {
      throw new Error("window.agent.browser.activeTab.readability() is unavailable.");
    }

    const page = await window.agent.browser.activeTab.readability();
    const pageTitle = String(page?.title || document.title || "Untitled page");
    const pageText = String(page?.text || page?.content || "").trim();
    const targetUrl = String(page?.url || window.location.href || "");

    let screenshot = null;
    let degraded = false;
    let degradeReason = "";
    if (typeof window.agent?.browser?.activeTab?.screenshot === "function") {
      try {
        screenshot = await window.agent.browser.activeTab.screenshot();
      } catch (error) {
        degraded = true;
        degradeReason = error?.message || "Screenshot capture failed.";
      }
    } else {
      degraded = true;
      degradeReason = "activeTab.screenshot() is unavailable.";
    }

    const screenshotChars = screenshot?.dataUrl?.length ?? 0;
    const prompt = [
      "You are a concise browsing assistant.",
      `Target tab title: ${pageTitle}`,
      `Target tab URL: ${targetUrl}`,
      `Trigger pose: ${command.poseSlot} (${command.poseLabel})`,
      `Screenshot data URL length: ${screenshotChars}`,
      degraded
        ? `Screenshot degraded mode: ${degradeReason}`
        : "Screenshot capture succeeded.",
      "Respond with: 1) 2-3 sentence summary, 2) one safe next action, 3) one risk check.",
      "Page content:",
      truncate(pageText, Number(command?.options?.maxContextChars || 6400)),
    ].join("\n\n");

    const sessionOptions = {};
    if (command?.provider) {
      sessionOptions.provider = command.provider;
    }
    if (command?.model) {
      sessionOptions.model = command.model;
    }

    const session = await window.ai.createTextSession(sessionOptions);
    let output = "";
    try {
      output = await session.prompt(prompt);
    } finally {
      if (session && typeof session.destroy === "function") {
        try {
          session.destroy();
        } catch {
          // Ignore cleanup errors.
        }
      }
    }

    return {
      ok: true,
      output: String(output || "").trim(),
      meta: {
        remoteHelper: true,
        action: command.action,
        pageTitle,
        targetTitle: pageTitle,
        targetUrl,
        textChars: pageText.length,
        screenshotChars,
        degraded,
        degradeReason: degraded ? degradeReason : "",
      },
    };
  }

  async function handleCommand(payload) {
    const command = payload?.command && typeof payload.command === "object"
      ? payload.command
      : payload;
    const commandId = String(command?.id || "").trim();
    if (!commandId) {
      return;
    }

    state.lastCommandId = commandId;
    setStatus(`Executing command ${commandId.slice(0, 8)} (${command.action || "unknown"}).`);

    let result;
    try {
      if (command.action !== "remote_read_screenshot_summarize") {
        throw new Error(`Unsupported command action: ${command.action}`);
      }
      result = await summarizeCurrentTab(command);
    } catch (error) {
      state.lastError = error?.message || String(error);
      result = {
        ok: false,
        errorCode: error?.code || "REMOTE_HELPER_ERROR",
        errorMessage: state.lastError,
        targetUrl: window.location.href,
        targetTitle: document.title || "Untitled page",
      };
    }

    try {
      await postResult(commandId, result);
      setStatus(result.ok ? "Command completed." : `Command failed: ${result.errorMessage}`);
    } catch (error) {
      state.lastError = error?.message || String(error);
      setStatus(`Failed to report result: ${state.lastError}`);
    }
  }

  function connect() {
    if (state.stopped) {
      return;
    }

    const streamUrl = `${serverOrigin}/api/bridge/stream?session=${encodeURIComponent(sessionId)}`;
    const stream = new EventSource(streamUrl);
    state.eventSource = stream;

    stream.onopen = () => {
      state.connected = true;
      state.lastError = null;
      setStatus(`Connected to relay (${sessionId}).`);
    };

    stream.addEventListener("ready", () => {
      state.connected = true;
    });

    stream.addEventListener("ping", () => {
      state.lastPingAt = Date.now();
    });

    stream.addEventListener("command", (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      void handleCommand(payload);
    });

    stream.onerror = () => {
      if (state.stopped) {
        return;
      }
      state.connected = false;
      setStatus("Relay disconnected. Reconnecting...");
      try {
        stream.close();
      } catch {
        // Ignore close errors.
      }
      state.eventSource = null;

      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
      }
      state.reconnectTimer = setTimeout(() => {
        connect();
      }, 1400);
    };
  }

  function start() {
    if (!state.stopped && state.eventSource) {
      return;
    }
    state.stopped = false;
    connect();
  }

  function stop() {
    state.stopped = true;
    state.connected = false;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state.eventSource) {
      try {
        state.eventSource.close();
      } catch {
        // Ignore close errors.
      }
      state.eventSource = null;
    }
    setStatus("Stopped.");
  }

  window[GLOBAL_KEY] = {
    sessionId,
    serverOrigin,
    start,
    stop,
    status() {
      return {
        sessionId,
        serverOrigin,
        connected: state.connected,
        lastStatus: state.lastStatus,
        lastCommandId: state.lastCommandId,
        lastError: state.lastError,
        lastPingAt: state.lastPingAt,
      };
    },
  };

  setStatus(`Target helper booted for session "${sessionId}".`);
  start();
}());
