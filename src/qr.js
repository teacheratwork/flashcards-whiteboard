/* Minimal QR Code generator (byte mode), self-contained, no dependencies.
   Adapted from Project Nayuki's "QR Code generator library" (public domain).
   Exposes window.QR.svg(text, {ecc, border, dark, light}) -> SVG string. */
(function (global) {
  "use strict";

  var ECC_ORDINAL = { L: 0, M: 1, Q: 2, H: 3 };    // index into the EC tables
  var ECC_FORMATBITS = [1, 0, 3, 2];               // by ordinal -> format bits

  function QrSegment(mode, numChars, bitData) {
    this.mode = mode; this.numChars = numChars; this.bitData = bitData;
  }
  // byte-mode segment from UTF-8 bytes
  function bytesSeg(str) {
    var bytes = utf8(str), bits = [];
    for (var i = 0; i < bytes.length; i++) appendBits(bytes[i], 8, bits);
    return new QrSegment(0x4, bytes.length, bits);
  }
  function utf8(str) {
    var out = [], enc = encodeURIComponent(str);
    for (var i = 0; i < enc.length; i++) {
      if (enc[i] === "%") { out.push(parseInt(enc.substr(i + 1, 2), 16)); i += 2; }
      else out.push(enc.charCodeAt(i));
    }
    return out;
  }
  function appendBits(val, len, arr) {
    for (var i = len - 1; i >= 0; i--) arr.push((val >>> i) & 1);
  }

  // --- error correction tables (per version 1..40) ---
  var ECC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  ];
  var NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  ];

  function numDataCodewords(ver, ecl) {
    var totalCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    var eccPerBlock = ECC_CODEWORDS_PER_BLOCK[ecl][ver];
    var numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][ver];
    return totalCodewords - eccPerBlock * numBlocks;
  }
  function getNumRawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  // --- Reed-Solomon ---
  function rsDivisor(degree) {
    var result = []; for (var i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < result.length; j++) {
        result[j] = rsMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = rsMul(root, 0x02);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    var result = divisor.map(function () { return 0; });
    data.forEach(function (b) {
      var factor = b ^ result.shift();
      result.push(0);
      divisor.forEach(function (coef, i) { result[i] ^= rsMul(coef, factor); });
    });
    return result;
  }
  function rsMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }

  function encode(text, eccName) {
    var ecl = ECC_ORDINAL[eccName || "M"];   // ordinal 0..3 (L,M,Q,H)
    var seg = bytesSeg(text);
    // choose smallest version 1..40 that fits
    var ver;
    for (ver = 1; ver <= 40; ver++) {
      var capacityBits = numDataCodewords(ver, ecl) * 8;
      var ccbits = (ver <= 9) ? 8 : 16;      // byte-mode char-count bits
      var usedBits = 4 + ccbits + seg.numChars * 8;
      if (usedBits <= capacityBits) break;
    }
    if (ver > 40) throw new Error("Data too long");

    var bits = [];
    appendBits(seg.mode, 4, bits);
    appendBits(seg.numChars, (ver <= 9) ? 8 : 16, bits);
    bits = bits.concat(seg.bitData);

    var dataCapacityBits = numDataCodewords(ver, ecl) * 8;
    appendBits(0, Math.min(4, dataCapacityBits - bits.length), bits);
    appendBits(0, (8 - bits.length % 8) % 8, bits);
    for (var pad = 0xEC; bits.length < dataCapacityBits; pad ^= 0xEC ^ 0x11)
      appendBits(pad, 8, bits);

    var dataCodewords = [];
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      dataCodewords.push(b);
    }
    return drawCode(ver, ecl, addEcc(ver, ecl, dataCodewords));
  }

  function addEcc(ver, ecl, data) {
    var numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][ver];
    var blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][ver];
    var rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    var numShortBlocks = numBlocks - rawCodewords % numBlocks;
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);

    var blocks = [];
    var divisor = rsDivisor(blockEccLen);
    for (var i = 0, k = 0; i < numBlocks; i++) {
      var dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      var ecc = rsRemainder(dat, divisor);
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var result = [];
    for (var col = 0; col < blocks[0].length; col++) {
      for (var row = 0; row < blocks.length; row++) {
        if (col !== shortBlockLen - blockEccLen || row >= numShortBlocks)
          result.push(blocks[row][col]);
      }
    }
    return result;
  }

  function drawCode(ver, ecl, allCodewords) {
    var size = ver * 4 + 17;
    var modules = [], isFunc = [];
    for (var i = 0; i < size; i++) {
      modules.push(new Array(size).fill(false));
      isFunc.push(new Array(size).fill(false));
    }
    function setFunc(x, y, dark) { modules[y][x] = dark; isFunc[y][x] = true; }

    // timing patterns
    for (var i = 0; i < size; i++) { setFunc(6, i, i % 2 === 0); setFunc(i, 6, i % 2 === 0); }
    // finder patterns
    [[0, 0], [size - 7, 0], [0, size - 7]].forEach(function (p) {
      for (var dy = -1; dy <= 7; dy++) for (var dx = -1; dx <= 7; dx++) {
        var xx = p[0] + dx, yy = p[1] + dy;
        if (xx < 0 || xx >= size || yy < 0 || yy >= size) continue;
        var d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        setFunc(xx, yy, d !== 2 && d !== 4);
      }
    });
    // alignment patterns
    var alignPos = alignmentPatternPositions(ver);
    var n = alignPos.length;
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      var cx = alignPos[i], cy = alignPos[j];
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++)
        setFunc(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }

    // reserve format + version areas (filled later); index 6 is the timing line, skip it
    for (var i = 0; i < 9; i++) { if (i !== 6) { setFunc(i, 8, false); setFunc(8, i, false); } }
    for (var i = 0; i < 8; i++) { setFunc(size - 1 - i, 8, false); setFunc(8, size - 1 - i, false); }
    setFunc(8, size - 8, true); // dark module
    if (ver >= 7) {
      for (var i = 0; i < 18; i++) {
        var a = size - 11 + i % 3, b = Math.floor(i / 3);
        setFunc(a, b, false); setFunc(b, a, false);
      }
    }

    // place data with zigzag
    var data = allCodewords, idx = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var k = 0; k < 2; k++) {
          var x = right - k;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (!isFunc[y][x] && idx < data.length * 8) {
            modules[y][x] = ((data[idx >>> 3] >>> (7 - (idx & 7))) & 1) !== 0;
            idx++;
          }
        }
      }
    }

    // try all masks, pick best
    var bestMask = 0, minPenalty = Infinity, bestModules = null;
    for (var mask = 0; mask < 8; mask++) {
      var m = modules.map(function (r) { return r.slice(); });
      applyMask(m, isFunc, mask, size);
      drawFormatBits(m, isFunc, ecl, mask, size, ver);
      var p = penalty(m, size);
      if (p < minPenalty) { minPenalty = p; bestMask = mask; bestModules = m; }
    }
    return { size: size, modules: bestModules };
  }

  function alignmentPatternPositions(ver) {
    if (ver === 1) return [];
    var numAlign = Math.floor(ver / 7) + 2;
    var step = (ver === 32) ? 26 :
      Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  function applyMask(m, isFunc, mask, size) {
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
      if (isFunc[y][x]) continue;
      var invert;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = (x * y) % 2 + (x * y) % 3 === 0; break;
        case 6: invert = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
        case 7: invert = ((x + y) % 2 + (x * y) % 3) % 2 === 0; break;
      }
      if (invert) m[y][x] = !m[y][x];
    }
  }

  function drawFormatBits(m, isFunc, ecl, mask, size, ver) {
    var data = ECC_FORMATBITS[ecl] << 3 | mask;   // ecl is an ordinal 0..3
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    for (var i = 0; i <= 5; i++) m[i][8] = getBit(bits, i);
    m[7][8] = getBit(bits, 6); m[8][8] = getBit(bits, 7); m[8][7] = getBit(bits, 8);
    for (var i = 9; i < 15; i++) m[8][14 - i] = getBit(bits, i);
    for (var i = 0; i < 8; i++) m[8][size - 1 - i] = getBit(bits, i);
    for (var i = 8; i < 15; i++) m[size - 15 + i][8] = getBit(bits, i);
    m[size - 8][8] = true;

    if (ver >= 7) {
      var r = ver;
      for (var i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      var vbits = (ver << 12) | r;
      for (var i = 0; i < 18; i++) {
        var bit = getBit(vbits, i);
        var a = size - 11 + i % 3, b = Math.floor(i / 3);
        m[b][a] = bit; m[a][b] = bit;
      }
    }
  }
  function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

  function penalty(m, size) {
    var p = 0;
    for (var y = 0; y < size; y++) {
      var run = 0, last = null;
      for (var x = 0; x < size; x++) {
        if (m[y][x] === last) { run++; if (run === 5) p += 3; else if (run > 5) p++; }
        else { last = m[y][x]; run = 1; }
      }
    }
    for (var x = 0; x < size; x++) {
      var run = 0, last = null;
      for (var y = 0; y < size; y++) {
        if (m[y][x] === last) { run++; if (run === 5) p += 3; else if (run > 5) p++; }
        else { last = m[y][x]; run = 1; }
      }
    }
    for (var y = 0; y < size - 1; y++) for (var x = 0; x < size - 1; x++) {
      var c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
    var dark = 0;
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (m[y][x]) dark++;
    var total = size * size;
    var k = Math.floor(Math.abs(dark * 20 - total * 10) / total);
    p += k * 10;
    return p;
  }

  function svg(text, opt) {
    opt = opt || {};
    var border = opt.border == null ? 4 : opt.border;
    var dark = opt.dark || "#000", light = opt.light || "#fff";
    var qr = encode(text, opt.ecc || "M");
    var dim = qr.size + border * 2;
    var parts = [];
    for (var y = 0; y < qr.size; y++) for (var x = 0; x < qr.size; x++)
      if (qr.modules[y][x]) parts.push("M" + (x + border) + "," + (y + border) + "h1v1h-1z");
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim +
      '" shape-rendering="crispEdges" width="100%" height="100%">' +
      '<rect width="100%" height="100%" fill="' + light + '"/>' +
      '<path d="' + parts.join("") + '" fill="' + dark + '"/></svg>';
  }

  global.QR = { svg: svg, encode: encode };
})(window);
