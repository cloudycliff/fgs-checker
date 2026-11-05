// 算力验证（proof of work）：找到一个 nonce，使 SHA-256("salt:nonce") 的前 difficulty 个二进制位都是 0。
// 浏览器求解要算很多次，后端验证只算一次。前端和 Worker 共用这份代码。

const enc = new TextEncoder();

export async function powHash(salt, nonce) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`${salt}:${nonce}`)));
}

export function leadingZeroBits(bytes) {
  let bits = 0;
  for (const b of bytes) {
    if (b === 0) { bits += 8; continue; }
    return bits + Math.clz32(b) - 24;
  }
  return bits;
}

export async function checkPow(salt, nonce, difficulty) {
  return leadingZeroBits(await powHash(salt, nonce)) >= difficulty;
}

/** 分批并行计算，每批之间让出主线程，页面不会卡住。 */
export async function solvePow(salt, difficulty, batch = 2000) {
  for (let base = 0; ; base += batch) {
    const hashes = await Promise.all(Array.from({ length: batch }, (_, i) => powHash(salt, base + i)));
    const hit = hashes.findIndex((h) => leadingZeroBits(h) >= difficulty);
    if (hit >= 0) return base + hit;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
