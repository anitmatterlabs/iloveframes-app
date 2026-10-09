import type { Platform } from './types'
import { win } from './win'
import { mac } from './mac'

/** The current OS implementation. Windows and macOS share every feature; only plumbing differs. */
export const platform: Platform = process.platform === 'darwin' ? mac : win
export type { Platform }
