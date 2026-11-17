/* Lõi tối ưu xếp phôi 1D cho app.datinox.vn/toi-uu — chuyển từ realcut1d (scripts/realcut1d/cutting_optimizer.py,
   bản JS ~/.claude/skills/realcut1d/assets/realcut1d_standalone.html) và giữ đúng luật của bản đó:
   - Tồn kho lẻ dùng trước (từng cây, chọn mẫu cắt tốt nhất), rồi mới tới cây mới.
   - Một loại cây mới: giải chính xác (exactPack) khi đơn vừa sức; đơn lớn: so quy hoạch tuyến tính với tham lam, lấy ít cây hơn.
   - Cắt ke 45°: "ke" = 2 đầu vát, "ke1" = 1 đầu vát; chiều dài nhập = cạnh dài ngoài; "mat" = bề rộng mặt bị vát.
     Hai đầu vát cùng mặt liền nhau, lật 1 miếng thì 2 đường vát trùng nhau → 1 nhát chung, tiết kiệm (mặt − hở) mỗi mối.
     Số mối của k miếng ke + m miếng ke1 cùng mặt trong 1 cây: m ≥ 1 → k + ⌊m/2⌋, m = 0 → max(k − 1, 0).
   Thêm so với bản cũ (30/10/2026):
   - Đơn lớn có cắt ke (exactPack bỏ cuộc) không còn chọn mẫu "như cắt thẳng" rồi mới trừ phần xen kẽ: mẫu từng cây chọn bằng
     quy hoạch động có trạng thái (còn mối chưa ghép / số miếng ke1 chẵn lẻ) nên tính luôn phần tiết kiệm khi lấp cây — bestTypedDP.
   - Mỗi miếng cắt ra có run/vi trí trong chuỗi để vẽ hình mô phỏng (layoutBar), mỗi đầu biết vát hướng nào.
   Chạy được trong trang (window.RC), trong Worker (postMessage {id, data}) và trong Node (module.exports) để kiểm thử. */
(function (root) {
  'use strict';
  const DP_COMPLEXITY_LIMIT = 4000000, DP_MAX_DISTINCT = 40;
  const EXACT_STATE_SPACE_LIMIT = 400000, EXACT_PATTERN_LIMIT = 20000, EXACT_WORK_LIMIT = 6000000, EXACT_ENUM_LIMIT = 300000;
  const SUBSET_WORK_LIMIT = 40000000;

  // ---------- mẫu cắt cho chi tiết cắt thẳng (demand: chiều dài → số lượng) ----------
  // knapsack có chặn số lượng, cửa sổ trượt theo lớp dư — giống best_pattern_dp bản Python
  function bestPatternDP(demand, binLength, kerf) {
    const cap = Math.floor(binLength + 1e-9);
    const items = Object.keys(demand).map(Number).filter(L => demand[L] > 0 && L + kerf <= binLength)
      .map(L => [L, Math.ceil(L + kerf - 1e-9), demand[L]]).filter(it => it[1] <= cap && it[1] > 0);
    if (!items.length) return {};
    let dp = new Float64Array(cap + 1);
    const usedPer = [];
    for (const [L, w, maxc] of items) {
      const base = dp, nd = Float64Array.from(base), used = new Int32Array(cap + 1);
      for (let r = 0; r < w; r++) {
        const idx = [], t = [];
        for (let c = r, m = 0; c <= cap; c += w, m++) { idx.push(c); t.push(base[c] - m * L); }
        const dq = []; let h = 0;
        for (let m = 0; m < idx.length; m++) {
          while (dq.length > h && t[dq[dq.length - 1]] <= t[m]) dq.pop();
          dq.push(m);
          while (dq[h] < m - maxc) h++;
          const bj = dq[h], val = t[bj] + m * L;
          if (val > nd[idx[m]]) { nd[idx[m]] = val; used[idx[m]] = m - bj; }
        }
      }
      dp = nd; usedPer.push(used);
    }
    const pattern = {}; let c = cap;
    for (let i = items.length - 1; i >= 0; i--) { const u = usedPer[i][c]; if (u > 0) { pattern[items[i][0]] = u; c -= u * items[i][1]; } }
    return pattern;
  }
  function greedyPatternFallback(demand, binLength, kerf) {
    const pattern = {}; let rem = binLength;
    Object.keys(demand).map(Number).filter(L => demand[L] > 0).sort((a, b) => b - a).forEach(L => {
      const w = L + kerf; if (w > rem) return;
      const take = Math.min(demand[L], Math.floor(rem / w));
      if (take > 0) { pattern[L] = take; rem -= take * w; }
    });
    return pattern;
  }
  // quá nhiều chiều dài khác nhau: lấp sát từng cây bằng tổng-tập-con (subset_pattern bản Python, 13/10/2026)
  function subsetPattern(demand, binLength, kerf) {
    const cap = Math.floor(binLength + 1e-9), items = [];
    Object.keys(demand).map(Number).filter(L => demand[L] > 0).sort((a, b) => b - a).forEach(L => {
      const w = Math.ceil(L + kerf - 1e-9);
      if (w <= cap) for (let i = 0; i < Math.min(demand[L], Math.floor(cap / w)); i++) items.push([L, w]);
    });
    if (!items.length) return {};
    if (items.length * cap > SUBSET_WORK_LIMIT) return greedyPatternFallback(demand, binLength, kerf);
    const from = new Int32Array(cap + 1).fill(-2), item = new Int32Array(cap + 1);
    from[0] = -1;
    for (let i = 0; i < items.length; i++) {
      const w = items[i][1];
      for (let s = cap - w; s >= 0; s--) if (from[s] !== -2 && from[s + w] === -2) { from[s + w] = s; item[s + w] = i; }
      if (from[cap] !== -2) break;
    }
    let s = cap; while (from[s] === -2) s--;
    const pattern = {};
    while (s > 0) { const L = items[item[s]][0]; pattern[L] = (pattern[L] || 0) + 1; s = from[s]; }
    return pattern;
  }

  // ---------- cắt ke 45° ----------
  const MAT_RE = /^\s*(\d+(?:[.,]\d+)?)\s*(?:mm)?\s*$/i;
  const parseMat = mat => { const m = mat == null ? null : MAT_RE.exec(String(mat)); return m ? parseFloat(m[1].replace(',', '.')) : 0; };
  function typeKey(length, item, interlock, gap) {
    if (interlock) {
      const style = item.endStyle || 'thang', w = parseMat(item.mat), sv = w - (gap || 0);
      if (style === 'ke' && sv > 0 && length > 2 * w) return length + '|ke|' + sv;
      if (style === 'ke1' && sv > 0 && length > w) return length + '|ke1|' + sv;
    }
    return length + '|thang|0';
  }
  const parseTypeKey = k => { const a = k.split('|'); return { length: Number(a[0]), style: a[1], w: Number(a[2]) }; };
  const jointsFor = (k, m) => m >= 1 ? k + Math.floor(m / 2) : Math.max(k - 1, 0);

  // Xếp ke/ke1 cùng mặt thành chuỗi trong 1 cây: [ke1] ke ke … [ke1]; ke1 thừa ghép đôi. Gắn run/pos để vẽ hình.
  function arrangeBar(cuts, gap) {
    gap = gap || 0;
    cuts.forEach(c => { c.net = c.length; c.run = -1; c.pos = 0; c.runLen = 1; });
    const groups = {}, rest = [];
    cuts.forEach(c => {
      const tk = parseTypeKey(typeKey(c.length, c, true, gap));
      if (tk.style === 'ke' || tk.style === 'ke1') { (groups[tk.w] || (groups[tk.w] = { ke: [], ke1: [] }))[tk.style].push(c); } else rest.push(c);
    });
    const ordered = [], tailSingles = [], chains = []; let saving = 0, runNo = 0;
    const desc = (a, b) => b.length - a.length;
    Object.keys(groups).map(Number).sort((a, b) => b - a).forEach(w => {
      const K = groups[w].ke.slice().sort(desc), M = groups[w].ke1.slice().sort(desc);
      const runs = []; let restM = [];
      if (M.length >= 2) { runs.push([M[0]].concat(K, [M[1]])); restM = M.slice(2); }
      else if (M.length === 1) runs.push(K.concat([M[0]]));
      else if (K.length) runs.push(K);
      for (let i = 0; i + 1 < restM.length; i += 2) runs.push([restM[i], restM[i + 1]]);
      if (restM.length % 2 === 1) runs.push([restM[restM.length - 1]]);
      let gs = 0;
      runs.forEach(run => {
        const id = run.length > 1 ? runNo++ : -1;
        run.forEach((c, idx) => {
          const adj = (idx > 0 ? 1 : 0) + (idx < run.length - 1 ? 1 : 0);
          c.net = c.length - w * adj / 2; c.run = id; c.pos = idx; c.runLen = run.length; c.sv = w;
        });
        gs += w * (run.length - 1);
        if (run.length === 1 && run[0].endStyle === 'ke1') {
          run.forEach(c => tailSingles.push(c));
        } else {
          run.forEach(c => ordered.push(c));
        }
      });
      saving += gs;
      if (gs > 0) {
        const multi = runs.filter(r => r.length > 1);
        chains.push({ mat: String(w + gap), pieces: multi.reduce((a, r) => a + r.length, 0), runs: multi.map(r => r.map(c => c.length)), saving: gs, gapCost: gap * multi.reduce((a, r) => a + r.length - 1, 0) });
      }
    });
    rest.sort(desc).forEach(c => ordered.push(c));
    tailSingles.forEach(c => ordered.push(c));
    return { cuts: ordered, saving, chains };
  }

  // Mẫu cắt 1 cây có tính xen kẽ (30/10/2026; nhiều mặt vát cùng cây — hộp lật mặt 20×40 — từ 30/10 tối).
  // typeCounts: khoá loại → số lượng. Tối đa DP_NHOM_MAT nhóm mặt đông nhất tính chính xác; nhóm mặt thứ 3 trở đi
  // coi như cắt thẳng (an toàn: mức dùng thật chỉ nhỏ hơn). Đơn vị nửa mm, làm tròn về phía an toàn.
  // Mỗi nhóm mặt S một chữ số hệ 6: có miếng ke chưa (0/1) × số ke1 (0 / lẻ / chẵn ≥ 2).
  // Mức dùng = Σ(L+kerf) − Σ_nhóm [k·S + m·S/2 − bù] (bù: m lẻ → S/2; m = 0 và k ≥ 1 → S).
  const DP_NHOM_MAT = 2;
  const KHO_DP = { n: 0, a: null, b: null, pick: [] }; // vùng nhớ dùng lại giữa các cây của một lần giải; solve() trả lại khi xong
  function bestTypedDP(typeCounts, binLength, kerf) {
    const keys = Object.keys(typeCounts).filter(k => typeCounts[k] > 0 && parseTypeKey(k).length + kerf <= binLength + 1e-9);
    if (!keys.length) return {};
    const dem = {};
    keys.forEach(k => { const t = parseTypeKey(k); if (t.style !== 'thang') dem[t.w] = (dem[t.w] || 0) + typeCounts[k]; });
    const nhom = Object.keys(dem).map(Number).sort((a, b) => dem[b] - dem[a] || b - a).slice(0, DP_NHOM_MAT);
    const G = nhom.length, NS = Math.pow(6, G);
    const S1 = nhom.map(S => Math.floor(S + 1e-9)), S2 = nhom.map(S => Math.floor(2 * S + 1e-9));
    const bu1 = nhom.map(S => Math.ceil(S - 1e-9)), bu2 = nhom.map(S => Math.ceil(2 * S - 1e-9));
    const buMax = bu2.reduce((a, b) => a + b, 0), C = Math.floor(2 * binLength + 1e-9);
    const items = []; // [khoá, số miếng, trọng lượng nửa-mm, giá trị, nhóm mặt (-1: thẳng/khác), loại ke: 1 ke1, 2 ke]
    keys.forEach(k => {
      const t = parseTypeKey(k), base = Math.ceil(2 * (t.length + kerf) - 1e-9);
      const g = t.style === 'thang' ? -1 : nhom.indexOf(t.w), e = g < 0 ? 0 : (t.style === 'ke' ? 2 : 1);
      const w1 = base - (e === 2 ? S2[g] : e === 1 ? S1[g] : 0);
      if (w1 <= 0) return;
      let q = Math.min(typeCounts[k], Math.floor((C + buMax) / w1)), p = 1;
      while (q > 0) { const n = Math.min(p, q); items.push([k, n, n * w1, n * t.length, g, e]); q -= n; p *= 2; }
    });
    if (!items.length) return {};
    const P6 = nhom.map((_, g) => Math.pow(6, g));
    const chuSo = (s, g) => Math.floor(s / P6[g]) % 6;
    const buoc = (d, e, n) => {
      let kp = d >= 3 ? 1 : 0, mc = d % 3;
      if (e === 2) kp = 1;
      else if (e === 1 && n % 2 === 1) mc = mc === 1 ? 2 : 1;
      else if (e === 1) mc = mc === 0 ? 2 : mc;
      return kp * 3 + mc;
    };
    // Tăng tốc 11/11/2026 (T1-03) — KẾT QUẢ GIỮ NGUYÊN Y HỆT bản trước (so bằng JSON trên 22 bộ dữ liệu):
    //  1) rút gọn đơn vị: mọi trọng lượng chia cho ước chung lớn nhất (số tròn mm, mặt chẵn → bảng nhỏ đi 2–20 lần);
    //     ô nào không chia hết cho ước chung thì bản cũ cũng không bao giờ tới được.
    //  2) dùng lại vùng nhớ giữa các cây (KHO_DP) thay vì cấp mới + chép cả bảng cho từng món;
    //  3) mỗi trạng thái chỉ quét khoảng [lo, hi] đã có lời giải.
    // Thứ tự duyệt món, trạng thái và luật hoà (>) không đổi.
    let uoc = 0; for (const it of items) { let a = uoc, b = it[2]; while (b) { const t = a % b; a = b; b = t; } uoc = a; }
    if (uoc > 1) for (const it of items) it[2] /= uoc;
    const W = Math.floor(C / uoc) + 1, NEG = -1, n = NS * W;
    if (KHO_DP.n !== n) { KHO_DP.n = n; KHO_DP.a = new Float64Array(n); KHO_DP.b = new Float64Array(n); KHO_DP.pick = []; }
    let dp = KHO_DP.a, nd = KHO_DP.b; dp.fill(NEG); nd.fill(NEG); dp[0] = 0;
    const co = new Uint8Array(NS); co[0] = 1; // trạng thái đã có lời giải nào chưa — bỏ qua cho nhanh
    const co2 = new Uint8Array(NS), dichS = new Int32Array(NS);
    let lo = new Int32Array(NS).fill(W), hi = new Int32Array(NS).fill(-1), lo2 = new Int32Array(NS), hi2 = new Int32Array(NS);
    lo[0] = 0; hi[0] = 0;
    const pick = KHO_DP.pick;
    for (let i = 0; i < items.length; i++) {
      const it = items[i], w = it[2], v = it[3], g = it[4];
      let pk = pick[i], moi = false; if (!pk) { pk = pick[i] = new Uint8Array(n); moi = true; }
      co2.set(co); lo2.set(lo); hi2.set(hi);
      for (let s = 0; s < NS; s++) {
        if (!co[s]) continue;
        const s2 = dichS[s] = g < 0 ? s : s + (buoc(chuSo(s, g), it[5], it[1]) - chuSo(s, g)) * P6[g];
        nd.set(dp.subarray(s * W + lo[s], s * W + hi[s] + 1), s * W + lo[s]); // nd = bản chép của dp (chỉ phần có lời giải)
        if (!moi) { pk.fill(0, s * W, (s + 1) * W); if (s2 !== s) pk.fill(0, s2 * W, (s2 + 1) * W); }
      }
      for (let s = 0; s < NS; s++) {
        if (!co[s]) continue;
        const s2 = dichS[s], goc = s * W, dich = s2 * W + w, c0 = lo[s];
        let cMax = -1, cMin = -1;
        for (let c = Math.min(W - 1 - w, hi[s]); c >= c0; c--) {
          const cur = dp[goc + c]; if (cur < 0) continue;
          const val = cur + v, j = dich + c;
          if (val > nd[j]) { nd[j] = val; pk[j] = s + 1; if (cMax < 0) cMax = c; cMin = c; }
        }
        if (cMax >= 0) { co2[s2] = 1; if (cMax + w > hi2[s2]) hi2[s2] = cMax + w; if (cMin + w < lo2[s2]) lo2[s2] = cMin + w; }
      }
      let t = dp; dp = nd; nd = t; co.set(co2);
      t = lo; lo = lo2; lo2 = t; t = hi; hi = hi2; hi2 = t;
    }
    const bu = s => { let t = 0; for (let g = 0; g < G; g++) { const d = chuSo(s, g); t += (d % 3 === 1 ? bu1[g] : 0) + (d === 3 ? bu2[g] : 0); } return t; };
    let bs = -1, bc = -1, bv = 0;
    for (let s = 0; s < NS; s++) {
      if (!co[s]) continue;
      const b = bu(s);
      for (let c = lo[s]; c <= hi[s]; c++) {
        const v = dp[s * W + c]; if (v <= 0 || c * uoc + b > C) continue;
        if (v > bv + 1e-9 || (Math.abs(v - bv) <= 1e-9 && c < bc)) { bv = v; bs = s; bc = c; }
      }
    }
    if (bs < 0) return {};
    const pattern = {}; let s = bs, c = bc;
    for (let i = items.length - 1; i >= 0; i--) {
      const p = pick[i][s * W + c];
      if (p) { const it = items[i]; pattern[it[0]] = (pattern[it[0]] || 0) + it[1]; c -= it[2]; s = p - 1; }
    }
    return pattern;
  }

  // ---------- exactPack: số cây ít nhất tuyệt đối cho 1 loại cây mới (đơn vừa sức) ----------
  function exactPack(typeCounts, binLength, kerf, interlock) {
    const keys = Object.keys(typeCounts).filter(k => typeCounts[k] > 0 && parseTypeKey(k).length + kerf <= binLength).sort((a, b) => {
      const x = parseTypeKey(a), y = parseTypeKey(b);
      if (x.length !== y.length) return y.length - x.length;
      if (x.style !== y.style) return x.style < y.style ? -1 : 1;
      return y.w - x.w;
    });
    if (!keys.length) return [];
    const T = keys.map(parseTypeKey), n = T.length, qty = keys.map(k => typeCounts[k]);
    const base = T.map(t => t.length + kerf), ends = T.map(t => t.style === 'ke' ? 2 : t.style === 'ke1' ? 1 : 0);
    const opt2 = T.map((t, i) => 2 * base[i] - ends[i] * t.w);
    if (opt2.some(o => o <= 0)) return null;
    let stateSpace = 1;
    for (let i = 0; i < n; i++) { stateSpace *= qty[i] + 1; if (stateSpace > EXACT_STATE_SPACE_LIMIT) return null; }
    const eps = 1e-9, maxCounts = qty.map((q, i) => Math.min(q, Math.floor(2 * binLength / opt2[i])));
    function usage(counts) {
      let total = 0;
      for (let a = 0; a < n; a++) total += counts[a] * base[a];
      if (interlock) {
        const perW = {};
        for (let b = 0; b < n; b++) if (counts[b] && ends[b]) { const g = perW[T[b].w] || (perW[T[b].w] = [0, 0]); g[ends[b] === 2 ? 0 : 1] += counts[b]; }
        Object.keys(perW).forEach(w => { total -= Number(w) * jointsFor(perW[w][0], perW[w][1]); });
      }
      return total;
    }
    const patterns = [], counts = new Array(n).fill(0); let visited = 0;
    function rec(i, remaining2) {
      if (i === n) {
        if (++visited > EXACT_ENUM_LIMIT) throw 'overflow';
        if (!counts.some(c => c > 0) || usage(counts) > binLength + eps) return;
        for (let j = 0; j < n; j++) if (counts[j] < maxCounts[j]) { counts[j]++; const fits = usage(counts) <= binLength + eps; counts[j]--; if (fits) return; }
        patterns.push(counts.slice());
        return;
      }
      const maxC = Math.min(maxCounts[i], Math.floor(remaining2 / opt2[i]));
      for (let c = maxC; c >= 0; c--) { counts[i] = c; rec(i + 1, remaining2 - c * opt2[i]); }
      counts[i] = 0;
    }
    try { rec(0, 2 * binLength); } catch (err) { if (err === 'overflow') return null; throw err; }
    if (!patterns.length || patterns.length > EXACT_PATTERN_LIMIT || stateSpace * patterns.length > EXACT_WORK_LIMIT) return null;
    const val = p => p.reduce((a, c, k) => a + c * T[k].length, 0);
    patterns.sort((a, b) => val(b) - val(a));
    const zeroKey = qty.map(() => 0).join(','), memo = { [zeroKey]: 0 }, choice = {};
    const lowerBound = st => Math.ceil(st.reduce((a, s, k) => a + s * opt2[k], 0) / (2 * binLength) - 1e-9);
    function dp(state) {
      const key = state.join(',');
      if (Object.prototype.hasOwnProperty.call(memo, key)) return memo[key];
      const target = lowerBound(state); let best = null, bestPat = null;
      for (const pat of patterns) {
        const sub = state.map((s, k) => Math.max(s - pat[k], 0));
        if (sub.join(',') === key) continue;
        const r = dp(sub);
        if (r !== null && (best === null || 1 + r < best)) { best = 1 + r; bestPat = state.map((s, k) => s - sub[k]); if (best === target) break; }
      }
      memo[key] = best; if (bestPat) choice[key] = bestPat;
      return best;
    }
    if (dp(qty) === null) return null;
    const used = []; let state = qty;
    while (state.join(',') !== zeroKey) {
      const pat = choice[state.join(',')], pd = {};
      for (let i = 0; i < n; i++) if (pat[i] > 0) pd[keys[i]] = pat[i];
      used.push(pd); state = state.map((s, k) => s - pat[k]);
    }
    const grouped = [], gi = {};
    used.forEach(pd => {
      const key = Object.keys(pd).sort().map(k => k + ':' + pd[k]).join(',');
      if (key in gi) grouped[gi[key]].count++; else { gi[key] = grouped.length; grouped.push({ pattern: pd, count: 1 }); }
    });
    return grouped;
  }

  // ---------- lpPlan: đơn lớn không xen kẽ — quy hoạch tuyến tính sinh cột, so với tham lam lấy ít cây hơn ----------
  function groupPlan(list) { const g = [], ix = {}; list.forEach(pd => { const k = Object.keys(pd).sort((a, b) => a - b).map(L => L + ':' + pd[L]).join(','); if (k in ix) g[ix[k]].count++; else { ix[k] = g.length; g.push({ pattern: pd, count: 1 }); } }); return g; }
  const planBars = plan => plan ? plan.reduce((a, u) => a + u.count, 0) : Infinity;
  function greedyPlan(demand0, W, kerf, useDp) {
    const dm = {}; Object.keys(demand0).forEach(L => { if (demand0[L] > 0) dm[L] = demand0[L]; });
    const list = [];
    for (let g = 0; g < 100000; g++) {
      const pat = useDp ? bestPatternDP(dm, W, kerf) : subsetPattern(dm, W, kerf), ks = Object.keys(pat);
      if (!ks.length) break;
      ks.forEach(L => { dm[L] -= pat[L]; }); list.push(pat);
    }
    return groupPlan(list);
  }
  function lpDual(pats, d, m) {
    const P = pats.length, nc = m + P, T = [];
    for (let r = 0; r < P; r++) { const row = new Array(nc + 1).fill(0); for (let j = 0; j < m; j++) row[j] = pats[r][j]; row[m + r] = 1; row[nc] = 1; T.push(row); }
    const z = new Array(nc + 1).fill(0); for (let j = 0; j < m; j++) z[j] = -d[j];
    const basis = []; for (let r = 0; r < P; r++) basis.push(m + r);
    for (let it = 0; it < 20000; it++) {
      let e = -1; for (let j = 0; j < nc; j++) if (z[j] < -1e-9) { e = j; break; }
      if (e < 0) break;
      let lr = -1, best = Infinity;
      for (let r = 0; r < P; r++) if (T[r][e] > 1e-12) { const q = T[r][nc] / T[r][e]; if (q < best - 1e-12 || (Math.abs(q - best) <= 1e-12 && lr >= 0 && basis[r] < basis[lr])) { best = q; lr = r; } }
      if (lr < 0) return null;
      const pv = T[lr][e]; for (let j = 0; j <= nc; j++) T[lr][j] /= pv;
      for (let r = 0; r < P; r++) if (r !== lr && Math.abs(T[r][e]) > 1e-15) { const f = T[r][e]; for (let j = 0; j <= nc; j++) T[r][j] -= f * T[lr][j]; }
      const f2 = z[e]; for (let j = 0; j <= nc; j++) z[j] -= f2 * T[lr][j];
      basis[lr] = e;
    }
    const y = new Array(m).fill(0); for (let r = 0; r < P; r++) if (basis[r] < m) y[basis[r]] = T[r][nc];
    const x = []; for (let r = 0; r < P; r++) x.push(Math.max(0, z[m + r]));
    return { y, x };
  }
  function lpPlan(demand0, W, kerf, useDp) {
    const Ls = Object.keys(demand0).map(Number).filter(L => demand0[L] > 0 && L + kerf <= W).sort((a, b) => b - a), m = Ls.length;
    if (!m || m > 40) return null;
    const w = Ls.map(L => L + kerf), d = Ls.map(L => demand0[L]), pats = [];
    for (let i = 0; i < m; i++) { const a0 = new Array(m).fill(0); a0[i] = Math.max(1, Math.min(d[i], Math.floor(W / w[i]))); pats.push(a0); }
    function knap(y) {
      const ord = Ls.map((_, i) => i).sort((p, q) => y[q] / w[q] - y[p] / w[p]);
      let best = 0, bestA = null, visits = 0; const a = new Array(m).fill(0);
      (function rec(k, cap, val) {
        if (++visits > 300000) return;
        if (val > best + 1e-12) { best = val; bestA = a.slice(); }
        if (k === m) return;
        let ub = val, c = cap;
        for (let t = k; t < m && c > 0; t++) { const ii = ord[t], tk = Math.min(d[ii], c / w[ii]); ub += tk * y[ii]; c -= tk * w[ii]; }
        if (ub <= best + 1e-9) return;
        const i2 = ord[k], mx = Math.min(d[i2], Math.floor(cap / w[i2] + 1e-9));
        for (let c2 = mx; c2 >= 0; c2--) { a[i2] = c2; rec(k + 1, cap - c2 * w[i2], val + c2 * y[i2]); }
        a[i2] = 0;
      })(0, W, 0);
      return { val: best, a: bestA };
    }
    let sol = null;
    for (let itr = 0; itr < 200; itr++) {
      sol = lpDual(pats, d, m); if (!sol) return null;
      const kp = knap(sol.y);
      if (!kp.a || kp.val <= 1 + 1e-7) break;
      const key = kp.a.join(','); if (pats.some(p => p.join(',') === key)) break;
      pats.push(kp.a);
    }
    if (!sol) return null;
    const rem = d.slice(), list = [];
    pats.forEach((p, pi) => {
      const n = Math.floor(sol.x[pi] + 1e-7);
      for (let c = 0; c < n; c++) { const pd = {}; let any = false; for (let j = 0; j < m; j++) { const t = Math.min(p[j], rem[j]); if (t > 0) { pd[Ls[j]] = t; rem[j] -= t; any = true; } } if (!any) break; list.push(pd); }
    });
    const resid = {}; for (let j = 0; j < m; j++) if (rem[j] > 0) resid[Ls[j]] = rem[j];
    if (Object.keys(resid).length) greedyPlan(resid, W, kerf, useDp).forEach(u => { for (let c = 0; c < u.count; c++) list.push(u.pattern); });
    return groupPlan(list);
  }

  // ---------- giải 1 quy cách ----------
  function solveProfile(profilePieces, rows, kerf, interlock, gap) {
    gap = gap || 0;
    const demand = {}, queues = {};
    profilePieces.forEach(p => { demand[p.length] = (demand[p.length] || 0) + 1; (queues[p.length] || (queues[p.length] = [])).push({ label: p.label, endStyle: p.endStyle, mat: p.mat }); });
    const distinct = Object.keys(demand).map(Number).filter(L => demand[L] > 0);
    const maxBin = Math.max(0, ...rows.map(r => r.usableLength));
    const useDp = distinct.length > 0 && distinct.length <= DP_MAX_DISTINCT && distinct.length * maxBin <= DP_COMPLEXITY_LIMIT;
    const remainingTypeCounts = () => { const c = {}; Object.keys(queues).forEach(Ls => queues[Ls].forEach(it => { const k = typeKey(Number(Ls), it, interlock, gap); c[k] = (c[k] || 0) + 1; })); return c; };
    const coKe = () => interlock && Object.keys(remainingTypeCounts()).some(k => parseTypeKey(k).style !== 'thang');
    // mẫu 1 cây: có ke thì dùng DP biết xen kẽ (trả khoá loại), không thì DP cắt thẳng (trả chiều dài)
    const computePattern = bin => {
      if (coKe()) { const p = bestTypedDP(remainingTypeCounts(), bin, kerf); return { typed: true, p }; }
      return { typed: false, p: useDp ? bestPatternDP(demand, bin, kerf) : subsetPattern(demand, bin, kerf) };
    };
    const patVal = r => Object.keys(r.p).reduce((a, k) => a + (r.typed ? parseTypeKey(k).length : Number(k)) * r.p[k], 0);
    const totalRemaining = () => Object.keys(demand).reduce((a, L) => a + Math.max(0, demand[L]), 0);
    const bars = [], usedCounts = {};
    function makeBar(ridx, cuts) {
      const sd = rows[ridx];
      const cutTotal = cuts.reduce((a, c) => a + c.length, 0), kerfTotal = kerf * cuts.length;
      let saving = 0, chains = [], gapCost = 0;
      if (interlock) { const a = arrangeBar(cuts, gap); cuts = a.cuts; saving = Math.round(a.saving * 100) / 100; chains = a.chains; chains.forEach(ch => { gapCost += ch.gapCost; }); }
      else cuts.forEach(c => { c.net = c.length; c.run = -1; c.pos = 0; c.runLen = 1; });
      bars.push({ stockRow: ridx, stockLabel: sd.label, stockLength: sd.length, usableLength: sd.usableLength, clampTail: sd.clampTail, isNewPurchase: sd.qty === null,
        cuts, cutTotal, kerfTotal, interlockSaving: saving, interlockGapCost: gapCost, chains, waste: Math.round((sd.usableLength - cutTotal - kerfTotal + saving) * 100) / 100 });
      usedCounts[ridx] = (usedCounts[ridx] || 0) + 1;
    }
    function applyPattern(pattern, ridx) {
      const cuts = [];
      Object.keys(pattern).forEach(Ls => { const L = Number(Ls), c = pattern[Ls]; for (let i = 0; i < c; i++) { const it = queues[L].shift(); cuts.push({ length: L, label: it.label, endStyle: it.endStyle, mat: it.mat }); } demand[L] -= c; });
      makeBar(ridx, cuts);
    }
    function applyTyped(pattern, ridx) {
      const cuts = [];
      Object.keys(pattern).forEach(tk => {
        const t = parseTypeKey(tk), c = pattern[tk], dq = queues[t.length];
        for (let i = 0; i < c; i++) { const j = dq.findIndex(it => typeKey(t.length, it, interlock, gap) === tk); const it = dq.splice(j, 1)[0]; cuts.push({ length: t.length, label: it.label, endStyle: it.endStyle, mat: it.mat }); }
        demand[t.length] -= c;
      });
      makeBar(ridx, cuts);
    }
    const apply = (r, ridx) => r.typed ? applyTyped(r.p, ridx) : applyPattern(r.p, ridx);
    const limited = [], unlimited = [];
    rows.forEach((sd, ridx) => { if (sd.qty === null) unlimited.push(ridx); else for (let i = 0; i < sd.qty; i++) limited.push(ridx); });
    const cmpRow = (a, b) => rows[a].priority !== rows[b].priority ? rows[a].priority - rows[b].priority : rows[a].usableLength - rows[b].usableLength;
    limited.sort(cmpRow); unlimited.sort(cmpRow);
    // 1) tồn kho lẻ: từng cây một
    for (const ridx of limited) {
      if (!totalRemaining()) break;
      const r = computePattern(rows[ridx].usableLength);
      if (Object.keys(r.p).length) apply(r, ridx);
    }
    // 2) một loại cây mới ở tầng ưu tiên cao nhất: giải chính xác, đơn lớn thì LP (không xen kẽ) hoặc tham lam biết xen kẽ
    if (totalRemaining() > 0 && unlimited.length) {
      const minP = Math.min(...unlimited.map(r => rows[r].priority)), tier = unlimited.filter(r => rows[r].priority === minP);
      if (tier.length === 1) {
        const ridx = tier[0], W = rows[ridx].usableLength;
        const usage = exactPack(remainingTypeCounts(), W, kerf, interlock);
        if (usage !== null) usage.forEach(u => { for (let i = 0; i < u.count; i++) applyTyped(u.pattern, ridx); });
        else if (!coKe()) {
          const rem = {}; Object.keys(demand).forEach(L => { if (demand[L] > 0) rem[L] = demand[L]; });
          let pG = null, pL = null;
          try { pG = greedyPlan(rem, W, kerf, useDp); } catch (e) { }
          try { pL = lpPlan(rem, W, kerf, useDp); } catch (e) { }
          const plan = planBars(pL) < planBars(pG) ? pL : pG;
          if (plan) plan.forEach(u => { for (let i = 0; i < u.count; i++) applyPattern(u.pattern, ridx); });
        }
      }
    }
    // 2b) tham lam: mỗi lần chọn cây + mẫu lấp đầy nhất; mẫu tốt thì lặp lại luôn khi còn đủ chi tiết
    let guard = 0;
    while (totalRemaining() > 0 && unlimited.length && guard++ < 100000) {
      const minP = Math.min(...unlimited.map(r => rows[r].priority)), tier = unlimited.filter(r => rows[r].priority === minP);
      let best = null;
      tier.forEach(ridx => { const r = computePattern(rows[ridx].usableLength); if (!Object.keys(r.p).length) return; const v = patVal(r); if (!best || v > best.v) best = { v, ridx, r }; });
      if (!best) {
        const others = unlimited.filter(r => !tier.includes(r)).sort((a, b) => rows[a].priority - rows[b].priority);
        let found = false;
        for (const ridx of others) { const r = computePattern(rows[ridx].usableLength); if (Object.keys(r.p).length) { apply(r, ridx); found = true; break; } }
        if (!found) break;
        continue;
      }
      apply(best.r, best.ridx);
    }
    const unfulfilled = [];
    Object.keys(demand).forEach(Ls => {
      const L = Number(Ls); if (demand[L] <= 0) return;
      const cnt = {}; queues[L].forEach(it => { cnt[it.label] = (cnt[it.label] || 0) + 1; });
      Object.keys(cnt).forEach(lbl => unfulfilled.push({ length: L, label: lbl, qtyMissing: cnt[lbl] }));
    });
    return { bars, unfulfilled, usedCounts };
  }

  // ---------- giải cả đơn ----------
  function solve(data, isBaseline) {
    const t0 = Date.now();
    const interlock = !!data.interlock, gap = interlock ? (data.gap || 0) : 0;
    const baseInput = interlock && !isBaseline ? JSON.parse(JSON.stringify(data)) : null;
    const rawStock = (data.stock || []).map((sd, i) => {
      const clampTail = sd.clampTail || 0;
      return { label: sd.label, length: sd.length, clampTail, usableLength: sd.length - clampTail, qty: (sd.qty === undefined || sd.qty === null || sd.qty === '') ? null : sd.qty, priority: sd.priority === undefined ? i : sd.priority, profile: sd.profile || 'Chung' };
    });
    const kerf = data.kerf || 0, pieces = [];
    (data.parts || []).forEach(p => { for (let i = 0; i < (p.qty || 1); i++) pieces.push({ length: p.length, label: p.label || '', profile: p.profile || 'Chung', endStyle: p.end_style || 'thang', mat: p.mat || '' }); });
    const profiles = [...new Set(pieces.map(p => p.profile).concat(rawStock.map(s => s.profile)))].sort();
    const allBars = [], allUnf = [], byStockType = [];
    profiles.forEach(profile => {
      const pp = pieces.filter(p => p.profile === profile), ps = rawStock.filter(s => s.profile === profile);
      if (!pp.length) return;
      if (!ps.length) { pp.forEach(p => allUnf.push({ length: p.length, label: p.label, profile, qtyMissing: 1 })); return; }
      const res = solveProfile(pp, ps, kerf, interlock, gap);
      res.bars.forEach(b => { b.profile = profile; allBars.push(b); });
      res.unfulfilled.forEach(u => { u.profile = profile; allUnf.push(u); });
      ps.forEach((sd, i) => byStockType.push({ profile, label: sd.label, length: sd.length, usableLength: sd.usableLength, clampTail: sd.clampTail, availableQty: sd.qty, usedQty: res.usedCounts[i] || 0 }));
    });
    allBars.forEach((b, i) => { b.barNo = i + 1; });
    let totalWaste = 0, totalPiecesCut = 0, totalNewBars = 0, totalExistingUsed = 0;
    allBars.forEach(b => { totalWaste = Math.round((totalWaste + b.waste) * 100) / 100; totalPiecesCut += b.cuts.length; if (b.isNewPurchase) totalNewBars++; else totalExistingUsed++; });
    const patterns = [], pIdx = {};
    allBars.forEach(b => {
      const lc = {}; b.cuts.forEach(c => { const k2 = c.length + '/' + (c.endStyle || 'thang') + '/' + (c.mat || ''); lc[k2] = (lc[k2] || 0) + 1; });
      const key = [b.profile, b.stockLabel, b.stockLength, b.isNewPurchase, Object.keys(lc).sort().map(k => k + ':' + lc[k]).join(',')].join('|');
      if (key in pIdx) { const p = patterns[pIdx[key]]; p.count++; p.barNos.push(b.barNo); return; }
      pIdx[key] = patterns.length;
      const cuts = b.interlockSaving > 0 ? b.cuts.slice() : b.cuts.slice().sort((x, y) => y.length - x.length);
      patterns.push({ profile: b.profile, stockLabel: b.stockLabel, stockLength: b.stockLength, usableLength: b.usableLength, clampTail: b.clampTail, isNewPurchase: b.isNewPurchase,
        cuts, chains: b.chains, interlockSaving: b.interlockSaving, interlockGapCost: b.interlockGapCost, cutTotal: b.cutTotal, kerfTotal: b.kerfTotal, waste: b.waste, count: 1, barNos: [b.barNo] });
    });
    const usageStatsOf = list => {
      const s = { totalNominalLength: 0, totalCutLength: 0, totalInterlockSaving: 0, totalInterlockGapCost: 0, totalKerfLength: 0, totalClampTailLength: 0, totalWasteLength: 0 };
      list.forEach(b => { s.totalNominalLength += b.stockLength; s.totalCutLength += b.cutTotal - b.interlockSaving; s.totalInterlockSaving += b.interlockSaving; s.totalInterlockGapCost += b.interlockGapCost; s.totalKerfLength += b.kerfTotal; s.totalClampTailLength += b.clampTail; s.totalWasteLength = Math.round((s.totalWasteLength + b.waste) * 100) / 100; });
      return s;
    };
    const summaryByProfile = [];
    profiles.forEach(profile => {
      const pb = allBars.filter(b => b.profile === profile), pu = allUnf.filter(u => u.profile === profile);
      if (!pb.length && !pu.length) return;
      const lt = {}; pb.forEach(b => b.cuts.forEach(c => { lt[c.length] = (lt[c.length] || 0) + 1; }));
      const byLength = Object.keys(lt).map(Number).sort((a, b) => b - a).map(L => ({ length: L, qty: lt[L] }));
      summaryByProfile.push({ profile, totalBars: pb.length, newBars: pb.filter(b => b.isNewPurchase).length, byLength, totalPieces: byLength.reduce((a, x) => a + x.qty, 0), unfulfilled: pu, usageStats: usageStatsOf(pb) });
    });
    let interlockWarnings = [];
    if (interlock) {
      const miss = {};
      pieces.forEach(p => { if ((p.endStyle === 'ke' || p.endStyle === 'ke1') && parseTypeKey(typeKey(p.length, p, true, gap)).style === 'thang') { const k = p.length + '|' + p.endStyle + '|' + p.mat; miss[k] = (miss[k] || 0) + 1; } });
      interlockWarnings = Object.keys(miss).map(k => { const a = k.split('|'); return { length: Number(a[0]), endStyle: a[1], mat: a[2], qty: miss[k], reason: gap > 0 && parseMat(a[2]) > 0 ? 'gap' : 'mat' }; });
    }
    const stats = usageStatsOf(allBars);
    let compare = null;
    if (baseInput && stats.totalInterlockSaving > 0) { baseInput.interlock = false; const base = solve(baseInput, true); compare = { bars: base.bars.length, newBars: base.totalNewBars, waste: base.totalWaste }; }
    if (!isBaseline) { KHO_DP.n = 0; KHO_DP.a = KHO_DP.b = null; KHO_DP.pick = []; } // trả vùng nhớ tạm của bestTypedDP
    return { kerf, gap, interlock, interlockWarnings, compare, byStockType, totalNewBars, totalExistingUsed, totalWaste, totalPiecesCut, unfulfilled: allUnf, bars: allBars, patterns, summaryByProfile, usageStats: stats, ms: Date.now() - t0 };
  }

  // ---------- hình học 1 cây để vẽ: mỗi miếng 4 điểm (đáy trái/phải, mặt trên trái/phải), toạ độ mm dọc cây ----------
  // Đầu miếng: 'S' cắt thẳng; 'B' = cạnh dưới dài hơn ở đầu đó (đường vát nghiêng vào trong khi đi lên); 'T' ngược lại.
  // Miếng ke (hình thang) hai đầu cùng chữ; trong chuỗi, miếng sau lật ngược để đường vát trùng đường vát miếng trước.
  function layoutBar(pattern, kerf, gap, matMacDinh) {
    const out = []; let x = 0, prev = null;
    const flip = e => e === 'B' ? 'T' : 'B';
    pattern.cuts.forEach(c => {
      const w = parseMat(c.mat) || 0, chained = c.run >= 0 && c.pos > 0 && prev && prev.run === c.run;
      let eL, eR;
      if (c.endStyle === 'ke' && w > 0) {
        eL = chained ? flip(prev.eR) : 'B'; eR = eL;
      } else if (c.endStyle === 'ke1' && w > 0) {
        if (chained) { eL = flip(prev.eR); eR = 'S'; } else { eL = 'S'; eR = 'B'; }
      } else { eL = 'S'; eR = 'S'; }
      if (chained) x = Math.min(prev.xb1, prev.xt1) + gap + kerf;
      else if (prev) x = Math.max(prev.xb1, prev.xt1) + kerf;
      const nB = (eL === 'T' ? 1 : 0) + (eR === 'T' ? 1 : 0), nT = (eL === 'B' ? 1 : 0) + (eR === 'B' ? 1 : 0);
      const xb0 = x + (eL === 'T' ? w : 0), xt0 = x + (eL === 'B' ? w : 0);
      const g = { c, w: w || matMacDinh || 40, eL, eR, run: c.run, xb0, xt0, xb1: xb0 + c.length - nB * w, xt1: xt0 + c.length - nT * w };
      out.push(g); prev = g;
    });
    const end = prev ? Math.max(prev.xb1, prev.xt1) : 0;
    return { pieces: out, end, usable: pattern.usableLength, stock: pattern.stockLength, clamp: pattern.clampTail };
  }

  // ---------- đọc ô "Dán nhanh danh sách" (viết lại 12/11/2026 sau vòng test 2: T2-01..03; sửa tiếp vòng 3: T3-01..05) ----------
  // Luật gốc: KHÔNG ĐOÁN — hiểu sai im lặng là thợ cắt sai vật tư. Mỗi dòng dán (không rỗng) rơi vào đúng một nhóm:
  //   chac  đọc chắc: có dấu nhân rõ (x X × *), hoặc có chữ chỉ số lượng (sl, cái, thanh, cây, đoạn), hoặc đúng 2 ô số
  //         cách nhau bằng TAB (Excel: dài<TAB>số lượng), hoặc cả dòng chỉ có 1 con số (= 1 thanh)
  //   hoi   mơ hồ: 2 số không có dấu nhân ("1200 800", "1200,5", "1200;5", "1200 - 5"), số lẻ không rõ mm hay mét ("1.5 x 3"),
  //         "1200,50 x 2", số lượng lớn hơn hoặc bằng chiều dài hay trên 500 ("5x1200", "100 x 3000", "600 x 600": T3-02),
  //         dòng có cả cỡ ống lẫn chiều dài ("1200x5 40x40", "hộp 40x40 1200x5": T3-01), số thứ tự đứng lẻ ("1. 1200 x 5": T3-03),
  //         chữ + số không có dấu nhân ("Chân 1450 4": T3-04)… → kèm các cách hiểu (cach) để thợ bấm chọn, không tự thêm
  //   loi   không đọc được: dòng cộng tổng, đơn vị khác mm, 3 số trở lên không dấu nhân, chữ số kiểu lạ…
  //   bo    dòng chỉ có chữ (tiêu đề Excel) → bỏ qua, có ghi lại từng dòng (không dòng nào được biến mất im lặng: T3-05)
  // Số kiểu Việt: dấu chấm ngăn nghìn (1.200 = 1200), dấu phẩy là số lẻ (60,5). Không nhận "ke" ở đây (đầu cắt chọn ở bảng).
  // Chữ số toàn góc (１２００ｘ５) được đổi về chữ thường trước khi đọc. Danh sách đánh số ("1. 1200 x 5", "2) 800x3"…) chỉ đọc chắc
  // khi có ít nhất 2 dòng đánh số liền nhau tăng dần; Excel 3 cột số không tiêu đề chỉ đọc chắc khi cột đầu là 1, 2, 3… (stt).
  // Trả { chac: [{ dong, chu, ds, stt }], hoi: [{ dong, chu, tho, kieu, cach: [{ ma, ds }], stt, ghi }], loi: [{ dong, chu, tho, goi }],
  //        bo: [{ dong, chu }], boQua, ds } — ds = gộp các món đọc chắc; mỗi món { L, sl, ten, canh: ['dai' | 'ngan' | 'nhieu'] }
  // (canh = bất thường vẫn cho thêm: dài hơn cây lớn nhất tuy.cayMax, ngắn dưới 10 mm, số lượng trên 500).
  // stt = 'so' đã bỏ số thứ tự đầu dòng · 'cot' đã bỏ cột số thứ tự. ghi = 'co' dòng có vẻ kèm cỡ ống.
  // Mã cách hiểu: sl = dài × số lượng · hai = 2 thanh riêng · le = số lẻ sau dấu phẩy · nghin = dấu ngăn nghìn ·
  //   mm / met = số lẻ tính bằng mm hay mét · dao = đảo lại (số lớn là chiều dài) · giu = giữ như đã ghi · roi / roi1 = tách thành nhiều món ·
  //   boco = bỏ phần cỡ ống · stt = bỏ số thứ tự đầu dòng · mot = 1 thanh
  const DAN_SO = '(\\d+(?:\\.\\d+)*(?:,\\d+)?)';
  const DAN_DV = '(?:cái|cai|thanh|cây|cay|đoạn|doan|pcs|pc|c)';
  const DAN_NHAN = '[xX×\\u2715\\u2716хХ*]';
  const DAN_DUOI = '(?![\\p{L}\\d])(?:\\s+(\\D+))?$';
  const DAN_X = new RegExp('^' + DAN_SO + '\\s*(?:mm)?\\s*' + DAN_NHAN + '\\s*(?:sl\\s*:?\\s*)?(\\d+)\\s*' + DAN_DV + '?' + DAN_DUOI, 'iu');
  // "5 x 1200mm": chữ mm gắn vào số nào thì số đó là chiều dài (T3-04)
  const DAN_XM = new RegExp('^(\\d+)\\s*' + DAN_DV + '?\\s*' + DAN_NHAN + '\\s*' + DAN_SO + '\\s*mm' + DAN_DUOI, 'iu');
  const DAN_SL = new RegExp('^' + DAN_SO + '\\s*(?:mm)?\\s+sl\\s*:?\\s*(\\d+)\\s*' + DAN_DV + '?' + DAN_DUOI, 'iu');
  const DAN_DVQ = new RegExp('^' + DAN_SO + '\\s*(?:mm)?\\s+(\\d+)\\s*' + DAN_DV + DAN_DUOI, 'iu');
  const DAN_C = new RegExp('^(\\d+)\\s*' + DAN_DV + '\\s+(?:dài\\s*|dai\\s*)?' + DAN_SO + '\\s*(?:mm)?(?:\\s+(\\D+))?$', 'iu');
  const DAN_T = new RegExp('^' + DAN_SO + '\\s*(?:mm)?(?:\\s+|\\s*-\\s*)(\\d+)$', 'iu');
  const DAN_B = new RegExp('^' + DAN_SO + '\\s*(?:mm)?(?:\\s+(\\D+))?$', 'iu');
  const DAN_GON = new RegExp('^' + DAN_SO + '(?:mm)?' + DAN_NHAN + '\\d+' + DAN_DV + '?$', 'iu');
  const DAN_SAU_NHAN = new RegExp('^\\s*(?:mm)?\\s*' + DAN_NHAN, 'i');
  const DAN_TRUOC_NHAN = new RegExp('(?:' + DAN_NHAN + '|sl\\s*:?)$', 'i');
  const DAN_CO_MM = new RegExp('^' + DAN_SO + '\\s*mm', 'i');
  const DAN_O_SO = /^(\d+(?:\.\d+)*(?:,\d+)*)\s*(?:mm)?$/i;
  const DAN_O_SL = new RegExp('^(\\d+(?:\\.\\d{3})*)\\s*' + DAN_DV + '?$', 'i');
  // nhãn ghi rõ vai: "Dài: 1200, SL: 5" · "dai 1200 sl 5" · "SL 5 dài 1200" · "L=1200 x5" (T3-04)
  const DAN_NH_DAI = '(?:chiều\\s*dài|chieu\\s*dai|dài|dai|l)', DAN_NH_SL = '(?:sl|s\\.l|số\\s*lượng|so\\s*luong)';
  // chữ L trơ trọi phải có dấu : hoặc = ("L=1200"), vì "L50x5" là thép góc chứ không phải chiều dài
  const DAN_DAU_DAI = new RegExp('^(?:(?:chiều\\s*dài|chieu\\s*dai|dài|dai)\\s*[:=]?|l\\s*[:=])\\s*(?=\\d)', 'iu');
  const DAN_NHAN_A = new RegExp('^' + DAN_NH_DAI + '\\s*[:=]?\\s*' + DAN_SO + '\\s*(?:mm)?\\s*[,;]?\\s*' + DAN_NH_SL + '\\s*[:=]?\\s*(\\d+)\\s*' + DAN_DV + '?$', 'iu');
  const DAN_NHAN_B = new RegExp('^' + DAN_NH_SL + '\\s*[:=]?\\s*(\\d+)\\s*' + DAN_DV + '?\\s*[,;]?\\s*' + DAN_NH_DAI + '\\s*[:=]?\\s*' + DAN_SO + '\\s*(?:mm)?$', 'iu');
  const DAN_NGOAC_SL = new RegExp('\\(\\s*(\\d+\\s*' + DAN_DV + ')\\s*\\)\\s*$', 'iu');
  // cỡ ống ghi chung dòng với chiều dài (T3-01): "40x40", "40x80x1.2", "hộp 40x40", "Ø60", "phi 60x1.2"
  const DAN_COSO = '\\d+(?:[.,]\\d+)?', DAN_CO_MAX = 220, DAN_CO_MAX_TU = 400;
  const DAN_COTU = '(?:hộp|hop|ống|ong|vuông|vuong|inox|sus|phi|fi|ø|la|v|u|d)';
  const DAN_CO = '(?:(' + DAN_COTU + ')\\s*)?(' + DAN_COSO + '(?:\\s*' + DAN_NHAN + '\\s*' + DAN_COSO + '){0,2})(?:\\s*(?:mm|ly|li|dem))?';
  const DAN_CO_DAU = new RegExp('^\\(?' + DAN_CO + '\\)?\\s*[\\s,;:-]\\s*(?:(?:dài|dai|l)\\s*[:=]?\\s*)?(\\S.*)$', 'iu');
  const DAN_CO_CUOI = new RegExp('^(.*?\\S)\\s*[\\s,;-]\\s*\\(?' + DAN_CO + '\\)?$', 'iu');
  const DAN_CO_TRON = new RegExp('^\\(?' + DAN_CO + '\\)?$', 'iu');
  const DAN_TU_CO = /^(hop|ong|vuong|inox|sus|phi|fi|ø|la|v|u|d|l)(\s|$)/;
  // số thứ tự đầu dòng kiểu Zalo (T3-03): "1. " "1) " "1: " "1/ " "(1) " "1 - "
  const DAN_STT = /^(?:\((\d{1,3})\)\s*|(\d{1,3})\s*([.):\/])\s+|(\d{1,3})\s*-\s+)(?=\S)/;
  const LA_TONG = /(^|[^\p{L}])(tổng|tong|cộng|total|subtotal|sum)([^\p{L}]|$)/iu;
  const GOI_MAU = 'ghi kiểu 1200x5 (dài x số lượng, tính bằng mm)';
  const GOI_PHAY = 'dấu phẩy không rõ nghĩa, viết liền số (1200x5) và cách các món bằng xuống dòng hoặc phẩy kèm khoảng trắng';
  const GOI_TONG = 'có vẻ là dòng cộng tổng nên không thêm';
  const GOI_CO = 'có vẻ là cỡ ống (tên vật tư), không phải chi tiết cần cắt; bỏ dòng này, mỗi dòng chỉ ghi dài x số lượng (1200x5)';
  const GOI_3SO = 'có 3 số nhân nhau, app không biết số nào là dài, số nào là số lượng; nếu có cỡ ống thì bỏ đi, chỉ để dài x số lượng (1200x5)';
  const khongDau = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  const mon = (L, sl, ten) => ({ L, sl, ten: ten || '' });
  const goiChu = (ten, L) => 'có chữ "' + ten + '" mà không có dấu x và số lượng nên app không đoán; nếu là chi tiết thì ghi đủ, ví dụ: ' + ten + ' ' + L + 'x1';
  // T3-02: số lượng lớn hơn hoặc bằng chiều dài, hoặc trên 500 → không tự nhận, đưa ra các cách hiểu. null = không có gì đáng ngờ.
  // ro = vai đã ghi rõ (chữ mm gắn vào chiều dài, nhãn "dài", tiêu đề cột Excel) → không đưa ra cách đảo
  function nghiSl(L, sl, ro, ten) {
    const giu = { ma: 'giu', ds: [mon(L, sl, ten)] }, dao = { ma: 'dao', ds: [mon(sl, L, ten)] }, daoDuoc = !ro && L % 1 === 0 && L >= 1;
    if (sl > 500) return !daoDuoc ? [giu] : sl > L ? [dao, giu] : sl === L ? [giu] : [giu, dao];
    if (ro || sl < L) return null;
    return sl > L && daoDuoc ? [dao, giu] : [giu];
  }
  // một con số: { v } đọc chắc · { cach: [{ ma, v }] } mơ hồ · null không phải số hợp lệ. trongO = nằm riêng một ô Excel
  function docSoDan(t, trongO) {
    let m;
    if (/^\d+$/.test(t) || /^\d{1,3}(\.\d{3})+$/.test(t)) return { v: Number(t.replace(/\./g, '')) };
    if ((m = /^(\d{1,3}(?:\.\d{3})+),(\d{1,2})$/.exec(t))) return { v: Number(m[1].replace(/\./g, '') + '.' + m[2]) };
    if ((m = /^(\d+)[.,](\d{1,2})$/.exec(t))) {
      // 1.5 hay 1,5: thợ hay ghi mét → không rõ 1,5 mm hay 1.500 mm; từ 21 trở lên (60,5 · 1200.5) thì chắc là mm có số lẻ
      const v = Number(m[1] + '.' + m[2]);
      return Number(m[1]) <= 20 ? { cach: [{ ma: 'mm', v }, { ma: 'met', v: Math.round(v * 1000) }] } : { v };
    }
    if (trongO && (m = /^(\d{1,3}),(\d{3})$/.exec(t))) return { cach: [{ ma: 'nghin', v: Number(m[1] + m[2]) }, { ma: 'le', v: Number(m[1] + '.' + m[2]) }] };
    return null;
  }
  // chữ đi kèm (ghi chú): không được là dòng cộng tổng, chữ nói về cắt ke, đơn vị khác mm, hay dấu nhân bỏ lửng
  function loiNhan(ten, trongO) {
    if (!ten) return null;
    const t = khongDau(ten);
    if (LA_TONG.test(ten)) return GOI_TONG;
    if (!trongO && /^[x×✕✖х*]+(\s|$)/i.test(ten.trim())) return 'thiếu số lượng sau dấu x';
    // "kệ" (cái kệ) là ghi chú hợp lệ, chỉ chặn đúng chữ "ke" không dấu
    if (/(^|[^\p{L}])(ke|vát|vat|xéo|xeo|chéo|cheo)([^\p{L}]|$)/iu.test(ten)) return 'đầu cắt ke chọn ở bảng sau khi thêm, ở đây chỉ ghi dài x số lượng';
    if (/^(m|cm|dm|ly|li|met|tac|phan|inch|in)$/.test(t)) return 'chỉ nhận số đo mm, đổi ra mm rồi ghi lại';
    if (!trongO && !/\p{L}/u.test(ten)) return GOI_MAU;
    return null;
  }
  // kiểm số của một món rồi đóng gói: { kieu, so, sl, ten, goc, ro, tenMo, coTu } hoặc { loi }
  function taoMon(L, sl, kieu, ten, ro, dau) {
    const so = docSoDan(L, false);
    if (!so) return { loi: 'số "' + L + '" không rõ, ghi số mm liền nhau (1200) hoặc 1.200, số lẻ dùng dấu phẩy (60,5)' };
    const n = Number(sl);
    if (so.v != null && !(so.v > 0)) return { loi: 'chiều dài phải lớn hơn 0' };
    if (!(n >= 1) || n % 1) return { loi: 'số lượng phải từ 1 trở lên' };
    // tenMo: chữ lạ đi với số mà không có dấu nhân ("Chân 1450", "Chân 1450 4") → không đọc chắc
    return { kieu, so, sl: n, ten, goc: L, ro: !!ro, tenMo: !!ten && (kieu === 'don' || kieu === 'trang'), coTu: !!dau && DAN_TU_CO.test(khongDau(dau)) };
  }
  // một món: kieu 'x' có dấu nhân | 'tu' có chữ chỉ số lượng | 'don' 1 số trơ trọi | 'trang' 2 số cách bằng khoảng trắng hoặc gạch nối
  function docMotMon(seg) {
    let s = seg.trim().replace(DAN_NGOAC_SL, ' $1'), dau = '', roL = false;
    const mdai = DAN_DAU_DAI.exec(s);
    if (mdai) { s = s.slice(mdai[0].length); roL = true; }
    else { const md = /^([^\d]*?\p{L}[^\d]*?)[\s:]+(?=\d)/u.exec(s); if (md) { dau = md[1].trim(); s = s.slice(md[0].length); } }
    let L, sl = '1', kieu, cuoi = '', m, ro = roL || DAN_CO_MM.test(s);
    if ((m = DAN_C.exec(s))) { sl = m[1]; L = m[2]; cuoi = m[3] || ''; kieu = 'tu'; ro = roL || /mm|dài|dai/i.test(s); }
    else if ((m = DAN_X.exec(s))) { L = m[1]; sl = m[2]; cuoi = m[3] || ''; kieu = 'x'; }
    else if ((m = DAN_XM.exec(s))) { sl = m[1]; L = m[2]; cuoi = m[3] || ''; kieu = 'x'; ro = true; }
    else if ((m = DAN_SL.exec(s)) || (m = DAN_DVQ.exec(s))) { L = m[1]; sl = m[2]; cuoi = m[3] || ''; kieu = 'tu'; }
    else if ((m = DAN_T.exec(s))) { L = m[1]; sl = m[2]; kieu = 'trang'; }
    else if ((m = DAN_B.exec(s))) { L = m[1]; cuoi = m[2] || ''; kieu = 'don'; ro = roL; }
    else {
      const tr = seg.trim(), so3 = (tr.match(/\d+(?:[.,]\d+)?/g) || []).map(v => Number(v.replace(',', '.')));
      if (!DAN_CO_TRON.test(tr) || !/[xX×*øØ]|phi|fi/i.test(tr)) return { loi: GOI_MAU };
      return { loi: so3.every(v => v <= DAN_CO_MAX_TU) ? GOI_CO : so3.length >= 3 ? GOI_3SO : GOI_MAU };
    }
    cuoi = cuoi.trim();
    const e = loiNhan(dau) || loiNhan(cuoi); if (e) return { loi: e };
    return taoMon(L, sl, kieu, [dau, cuoi].filter(Boolean).join(' '), ro, dau);
  }
  // tách một dòng thành các món theo dấu ; và dấu phẩy. Dấu phẩy dính giữa 2 chữ số có thể là số lẻ, ngăn nghìn hoặc ngăn món:
  // P = cách tách coi nó là ngăn món; A = cách tách coi nó là một phần của con số (chỉ có khi thật sự không rõ), maA = 'le' | 'nghin'
  function tachMon(s) {
    const P = [], A = []; let cur = '', curA = '', dinh = false, coA = false, maA = '';
    const day = dinhSau => { P.push({ t: cur, dinh: dinh || dinhSau }); cur = ''; dinh = dinhSau; };
    const dayA = () => { A.push({ t: curA, dinh: false }); curA = ''; };
    for (let k = 0; k < s.length; k++) {
      const ch = s[k], sau = s.slice(k + 1);
      if (ch === ';') { day(false); dayA(); continue; }
      if (ch !== ',') { cur += ch; curA += ch; continue; }
      if (!(/\d$/.test(cur) && /^\d/.test(sau))) { day(false); dayA(); continue; }
      const mt = /(^|\s)(\d[\d.]*)$/.exec(cur), md = /^(\d+)(.*)$/.exec(sau), n = md[1].length, tiep = md[2];
      const tran = !!mt && !DAN_TRUOC_NHAN.test(cur.slice(0, mt.index).trim()), trai = tran ? mt[2] : '';
      // ngay sau là dấu nhân thì chắc là số lẻ của chiều dài: 1200,5x2 · 1.200,5 x 2 · 1.200,50 x 2
      if (tran && DAN_SAU_NHAN.test(tiep) && (n === 1 || (n === 2 && /^\d{1,3}(\.\d{3})+$/.test(trai)))) { cur += ','; curA += ','; continue; }
      const lung = tran && !dinh && !/^[.,]?\d/.test(tiep);
      if (lung && n <= 2) { coA = true; maA = maA || 'le'; curA += ','; day(true); continue; }             // 1200,5 · 1200,50 x 2
      if (lung && n === 3 && /^\d{1,3}$/.test(trai)) { coA = true; maA = maA || 'nghin'; curA += '.'; day(true); continue; } // 1,200x5
      day(true); dayA();
    }
    day(false); dayA();
    return { P, A: coA ? A : null, maA };
  }
  function docBo(segs) {
    let ds = segs.map(x => ({ t: x.t.trim(), dinh: x.dinh })).filter(x => x.t);
    if (ds.length === 1) { const tu = ds[0].t.split(/\s+/); if (tu.length >= 2 && tu.every(x => DAN_GON.test(x))) ds = tu.map(t => ({ t, dinh: false })); }
    if (!ds.length) return { loi: GOI_MAU };
    const out = [];
    for (const x of ds) { const r = docMotMon(x.t); if (r.loi) return { loi: r.loi }; r.dinh = x.dinh; out.push(r); }
    return { mons: out };
  }
  // món có dấu nhân mà cả hai số đều nhỏ: có thể là cỡ ống (40x40, 40x80, 50x5) chứ không phải dài x số lượng
  const laCo = x => x.kieu === 'x' && !x.ro && x.so.v % 1 === 0 && x.so.v <= DAN_CO_MAX && x.sl <= DAN_CO_MAX;
  // xếp các món của một dòng vào nhóm: { ds, ro } chắc (ro = món nào cũng có dấu nhân / chữ chỉ số lượng) · { cach } mơ hồ · { loi }
  function xepMons(mons) {
    const mo = mons.filter(x => x.so.cach);
    if (mo.length) {
      if (mons.length > 1 || mons[0].kieu === 'trang' || mons[0].tenMo) return { loi: 'số "' + mo[0].goc + '" không rõ là mm hay mét, ghi lại bằng mm (ví dụ 1500x3)' };
      const x = mons[0];
      return { cach: x.so.cach.map(c => ({ ma: c.ma, ds: [mon(c.v, x.sl, x.ten)] })) };
    }
    if (mons.length === 1) {
      const x = mons[0], L = x.so.v, daoDuoc = x.sl > L && L % 1 === 0;
      if (x.tenMo) {
        // T3-04: "Chân 1450", "Chân 1450 4" → không nhận chắc, nhưng số đủ lớn thì hỏi lại 1 chạm; số nhỏ ("ngày 15") vẫn báo không đọc được
        if (!((x.kieu === 'don' ? L : Math.max(L, x.sl)) >= 100)) return { loi: goiChu(x.ten, x.goc) };
        if (x.kieu === 'don') return { cach: [{ ma: 'mot', ds: [mon(L, 1, x.ten)] }] };
        return { cach: (daoDuoc ? [{ ma: 'dao', ds: [mon(x.sl, L, x.ten)] }] : []).concat([{ ma: 'sl', ds: [mon(L, x.sl, x.ten)] }]) };
      }
      if (x.kieu === 'trang') {
        const cach = [];
        if (daoDuoc) cach.push({ ma: 'dao', ds: [mon(x.sl, L)] });
        cach.push({ ma: 'sl', ds: [mon(L, x.sl)] }, { ma: 'hai', ds: [mon(L, 1), mon(x.sl, 1)] });
        return { cach };
      }
      // "Dài: 1200" (có nhãn, thiếu số lượng): có thể dòng sau mới là số lượng → hỏi, không tự cho là 1 thanh
      if (x.kieu === 'don') return x.ro ? { cach: [{ ma: 'mot', ds: [mon(L, 1, x.ten)] }] } : { ds: [mon(L, 1, x.ten)] };
      // "Hộp 50x25", "V 50x5": chữ chỉ loại vật tư + 2 số nhỏ → có vẻ là cỡ ống, không phải chi tiết
      if (x.coTu && L <= DAN_CO_MAX_TU && x.sl <= DAN_CO_MAX_TU) return { cach: [{ ma: 'giu', ds: [mon(L, x.sl, x.ten)] }], ghi: 'co' };
      const ng = nghiSl(L, x.sl, x.ro, x.ten);
      return ng ? { cach: ng } : { ds: [mon(L, x.sl, x.ten)], ro: true };
    }
    if (mons.some(x => x.kieu === 'trang')) return { loi: GOI_MAU };
    const coChu = mons.find(x => x.tenMo); if (coChu) return { loi: goiChu(coChu.ten, coChu.goc) };
    const le = mons.filter(x => x.kieu === 'don'), tat = () => mons.map(x => mon(x.so.v, x.sl, x.ten));
    if (!le.length) {
      if (mons.some(x => !laCo(x) && (x.sl >= x.so.v || x.sl > 500))) return { loi: 'có món số lượng lớn hơn chiều dài hoặc trên 500 (có vẻ ghi ngược); ghi dài trước, số lượng sau (1200x5), mỗi món một dòng' };
      // T3-01: lẫn món 2 số nhỏ (40x40) → có thể là cỡ ống ghi chung dòng, không nhận chắc
      const co = mons.filter(laCo);
      if (!co.length) return { ds: tat(), ro: true };
      const cach = [];
      if (co.length < mons.length) cach.push({ ma: 'boco', ds: mons.filter(x => !laCo(x)).map(x => mon(x.so.v, x.sl, x.ten)) });
      cach.push({ ma: 'roi', ds: tat() });
      return { cach, ghi: 'co' };
    }
    if (mons.length === 2 && le.length === 2) {
      const a = mons[0].so.v, b = mons[1].so.v, cach = [];
      if (a % 1 === 0 && b % 1 === 0 && b > a) cach.push({ ma: 'dao', ds: [mon(b, a)] });
      if (b % 1 === 0) cach.push({ ma: 'sl', ds: [mon(a, b)] });
      if (!(mons[1].dinh && Math.min(a, b) < 10)) cach.push({ ma: 'hai', ds: [mon(a, 1), mon(b, 1)] });
      return cach.length ? { cach } : { loi: GOI_PHAY };
    }
    // 1200x5,60 · 1200x2,5: số trơ trọi dưới 100 dính sau dấu phẩy → không rõ là số lẻ hay một món
    if (le.some(x => x.dinh && x.so.v < 100)) return { loi: GOI_PHAY };
    return { cach: [{ ma: le.length === mons.length ? 'roi1' : 'roi', ds: tat() }] };
  }
  function xepThuong(s) {
    const tm = tachMon(s), rP = docBo(tm.P), xP = rP.loi ? rP : xepMons(rP.mons);
    if (!tm.A) return xP;
    const rA = docBo(tm.A), xA = rA.loi ? rA : xepMons(rA.mons), cach = [], co = {};
    const them = (x, ma) => (x.ds ? [{ ma, ds: x.ds }] : x.cach || []).forEach(c => {
      const k = c.ds.map(y => y.L + 'x' + y.sl + y.ten).join(';'); if (!co[k]) { co[k] = 1; cach.push(c); }
    });
    them(xP, 'roi'); them(xA, tm.maA);
    return cach.length ? { cach } : { loi: GOI_PHAY };
  }
  // T3-01: cỡ ống đứng đầu hoặc cuối dòng, phần còn lại là dài x số lượng rõ ràng → hỏi (bỏ cỡ ống / tách món), không nhận chắc
  function docCo(s) {
    for (const k of [[DAN_CO_DAU, 3, 1, 2], [DAN_CO_CUOI, 1, 2, 3]]) {
      const m = k[0].exec(s); if (!m) continue;
      const tu = m[k[2]] || '', so = m[k[3]].match(/\d+(?:[.,]\d+)?/g).map(t => Number(t.replace(',', '.')));
      if ((!tu && so.length < 2) || so.some(v => !(v > 0 && v <= (tu ? DAN_CO_MAX_TU : DAN_CO_MAX)))) continue;
      const r = xepThuong(m[k[1]].trim());
      if (!r.ds || !r.ro || r.ds.some(x => x.L <= DAN_CO_MAX)) continue;
      const nhan = ((tu ? tu + ' ' : '') + m[k[3]]).replace(/\s+/g, ' ').trim();
      const cach = [{ ma: 'boco', ds: r.ds.map(x => mon(x.L, x.sl, x.ten || nhan)) }];
      if (!tu && so.length === 2 && so.every(v => v % 1 === 0)) {
        const c = mon(so[0], so[1]), con = r.ds.map(x => mon(x.L, x.sl, x.ten));
        cach.push({ ma: 'roi', ds: k[0] === DAN_CO_DAU ? [c].concat(con) : con.concat([c]) });
      }
      return { cach, ghi: 'co' };
    }
    return null;
  }
  function xepDong(s) {
    let m;
    // T3-05: "1,200,000 x 2", "1200,000" → nói đúng chỗ không rõ, không báo "chiều dài phải lớn hơn 0"
    if ((m = /(?:^|[^\d.,])(\d{1,3}(?:,\d{3}){2,})(?![\d,])/.exec(s))) return { loi: 'số "' + m[1] + '" dùng dấu phẩy ngăn hàng nghìn nên app không chắc là bao nhiêu mm; ghi liền ' + m[1].replace(/,/g, '') + ' hoặc dùng dấu chấm ' + m[1].replace(/,/g, '.') };
    if ((m = /(?:^|[^\d.,])(\d[\d.]*,0{2,})(?![\d,])/.exec(s)) && !/^\d{1,3},000$/.test(m[1])) return { loi: 'số "' + m[1] + '" không rõ (sau dấu phẩy toàn số 0); ghi số mm liền nhau, ví dụ ' + m[1].replace(/,0+$/, '').replace(/\./g, '') };
    const a = DAN_NHAN_A.exec(s), b = a ? null : DAN_NHAN_B.exec(s);
    if (a || b) { const r = taoMon(a ? a[1] : b[2], a ? a[2] : b[1], 'tu', '', true); return r.loi ? r : xepMons([r]); }
    return docCo(s) || xepThuong(s);
  }
  // T3-03: dòng có số thứ tự đầu dòng. day = nằm trong dãy đánh số tăng dần (có dòng liền trước / liền sau) → đọc chắc phần còn lại
  function docStt(x, day) {
    const st = x.stt, rr = xepDong(st.rest), yeu = st.dau === '-' || st.dau === '/';
    if (rr.ds && rr.ro) {
      if (day) return { ds: rr.ds, ro: true, stt: 'so' };
      const cach = [{ ma: 'stt', ds: rr.ds }], m3 = st.dau === '.' && rr.ds.length === 1 && /^(\d{3})(?![\d.,])/.exec(st.rest);
      // "1. 200 x 5" đứng lẻ: cũng có thể là 1.200 x 5 gõ dư khoảng trắng
      if (m3 && rr.ds[0].L === Number(m3[1]) && st.n >= 1) cach.push({ ma: 'nghin', ds: [mon(st.n * 1000 + rr.ds[0].L, rr.ds[0].sl, rr.ds[0].ten)] });
      return { cach, stt: 'so' };
    }
    if (yeu) return xepDong(x.s);                                      // "500 - 3": gạch nối không chắc là số thứ tự
    if (rr.ds) return { cach: [{ ma: 'stt', ds: rr.ds }], stt: 'so' }; // "1. 1200": không có dấu nhân → hỏi
    if (rr.cach) return { cach: rr.cach, stt: 'so', ghi: rr.ghi };
    return rr;
  }
  // dòng tiêu đề Excel (không có số): tìm cột Dài, cột SL, cột tên → dùng cho các dòng sau (bảng có cột STT, đảo cột…)
  function docTieuDe(d) {
    const o = d.split('\t').map(x => khongDau(x).trim());
    const tim = re => o.findIndex(x => re.test(x));
    const iL = tim(/^(chieu\s*)?dai(?![a-z])|^l$|^length|^kich\s*thuoc|^cd$/), iSl = tim(/^sl(?![a-z])|^s\.l|^so\s*luong|^qty|^quantity|^so\s*(thanh|cai|cay|doan)/);
    const iTen = tim(/^ten|^ghi\s*chu|^chi\s*tiet|^mo\s*ta|^vi\s*tri|^hang\s*muc|^note/);
    return iL >= 0 && iSl >= 0 && iL !== iSl ? { iL, iSl, iTen } : null;
  }
  const laSoO = x => DAN_O_SO.test(x) || DAN_O_SL.test(x);
  // dòng dán từ Excel (các ô cách nhau bằng TAB). stt = 'day' cột đầu là số thứ tự 1, 2, 3… của cả bảng · 'le' chỉ có 1 dòng, cột đầu là 1
  function docDongTab(d, map, stt) {
    const o = d.split('\t').map(x => x.trim());
    if (o.some(x => LA_TONG.test(x))) return { loi: GOI_TONG };
    let Lc, slc, ten, coMap = false, boCot = '';
    if (map && o.length > Math.max(map.iL, map.iSl) && (o[map.iL] || o[map.iSl])) {
      Lc = o[map.iL]; slc = o[map.iSl]; ten = map.iTen >= 0 ? o[map.iTen] || '' : ''; coMap = true;
      if (!Lc) return { loi: 'ô chiều dài đang trống' };
      if (!slc) return { loi: 'ô số lượng đang trống, ghi số lượng rồi dán lại' };
    } else {
      const co = o.filter(Boolean), so = co.filter(laSoO);
      if (!so.length) return xepDong(co.join(' '));
      ten = co.filter(x => !laSoO(x)).join(' ');
      if (so.length === 3 && stt) { Lc = so[1]; slc = so[2]; boCot = stt; }
      else if (so.length >= 3) return { loi: 'có ' + so.length + ' cột số, app không biết cột nào là dài, cột nào là số lượng; chỉ dán 2 cột (dài, số lượng) hoặc dán kèm dòng tiêu đề có chữ Dài và SL' };
      else { Lc = so[0]; slc = so.length === 2 ? so[1] : '1'; }
      if (so.length === 1 && ten) {
        // "Chân<TAB>1450": thiếu cột số lượng → không đoán; số đủ lớn thì hỏi lại 1 chạm (T3-04)
        const s1 = DAN_O_SO.exec(Lc), v1 = s1 && docSoDan(s1[1], true);
        if (loiNhan(ten, true) || /\d/.test(ten) || !v1 || !(v1.v >= 100)) return { loi: loiNhan(ten, true) || 'có chữ "' + ten + '" và 1 con số, thiếu cột số lượng nên app không đoán' };
        return { cach: [{ ma: 'mot', ds: [mon(v1.v, 1, ten)] }] };
      }
    }
    const e = loiNhan(ten, true); if (e) return { loi: e };
    const mL = DAN_O_SO.exec(Lc), mS = DAN_O_SL.exec(slc), so = mL && docSoDan(mL[1], true);
    if (!so) return { loi: 'ô chiều dài "' + Lc + '" không phải số mm' };
    if (!mS) return { loi: 'ô số lượng "' + slc + '" phải là số tròn (1, 2, 3…)' };
    const n = Number(mS[1].replace(/\./g, ''));
    if (so.v != null && !(so.v > 0)) return { loi: 'chiều dài phải lớn hơn 0' };
    if (!(n >= 1)) return { loi: 'số lượng phải từ 1 trở lên' };
    let r;
    if (so.cach) r = { cach: so.cach.map(c => ({ ma: c.ma, ds: [mon(c.v, n, ten)] })) };
    else {
      // có tiêu đề cột thì vai đã rõ, chỉ còn hỏi khi trông như điền nhầm cột (dài dưới 100 mà số lượng từ 100) hoặc số lượng trên 500
      const ro = coMap && !(so.v % 1 === 0 && so.v < 100 && n >= 100 && n > so.v), ng = nghiSl(so.v, n, ro, ten);
      r = ng ? { cach: ng } : { ds: [mon(so.v, n, ten)], ro: true };
    }
    if (boCot) { r.stt = 'cot'; if (boCot === 'le' && r.ds) r = { cach: [{ ma: 'stt', ds: r.ds }], stt: 'cot' }; }
    return r;
  }
  function docDan(txt, tuy) {
    const cayMax = tuy && tuy.cayMax > 0 ? tuy.cayMax : 0;
    const chac = [], hoi = [], loi = [], bo = []; let map = null;
    const soi = x => { x.canh = []; if (cayMax && x.L > cayMax) x.canh.push('dai'); if (x.L < 10) x.canh.push('ngan'); if (x.sl > 500) x.canh.push('nhieu'); return x; };
    // chuẩn hoá trước khi đọc: chữ và số toàn góc (１２００ｘ５) về chữ thường, khoảng trắng cứng về khoảng trắng, bỏ ký tự vô hình
    const tt = String(txt == null ? '' : txt).normalize('NFC').replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[   　]/g, ' ').replace(/[​-‍⁠﻿]/g, '').split(/\r?\n/).map(d => {
        const s = d.trim().replace(/^[-–—•·+*]\s+/, ''), x = { d, s };
        if (!s || !/\d/.test(s)) return x;
        if (s.indexOf('\t') < 0) { const m = DAN_STT.exec(s); if (m && /\d/.test(s.slice(m[0].length))) x.stt = { n: Number(m[1] || m[2] || m[4]), dau: m[1] ? '(' : m[3] || '-', rest: s.slice(m[0].length) }; }
        else { const co = d.split('\t').map(y => y.trim()).filter(Boolean), so = co.filter(laSoO); if (so.length === 3) x.cot3 = co[0] === so[0] && /^\d{1,3}$/.test(co[0]) ? Number(co[0]) : 0; }
        return x;
      });
    // dãy đánh số: dòng liền trước (trong các dòng có số thứ tự) nhỏ hơn 1, hoặc dòng liền sau lớn hơn 1
    const dsStt = tt.filter(x => x.stt), dsCot = tt.filter(x => x.cot3 != null);
    dsStt.forEach((x, k) => { x.day = (k > 0 && dsStt[k - 1].stt.n === x.stt.n - 1) || (k < dsStt.length - 1 && dsStt[k + 1].stt.n === x.stt.n + 1); });
    // "1. 200 x 5" + "2. 300 x 4": chỉ 2 dòng mà dòng nào cũng có thể là số có dấu ngăn nghìn gõ dư khoảng trắng (1.200, 2.300) → chưa đủ chắc là danh sách đánh số
    const dsDay = dsStt.filter(x => x.day), dayChac = dsDay.length >= 3 || dsDay.some(x => !(x.stt.dau === '.' && /^\d{3}(?![\d.,])/.test(x.stt.rest)));
    // Excel 3 cột số không tiêu đề: cột đầu của mọi dòng phải đúng 1, 2, 3… mới coi là cột số thứ tự
    const cotDay = dsCot.length >= 2 && dsCot.every((x, k) => x.cot3 === k + 1), cotLe = dsCot.length === 1 && dsCot[0].cot3 === 1;
    tt.forEach((x, i) => {
      const d = x.d, s = x.s; if (!s) return;
      const chu = s.replace(/\s+/g, ' '), dong = i + 1;
      if (!/\d/.test(s)) {
        // T3-05: chữ số kiểu lạ (không phải 0–9) thì báo, không coi là dòng chữ rồi bỏ im lặng
        if (/\p{N}/u.test(s)) { loi.push({ dong, chu, tho: d, goi: 'có chữ số kiểu lạ app không đọc được, gõ lại bằng số thường (0 đến 9)' }); return; }
        bo.push({ dong, chu }); if (d.indexOf('\t') >= 0) map = docTieuDe(d) || map; return;
      }
      // có tiêu đề cột rồi thì dòng "1200<TAB>" (ô số lượng trống) vẫn đọc theo cột, không coi là 1 con số trơ trọi
      const r = s.indexOf('\t') >= 0 || (map && d.indexOf('\t') >= 0) ? docDongTab(d, map, x.cot3 != null ? (cotDay ? 'day' : cotLe ? 'le' : '') : '') : x.stt ? docStt(x, x.day && dayChac) : xepDong(s);
      // tho = dòng đúng như đã dán (còn nguyên TAB) để trả lại vào ô cho thợ sửa
      if (r.loi) loi.push({ dong, chu, tho: d, goi: r.loi });
      else if (r.cach) hoi.push({ dong, chu, tho: d, kieu: (r.stt ? r.stt + ':' : '') + r.cach.map(c => c.ma).join('|'), cach: r.cach.map(c => ({ ma: c.ma, ds: c.ds.map(soi) })), stt: r.stt || '', ghi: r.ghi || '' });
      else chac.push({ dong, chu, ds: r.ds.map(soi), stt: r.stt || '' });
    });
    const ds = []; chac.forEach(c => c.ds.forEach(x => ds.push(x)));
    return { chac, hoi, loi, bo, boQua: bo.length, ds };
  }

  const RC = { solve, layoutBar, parseMat, typeKey, jointsFor, bestTypedDP, exactPack, arrangeBar, docDan };
  if (typeof module !== 'undefined' && module.exports) module.exports = RC;
  root.RC = RC;
  // trong Worker: nhận {id, data} → trả {id, kq} hoặc {id, loi}
  if (typeof document === 'undefined' && typeof postMessage === 'function' && typeof importScripts === 'function') {
    root.onmessage = e => { try { postMessage({ id: e.data.id, kq: solve(e.data.data) }); } catch (err) { postMessage({ id: e.data.id, loi: String(err && err.message || err) }); } };
  }
})(typeof self !== 'undefined' ? self : this);
