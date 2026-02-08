export const TRIGGER_CONFIG = [
  {
    id: "pose-0-trigger",
    poseSlot: 0,
    hand: "any",
    holdMs: 420,
    cooldownMs: 1200,
    action: {
      type: "harbor-pose-action",
      defaultActionId: "read_summarize",
    },
  },
  {
    id: "pose-1-trigger",
    poseSlot: 1,
    hand: "any",
    holdMs: 420,
    cooldownMs: 1200,
    action: {
      type: "harbor-pose-action",
      defaultActionId: "screenshot_analyze",
    },
  },
  {
    id: "pose-2-trigger",
    poseSlot: 2,
    hand: "any",
    holdMs: 420,
    cooldownMs: 1200,
    action: {
      type: "harbor-pose-action",
      defaultActionId: "conversation_site_brief",
    },
  },
];
