// ===== 計算エンジン（UIに依存しない。Node からも読み込んでテストする） =====
// 単位：長さ mm、角度 °（度）

// ---- 乱数（同じ入力なら同じ結果になるよう、種つきの乱数を使う） ----
function makeRng(seed){
  let a = seed >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 標準正規乱数（Box-Muller）
function gauss(r){
  let u = 0; while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

// 標準正規分布の累積分布関数（erf の近似 Abramowitz-Stegun 7.1.26、誤差 1.5e-7 以下）
function normCdf(z){
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429*t - 1.453152027)*t) + 1.421413741)*t - 0.284496736)*t + 0.254829592)*t * Math.exp(-z*z/2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

// ---- 1つの量の分布 ----
// c：公差域の中心、h：公差域の半幅、d：{dist, cpk, mean, sd}
//   normal：±h を ±3σ とする正規分布
//   uniform：±h の一様分布
//   tri：±h の三角分布
//   cpk：平均 c + shift、σ = (h − |shift|) / (3·Cpk) の正規分布（shift は公差中心からの平均のずれ）
//   meas：実測の平均 mean と標準偏差 sd を使う正規分布
function scalarStats(c, h, d){
  switch (d.dist) {
    case 'uniform': return {mu: c, sd: h / Math.sqrt(3)};
    case 'tri':     return {mu: c, sd: h / Math.sqrt(6)};
    case 'cpk':     { const s = d.shift || 0; return {mu: c + s, sd: (h - Math.abs(s)) / (3 * d.cpk)}; }
    case 'meas':    return {mu: d.mean, sd: d.sd};
    default:        return {mu: c, sd: h / 3};
  }
}
function scalarSample(c, h, d, r){
  switch (d.dist) {
    case 'uniform': return c + (2 * r() - 1) * h;
    case 'tri':     return c + (r() - r()) * h;
    case 'cpk':     { const s = d.shift || 0; return c + s + gauss(r) * (h - Math.abs(s)) / (3 * d.cpk); }
    case 'meas':    return d.mean + gauss(r) * d.sd;
    default:        return c + gauss(r) * h / 3;
  }
}

// ---- 1次元の寄与項目 ----
// 共通：{type, name, coef}  出力 = Σ coef × 項目の値
//   dim  ：寸法 {nom, up, lo, dist...}             値 = 寸法そのもの
//   prof ：輪郭度などの幾何公差 {t, dist...}        値 = 公差域内のずれ（±t/2）
//   pos  ：位置度 {t, mmc, sup, slo, dist:'disc'|'normal'}
//          値 = 位置のずれの1方向成分。Ⓜ ならサイズのずれ（最大実体から）だけ公差域が広がる
//          サイズは公差の中央を中心に、公差幅を ±3σ とする正規分布と仮定する
//   float：組付けの遊び（穴と軸・ボルト）{hnom,hup,hlo, fnom,fup,flo}
//          値 = すき間の範囲内での一様なずれ（±すき間/2）。データムシフトもこれで表せる
function itemModel(it){
  const a = it.coef;
  if (it.type === 'dim') {
    const c = it.nom + (it.up + it.lo) / 2, h = (it.up - it.lo) / 2;
    const s = scalarStats(c, h, it);
    return {a, nom: it.nom, c, h, mu: s.mu, sd: s.sd, sample: r => scalarSample(c, h, it, r)};
  }
  if (it.type === 'prof') {
    const h = it.t / 2;
    const s = scalarStats(0, h, it);
    return {a, nom: 0, c: 0, h, mu: s.mu, sd: s.sd, sample: r => scalarSample(0, h, it, r)};
  }
  if (it.type === 'pos') {
    const w = it.mmc ? it.sup - it.slo : 0;          // ボーナス公差の最大
    const h = (it.t + w) / 2;                         // ワーストケースの半幅
    const sm = w / 2, ss = w / 6;                     // サイズのずれ（最大実体から）の平均と σ
    const E2 = (it.t + sm) ** 2 + ss ** 2;            // E[(t + ボーナス)²]
    // 円内一様：半径 R の円で1方向成分の分散は R²/4。正規：R を 3σ とみなす
    const sd = it.dist === 'normal' ? Math.sqrt(E2 / 36) : Math.sqrt(E2 / 16);
    return {a, nom: 0, c: 0, h, mu: 0, sd, sample: r => {
      const R = Math.abs(it.t + (it.mmc ? sm + gauss(r) * ss : 0)) / 2;
      if (it.dist === 'normal') return gauss(r) * R / 3;
      return R * Math.sqrt(r()) * Math.cos(2 * Math.PI * r());
    }};
  }
  if (it.type === 'float') {
    const hc = it.hnom + (it.hup + it.hlo) / 2, hh = (it.hup - it.hlo) / 2;
    const fc = it.fnom + (it.fup + it.flo) / 2, fh = (it.fup - it.flo) / 2;
    const h = Math.max(0, (it.hnom + it.hup) - (it.fnom + it.flo)) / 2;   // 最大の穴 − 最小の軸 の半分
    const cm = hc - fc, cv = (hh / 3) ** 2 + (fh / 3) ** 2;               // すき間の平均と分散
    return {a, nom: 0, c: 0, h, mu: 0, sd: Math.sqrt((cm * cm + cv) / 12), sample: r => {
      const cl = Math.max(0, (hc + gauss(r) * hh / 3) - (fc + gauss(r) * fh / 3));
      return (r() - 0.5) * cl;
    }};
  }
  throw new Error('unknown type ' + it.type);
}

// 部品が公差を外れる見込みがあるか（ワーストケースは「全部品が公差内」が前提のため）
//   meas：実測の平均 ± 3σ が公差域をはみ出す、cpk：Cpk が 1 未満
function partWarn(d, c, h){
  if (d.dist === 'meas' && Math.abs(d.mean - c) + 3 * d.sd > h + 1e-12) return 'meas';
  if (d.dist === 'cpk' && d.cpk < 1 - 1e-12) return 'cpk';
  return null;
}
// 出力の Cpk（正規近似）。片側規格なら片側だけで求める
function outCpk(mean, sd, smin, smax){
  if (smin === null && smax === null) return null;
  const inside = (smin === null || mean >= smin) && (smax === null || mean <= smax);
  if (!(sd > 0)) return inside ? Infinity : -Infinity;
  const a = [];
  if (smax !== null) a.push((smax - mean) / (3 * sd));
  if (smin !== null) a.push((mean - smin) / (3 * sd));
  return Math.min(...a);
}

// ---- 出力1つ分の集計 ----
// lin：{nom, center, wcHalf, mean, sd, rssHalf, contrib:[{wc, var}]}（線形化した結果）
// samples：モンテカルロの出力値
function summarize(lin, samples, smin, smax, warns = []){
  const res = {
    nom: lin.nom, center: lin.center,
    wcMin: lin.center - lin.wcHalf, wcMax: lin.center + lin.wcHalf, wcHalf: lin.wcHalf,
    mean: lin.mean, sd: lin.sd,
    stMin: lin.mean - 3 * lin.sd, stMax: lin.mean + 3 * lin.sd,
    // 補正RSS（Bender）：公差の二乗和平方根に 1.5 を掛ける
    bdMin: lin.center - 1.5 * lin.rssHalf, bdMax: lin.center + 1.5 * lin.rssHalf, rssHalf: lin.rssHalf,
    contrib: lin.contrib,
    warns
  };
  if (samples && samples.length) {
    const s = Float64Array.from(samples).sort();
    const q = p => {           // 分位点（線形補間）
      const x = p * (s.length - 1), i = Math.floor(x), f = x - i;
      return i + 1 < s.length ? s[i] * (1 - f) + s[i + 1] * f : s[i];
    };
    let m = 0; for (const v of s) m += v; m /= s.length;
    let v2 = 0; for (const v of s) v2 += (v - m) ** 2;
    let out = 0;
    if (smin !== null || smax !== null) for (const v of s) if ((smin !== null && v < smin) || (smax !== null && v > smax)) out++;
    res.mc = {n: s.length, sorted: s, mean: m, sd: Math.sqrt(v2 / (s.length - 1)),
              lo: q(0.00135), hi: q(0.99865), min: s[0], max: s[s.length - 1],
              ppm: (smin === null && smax === null) ? null : out / s.length * 1e6};
  }
  res.ppmNormal = normalPpm(res.mean, res.sd, smin, smax);
  res.cpk = outCpk(res.mean, res.sd, smin, smax);
  res.verdict = judge(res, smin, smax);
  return res;
}
// 正規近似による規格外れ率（ppm）
function normalPpm(mu, sd, smin, smax){
  if (smin === null && smax === null) return null;
  if (!(sd > 0)) return ((smin !== null && mu < smin) || (smax !== null && mu > smax)) ? 1e6 : 0;
  let p = 0;
  if (smin !== null) p += normCdf((smin - mu) / sd);
  if (smax !== null) p += 1 - normCdf((smax - mu) / sd);
  return p * 1e6;
}
// 判定
//   合格    ：全部品が公差内である前提が成り立ち、ワーストケースでも規格内
//   条件付き：統計（モンテカルロがあれば 0.135〜99.865%、なければ ±3σ）では規格内
//   不合格  ：統計でも規格外
// 実測分布や Cpk < 1 の部品を含むと「全部品が公差内」の前提が崩れるため、ワーストケースでは合格にしない
function judge(r, smin, smax){
  if (smin === null && smax === null) return null;
  const inside = (lo, hi) => (smin === null || lo >= smin - 1e-12) && (smax === null || hi <= smax + 1e-12);
  const statIn = r.mc ? inside(r.mc.lo, r.mc.hi) : inside(r.stMin, r.stMax);
  const wcValid = !(r.warns && r.warns.some(w => w));
  if (wcValid && inside(r.wcMin, r.wcMax)) return 'ok';
  if (statIn) return 'warn';
  return 'ng';
}

// ---- 1次元の解析 ----
// items：寄与項目の配列、opt：{n（モンテカルロの回数、0で省略）, seed, smin, smax}
function analyze1D(items, opt){
  const ms = items.map(itemModel);
  const sumWc = ms.reduce((s, m) => s + Math.abs(m.a) * m.h, 0);
  const vars = ms.map(m => (m.a * m.sd) ** 2);
  const sumVar = vars.reduce((s, v) => s + v, 0);
  const lin = {
    nom: ms.reduce((s, m) => s + m.a * m.nom, 0),
    center: ms.reduce((s, m) => s + m.a * m.c, 0),
    wcHalf: sumWc,
    mean: ms.reduce((s, m) => s + m.a * m.mu, 0),
    sd: Math.sqrt(sumVar),
    rssHalf: Math.sqrt(ms.reduce((s, m) => s + (m.a * m.h) ** 2, 0)),
    contrib: ms.map((m, i) => ({wc: sumWc > 0 ? Math.abs(m.a) * m.h / sumWc : 0,
                                var: sumVar > 0 ? vars[i] / sumVar : 0, sd: m.sd, h: m.h, a: m.a}))
  };
  let samples = null;
  if (opt.n > 0) {
    const r = makeRng(opt.seed ?? 1);
    samples = new Float64Array(opt.n);
    for (let k = 0; k < opt.n; k++) {
      let v = 0;
      for (const m of ms) v += m.a * m.sample(r);
      samples[k] = v;
    }
  }
  const warns = items.map((it, i) => it.type === 'dim' || it.type === 'prof' ? partWarn(it, ms[i].c, ms[i].h) : null);
  return summarize(lin, samples, opt.smin ?? null, opt.smax ?? null, warns);
}

// ---- 2次元ベクトルループ ----
// vecs：[{name, ln,lup,llo（長さ）, an,aup,alo（角度°）, rel（true なら前のベクトルの向きからの角度）, dist, cpk}]
// phi：測定方向（°）、(tx, ty)：目標点。出力1 = 目標点から見た終点の φ 方向成分、出力2 = φ+90° 方向成分
// 変数の並び：[L1, θ1, L2, θ2, ...]
function loop2D(vecs, p, phi, tx = 0, ty = 0){
  let th = 0, x = 0, y = 0;
  vecs.forEach((v, i) => {
    const L = p[2 * i], A = p[2 * i + 1] * Math.PI / 180;
    th = v.rel ? th + A : A;
    x += L * Math.cos(th); y += L * Math.sin(th);
  });
  const f = phi * Math.PI / 180;
  const dx = x - tx, dy = y - ty;
  return [dx * Math.cos(f) + dy * Math.sin(f), -dx * Math.sin(f) + dy * Math.cos(f), x, y];
}
// 各ベクトルの始点と終点（図を描くのに使う）
function loopPoints(vecs, p){
  let th = 0, x = 0, y = 0;
  const pts = [{x, y, th}];
  vecs.forEach((v, i) => {
    th = v.rel ? th + p[2 * i + 1] * Math.PI / 180 : p[2 * i + 1] * Math.PI / 180;
    x += p[2 * i] * Math.cos(th); y += p[2 * i] * Math.sin(th);
    pts.push({x, y, th});
  });
  return pts;
}
function vecParams(vecs){
  const ps = [];
  vecs.forEach(v => {
    ps.push({nom: v.ln, c: v.ln + (v.lup + v.llo) / 2, h: (v.lup - v.llo) / 2, d: v});
    ps.push({nom: v.an, c: v.an + (v.aup + v.alo) / 2, h: (v.aup - v.alo) / 2, d: v});
  });
  ps.forEach(q => Object.assign(q, scalarStats(q.c, q.h, q.d)));
  return ps;
}
// opt：{n, seed, phi, tx, ty, spec:[{min,max},{min,max}]}
function analyze2D(vecs, opt){
  const ps = vecParams(vecs);
  const F = p => loop2D(vecs, p, opt.phi, opt.tx || 0, opt.ty || 0);
  const cen = ps.map(q => q.c), mus = ps.map(q => q.mu), noms = ps.map(q => q.nom);
  const f0 = F(cen);
  // 感度係数：中心値のまわりで中心差分により数値微分する
  const sens = ps.map((q, i) => {
    const dlt = Math.max(Math.abs(q.h), Math.abs(cen[i]), 1) * 1e-6;
    const pp = cen.slice(), pm = cen.slice(); pp[i] += dlt; pm[i] -= dlt;
    const a = F(pp), b = F(pm);
    return [0, 1].map(k => (a[k] - b[k]) / (2 * dlt));
  });
  let samples = null;
  if (opt.n > 0) {
    const r = makeRng(opt.seed ?? 1);
    samples = [new Float64Array(opt.n), new Float64Array(opt.n)];
    const p = new Array(ps.length);
    for (let k = 0; k < opt.n; k++) {
      for (let i = 0; i < ps.length; i++) p[i] = scalarSample(ps[i].c, ps[i].h, ps[i].d, r);
      const o = F(p);
      samples[0][k] = o[0]; samples[1][k] = o[1];
    }
  }
  const outs = [0, 1].map(k => {
    const wcs = ps.map((q, i) => Math.abs(sens[i][k]) * q.h);
    const vars = ps.map((q, i) => (sens[i][k] * q.sd) ** 2);
    const sw = wcs.reduce((s, v) => s + v, 0), sv = vars.reduce((s, v) => s + v, 0);
    const lin = {
      nom: F(noms)[k],
      center: f0[k],
      wcHalf: sw,
      mean: F(mus)[k],
      sd: Math.sqrt(sv),
      rssHalf: Math.sqrt(ps.reduce((s, q, i) => s + (sens[i][k] * q.h) ** 2, 0)),
      contrib: ps.map((q, i) => ({wc: sw > 0 ? wcs[i] / sw : 0, var: sv > 0 ? vars[i] / sv : 0, a: sens[i][k], h: q.h, sd: q.sd}))
    };
    const sp = (opt.spec && opt.spec[k]) || {};
    const warns = vecs.map(v => partWarn(v, 0, 0));
    return summarize(lin, samples && samples[k], sp.min ?? null, sp.max ?? null, warns);
  });
  return {outs, sens, end: {x: f0[2], y: f0[3]}};
}

// ---- 公差の逆算 ----
// 目標（target）を満たすには、調整できる項目の公差を何倍にすればよいかを二分法で求める
//   mode '1d'：data = {items, spec:[{min,max}]}　'2d'：data = {vecs, phi, tx, ty, spec:[{..},{..}]}
//   target = {type:'wc'}（ワーストケースで規格内）| {type:'cpk', cpk}（出力の Cpk ≥ 目標、正規近似）
// 調整の対象：1次元は寸法・輪郭度など・位置度（φt のみ。ボーナス公差のもとのサイズ公差は変えない）
//             実測分布と組付けの遊びは対象外。2次元は各ベクトルの長さと角度
function evalOuts(mode, data){
  if (mode === '1d') { const sp = data.spec[0] || {}; return [analyze1D(data.items, {n: 0, smin: sp.min ?? null, smax: sp.max ?? null})]; }
  return analyze2D(data.vecs, {n: 0, phi: data.phi || 0, tx: data.tx || 0, ty: data.ty || 0, spec: data.spec}).outs;
}
function meetsTarget(outs, spec, target){
  let any = false;
  for (let k = 0; k < outs.length; k++) {
    const sp = spec[k] || {}, lo = sp.min ?? null, hi = sp.max ?? null;
    if (lo === null && hi === null) continue;
    any = true;
    const r = outs[k];
    if (!isFinite(r.sd) || r.sd < 0) return false;
    if (target.type === 'wc') {
      if (r.warns.some(w => w)) return false;      // 公差外れの部品がある限りワーストケースは保証できない
      if ((lo !== null && r.wcMin < lo - 1e-12) || (hi !== null && r.wcMax > hi + 1e-12)) return false;
    } else if (!(r.cpk >= target.cpk - 1e-9)) return false;
  }
  return any;
}
function allocVars(mode, data){
  const v = [];
  if (mode === '1d') data.items.forEach((it, i) => { if (it.dist !== 'meas' && it.type !== 'float') v.push({i, part: null}); });
  else data.vecs.forEach((q, i) => { v.push({i, part: 'l'}, {i, part: 'a'}); });
  return v;
}
// 公差域の中心を保ったまま、公差の半幅を k 倍にする
function scaleData(mode, data, vars, k){
  const d = JSON.parse(JSON.stringify(data));
  let ok = true;
  for (const {i, part} of vars) {
    if (mode === '1d') {
      const it = d.items[i];
      if (it.type === 'dim') {
        const c = (it.up + it.lo) / 2, h = (it.up - it.lo) / 2;
        it.up = c + k * h; it.lo = c - k * h;
        if (it.dist === 'cpk' && Math.abs(it.shift || 0) >= k * h && k * h > 0) ok = false;
      } else {
        it.t *= k;
        if (it.type === 'prof' && it.dist === 'cpk' && Math.abs(it.shift || 0) >= it.t / 2 && it.t > 0) ok = false;
      }
      // 半幅が 0 なのに平均のずれが残る場合は、Cpk の定義が成り立たない
      if (it.dist === 'cpk' && (it.shift || 0) !== 0 && k === 0) ok = false;
    } else {
      const q = d.vecs[i], [u, l] = part === 'l' ? ['lup', 'llo'] : ['aup', 'alo'];
      const c = (q[u] + q[l]) / 2, h = (q[u] - q[l]) / 2;
      q[u] = c + k * h; q[l] = c - k * h;
    }
  }
  return {ok, data: d};
}
function findK(mode, data, target, vars){
  const test = k => { const s = scaleData(mode, data, vars, k); return s.ok && meetsTarget(evalOuts(mode, s.data), data.spec, target); };
  const KMAX = 10;
  if (test(1)) {
    if (test(KMAX)) return {k: KMAX, cap: true};
    let a = 1, b = KMAX;
    for (let it = 0; it < 50; it++) { const m = (a + b) / 2; if (test(m)) a = m; else b = m; }
    return {k: a, cap: false};
  }
  if (!test(0)) return {k: null, cap: false};
  let a = 0, b = 1;
  for (let it = 0; it < 50; it++) { const m = (a + b) / 2; if (test(m)) a = m; else b = m; }
  return {k: a, cap: false};
}
function allocate(mode, data, target){
  const hasSpec = data.spec.some(sp => sp && ((sp.min ?? null) !== null || (sp.max ?? null) !== null));
  if (!hasSpec) return {hasSpec: false};
  const vars = allocVars(mode, data);
  const base = evalOuts(mode, data);
  return {
    hasSpec: true, vars, base,
    met: meetsTarget(base, data.spec, target),
    uniform: vars.length ? findK(mode, data, target, vars) : null,
    single: vars.map(v => ({...v, ...findK(mode, data, target, [v])})),
    // 両側規格のとき、平均を規格中心に寄せるのに必要な量（基準寸法の調整量の目安）
    center: base.map((r, k) => { const sp = data.spec[k] || {}; return (sp.min ?? null) !== null && (sp.max ?? null) !== null ? (sp.min + sp.max) / 2 - r.mean : null; })
  };
}

if (typeof module !== 'undefined') module.exports = {makeRng, gauss, normCdf, scalarStats, itemModel, analyze1D, loop2D, loopPoints, analyze2D, normalPpm, judge, outCpk, partWarn, allocate, scaleData, evalOuts, meetsTarget};
// ===== 計算エンジンここまで =====
