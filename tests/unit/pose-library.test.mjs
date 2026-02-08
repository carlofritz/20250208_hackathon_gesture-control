import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { PoseLibrary } from "../../src/core/pose-library.js";
import { buildLandmarks, installWindowStub } from "./helpers/test-env.mjs";

function snapshotWithEmbedding(slotIndex, sampleIndex, embeddingValue) {
  return {
    slotIndex,
    label: `pose_${slotIndex}`,
    capturedAt: new Date(1700000000000 + sampleIndex * 1000).toISOString(),
    handedness: "Right",
    handednessScore: 0.9,
    rawLandmarks: [{}],
    estimation: {
      embedding: [embeddingValue],
      pairDistances: { thumbIndex: 0 },
    },
  };
}

describe("PoseLibrary", () => {
  let cleanup;

  beforeEach(() => {
    cleanup = installWindowStub();
  });

  afterEach(() => {
    cleanup.restore();
  });

  it("keeps only the newest maxSamplesPerSlot samples per slot", () => {
    const library = new PoseLibrary({
      maxPoses: 3,
      maxSamplesPerSlot: 2,
    });

    const handA = { landmarks: buildLandmarks(0, 0), handedness: "Right", score: 0.9 };
    const handB = { landmarks: buildLandmarks(0.2, 0.1), handedness: "Right", score: 0.9 };
    const handC = { landmarks: buildLandmarks(0.4, 0.2), handedness: "Right", score: 0.9 };

    library.captureAt(0, handA, { provider: "test" });
    library.captureAt(0, handB, { provider: "test" });
    library.captureAt(0, handC, { provider: "test" });

    const slot = library.getSlot(0);
    expect(slot.samples).toHaveLength(2);
    // Oldest sample should be dropped.
    expect(slot.samples[0].sampleId).not.toBe(slot.samples[1].sampleId);
  });

  it("matches slots using top-k averaged sample distance, not best sample only", () => {
    const library = new PoseLibrary({
      maxPoses: 3,
      initialPoses: {
        labels: ["pose_0", "pose_1", "pose_2"],
        slots: [
          {
            slotIndex: 0,
            label: "pose_0",
            samples: [
              snapshotWithEmbedding(0, 0, 0.1),
              snapshotWithEmbedding(0, 1, 0.2),
              snapshotWithEmbedding(0, 2, 0.3),
              snapshotWithEmbedding(0, 3, 1.0),
            ],
          },
          {
            slotIndex: 1,
            label: "pose_1",
            samples: [snapshotWithEmbedding(1, 0, 0.15)],
          },
          null,
        ],
      },
    });

    const match = library.matchHand({
      landmarks: [],
      poseFeatures: {
        embedding: [0],
        pairDistances: { thumbIndex: 0 },
      },
    });

    // If best-single-sample was used, slot 0 (0.1) would win.
    // With top-k average (k=3), slot 1 should win.
    expect(match).toBeTruthy();
    expect(match.slotIndex).toBe(1);
    expect(match.source).toBe("template-samples");
    expect(match.sampleCount).toBe(1);
  });

  it("returns null when no slot distance is under threshold", () => {
    const library = new PoseLibrary({
      maxPoses: 1,
      initialPoses: {
        labels: ["pose_0"],
        slots: [
          {
            slotIndex: 0,
            label: "pose_0",
            samples: [snapshotWithEmbedding(0, 0, 9)],
          },
        ],
      },
      matchThreshold: 0.13,
    });

    const match = library.matchHand({
      landmarks: [],
      poseFeatures: {
        embedding: [0],
        pairDistances: { thumbIndex: 0 },
      },
    });

    expect(match).toBeNull();
  });

  it("restores a saved snapshot with labels and keypoint samples", () => {
    const library = new PoseLibrary({
      maxPoses: 3,
    });

    const rightHand = { landmarks: buildLandmarks(0, 0), handedness: "Right", score: 0.9 };
    const leftHand = { landmarks: buildLandmarks(0.3, 0.1), handedness: "Left", score: 0.88 };

    library.captureAt(0, rightHand, { provider: "test" });
    library.setSlotLabel(0, "reader_pose");
    const snapshotToRestore = library.listSnapshots().at(-1)?.id;

    library.captureAt(1, leftHand, { provider: "test" });
    expect(library.getSlot(1)?.samples?.length ?? 0).toBe(1);

    expect(snapshotToRestore).toBeTruthy();
    const restored = library.restoreSnapshot(snapshotToRestore);
    expect(restored).toBe(true);

    expect(library.getSlotLabel(0)).toBe("reader_pose");
    expect(library.getSlot(0)?.samples?.length ?? 0).toBe(1);
    expect(library.getSlot(1)).toBeNull();
  });
});
