// JXA: prints the system cursor type (arrow|hand|text) whenever it changes.
// argv[0] is the app's pid: the helper exits by itself once that process is gone,
// so a crash or force-quit never leaves it running in the background.
ObjC.import('AppKit')
ObjC.import('stdlib')
function sig(c) {
  try { const h = c.hotSpot, s = c.image.size; return [h.x, h.y, s.width, s.height].join(',') } catch (e) { return '' }
}
function alive(pid) {
  if (!pid) return true
  try {
    const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid)
    // the main Electron process is a regular app; a missing or terminated one means we're orphaned
    return !!(app && !app.isNil() && !app.terminated)
  } catch (e) { return true }
}
function run(argv) {
  const parent = parseInt((argv && argv[0]) || '0', 10) || 0
  const handSig = sig($.NSCursor.pointingHandCursor)
  const textSig = sig($.NSCursor.IBeamCursor)
  const out = $.NSFileHandle.fileHandleWithStandardOutput
  const emit = (s) => out.writeData($.NSString.alloc.initWithUTF8String(s + '\n').dataUsingEncoding($.NSUTF8StringEncoding))
  emit('ready')
  let last = ''
  let tick = 0
  while (true) {
    let t = 'arrow'
    try {
      const cur = $.NSCursor.currentSystemCursor
      const s = cur ? sig(cur) : ''
      if (s && s === handSig) t = 'hand'
      else if (s && s === textSig) t = 'text'
    } catch (e) {}
    if (t !== last) { emit(t); last = t }
    if (++tick % 60 === 0 && !alive(parent)) $.exit(0)
    delay(0.03)
  }
}
