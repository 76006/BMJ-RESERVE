// 轻量 QR 码生成器 — 客户端侧，无云依赖
// 微信小程序可用：返回二维数组矩阵，配合 canvas 渲染
// 支持：字母数字模式 / Version 1-6 / EC Level M

// ============ GF(256) 运算 ============
const EXP_TABLE = []
const LOG_TABLE = []
;(function _initGF() {
  let x = 1
  for (let i = 0; i < 256; i++) {
    EXP_TABLE[i] = x
    LOG_TABLE[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11D
  }
  LOG_TABLE[1] = 0
})()

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0
  return EXP_TABLE[(LOG_TABLE[a] + LOG_TABLE[b]) % 255]
}

function gfPolyMul(p1, p2) {
  const res = new Array(p1.length + p2.length - 1).fill(0)
  for (let i = 0; i < p1.length; i++)
    for (let j = 0; j < p2.length; j++)
      res[i + j] ^= gfMul(p1[i], p2[j])
  return res
}

function gfGenPoly(degree) {
  let poly = [1]
  for (let i = 0; i < degree; i++)
    poly = gfPolyMul(poly, [1, EXP_TABLE[i]])
  return poly
}

// ============ EC 码字计算 ============
function calcEC(data, ecCount) {
  const gen = gfGenPoly(ecCount)
  const msg = [...data]
  for (let i = 0; i < ecCount; i++) msg.push(0)

  for (let i = 0; i < data.length; i++) {
    const factor = LOG_TABLE[msg[i]]
    if (factor === undefined) continue
    for (let j = 0; j < gen.length; j++)
      msg[i + j] ^= EXP_TABLE[(LOG_TABLE[gen[j]] + factor) % 255]
  }
  return msg.slice(data.length)
}

// ============ 版本参数 ============
const VERSION_INFO = [
  null,
  { ecWords: 26, groups: [[1, 26]],    align: [] },           // v1  21x21
  { ecWords: 44, groups: [[1, 44]],    align: [6, 18] },      // v2  25x25
  { ecWords: 70, groups: [[1, 70]],    align: [6, 22] },      // v3  29x29
  { ecWords: 100,groups: [[1, 100]],   align: [6, 26] },      // v4  33x33
  { ecWords: 134,groups: [[1, 134]],   align: [6, 30] },      // v5  37x37
  { ecWords: 172,groups: [[2, 86]],    align: [6, 34] },      // v6  41x41
]

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'

function pickVersion(textLen) {
  // 字母数字模式：v1=20, v2=29, v3=38, v4=47, v5=62, v6=76
  const caps = [20, 29, 38, 47, 62, 76]
  for (let v = 1; v <= 6; v++) {
    if (textLen <= caps[v - 1]) return v
  }
  return 6
}

// ============ 数据编码 ============
function encodeData(text, version) {
  const info = VERSION_INFO[version]
  const totalBytes = info.ecWords

  const bits = []
  // 模式指示符：0010（字母数字）
  bits.push(0, 0, 1, 0)
  // 字符计数（v1-v9: 9bits）
  const count = text.length
  for (let i = 8; i >= 0; i--) bits.push((count >> i) & 1)
  // 编码字符（每2个字符11bits）
  for (let i = 0; i < count; i += 2) {
    const c1 = ALNUM.indexOf(text[i])
    if (c1 < 0) throw new Error('Unsupported char: ' + text[i])
    if (i + 1 < count) {
      const c2 = ALNUM.indexOf(text[i + 1])
      if (c2 < 0) throw new Error('Unsupported char: ' + text[i + 1])
      const val = c1 * 45 + c2
      for (let j = 10; j >= 0; j--) bits.push((val >> j) & 1)
    } else {
      for (let j = 5; j >= 0; j--) bits.push((c1 >> j) & 1)
    }
  }
  // 终止符（最多4个0）
  const termLen = Math.min(4, totalBytes * 8 - bits.length)
  for (let i = 0; i < termLen; i++) bits.push(0)
  // 补至8的倍数
  while (bits.length % 8 !== 0) bits.push(0)
  // 填充字节（0xEC, 0x11 交替）
  const bytes = []
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] || 0)
    bytes.push(b)
  }
  while (bytes.length < totalBytes) bytes.push(bytes.length % 2 === 0 ? 0xEC : 0x11)

  // 分组 + EC
  const groups = info.groups
  const allBlocks = []
  let offset = 0
  for (const [gCount, gSize] of groups) {
    for (let g = 0; g < gCount; g++) {
      const block = bytes.slice(offset, offset + gSize)
      const ec = calcEC(block, gSize)
      allBlocks.push({ data: block, ec })
      offset += gSize
    }
  }

  // 交织
  const result = []
  let maxDataLen = 0
  for (const b of allBlocks) maxDataLen = Math.max(maxDataLen, b.data.length)
  for (let i = 0; i < maxDataLen; i++)
    for (const b of allBlocks)
      if (i < b.data.length) result.push(b.data[i])
  const ecLen = allBlocks[0].ec.length
  for (let i = 0; i < ecLen; i++)
    for (const b of allBlocks) result.push(b.ec[i])

  return result
}

// ============ 矩阵操作 ============
function createMatrix(size) {
  const m = []
  for (let i = 0; i < size; i++) {
    m[i] = new Array(size).fill(null)
  }
  return m
}

function placeFinder(m, row, col) {
  const size = m.length
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r, cc = col + c
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue
      if ((r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4))
        m[rr][cc] = true
      else if (r >= 0 && r <= 6 && c >= 0 && c <= 6)
        m[rr][cc] = false
    }
  }
}

function placeTiming(m) {
  const size = m.length
  for (let i = 8; i < size - 8; i++) {
    m[6][i] = i % 2 === 0
    m[i][6] = i % 2 === 0
  }
}

function placeAlignment(m, row, col) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const val = (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0))
      m[row + r][col + c] = val
    }
  }
}

function placeAlignments(m, version) {
  const info = VERSION_INFO[version]
  const pos = info.align
  if (pos.length === 0) return
  const size = m.length
  const centers = [pos[0]]
  for (let i = 1; i < pos.length; i++) {
    if (pos[i] !== pos[i - 1]) centers.push(pos[i])
  }
  // Version 1 has no alignment, v2+ has at least one
  for (const r of centers) {
    for (const c of centers) {
      // 跳过与 finder 重叠的位置
      if ((r < 9 && c < 9) || (r < 9 && c > size - 10) || (r > size - 10 && c < 9))
        continue
      placeAlignment(m, r, c)
    }
  }
}

function reserveFormatAreas(m) {
  const size = m.length
  for (let i = 0; i <= 8; i++) {
    if (m[i][8] === null) m[i][8] = -1
    if (m[8][i] === null) m[8][i] = -1
  }
  m[8][8] = -1
  for (let i = 0; i <= 7; i++) {
    if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = -1
  }
  // Dark module
  m[size - 8][8] = true
}

function setupMatrix(m, version) {
  const size = m.length
  placeFinder(m, 0, 0)
  placeFinder(m, 0, size - 7)
  placeFinder(m, size - 7, 0)
  placeTiming(m)
  placeAlignments(m, version)
  reserveFormatAreas(m)
  return m
}

// ============ 数据填充 ============
function placeDataBits(m, codewords) {
  const size = m.length
  const bits = []
  for (const cw of codewords) {
    for (let j = 7; j >= 0; j--) bits.push((cw >> j) & 1 ? true : false)
  }

  // Zig-zag placement, bottom-up
  let idx = 0
  let dir = -1
  let col = size - 1
  let row = size - 1

  while (col > 0) {
    if (col === 6) col = 5
    for (let r = row; r >= 0 && r < size; r += dir) {
      for (let c = col; c >= col - 1; c--) {
        if (m[r][c] === null) {
          m[r][c] = idx < bits.length ? bits[idx++] : false
        }
      }
    }
    dir = -dir
    row = dir === -1 ? size - 1 : 0
    col -= 2
  }
}

// ============ 掩码 ============
const MASK_PATTERNS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
]

function applyMask(m, maskFn) {
  const size = m.length
  const masked = createMatrix(size)
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (m[r][c] === -1) {
        masked[r][c] = -1
      } else if (m[r][c] !== null) {
        masked[r][c] = m[r][c] !== maskFn(r, c)
      } else {
        masked[r][c] = null
      }
    }
  }
  return masked
}

function evalMask(m) {
  // 简化的惩罚评分
  let penalty = 0
  const size = m.length

  // 连续同色 > 5
  for (let r = 0; r < size; r++) {
    let run = 1
    for (let c = 1; c < size; c++) {
      if (m[r][c] === m[r][c - 1] && m[r][c] !== null && m[r][c] !== -1) {
        run++
      } else {
        if (run >= 5) penalty += 3 + (run - 5)
        run = 1
      }
    }
    if (run >= 5) penalty += 3 + (run - 5)
  }
  for (let c = 0; c < size; c++) {
    let run = 1
    for (let r = 1; r < size; r++) {
      if (m[r][c] === m[r - 1][c] && m[r][c] !== null && m[r][c] !== -1) {
        run++
      } else {
        if (run >= 5) penalty += 3 + (run - 5)
        run = 1
      }
    }
    if (run >= 5) penalty += 3 + (run - 5)
  }

  // 2x2 同色块
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c]
      if (v !== null && v !== -1 && m[r][c + 1] === v && m[r + 1][c] === v && m[r + 1][c + 1] === v)
        penalty += 3
    }
  }

  return penalty
}

// ============ 格式信息（EC M + mask pattern） ============
const FORMAT_BITS = [
  [1,0,1,0,1,0,0,0,0,0,1,1,0,1,0],
  [1,0,1,1,1,1,1,0,0,0,0,1,0,0,1],
  [1,0,0,1,1,0,1,1,0,1,1,1,1,0,0],
  [1,0,0,1,0,0,0,0,0,1,0,0,1,1,0],
  [1,1,1,0,1,1,1,1,0,0,1,1,0,0,0],
  [1,1,1,1,1,0,0,0,0,0,0,0,0,1,0],
  [1,1,0,0,1,0,1,0,0,1,0,1,1,1,1],
  [1,1,0,0,0,1,0,1,0,1,1,0,1,0,1],
]

function placeFormat(m, maskIdx) {
  const size = m.length
  const bits = FORMAT_BITS[maskIdx]
  if (!bits) return

  // 左上
  for (let i = 0; i <= 5; i++) m[i][8] = !!bits[i]
  m[7][8] = !!bits[6]
  m[8][8] = !!bits[7]
  m[8][7] = !!bits[8]
  for (let i = 9; i <= 14; i++) m[8][14 - i] = !!bits[i]

  // 左下 + 右上
  for (let i = 0; i <= 7; i++) m[size - 1 - i][8] = !!bits[i]
  for (let i = 0; i <= 7; i++) m[8][size - 8 + i] = !!bits[14 - i]
}

// ============ 主函数 ============
function generate(text) {
  const version = pickVersion(text.length)
  const size = 17 + version * 4
  const codewords = encodeData(text, version)

  let matrix = createMatrix(size)
  setupMatrix(matrix, version)
  placeDataBits(matrix, codewords)

  // 尝试8种掩码，选评分最低的
  let bestMask = null
  let bestScore = Infinity
  let bestMasked = null

  for (let maskIdx = 0; maskIdx < 8; maskIdx++) {
    const masked = applyMask(matrix, MASK_PATTERNS[maskIdx])
    placeFormat(masked, maskIdx)
    const score = evalMask(masked)
    if (score < bestScore) {
      bestScore = score
      bestMasked = masked
      bestMask = maskIdx
    }
  }

  // 确保所有 null → false
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (bestMasked[r][c] === null) bestMasked[r][c] = false
      if (bestMasked[r][c] === -1) bestMasked[r][c] = false
    }
  }

  return {
    matrix: bestMasked,
    size,
    version
  }
}

module.exports = { generate, VERSION_INFO }
