/**
 * Self-contained ISO/IEC 18004 QR Code SVG Generator (Versions 1-L to 6-L, Byte Mode)
 * Renders crisp, scannable Memphis-framed SVG QR codes offline with zero external dependencies.
 */

const VERSIONS = [
  null,
  { size: 21, dataBytes: 19, ecBytesPerBlock: 7, blocks: 1, align: [] },
  { size: 25, dataBytes: 34, ecBytesPerBlock: 10, blocks: 1, align: [6, 18] },
  { size: 29, dataBytes: 55, ecBytesPerBlock: 15, blocks: 1, align: [6, 22] },
  { size: 33, dataBytes: 80, ecBytesPerBlock: 20, blocks: 1, align: [6, 26] },
  { size: 37, dataBytes: 108, ecBytesPerBlock: 26, blocks: 1, align: [6, 30] },
  { size: 41, dataBytes: 136, ecBytesPerBlock: 18, blocks: 2, align: [6, 34] }
];

// GF(256) log/exp tables with primitive polynomial 0x11d
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const msg = new Uint8Array(data.length + ecCount);
  msg.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return msg.slice(data.length);
}

function encodeCodewords(text) {
  const utf8 = new TextEncoder().encode(text);
  let ver = 1;
  while (ver <= 6 && utf8.length + 2 > VERSIONS[ver].dataBytes) {
    ver++;
  }
  if (ver > 6) {
    throw new Error('URL too long for compact QR code');
  }
  const spec = VERSIONS[ver];

  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Mode indicator: Byte mode = 0100
  pushBits(0b0100, 4);
  // Character count indicator (8 bits for V1-9 byte mode)
  pushBits(utf8.length, 8);
  for (const byte of utf8) {
    pushBits(byte, 8);
  }

  const maxBits = spec.dataBytes * 8;
  const terminator = Math.min(4, maxBits - bits.length);
  pushBits(0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataWords = new Uint8Array(spec.dataBytes);
  for (let i = 0; i < bits.length / 8; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bits[i * 8 + j];
    }
    dataWords[i] = b;
  }
  const pads = [0xec, 0x11];
  for (let i = bits.length / 8, p = 0; i < spec.dataBytes; i++, p++) {
    dataWords[i] = pads[p % 2];
  }

  if (spec.blocks === 1) {
    const ec = rsEncode(dataWords, spec.ecBytesPerBlock);
    const all = new Uint8Array(dataWords.length + ec.length);
    all.set(dataWords, 0);
    all.set(ec, dataWords.length);
    return { ver, spec, codewords: all };
  }

  // Interleave 2 equal blocks (V6-L: 2 x 68 data, 2 x 18 EC)
  const blockLen = spec.dataBytes / 2;
  const b1 = dataWords.slice(0, blockLen);
  const b2 = dataWords.slice(blockLen);
  const ec1 = rsEncode(b1, spec.ecBytesPerBlock);
  const ec2 = rsEncode(b2, spec.ecBytesPerBlock);
  const out = new Uint8Array(spec.dataBytes + spec.ecBytesPerBlock * 2);
  let idx = 0;
  for (let i = 0; i < blockLen; i++) {
    out[idx++] = b1[i];
    out[idx++] = b2[i];
  }
  for (let i = 0; i < spec.ecBytesPerBlock; i++) {
    out[idx++] = ec1[i];
    out[idx++] = ec2[i];
  }
  return { ver, spec, codewords: out };
}

function calcFormatBits(ecLevelBits, maskPattern) {
  const data = (ecLevelBits << 3) | maskPattern;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) {
      rem ^= 0x537 << (i - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

export function renderQrSvg(text, { dark = '#181824', light = '#FFFFFF', margin = 3 } = {}) {
  const { ver, spec, codewords } = encodeCodewords(text);
  const n = spec.size;
  const grid = Array.from({ length: n }, () => new Int8Array(n).fill(-1));
  const reserved = Array.from({ length: n }, () => new Uint8Array(n));

  const setModule = (r, c, val) => {
    if (r >= 0 && r < n && c >= 0 && c < n) {
      grid[r][c] = val ? 1 : 0;
      reserved[r][c] = 1;
    }
  };

  const placeFinder = (top, left) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const inCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setModule(top + r, left + c, inOuter && (onBorder || inCenter));
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, n - 7);
  placeFinder(n - 7, 0);

  // Alignment patterns
  const coords = spec.align;
  for (let i = 0; i < coords.length; i++) {
    for (let j = 0; j < coords.length; j++) {
      const cr = coords[i];
      const cc = coords[j];
      if (reserved[cr][cc]) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const isDark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
          setModule(cr + r, cc + c, isDark);
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < n - 8; i++) {
    if (!reserved[6][i]) setModule(6, i, i % 2 === 0);
    if (!reserved[i][6]) setModule(i, 6, i % 2 === 0);
  }

  // Dark module + reserve format info areas
  setModule(4 * ver + 9, 8, 1);
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = 1;
    if (!reserved[i][8]) reserved[i][8] = 1;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][n - 1 - i] = 1;
    reserved[n - 1 - i][8] = 1;
  }

  // Place data + EC bits in upward/downward 2-column zig-zag with Mask 0: (r + c) % 2 === 0
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  let upward = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip vertical timing column
    for (let vert = 0; vert < n; vert++) {
      const r = upward ? n - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (reserved[r][c]) continue;
        let bit = 0;
        if (bitIdx < totalBits) {
          bit = (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
          bitIdx++;
        }
        if ((r + c) % 2 === 0) bit ^= 1;
        grid[r][c] = bit;
      }
    }
    upward = !upward;
  }

  // Format bits for EC Level L (01) and Mask 0 (000)
  const fmt = calcFormatBits(0b01, 0);
  const fmtCoords1 = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ];
  for (let i = 0; i < 15; i++) {
    const bit = (fmt >>> i) & 1;
    const [r1, c1] = fmtCoords1[14 - i];
    grid[r1][c1] = bit;
    if (i < 8) {
      grid[8][n - 1 - i] = bit;
    } else {
      grid[n - 15 + i][8] = bit;
    }
  }

  const total = n + margin * 2;
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (grid[r][c] === 1) {
        path += `M${c + margin},${r + margin}h1v1h-1z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR Code to join game">
    <rect width="${total}" height="${total}" fill="${light}" rx="1.5"/>
    <path d="${path}" fill="${dark}"/>
  </svg>`;
}
