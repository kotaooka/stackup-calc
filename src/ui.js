// ===== 画面 =====
const KEY = 'stackup-calc-v2', KEY_OLD = 'stackup-calc-v1';
const $ = id => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const fmt = v => (Math.abs(v) < 5e-10 ? 0 : v).toFixed(3);
const fmtT = v => String(+(+v).toFixed(4));     // 公差・係数の表示（末尾の0は付けない）
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const isNum = v => typeof v === 'number' && isFinite(v);
let drag = null;     // ドラッグ中の操作
const FIG = {};      // 直前に描いた図の座標系（ドラッグ位置を値に戻すのに使う）

// ---- 例題 ----
const SAMPLE1 = {
  items: [
    {type:'dim',  name:'ハウジング内幅', nom:50,  up:0.10, lo:-0.10, coef:1,  dist:'normal'},
    {type:'dim',  name:'部品A 幅',       nom:20,  up:0.05, lo:-0.05, coef:-1, dist:'normal'},
    {type:'dim',  name:'部品B 幅',       nom:20,  up:0.05, lo:-0.05, coef:-1, dist:'normal'},
    {type:'dim',  name:'スペーサ 厚さ',   nom:9.5, up:0.00, lo:-0.08, coef:-1, dist:'cpk', cpk:1.33},
    {type:'pos',  name:'取付穴の位置度',  t:0.1, mmc:true, sup:0.1, slo:0, coef:1, dist:'disc'},
    {type:'float',name:'締結の遊び',      hnom:6.2, hup:0.05, hlo:0, fnom:6, fup:0, flo:-0.05, coef:1, dist:'uniform'}
  ],
  spec: [{min:0.15, max:0.95}]
};
const SAMPLE2 = {
  vecs: [
    {name:'ブラケット',   ln:100,  lup:0.10, llo:-0.10, an:0,  aup:0.10, alo:-0.10, rel:false, dist:'normal'},
    {name:'アーム',       ln:50,   lup:0.05, llo:-0.05, an:90, aup:0.20, alo:-0.20, rel:true,  dist:'normal'},
    {name:'パネル',       ln:99.5, lup:0.10, llo:-0.10, an:90, aup:0.10, alo:-0.10, rel:true,  dist:'normal'},
    {name:'パネル端',     ln:49.8, lup:0.05, llo:-0.05, an:90, aup:0.10, alo:-0.10, rel:true,  dist:'normal'}
  ],
  phi: 0, tx: 0, ty: 0, names: ['すき間', '段差'],
  spec: [{min:0.2, max:0.8}, {min:-0.3, max:0.7}]
};
const DEF = {
  dim:   {nom:10, up:0.1, lo:-0.1, dist:'normal'},
  prof:  {t:0.1, dist:'normal'},
  pos:   {t:0.1, mmc:false, sup:0.1, slo:0, dist:'disc'},
  float: {hnom:6.6, hup:0.1, hlo:0, fnom:6, fup:0, flo:-0.1, dist:'uniform'}
};
const TYPE_NAME = {dim:'寸法', prof:'輪郭度など', pos:'位置度', float:'組付けの遊び'};
const DISTS = {
  dim:   [['normal','正規（±3σ）'],['uniform','一様'],['tri','三角'],['cpk','Cpk指定'],['meas','実測（平均・σ）']],
  prof:  [['normal','正規（±3σ）'],['uniform','一様'],['tri','三角'],['cpk','Cpk指定']],
  pos:   [['disc','円内一様'],['normal','正規（±3σ）']],
  float: [['uniform','一様']],
  vec:   [['normal','正規（±3σ）'],['uniform','一様'],['tri','三角'],['cpk','Cpk指定']]
};
const clone = o => JSON.parse(JSON.stringify(o));

// ---- 状態の読み書き ----
function freshState(){
  return {mode:'1d', n:100000, d1: clone(SAMPLE1), d2: clone(SAMPLE2)};
}
function load(){
  try {
    const s = localStorage.getItem(KEY);
    if (s) { const d = JSON.parse(s); const f = freshState(); return {...f, ...d, d1:{...f.d1, ...d.d1}, d2:{...f.d2, ...d.d2}}; }
    // 旧版（1次元・向き±1）のデータを引き継ぐ
    const o = localStorage.getItem(KEY_OLD);
    if (o) {
      const d = JSON.parse(o), f = freshState();
      f.d1 = {items: (d.rows || []).map(r => ({type:'dim', name:r.name, nom:r.nom, up:r.up, lo:r.lo, coef:r.dir, dist:'normal'})),
              spec: [{min: d.smin ?? null, max: d.smax ?? null}]};
      return f;
    }
  } catch(e) {}
  return null;
}
function save(){ try { localStorage.setItem(KEY, JSON.stringify(state)); } catch(e) {} }
let state = load() || freshState();

// ---- 入力欄の部品 ----
// cls に nl を付けた欄は、PC幅で2行目の値の列（5列目）から始める
const numF = (k, label, v, extra = '', cls = '') =>
  `<label class="fld ${cls}"><span>${label}</span><input type="number" step="any" data-k="${k}" value="${v ?? ''}" ${extra}></label>`;
const distSel = (kind, v) =>
  `<label class="fld"><span>分布</span><select data-k="dist" data-rebuild>${DISTS[kind].map(([k, t]) => `<option value="${k}"${k === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;

function itemHTML(it, i){
  const typeSel = `<label class="fld"><span>種類</span><select data-k="type" data-rebuild>${Object.entries(TYPE_NAME).map(([k, t]) => `<option value="${k}"${k === it.type ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
  let b = '';
  if (it.type === 'dim') {
    b += numF('nom', '基準寸法', it.nom) + numF('up', '上の許容差', it.up) + numF('lo', '下の許容差', it.lo);
  } else if (it.type === 'prof') {
    b += numF('t', '公差値 t', it.t, 'min="0"');
  } else if (it.type === 'pos') {
    b += numF('t', '位置度 φt', it.t, 'min="0"');
    b += `<label class="chk"><input type="checkbox" data-k="mmc" data-rebuild${it.mmc ? ' checked' : ''}> Ⓜ（最大実体公差方式）</label>`;
    if (it.mmc) b += numF('sup', 'サイズの上の許容差', it.sup, '', 'nl') + numF('slo', 'サイズの下の許容差', it.slo);
  } else if (it.type === 'float') {
    b += numF('hnom', '穴 基準寸法', it.hnom) + numF('hup', '穴 上の許容差', it.hup) + numF('hlo', '穴 下の許容差', it.hlo);
    b += numF('fnom', '軸・ボルト 基準寸法', it.fnom, '', 'nl') + numF('fup', '軸 上の許容差', it.fup) + numF('flo', '軸 下の許容差', it.flo);
  }
  if (it.dist === 'cpk') b += numF('cpk', 'Cpk', it.cpk, 'min="0.01"', it.type === 'dim' ? 'nl' : '');
  if (it.dist === 'meas') b += numF('mean', '実測の平均', it.mean, '', 'nl') + numF('sd', '実測の σ', it.sd, 'min="0"');
  b += `<div class="err1"></div>`;
  return `<div class="it" data-i="${i}">
    <div class="it-h">
      <label class="fld fld-name"><span>名称</span><input type="text" data-k="name" value="${esc(it.name)}"></label>
      ${typeSel}
      ${numF('coef', '係数', it.coef)}
      ${distSel(it.type, it.dist)}
      <button class="x" title="この項目を削除" data-del>✕</button>
    </div>
    <div class="it-b">${b}</div></div>`;
}
function vecHTML(v, i){
  return `<div class="it" data-i="${i}">
    <div class="it-h">
      <label class="fld fld-name"><span>名称</span><input type="text" data-k="name" value="${esc(v.name)}"></label>
      <label class="fld"><span>角度の基準</span><select data-k="rel"><option value="0"${v.rel ? '' : ' selected'}>x軸から</option><option value="1"${v.rel ? ' selected' : ''}>前から</option></select></label>
      ${v.dist === 'cpk' ? numF('cpk', 'Cpk', v.cpk, 'min="0.01"') : '<span></span>'}
      ${distSel('vec', v.dist)}
      <button class="x" title="このベクトルを削除" data-del>✕</button>
    </div>
    <div class="it-b">
      ${numF('ln', '長さ mm', v.ln)}${numF('lup', '長さ 上の許容差', v.lup)}${numF('llo', '長さ 下の許容差', v.llo)}
      ${numF('an', '角度 °', v.an, '', 'nl')}${numF('aup', '角度 上の許容差', v.aup)}${numF('alo', '角度 下の許容差', v.alo)}
      <div class="err1"></div>
    </div></div>`;
}
function renderInputs(){
  $('items').innerHTML = state.d1.items.map(itemHTML).join('');
  $('vecs').innerHTML = state.d2.vecs.map(vecHTML).join('');
  renderSpec();
  syncSettings();
}
function outNames(){ return state.mode === '1d' ? ['出力（すき間）'] : [state.d2.names[0] || '出力1', state.d2.names[1] || '出力2']; }
function specArr(){ return state.mode === '1d' ? state.d1.spec : state.d2.spec; }
function renderSpec(){
  const names = outNames();
  $('specBox').innerHTML = specArr().map((sp, o) =>
    `<div class="spec-o">${names.length > 1 ? `<div>${esc(names[o])}</div>` : ''}
     <div class="grid2"><div><label>下限</label><input type="number" step="any" data-o="${o}" data-s="min" value="${sp.min ?? ''}"></div>
     <div><label>上限</label><input type="number" step="any" data-o="${o}" data-s="max" value="${sp.max ?? ''}"></div></div></div>`).join('');
}
function syncSettings(){
  $('mcn').value = String(state.n);
  const set = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v ?? ''; };
  set('phi', state.d2.phi); set('tx', state.d2.tx); set('ty', state.d2.ty);
  set('on0', state.d2.names[0]); set('on1', state.d2.names[1]);
  document.body.className = state.mode === '1d' ? 'm1d' : 'm2d';
  $('tab1d').setAttribute('aria-pressed', state.mode === '1d');
  $('tab2d').setAttribute('aria-pressed', state.mode === '2d');
}
// 入力欄の値を状態に合わせる（作り直さずに値だけ入れ替える。ドラッグ中に使う）
function syncInputs(){
  const fill = (box, arr) => box.querySelectorAll('.it').forEach(el => {
    const o = arr[+el.dataset.i]; if (!o) return;
    el.querySelectorAll('input[data-k]').forEach(inp => {
      if (document.activeElement === inp || inp.type === 'checkbox') return;
      inp.value = o[inp.dataset.k] ?? '';
    });
    el.querySelectorAll('select[data-k=rel]').forEach(s => s.value = o.rel ? '1' : '0');
  });
  fill($('items'), state.d1.items); fill($('vecs'), state.d2.vecs);
  $('specBox').querySelectorAll('input').forEach(inp => {
    if (document.activeElement !== inp) inp.value = specArr()[+inp.dataset.o][inp.dataset.s] ?? '';
  });
}

// ---- 入力の取り込み（イベントは囲みにまとめて付ける） ----
function onInput(e, arr, rebuild){
  const el = e.target, row = el.closest('.it'); if (!row || !el.dataset.k) return;
  const o = arr[+row.dataset.i], k = el.dataset.k;
  if (el.type === 'checkbox') o[k] = el.checked;
  else if (el.type === 'number') o[k] = el.value === '' ? null : Number(el.value);
  else if (k === 'rel') o[k] = el.value === '1';
  else o[k] = el.value;
  if (k === 'type') {        // 種類を変えたら、その種類で使う欄に初期値を入れる
    for (const [kk, vv] of Object.entries(DEF[o.type])) if (o[kk] === undefined || o[kk] === null || kk === 'dist') o[kk] = vv;
  }
  if (k === 'dist' && o.dist === 'cpk' && !isNum(o.cpk)) o.cpk = 1.33;
  if (k === 'dist' && o.dist === 'meas') { if (!isNum(o.mean)) o.mean = o.nom + (o.up + o.lo) / 2; if (!isNum(o.sd)) o.sd = (o.up - o.lo) / 6; }
  save();
  if (el.hasAttribute('data-rebuild')) rebuild();
  calc();
}
$('items').addEventListener('input', e => onInput(e, state.d1.items, renderInputs));
$('items').addEventListener('change', e => { if (e.target.type === 'checkbox') onInput(e, state.d1.items, renderInputs); });
$('vecs').addEventListener('input', e => onInput(e, state.d2.vecs, renderInputs));
const onDel = (box, arr) => box.addEventListener('click', e => {
  if (!e.target.hasAttribute('data-del')) return;
  arr().splice(+e.target.closest('.it').dataset.i, 1); save(); renderInputs(); calc();
});
onDel($('items'), () => state.d1.items); onDel($('vecs'), () => state.d2.vecs);
document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
  const t = b.dataset.add;
  state.d1.items.push({type:t, name:'', coef:1, ...clone(DEF[t])}); save(); renderInputs(); calc();
});
$('addVec').onclick = () => { state.d2.vecs.push({name:'', ln:10, lup:0.05, llo:-0.05, an:0, aup:0.1, alo:-0.1, rel:true, dist:'normal'}); save(); renderInputs(); calc(); };
$('sample1').onclick = () => { state.d1 = clone(SAMPLE1); save(); renderInputs(); calc(); };
$('sample2').onclick = () => { state.d2 = clone(SAMPLE2); save(); renderInputs(); calc(); };
$('clear1').onclick = () => { if (confirm('寄与項目をすべて消しますか？')) { state.d1 = {items:[], spec:[{min:null, max:null}]}; save(); renderInputs(); calc(); } };
$('clear2').onclick = () => { if (confirm('ベクトルをすべて消しますか？')) { state.d2.vecs = []; save(); renderInputs(); calc(); } };
$('specBox').addEventListener('input', e => {
  const el = e.target; specArr()[+el.dataset.o][el.dataset.s] = el.value === '' ? null : Number(el.value); save(); calc();
});
['phi','tx','ty'].forEach(k => $(k).addEventListener('input', () => { state.d2[k] = $(k).value === '' ? 0 : Number($(k).value); save(); calc(); }));
['on0','on1'].forEach((k, o) => $(k).addEventListener('input', () => { state.d2.names[o] = $(k).value; save(); renderSpec(); calc(); }));
$('mcn').onchange = () => { state.n = Number($('mcn').value); save(); calc(); };
$('tab1d').onclick = () => { state.mode = '1d'; save(); syncSettings(); renderSpec(); calc(); };
$('tab2d').onclick = () => { state.mode = '2d'; save(); syncSettings(); renderSpec(); calc(); };

// ---- 入力のチェック（不備のある行は計算から外す） ----
function checkItem(it){
  const need = {dim:['nom','up','lo'], prof:['t'], pos: it.mmc ? ['t','sup','slo'] : ['t'], float:['hnom','hup','hlo','fnom','fup','flo']}[it.type];
  const bad = ['coef', ...need].filter(k => !isNum(it[k]));
  if (it.dist === 'cpk' && !(it.cpk > 0)) bad.push('cpk');
  if (it.dist === 'meas') { if (!isNum(it.mean)) bad.push('mean'); if (!(it.sd >= 0)) bad.push('sd'); }
  if (bad.length) return {bad, msg:'数値が未入力または不正'};
  if (it.type === 'dim' && it.up < it.lo) return {bad:['up'], msg:'上の許容差が下の許容差より小さい'};
  if ((it.type === 'prof' || it.type === 'pos') && it.t < 0) return {bad:['t'], msg:'公差値が負'};
  if (it.type === 'pos' && it.mmc && it.sup < it.slo) return {bad:['sup'], msg:'サイズの上の許容差が下より小さい'};
  if (it.type === 'float' && (it.hup < it.hlo || it.fup < it.flo)) return {bad:['hup','fup'], msg:'上の許容差が下の許容差より小さい'};
  return null;
}
function checkVec(v){
  const bad = ['ln','lup','llo','an','aup','alo'].filter(k => !isNum(v[k]));
  if (v.dist === 'cpk' && !(v.cpk > 0)) bad.push('cpk');
  if (bad.length) return {bad, msg:'数値が未入力または不正'};
  if (v.lup < v.llo) return {bad:['lup'], msg:'長さの上の許容差が下より小さい'};
  if (v.aup < v.alo) return {bad:['aup'], msg:'角度の上の許容差が下より小さい'};
  return null;
}
function markRows(box, arr, check){
  const ok = [], errs = [];
  box.querySelectorAll('.it').forEach(el => {
    const i = +el.dataset.i, o = arr[i], c = o ? check(o) : null;
    el.querySelectorAll('input[data-k]').forEach(inp => inp.classList.toggle('bad', !!c && c.bad.includes(inp.dataset.k)));
    el.querySelector('.err1').textContent = c ? c.msg : '';
    if (c) errs.push(i + 1); else ok.push(i);
  });
  return {ok, errs};
}

// ---- 計算と描画 ----
let last = null;   // 直前の計算結果
function calc(){
  const n = drag ? Math.min(state.n, 20000) : state.n;   // ドラッグ中は回数を減らして軽くする
  const names = outNames();
  $('dfigT0').textContent = `${names[0]}の分布と規格`;
  $('dfigT1').textContent = `${names[1] || ''}の分布と規格`;
  if (state.mode === '1d') {
    const {ok, errs} = markRows($('items'), state.d1.items, checkItem);
    $('rowErr').textContent = errs.length ? `${errs.join('・')} 行目は入力に不備があるため計算から外している` : '';
    if (!ok.length) { clearOut(); return; }
    const items = ok.map(i => ({...state.d1.items[i], name: state.d1.items[i].name || `項目${i + 1}`, idx: i}));
    const sp = state.d1.spec[0];
    const r = analyze1D(items, {n, seed: 1, smin: sp.min, smax: sp.max});
    last = {mode:'1d', items, outs:[r]};
    renderResults([r], names);
    const fw = figW('chainFig');
    $('chainFig').innerHTML = drawChain(items, r, fw, drag && drag.kind === 'nom' ? drag.frz : null);
    $('distFig0').innerHTML = drawDist(r, sp.min, sp.max, fw, 0, drag && drag.kind === 'spec' && drag.o === 0 ? drag.frz : null);
    renderContrib1(items, r);
  } else {
    const {ok, errs} = markRows($('vecs'), state.d2.vecs, checkVec);
    $('rowErr').textContent = errs.length ? `${errs.join('・')} 行目は入力に不備があるため計算から外している` : '';
    if (!ok.length) { clearOut(); return; }
    const vecs = ok.map(i => ({...state.d2.vecs[i], name: state.d2.vecs[i].name || `ベクトル${i + 1}`, idx: i}));
    const d = state.d2;
    const r = analyze2D(vecs, {n, seed: 1, phi: d.phi || 0, tx: d.tx || 0, ty: d.ty || 0, spec: d.spec});
    last = {mode:'2d', vecs, ...r};
    renderResults(r.outs, names);
    const fw = figW('vecFig');
    $('vecFig').innerHTML = drawVec(vecs, d, fw, drag && drag.kind === 'tip' ? drag.frz : null);
    [0, 1].forEach(o => $('distFig' + o).innerHTML = drawDist(r.outs[o], d.spec[o].min, d.spec[o].max, fw, o, drag && drag.kind === 'spec' && drag.o === o ? drag.frz : null));
    renderContrib2(vecs, r, names);
  }
}
function clearOut(){
  last = null;
  ['resBox','chainFig','vecFig','distFig0','distFig1','contrib','legend'].forEach(id => $(id).innerHTML = '');
}
// 画面幅に合わせて図の座標幅を決め、スマホでも文字が小さくなりすぎないようにする
function figW(id){ return Math.max(320, Math.min(640, $(id).clientWidth || $('distFig0').clientWidth || 640)); }

const ppmText = (p, n) => p === null || p === undefined ? '—'
  : p === 0 ? (n ? `0（${n.toLocaleString('ja-JP')}回中）` : '0')
  : p < 1 ? '1 ppm 未満' : `${Math.round(p).toLocaleString('ja-JP')} ppm`;
const VERDICT = {ok:'合格：ワーストケースでも規格内', warn:'条件付き：統計（±3σ）では規格内、ワーストケースでは規格外', ng:'不合格：統計（±3σ）でも規格外'};
function renderResults(outs, names){
  const col = f => outs.map(f).map(v => `<td>${v}</td>`).join('');
  const rng = (a, b) => `${fmt(a)} 〜 ${fmt(b)}`;
  const rows = [
    ['基準値 / 中心値', o => `${fmt(o.nom)} / ${fmt(o.center)}`],
    ['ワーストケース', o => `${rng(o.wcMin, o.wcMax)}<span class="sub">（±${fmt(o.wcHalf)}）</span>`, 'big'],
    ['統計 ±3σ', o => `${rng(o.stMin, o.stMax)}<span class="sub">（σ ${o.sd.toFixed(4)}）</span>`, 'big'],
    ['補正RSS ×1.5', o => rng(o.bdMin, o.bdMax)],
    ['モンテカルロ 99.73%', o => o.mc ? `${rng(o.mc.lo, o.mc.hi)}<span class="sub">（σ ${o.mc.sd.toFixed(4)}）</span>` : '—', 'big'],
    ['規格外れ率 MC / 正規近似', o => `${o.mc ? ppmText(o.mc.ppm, o.mc.ppm === 0 ? o.mc.n : 0) : '—'}<span class="sub"> / ${ppmText(o.ppmNormal)}</span>`]
  ];
  let h = `<table class="res"><thead><tr><th class="k"></th>${names.map(n => `<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>`;
  h += rows.map(([k, f, cls]) => `<tr${cls ? ` class="${cls}"` : ''}><td class="k">${k}</td>${col(f)}</tr>`).join('');
  h += '</tbody></table>';
  outs.forEach((o, i) => { if (o.verdict) h += `<div class="verdict ${o.verdict}">${outs.length > 1 ? esc(names[i]) + '　' : ''}${VERDICT[o.verdict]}</div>`; });
  const nonNormal = outs.some(o => o.mc && o.ppmNormal !== null && o.mc.ppm !== null && Math.abs(o.mc.ppm - o.ppmNormal) > Math.max(50, 0.3 * o.ppmNormal));
  if (nonNormal) h += `<p class="note">モンテカルロと正規近似の規格外れ率が大きく違う。一様分布や組付けの遊び、2次元の非線形の影響で、出力が正規分布から外れている。モンテカルロの値を優先して判断する。</p>`;
  $('resBox').innerHTML = h;
}

// ---- 寄与率 ----
function contribRow(label, sub, b1, b2, pct, drag){
  const w = v => `${Math.max(0, Math.min(1, v)) * 100}%`;
  return `<div class="item"${drag || ''}><span>${esc(label)}<span class="tol">${sub}</span></span>
    <span class="bars"><span class="bar" style="width:${w(b1)}"></span>${b2 === null ? '' : `<span class="bar b2" style="width:${w(b2)}"></span>`}</span>
    <span class="num">${(pct * 100).toFixed(1)}%</span></div>`;
}
function renderContrib1(items, r){
  $('legend').innerHTML = `<span><i style="background:var(--bar1)"></i>統計（分散の割合）</span><span><i style="background:var(--bar2)"></i>ワーストケース（|係数|×半幅 の割合）</span>`;
  const mx = Math.max(...r.contrib.map(c => Math.max(c.var, c.wc)), 1e-9);
  $('contrib').innerHTML = items.map((it, k) => {
    const c = r.contrib[k];
    const sub = `${TYPE_NAME[it.type]}　±${fmtT(c.h)}${Math.abs(c.a) !== 1 ? `　係数 ${fmtT(c.a)}` : ''}`;
    const dr = it.type === 'float' ? '' : ` data-drag="tol" data-i="${it.idx}"`;
    return contribRow(it.name, sub, c.var / mx, c.wc / mx, c.var, dr);
  }).join('');
}
function renderContrib2(vecs, r, names){
  $('legend').innerHTML = `<span><i style="background:var(--bar1)"></i>${esc(names[0])}（分散の割合）</span><span><i style="background:var(--bar2)"></i>${esc(names[1])}（分散の割合）</span>`;
  const c0 = r.outs[0].contrib, c1 = r.outs[1].contrib;
  const mx = Math.max(...c0.map(c => c.var), ...c1.map(c => c.var), 1e-9);
  let h = '';
  vecs.forEach((v, i) => {
    [['l', '長さ', 'mm'], ['a', '角度', '°']].forEach(([p, t, u], j) => {
      const k = 2 * i + j;
      const sub = `±${fmtT(c0[k].h)}${u}　感度 ${fmtT(c0[k].a)} / ${fmtT(c1[k].a)}`;
      h += contribRow(`${v.name} ${t}`, sub, c0[k].var / mx, c1[k].var / mx, c0[k].var, ` data-drag="tol2" data-i="${v.idx}" data-p="${p}"`);
    });
  });
  $('contrib').innerHTML = h;
}

// ===== 図 =====
// 目盛りの刻みを 1・2・5 の倍数に丸める
function niceStep(x){
  if (!(x > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
function decOf(step){ return Math.max(0, -Math.floor(Math.log10(step) + 1e-9)); }
const arrowDefs = cs => `<defs>${cs.map(c =>
  `<marker id="ah-${c}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
     <path d="M0,0L10,5L0,10z" style="fill:var(--${c})"/></marker>`).join('')}</defs>`;
// 文字幅の概算（全角1文字≒12px）
const textW = s => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 12 : 7), 0);

// 1次元の寸法チェーン図：寸法の項目を 係数×基準寸法 の矢印でつなぐ
function drawChain(items, r, W = 640, frz = null){
  const dims = items.filter(it => it.type === 'dim');
  const L = 16, R = 16, rowH = 34, top = 26;
  let cum = 0;
  const segs = dims.map(q => { const x0 = cum; cum += q.coef * q.nom; return {q, x0, x1: cum}; });
  const xs = [0, ...segs.map(s => s.x1)];
  const minX = frz ? frz.minX : Math.min(...xs), maxX = frz ? frz.maxX : Math.max(...xs);
  const sx = (W - L - R) / ((maxX - minX) || 1);
  const X = v => L + (v - minX) * sx;
  const H = top + (dims.length + 1) * rowH + 14;
  FIG.chain = {minX, maxX, sx, L, x0: Object.fromEntries(segs.map(s => [s.q.idx, s.x0]))};
  let g = arrowDefs(['acc', 'warn', 'ok']);
  g += `<line x1="${X(0)}" y1="${top-14}" x2="${X(0)}" y2="${H-8}" style="stroke:var(--sub)" stroke-width="1.2"/>`;
  g += `<text x="${X(0)}" y="${top-17}" text-anchor="middle" font-size="12" style="fill:var(--sub)">基準 0</text>`;
  segs.forEach((s, i) => {
    const y = top + i * rowH + 18, c = s.q.coef >= 0 ? 'acc' : 'warn';
    g += `<line x1="${X(s.x1)}" y1="${y-6}" x2="${X(s.x1)}" y2="${y+rowH-12}" style="stroke:var(--line)" stroke-dasharray="3 3"/>`;
    g += `<line x1="${X(s.x0)}" y1="${y}" x2="${X(s.x1)}" y2="${y}" style="stroke:var(--${c})" stroke-width="2.4" marker-end="url(#ah-${c})"/>`;
    const a = s.q.coef, lbl = `${s.q.name}  ${a >= 0 ? '＋' : '−'}${Math.abs(a) === 1 ? '' : fmtT(Math.abs(a)) + '×'}${s.q.nom}`;
    const lw = textW(lbl), cx = Math.min(Math.max((X(s.x0) + X(s.x1)) / 2, lw / 2 + 2), W - lw / 2 - 2);
    g += `<text x="${cx}" y="${y-7}" text-anchor="middle" font-size="12" style="fill:var(--fg)" pointer-events="none">${esc(lbl)}</text>`;
    g += `<line x1="${X(s.x0)}" y1="${y}" x2="${X(s.x1)}" y2="${y}" stroke="transparent" stroke-width="16" data-drag="dir" data-i="${s.q.idx}"/>`;
    g += `<circle class="h-ring" cx="${X(s.x1)}" cy="${y}" r="5.5" style="stroke:var(--${c})" pointer-events="none"/>`;
    g += `<circle cx="${X(s.x1)}" cy="${y}" r="14" fill="transparent" data-drag="nom" data-i="${s.q.idx}"/>`;
  });
  const yg = top + dims.length * rowH + 18, gx0 = X(0), gx1 = X(cum);
  if (Math.abs(gx1 - gx0) > 2) g += `<line x1="${gx0}" y1="${yg}" x2="${gx1}" y2="${yg}" style="stroke:var(--ok)" stroke-width="2.8" marker-end="url(#ah-ok)"/>`;
  else g += `<circle cx="${gx0}" cy="${yg}" r="3.5" style="fill:var(--ok)"/>`;
  const lbl = `寸法だけの合計 ${fmt(cum)}（全体の基準値 ${fmt(r.nom)}）`;
  const anchor = Math.max(gx0, gx1) + 8 + textW(lbl) > W ? 'end' : 'start';
  g += `<text x="${anchor === 'end' ? Math.max(Math.min(gx0, gx1) - 8, textW(lbl)) : Math.max(gx0, gx1) + 8}" y="${yg+4}" text-anchor="${anchor}" font-size="12.5" font-weight="600" style="fill:var(--ok)">${lbl}</text>`;
  return `<svg xmlns="${SVGNS}" viewBox="0 0 ${W} ${H}" role="img" aria-label="寸法チェーン図">${g}</svg>`;
}

// 出力の分布図：モンテカルロのヒストグラム、統計（正規）の曲線、各方式の範囲、規格線
function drawDist(r, smin, smax, W = 640, o = 0, frz = null){
  const narrow = W < 440, L = narrow ? 52 : 100, R = 16, curveTop = 30, curveH = 96;
  const y1 = curveTop + curveH + 24, y2 = y1 + 22, y3 = y2 + 22, yAxis = y3 + 22, H = yAxis + 22;
  let lo = Math.min(r.wcMin, r.stMin), hi = Math.max(r.wcMax, r.stMax);
  if (r.mc) { lo = Math.min(lo, r.mc.lo); hi = Math.max(hi, r.mc.hi); }
  if (smin !== null && smin !== undefined) lo = Math.min(lo, smin);
  if (smax !== null && smax !== undefined) hi = Math.max(hi, smax);
  let span = hi - lo; if (!(span > 0)) span = Math.abs(r.center) * 0.1 || 1;
  lo -= span * 0.08; hi += span * 0.08;
  if (frz) { lo = frz.lo; hi = frz.hi; }
  FIG['dist' + o] = {lo, hi, L, R, W};
  const X = v => L + (v - lo) / (hi - lo) * (W - L - R);
  let g = '', hit = '';
  const hasMin = smin !== null && smin !== undefined, hasMax = smax !== null && smax !== undefined;
  if (hasMin || hasMax) {
    const a = hasMin ? X(smin) : L, b = hasMax ? X(smax) : W - R;
    g += `<rect x="${Math.max(L, a)}" y="${curveTop-6}" width="${Math.max(0, Math.min(W - R, b) - Math.max(L, a))}" height="${y3+10-curveTop+6}" style="fill:var(--ok)" opacity="0.08"/>`;
  }
  // ヒストグラムと正規曲線（同じ密度の目盛りで描く）
  const NB = narrow ? 36 : 56, bw = (hi - lo) / NB;
  let hist = null, hmax = 0;
  if (r.mc) {
    hist = new Array(NB).fill(0);
    for (const v of r.mc.sorted) { const k = Math.floor((v - lo) / bw); if (k >= 0 && k < NB) hist[k]++; }
    hist = hist.map(c => c / (r.mc.n * bw)); hmax = Math.max(...hist);
  }
  const pk = r.sd > 0 ? 1 / (r.sd * Math.sqrt(2 * Math.PI)) : 0;
  const ymax = Math.max(hmax, pk) || 1;
  const Y = d => curveTop + curveH - d / ymax * curveH;
  if (hist) hist.forEach((d, k) => {
    if (d <= 0) return;
    g += `<rect x="${X(lo + k * bw) + 0.5}" y="${Y(d)}" width="${Math.max(0.5, X(lo + (k + 1) * bw) - X(lo + k * bw) - 1)}" height="${curveTop + curveH - Y(d)}" style="fill:var(--pur)" opacity="0.35"/>`;
  });
  if (r.sd > 0) {
    let path = '';
    for (let k = 0; k <= 160; k++) {
      const v = lo + (hi - lo) * k / 160;
      const d = Math.exp(-0.5 * ((v - r.mean) / r.sd) ** 2) * pk;
      path += (k ? 'L' : 'M') + X(v).toFixed(1) + ',' + Y(d).toFixed(1);
    }
    g += `<path d="${path}" fill="none" style="stroke:var(--acc)" stroke-width="1.8"/>`;
  }
  g += `<line x1="${L}" y1="${curveTop+curveH}" x2="${W-R}" y2="${curveTop+curveH}" style="stroke:var(--line)"/>`;
  g += `<text x="${L-8}" y="${curveTop+12}" text-anchor="end" font-size="11" style="fill:var(--pur)">${r.mc ? 'MC' : ''}</text>`;
  g += `<text x="${L-8}" y="${curveTop+28}" text-anchor="end" font-size="11" style="fill:var(--acc)">${narrow ? '正規' : '正規近似'}</text>`;
  const bar = (y, mn, mx, label, c) =>
    `<text x="${L-8}" y="${y+4}" text-anchor="end" font-size="11.5" style="fill:var(--sub)">${label}</text>
     <line x1="${X(mn)}" y1="${y}" x2="${X(mx)}" y2="${y}" style="stroke:var(--${c})" stroke-width="6" stroke-linecap="round"/>
     <text x="${X(mn)}" y="${y-6}" text-anchor="middle" font-size="10.5" style="fill:var(--sub)">${fmt(mn)}</text>
     <text x="${X(mx)}" y="${y-6}" text-anchor="middle" font-size="10.5" style="fill:var(--sub)">${fmt(mx)}</text>`;
  if (r.mc) g += bar(y1, r.mc.lo, r.mc.hi, narrow ? 'MC' : 'モンテカルロ', 'pur');
  g += bar(y2, r.stMin, r.stMax, narrow ? '統計' : '統計 ±3σ', 'acc');
  g += bar(y3, r.wcMin, r.wcMax, narrow ? 'WC' : 'ワーストケース', 'warn');
  g += `<line x1="${X(r.center)}" y1="${curveTop}" x2="${X(r.center)}" y2="${y3+10}" style="stroke:var(--fg)" stroke-width="1"/>`;
  [[smin, '下限', 'min'], [smax, '上限', 'max']].forEach(([v, t, side]) => {
    if (v === null || v === undefined) return;
    g += `<line x1="${X(v)}" y1="${curveTop-6}" x2="${X(v)}" y2="${y3+10}" style="stroke:var(--ok)" stroke-dasharray="5 3" stroke-width="1.4"/>`;
    g += `<text x="${X(v)}" y="${curveTop-11}" text-anchor="middle" font-size="11" style="fill:var(--ok)">${t} ${fmt(v)}</text>`;
    g += `<circle class="h-ring" cx="${X(v)}" cy="${y3+10}" r="5" style="stroke:var(--ok)"/>`;
    // 下限と上限が近いときは、つかむ範囲が重ならないよう外側に寄せる
    const half = hasMin && hasMax ? Math.min(12, Math.abs(X(smax) - X(smin)) / 2) : 12;
    const hx = side === 'min' ? X(v) - 12 : X(v) - half;
    hit += `<rect x="${hx}" y="${curveTop-24}" width="${12 + half}" height="${y3+24-curveTop+24}" fill="transparent" data-drag="spec" data-o="${o}" data-s="${side}"/>`;
  });
  const step = niceStep((hi - lo) / (narrow ? 5 : 7)), d = decOf(step);
  g += `<line x1="${L}" y1="${yAxis}" x2="${W-R}" y2="${yAxis}" style="stroke:var(--sub)"/>`;
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) {
    g += `<line x1="${X(v)}" y1="${yAxis}" x2="${X(v)}" y2="${yAxis+4}" style="stroke:var(--sub)"/>`;
    g += `<text x="${X(v)}" y="${yAxis+15}" text-anchor="middle" font-size="10.5" style="fill:var(--sub)">${(Math.abs(v) < step / 1e6 ? 0 : v).toFixed(d)}</text>`;
  }
  return `<svg xmlns="${SVGNS}" viewBox="0 0 ${W} ${H}" role="img" aria-label="出力の分布と規格">${g}${hit}</svg>`;
}

// 2次元のベクトル図：基準値でベクトルをつなぎ、目標点と測定方向を示す
function drawVec(vecs, d, W = 640, frz = null){
  const p = []; vecs.forEach(v => p.push(v.ln, v.an));
  const pts = loopPoints(vecs, p);
  const tx = d.tx || 0, ty = d.ty || 0;
  // 拡大図の置き場所：広い図では右側、狭い図では下側に専用の場所をとる
  const wide = W >= 520, pad = 34;
  const iw = wide ? Math.round(W * 0.34) : W - 12, ih = wide ? Math.round(W * 0.36) : 150;
  const pw = wide ? W - iw - 18 : W, ph = Math.round(W * (wide ? 0.6 : 0.62));
  const H = wide ? ph : ph + ih + 10;
  let mp;
  if (frz) mp = frz;
  else {
    const xs = [...pts.map(q => q.x), tx], ys = [...pts.map(q => q.y), ty];
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const s = Math.min((pw - 2 * pad) / ((x1 - x0) || 1), (ph - 2 * pad) / ((y1 - y0) || 1));
    mp = {s, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2};
  }
  FIG.vec = {...mp, W, H, pw, ph, pts};
  const X = x => pw / 2 + (x - mp.cx) * mp.s, Y = y => ph / 2 - (y - mp.cy) * mp.s;   // y は上向き
  let g = arrowDefs(['acc', 'ok', 'warn']);
  // 原点
  g += `<circle cx="${X(0)}" cy="${Y(0)}" r="4" style="fill:var(--sub)"/><text x="${X(0)+6}" y="${Y(0)+14}" font-size="11" style="fill:var(--sub)">原点</text>`;
  // 測定方向（目標点から）
  const f = (d.phi || 0) * Math.PI / 180, al = Math.min(W, H) * 0.16;
  const ax = [[Math.cos(f), Math.sin(f), d.names[0] || '出力1', 'ok'], [-Math.sin(f), Math.cos(f), d.names[1] || '出力2', 'warn']];
  ax.forEach(([ux, uy, t, c]) => {
    g += `<line x1="${X(tx)}" y1="${Y(ty)}" x2="${X(tx) + ux * al}" y2="${Y(ty) - uy * al}" style="stroke:var(--${c})" stroke-width="1.6" stroke-dasharray="4 3" marker-end="url(#ah-${c})"/>`;
    g += `<text x="${X(tx) + ux * (al + 12)}" y="${Y(ty) - uy * (al + 12) + 4}" text-anchor="middle" font-size="11" style="fill:var(--${c})">${esc(t)}</text>`;
  });
  g += `<path d="M${X(tx)-5},${Y(ty)-5}L${X(tx)+5},${Y(ty)+5}M${X(tx)-5},${Y(ty)+5}L${X(tx)+5},${Y(ty)-5}" style="stroke:var(--fg)" stroke-width="1.6"/>`;
  g += `<text x="${Math.max(X(tx) - 8, textW('目標点') + 2)}" y="${Y(ty)-8}" text-anchor="end" font-size="11" style="fill:var(--fg)">目標点</text>`;
  // ベクトル
  vecs.forEach((v, i) => {
    const a = pts[i], b = pts[i + 1];
    g += `<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" style="stroke:var(--acc)" stroke-width="2.4" marker-end="url(#ah-acc)"/>`;
    const mx = (X(a.x) + X(b.x)) / 2, my = (Y(a.y) + Y(b.y)) / 2;
    // ベクトルの左側に名前を置く
    const nx = -(Y(b.y) - Y(a.y)), ny = X(b.x) - X(a.x), nl = Math.hypot(nx, ny) || 1;
    const lbl = `${v.name} ${v.ln}`;
    const lx = Math.min(Math.max(mx + nx / nl * 12, textW(lbl) / 2 + 2), W - textW(lbl) / 2 - 2);
    g += `<text x="${lx}" y="${my + ny / nl * 12 + 4}" text-anchor="middle" font-size="11.5" style="fill:var(--fg)" pointer-events="none">${esc(lbl)}</text>`;
    g += `<circle class="h-ring" cx="${X(b.x)}" cy="${Y(b.y)}" r="5.5" style="stroke:var(--acc)" pointer-events="none"/>`;
  });
  g += drawInset(pts, d, wide ? W - iw - 6 : 6, wide ? (H - ih) / 2 : ph + 4, iw, ih, mp.s);
  // つかむ範囲は最後に重ねる
  vecs.forEach((v, i) => { const b = pts[i + 1]; g += `<circle cx="${X(b.x)}" cy="${Y(b.y)}" r="15" fill="transparent" data-drag="tip" data-i="${v.idx}" data-k="${i}"/>`; });
  return `<svg xmlns="${SVGNS}" viewBox="0 0 ${W} ${H}" role="img" aria-label="ベクトル図">${g}</svg>`;
}

// 目標点付近の拡大図：全体図では見えない小さなすき間・段差を、終点と目標点の関係として示す
function drawInset(pts, d, ox, oy, iw, ih, s0){
  const tx = d.tx || 0, ty = d.ty || 0, end = pts[pts.length - 1];
  const f = (d.phi || 0) * Math.PI / 180, ux = Math.cos(f), uy = Math.sin(f);
  const dx = end.x - tx, dy = end.y - ty;
  const g1 = dx * ux + dy * uy, g2 = -dx * uy + dy * ux;           // 出力1・出力2（基準値）
  const ext = Math.max(Math.abs(dx), Math.abs(dy), 1e-6);
  const s = Math.min(iw, ih) * 0.32 / ext;
  const cx = ox + iw / 2, cy = oy + ih / 2 + 6;
  const P = (x, y) => [cx + (x - tx) * s, cy - (y - ty) * s];
  let g = `<rect x="${ox}" y="${oy}" width="${iw}" height="${ih}" rx="6" style="fill:var(--card);stroke:var(--line)"/>`;
  const mag = s / s0;
  g += `<text x="${ox + 8}" y="${oy + 15}" font-size="11" style="fill:var(--sub)">目標点付近の拡大（約 ${mag >= 10 ? Math.round(mag).toLocaleString('ja-JP') : mag.toPrecision(2)} 倍）</text>`;
  const al = Math.min(iw, ih) * 0.4;
  [[ux, uy, 'ok', g1, d.names[0] || '出力1'], [-uy, ux, 'warn', g2, d.names[1] || '出力2']].forEach(([ax, ay, c, val, t]) => {
    const [x0, y0] = P(tx, ty);
    g += `<line x1="${x0 - ax * al * 0.5}" y1="${y0 + ay * al * 0.5}" x2="${x0 + ax * al}" y2="${y0 - ay * al}" style="stroke:var(--${c})" stroke-width="1.2" stroke-dasharray="4 3" marker-end="url(#ah-${c})"/>`;
    // 終点からこの軸への垂線の足
    const [fx, fy] = P(tx + ax * val, ty + ay * val), [ex, ey] = P(end.x, end.y);
    g += `<line x1="${ex}" y1="${ey}" x2="${fx}" y2="${fy}" style="stroke:var(--${c})" stroke-width="1" opacity="0.7"/>`;
    g += `<line x1="${x0}" y1="${y0}" x2="${fx}" y2="${fy}" style="stroke:var(--${c})" stroke-width="3" opacity="0.8"/>`;
  });
  const [x0, y0] = P(tx, ty), [ex, ey] = P(end.x, end.y);
  g += `<path d="M${x0-4},${y0-4}L${x0+4},${y0+4}M${x0-4},${y0+4}L${x0+4},${y0-4}" style="stroke:var(--fg)" stroke-width="1.5"/>`;
  g += `<circle cx="${ex}" cy="${ey}" r="3.5" style="fill:var(--acc)"/>`;
  g += `<text x="${ox + 8}" y="${oy + ih - 22}" font-size="11.5" font-weight="600" style="fill:var(--ok)">${esc(d.names[0] || '出力1')} ${fmt(g1)}</text>`;
  g += `<text x="${ox + 8}" y="${oy + ih - 7}" font-size="11.5" font-weight="600" style="fill:var(--warn)">${esc(d.names[1] || '出力2')} ${fmt(g2)}</text>`;
  return g;
}

// ===== 図とグラフの直接操作 =====
const snap = (v, step) => +(Math.round(v / step) * step).toFixed(decOf(step) + 1);
function svgXY(el, e){
  const svg = el.querySelector('svg'); if (!svg) return {x: 0, y: 0};
  const rc = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
  return {x: (e.clientX - rc.left) * vb.width / rc.width, y: (e.clientY - rc.top) * vb.height / rc.height};
}
function applyDrag(e){
  const k = drag.kind;
  if (k === 'nom') {
    const q = state.d1.items[drag.i], c = FIG.chain;
    const v = c.minX + (svgXY(drag.el, e).x - c.L) / c.sx;
    const step = niceStep((drag.frz.maxX - drag.frz.minX || 1) / 400);
    if (q.coef !== 0) q.nom = Math.max(0, snap((v - drag.start) / q.coef, step));
  } else if (k === 'spec') {
    const f = FIG['dist' + drag.o], sp = specArr()[drag.o];
    const v = f.lo + (svgXY(drag.el, e).x - f.L) / (f.W - f.L - f.R) * (f.hi - f.lo);
    const step = niceStep((f.hi - f.lo) / 300);
    let x = snap(v, step);
    if (drag.s === 'min' && isNum(sp.max)) x = Math.min(x, snap(sp.max - step, step));
    if (drag.s === 'max' && isNum(sp.min)) x = Math.max(x, snap(sp.min + step, step));
    sp[drag.s] = x;
  } else if (k === 'tol' || k === 'tol2') {
    // 右へ動かすと公差幅が広がる（120px で約 e 倍）。中心は保つ
    const dx = e.clientX - drag.x0;
    let h = drag.h0 > 0 ? drag.h0 * Math.exp(dx / 120) : Math.max(0, dx) * 1e-3;
    h = Math.max(0, snap(h, niceStep(Math.max(h, 1e-4) / 50)));
    const o = drag.obj, [ku, kl, kt] = drag.keys;
    if (kt) o[kt] = +(2 * h).toFixed(4);
    else { o[ku] = +(drag.c0 + h).toFixed(4); o[kl] = +(drag.c0 - h).toFixed(4); }
  } else if (k === 'tip') {
    // 終点の位置 → 長さと角度（「前から」なら前のベクトルの向きとの差）
    const m = FIG.vec, pt = svgXY(drag.el, e);
    const px = m.cx + (pt.x - m.pw / 2) / m.s, py = m.cy - (pt.y - m.ph / 2) / m.s;
    const a = drag.start, v = state.d2.vecs[drag.i];
    const len = Math.hypot(px - a.x, py - a.y);
    let ang = Math.atan2(py - a.y, px - a.x) * 180 / Math.PI;
    if (v.rel) ang -= drag.prevTh * 180 / Math.PI;
    ang = ((ang + 540) % 360) - 180;
    v.ln = snap(len, niceStep(drag.span / 400));
    v.an = snap(ang, 0.1);
  }
  syncInputs(); calc();
}
function startDrag(e, el){
  const t = e.target.closest('[data-drag]'); if (!t) return;
  const kind = t.dataset.drag, i = Number(t.dataset.i);
  drag = {kind, i, el, x0: e.clientX, y0: e.clientY, moved: false};
  if (kind === 'nom') { drag.frz = {minX: FIG.chain.minX, maxX: FIG.chain.maxX}; drag.start = FIG.chain.x0[i]; }
  if (kind === 'spec') { drag.o = +t.dataset.o; drag.s = t.dataset.s; const f = FIG['dist' + drag.o]; drag.frz = {lo: f.lo, hi: f.hi}; }
  if (kind === 'tol') {
    const q = state.d1.items[i]; drag.obj = q;
    if (q.type === 'dim') { drag.keys = ['up', 'lo']; drag.h0 = (q.up - q.lo) / 2; drag.c0 = (q.up + q.lo) / 2; }
    else { drag.keys = [null, null, 't']; drag.h0 = q.t / 2; }
  }
  if (kind === 'tol2') {
    const v = state.d2.vecs[i], p = t.dataset.p; drag.obj = v;
    drag.keys = p === 'l' ? ['lup', 'llo'] : ['aup', 'alo'];
    drag.h0 = (v[drag.keys[0]] - v[drag.keys[1]]) / 2; drag.c0 = (v[drag.keys[0]] + v[drag.keys[1]]) / 2;
  }
  if (kind === 'tip') {
    const m = FIG.vec, kk = +t.dataset.k;
    drag.frz = {s: m.s, cx: m.cx, cy: m.cy};
    drag.start = m.pts[kk]; drag.prevTh = kk > 0 ? m.pts[kk].th : 0;
    drag.span = Math.max(m.pw, m.ph) / m.s;
  }
  el.setPointerCapture(e.pointerId);
  e.preventDefault();
}
function bindDrag(id){
  const el = $(id);
  el.addEventListener('pointerdown', e => startDrag(e, el));
  el.addEventListener('pointermove', e => {
    if (!drag || drag.el !== el) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
    drag.moved = true;
    if (drag.kind !== 'dir') applyDrag(e);
  });
  const end = cancel => {
    if (!drag || drag.el !== el) return;
    // 動かさずに離したら「タップ」：矢印なら係数の符号を反転
    if (!cancel && !drag.moved && drag.kind === 'dir') state.d1.items[drag.i].coef *= -1;
    drag = null; save(); syncInputs(); calc();
  };
  el.addEventListener('pointerup', () => end(false));
  el.addEventListener('pointercancel', () => end(true));
}
['chainFig', 'vecFig', 'distFig0', 'distFig1', 'contrib'].forEach(bindDrag);

// ---- 保存 ----
$('exp').onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'stackup.json'; a.click();
  URL.revokeObjectURL(a.href);
};
$('imp').onclick = () => $('file').click();
$('file').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text()), base = freshState();
    if (Array.isArray(d.rows)) {        // 旧版の書き出しファイル
      base.d1 = {items: d.rows.map(r => ({type:'dim', name:r.name, nom:r.nom, up:r.up, lo:r.lo, coef:r.dir, dist:'normal'})), spec:[{min:d.smin ?? null, max:d.smax ?? null}]};
      state = base;
    } else if (d.d1 || d.d2) {
      state = {...base, ...d, d1: {...base.d1, ...d.d1}, d2: {...base.d2, ...d.d2}};
    } else throw 0;
    save(); renderInputs(); calc();
  } catch(_) { alert('読み込めない形式です'); }
  e.target.value = '';
};

renderInputs(); calc();
// 画面幅が変わったら図を描き直す
let rsz; addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(calc, 150); });
// ===== 画面ここまで =====
