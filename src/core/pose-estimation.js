const EPSILON = 1e-6;

function round(value, precision = 6) {
  return Number(value.toFixed(precision));
}

function distance(a, b) {
  const dx = (a.x ?? 0) - (b.x ?? 0);
  const dy = (a.y ?? 0) - (b.y ?? 0);
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function serializeLandmarks(landmarks, precision = 6) {
  return landmarks.map((point) => ({
    x: round(point.x ?? 0, precision),
    y: round(point.y ?? 0, precision),
    z: round(point.z ?? 0, precision),
  }));
}

export function normalizeLandmarks(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) {
    return [];
  }

  const wrist = landmarks[0];

  const translated = landmarks.map((point) => ({
    x: (point.x ?? 0) - (wrist.x ?? 0),
    y: (point.y ?? 0) - (wrist.y ?? 0),
    z: (point.z ?? 0) - (wrist.z ?? 0),
  }));

  let scale = EPSILON;
  for (const point of translated) {
    const pointDistance = Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z);
    if (pointDistance > scale) {
      scale = pointDistance;
    }
  }

  return translated.map((point) => ({
    x: point.x / scale,
    y: point.y / scale,
    z: point.z / scale,
  }));
}

export function flattenLandmarks(landmarks, precision = 6) {
  const embedding = [];
  for (const point of landmarks) {
    embedding.push(round(point.x ?? 0, precision));
    embedding.push(round(point.y ?? 0, precision));
    embedding.push(round(point.z ?? 0, precision));
  }
  return embedding;
}

export function embeddingDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    return Infinity;
  }

  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    total += Math.abs(a[i] - b[i]);
  }

  return total / a.length;
}

export function estimatePoseFeatures(landmarks) {
  const normalizedLandmarks = normalizeLandmarks(landmarks);

  if (!normalizedLandmarks.length) {
    return {
      normalizedLandmarks: [],
      embedding: [],
      pairDistances: null,
    };
  }

  const pairDistances = {
    thumbIndex: round(distance(normalizedLandmarks[4], normalizedLandmarks[8])),
    indexMiddle: round(distance(normalizedLandmarks[8], normalizedLandmarks[12])),
    middleRing: round(distance(normalizedLandmarks[12], normalizedLandmarks[16])),
    ringPinky: round(distance(normalizedLandmarks[16], normalizedLandmarks[20])),
    wristMiddleTip: round(distance(normalizedLandmarks[0], normalizedLandmarks[12])),
  };

  return {
    normalizedLandmarks: serializeLandmarks(normalizedLandmarks),
    embedding: flattenLandmarks(normalizedLandmarks),
    pairDistances,
  };
}

export function createPoseSnapshot({ slotIndex, label, hand, trackerInfo }) {
  const features = hand.poseFeatures ?? estimatePoseFeatures(hand.landmarks);

  return {
    slotIndex,
    label,
    capturedAt: new Date().toISOString(),
    handedness: hand.handedness ?? "unknown",
    handednessScore: round(hand.score ?? 0, 4),
    rawLandmarks: serializeLandmarks(hand.landmarks),
    estimation: {
      logic:
        "wrist-centered normalization + scale normalization + 63-dim embedding + pairwise geometric distances",
      normalizedLandmarks: features.normalizedLandmarks,
      embedding: features.embedding,
      pairDistances: features.pairDistances,
      classifierMetrics: hand.metrics ?? null,
    },
    mediapipe: trackerInfo ? { ...trackerInfo } : null,
  };
}
