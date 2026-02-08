import { describe, it, expect } from "vitest";

import {
  DEFAULT_HARBOR_SETTINGS,
  HARBOR_ACTION_BY_ID,
  normalizeHarborSettings,
} from "../../src/config/harbor-integration.js";

describe("normalizeHarborSettings", () => {
  it("falls back to defaults for unknown actions and invalid mode", () => {
    const normalized = normalizeHarborSettings({
      mapping: {
        0: "not-real",
        1: "screenshot_analyze",
        2: "also-not-real",
      },
      safetyMode: "invalid",
    });

    expect(normalized.mapping[0]).toBe("none");
    expect(normalized.mapping[1]).toBe("screenshot_analyze");
    expect(normalized.mapping[2]).toBe("none");
    expect(normalized.safetyMode).toBe("confirm_each");
  });

  it("normalizes modifier and clamps research source count", () => {
    const normalized = normalizeHarborSettings({
      modifier: {
        enabled: true,
        strategy: "unsupported",
        gesture: "unknown-gesture",
        perPoseGesture: {
          0: "fist",
          1: "invalid",
          2: "pinch",
        },
        perPoseAltAction: {
          0: "research_agent_alt",
          1: "nope",
          2: "conversation_live_elevenlabs",
        },
      },
      research: {
        sourceCountDefault: 42,
      },
    });

    expect(normalized.modifier.strategy).toBe("secondary_hand");
    expect(normalized.modifier.gesture).toBe(DEFAULT_HARBOR_SETTINGS.modifier.gesture);
    expect(normalized.modifier.perPoseGesture[0]).toBe("fist");
    expect(normalized.modifier.perPoseGesture[1]).toBe(DEFAULT_HARBOR_SETTINGS.modifier.gesture);
    expect(normalized.modifier.perPoseGesture[2]).toBe("pinch");
    expect(normalized.modifier.perPoseAltAction[0]).toBe("research_agent_alt");
    expect(normalized.modifier.perPoseAltAction[1]).toBe("none");
    expect(normalized.modifier.perPoseAltAction[2]).toBe("conversation_live_elevenlabs");
    expect(normalized.research.sourceCountDefault).toBe(8);
  });

  it("keeps explicit elevenlabs values and cooldown bounds", () => {
    const normalized = normalizeHarborSettings({
      cooldownMs: 999999,
      elevenLabs: {
        agentId: "  agent_123  ",
        voiceId: "  voice_abc  ",
      },
      remoteBridge: {
        sessionId: " news-demo/session#1 ",
      },
    });

    expect(normalized.cooldownMs).toBe(5000);
    expect(normalized.elevenLabs.agentId).toBe("agent_123");
    expect(normalized.elevenLabs.voiceId).toBe("voice_abc");
    expect(normalized.remoteBridge.sessionId).toBe("news-demosession1");
  });

  it("includes agent_run_brief action with agent scopes", () => {
    const action = HARBOR_ACTION_BY_ID.get("agent_run_brief");
    expect(action).toBeTruthy();
    expect(action.requiredScopes).toEqual(["model:tools", "model:prompt"]);
    expect(action.requiresBrowserApi).toBe(false);
  });

  it("includes remote_read_screenshot_summarize action", () => {
    const action = HARBOR_ACTION_BY_ID.get("remote_read_screenshot_summarize");
    expect(action).toBeTruthy();
    expect(action.requiredScopes).toEqual([]);
    expect(action.requiresBrowserApi).toBe(false);
  });
});
