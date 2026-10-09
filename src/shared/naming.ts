/**
 * Memorable, unique-looking names: "Velvet Comet · 9 Oct, 1:20 AM".
 * The word pair is derived from the project id, so it is stable for a project
 * and different between projects; dates make collisions practically impossible.
 */
const ADJ = ['Velvet', 'Amber', 'Lunar', 'Neon', 'Coral', 'Silver', 'Golden', 'Cosmic', 'Crimson', 'Azure', 'Misty', 'Solar', 'Indigo', 'Jade', 'Polar', 'Ruby', 'Cobalt', 'Saffron', 'Ivory', 'Echo', 'Violet', 'Copper', 'Frosted', 'Electric', 'Sunlit', 'Hidden', 'Quiet', 'Swift', 'Bright', 'Silk', 'Wild', 'Mellow']
const NOUN = ['Comet', 'Falcon', 'Harbor', 'Orbit', 'Meadow', 'Prism', 'Ember', 'Lagoon', 'Summit', 'Canyon', 'Willow', 'Aurora', 'Nebula', 'Pixel', 'Quartz', 'Lantern', 'Atlas', 'Breeze', 'Cascade', 'Dune', 'Fjord', 'Galaxy', 'Horizon', 'Island', 'Jet', 'Kite', 'Lotus', 'Mirage', 'Nova', 'Otter', 'Pulse', 'Ripple']

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export function wordPair(seed: string) {
  const h = hash(seed)
  return `${ADJ[h % ADJ.length]} ${NOUN[(h >>> 8) % NOUN.length]}`
}

export function projectName(seed: string, d = new Date()) {
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${wordPair(seed)} · ${date}, ${time}`
}

const pad = (n: number) => String(n).padStart(2, '0')
export function stamp(d = new Date(), seconds = false) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${seconds ? pad(d.getSeconds()) : ''}`
}

/** Safe, readable file name: "Velvet-Comet_2026-10-09_0120". */
export function fileName(name: string, d = new Date(), seconds = false) {
  const base = (name.split('·')[0] || name)
    .replace(/[\/:*?"<>|]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'iloveframes'
  return `${base}_${stamp(d, seconds)}`
}
