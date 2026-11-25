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
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
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

function inRoundedRect(x, y, rx, ry, rw, rh, r) {
  const nx = Math.max(rx + r, Math.min(x, rx + rw - r))
  const ny = Math.max(ry + r, Math.min(y, ry + rh - r))
  if (x < rx || x > rx + rw || y < ry || y > ry + rh) return false
  const dx = x - nx
  const dy = y - ny
  return dx * dx + dy * dy <= r * r
}

function renderIconPng(size) {
  const buf = Buffer.alloc(size * size * 4)
  const s = size

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const idx = (y * s + x) * 4
      const u = x / s
      const v = y / s

      // Outer rounded squircle background (deep indigo-slate gradient)
      if (!inRoundedRect(x, y, s * 0.06, s * 0.06, s * 0.88, s * 0.88, s * 0.2)) {
        buf[idx] = 0
        buf[idx + 1] = 0
        buf[idx + 2] = 0
        buf[idx + 3] = 0
        continue
      }

      let r = Math.round(24 + u * 26)
      let g = Math.round(32 + v * 48)
      let b = Math.round(78 + (u + v) * 58)

      // Three layered isolated workspace cards (Blue, Purple, Emerald)
      if (inRoundedRect(x, y, s * 0.2, s * 0.22, s * 0.44, s * 0.44, s * 0.09)) {
        r = 59
        g = 130
        b = 246
      }
      if (inRoundedRect(x, y, s * 0.3, s * 0.3, s * 0.44, s * 0.44, s * 0.09)) {
        r = 139
        g = 92
        b = 246
      }
      if (inRoundedRect(x, y, s * 0.38, s * 0.38, s * 0.42, s * 0.42, s * 0.09)) {
        r = 16
        g = 185
        b = 129
      }

      buf[idx] = r
      buf[idx + 1] = g
      buf[idx + 2] = b
      buf[idx + 3] = 255
    }
  }
  return encodePng(size, size, buf)
}

const outDir = join(process.cwd(), 'apps/desktop/build')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'icon.png'), renderIconPng(512))
writeFileSync(
  join(outDir, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect x="30" y="30" width="452" height="452" rx="102" fill="#1E294E"/>
  <rect x="102" y="112" width="225" height="225" rx="46" fill="#3B82F6"/>
  <rect x="154" y="154" width="225" height="225" rx="46" fill="#8B5CF6"/>
  <rect x="195" y="195" width="215" height="215" rx="46" fill="#10B981"/>
</svg>\n`,
)
console.log('Generated apps/desktop/build/icon.png (512x512) and icon.svg')
