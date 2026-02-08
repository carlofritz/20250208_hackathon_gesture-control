// Paste exported defaults here to hardcode templates at build time.
// Supported forms:
// 1) Legacy array: [slot0, slot1, slot2]
// 2) Object: { labels: ["thumbs_up","palm","peace"], slots: [slot0, slot1, slot2] }
// Each slot can be null or { slotIndex, label, samples: [snapshot...] }.
export const HARDCODED_POSES = {
  version: 2,
  labels: ["thumbs_up", "palm", "peace"],
  slots: [null, null, null],
};
