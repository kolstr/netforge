const KEY = 'netforge.cmdHistory.v1'
const LIMIT = 200

/** Fallback when localStorage is unavailable (tests, storage disabled). */
const memory: Record<string, string[]> = {}

type HistoryStore = Record<string, string[]>

function readAll(): HistoryStore {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    if (!parsed || typeof parsed !== 'object') return { ...memory }
    const store: HistoryStore = {}
    for (const [deviceId, list] of Object.entries(parsed as HistoryStore)) {
      if (Array.isArray(list)) store[deviceId] = list.filter((c): c is string => typeof c === 'string')
    }
    return store
  } catch {
    return { ...memory }
  }
}

function writeAll(store: HistoryStore): void {
  Object.assign(memory, store)
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    /* ignore quota / unavailable storage */
  }
}

/** Saved commands for a device, oldest first. */
export function loadCommandHistory(deviceId: string): string[] {
  return readAll()[deviceId] ?? []
}

/** Append a command to the device's saved history and return the updated list. */
export function recordCommand(deviceId: string, command: string): string[] {
  const store = readAll()
  const next = [...(store[deviceId] ?? []), command].slice(-LIMIT)
  store[deviceId] = next
  writeAll(store)
  return next
}

/** Persist a whole history list for a device (used after a session ran commands). */
export function saveCommandHistory(deviceId: string, list: string[]): void {
  const store = readAll()
  store[deviceId] = list.slice(-LIMIT)
  writeAll(store)
}
