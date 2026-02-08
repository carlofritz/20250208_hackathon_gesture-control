const DEFAULT_HOLD_MS = 500;
const DEFAULT_COOLDOWN_MS = 1200;

function normalizeHand(handedness) {
  const lower = String(handedness || "").toLowerCase();
  if (lower.includes("left")) return "left";
  if (lower.includes("right")) return "right";
  return "unknown";
}

export class TriggerEngine {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.triggers = [];
    this.states = new Map();
  }

  register(triggerDefinitions = []) {
    this.triggers = triggerDefinitions.map((trigger) => ({
      ...trigger,
      poseSlot: Number.isInteger(trigger.poseSlot) ? trigger.poseSlot : null,
      hand: trigger.hand || "any",
      holdMs: trigger.holdMs ?? DEFAULT_HOLD_MS,
      cooldownMs: trigger.cooldownMs ?? DEFAULT_COOLDOWN_MS,
    }));

    this.states.clear();
    for (const trigger of this.triggers) {
      this.states.set(trigger.id, {
        startedAt: null,
        ready: true,
        lastFiredAt: -Infinity,
      });
    }
  }

  processFrame({ timestamp, hands }) {
    for (const trigger of this.triggers) {
      this.processTrigger(trigger, timestamp, hands);
    }
  }

  processTrigger(trigger, timestamp, hands) {
    const state = this.states.get(trigger.id);
    if (!state) {
      return;
    }

    const matchingHand = hands.find((hand) => this.isMatchingHand(trigger, hand));

    if (!matchingHand) {
      state.startedAt = null;
      state.ready = true;
      return;
    }

    if (state.startedAt === null) {
      state.startedAt = timestamp;
    }

    if (!state.ready) {
      return;
    }

    const heldMs = timestamp - state.startedAt;
    const cooldownReady = timestamp - state.lastFiredAt >= trigger.cooldownMs;

    if (heldMs >= trigger.holdMs && cooldownReady) {
      state.lastFiredAt = timestamp;
      state.ready = false;

      this.eventBus.emit("trigger:fired", {
        trigger,
        hand: matchingHand,
        hands,
        heldMs,
        timestamp,
      });
    }
  }

  isMatchingHand(trigger, hand) {
    if (Number.isInteger(trigger.poseSlot)) {
      if (hand.poseMatch?.slotIndex !== trigger.poseSlot) {
        return false;
      }
    } else {
      if (!trigger.gesture || !hand.gestures.includes(trigger.gesture)) {
        return false;
      }
    }

    if (trigger.hand === "any") {
      return true;
    }

    return normalizeHand(hand.handedness) === trigger.hand;
  }
}
