import { describe, expect, it } from 'vitest'
import { createServiceToken, type IKernelModule } from '@wb/contracts'
import { BrowserKernel } from '../kernel.js'

describe('BrowserKernel', () => {
  it('initializes modules in registration order and disposes in reverse order', async () => {
    const lifecycleLog: string[] = []
    const kernel = new BrowserKernel()

    const modA: IKernelModule = {
      id: 'mod-a',
      init() {
        lifecycleLog.push('init:a')
      },
      dispose() {
        lifecycleLog.push('dispose:a')
      },
    }

    const modB: IKernelModule = {
      id: 'mod-b',
      init() {
        lifecycleLog.push('init:b')
      },
      dispose() {
        lifecycleLog.push('dispose:b')
      },
    }

    kernel.use(modA).use(modB)
    await kernel.start()
    await kernel.stop()

    expect(lifecycleLog).toEqual(['init:a', 'init:b', 'dispose:b', 'dispose:a'])
  })

  it('supports type-safe DI registration and TypedEventBus subscriptions', async () => {
    const kernel = new BrowserKernel()
    const GreetToken = createServiceToken<{ greet: (name: string) => string }>('GreetService')

    kernel.services.register(GreetToken, { greet: (name) => `hello ${name}` })
    expect(kernel.services.has(GreetToken)).toBe(true)
    expect(kernel.services.resolve(GreetToken).greet('wb')).toBe('hello wb')

    const seen: string[] = []
    const off = kernel.events.on('workspace:deleted', ({ workspaceId }) => {
      seen.push(workspaceId)
    })

    kernel.events.emit('workspace:deleted', { workspaceId: 'ws_1' })
    off()
    kernel.events.emit('workspace:deleted', { workspaceId: 'ws_2' })

    expect(seen).toEqual(['ws_1'])
  })
})
