import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { EventBus } from "../../src/core/event-bus.js";
import { HarborTriggerAdapter } from "../../src/integrations/harbor-trigger-adapter.js";
import { installWindowStub } from "./helpers/test-env.mjs";

function buildDetail(withModifier = true) {
  const primary = {
    handedness: "Right",
    score: 0.9,
    gestures: ["victory"],
    poseMatch: {
      slotIndex: 2,
      label: "peace",
      distance: 0.02,
      sampleCount: 4,
      source: "template-samples",
    },
    metrics: { pinchDistance: 0.2 },
  };

  const secondary = {
    handedness: "Left",
    score: 0.8,
    gestures: withModifier ? ["fist"] : ["open_palm"],
    poseMatch: null,
  };

  return {
    trigger: {
      id: "pose-2-trigger",
      poseSlot: 2,
      action: { type: "harbor-pose-action" },
    },
    hand: primary,
    hands: [primary, secondary],
    heldMs: 432,
  };
}

describe("HarborTriggerAdapter", () => {
  let cleanup;

  beforeEach(() => {
    cleanup = installWindowStub();
  });

  afterEach(() => {
    cleanup.restore();
  });

  it("emits modifier metadata when secondary-hand fist is present", async () => {
    const eventBus = new EventBus();
    const adapter = new HarborTriggerAdapter(eventBus);
    const emitted = [];

    eventBus.on("trigger:dispatched", (event) => emitted.push(event.detail));

    await adapter.dispatch(buildDetail(true));

    expect(emitted).toHaveLength(1);
    expect(emitted[0].triggerPoseSlot).toBe(2);
    expect(emitted[0].modifier.detected).toBe(true);
    expect(emitted[0].modifier.gesture).toBe("fist");
    expect(emitted[0].modifier.source).toBe("secondary-hand");
    expect(emitted[0].hands).toHaveLength(2);
  });

  it("keeps modifier disabled when no secondary-hand fist exists", async () => {
    const eventBus = new EventBus();
    const adapter = new HarborTriggerAdapter(eventBus);
    const emitted = [];

    eventBus.on("trigger:dispatched", (event) => emitted.push(event.detail));

    await adapter.dispatch(buildDetail(false));

    expect(emitted).toHaveLength(1);
    expect(emitted[0].modifier.detected).toBe(false);
    expect(emitted[0].modifier.gesture).toBeNull();
  });
});

