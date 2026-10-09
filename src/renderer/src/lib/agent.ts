/**
 * The editor side of the AI agent bridge (see src/main/agent.ts and resources/mcp).
 *
 * Each tool is a plain editor action: it goes through the same store updates as
 * the UI, so every change shows up live and can be undone. Inputs are checked
 * and clamped here again, whatever the MCP server already checked.
 */
import { useEditor, updateEdit, deleteSeqClip, setTransition, setAllTransitions, DEFAULT_TRANSITION } from '@/editor/store'
import { player } from '@/editor/Preview'
import { exportProject } from '@/engine/exporter'
import { autoZoomSegments } from '@/engine/motion'
import { MAIN, clipLen, rippleRemove, seqDuration, seqEvents, seqStarts, splitClips, sourceInfo } from '@/engine/sequence'
import { GRADIENTS, SOLIDS, WALLPAPERS } from '@/engine/backgrounds'
import { mediaUrl, uid, type EditState, type TransitionKind, type ZoomSegment } from '@/engine/types'

type Args = Record<string, any>
type Result = { ok: true; result?: unknown; image?: string; mimeType?: string; text?: string } | { ok: false; error: string }

class AgentError extends Error {}
const fail = (m: string): never => {
  throw new AgentError(m)
}

const clampN = (v: unknown, lo: number, hi: number) => {
  const n = Number(v)
  if (!isFinite(n)) fail('Expected a number.')
  return Math.min(hi, Math.max(lo, n))
}
const has = (a: Args, k: string) => a[k] !== undefined && a[k] !== null
const r2 = (n: number) => Math.round(n * 100) / 100
const oneOf = <T extends string>(v: unknown, values: readonly T[], what: string): T => (values.includes(v as T) ? (v as T) : fail(`${what} must be one of: ${values.join(', ')}.`))

/** Let the user see what the agent did. */
const notify = (msg: string) => window.dispatchEvent(new CustomEvent('ilf:toast', { detail: 'AI agent · ' + msg }))

function editor() {
  const s = useEditor.getState()
  if (!s.project || !s.edit || !location.hash.includes('/editor/')) fail('No project is open. Use list_projects and open_project first.')
  if (s.exporting) fail('The editor is busy exporting. Try again when it finishes.')
  return { project: s.project!, edit: s.edit! }
}

function describe() {
  const { project, edit } = editor()
  const s = useEditor.getState()
  const starts = seqStarts(edit.clips)
  const ev = seqEvents(project, edit.clips, edit.crops)
  const name = (id: string) => (id === MAIN ? 'main recording' : sourceInfo(project, id)?.name ?? id)
  const hasCam = !!project.camera || (project.sources ?? []).some((x) => x.camera)
  return {
    project: { id: project.id, name: project.name },
    seconds: r2(seqDuration(edit.clips)),
    playhead: r2(s.time),
    clips: edit.clips.map((c, i) => ({
      id: c.id,
      source: name(c.source),
      start: r2(starts[i]),
      end: r2(starts[i] + clipLen(c)),
      transition_in: c.tIn ? { kind: c.tIn.kind, duration: c.tIn.duration } : null
    })),
    zooms: edit.zoom.segments.map((z) => ({ id: z.id, start: r2(z.start), end: r2(z.end), scale: r2(z.scale), follow_cursor: z.follow, x: r2(z.x), y: r2(z.y), automatic: !!z.auto })),
    zoom_style: { speed: edit.zoom.speed, follow_smoothness: edit.zoom.followSmoothness },
    clicks: ev.clicks.slice(0, 80).map((c) => ({ time: r2(c.t), x: r2(c.x), y: r2(c.y) })),
    click_count: ev.clicks.length,
    typing_seconds: [...new Set(ev.keys.map((k) => Math.floor(k.t)))].slice(0, 80),
    background: edit.background,
    frame: {
      aspect: edit.aspect,
      padding: edit.padding,
      radius: edit.radius,
      shadow: edit.shadow,
      glass_edge: edit.inset,
      device: edit.device?.kind ?? 'none',
      device_color: edit.device?.color ?? 'dark'
    },
    cursor: {
      enabled: edit.cursor.enabled,
      style: edit.cursor.style,
      size: edit.cursor.size,
      smoothing: edit.cursor.smoothing,
      click_effect: edit.cursor.clickEffect,
      hide_idle: edit.cursor.hideIdle,
      hide_typing: edit.cursor.hideTyping
    },
    camera: { has_webcam: hasCam, ...edit.camera, shrink_on_zoom: edit.camera.shrinkOnZoom },
    sound: {
      has_mic: !!project.mic,
      mic_volume: edit.audio.micVolume,
      muted: edit.audio.muted,
      click_sounds: edit.sfx.click.enabled,
      typing_sounds: edit.sfx.typing.enabled,
      zoom_sounds: edit.sfx.zoom.enabled,
      added_audio: edit.audio.clips.map((c) => ({ name: c.name, start: r2(c.start), seconds: r2(c.duration) }))
    },
    can_undo: s.past.length > 0,
    can_redo: s.future.length > 0
  }
}

async function waitFor(check: () => boolean, ms: number) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (check()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return check()
}

const TRANSITIONS: TransitionKind[] = ['fade', 'blur', 'zoom', 'push', 'wipe', 'dip']

const tools: Record<string, (a: Args) => Promise<unknown> | unknown> = {
  get_status: () => {
    const s = useEditor.getState()
    const open = s.project && location.hash.includes('/editor/') ? { id: s.project.id, name: s.project.name } : null
    return { app: 'iloveframes', open_project: open, exporting: s.exporting }
  },

  open_project: async (a) => {
    const id = String(a.id ?? '')
    if (!id || id.length > 200 || /[\\/]/.test(id) || id.includes('..')) fail('Unknown project id.')
    const list = await window.ilf.projects.list()
    if (!list.some((p: any) => p.id === id)) fail('No project with that id. Use list_projects.')
    if (useEditor.getState().exporting) fail('The editor is busy exporting.')
    location.hash = '/editor/' + encodeURIComponent(id)
    const ok = await waitFor(() => useEditor.getState().project?.id === id && !!useEditor.getState().edit, 15000)
    if (!ok) fail('The project did not open in time.')
    notify('opened ' + useEditor.getState().project!.name)
    return describe()
  },

  get_project: () => describe(),

  preview_frame: async (a) => {
    const { edit } = editor()
    const t = clampN(a.time, 0, Math.max(0, seqDuration(edit.clips) - 0.01))
    const img = await player.snapshot(t)
    if (!img) return fail('Could not render that frame.')
    return { __image: img.split(',')[1], text: `Frame at ${t.toFixed(2)}s` }
  },

  list_backgrounds: async () => {
    const lib = await window.ilf.wallpapers.list().catch(() => [] as any[])
    return {
      wallpaper: WALLPAPERS.map((w) => ({ id: w.id, name: w.name })),
      gradient: GRADIENTS.map((g) => ({ id: g.id, name: g.name })),
      solid: { examples: SOLIDS, note: 'any hex color' },
      library: lib.map((w: any) => ({ id: w.id, name: w.name, group: w.group }))
    }
  },

  set_background: async (a) => {
    editor()
    const kind = oneOf(a.kind, ['wallpaper', 'gradient', 'solid', 'library'] as const, 'kind')
    const value = String(a.value ?? '')
    let bg: EditState['background']
    const blur = has(a, 'blur') ? clampN(a.blur, 0, 6) : 0
    if (kind === 'wallpaper') {
      if (!WALLPAPERS.some((w) => w.id === value)) fail('Unknown wallpaper id. Use list_backgrounds.')
      bg = { kind: 'wallpaper', value, blur: 0 }
    } else if (kind === 'gradient') {
      if (!GRADIENTS.some((g) => g.id === value)) fail('Unknown gradient id. Use list_backgrounds.')
      bg = { kind: 'gradient', value, blur: 0 }
    } else if (kind === 'solid') {
      if (!/^#[0-9a-f]{6}$/i.test(value)) fail('Solid colors are hex, like #101014.')
      bg = { kind: 'solid', value, blur: 0 }
    } else {
      const lib = await window.ilf.wallpapers.list()
      const w = lib.find((x: any) => x.id === value)
      if (!w) fail('Unknown library wallpaper id. Use list_backgrounds.')
      bg = { kind: 'image', value: w!.url ?? mediaUrl(w!.file), blur }
    }
    updateEdit((e) => ({ ...e, background: bg }))
    notify('changed the background')
    return 'Background updated.'
  },

  set_frame: (a) => {
    editor()
    const aspects = ['16:9', '9:16', '1:1', '4:3', '4:5', 'auto'] as const
    updateEdit((e) => ({
      ...e,
      ...(has(a, 'aspect') ? { aspect: oneOf(a.aspect, aspects, 'aspect') } : {}),
      ...(has(a, 'padding') ? { padding: clampN(a.padding, 0, 0.22) } : {}),
      ...(has(a, 'radius') ? { radius: Math.round(clampN(a.radius, 0, 48)) } : {}),
      ...(has(a, 'shadow') ? { shadow: clampN(a.shadow, 0, 1) } : {}),
      ...(has(a, 'glass_edge') ? { inset: !!a.glass_edge } : {}),
      ...(has(a, 'device') || has(a, 'device_color')
        ? {
            device: {
              kind: has(a, 'device') ? oneOf(a.device, ['none', 'macbook', 'laptop'] as const, 'device') : e.device?.kind ?? 'none',
              color: has(a, 'device_color') ? oneOf(a.device_color, ['dark', 'light'] as const, 'device_color') : e.device?.color ?? 'dark'
            }
          }
        : {})
    }))
    notify('changed the frame')
    return 'Frame updated.'
  },

  set_cursor: (a) => {
    editor()
    updateEdit((e) => ({
      ...e,
      cursor: {
        ...e.cursor,
        ...(has(a, 'enabled') ? { enabled: !!a.enabled } : {}),
        ...(has(a, 'style') ? { style: oneOf(a.style, ['auto', 'mac', 'light', 'ring'] as const, 'style') } : {}),
        ...(has(a, 'size') ? { size: clampN(a.size, 0.8, 3) } : {}),
        ...(has(a, 'smoothing') ? { smoothing: clampN(a.smoothing, 0, 1) } : {}),
        ...(has(a, 'click_effect') ? { clickEffect: oneOf(a.click_effect, ['ripple', 'pulse', 'none'] as const, 'click_effect') } : {}),
        ...(has(a, 'hide_idle') ? { hideIdle: !!a.hide_idle } : {}),
        ...(has(a, 'hide_typing') ? { hideTyping: !!a.hide_typing } : {})
      }
    }))
    notify('changed the cursor')
    return 'Cursor updated.'
  },

  set_camera: (a) => {
    editor()
    updateEdit((e) => ({
      ...e,
      camera: {
        ...e.camera,
        ...(has(a, 'enabled') ? { enabled: !!a.enabled } : {}),
        ...(has(a, 'shape') ? { shape: oneOf(a.shape, ['circle', 'rounded', 'portrait'] as const, 'shape') } : {}),
        ...(has(a, 'size') ? { size: clampN(a.size, 0.1, 0.45) } : {}),
        ...(has(a, 'position') ? { position: oneOf(a.position, ['br', 'bl', 'tr', 'tl'] as const, 'position') } : {}),
        ...(has(a, 'mirror') ? { mirror: !!a.mirror } : {}),
        ...(has(a, 'border') ? { border: !!a.border } : {}),
        ...(has(a, 'shrink_on_zoom') ? { shrinkOnZoom: !!a.shrink_on_zoom } : {})
      }
    }))
    notify('changed the webcam')
    return 'Camera updated.'
  },

  add_zoom: (a) => {
    const { edit } = editor()
    const dur = seqDuration(edit.clips)
    const start = clampN(a.start, 0, dur)
    const end = clampN(a.end, 0, dur)
    if (end - start < 0.4) fail('A zoom needs at least 0.4 seconds between start and end.')
    if (edit.zoom.segments.some((z) => start < z.end && end > z.start)) fail('That overlaps an existing zoom. Change or remove it first (see get_project).')
    const fixed = has(a, 'x') || has(a, 'y')
    const seg: ZoomSegment = {
      id: uid(),
      start,
      end,
      scale: has(a, 'scale') ? clampN(a.scale, 1.1, 4) : 2,
      follow: !fixed,
      x: has(a, 'x') ? clampN(a.x, 0, 1) : 0.5,
      y: has(a, 'y') ? clampN(a.y, 0, 1) : 0.5
    }
    updateEdit((e) => ({ ...e, zoom: { ...e.zoom, segments: [...e.zoom.segments, seg].sort((p, q) => p.start - q.start) } }))
    notify(`added a zoom at ${start.toFixed(1)}s`)
    return { id: seg.id }
  },

  update_zoom: (a) => {
    const { edit } = editor()
    const z = edit.zoom.segments.find((s) => s.id === a.id) ?? fail('No zoom with that id.')
    const dur = seqDuration(edit.clips)
    const next: ZoomSegment = {
      ...z!,
      auto: false,
      start: has(a, 'start') ? clampN(a.start, 0, dur) : z!.start,
      end: has(a, 'end') ? clampN(a.end, 0, dur) : z!.end,
      scale: has(a, 'scale') ? clampN(a.scale, 1.1, 4) : z!.scale,
      follow: has(a, 'follow_cursor') ? !!a.follow_cursor : has(a, 'x') || has(a, 'y') ? false : z!.follow,
      x: has(a, 'x') ? clampN(a.x, 0, 1) : z!.x,
      y: has(a, 'y') ? clampN(a.y, 0, 1) : z!.y
    }
    if (next.end - next.start < 0.4) fail('A zoom needs at least 0.4 seconds.')
    if (edit.zoom.segments.some((s) => s.id !== z!.id && next.start < s.end && next.end > s.start)) fail('That would overlap another zoom.')
    updateEdit((e) => ({ ...e, zoom: { ...e.zoom, segments: e.zoom.segments.map((s) => (s.id === z!.id ? next : s)).sort((p, q) => p.start - q.start) } }))
    notify('changed a zoom')
    return 'Zoom updated.'
  },

  remove_zoom: (a) => {
    const { edit } = editor()
    if (a.all === true) {
      updateEdit((e) => ({ ...e, zoom: { ...e.zoom, segments: [] } }))
      notify('removed all zooms')
      return `Removed ${edit.zoom.segments.length} zooms.`
    }
    if (!edit.zoom.segments.some((s) => s.id === a.id)) fail('No zoom with that id (or pass all=true).')
    updateEdit((e) => ({ ...e, zoom: { ...e.zoom, segments: e.zoom.segments.filter((s) => s.id !== a.id) } }))
    notify('removed a zoom')
    return 'Zoom removed.'
  },

  auto_zoom: (a) => {
    const { project, edit } = editor()
    const segs = autoZoomSegments(project, edit.clips, has(a, 'scale') ? clampN(a.scale, 1.1, 4) : 2, edit.crops)
    updateEdit((e) => ({ ...e, zoom: { ...e.zoom, segments: segs } }))
    notify('made automatic zooms')
    return `${segs.length} zooms from the recorded clicks.`
  },

  set_zoom_style: (a) => {
    editor()
    updateEdit((e) => ({
      ...e,
      zoom: {
        ...e.zoom,
        ...(has(a, 'speed') ? { speed: oneOf(a.speed, ['slow', 'normal', 'fast'] as const, 'speed') } : {}),
        ...(has(a, 'follow_smoothness') ? { followSmoothness: clampN(a.follow_smoothness, 0, 1) } : {})
      }
    }))
    notify('changed the zoom style')
    return 'Zoom style updated.'
  },

  split: (a) => {
    const { edit } = editor()
    const t = clampN(a.time, 0, seqDuration(edit.clips))
    const next = splitClips(edit.clips, t)
    if (next === edit.clips) fail('Nothing to split there (too close to a clip edge).')
    updateEdit((e) => ({ ...e, clips: next }))
    notify(`split at ${t.toFixed(1)}s`)
    return { clips: describe().clips }
  },

  remove_range: (a) => {
    const { edit } = editor()
    const dur = seqDuration(edit.clips)
    const s = clampN(a.start, 0, dur)
    const en = clampN(a.end, 0, dur)
    if (en - s < 0.1) fail('end must be after start.')
    if (en - s > dur - 0.5) fail('That would remove almost the whole video.')
    const clips = splitClips(splitClips(edit.clips, s), en)
    const starts = seqStarts(clips)
    const keep = clips.filter((c, i) => !(starts[i] >= s - 1e-3 && starts[i] + clipLen(c) <= en + 1e-3))
    if (!keep.length) fail('That would remove the whole video.')
    updateEdit((e) => ({ ...rippleRemove(e, s, en), clips: keep }))
    useEditor.getState().setTime(Math.min(useEditor.getState().time, Math.max(0, seqDuration(keep) - 0.05)))
    notify(`cut ${s.toFixed(1)}s to ${en.toFixed(1)}s`)
    return { seconds: r2(seqDuration(keep)), clips: describe().clips }
  },

  delete_clip: (a) => {
    const { edit } = editor()
    if (!edit.clips.some((c) => c.id === a.id)) fail('No clip with that id.')
    if (edit.clips.length <= 1) fail("Can't delete the only clip.")
    deleteSeqClip(String(a.id))
    notify('deleted a clip')
    return { clips: describe().clips }
  },

  set_transition: (a) => {
    const { edit } = editor()
    const kind = oneOf(a.kind, [...TRANSITIONS, 'none'] as const, 'kind')
    const t = kind === 'none' ? null : { kind, duration: has(a, 'duration') ? clampN(a.duration, 0.2, 1.5) : DEFAULT_TRANSITION.duration }
    if (edit.clips.length < 2) fail('There are no cuts yet. Split the video first.')
    if (a.all === true) setAllTransitions(t)
    else {
      const i = edit.clips.findIndex((c) => c.id === a.clip_id)
      if (i < 0) fail('No clip with that id (or pass all=true).')
      if (i === 0) fail('The first clip has nothing before it to transition from.')
      setTransition(String(a.clip_id), t)
    }
    notify(kind === 'none' ? 'removed a transition' : 'added a ' + kind + ' transition')
    return 'Transition updated.'
  },

  set_sound: (a) => {
    editor()
    updateEdit((e) => ({
      ...e,
      audio: {
        ...e.audio,
        ...(has(a, 'mic_volume') ? { micVolume: clampN(a.mic_volume, 0, 2) } : {}),
        ...(has(a, 'mute') ? { muted: !!a.mute } : {})
      },
      sfx: {
        click: { ...e.sfx.click, ...(has(a, 'click_sounds') ? { enabled: !!a.click_sounds } : {}), ...(has(a, 'click_volume') ? { volume: clampN(a.click_volume, 0, 1) } : {}) },
        typing: { ...e.sfx.typing, ...(has(a, 'typing_sounds') ? { enabled: !!a.typing_sounds } : {}), ...(has(a, 'typing_volume') ? { volume: clampN(a.typing_volume, 0, 1) } : {}) },
        zoom: { ...e.sfx.zoom, ...(has(a, 'zoom_sounds') ? { enabled: !!a.zoom_sounds } : {}), ...(has(a, 'zoom_volume') ? { volume: clampN(a.zoom_volume, 0, 1) } : {}) }
      }
    }))
    notify('changed the sound')
    return 'Sound updated.'
  },

  undo: (a) => {
    editor()
    const n = has(a, 'steps') ? Math.round(clampN(a.steps, 1, 20)) : 1
    let done = 0
    for (; done < n && useEditor.getState().past.length; done++) useEditor.getState().undo()
    if (done) notify('undid ' + done + (done > 1 ? ' changes' : ' change'))
    return `Undid ${done} change${done === 1 ? '' : 's'}.`
  },

  redo: (a) => {
    editor()
    const n = has(a, 'steps') ? Math.round(clampN(a.steps, 1, 20)) : 1
    let done = 0
    for (; done < n && useEditor.getState().future.length; done++) useEditor.getState().redo()
    if (done) notify('redid ' + done + (done > 1 ? ' changes' : ' change'))
    return `Redid ${done} change${done === 1 ? '' : 's'}.`
  },

  export_video: async (a) => {
    const { project, edit } = editor()
    const format = has(a, 'format') ? oneOf(a.format, ['mp4', 'gif'] as const, 'format') : 'mp4'
    const height = Number(has(a, 'resolution') ? oneOf(String(a.resolution), ['720', '1080', '1440', '2160'] as const, 'resolution') : '1080')
    const fps = Number(has(a, 'fps') ? oneOf(String(a.fps), ['30', '60'] as const, 'fps') : '60')
    const quality = has(a, 'quality') ? oneOf(a.quality, ['standard', 'high', 'ultra'] as const, 'quality') : 'high'
    // same license rule and naming as the export dialog, enforced in the main process
    const target = await window.ilf.agent.exportTarget(format).catch((e: any) => fail(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
    player.pause()
    useEditor.setState({ exporting: true })
    notify('exporting the video…')
    let last = 0
    try {
      const out = await exportProject(project, edit, { format, height, fps, quality, target: target as string }, ({ p }) => {
        if (p - last >= 0.25) {
          last = p
          notify(`exporting… ${Math.round(p * 100)}%`)
        }
      }, { cancelled: false })
      notify('export finished')
      return { file: out }
    } finally {
      useEditor.setState({ exporting: false })
    }
  }
}

async function run(tool: string, args: Args): Promise<Result> {
  const fn = tools[tool]
  if (!fn) return { ok: false, error: `"${tool}" is not available.` }
  try {
    const out: any = await fn(args && typeof args === 'object' && !Array.isArray(args) ? args : {})
    if (out && typeof out === 'object' && out.__image) return { ok: true, image: out.__image, mimeType: 'image/jpeg', text: out.text }
    return { ok: true, result: out }
  } catch (e: any) {
    return { ok: false, error: e instanceof AgentError ? e.message : 'Something went wrong: ' + (e?.message ?? String(e)) }
  }
}

/** Listen for tool calls from the bridge. Calls run one at a time, in order. */
export function startAgentListener() {
  let queue = Promise.resolve()
  return window.ilf.agent.onCall(({ id, tool, args }) => {
    queue = queue.then(async () => window.ilf.agent.result(id, await run(tool, args)))
  })
}
