import type { Display } from 'electron'
import type { CropFrac } from '../ffmpeg'

/**
 * Everything that differs between Windows and macOS lives behind this
 * interface (platform/win.ts and platform/mac.ts). Features stay identical;
 * only the OS plumbing differs.
 */
export interface Platform {
  id: 'win' | 'mac'
  /** ffmpeg argument sets to try in order for cursor-free screen capture (optionally only an area of it). */
  captureAttempts(display: Display, outputIndex: number, outFile: string, fps: number, crop?: CropFrac): Promise<string[][]>
  /** Helper process that prints the OS cursor shape (arrow|hand|text) on change. */
  cursorWatcher(nativeDir: string): { cmd: string; args: string[] } | null
  /** Stable hardware/OS install identifier used to bind licence + trial data to this machine. */
  machineId(): Promise<string>
  /** Second copy of the trial/licence state outside the app data folder. */
  mirrorRead(): Promise<string | null>
  mirrorWrite(data: string): Promise<void>
  /** Update asset key in latest.json for this OS/arch. */
  updateAsset(): string
  /** Hand a verified update file to the OS installer, then quit and relaunch. */
  installUpdate(file: string, relaunch?: boolean): Promise<void>
  /** Human label for the stop-recording shortcut. */
  stopShortcutLabel: string
}
