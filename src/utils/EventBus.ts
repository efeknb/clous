// ============================================
// Clous — EventBus (Typed Event Emitter)
// ============================================

import EventEmitter from 'eventemitter3';

type EventHandler = (...args: any[]) => void;

interface HookEntry {
  event: string;
  phase: 'before' | 'after';
  handler: EventHandler;
}

/**
 * Typed event bus with wildcard and hook support.
 * Extends eventemitter3 for high-performance event handling.
 */
export class EventBus {
  private emitter: EventEmitter;
  private hooks: HookEntry[] = [];
  private wildcardListeners: Map<string, EventHandler[]> = new Map();

  constructor() {
    this.emitter = new EventEmitter();
  }

  /**
   * Register an event listener.
   */
  on(event: string, handler: EventHandler): this {
    if (event.includes('*')) {
      const existing = this.wildcardListeners.get(event) || [];
      existing.push(handler);
      this.wildcardListeners.set(event, existing);
    } else {
      this.emitter.on(event, handler);
    }
    return this;
  }

  /**
   * Register a one-time event listener.
   */
  once(event: string, handler: EventHandler): this {
    this.emitter.once(event, handler);
    return this;
  }

  /**
   * Remove an event listener.
   */
  off(event: string, handler: EventHandler): this {
    if (event.includes('*')) {
      const existing = this.wildcardListeners.get(event) || [];
      const idx = existing.indexOf(handler);
      if (idx !== -1) existing.splice(idx, 1);
      if (existing.length === 0) this.wildcardListeners.delete(event);
      else this.wildcardListeners.set(event, existing);
    } else {
      this.emitter.off(event, handler);
    }
    return this;
  }

  /**
   * Emit an event, triggering before/after hooks and wildcard listeners.
   */
  emit(event: string, ...args: any[]): boolean {
    // Fire 'before' hooks
    for (const hook of this.hooks) {
      if (hook.phase === 'before' && this.matchEvent(hook.event, event)) {
        hook.handler(...args);
      }
    }

    // Fire exact listeners
    const result = this.emitter.emit(event, ...args);

    // Fire wildcard listeners
    for (const [pattern, handlers] of this.wildcardListeners) {
      if (this.matchWildcard(pattern, event)) {
        for (const handler of handlers) {
          handler(...args);
        }
      }
    }

    // Fire 'after' hooks
    for (const hook of this.hooks) {
      if (hook.phase === 'after' && this.matchEvent(hook.event, event)) {
        hook.handler(...args);
      }
    }

    return result;
  }

  /**
   * Register a before-hook for an event.
   */
  before(event: string, handler: EventHandler): this {
    this.hooks.push({ event, phase: 'before', handler });
    return this;
  }

  /**
   * Register an after-hook for an event.
   */
  after(event: string, handler: EventHandler): this {
    this.hooks.push({ event, phase: 'after', handler });
    return this;
  }

  /**
   * Remove all listeners for an event, or all events.
   */
  removeAllListeners(event?: string): this {
    if (event) {
      this.emitter.removeAllListeners(event);
      this.wildcardListeners.delete(event);
      this.hooks = this.hooks.filter((h) => h.event !== event);
    } else {
      this.emitter.removeAllListeners();
      this.wildcardListeners.clear();
      this.hooks = [];
    }
    return this;
  }

  /**
   * Get listener count for an event.
   */
  listenerCount(event: string): number {
    return this.emitter.listenerCount(event);
  }

  private matchEvent(pattern: string, event: string): boolean {
    if (pattern === event) return true;
    return this.matchWildcard(pattern, event);
  }

  private matchWildcard(pattern: string, event: string): boolean {
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp(`^${regexStr}$`).test(event);
  }
}
