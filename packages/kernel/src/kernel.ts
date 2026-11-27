import type { IKernelContext, IKernelModule, KernelEventMap } from '@wb/contracts'
import { TypedEventBus } from './event-bus.js'
import { ServiceRegistry } from './service-registry.js'

export class BrowserKernel {
  readonly events = new TypedEventBus<KernelEventMap>()
  readonly services = new ServiceRegistry()

  private readonly modules: IKernelModule[] = []
  private readonly initializedModules: IKernelModule[] = []
  private started = false

  use(module: IKernelModule): this {
    if (this.started) {
      throw new Error(`Cannot register module "${module.id}" after kernel has started`)
    }
    if (this.modules.some((m) => m.id === module.id)) {
      throw new Error(`Duplicate kernel module id: ${module.id}`)
    }
    this.modules.push(module)
    return this
  }

  get context(): IKernelContext {
    return {
      events: this.events,
      services: this.services,
    }
  }

  async start(): Promise<void> {
    if (this.started) return
    for (const module of this.modules) {
      await module.init(this.context)
      this.initializedModules.push(module)
    }
    this.started = true
  }

  /**
   * Initializes the first `coreCount` modules synchronously in registration order,
   * then initializes remaining independent modules in parallel and returns a settlement promise.
   */
  async startWithDeferredBackground(coreCount: number): Promise<{ backgroundReady: Promise<void> }> {
    if (this.started) return { backgroundReady: Promise.resolve() }
    const core = this.modules.slice(0, coreCount)
    const background = this.modules.slice(coreCount)

    for (const module of core) {
      await module.init(this.context)
      this.initializedModules.push(module)
    }
    this.started = true

    const backgroundReady = Promise.all(
      background.map(async (module) => {
        await module.init(this.context)
        this.initializedModules.push(module)
      }),
    ).then(() => undefined)

    return { backgroundReady }
  }

  async stop(): Promise<void> {
    if (!this.started) return
    for (const module of [...this.initializedModules].reverse()) {
      await module.dispose?.()
    }
    this.initializedModules.length = 0
    this.started = false
  }
}
