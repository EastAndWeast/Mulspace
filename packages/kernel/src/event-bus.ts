import type { IEventBus, KernelEventMap, Unsubscribe } from '@wb/contracts'

export class TypedEventBus<TMap extends object = KernelEventMap> implements IEventBus<TMap> {
  private readonly listeners = new Map<keyof TMap, Set<(payload: never) => void>>()

  on<K extends keyof TMap>(event: K, handler: (payload: TMap[K]) => void): Unsubscribe {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(handler as (payload: never) => void)
    return () => this.off(event, handler)
  }

  once<K extends keyof TMap>(event: K, handler: (payload: TMap[K]) => void): Unsubscribe {
    const wrapped = (payload: TMap[K]): void => {
      this.off(event, wrapped)
      handler(payload)
    }
    return this.on(event, wrapped)
  }

  off<K extends keyof TMap>(event: K, handler: (payload: TMap[K]) => void): void {
    const set = this.listeners.get(event)
    if (!set) return
    set.delete(handler as (payload: never) => void)
    if (set.size === 0) {
      this.listeners.delete(event)
    }
  }

  emit<K extends keyof TMap>(event: K, payload: TMap[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of [...set]) {
      ;(listener as (p: TMap[K]) => void)(payload)
    }
  }
}
