import { navigate } from '@/App'
import { track } from '@/lib/telemetry'

/** Message of an error that crossed IPC, without Electron's "Error invoking remote method" prefix. */
export const cleanError = (e: unknown) => String((e as any)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Show a short note at the top of the window (from anywhere in the app). */
export const notice = (msg: string) => window.dispatchEvent(new CustomEvent('ilf:notice', { detail: msg }))

let busy = false
/**
 * Make a new project from your own videos (a file picker when no paths are
 * given), then open it in the editor. Returns false if nothing was imported.
 */
export async function importVideosAsProject(paths?: string[], from = 'home'): Promise<boolean> {
  if (busy) return false
  busy = true
  track('video_import_clicked', { from, n: paths?.length ?? 0 })
  try {
    const id = await window.ilf.media.importAsProject(paths)
    if (!id) return false
    navigate('/editor/' + encodeURIComponent(id))
    return true
  } catch (e) {
    notice(cleanError(e))
    return false
  } finally {
    busy = false
  }
}

const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi)$/i
/** Video files in a drag-and-drop, as paths on disk. */
export function droppedVideos(e: DragEvent | React.DragEvent): string[] {
  const files = Array.from(e.dataTransfer?.files ?? [])
  return files.map((f) => window.ilf.pathForFile(f)).filter((p) => !!p && VIDEO.test(p))
}
export const dragHasFiles = (e: DragEvent | React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
