import MP4Box from 'mp4box'

export interface Demuxed {
  config: VideoDecoderConfig
  samples: { ts: number; dur: number; key: boolean; data: Uint8Array }[]
  width: number
  height: number
}

export function demux(buf: ArrayBuffer): Promise<Demuxed> {
  return new Promise((resolve, reject) => {
    const file = MP4Box.createFile()
    let track: any
    const raw: any[] = []
    file.onError = (e: any) => reject(new Error(String(e)))
    file.onReady = (info: any) => {
      track = info.videoTracks[0]
      if (!track) return reject(new Error('No video track'))
      file.setExtractionOptions(track.id, null, { nbSamples: 1e9 })
      file.start()
    }
    file.onSamples = (_id: number, _u: any, samples: any[]) => raw.push(...samples)
    ;(buf as any).fileStart = 0
    file.appendBuffer(buf)
    file.flush()
    if (!track) return reject(new Error('Could not parse video'))
    const trak = file.getTrackById(track.id)
    let description: Uint8Array | undefined
    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
      const box = entry.avcC || entry.hvcC
      if (box) {
        const stream = new (MP4Box as any).DataStream(undefined, 0, (MP4Box as any).DataStream.BIG_ENDIAN)
        box.write(stream)
        description = new Uint8Array(stream.buffer, 8)
      }
    }
    const minCts = raw.reduce((m, s) => Math.min(m, s.cts), Infinity)
    const samples = raw.map((s) => ({
      ts: Math.round(((s.cts - minCts) * 1e6) / s.timescale),
      dur: Math.round((s.duration * 1e6) / s.timescale),
      key: s.is_sync,
      data: s.data as Uint8Array
    }))
    resolve({
      config: { codec: track.codec, codedWidth: track.video.width, codedHeight: track.video.height, description, optimizeForLatency: true },
      samples,
      width: track.video.width,
      height: track.video.height
    })
  })
}

/** Sequential, frame-accurate frame access backed by WebCodecs. */
export class FrameSource {
  private decoder: VideoDecoder
  private queue: VideoFrame[] = []
  private current: VideoFrame | null = null
  private next = 0
  private flushed = false
  private wake: (() => void) | null = null
  private err: any = null

  constructor(private d: Demuxed) {
    this.decoder = new VideoDecoder({
      output: (f) => {
        this.queue.push(f)
        this.wake?.()
      },
      error: (e) => {
        this.err = e
        this.wake?.()
      }
    })
    this.decoder.configure(d.config)
  }

  /** Hard jump (e.g. a cut): drop decoded frames and restart from the keyframe before t. */
  jump(t: number) {
    this.current?.close()
    this.current = null
    this.queue.forEach((f) => f.close())
    this.queue = []
    try {
      this.decoder.reset()
      this.decoder.configure(this.d.config)
    } catch {}
    this.flushed = false
    this.seek(t)
  }

  seek(t: number) {
    const tu = t * 1e6
    let idx = 0
    for (let i = 0; i < this.d.samples.length; i++) {
      if (this.d.samples[i].ts > tu) break
      if (this.d.samples[i].key) idx = i
    }
    this.next = idx
  }

  async frameAt(t: number): Promise<VideoFrame | null> {
    const tu = t * 1e6 + 500
    for (;;) {
      if (this.err) throw this.err
      while (this.queue.length && this.queue[0].timestamp <= tu) {
        this.current?.close()
        this.current = this.queue.shift()!
      }
      if (this.queue.length) return this.current
      if (this.next >= this.d.samples.length) {
        if (!this.flushed) {
          this.flushed = true
          await this.decoder.flush()
          continue
        }
        return this.current
      }
      while (this.next < this.d.samples.length && this.decoder.decodeQueueSize < 8) {
        const s = this.d.samples[this.next++]
        this.decoder.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: s.ts, duration: s.dur, data: s.data }))
      }
      await new Promise<void>((r) => {
        this.wake = r
        setTimeout(r, 4)
      })
      this.wake = null
    }
  }

  close() {
    this.current?.close()
    this.queue.forEach((f) => f.close())
    this.queue = []
    try {
      this.decoder.close()
    } catch {}
  }
}

