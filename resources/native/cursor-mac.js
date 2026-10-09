// JXA: prints the system cursor type (arrow|hand|text) whenever it changes.
ObjC.import('AppKit')
function sig(c) {
  try { const h = c.hotSpot, s = c.image.size; return [h.x, h.y, s.width, s.height].join(',') } catch (e) { return '' }
}
const handSig = sig($.NSCursor.pointingHandCursor)
const textSig = sig($.NSCursor.IBeamCursor)
const out = $.NSFileHandle.fileHandleWithStandardOutput
const emit = (s) => out.writeData($.NSString.alloc.initWithUTF8String(s + '\n').dataUsingEncoding($.NSUTF8StringEncoding))
emit('ready')
let last = ''
while (true) {
  let t = 'arrow'
  try {
    const cur = $.NSCursor.currentSystemCursor
    const s = cur ? sig(cur) : ''
    if (s && s === handSig) t = 'hand'
    else if (s && s === textSig) t = 'text'
  } catch (e) {}
  if (t !== last) { emit(t); last = t }
  delay(0.03)
}
