const TASKS_VISION_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const DEFAULT_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export class MediapipeHandTracker {
  constructor(options = {}) {
    this.options = {
      modelAssetPath: DEFAULT_MODEL_URL,
      wasmPath: `${TASKS_VISION_CDN}/wasm`,
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      ...options,
    };

    this.landmarker = null;
    this.delegate = null;
  }

  async init() {
    if (this.landmarker) {
      return;
    }

    const vision = await import(TASKS_VISION_CDN);
    const fileset = await vision.FilesetResolver.forVisionTasks(this.options.wasmPath);

    try {
      this.landmarker = await vision.HandLandmarker.createFromOptions(
        fileset,
        this.buildHandLandmarkerOptions("GPU"),
      );
      this.delegate = "GPU";
    } catch (_gpuError) {
      this.landmarker = await vision.HandLandmarker.createFromOptions(
        fileset,
        this.buildHandLandmarkerOptions("CPU"),
      );
      this.delegate = "CPU";
    }
  }

  buildHandLandmarkerOptions(delegate) {
    return {
      baseOptions: {
        modelAssetPath: this.options.modelAssetPath,
        delegate,
      },
      runningMode: "VIDEO",
      numHands: this.options.numHands,
      minHandDetectionConfidence: this.options.minHandDetectionConfidence,
      minHandPresenceConfidence: this.options.minHandPresenceConfidence,
      minTrackingConfidence: this.options.minTrackingConfidence,
    };
  }

  detect(videoElement, timestampMs) {
    if (!this.landmarker) {
      return [];
    }

    const result = this.landmarker.detectForVideo(videoElement, timestampMs);
    const landmarks = result.landmarks ?? [];
    const handednesses = result.handednesses ?? [];

    return landmarks.map((handLandmarks, index) => {
      const handednessInfo = handednesses[index]?.[0];
      return {
        landmarks: handLandmarks,
        handedness: handednessInfo?.categoryName ?? "unknown",
        score: handednessInfo?.score ?? 0,
      };
    });
  }

  close() {
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
    this.delegate = null;
  }

  getRuntimeInfo() {
    return {
      runtime: "mediapipe-hand-landmarker",
      package: "@mediapipe/tasks-vision@0.10.14",
      modelAssetPath: this.options.modelAssetPath,
      wasmPath: this.options.wasmPath,
      delegate: this.delegate,
      numHands: this.options.numHands,
      minHandDetectionConfidence: this.options.minHandDetectionConfidence,
      minHandPresenceConfidence: this.options.minHandPresenceConfidence,
      minTrackingConfidence: this.options.minTrackingConfidence,
    };
  }
}
