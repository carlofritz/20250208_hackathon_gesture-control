import { createPoseSnapshot, embeddingDistance, estimatePoseFeatures } from "./pose-estimation.js";

const STORAGE_KEY = "gesture-control.pose-library.v1";
const SNAPSHOT_STORAGE_KEY = "gesture-control.pose-snapshots.v1";
const DEFAULT_MATCH_THRESHOLD = 0.13;
const DEFAULT_MAX_SAMPLES_PER_SLOT = 24;
const DEFAULT_MAX_SNAPSHOTS = 12;

function sanitizeLabel(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function clonePose(pose) {
  if (!pose) {
    return null;
  }
  return JSON.parse(JSON.stringify(pose));
}

function geometryDistance(a, b) {
  if (!a || !b) {
    return Infinity;
  }

  const keys = Object.keys(a).filter((key) => typeof a[key] === "number" && typeof b[key] === "number");
  if (!keys.length) {
    return Infinity;
  }

  let total = 0;
  for (const key of keys) {
    total += Math.abs(a[key] - b[key]);
  }

  return total / keys.length;
}

function normalizeSnapshot(snapshot, slotIndex, slotLabel, sampleIndex = 0) {
  if (!snapshot || !snapshot.rawLandmarks || !snapshot.estimation?.embedding) {
    return null;
  }

  return {
    ...snapshot,
    slotIndex,
    label: slotLabel,
    sampleId:
      snapshot.sampleId ||
      `slot-${slotIndex}-sample-${sampleIndex}-${snapshot.capturedAt || Date.now()}`,
  };
}

function normalizeSlotValue(value, slotIndex, slotLabel) {
  if (!value) {
    return null;
  }

  if (Array.isArray(value.samples)) {
    const samples = value.samples
      .map((sample, sampleIndex) => normalizeSnapshot(sample, slotIndex, slotLabel, sampleIndex))
      .filter(Boolean);

    if (!samples.length) {
      return null;
    }

    return {
      slotIndex,
      label: slotLabel,
      samples,
      updatedAt: value.updatedAt || samples[samples.length - 1].capturedAt,
    };
  }

  const singleSnapshot = normalizeSnapshot(value, slotIndex, slotLabel, 0);
  if (!singleSnapshot) {
    return null;
  }

  return {
    slotIndex,
    label: slotLabel,
    samples: [singleSnapshot],
    updatedAt: singleSnapshot.capturedAt,
  };
}

export class PoseLibrary {
  constructor(options = {}) {
    this.maxPoses = options.maxPoses ?? 3;
    this.eventBus = options.eventBus ?? null;
    this.matchThreshold = options.matchThreshold ?? DEFAULT_MATCH_THRESHOLD;
    this.maxSamplesPerSlot = options.maxSamplesPerSlot ?? DEFAULT_MAX_SAMPLES_PER_SLOT;
    this.snapshotStorageKey = options.snapshotStorageKey ?? SNAPSHOT_STORAGE_KEY;
    this.maxSnapshots = options.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS;
    this.snapshots = [];
    const requestedSlotLabels = Array.isArray(options.slotLabels) ? options.slotLabels : [];
    this.slotLabels = Array.from({ length: this.maxPoses }, (_, index) =>
      sanitizeLabel(requestedSlotLabels[index], `pose_${index}`),
    );

    this.poses = Array.from({ length: this.maxPoses }, () => null);
    this.nextCaptureIndex = 0;

    const restored = this.load();
    if (!restored) {
      this.seedFromHardcoded(options.initialPoses ?? []);
    }

    this.loadSnapshots();
    this.captureSnapshot(restored ? "session-restored" : "seeded-defaults", {
      emit: false,
      force: false,
    });
  }

  getSlotLabel(slotIndex) {
    return this.slotLabels[slotIndex] ?? `pose_${slotIndex}`;
  }

  getSlotLabels() {
    return [...this.slotLabels];
  }

  exportState() {
    return {
      version: 2,
      labels: this.getSlotLabels(),
      slots: this.list(),
    };
  }

  getSampleCounts() {
    return Array.from({ length: this.maxPoses }, (_, index) => this.poses[index]?.samples?.length ?? 0);
  }

  buildStateSignature(state) {
    try {
      return JSON.stringify(state);
    } catch {
      return "";
    }
  }

  normalizeState(raw = {}) {
    let rawSlots = null;
    let rawLabels = null;

    if (Array.isArray(raw)) {
      rawSlots = raw;
    } else if (raw && typeof raw === "object") {
      rawSlots = Array.isArray(raw.slots)
        ? raw.slots
        : Array.isArray(raw.poses)
          ? raw.poses
          : null;
      rawLabels = Array.isArray(raw.labels) ? raw.labels : null;
    }

    if (!Array.isArray(rawSlots)) {
      return null;
    }

    const labels = Array.from({ length: this.maxPoses }, (_, index) =>
      sanitizeLabel(rawLabels?.[index], this.getSlotLabel(index)),
    );

    const slots = Array.from({ length: this.maxPoses }, (_, index) => {
      const value = rawSlots[index] ?? null;
      return normalizeSlotValue(value, index, labels[index]);
    });

    return {
      labels,
      slots,
    };
  }

  importState(rawState, options = {}) {
    const { emit = true, captureSnapshot = true, snapshotReason = "imported-state" } = options;
    const normalized = this.normalizeState(rawState);
    if (!normalized) {
      throw new Error("Invalid pose state. Expected slots/poses array.");
    }

    this.slotLabels = normalized.labels;
    this.poses = normalized.slots;
    this.nextCaptureIndex = this.computeNextCaptureIndex();
    this.persist();

    if (captureSnapshot) {
      this.captureSnapshot(snapshotReason, { emit });
    }

    if (emit && this.eventBus) {
      this.eventBus.emit("pose:state-imported", {
        labels: this.getSlotLabels(),
        poses: this.list(),
      });
    }

    return this.exportState();
  }

  seedFromHardcoded(initialPoses) {
    let rawSlots = null;
    let rawLabels = null;

    if (Array.isArray(initialPoses)) {
      rawSlots = initialPoses;
    } else if (initialPoses && typeof initialPoses === "object") {
      rawSlots = Array.isArray(initialPoses.slots)
        ? initialPoses.slots
        : Array.isArray(initialPoses.poses)
          ? initialPoses.poses
          : null;
      rawLabels = Array.isArray(initialPoses.labels) ? initialPoses.labels : null;
    }

    if (!Array.isArray(rawSlots)) {
      return;
    }

    if (Array.isArray(rawLabels)) {
      for (let i = 0; i < this.maxPoses; i += 1) {
        this.slotLabels[i] = sanitizeLabel(rawLabels[i], this.getSlotLabel(i));
      }
    }

    const seeded = [];
    for (let i = 0; i < this.maxPoses; i += 1) {
      const value = rawSlots[i] ?? null;
      seeded.push(normalizeSlotValue(value, i, this.getSlotLabel(i)));
    }

    this.poses = seeded;
    this.nextCaptureIndex = this.computeNextCaptureIndex();
  }

  computeNextCaptureIndex() {
    const firstEmpty = this.poses.findIndex((slot) => !slot || !slot.samples?.length);
    return firstEmpty === -1 ? 0 : firstEmpty;
  }

  load() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return false;
      }

      const parsed = JSON.parse(raw);
      let rawSlots = null;
      let rawLabels = null;

      if (Array.isArray(parsed)) {
        rawSlots = parsed;
      } else if (parsed && typeof parsed === "object") {
        rawSlots = Array.isArray(parsed.slots)
          ? parsed.slots
          : Array.isArray(parsed.poses)
            ? parsed.poses
            : null;
        rawLabels = Array.isArray(parsed.labels) ? parsed.labels : null;
      }

      if (!Array.isArray(rawSlots)) {
        return false;
      }

      if (Array.isArray(rawLabels)) {
        for (let i = 0; i < this.maxPoses; i += 1) {
          this.slotLabels[i] = sanitizeLabel(rawLabels[i], this.getSlotLabel(i));
        }
      }

      this.poses = Array.from({ length: this.maxPoses }, (_, index) => {
        const value = rawSlots[index] ?? null;
        return normalizeSlotValue(value, index, this.getSlotLabel(index));
      });

      this.nextCaptureIndex = this.computeNextCaptureIndex();
      return true;
    } catch (_error) {
      return false;
    }
  }

  persist() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 2,
          slots: this.poses,
          labels: this.slotLabels,
        }),
      );
    } catch (_error) {
      // Ignore storage failures in private mode or restricted contexts.
    }
  }

  loadSnapshots() {
    try {
      const raw = window.localStorage.getItem(this.snapshotStorageKey);
      if (!raw) {
        this.snapshots = [];
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.snapshots = [];
        return;
      }

      const normalized = parsed
        .map((entry) => this.normalizeSnapshotEntry(entry))
        .filter(Boolean);

      this.snapshots = normalized.slice(-this.maxSnapshots);
    } catch {
      this.snapshots = [];
    }
  }

  persistSnapshots() {
    try {
      window.localStorage.setItem(this.snapshotStorageKey, JSON.stringify(this.snapshots));
    } catch {
      // Ignore storage failures in private mode or restricted contexts.
    }
  }

  normalizeSnapshotEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const normalizedState = this.normalizeState(entry);
    if (!normalizedState) {
      return null;
    }

    const createdAt = Number.parseInt(entry.createdAt, 10);
    const snapshot = {
      id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : `snapshot-${Date.now()}`,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      reason: typeof entry.reason === "string" ? entry.reason : "saved",
      labels: normalizedState.labels,
      slots: normalizedState.slots,
    };
    snapshot.signature = this.buildStateSignature({
      version: 2,
      labels: snapshot.labels,
      slots: snapshot.slots,
    });
    return snapshot;
  }

  summarizeSnapshot(snapshot) {
    return {
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      reason: snapshot.reason,
      labels: [...snapshot.labels],
      sampleCounts: snapshot.slots.map((slot) => slot?.samples?.length ?? 0),
    };
  }

  captureSnapshot(reason = "saved", options = {}) {
    const { emit = true, force = false } = options;
    const state = this.exportState();
    const signature = this.buildStateSignature(state);
    const last = this.snapshots[this.snapshots.length - 1];

    if (!force && last && last.signature === signature) {
      return last.id;
    }

    const snapshot = {
      id: `snapshot-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      createdAt: Date.now(),
      reason,
      labels: state.labels,
      slots: state.slots,
      signature,
    };

    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots = this.snapshots.slice(-this.maxSnapshots);
    }

    this.persistSnapshots();

    if (emit && this.eventBus) {
      this.eventBus.emit("pose:snapshot-created", {
        snapshot: this.summarizeSnapshot(snapshot),
        snapshots: this.listSnapshots(),
      });
    }

    return snapshot.id;
  }

  listSnapshots() {
    return [...this.snapshots].map((snapshot) => this.summarizeSnapshot(snapshot));
  }

  restoreSnapshot(snapshotId) {
    const selected = this.snapshots.find((snapshot) => snapshot.id === snapshotId);
    if (!selected) {
      return false;
    }

    this.importState(
      {
        version: 2,
        labels: selected.labels,
        slots: selected.slots,
      },
      {
        emit: false,
        captureSnapshot: true,
        snapshotReason: `restored:${selected.id}`,
      },
    );

    if (this.eventBus) {
      this.eventBus.emit("pose:snapshot-restored", {
        snapshot: this.summarizeSnapshot(selected),
        snapshots: this.listSnapshots(),
        labels: this.getSlotLabels(),
        poses: this.list(),
      });
    }

    return true;
  }

  list() {
    return this.poses.map((pose) => clonePose(pose));
  }

  getSlot(slotIndex) {
    if (slotIndex < 0 || slotIndex >= this.maxPoses) {
      return null;
    }
    return clonePose(this.poses[slotIndex]);
  }

  setSlotLabel(slotIndex, label) {
    if (slotIndex < 0 || slotIndex >= this.maxPoses) {
      return null;
    }

    const nextLabel = sanitizeLabel(label, this.getSlotLabel(slotIndex));
    this.slotLabels[slotIndex] = nextLabel;

    const slot = this.poses[slotIndex];
    if (slot) {
      slot.label = nextLabel;
      slot.samples = slot.samples.map((sample) => ({
        ...sample,
        slotIndex,
        label: nextLabel,
      }));
    }

    this.persist();
    this.captureSnapshot(`renamed-slot-${slotIndex}`);

    if (this.eventBus) {
      this.eventBus.emit("pose:label-updated", {
        slotIndex,
        label: nextLabel,
        labels: this.getSlotLabels(),
        poses: this.list(),
      });
    }

    return nextLabel;
  }

  clearAll() {
    this.poses = Array.from({ length: this.maxPoses }, () => null);
    this.nextCaptureIndex = 0;
    this.persist();
    this.captureSnapshot("cleared-all-slots");

    if (this.eventBus) {
      this.eventBus.emit("pose:library-cleared", {
        poses: this.list(),
      });
    }
  }

  clearSlot(slotIndex) {
    if (slotIndex < 0 || slotIndex >= this.maxPoses) {
      return;
    }

    this.poses[slotIndex] = null;
    this.nextCaptureIndex = this.computeNextCaptureIndex();
    this.persist();
    this.captureSnapshot(`cleared-slot-${slotIndex}`);

    if (this.eventBus) {
      this.eventBus.emit("pose:slot-cleared", {
        slotIndex,
        poses: this.list(),
      });
    }
  }

  chooseCaptureSlot() {
    const firstEmpty = this.poses.findIndex((slot) => !slot || !slot.samples?.length);
    if (firstEmpty !== -1) {
      return firstEmpty;
    }

    return this.nextCaptureIndex;
  }

  capture(hand, trackerInfo) {
    const slotIndex = this.chooseCaptureSlot();
    return this.captureAt(slotIndex, hand, trackerInfo);
  }

  captureAt(slotIndex, hand, trackerInfo) {
    if (slotIndex < 0 || slotIndex >= this.maxPoses) {
      throw new Error(`Invalid pose slot index: ${slotIndex}`);
    }

    const slotLabel = this.getSlotLabel(slotIndex);
    const snapshot = createPoseSnapshot({
      slotIndex,
      label: slotLabel,
      hand,
      trackerInfo,
    });

    snapshot.sampleId = `slot-${slotIndex}-sample-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const slot = this.poses[slotIndex] ?? {
      slotIndex,
      label: slotLabel,
      samples: [],
      updatedAt: snapshot.capturedAt,
    };

    slot.label = slotLabel;
    slot.samples = [...slot.samples, snapshot];
    if (slot.samples.length > this.maxSamplesPerSlot) {
      slot.samples = slot.samples.slice(-this.maxSamplesPerSlot);
    }

    slot.updatedAt = snapshot.capturedAt;
    this.poses[slotIndex] = slot;

    const firstEmpty = this.poses.findIndex((item) => !item || !item.samples?.length);
    this.nextCaptureIndex = firstEmpty === -1 ? (slotIndex + 1) % this.maxPoses : firstEmpty;

    this.persist();
    this.captureSnapshot(`captured-slot-${slotIndex}`);

    if (this.eventBus) {
      this.eventBus.emit("pose:sample-captured", {
        slotIndex,
        snapshot: clonePose(snapshot),
        sampleCount: slot.samples.length,
        poses: this.list(),
      });
    }

    return clonePose(snapshot);
  }

  matchHand(hand) {
    const activeSlots = this.poses.filter((slot) => slot?.samples?.length);
    if (!activeSlots.length) {
      return null;
    }

    const features = hand.poseFeatures ?? estimatePoseFeatures(hand.landmarks);
    if (!features.embedding?.length) {
      return null;
    }

    let bestSlotMatch = null;

    for (const slot of activeSlots) {
      const sampleScores = [];

      for (let sampleIndex = 0; sampleIndex < slot.samples.length; sampleIndex += 1) {
        const sample = slot.samples[sampleIndex];
        const sampleEmbedding = sample.estimation?.embedding;
        const samplePairs = sample.estimation?.pairDistances;

        const vectorDistance = embeddingDistance(features.embedding, sampleEmbedding);
        const pairDistance = geometryDistance(features.pairDistances, samplePairs);
        if (!Number.isFinite(vectorDistance) || !Number.isFinite(pairDistance)) {
          continue;
        }

        const distance = vectorDistance * 0.8 + pairDistance * 0.2;
        if (!Number.isFinite(distance)) {
          continue;
        }

        sampleScores.push({
          sampleIndex,
          sample,
          distance,
          vectorDistance,
          pairDistance,
        });
      }

      if (!sampleScores.length) {
        continue;
      }

      sampleScores.sort((a, b) => a.distance - b.distance);
      const k = Math.min(3, sampleScores.length);
      const slotDistance =
        sampleScores.slice(0, k).reduce((acc, item) => acc + item.distance, 0) / k;

      const bestSample = sampleScores[0];

      if (!bestSlotMatch || slotDistance < bestSlotMatch.distance) {
        bestSlotMatch = {
          slot,
          distance: slotDistance,
          bestSample,
        };
      }
    }

    if (!bestSlotMatch || bestSlotMatch.distance > this.matchThreshold) {
      return null;
    }

    return {
      slotIndex: bestSlotMatch.slot.slotIndex,
      label: bestSlotMatch.slot.label,
      distance: Number(bestSlotMatch.distance.toFixed(5)),
      vectorDistance: Number(bestSlotMatch.bestSample.vectorDistance.toFixed(5)),
      pairDistance: Number(bestSlotMatch.bestSample.pairDistance.toFixed(5)),
      sampleCount: bestSlotMatch.slot.samples.length,
      matchedSampleIndex: bestSlotMatch.bestSample.sampleIndex,
      matchedSampleId: bestSlotMatch.bestSample.sample.sampleId,
      source: "template-samples",
    };
  }

  buildHardcodedExportString() {
    return `export const HARDCODED_POSES = ${JSON.stringify(this.exportState(), null, 2)};\n`;
  }
}
