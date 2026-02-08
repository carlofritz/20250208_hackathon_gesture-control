import { describe, it, expect } from "vitest";

import { TriggerEngine } from "../../src/core/trigger-engine.js";

function matchingHand(slotIndex = 0) {
  return {
    handedness: "Right",
    gestures: [],
    poseMatch: { slotIndex },
  };
}

describe("TriggerEngine", () => {
  it("fires only after hold duration and includes all hands in payload", () => {
    const emitted = [];
    const engine = new TriggerEngine({
      emit(type, detail) {
        emitted.push({ type, detail });
      },
    });

    engine.register([
      {
        id: "pose0",
        poseSlot: 0,
        holdMs: 100,
        cooldownMs: 200,
      },
    ]);

    const hands = [matchingHand(0), matchingHand(1)];
    engine.processFrame({ timestamp: 0, hands });
    engine.processFrame({ timestamp: 50, hands });
    expect(emitted).toHaveLength(0);

    engine.processFrame({ timestamp: 100, hands });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe("trigger:fired");
    expect(emitted[0].detail.hands).toEqual(hands);
    expect(emitted[0].detail.heldMs).toBe(100);
  });

  it("respects cooldown and can fire again after hand reset + cooldown elapsed", () => {
    const emitted = [];
    const engine = new TriggerEngine({
      emit(type, detail) {
        emitted.push({ type, detail });
      },
    });

    engine.register([
      {
        id: "pose0",
        poseSlot: 0,
        holdMs: 100,
        cooldownMs: 200,
      },
    ]);

    const hands = [matchingHand(0)];
    engine.processFrame({ timestamp: 0, hands });
    engine.processFrame({ timestamp: 100, hands }); // first fire
    expect(emitted).toHaveLength(1);

    engine.processFrame({ timestamp: 150, hands }); // still matched; ready false
    expect(emitted).toHaveLength(1);

    engine.processFrame({ timestamp: 160, hands: [] }); // reset ready
    engine.processFrame({ timestamp: 250, hands }); // hold started again
    engine.processFrame({ timestamp: 349, hands }); // hold not met
    expect(emitted).toHaveLength(1);

    engine.processFrame({ timestamp: 450, hands }); // cooldown elapsed + hold met
    expect(emitted).toHaveLength(2);
    expect(emitted[1].detail.timestamp).toBe(450);
  });
});

