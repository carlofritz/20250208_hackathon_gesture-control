const THUMB_TIP = 4;
const INDEX_TIP = 8;

const PINCH_THRESHOLD = 0.06;

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function isFingerExtended(landmarks, tip, pip, mcp) {
  return landmarks[tip].y < landmarks[pip].y && landmarks[pip].y < landmarks[mcp].y;
}

function isThumbExtended(landmarks, handedness) {
  const side = String(handedness || "").toLowerCase();
  const tip = landmarks[4];
  const ip = landmarks[3];
  const mcp = landmarks[2];
  const wrist = landmarks[0];

  const horizontal =
    side === "right"
      ? tip.x < ip.x && ip.x < mcp.x
      : tip.x > ip.x && ip.x > mcp.x;

  const vertical = tip.y < wrist.y - 0.03;
  return horizontal || vertical;
}

export function classifyHandGestures(landmarks, handedness) {
  if (!landmarks || landmarks.length < 21) {
    return {
      gestures: [],
      metrics: {
        pinchDistance: Infinity,
        fingers: null,
      },
    };
  }

  const fingers = {
    thumb: isThumbExtended(landmarks, handedness),
    index: isFingerExtended(landmarks, 8, 6, 5),
    middle: isFingerExtended(landmarks, 12, 10, 9),
    ring: isFingerExtended(landmarks, 16, 14, 13),
    pinky: isFingerExtended(landmarks, 20, 18, 17),
  };

  const pinchDistance = distance(landmarks[THUMB_TIP], landmarks[INDEX_TIP]);
  const isPinch = pinchDistance < PINCH_THRESHOLD;

  const extendedCount = Object.values(fingers).filter(Boolean).length;
  const isOpenPalm = extendedCount >= 4 && !isPinch;
  const isFist = extendedCount === 0 && !isPinch;
  const isVictory = fingers.index && fingers.middle && !fingers.ring && !fingers.pinky && !isPinch;
  const isThumbsUp =
    fingers.thumb &&
    !fingers.index &&
    !fingers.middle &&
    !fingers.ring &&
    !fingers.pinky &&
    landmarks[4].y < landmarks[0].y - 0.05;

  const gestures = [];
  if (isPinch) gestures.push("pinch");
  if (isVictory) gestures.push("victory");
  if (isThumbsUp) gestures.push("thumbs_up");
  if (isOpenPalm) gestures.push("open_palm");
  if (isFist) gestures.push("fist");

  return {
    gestures,
    metrics: {
      pinchDistance,
      extendedCount,
      fingers,
    },
  };
}
