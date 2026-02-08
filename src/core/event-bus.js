export class EventBus {
  constructor() {
    this.target = new EventTarget();
  }

  on(type, handler) {
    this.target.addEventListener(type, handler);
    return () => this.target.removeEventListener(type, handler);
  }

  emit(type, detail) {
    this.target.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
