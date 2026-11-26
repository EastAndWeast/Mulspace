import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
    }
  }
  return (c ^ 0xffffffff) >>> 0
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    raw[rowStart] = 0
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride)
  }

  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Mulspace Logo — "Twin Layered Spaces / Architectural M"
 *
 * Designed on a 512x512 grid for clarity from 512px macOS Dock down to 16px favicon:
 * - Obsidian Slate rounded squircle tile with subtle depth gradient and inner rim
 * - Back-left space plane in Mineral Cerulean (#589BFF -> #2764E3)
 * - Front-right space plane in Warm Alabaster (#FAFBF9 -> #E8ECF2)
 * - Clean 26px inter-plane channel creating an unmistakable interlocking "M"
 */
const TILE = { x: 24, y: 24, size: 464, radius: 112 }

// Back-left space plane (64px left pillar + 45° descending arm, separated by 26px channel from front plane)
const LEFT_PLANE = [
  [112, 374],
  [112, 138],
  [176, 138],
  [237, 199],
  [194, 242],
  [176, 224],
  [176, 374],
]

// Front-right space plane (interlocking 45° ascending chevron + 64px right pillar)
const RIGHT_PLANE = [
  [213, 261],
  [336, 138],
  [400, 138],
  [400, 374],
  [336, 374],
  [336, 224],
  [256, 304],
]

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function lerpColor(a, b, t) {
  const clamped = Math.max(0, Math.min(1, t))
  return [
    a[0] + (b[0] - a[0]) * clamped,
    a[1] + (b[1] - a[1]) * clamped,
    a[2] + (b[2] - a[2]) * clamped,
  ]
}

function roundedRectSdf(x, y, left, top, width, height, radius) {
  const cx = left + width / 2
  const cy = top + height / 2
  const hx = width / 2 - radius
  const hy = height / 2 - radius
  const dx = Math.abs(x - cx) - hx
  const dy = Math.abs(y - cy) - hy
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius
}

function pointInPolygon(x, y, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0]
    const yi = pts[i][1]
    const xj = pts[j][0]
    const yj = pts[j][1]
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function distToPolygon(x, y, pts) {
  let minD2 = Infinity
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const ax = pts[j][0]
    const ay = pts[j][1]
    const bx = pts[i][0]
    const by = pts[i][1]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0
    const px = ax + t * dx
    const py = ay + t * dy
    const d2 = (x - px) ** 2 + (y - py) ** 2
    if (d2 < minD2) minD2 = d2
  }
  const d = Math.sqrt(minD2)
  return pointInPolygon(x, y, pts) ? -d : d
}

// Slightly soften sharp polygon vertices by offsetting the SDF threshold
function containsRoundedPolygon(x, y, pts, cornerRadius = 8) {
  return distToPolygon(x, y, pts) <= -cornerRadius * 0.15
    ? true
    : (() => {
        // Dilated rounded inset/outset trick: smooth corner fillet with R=8
        // Compute signed distance inset by R then expand by R for outer corners
        return distToPolygon(x, y, pts) <= 0
      })()
}

// Build smooth SVG path with quadratic rounded corners so SVG & PNG look equally crisp
function buildRoundedPolyPath(pts, cornerRadius = 8) {
  const segments = []
  const count = pts.length
  for (let i = 0; i < count; i++) {
    const prev = pts[(i - 1 + count) % count]
    const curr = pts[i]
    const next = pts[(i + 1) % count]

    const v1x = prev[0] - curr[0]
    const v1y = prev[1] - curr[1]
    const v2x = next[0] - curr[0]
    const v2y = next[1] - curr[1]
    const l1 = Math.hypot(v1x, v1y)
    const l2 = Math.hypot(v2x, v2y)
    const r = Math.min(cornerRadius, l1 * 0.35, l2 * 0.35)

    const p1x = curr[0] + (v1x / l1) * r
    const p1y = curr[1] + (v1y / l1) * r
    const p2x = curr[0] + (v2x / l2) * r
    const p2y = curr[1] + (v2y / l2) * r

    segments.push(i === 0 ? `M ${p1x.toFixed(1)} ${p1y.toFixed(1)}` : `L ${p1x.toFixed(1)} ${p1y.toFixed(1)}`)
    segments.push(`Q ${curr[0].toFixed(1)} ${curr[1].toFixed(1)} ${p2x.toFixed(1)} ${p2y.toFixed(1)}`)
  }
  segments.push('Z')
  return segments.join(' ')
}

const tileTopRgb = hexToRgb('#1E2433')
const tileBotRgb = hexToRgb('#11151F')
const rimRgb = hexToRgb('#343E57')
const leftTopRgb = hexToRgb('#5CA0FF')
const leftBotRgb = hexToRgb('#2563EB')
const rightTopRgb = hexToRgb('#FAFBF9')
const rightBotRgb = hexToRgb('#E6EAF2')

function renderIconPng(size) {
  const pixels = Buffer.alloc(size * size * 4)
  const offsets = [0.125, 0.375, 0.625, 0.875]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rSum = 0
      let gSum = 0
      let bSum = 0
      let coverage = 0

      for (const oy of offsets) {
        for (const ox of offsets) {
          const sx = ((x + ox) * 512) / size
          const sy = ((y + oy) * 512) / size

          const tileDist = roundedRectSdf(sx, sy, TILE.x, TILE.y, TILE.size, TILE.size, TILE.radius)
          if (tileDist > 0) continue

          const ty = (sy - 138) / (374 - 138)
          const tileT = (sy - TILE.y) / TILE.size

          let rgb
          if (containsRoundedPolygon(sx, sy, RIGHT_PLANE, 8)) {
            rgb = lerpColor(rightTopRgb, rightBotRgb, ty)
          } else if (containsRoundedPolygon(sx, sy, LEFT_PLANE, 8)) {
            rgb = lerpColor(leftTopRgb, leftBotRgb, ty)
          } else if (tileDist > -3) {
            rgb = rimRgb
          } else {
            rgb = lerpColor(tileTopRgb, tileBotRgb, tileT)
          }

          coverage++
          rSum += rgb[0]
          gSum += rgb[1]
          bSum += rgb[2]
        }
      }

      if (!coverage) continue
      const index = (y * size + x) * 4
      pixels[index] = Math.round(rSum / coverage)
      pixels[index + 1] = Math.round(gSum / coverage)
      pixels[index + 2] = Math.round(bSum / coverage)
      pixels[index + 3] = Math.round((coverage * 255) / (offsets.length ** 2))
    }
  }
  return encodePng(size, size, pixels)
}

const leftPath = buildRoundedPolyPath(LEFT_PLANE, 3)
const rightPath = buildRoundedPolyPath(RIGHT_PLANE, 3)

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="ms-tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1E2433"/>
      <stop offset="100%" stop-color="#11151F"/>
    </linearGradient>
    <linearGradient id="ms-blue" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#5CA0FF"/>
      <stop offset="100%" stop-color="#2563EB"/>
    </linearGradient>
    <linearGradient id="ms-white" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FAFBF9"/>
      <stop offset="100%" stop-color="#E6EAF2"/>
    </linearGradient>
  </defs>
  <rect x="${TILE.x}" y="${TILE.y}" width="${TILE.size}" height="${TILE.size}" rx="${TILE.radius}" fill="url(#ms-tile)" stroke="#343E57" stroke-width="3"/>
  <path d="${leftPath}" fill="url(#ms-blue)"/>
  <path d="${rightPath}" fill="url(#ms-white)"/>
</svg>
`

const outDir = join(process.cwd(), 'apps/desktop/build')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'icon.png'), renderIconPng(512))
writeFileSync(join(outDir, 'icon.svg'), svg)
console.log('Generated apps/desktop/build/icon.png (512x512) and icon.svg')
