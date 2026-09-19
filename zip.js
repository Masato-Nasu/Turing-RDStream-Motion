/* ZIP is only a container for visible PNG files. No plaintext or state sidecars. */
(function (root) {
  "use strict";
  const te = new TextEncoder(),
    td = new TextDecoder("utf-8", { fatal: true }),
    MAX_TOTAL = 512 * 1024 * 1024;
  const table = Uint32Array.from({ length: 256 }, (_, x) => {
    for (let j = 0; j < 8; j++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1;
    return x >>> 0;
  });
  function crc(a) {
    let c = 0xffffffff;
    for (const b of a) c = table[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function create(entries) {
    if (!entries.length || entries.length > 64)
      throw Error("ZIPは1〜64枚の画像に対応します");
    const parts = [],
      central = [];
    let offset = 0,
      total = 0;
    for (const e of entries) {
      const data = e.data,
        name = te.encode(e.name);
      total += data.length;
      if (total > MAX_TOTAL) throw Error("ZIPが大きすぎます");
      if (!/^[a-zA-Z0-9_.-]+\.(png)$/i.test(e.name))
        throw Error("ZIPには画像のみ保存できます");
      const checksum = crc(data),
        head = new Uint8Array(30),
        dv = new DataView(head.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x800, true);
      dv.setUint16(12, 33, true);
      dv.setUint32(14, checksum, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true);
      const cd = new Uint8Array(46),
        cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x800, true);
      cv.setUint16(14, 33, true);
      cv.setUint32(16, checksum, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      parts.push(head, name, data);
      central.push(cd, name);
      offset += head.length + name.length + data.length;
    }
    const centralSize = central.reduce((s, x) => s + x.length, 0),
      end = new Uint8Array(22),
      v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, entries.length, true);
    v.setUint16(10, entries.length, true);
    v.setUint32(12, centralSize, true);
    v.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: "application/zip" });
  }
  async function read(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length < 22 || b.length > MAX_TOTAL + 65536)
      throw Error("ZIPサイズが不正です");
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let end = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--)
      if (
        v.getUint32(i, true) === 0x06054b50 &&
        i + 22 + v.getUint16(i + 20, true) === b.length
      ) {
        end = i;
        break;
      }
    if (end < 0) throw Error("ZIP終端がありません");
    if (v.getUint16(end + 4, true) || v.getUint16(end + 6, true))
      throw Error("分割ZIPは非対応です");
    const n = v.getUint16(end + 10, true),
      size = v.getUint32(end + 12, true),
      start = v.getUint32(end + 16, true);
    if (
      n < 1 ||
      n > 64 ||
      n !== v.getUint16(end + 8, true) ||
      start + size !== end
    )
      throw Error("Motion R4用の画像ZIPではありません");
    const records = [],
      seen = new Set();
    let previousLocalEnd = 0;
    let p = start,
      total = 0;
    for (let j = 0; j < n; j++) {
      if (p + 46 > end || v.getUint32(p, true) !== 0x02014b50)
        throw Error("ZIP目録が壊れています");
      const flags = v.getUint16(p + 8, true),
        method = v.getUint16(p + 10, true),
        checksum = v.getUint32(p + 16, true),
        compressed = v.getUint32(p + 20, true),
        raw = v.getUint32(p + 24, true),
        nl = v.getUint16(p + 28, true),
        extra = v.getUint16(p + 30, true),
        comment = v.getUint16(p + 32, true),
        local = v.getUint32(p + 42, true);
      if (
        (flags !== 0 && flags !== 0x800) ||
        v.getUint16(p + 34, true) !== 0 ||
        ![0, 8].includes(method) ||
        p + 46 + nl + extra + comment > end ||
        raw > 160 * 1024 * 1024
      )
        throw Error("未対応または不正なZIP形式です");
      const name = td.decode(b.subarray(p + 46, p + 46 + nl));
      if (
        !/\.(png)$/i.test(name) ||
        name.includes("..") ||
        seen.has(name)
      )
        throw Error("PNGのみを含むZIPを選んでください");
      seen.add(name);
      if (local < previousLocalEnd || local + 30 > start || v.getUint32(local, true) !== 0x04034b50)
        throw Error("ZIPの画像位置が不正です");
      if (
        v.getUint16(local + 6, true) !== flags ||
        v.getUint16(local + 8, true) !== method ||
        v.getUint32(local + 14, true) !== checksum ||
        v.getUint32(local + 18, true) !== compressed ||
        v.getUint32(local + 22, true) !== raw
      )
        throw Error("ZIPヘッダーが一致しません");
      const ln = v.getUint16(local + 26, true),
        le = v.getUint16(local + 28, true),
        dataStart = local + 30 + ln + le;
      if (
        dataStart + compressed > start ||
        td.decode(b.subarray(local + 30, local + 30 + ln)) !== name
      )
        throw Error("ZIPの画像範囲が不正です");
      previousLocalEnd = dataStart + compressed;
      total += raw;
      if (total > MAX_TOTAL) throw Error("展開後のZIPが大きすぎます");
      records.push({
        name,
        method,
        checksum,
        raw,
        packed: b.subarray(dataStart, dataStart + compressed),
      });
      p += 46 + nl + extra + comment;
    }
    if (p !== end) throw Error("ZIP目録長が不正です");
    const result = [];
    for (const r of records) {
      let data;
      if (r.method === 0) data = r.packed;
      else {
        const reader = new Blob([r.packed])
            .stream()
            .pipeThrough(new DecompressionStream("deflate-raw"))
            .getReader(),
          chunks = [];
        let count = 0;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          count += value.length;
          if (count > r.raw) {
            await reader.cancel();
            throw Error("ZIP展開サイズが不正です");
          }
          chunks.push(value);
        }
        data = new Uint8Array(await new Blob(chunks).arrayBuffer());
      }
      if (data.length !== r.raw || crc(data) !== r.checksum)
        throw Error("ZIP画像のCRCが一致しません");
      result.push({ name: r.name, data });
    }
    return result;
  }
  root.RDStreamZIP = { create, read, crc };
})(typeof window === "undefined" ? globalThis : window);
