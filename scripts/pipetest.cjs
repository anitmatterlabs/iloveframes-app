const { spawn } = require('child_process')
const ff = require('ffmpeg-static')
const W = 1920, H = 1080, N = 240
const preset = process.argv[2] || 'faster'
const pix = process.argv[3] || 'bgra'
const frame = Buffer.alloc(W * H * 4)
for (let i = 0; i < frame.length; i += 4) { frame[i] = (i / 4) % 255; frame[i + 1] = ((i / 4) / W) % 255; frame[i + 2] = 128; frame[i + 3] = 255 }
const args = preset === 'null' ? ['-f', 'rawvideo', '-pix_fmt', pix, '-s', `${W}x${H}`, '-r', '60', '-i', 'pipe:0', '-f', 'null', '-'] :
  ['-y', '-f', 'rawvideo', '-pix_fmt', pix, '-s', `${W}x${H}`, '-r', '60', '-i', 'pipe:0', '-vf', process.env.VF || 'format=yuv420p', '-c:v', 'libx264', '-preset', preset, '-crf', '17', '-f', 'mp4', process.env.TEMP + '/pt.mp4']
const p = spawn(ff, args)
p.stderr.on('data', () => {})
const t = Date.now()
let i = 0
const write = () => {
  while (i < N) { i++; const f = Buffer.from(frame); f[0] = i; if (!p.stdin.write(f)) return p.stdin.once('drain', write) }
  p.stdin.end()
}
write()
p.on('close', () => console.log(preset, pix, ((Date.now() - t) / N).toFixed(1), 'ms/frame'))
