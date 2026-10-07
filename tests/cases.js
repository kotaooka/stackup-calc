// 検算用：エンジンで例題を計算し、結果を tests/out.json に書き出す（python tests/verify.py で照合する）
const E = require('../src/engine.js');
const fs = require('fs');
const C1 = [
  // 例1：寸法のみ・係数±1（従来の1次元）
  [{type:'dim',nom:50,up:.1,lo:-.1,coef:1,dist:'normal'},{type:'dim',nom:20,up:.05,lo:-.05,coef:-1,dist:'normal'},
   {type:'dim',nom:20,up:.05,lo:-.05,coef:-1,dist:'normal'},{type:'dim',nom:9.5,up:0,lo:-.08,coef:-1,dist:'normal'}],
  // 例2：感度係数・分布いろいろ
  [{type:'dim',nom:30,up:.2,lo:-.1,coef:0.5,dist:'uniform'},{type:'dim',nom:12,up:.03,lo:-.03,coef:-1.2,dist:'tri'},
   {type:'dim',nom:8,up:.05,lo:-.05,coef:1,dist:'cpk',cpk:1.67},{type:'dim',nom:5,up:.1,lo:-.1,coef:-1,dist:'meas',mean:5.02,sd:.015}],
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
const strip = r => ({...r, contrib: r.contrib.map(c => ({wc:c.wc, var:c.var})), mc: r.mc ? {...r.mc, sorted: undefined} : null});
const out = {
  d1: C1.map(items => ({items, res: strip(E.analyze1D(items, {n: 400000, seed: 3, smin: null, smax: null}))})),
  d2: (() => { const opt = {n: 400000, seed: 3, phi: 30, tx: 1, ty: -2, spec: [{}, {}]}; const r = E.analyze2D(V2, opt);
               return {vecs: V2, opt, outs: r.outs.map(strip), sens: r.sens}; })()
};
fs.writeFileSync(__dirname + '/out.json', JSON.stringify(out));
console.log('tests/out.json を書き出し');
