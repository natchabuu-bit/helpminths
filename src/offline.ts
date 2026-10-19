export type OfflinePhase = 'idle' | 'installing' | 'ready' | 'update-available' | 'unsupported' | 'error'

export interface OfflineStatus {
  status: OfflinePhase
  online: boolean
  version: string | null
  message: string
}

let snapshot: OfflineStatus = {
  status: 'idle',
  online: typeof navigator === 'undefined' || navigator.onLine,
  version: null,
  message: 'กำลังเตรียมการใช้งานออฟไลน์',
}
const listeners = new Set<() => void>()
let registrationPromise: Promise<void> | undefined
let registration: ServiceWorkerRegistration | undefined
let activeCacheReady = false
let readinessGeneration = 0

function updateStatus(patch: Partial<OfflineStatus>) {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach(listener => listener())
}

export function getOfflineStatus(): OfflineStatus { return snapshot }

export function subscribeOfflineStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function waitingUpdate() {
  if (activeCacheReady && registration?.waiting && navigator.serviceWorker.controller) {
    updateStatus({
      status: 'update-available',
      message: 'มีเวอร์ชันใหม่พร้อมใช้งาน ปิด HelpMinths ทุกแท็บแล้วเปิดอีกครั้ง',
    })
    return true
  }
  return false
}

async function checkReady(worker?: ServiceWorker | null) {
  if (!worker || !navigator.serviceWorker.controller) return
  const generation = ++readinessGeneration
  const channel = new MessageChannel()
  const result = await new Promise<{ ready: boolean; version: string }>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      channel.port1.close()
      reject(new Error('Offline status timed out'))
    }, 10_000)
    channel.port1.onmessage = event => {
      window.clearTimeout(timer)
      channel.port1.close()
      resolve(event.data as { ready: boolean; version: string })
    }
    worker.postMessage({ type: 'HELPMINTHS_OFFLINE_STATUS' }, [channel.port2])
  }).catch(() => null)
  if (generation !== readinessGeneration) return
  if (result?.ready) {
    activeCacheReady = true
    updateStatus({ status: 'ready', version: result.version, message: 'พร้อมใช้งานออฟไลน์' })
    waitingUpdate()
  } else {
    activeCacheReady = false
    updateStatus({
      status: 'error',
      message: 'บันทึกออฟไลน์ยังไม่ครบ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วเปิดแอปอีกครั้ง',
    })
  }
}

function watchWorker(worker: ServiceWorker) {
  if (!registration?.active) {
    updateStatus({ status: 'installing', message: 'กำลังบันทึกแอปและ Atlas 3D ลงในอุปกรณ์' })
  }
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed') {
      waitingUpdate()
    } else if (worker.state === 'activated') {
      void checkReady(worker)
    } else if (worker.state === 'redundant') {
      if (registration?.active) void checkReady(registration.active)
      else updateStatus({
        status: 'error',
        message: 'บันทึกออฟไลน์ไม่สำเร็จ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่',
      })
    }
  })
}

export function registerOfflineSupport(): Promise<void> {
  if (registrationPromise) return registrationPromise
  registrationPromise = (async () => {
    window.addEventListener('online', () => {
      updateStatus({ online: true })
      void registration?.update().catch(() => undefined)
      void checkReady(navigator.serviceWorker?.controller ?? registration?.active)
    })
    window.addEventListener('offline', () => { updateStatus({ online: false }) })
    if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) {
      updateStatus({
        status: 'unsupported',
        message: import.meta.env.PROD
          ? 'เบราว์เซอร์นี้ยังไม่รองรับโหมดออฟไลน์ กรุณาเปิดแอปผ่าน HTTPS'
          : 'โหมดออฟไลน์พร้อมให้ใช้ในแอปเวอร์ชัน production',
      })
      return
    }
    try {
      registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      registration.addEventListener('updatefound', () => {
        if (registration?.installing) watchWorker(registration.installing)
      })
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        void checkReady(navigator.serviceWorker.controller)
      })
      if (registration.installing) watchWorker(registration.installing)
      if (registration.active) await checkReady(navigator.serviceWorker.controller ?? registration.active)
      else if (registration.waiting) watchWorker(registration.waiting)
      waitingUpdate()
    } catch {
      updateStatus({
        status: 'error',
        message: 'บันทึกออฟไลน์ไม่สำเร็จ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่',
      })
    }
  })()
  return registrationPromise
}
