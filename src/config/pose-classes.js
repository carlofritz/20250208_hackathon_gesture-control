export const POSE_CLASSES = [
  {
    slotIndex: 0,
    label: "thumbs_up",
    gesture: "thumbs_up",
    colorClass: "pose-0",
  },
  {
    slotIndex: 1,
    label: "palm",
    gesture: "open_palm",
    colorClass: "pose-1",
  },
  {
    slotIndex: 2,
    label: "peace",
    gesture: "victory",
    colorClass: "pose-2",
  },
];

export const POSE_CLASS_BY_GESTURE = new Map(POSE_CLASSES.map((item) => [item.gesture, item]));
export const POSE_CLASS_BY_SLOT = new Map(POSE_CLASSES.map((item) => [item.slotIndex, item]));
