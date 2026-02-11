class Store {
  constructor() {
    this.state = {
      user: null,
      room: null,
      messages: [],
      members: new Map(),
      online: [],
      banned: new Map(),
      presence: {},
    };
    this.listeners = new Set();
  }

  setState(newState) {
    this.state = { ...this.state, ...newState };
    this.listeners.forEach((listener) => {
      try {
        listener(this.state);
      } catch (_) {
      }
    });
  }

  getState() {
    return this.state;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export default new Store();
