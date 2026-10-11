// 答えが数学的に分かっている例題（解析解）との照合テスト（node tests/analytic.js）。不一致が1件でもあれば終了コード 1
// tests/verify.py が「エンジンと同じ考え方を Python で独立に書き直した検算」なのに対し、ここでは
// 分布の和の確率が式で正確に求まる例題を使い、モンテカルロ・正規近似・ワーストケース・RSS の答えを確かめる
//   - 正規分布の和：和も正規分布。規格を平均 ± kσ に置けば、規格外れ率は正規分布の裾の確率（標準値）になる
//   - 一様分布の和：Irwin–Hall 分布。和の累積分布関数が多項式で正確に求まる
//   - 三角分布：裾の確率が (h − a)² / (2h²) で求まる
'use strict';
const E = require('../src/engine.js');

let n = 0; const fails = [];
function close(name, got, exp, tol) {
  n++;
  if (!(Math.abs(got - exp) <= tol)) fails.push(`${name}: 計算 ${got} / 正解 ${exp}（許容 ±${tol}）`);
}
// モンテカルロの規格外れ率は二項分布のばらつきを持つ。正解との差が標準誤差の 5 倍以内なら合格
// （乱数の種は固定なので、結果は毎回同じ）
function mcPpm(name, gotPpm, p, N) {
  const se = Math.sqrt(p * (1 - p) / N) * 1e6;
  close(name, gotPpm, p * 1e6, Math.max(5 * se, 1e-9));
}
const N = 400000;
const dim = (h, coef, dist) => ({ type: 'dim', nom: 0, up: h, lo: -h, coef, dist });

// ---- 1. 正規分布の和 ----
// ±h を ±3σ とする正規分布の寸法 4 個。和の σ = √Σ(h/3)²、ワーストケースの半幅 = Σh、RSS の半幅 = √Σh²
// 規格を和の平均 ± kσ に置くと、両側の規格外れ率は 2(1 − Φ(k))。k = 3・4・5 の値は標準正規分布表の値
//   k = 3：2699.796 ppm（Cpk 1.00）、k = 4：63.342 ppm（Cpk 1.33）、k = 5：0.573 ppm（Cpk 1.67）
{
  const hs = [0.10, 0.05, 0.05, 0.04], coefs = [1, -1, -1, -1];
  const items = hs.map((h, i) => dim(h, coefs[i], 'normal'));
  const sd = Math.sqrt(hs.reduce((s, h) => s + (h / 3) ** 2, 0));
  const tails = [[3, 2699.796, 1.0], [4, 63.342, 4 / 3], [5, 0.573, 5 / 3]];
  for (const [k, ppm, cpk] of tails) {
    const r = E.analyze1D(items, { n: N, seed: 11, smin: -k * sd, smax: k * sd });
    close(`正規の和 σ`, r.sd, sd, 1e-15);
    close(`正規の和 ワーストケース半幅`, r.wcHalf, 0.24, 1e-15);
    close(`正規の和 RSS 半幅`, r.rssHalf, Math.sqrt(hs.reduce((s, h) => s + h * h, 0)), 1e-15);
    close(`正規の和 補正 RSS（×1.5）上限`, r.bdMax, 1.5 * r.rssHalf, 1e-15);
    close(`正規の和 ±${k}σ 出力の Cpk`, r.cpk, cpk, 1e-12);
    // 正規近似の ppm は、エンジンの累積分布関数の近似誤差（1.5×10⁻⁷ 以下）を見込んで ±0.3 ppm
    close(`正規の和 ±${k}σ 正規近似の規格外れ率`, r.ppmNormal, ppm, 0.3);
    mcPpm(`正規の和 ±${k}σ モンテカルロの規格外れ率`, r.mc.ppm, ppm / 1e6, N);
    close(`正規の和 モンテカルロの σ`, r.mc.sd, sd, 5 * sd / Math.sqrt(2 * (N - 1)));
  }
}

// ---- 2. 一様分布の和（Irwin–Hall 分布） ----
// ±1 の一様分布 m 個の和 S。T = (S + m) / 2 は 0〜1 の一様分布 m 個の和（Irwin–Hall 分布）で、
// P(T ≤ t) = (1/m!) Σ_{j=0}^{⌊t⌋} (−1)^j C(m, j) (t − j)^m
function irwinHallCdf(t, m) {
  if (t <= 0) return 0;
  if (t >= m) return 1;
  let s = 0, c = 1, f = 1;
  for (let j = 1; j <= m; j++) f *= j;
  for (let j = 0; j <= Math.floor(t); j++) { s += (j % 2 ? -1 : 1) * c * (t - j) ** m; c = c * (m - j) / (j + 1); }
  return s / f;
}
for (const m of [2, 3, 4, 6]) {
  const items = Array.from({ length: m }, () => dim(1, 1, 'uniform'));
  for (const frac of [0.5, 0.8]) {
    const lim = frac * m;                             // 規格 = ±（ワーストケースの frac 倍）
    const p = 2 * (1 - irwinHallCdf((lim + m) / 2, m));
    const r = E.analyze1D(items, { n: N, seed: 7, smin: -lim, smax: lim });
    close(`一様 ${m} 個の和 ワーストケース半幅`, r.wcHalf, m, 1e-15);
    close(`一様 ${m} 個の和 σ（= √(m/3)）`, r.sd, Math.sqrt(m / 3), 1e-15);
    mcPpm(`一様 ${m} 個の和 規格 ±${lim} のモンテカルロの規格外れ率`, r.mc.ppm, p, N);
  }
}
// 一様 2 個の和は三角分布になる（P(|S| > 1) = 1/4 がちょうど求まる）
{
  const r = E.analyze1D([dim(1, 1, 'uniform'), dim(1, -1, 'uniform')], { n: N, seed: 5, smin: -1, smax: 1 });
  mcPpm('一様 2 個の差 P(|S| > 1) = 0.25', r.mc.ppm, 0.25, N);
}

// ---- 3. 三角分布 ----
// ±h の三角分布で、|X| > a となる確率は (h − a)² / h²（片側 (h − a)² / (2h²) の 2 倍）。σ = h / √6
for (const a of [0.5, 0.8, 0.95]) {
  const h = 0.2, p = (h - a * h) ** 2 / h ** 2;
  const r = E.analyze1D([dim(h, 1, 'tri')], { n: N, seed: 9, smin: -a * h, smax: a * h });
  close(`三角分布 σ（= h/√6）`, r.sd, h / Math.sqrt(6), 1e-15);
  mcPpm(`三角分布 規格 ±${a}h のモンテカルロの規格外れ率`, r.mc.ppm, p, N);
}

// ---- 4. 平均がずれた正規分布（Cpk 指定） ----
// 公差 ±h、Cpk 指定、平均のずれ s のとき σ = (h − |s|) / (3 Cpk)。部品 1 個だけで公差を規格にすると、出力の Cpk は指定した Cpk に戻る
for (const [cpk, s] of [[1.33, 0], [1.67, 0.01], [1.0, -0.02]]) {
  const it = { type: 'dim', nom: 10, up: 0.05, lo: -0.05, coef: 1, dist: 'cpk', cpk, shift: s };
  const r = E.analyze1D([it], { n: 0, smin: 9.95, smax: 10.05 });
  close(`Cpk ${cpk}・ずれ ${s} 出力の Cpk`, r.cpk, cpk, 1e-12);
  close(`Cpk ${cpk}・ずれ ${s} σ`, r.sd, (0.05 - Math.abs(s)) / (3 * cpk), 1e-15);
}

if (fails.length) {
  console.log(`${n} 項目中 ${fails.length} 項目不一致`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`${n} 項目すべて解析解と一致`);
