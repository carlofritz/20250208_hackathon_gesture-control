function normalizeHand(handedness) {
  const lower = String(handedness || "").toLowerCase();
  if (lower.includes("left")) return "left";
  if (lower.includes("right")) return "right";
  return "unknown";
}

function summarizeHand(hand, isPrimary = false) {
  return {
    handedness: normalizeHand(hand?.handedness),
    gestures: Array.isArray(hand?.gestures) ? [...hand.gestures] : [],
    poseSlot: Number.isInteger(hand?.poseMatch?.slotIndex) ? hand.poseMatch.slotIndex : null,
    score: Number(hand?.score ?? 0),
    isPrimary,
  };
}

function detectDefaultModifier(hands) {
  const secondary = hands.find((hand) => !hand.isPrimary && hand.gestures.includes("fist"));
  if (secondary) {
    return {
      detected: true,
      gesture: "fist",
      handedness: secondary.handedness,
      source: "secondary-hand",
    };
  }

  return {
    detected: false,
    gesture: null,
    handedness: null,
    source: "none",
  };
}

export class HarborTriggerAdapter {
  constructor(eventBus, options = {}) {
    this.eventBus = eventBus;
    this.options = {
      actionHandlers: {},
      ...options,
    };
    this.unsubscribe = null;
  }

  start() {
    if (this.unsubscribe) {
      return;
    }

    this.unsubscribe = this.eventBus.on("trigger:fired", (event) => {
      void this.dispatch(event.detail);
    });
  }

  stop() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  async dispatch(detail) {
    const poseMatch = detail.hand?.poseMatch ?? null;
    const hands = Array.isArray(detail.hands)
      ? detail.hands.map((hand) => summarizeHand(hand, hand === detail.hand))
      : [summarizeHand(detail.hand, true)];

    const payload = {
      triggerId: detail.trigger.id,
      gesture: detail.trigger.gesture ?? poseMatch?.label ?? null,
      triggerPoseSlot: Number.isInteger(detail.trigger.poseSlot) ? detail.trigger.poseSlot : null,
      action: detail.trigger.action ?? null,
      handedness: normalizeHand(detail.hand?.handedness),
      timestamp: new Date().toISOString(),
      heldMs: Math.round(detail.heldMs ?? 0),
      metrics: detail.hand?.metrics ?? null,
      pose: poseMatch
        ? {
            slotIndex: poseMatch.slotIndex,
            label: poseMatch.label ?? null,
            distance: poseMatch.distance ?? null,
            sampleCount: poseMatch.sampleCount ?? null,
            source: poseMatch.source ?? null,
          }
        : null,
      hands,
      modifier: detectDefaultModifier(hands),
    };

    try {
      window.dispatchEvent(new CustomEvent("harbor:gesture-trigger", { detail: payload }));
      this.eventBus.emit("trigger:dispatched", payload);

      const actionType = payload.action?.type;
      const actionHandler = actionType ? this.options.actionHandlers[actionType] : null;

      if (typeof actionHandler === "function") {
        await actionHandler(payload);
      }
    } catch (error) {
      this.eventBus.emit("trigger:dispatch-error", {
        payload,
        error,
      });
    }
  }
}
