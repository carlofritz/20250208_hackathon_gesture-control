function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

export function installWindowStub(options = {}) {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const previousAudio = globalThis.Audio;

  const eventTarget = new EventTarget();
  const localStorage = createMemoryStorage();

  const windowStub = {
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    localStorage,
    confirm: options.confirm ?? (() => true),
    open: options.open ?? (() => ({ closed: false })),
    location: { origin: "http://localhost:4173" },
  };

  globalThis.window = windowStub;
  globalThis.fetch = options.fetch ?? previousFetch;
  globalThis.Audio =
    options.Audio ??
    class AudioMock {
      constructor() {
        this.onended = null;
      }
      async play() {}
      pause() {}
    };

  return {
    window: windowStub,
    restore() {
      globalThis.window = previousWindow;
      globalThis.fetch = previousFetch;
      globalThis.Audio = previousAudio;
    },
  };
}

export function buildLandmarks(offsetX = 0, offsetY = 0, scale = 1) {
  const landmarks = [];
  for (let i = 0; i < 21; i += 1) {
    landmarks.push({
      x: offsetX + i * 0.01 * scale,
      y: offsetY + i * 0.006 * scale,
      z: i * 0.003 * scale,
    });
  }
  return landmarks;
}

