// 検算用：例題をエンジンで計算し、結果を tests/out.json に書き出す（python tests/verify.py で照合する）
const E = require('../src/engine.js');
const fs = require('fs');
const C1 = [
  // 例1：寸法のみ・係数±1（従来の1次元）
  [{type:'dim',nom:50,up:.1,lo:-.1,coef:1,dist:'normal'},{type:'dim',nom:20,up:.05,lo:-.05,coef:-1,dist:'normal'},
   {type:'dim',nom:20,up:.05,lo:-.05,coef:-1,dist:'normal'},{type:'dim',nom:9.5,up:0,lo:-.08,coef:-1,dist:'normal'}],
  // 例2：感度係数・分布いろいろ（Cpk の平均のずれを含む）
  [{type:'dim',nom:30,up:.2,lo:-.1,coef:0.5,dist:'uniform'},{type:'dim',nom:12,up:.03,lo:-.03,coef:-1.2,dist:'tri'},
   {type:'dim',nom:8,up:.05,lo:-.05,coef:1,dist:'cpk',cpk:1.67,shift:0.012},{type:'dim',nom:5,up:.1,lo:-.1,coef:-1,dist:'meas',mean:5.02,sd:.015},
   {type:'prof',t:.2,coef:0.8,dist:'cpk',cpk:1.33,shift:-0.02}],
  // 例3：幾何公差と組付けの遊び
  [{type:'dim',nom:10,up:.1,lo:-.1,coef:1,dist:'normal'},{type:'prof',t:.3,coef:-1,dist:'normal'},
   {type:'pos',t:.2,mmc:true,sup:.15,slo:0,coef:1,dist:'disc'},{type:'pos',t:.1,mmc:false,coef:-1,dist:'normal'},
   {type:'float',hnom:6.6,hup:.12,hlo:0,fnom:6,fup:0,flo:-.1,coef:1}]
];
const V2 = [
  {ln:100,lup:.1,llo:-.1,an:0,aup:.1,alo:-.1,rel:false,dist:'normal'},
  {ln:50,lup:.05,llo:-.05,an:90,aup:.2,alo:-.2,rel:true,dist:'uniform'},
  {ln:99.5,lup:.1,llo:-.1,an:90,aup:.1,alo:-.1,rel:true,dist:'normal'},
  {ln:49.8,lup:.05,llo:-.05,an:90,aup:.1,alo:-.1,rel:true,dist:'tri'}
];
// 判定の例：[項目, 規格下限, 上限, 期待する判定]
const J = [
  [{type:'dim',nom:10,up:.1,lo:-.1,coef:1,dist:'meas',mean:10.3,sd:.01}, 9.9, 10.1, 'ng'],    // 実測の平均が公差外
  [{type:'dim',nom:10,up:.1,lo:-.1,coef:1,dist:'cpk',cpk:0.8}, 9.9, 10.1, 'ng'],              // Cpk < 1（±3σ が規格外）
  [{type:'dim',nom:10,up:.1,lo:-.1,coef:1,dist:'cpk',cpk:0.9}, 9.85, 10.15, 'warn'],          // Cpk < 1 だが統計では規格内
  [{type:'dim',nom:10,up:.1,lo:-.1,coef:1,dist:'uniform'}, 9.9, 10.1, 'ok'],                  // 一様（±3σ は公差を超えるが部品は公差内）
  [{type:'dim',nom:10,up:.1,lo:-.1,coef:1,dist:'normal'}, 9.95, 10.15, 'ng']                  // 統計でも規格外
];
const strip = r => ({...r, contrib: r.contrib.map(c => ({wc:c.wc, var:c.var})), mc: r.mc ? {...r.mc, sorted: undefined} : null});
// 逆算：目標を満たす倍率で公差を変えた結果を書き出し、Python 側で目標の境界にあることを確かめる
const AD = {items: [C1[0][0], C1[0][1], {type:'dim',nom:29.5,up:.05,lo:-.05,coef:-1,dist:'cpk',cpk:1.33,shift:0.01},
  {type:'pos',t:.06,mmc:false,coef:1,dist:'disc'}, {type:'float',hnom:6.2,hup:.02,hlo:0,fnom:6.15,fup:0,flo:-.02,coef:1}], spec:[{min:0.2, max:0.8}]};
const A2 = {vecs: V2, phi: 30, tx: 1, ty: -2, spec: [{min: 0.3, max: 1.1}, {min: 1.5, max: 2.8}]};
const alloc = [];
for (const [mode, data] of [['1d', AD], ['2d', A2]]) for (const target of [{type:'wc'}, {type:'cpk', cpk:1.33}]) {
  const a = E.allocate(mode, data, target);
  const scaled = a.uniform && a.uniform.k !== null ? E.scaleData(mode, data, a.vars, a.uniform.k).data : null;
  alloc.push({mode, target, k: a.uniform ? a.uniform.k : null, data, scaled,
              single: a.single.map(s => ({k: s.k, scaled: s.k !== null && !s.cap ? E.scaleData(mode, data, [{i: s.i, part: s.part}], s.k).data : null}))});
}
const out = {
  d1: C1.map(items => ({items, res: strip(E.analyze1D(items, {n: 400000, seed: 3, smin: null, smax: null}))})),
  d2: (() => { const opt = {n: 400000, seed: 3, phi: 30, tx: 1, ty: -2, spec: [{}, {}]}; const r = E.analyze2D(V2, opt);
               return {vecs: V2, opt, outs: r.outs.map(strip), sens: r.sens}; })(),
  judge: J.map(([it, lo, hi, exp]) => ({exp, got: E.analyze1D([it], {n: 200000, seed: 5, smin: lo, smax: hi}).verdict})),
  alloc
};
fs.writeFileSync(__dirname + '/out.json', JSON.stringify(out));
console.log('tests/out.json を書き出し');
