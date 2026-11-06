import type { Activity, Project, SeqClip } from '@/engine/types'
import { needsMotion } from '@/engine/motion'
import { clipAt, cropOf, toCrop } from '@/engine/sequence'
import type { EditState } from '@/engine/types'

/**
 * Motion analysis of plain video sources, loaded on demand from the main
 * process (which caches it next to the project, so each video is analysed once).
 */
const cache = new Map<string, Activity>()
const key = (projectId: string, sourceId: string) => projectId + '|' + sourceId

/** Plain-video sources in the sequence (no cursor data), the ones motion zoom is for. */
export const motionSources = (project: Project, clips: SeqClip[]) => [...new Set(clips.map((c) => c.source))].filter((id) => needsMotion(project, id))

/** Whatever has already been analysed, without starting any work. */
export function cachedActivity(project: Project, clips: SeqClip[]) {
  const out = new Map<string, Activity>()
  for (const id of motionSources(project, clips)) {
    const a = cache.get(key(project.id, id))
    if (a) out.set(id, a)
  }
  return out
}

/** Analyse (or load) every plain-video source in the sequence. */
export async function loadActivity(project: Project, clips: SeqClip[]) {
  const out = new Map<string, Activity>()
  for (const id of motionSources(project, clips)) {
    let a = cache.get(key(project.id, id))
    if (!a) {
      a = await window.ilf.media.activity(project.id, id)
      cache.set(key(project.id, id), a)
    }
    out.set(id, a)
  }
  return out
}

/** Where things were moving around sequence time T in a plain video (for placing a new zoom), or null. */
export function actionPointAt(project: Project, edit: EditState, T: number): { x: number; y: number } | null {
  const hit = clipAt(edit.clips, T)
  if (!hit) return null
  const a = cache.get(key(project.id, hit.clip.source))
  if (!a) return null
  let sx = 0, sy = 0, w = 0
  for (const f of a.frames) {
    if (Math.abs(f[0] - hit.srcT) > 1.5 || f[1] < 0.0015 || f[1] > 0.22) continue
    const k = Math.sqrt(f[1])
    sx += f[2] * k
    sy += f[3] * k
    w += k
  }
  if (!w) return null
  return toCrop(cropOf(edit.crops, hit.clip.source), sx / w, sy / w)
}
