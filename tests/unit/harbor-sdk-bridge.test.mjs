import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { HARBOR_ACTION_BY_ID } from "../../src/config/harbor-integration.js";
import { HarborSdkBridge } from "../../src/integrations/harbor-sdk-bridge.js";
import { installWindowStub } from "./helpers/test-env.mjs";

function createBridge(settingsOverride = {}) {
  const emitted = [];
  const bridge = new HarborSdkBridge({
    eventBus: {
      emit(type, detail) {
        emitted.push({ type, detail });
      },
    },
    settings: settingsOverride,
  });
  return { bridge, emitted };
}

describe("HarborSdkBridge", () => {
  let cleanup;

  beforeEach(() => {
    cleanup = installWindowStub({
      confirm: () => true,
    });
  });

  afterEach(() => {
    cleanup.restore();
  });

  it("routes to alternate action when modifier is detected", async () => {
    const { bridge, emitted } = createBridge({
      mapping: {
        0: "research_agent",
        1: "screenshot_analyze",
        2: "conversation_site_brief",
      },
      modifier: {
        enabled: true,
        strategy: "secondary_hand",
        gesture: "fist",
        perPoseGesture: {
          0: "fist",
          1: "fist",
          2: "fist",
        },
        perPoseAltAction: {
          0: "research_agent_alt",
          1: "screenshot_analyze_alt",
          2: "conversation_live_elevenlabs",
        },
      },
      safetyMode: "confirm_each",
    });

    bridge.ensureApis = vi.fn();
    bridge.ensurePermissions = vi.fn(async () => {});
    bridge.runAction = vi.fn(async (actionId) => ({
      output: `ran:${actionId}`,
      meta: {},
    }));

    await bridge.handleTriggerEvent({
      detail: {
        pose: { slotIndex: 2, label: "peace" },
        handedness: "right",
        hands: [
          { isPrimary: true, handedness: "right", gestures: ["victory"] },
          { isPrimary: false, handedness: "left", gestures: ["fist"] },
        ],
      },
    });

    expect(bridge.runAction).toHaveBeenCalledWith(
      "conversation_live_elevenlabs",
      expect.objectContaining({
        poseSlot: 2,
        baseActionId: "conversation_site_brief",
      }),
    );

    const resultEvent = emitted.find((entry) => entry.type === "harbor:bridge-result");
    expect(resultEvent).toBeTruthy();
    expect(resultEvent.detail.actionId).toBe("conversation_live_elevenlabs");
    expect(resultEvent.detail.baseActionId).toBe("conversation_site_brief");
    expect(resultEvent.detail.modifier.detected).toBe(true);
  });

  it("keeps base action when modifier routing is disabled", () => {
    const { bridge } = createBridge({
      mapping: {
        0: "research_agent",
      },
      modifier: {
        enabled: false,
        strategy: "secondary_hand",
        gesture: "fist",
        perPoseGesture: {
          0: "fist",
          1: "fist",
          2: "fist",
        },
        perPoseAltAction: {
          0: "research_agent_alt",
          1: "screenshot_analyze_alt",
          2: "conversation_live_elevenlabs",
        },
      },
    });

    const routing = bridge.resolveActionRouting(0, {
      handedness: "right",
      hands: [
        { isPrimary: true, handedness: "right", gestures: ["thumbs_up"] },
        { isPrimary: false, handedness: "left", gestures: ["fist"] },
      ],
    });

    expect(routing.baseActionId).toBe("research_agent");
    expect(routing.actionId).toBe("research_agent");
    expect(routing.modifier.detected).toBe(false);
  });

  it("throws actionable capability error when research APIs are unavailable", () => {
    globalThis.window.ai = {};
    globalThis.window.agent = {
      browser: {
        activeTab: {
          readability() {},
        },
      },
    };

    const { bridge } = createBridge();
    const researchAction = HARBOR_ACTION_BY_ID.get("research_agent");

    expect(() => bridge.ensureApis(researchAction)).toThrow("browser.tabs.create() is unavailable");
  });

  it("streams agent_run_brief events and returns final output", async () => {
    globalThis.window.ai = {};
    globalThis.window.agent = {
      browser: {
        activeTab: {
          readability: vi.fn(async () => ({
            title: "Demo page",
            text: "Testing page content.",
          })),
        },
      },
      run: async function* runMock() {
        yield { type: "status", message: "starting" };
        yield { type: "tool_call", tool: "time-wasm/time.now", args: { timezone: "UTC" } };
        yield { type: "tool_result", tool: "time-wasm/time.now", result: { now: "10:00" } };
        yield { type: "token", token: "partial output" };
        yield { type: "final", output: "final output" };
      },
    };

    const { bridge } = createBridge();
    const result = await bridge.runAction("agent_run_brief", {
      poseSlot: 1,
      poseLabel: "palm",
      payload: {},
    });

    expect(result.output).toBe("final output");
    expect(result.meta.mode).toBe("agent.run");
    expect(result.meta.eventCounts.tool_call).toBe(1);
    expect(result.meta.eventCounts.tool_result).toBe(1);
    expect(result.meta.eventCounts.final).toBe(1);
    expect(result.meta.toolTrace).toHaveLength(2);
  });

  it("throws actionable capability error when agent.run is unavailable", () => {
    globalThis.window.ai = {};
    globalThis.window.agent = {
      browser: {
        activeTab: {
          readability() {},
        },
      },
    };

    const { bridge } = createBridge();
    const action = HARBOR_ACTION_BY_ID.get("agent_run_brief");

    expect(() => bridge.ensureApis(action)).toThrow("agent.run() is unavailable");
  });

  it("falls back to read_summarize when agent.run is unavailable", async () => {
    const { bridge, emitted } = createBridge({
      mapping: {
        0: "agent_run_brief",
        1: "none",
        2: "none",
      },
      safetyMode: "confirm_each",
    });

    bridge.ensureApis = vi.fn((action) => {
      if (action?.id === "agent_run_brief") {
        const error = new Error("agent.run() is unavailable. Enable toolCalling feature flag.");
        error.code = "ERR_FEATURE_DISABLED";
        throw error;
      }
    });
    bridge.ensurePermissions = vi.fn(async () => {});
    bridge.runReadSummarizeAction = vi.fn(async () => ({
      output: "fallback output",
      meta: { pageTitle: "Fallback Page" },
    }));

    await bridge.handleTriggerEvent({
      detail: {
        pose: { slotIndex: 0, label: "thumbs_up" },
      },
    });

    const resultEvent = emitted.find((entry) => entry.type === "harbor:bridge-result");
    expect(resultEvent).toBeTruthy();
    expect(resultEvent.detail.actionId).toBe("agent_run_brief");
    expect(resultEvent.detail.output).toBe("fallback output");
    expect(resultEvent.detail.meta.fallbackFrom).toBe("agent_run_brief");
    expect(resultEvent.detail.meta.fallbackActionId).toBe("read_summarize");
    expect(bridge.runReadSummarizeAction).toHaveBeenCalledTimes(1);
  });

  it("executes remote_read_screenshot_summarize through bridge relay", async () => {
    globalThis.fetch = vi.fn(async (url, options) => {
      if (String(url).startsWith("/api/bridge/command")) {
        return {
          ok: true,
          async json() {
            return {
              ok: true,
              sessionId: "newsdemo",
              commandId: "cmd-123",
              result: {
                ok: true,
                output: "Remote summary output",
                meta: {
                  targetTitle: "Example News",
                  targetUrl: "https://example.com/news",
                  degraded: false,
                },
              },
            };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            helpersConnected: 1,
          };
        },
      };
    });

    const { bridge } = createBridge({
      remoteBridge: {
        sessionId: "newsdemo",
      },
    });

    const result = await bridge.runAction("remote_read_screenshot_summarize", {
      poseSlot: 0,
      poseLabel: "thumbs_up",
      payload: {},
    });

    expect(result.output).toBe("Remote summary output");
    expect(result.meta.remoteBridge).toBe(true);
    expect(result.meta.remoteSessionId).toBe("newsdemo");
    expect(result.meta.targetTitle).toBe("Example News");
    expect(result.meta.targetUrl).toBe("https://example.com/news");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/bridge/command",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("allows remote action API checks without window.agent/window.ai", () => {
    globalThis.window.ai = undefined;
    globalThis.window.agent = undefined;

    const { bridge } = createBridge();
    const action = HARBOR_ACTION_BY_ID.get("remote_read_screenshot_summarize");

    expect(() => bridge.ensureApis(action)).not.toThrow();
  });
});
