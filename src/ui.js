// ===== 画面 =====
const KEY = 'stackup-calc-v2', KEY_OLD = 'stackup-calc-v1', KEY_CASES = 'stackup-calc-cases';
const $ = id => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const fmt = v => (Math.abs(v) < 5e-10 ? 0 : v).toFixed(3);
const fmtT = v => String(+(+v).toFixed(4));     // 公差・係数の表示（末尾の0は付けない）
const sgn = v => (v >= 0 ? '+' : '−') + fmtT(Math.abs(v));   // 許容差の表示（符号付き）
const fmtCpk = v => v === null || v === undefined ? '—' : isFinite(v) ? v.toFixed(2) : (v > 0 ? '∞' : '−∞');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const isNum = v => typeof v === 'number' && isFinite(v);
const clone = o => JSON.parse(JSON.stringify(o));
let drag = null;     // 図の上でのドラッグ操作
let pal = null;      // パレットからのドラッグ操作
let sel = null;      // 選択中の寄与項目（状態の配列の番号）
const FIG = {};      // 直前に描いた図の座標系（ドラッグ位置を値に戻すのに使う）

// ---- 例題・初期値 ----
const SAMPLE1 = {
  items: [
    {type:'dim',  name:'ハウジング内幅', nom:50,  up:0.10, lo:-0.10, coef:1,  dist:'normal'},
    {type:'dim',  name:'部品A 幅',       nom:20,  up:0.05, lo:-0.05, coef:-1, dist:'normal'},
    {type:'dim',  name:'部品B 幅',       nom:20,  up:0.05, lo:-0.05, coef:-1, dist:'normal'},
    {type:'dim',  name:'スペーサ 厚さ',   nom:9.5, up:0.00, lo:-0.08, coef:-1, dist:'cpk', cpk:1.33, shift:0},
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
const NUMKEYS = {dim:['nom','up','lo'], prof:['t'], pos:['t','sup','slo'], float:['hnom','hup','hlo','fnom','fup','flo']};
const TYPE_NAME = {dim:'寸法', prof:'輪郭度など', pos:'位置度', float:'組付けの遊び'};
const DISTS = {
  dim:   [['normal','正規（±3σ）'],['uniform','一様'],['tri','三角'],['cpk','Cpk指定'],['meas','実測（平均・σ）']],
  prof:  [['normal','正規（±3σ）'],['uniform','一様'],['tri','三角'],['cpk','Cpk指定']],
  pos:   [['disc','円内一様'],['normal','正規（±3σ）']],
  float: [['uniform','一様']],
  vec:   [['normal','正規（±3σ）'],['uniform','一様'],['tri','三角'],['cpk','Cpk指定']]
};
const DIST_NAME = Object.fromEntries(Object.values(DISTS).flat());
const MC_N = [0, 10000, 100000, 1000000];

// ---- 状態の検証（保存データ・共有URL・JSON は必ずここを通す） ----
const N = v => isNum(v) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : null);
const S = (v, max = 60) => typeof v === 'string' ? v.slice(0, max) : '';
function sanItem(o){
  if (!o || typeof o !== 'object' || !TYPE_NAME[o.type]) return null;
  const it = {type: o.type, name: S(o.name), coef: N(o.coef) ?? 1};
  for (const k of NUMKEYS[o.type]) it[k] = k in o ? N(o[k]) : DEF[o.type][k];
  if (o.type === 'pos') it.mmc = !!o.mmc;
  it.dist = DISTS[o.type].some(([k]) => k === o.dist) ? o.dist : DEF[o.type].dist;
  for (const k of ['cpk', 'shift', 'mean', 'sd']) if (k in o) it[k] = N(o[k]);
  return it;
}
function sanVec(o){
  if (!o || typeof o !== 'object') return null;
  const v = {name: S(o.name), rel: !!o.rel};
  for (const k of ['ln','lup','llo','an','aup','alo']) v[k] = N(o[k]);
  v.dist = DISTS.vec.some(([k]) => k === o.dist) ? o.dist : 'normal';
  if ('cpk' in o) v.cpk = N(o.cpk);
  return v;
}
const sanSpec = (a, n) => Array.from({length: n}, (_, i) => { const s = (Array.isArray(a) && a[i]) || {}; return {min: N(s.min), max: N(s.max)}; });
function freshState(){
  return {mode:'1d', n:100000, d1: clone(SAMPLE1), d2: clone(SAMPLE2), alloc: {type:'cpk', cpk:1.33}};
}
// 旧版（1次元・向き±1）の形式を変換する
const fromV1 = d => ({mode:'1d', d1: {items: (d.rows || []).map(r => ({type:'dim', name:r.name, nom:r.nom, up:r.up, lo:r.lo, coef:r.dir, dist:'normal'})), spec:[{min:d.smin, max:d.smax}]}});
function sanitize(d){
  const f = freshState();
  if (!d || typeof d !== 'object') return {state: f, dropped: 0};
  if (Array.isArray(d.rows)) d = fromV1(d);
  let dropped = 0;
  const st = {mode: d.mode === '2d' ? '2d' : '1d', n: MC_N.includes(d.n) ? d.n : 100000, d1: f.d1, d2: f.d2, alloc: f.alloc};
  if (d.d1 && typeof d.d1 === 'object') {
    const its = (Array.isArray(d.d1.items) ? d.d1.items : []).map(sanItem);
    dropped += its.filter(x => !x).length;
    st.d1 = {items: its.filter(Boolean), spec: sanSpec(d.d1.spec, 1)};
  }
  if (d.d2 && typeof d.d2 === 'object') {
    const vs = (Array.isArray(d.d2.vecs) ? d.d2.vecs : []).map(sanVec);
    dropped += vs.filter(x => !x).length;
    const nm = Array.isArray(d.d2.names) ? d.d2.names : [];
    st.d2 = {vecs: vs.filter(Boolean), phi: N(d.d2.phi) ?? 0, tx: N(d.d2.tx) ?? 0, ty: N(d.d2.ty) ?? 0,
             names: [S(nm[0], 20) || 'すき間', S(nm[1], 20) || '段差'], spec: sanSpec(d.d2.spec, 2)};
  }
  if (d.alloc && typeof d.alloc === 'object') st.alloc = {type: d.alloc.type === 'wc' ? 'wc' : 'cpk', cpk: N(d.alloc.cpk) > 0 ? N(d.alloc.cpk) : 1.33};
  return {state: st, dropped};
}
function load(){
  try {
    const s = localStorage.getItem(KEY);
    if (s) return sanitize(JSON.parse(s));
    const o = localStorage.getItem(KEY_OLD);
    if (o) return sanitize(JSON.parse(o));
  } catch(e) { return {state: freshState(), dropped: 0, broken: true}; }
  return {state: freshState(), dropped: 0};
}
function save(){ try { localStorage.setItem(KEY, JSON.stringify(state)); } catch(e) {} }
const L0 = load();
let state = L0.state;

// ケースの一覧（入力の履歴とは別に保存する）
function sanCase(c){
  if (!c || typeof c !== 'object') return null;
  const mode = c.mode === '2d' ? '2d' : '1d';
  const st = sanitize({mode, [mode === '1d' ? 'd1' : 'd2']: c.data}).state;
  return {name: S(c.name, 40) || 'ケース', saved: S(c.saved, 40), mode, data: mode === '1d' ? st.d1 : st.d2};
}
function loadCases(){ try { const a = JSON.parse(localStorage.getItem(KEY_CASES) || '[]'); return Array.isArray(a) ? a.map(sanCase).filter(Boolean) : []; } catch(e) { return []; } }
function saveCases(){ try { localStorage.setItem(KEY_CASES, JSON.stringify(cases)); } catch(e) {} }
let cases = loadCases();

// ---- 元に戻す・やり直す ----
const snap = () => JSON.stringify({mode: state.mode, n: state.n, d1: state.d1, d2: state.d2, alloc: state.alloc});
let hist = [], hpos = -1, commitTimer = null;
function updUndo(){ $('undo').disabled = hpos <= 0 && !commitTimer; $('redo').disabled = hpos >= hist.length - 1; }
function commit(){
  clearTimeout(commitTimer); commitTimer = null;
  const j = snap();
  if (hist[hpos] !== j) {
    hist = hist.slice(0, hpos + 1); hist.push(j);
    if (hist.length > 200) hist.shift();
    hpos = hist.length - 1;
  }
  updUndo();
}
// 文字の入力は、手が止まってからまとめて1回分の履歴にする
function commitLater(){ clearTimeout(commitTimer); commitTimer = setTimeout(commit, 600); updUndo(); }
function restore(j){ state = sanitize(JSON.parse(j)).state; sel = null; save(); renderInputs(); calc(); }
function undo(){ if (commitTimer) commit(); if (hpos > 0) { hpos--; restore(hist[hpos]); } updUndo(); }
function redo(){ if (hpos < hist.length - 1) { hpos++; restore(hist[hpos]); } updUndo(); }
$('undo').onclick = undo; $('redo').onclick = redo;
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const t = e.target;
  // 入力欄の中ではブラウザ標準の取り消しを使う（その結果も入力として取り込まれる）
  if (t && ((t.tagName === 'INPUT' && t.type !== 'checkbox') || t.tagName === 'TEXTAREA')) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
});
function notice(msg){ $('noticeText').textContent = msg; $('notice').classList.add('on'); }
$('noticeClose').onclick = () => $('notice').classList.remove('on');

// ---- 入力欄 ----
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
  if (it.dist === 'cpk') b += numF('cpk', 'Cpk', it.cpk, 'min="0.01"', it.type === 'dim' ? 'nl' : '') + numF('shift', '平均のずれ', it.shift ?? 0);
  if (it.dist === 'meas') b += numF('mean', '実測の平均', it.mean, '', 'nl') + numF('sd', '実測の σ', it.sd, 'min="0"');
  b += `<div class="err1"></div>`;
  return `<div class="it${i === sel ? ' sel' : ''}" data-i="${i}">
    <div class="it-h">
      <label class="fld fld-name"><span>名称</span><input type="text" data-k="name" value="${esc(it.name)}" placeholder="項目${i + 1}"></label>
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
      <label class="fld fld-name"><span>名称</span><input type="text" data-k="name" value="${esc(v.name)}" placeholder="ベクトル${i + 1}"></label>
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
  if (sel !== null && !(sel < state.d1.items.length)) sel = null;
  $('items').innerHTML = state.d1.items.map(itemHTML).join('');
  $('vecs').innerHTML = state.d2.vecs.map(vecHTML).join('');
  renderSpec();
  syncSettings();
}
function outNames(mode = state.mode, d2 = state.d2){ return mode === '1d' ? ['出力（すき間）'] : [d2.names[0] || '出力1', d2.names[1] || '出力2']; }
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
  $('atype').value = state.alloc.type; set('acpk', state.alloc.cpk);
  $('acpkBox').style.visibility = state.alloc.type === 'wc' ? 'hidden' : 'visible';
  document.body.className = state.mode === '1d' ? 'm1d' : 'm2d';
  $('tab1d').setAttribute('aria-selected', state.mode === '1d');
  $('tab2d').setAttribute('aria-selected', state.mode === '2d');
}
// 入力欄の値を状態に合わせる（作り直さずに値だけ入れ替える。ドラッグ中に使う）
function syncInputs(){
  const fill = (box, arr) => box.querySelectorAll('.it').forEach(el => {
    const o = arr[+el.dataset.i]; if (!o) return;
    el.querySelectorAll('input[data-k]').forEach(inp => {
      if (document.activeElement === inp || inp.type === 'checkbox' || inp.type === 'text') return;
      inp.value = o[inp.dataset.k] ?? '';
    });
    el.querySelectorAll('select[data-k=rel]').forEach(s => s.value = o.rel ? '1' : '0');
    el.querySelectorAll('input[data-k=coef]').forEach(inp => { if (document.activeElement !== inp) inp.value = o.coef ?? ''; });
  });
  fill($('items'), state.d1.items); fill($('vecs'), state.d2.vecs);
  $('specBox').querySelectorAll('input').forEach(inp => {
    if (document.activeElement !== inp) inp.value = specArr()[+inp.dataset.o][inp.dataset.s] ?? '';
  });
}

// ---- 入力の取り込み ----
function onInput(e, arr){
  const el = e.target, row = el.closest('.it'); if (!row || !el.dataset.k) return;
  const o = arr[+row.dataset.i], k = el.dataset.k;
  if (!o) return;
  if (el.type === 'checkbox') o[k] = el.checked;
  else if (el.type === 'number') o[k] = el.value === '' ? null : Number(el.value);
  else if (k === 'rel') o[k] = el.value === '1';
  else o[k] = el.value;
  if (k === 'type') {        // 種類を変えたら、その種類で使う欄に初期値を入れる
    for (const [kk, vv] of Object.entries(DEF[o.type])) if (o[kk] === undefined || o[kk] === null || kk === 'dist') o[kk] = vv;
  }
  if (k === 'dist' && o.dist === 'cpk') { if (!isNum(o.cpk)) o.cpk = 1.33; if (!isNum(o.shift)) o.shift = 0; }
  if (k === 'dist' && o.dist === 'meas') { if (!isNum(o.mean)) o.mean = o.nom + (o.up + o.lo) / 2; if (!isNum(o.sd)) o.sd = (o.up - o.lo) / 6; }
  save();
  if (el.tagName === 'SELECT' || el.type === 'checkbox') commit(); else commitLater();
  if (el.hasAttribute('data-rebuild')) renderInputs();
  calc();
}
$('items').addEventListener('input', e => { if (e.target.type !== 'checkbox') onInput(e, state.d1.items); });
$('items').addEventListener('change', e => { if (e.target.type === 'checkbox') onInput(e, state.d1.items); });
$('vecs').addEventListener('input', e => onInput(e, state.d2.vecs));
$('items').addEventListener('focusin', e => { const row = e.target.closest('.it'); if (row && +row.dataset.i !== sel) setSel(+row.dataset.i, false); });
const onDel = (box, arr) => box.addEventListener('click', e => {
  if (!e.target.hasAttribute('data-del')) return;
  const i = +e.target.closest('.it').dataset.i;
  arr().splice(i, 1);
  if (box === $('items') && sel !== null) sel = sel === i ? null : sel > i ? sel - 1 : sel;
  commit(); save(); renderInputs(); calc();
});
onDel($('items'), () => state.d1.items); onDel($('vecs'), () => state.d2.vecs);
document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => addItem(b.dataset.add, null));
$('addVec').onclick = () => { state.d2.vecs.push({name:'', ln:10, lup:0.05, llo:-0.05, an:0, aup:0.1, alo:-0.1, rel:true, dist:'normal'}); commit(); save(); renderInputs(); calc(); };
$('sample1').onclick = () => { state.d1 = clone(SAMPLE1); sel = null; commit(); save(); renderInputs(); calc(); };
$('sample2').onclick = () => { state.d2 = clone(SAMPLE2); commit(); save(); renderInputs(); calc(); };
$('clear1').onclick = () => { state.d1 = {items:[], spec:[{min:null, max:null}]}; sel = null; commit(); save(); renderInputs(); calc(); notice('寄与項目をすべて消した。「元に戻す」で戻せる。'); };
$('clear2').onclick = () => { state.d2.vecs = []; commit(); save(); renderInputs(); calc(); notice('ベクトルをすべて消した。「元に戻す」で戻せる。'); };
$('specBox').addEventListener('input', e => {
  const el = e.target; specArr()[+el.dataset.o][el.dataset.s] = el.value === '' ? null : Number(el.value); save(); commitLater(); calc();
});
['phi','tx','ty'].forEach(k => $(k).addEventListener('input', () => { state.d2[k] = $(k).value === '' ? 0 : Number($(k).value); save(); commitLater(); calc(); }));
['on0','on1'].forEach((k, o) => $(k).addEventListener('input', () => { state.d2.names[o] = $(k).value; save(); commitLater(); renderSpec(); calc(); }));
$('mcn').onchange = () => { state.n = Number($('mcn').value); save(); commit(); calc(); };
$('tab1d').onclick = () => { state.mode = '1d'; save(); commit(); syncSettings(); renderSpec(); calc(); };
$('tab2d').onclick = () => { state.mode = '2d'; save(); commit(); syncSettings(); renderSpec(); calc(); };
// 表示テーマ（自動 / ライト / ダーク）。図は CSS 変数で描いているので描き直しは不要
{
  const THEMES = ['auto', 'light', 'dark'], LABEL = {auto: '表示：自動', light: '表示：ライト', dark: '表示：ダーク'};
  let theme = document.documentElement.dataset.theme || 'auto';
  const applyTheme = t => {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
    $('themeBtn').textContent = LABEL[t];
  };
  $('themeBtn').onclick = () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try { localStorage.setItem('stackup-calc-theme', theme); } catch (e) { /* 保存できなくても切り替えは効く */ }
    applyTheme(theme);
  };
  applyTheme(theme);
}
$('atype').onchange = () => { state.alloc.type = $('atype').value; save(); commit(); syncSettings(); renderAlloc(); };
$('acpk').addEventListener('input', () => { const v = Number($('acpk').value); if (v > 0) { state.alloc.cpk = v; save(); commitLater(); renderAlloc(); } });

// 寄与項目を追加する（kind：dim/prof/pos/float、パレットの pos=＋寸法・neg=−寸法・posit=位置度）
function addItem(kind, target){
  const t = {pos:'dim', neg:'dim', posit:'pos'}[kind] || kind;
  const it = {type: t, name: '', coef: kind === 'neg' ? -1 : 1, ...clone(DEF[t])};
  let at;
  if (t === 'dim' && target) { it.coef = target.row === 'p' ? 1 : -1; at = insertDim(it, target.row, target.before); }
  else if (t === 'dim' && (kind === 'pos' || kind === 'neg')) at = insertDim(it, kind === 'pos' ? 'p' : 'n', null);
  else { state.d1.items.push(it); at = state.d1.items.length - 1; }
  commit(); save(); renderInputs(); calc(); setSel(at, true);
}
// 寸法を段（p：＋側、n：−側）の指定位置に入れる。before は「この項目の前」（状態の配列の番号）
function insertDim(it, row, before){
  const arr = state.d1.items, toPos = row === 'p';
  let at;
  if (before !== null && before !== undefined) at = before;
  else {
    let lastI = -1;
    arr.forEach((o, k) => { if (o.type === 'dim' && ((o.coef ?? 1) >= 0) === toPos) lastI = k; });
    at = lastI >= 0 ? lastI + 1 : arr.length;
  }
  arr.splice(at, 0, it);
  return at;
}
function setSel(i, scroll){
  sel = i;
  document.querySelectorAll('#items .it').forEach(el => el.classList.toggle('sel', +el.dataset.i === i));
  if (scroll) {
    const el = document.querySelector(`#items .it[data-i="${i}"]`);
    if (el) { el.scrollIntoView({block: 'nearest', behavior: 'smooth'}); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }
  redrawBlocks();
}

// ---- 入力のチェック（不備のある行は計算から外す） ----
function checkItem(it){
  const bad = ['coef', ...NUMKEYS[it.type]].filter(k => !(it.type === 'pos' && !it.mmc && (k === 'sup' || k === 'slo')) && !isNum(it[k]));
  if (it.dist === 'cpk') { if (!(it.cpk > 0)) bad.push('cpk'); if (it.shift !== undefined && it.shift !== null && !isNum(it.shift)) bad.push('shift'); }
  if (it.dist === 'meas') { if (!isNum(it.mean)) bad.push('mean'); if (!(it.sd >= 0)) bad.push('sd'); }
  if (bad.length) return {bad, msg:'数値が未入力または不正'};
  if (it.type === 'dim' && it.up < it.lo) return {bad:['up'], msg:'上の許容差が下の許容差より小さい'};
  if ((it.type === 'prof' || it.type === 'pos') && it.t < 0) return {bad:['t'], msg:'公差値が負'};
  if (it.type === 'pos' && it.mmc && it.sup < it.slo) return {bad:['sup'], msg:'サイズの上の許容差が下より小さい'};
  if (it.type === 'float' && (it.hup < it.hlo || it.fup < it.flo)) return {bad:['hup','fup'], msg:'上の許容差が下の許容差より小さい'};
  if (it.dist === 'cpk' && it.shift) {
    const h = it.type === 'dim' ? (it.up - it.lo) / 2 : it.t / 2;
    if (Math.abs(it.shift) >= h) return {bad:['shift'], msg:'平均のずれが公差の半幅以上（Cpk が定義できない）'};
  }
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
  box.querySelectorAll('.it').forEach(el => {
    const o = arr[+el.dataset.i], c = o ? check(o) : null;
    el.querySelectorAll('input[data-k]').forEach(inp => inp.classList.toggle('bad', !!c && c.bad.includes(inp.dataset.k)));
    el.querySelector('.err1').textContent = c ? c.msg : '';
  });
}
// 計算に渡す形にまとめる（画面に依存しない。ケースの計算にも使う）
function prepare(mode, data){
  if (mode === '1d') {
    const ok = [], errs = [];
    data.items.forEach((it, i) => (checkItem(it) ? errs : ok).push(i));
    const items = ok.map(i => ({...data.items[i], shift: data.items[i].shift || 0, name: data.items[i].name || `項目${i + 1}`, idx: i}));
    const sp = data.spec[0];
    return {mode, items, errs, empty: !items.length, spec: data.spec, opt: {smin: sp.min, smax: sp.max}};
  }
  const ok = [], errs = [];
  data.vecs.forEach((v, i) => (checkVec(v) ? errs : ok).push(i));
  const vecs = ok.map(i => ({...data.vecs[i], name: data.vecs[i].name || `ベクトル${i + 1}`, idx: i}));
  return {mode, vecs, errs, empty: !vecs.length, spec: data.spec, names: data.names,
          opt: {phi: data.phi || 0, tx: data.tx || 0, ty: data.ty || 0, spec: data.spec}};
}
function compute(p, n){
  if (p.mode === '1d') return {outs: [analyze1D(p.items, {...p.opt, n, seed: 1})]};
  return analyze2D(p.vecs, {...p.opt, n, seed: 1});
}

// ---- モンテカルロは別スレッド（Web Worker）で計算する ----
const WORKER_MAIN = `
self.onmessage = e => {
  const m = e.data;
  try {
    const r = m.mode === '1d' ? {outs: [analyze1D(m.items, Object.assign({}, m.opt, {n: m.n, seed: 1}))]}
                              : analyze2D(m.vecs, Object.assign({}, m.opt, {n: m.n, seed: 1}));
    self.postMessage({id: m.id, r});
  } catch (err) { self.postMessage({id: m.id, error: String(err)}); }
};`;
let worker = null, jobs = {}, jobId = 0;
function initWorker(){
  try {
    const src = $('engine-src').textContent + '\n' + WORKER_MAIN;
    worker = new Worker(URL.createObjectURL(new Blob([src], {type: 'text/javascript'})));
    worker.onmessage = e => { const j = jobs[e.data.id]; delete jobs[e.data.id]; if (j) j.cb(e.data); };
    // 別スレッドが使えない環境では、同じ計算を画面側で行う
    worker.onerror = e => { if (e.preventDefault) e.preventDefault(); worker = null; const js = jobs; jobs = {}; Object.values(js).forEach(runSync); };
  } catch(e) { worker = null; }
}
function runSync(j){ setTimeout(() => { try { j.cb({r: compute(j.msg, j.msg.n)}); } catch(err) { j.cb({error: String(err)}); } }, 0); }
function runJob(msg, cb){
  const j = {msg, cb};
  if (worker) { const id = ++jobId; jobs[id] = j; worker.postMessage({...msg, id}); } else runSync(j);
}

// ---- 計算と描画 ----
let last = null, mainId = 0, mcTimer = null;
function calc(){
  try {
    const data = state.mode === '1d' ? state.d1 : state.d2;
    if (state.mode === '1d') markRows($('items'), state.d1.items, checkItem); else markRows($('vecs'), state.d2.vecs, checkVec);
    const p = prepare(state.mode, data);
    $('rowErr').textContent = p.errs.length ? `${p.errs.map(i => i + 1).join('・')} 行目は入力に不備があるため計算から外している` : '';
    const names = outNames();
    $('dfigT0').textContent = `${names[0]}の分布と規格`;
    $('dfigT1').textContent = `${names[1] || ''}の分布と規格`;
    if (p.empty) { clearOut(); return; }
    last = {p, res: compute(p, 0), pending: state.n > 0};
    renderResults(); renderFigs(); renderContrib();
    if (!drag) { renderAlloc(); renderCases(); }
    scheduleMC();
  } catch(err) {
    $('rowErr').textContent = '計算できなかった：' + err.message;
  }
}
// 入力が止まってから（ドラッグ中は回数を減らして）モンテカルロを回す
function scheduleMC(){
  clearTimeout(mcTimer);
  if (!(state.n > 0) || !last) return;
  const p = last.p, n = drag ? Math.min(state.n, 20000) : state.n, id = ++mainId;
  mcTimer = setTimeout(() => runJob({mode: p.mode, items: p.items, vecs: p.vecs, opt: p.opt, n}, m => {
    if (id !== mainId || !last || last.p !== p || m.error) return;
    last.res = m.r; last.pending = false;
    renderResults(); renderFigs();
    if (!drag) renderCases();
  }), drag ? 40 : 250);
}
function clearOut(){
  last = null;
  ['resBox','blockFig','vecFig','distFig0','distFig1','contrib','legend','allocBox'].forEach(id => $(id).innerHTML = '');
  renderCases();
}
function figW(id){ return Math.max(320, Math.min(640, $(id).clientWidth || 640)); }
function renderFigs(){
  if (!last) return;
  const outs = last.res.outs, p = last.p;
  const fz = key => drag && drag.kind === 'spec' && drag.fig === key ? drag.frz : null;
  if (p.mode === '1d') {
    redrawBlocks();
    const sp = state.d1.spec[0];
    $('distFig0').innerHTML = drawDist(outs[0], sp.min, sp.max, figW('distFig0'), 'dist0', fz('dist0'));
  } else {
    $('vecFig').innerHTML = drawVec(p.vecs, state.d2, figW('vecFig'), drag && drag.kind === 'tip' ? drag.frz : null);
    [0, 1].forEach(o => $('distFig' + o).innerHTML = drawDist(outs[o], state.d2.spec[o].min, state.d2.spec[o].max, figW('distFig' + o), 'dist' + o, fz('dist' + o)));
  }
}
function redrawBlocks(){
  if (!last || last.p.mode !== '1d') return;
  const w = Math.max(320, Math.min(1000, $('blockFig').clientWidth || 640));
  $('blockFig').innerHTML = drawBlocks(last.p.items, last.res.outs[0], w);
}

const ppmText = (p, n) => p === null || p === undefined ? '—'
  : p === 0 ? (n ? `0（${n.toLocaleString('ja-JP')}回中）` : '0')
  : p < 1 ? '1 ppm 未満' : `${Math.round(p).toLocaleString('ja-JP')} ppm`;
const VERDICT = {
  ok: '合格：全部品が公差内なら、ワーストケースでも規格内',
  warn: '条件付き：統計では規格内。ワーストケースでは規格外、または公差外れの部品を含む',
  ng: '不合格：統計でも規格外'
};
function renderResults(){
  const outs = last.res.outs, names = outNames(), pend = last.pending;
  const PEND = '<span class="pending">計算中…</span>';
  const col = f => outs.map(f).map(v => `<td>${v}</td>`).join('');
  const rng = (a, b) => `${fmt(a)} 〜 ${fmt(b)}`;
  const rows = [
    ['基準値 / 中心値', o => `${fmt(o.nom)} / ${fmt(o.center)}`],
    ['ワーストケース', o => `${rng(o.wcMin, o.wcMax)}<span class="sub">（±${fmt(o.wcHalf)}）</span>`, 'big'],
    ['統計 ±3σ', o => `${rng(o.stMin, o.stMax)}<span class="sub">（平均 ${fmt(o.mean)}、σ ${o.sd.toFixed(4)}）</span>`, 'big'],
    ['出力の Cpk（正規近似）', o => fmtCpk(o.cpk)],
    ['補正RSS ×1.5', o => rng(o.bdMin, o.bdMax)],
    ['モンテカルロ 99.73%', o => pend ? PEND : o.mc ? `${rng(o.mc.lo, o.mc.hi)}<span class="sub">（σ ${o.mc.sd.toFixed(4)}）</span>` : '—', 'big'],
    ['規格外れ率 MC / 正規近似', o => `${pend ? PEND : o.mc ? ppmText(o.mc.ppm, o.mc.ppm === 0 ? o.mc.n : 0) : '—'}<span class="sub"> / ${ppmText(o.ppmNormal)}</span>`]
  ];
  let h = `<table class="res"><thead><tr><th class="k"></th>${names.map(n => `<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>`;
  h += rows.map(([k, f, cls]) => `<tr${cls ? ` class="${cls}"` : ''}><td class="k">${k}</td>${col(f)}</tr>`).join('');
  h += '</tbody></table>';
  outs.forEach((o, i) => {
    if (o.verdict) h += `<div class="verdict ${o.verdict}">${outs.length > 1 ? esc(names[i]) + '　' : ''}${VERDICT[o.verdict]}${pend ? '<span class="pending">（モンテカルロの結果で変わることがある）</span>' : ''}</div>`;
  });
  // 公差外れの部品（ワーストケースの前提が崩れる）
  const src = last.p.mode === '1d' ? last.p.items : last.p.vecs;
  const ws = (outs[0].warns || []).map((w, k) => w ? `${esc(src[k].name)}：${w === 'meas' ? '実測の平均±3σが公差域からはみ出す' : 'Cpk が 1 未満'}` : null).filter(Boolean);
  if (ws.length) h += `<div class="warnbox">公差外れの部品が見込まれるため、ワーストケースでの合格判定はしていない。<br>${ws.join('<br>')}</div>`;
  const nonNormal = !pend && outs.some(o => o.mc && o.ppmNormal !== null && o.mc.ppm !== null && Math.abs(o.mc.ppm - o.ppmNormal) > Math.max(50, 0.3 * o.ppmNormal));
  if (nonNormal) h += `<p class="note">モンテカルロと正規近似の規格外れ率が大きく違う。一様分布や組付けの遊び、2次元の非線形の影響で、出力が正規分布から外れている。モンテカルロの値を優先して判断する。</p>`;
  $('resBox').innerHTML = h;
}

// ---- 寄与率 ----
function contribRow(label, sub, b1, b2, pct, drg){
  const w = v => `${Math.max(0, Math.min(1, v)) * 100}%`;
  return `<div class="item"${drg || ''}><span>${esc(label)}<span class="tol">${sub}</span></span>
    <span class="bars"><span class="bar" style="width:${w(b1)}"></span>${b2 === null ? '' : `<span class="bar b2" style="width:${w(b2)}"></span>`}</span>
    <span class="num">${pct}</span></div>`;
}
const pctT = v => `${(v * 100).toFixed(1)}%`;
function renderContrib(){
  const r = last.res, names = outNames();
  if (last.p.mode === '1d') {
    const items = last.p.items, o = r.outs[0];
    $('legend').innerHTML = `<span><i style="background:var(--bar1)"></i>統計（分散の割合）</span><span><i style="background:var(--bar2)"></i>ワーストケース（|係数|×半幅 の割合）</span>`;
    const mx = Math.max(...o.contrib.map(c => Math.max(c.var, c.wc)), 1e-9);
    $('contrib').innerHTML = items.map((it, k) => {
      const c = o.contrib[k];
      const sub = `${TYPE_NAME[it.type]}　±${fmtT(c.h)}${Math.abs(c.a) !== 1 ? `　係数 ${fmtT(c.a)}` : ''}`;
      const dr = it.type === 'float' ? '' : ` data-drag="tol" data-i="${it.idx}"`;
      return contribRow(it.name, sub, c.var / mx, c.wc / mx, pctT(c.var), dr);
    }).join('');
  } else {
    $('legend').innerHTML = `<span><i style="background:var(--bar1)"></i>${esc(names[0])}（分散の割合）</span><span><i style="background:var(--bar2)"></i>${esc(names[1])}（分散の割合）</span>`;
    const c0 = r.outs[0].contrib, c1 = r.outs[1].contrib;
    const mx = Math.max(...c0.map(c => c.var), ...c1.map(c => c.var), 1e-9);
    let h = '';
    last.p.vecs.forEach((v, i) => {
      [['l', '長さ', 'mm'], ['a', '角度', '°']].forEach(([p, t, u], j) => {
        const k = 2 * i + j;
        const sub = `±${fmtT(c0[k].h)}${u}　感度 ${fmtT(c0[k].a)} / ${fmtT(c1[k].a)}`;
        h += contribRow(`${v.name} ${t}`, sub, c0[k].var / mx, c1[k].var / mx, `${pctT(c0[k].var)} / ${pctT(c1[k].var)}`, ` data-drag="tol2" data-i="${v.idx}" data-p="${p}"`);
      });
    });
    $('contrib').innerHTML = h;
  }
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
// 文字幅の概算（全角1文字≒12px）と、幅に収まるよう切り詰めた文字列
const textW = (s, fs = 12) => [...String(s)].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? fs : fs * 0.58), 0);
function fitText(s, w, fs = 12){
  s = String(s);
  if (textW(s, fs) <= w) return s;
  let out = '';
  for (const ch of s) { if (textW(out + ch + '…', fs) > w) break; out += ch; }
  return out ? out + '…' : '';
}
const tolText = it => {
  if (it.type === 'dim') return Math.abs(it.up + it.lo) < 1e-12 ? `±${fmtT(it.up)}` : `${sgn(it.up)}/${sgn(it.lo)}`;
  if (it.type === 'prof') return `t${fmtT(it.t)}`;
  if (it.type === 'pos') return `φ${fmtT(it.t)}${it.mmc ? 'Ⓜ' : ''}`;
  return '遊び';
};
// 値の軸の目盛り
function axisTicks(lo, hi, X, y, n){
  const step = niceStep((hi - lo) / n), d = decOf(step);
  let g = `<line x1="${X(lo)}" y1="${y}" x2="${X(hi)}" y2="${y}" style="stroke:var(--sub)"/>`;
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) {
    g += `<line x1="${X(v)}" y1="${y}" x2="${X(v)}" y2="${y + 4}" style="stroke:var(--sub)"/>`;
    g += `<text x="${X(v)}" y="${y + 15}" text-anchor="middle" font-size="10.5" style="fill:var(--sub)">${(Math.abs(v) < step / 1e6 ? 0 : v).toFixed(d)}</text>`;
  }
  return g;
}
// 規格線（点線・ラベル・つかむ範囲）。key は図の名前（FIG のキー）
function specLines(smin, smax, X, yTop, yBot, labelY, key, o){
  let g = '', hit = '';
  const hasMin = isNum(smin), hasMax = isNum(smax);
  [[smin, '下限', 'min'], [smax, '上限', 'max']].forEach(([v, t, side]) => {
    if (!isNum(v)) return;
    g += `<line x1="${X(v)}" y1="${yTop}" x2="${X(v)}" y2="${yBot}" style="stroke:var(--ok)" stroke-dasharray="5 3" stroke-width="1.4"/>`;
    g += `<text x="${X(v)}" y="${labelY}" text-anchor="middle" font-size="11" style="fill:var(--ok)">${t} ${fmt(v)}</text>`;
    g += `<circle class="h-ring" cx="${X(v)}" cy="${yBot}" r="5" style="stroke:var(--ok)"/>`;
    // 下限と上限が近いときは、つかむ範囲が重ならないよう外側に寄せる
    const half = hasMin && hasMax ? Math.min(12, Math.abs(X(smax) - X(smin)) / 2) : 12;
    const hx = side === 'min' ? X(v) - 12 : X(v) - half;
    hit += `<rect x="${hx}" y="${yTop - 18}" width="${12 + half}" height="${yBot - yTop + 30}" fill="transparent" data-drag="spec" data-fig="${key}" data-o="${o}" data-s="${side}"/>`;
  });
  return {g, hit};
}

// 出力の分布図：モンテカルロのヒストグラム、統計（正規）の曲線、各方式の範囲、規格線
function drawDist(r, smin, smax, W = 640, key = 'dist0', frz = null){
  const o = +key.slice(-1);
  const narrow = W < 440, L = narrow ? 52 : 100, R = 16, curveTop = 30, curveH = 96;
  const y1 = curveTop + curveH + 24, y2 = y1 + 22, y3 = y2 + 22, yAxis = y3 + 22, H = yAxis + 22;
  let lo = Math.min(r.wcMin, r.stMin), hi = Math.max(r.wcMax, r.stMax);
  if (r.mc) { lo = Math.min(lo, r.mc.lo); hi = Math.max(hi, r.mc.hi); }
  if (isNum(smin)) lo = Math.min(lo, smin);
  if (isNum(smax)) hi = Math.max(hi, smax);
  let span = hi - lo; if (!(span > 0)) span = Math.abs(r.center) * 0.1 || 1;
  lo -= span * 0.08; hi += span * 0.08;
  if (frz) { lo = frz.lo; hi = frz.hi; }
  FIG[key] = {lo, hi, x0: L, x1: W - R};
  const X = v => L + (v - lo) / (hi - lo) * (W - L - R);
  let g = '';
  if (isNum(smin) || isNum(smax)) {
    const a = isNum(smin) ? X(smin) : L, b = isNum(smax) ? X(smax) : W - R;
    g += `<rect x="${Math.max(L, a)}" y="${curveTop - 6}" width="${Math.max(0, Math.min(W - R, b) - Math.max(L, a))}" height="${y3 + 10 - curveTop + 6}" style="fill:var(--ok)" opacity="0.08"/>`;
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
      path += (k ? 'L' : 'M') + X(v).toFixed(1) + ',' + Y(Math.exp(-0.5 * ((v - r.mean) / r.sd) ** 2) * pk).toFixed(1);
    }
    g += `<path d="${path}" fill="none" style="stroke:var(--acc)" stroke-width="1.8"/>`;
  }
  g += `<line x1="${L}" y1="${curveTop + curveH}" x2="${W - R}" y2="${curveTop + curveH}" style="stroke:var(--line)"/>`;
  g += `<text x="${L - 8}" y="${curveTop + 12}" text-anchor="end" font-size="11" style="fill:var(--pur)">${r.mc ? 'MC' : ''}</text>`;
  g += `<text x="${L - 8}" y="${curveTop + 28}" text-anchor="end" font-size="11" style="fill:var(--acc)">${narrow ? '正規' : '正規近似'}</text>`;
  const bar = (y, mn, mx, label, c) =>
    `<text x="${L - 8}" y="${y + 4}" text-anchor="end" font-size="11.5" style="fill:var(--sub)">${label}</text>
     <line x1="${X(mn)}" y1="${y}" x2="${X(mx)}" y2="${y}" style="stroke:var(--${c})" stroke-width="6" stroke-linecap="round"/>
     <text x="${X(mn)}" y="${y - 6}" text-anchor="middle" font-size="10.5" style="fill:var(--sub)">${fmt(mn)}</text>
     <text x="${X(mx)}" y="${y - 6}" text-anchor="middle" font-size="10.5" style="fill:var(--sub)">${fmt(mx)}</text>`;
  if (r.mc) g += bar(y1, r.mc.lo, r.mc.hi, narrow ? 'MC' : 'モンテカルロ', 'pur');
  g += bar(y2, r.stMin, r.stMax, narrow ? '統計' : '統計 ±3σ', 'acc');
  g += bar(y3, r.wcMin, r.wcMax, narrow ? 'WC' : 'ワーストケース', 'warn');
  // 縦線：実線＝分布の平均、点線＝公差域の中心（実測分布や Cpk の平均ずれがあると食い違う）
  g += `<line x1="${X(r.mean)}" y1="${curveTop}" x2="${X(r.mean)}" y2="${y3 + 10}" style="stroke:var(--fg)" stroke-width="1"/>`;
  if (Math.abs(r.mean - r.center) > (hi - lo) * 1e-3) {
    g += `<line x1="${X(r.center)}" y1="${curveTop}" x2="${X(r.center)}" y2="${y3 + 10}" style="stroke:var(--sub)" stroke-dasharray="2 3"/>`;
    g += `<text x="${X(r.center)}" y="${curveTop + curveH - 4}" text-anchor="middle" font-size="10" style="fill:var(--sub)">公差中心</text>`;
  }
  const sl = specLines(smin, smax, X, curveTop - 6, y3 + 10, curveTop - 11, key, o);
  g += sl.g + axisTicks(lo, hi, X, yAxis, narrow ? 5 : 7);
  return `<svg xmlns="${SVGNS}" viewBox="0 0 ${W} ${H}" role="img" aria-label="出力の分布と規格">${g}${sl.hit}</svg>`;
}

// ---- 積み上げブロック図（1次元） ----
// 上段：すき間を広げる寸法（係数＞0）、下段：狭める寸法（係数＜0）を左から並べる。
// 2つの段の右端の差がすき間。幾何公差・組付けの遊びは基準値 0 のため、下の「内訳」にだけ現れる。
// ブロックの幅は基準寸法の比を基本に、小さい寸法も読めるよう最小幅を足している（厳密な縮尺ではない）。
function drawBlocks(items, r, W){
  const narrow = W < 560, L = 12, R = 12;
  const dims = items.filter(it => it.type === 'dim');
  const pos = dims.filter(it => it.coef >= 0), neg = dims.filter(it => it.coef < 0);
  const geo = items.filter(it => it.type !== 'dim');
  const val = it => Math.abs(it.coef * it.nom);
  const Sp = pos.reduce((s, it) => s + val(it), 0), Sn = neg.reduce((s, it) => s + val(it), 0);
  const gap = Sp - Sn;
  const GW = Math.max(64, Math.min(120, Math.round(W * 0.14)));
  const WM = W - L - R - GW;
  const spanP = gap >= 0 ? WM + GW : WM, spanN = gap >= 0 ? WM : WM + GW;
  const fz = drag && drag.kind === 'bnom' ? drag.frz : null;
  const rowScale = (list, span, Ssum) => {
    const mw = Math.min(narrow ? 30 : 40, span / Math.max(1, list.length) * 0.5);
    return {mw, s: list.length && Ssum > 0 ? (span - list.length * mw) / Ssum : 0};
  };
  const scP = fz ? fz.p : rowScale(pos, spanP, Sp), scN = fz ? fz.n : rowScale(neg, spanN, Sn);
  const bh = 38, yTitle = 14, yP = 22, yN = yP + bh + 28;
  const list = [];
  const lay = (arr, row, sc) => { let x = L; arr.forEach(it => { const w = sc.mw + sc.s * val(it); list.push({it, row, x, w}); x += w; }); return x; };
  const endP = pos.length ? lay(pos, 'p', scP) : L + spanP;
  const endN = neg.length ? lay(neg, 'n', scN) : L + spanN;
  FIG.blocks = {list, p: scP, n: scN, midY: (yP + bh + yN) / 2, L, yP, yN, bh, endP, endN};
  const gx0 = Math.min(endP, endN), gx1 = Math.max(endP, endN);
  let g = '', hits = '', handles = '';
  // 段の見出しと、空の段の置き場所
  g += `<text x="${L}" y="${yTitle}" font-size="11.5" style="fill:var(--acc)">すき間を広げる側（＋）</text>`;
  g += `<text x="${L}" y="${yN - 8}" font-size="11.5" style="fill:var(--warn)">すき間を狭める側（−）</text>`;
  if (!pos.length) g += `<rect x="${L}" y="${yP}" width="${spanP}" height="${bh}" rx="5" fill="none" style="stroke:var(--acc)" stroke-dasharray="5 4"/><text x="${L + spanP / 2}" y="${yP + bh / 2 + 4}" text-anchor="middle" font-size="12" style="fill:var(--sub)">＋側の寸法をここに置く</text>`;
  if (!neg.length) g += `<rect x="${L}" y="${yN}" width="${spanN}" height="${bh}" rx="5" fill="none" style="stroke:var(--warn)" stroke-dasharray="5 4"/><text x="${L + spanN / 2}" y="${yN + bh / 2 + 4}" text-anchor="middle" font-size="12" style="fill:var(--sub)">−側の寸法をここに置く</text>`;
  // すき間の枠：短い方の段の右端から、長い方の段の右端まで（短い方の段の高さに描く）
  const gc = r.nom < 0 ? 'ng' : 'ok', gy = endN <= endP ? yN : yP;
  g += `<line x1="${gx1}" y1="${yP}" x2="${gx1}" y2="${yN + bh}" style="stroke:var(--${gc})" stroke-dasharray="4 3"/>`;
  g += `<line x1="${gx0}" y1="${yP}" x2="${gx0}" y2="${yN + bh}" style="stroke:var(--${gc})" stroke-dasharray="4 3"/>`;
  g += `<rect x="${gx0}" y="${gy}" width="${Math.max(2, gx1 - gx0)}" height="${bh}" style="fill:var(--${gc})" opacity="0.14"/>`;
  const gcx = (gx0 + gx1) / 2;
  g += `<text x="${gcx}" y="${gy + 16}" text-anchor="middle" font-size="12" font-weight="600" style="fill:var(--${gc})">${r.nom < 0 ? '干渉' : 'すき間'}</text>`;
  g += `<text x="${gcx}" y="${gy + 31}" text-anchor="middle" font-size="11.5" style="fill:var(--${gc})">${fmt(r.nom)}</text>`;
  // 基準線
  g += `<line x1="${L}" y1="${yP - 4}" x2="${L}" y2="${yN + bh + 4}" style="stroke:var(--sub)" stroke-width="1.2"/>`;
  // ブロック
  const maxE = Math.max(...dims.map(it => Math.abs(it.coef) * (it.up - it.lo) / 2), 1e-12);
  list.forEach(b => {
    const it = b.it, c = b.row === 'p' ? 'acc' : 'warn', y = b.row === 'p' ? yP : yN;
    const isSel = sel === it.idx, moving = drag && drag.kind === 'bmove' && drag.moved && drag.i === it.idx;
    g += `<rect x="${b.x + 1}" y="${y}" width="${Math.max(1, b.w - 2)}" height="${bh}" rx="4" style="fill:var(--${c});stroke:var(--${isSel ? 'fg' : c})" fill-opacity="${moving ? 0.05 : 0.14}" stroke-width="${isSel ? 2.4 : 1.2}"${moving ? ' stroke-dasharray="4 3"' : ''}/>`;
    // 右端の帯：幅は公差（|係数|×半幅）の相対的な大きさ
    const e = Math.abs(it.coef) * (it.up - it.lo) / 2, bw = 3 + 12 * e / maxE, xe = b.x + b.w;
    g += `<rect x="${xe - bw / 2}" y="${y}" width="${bw}" height="${bh}" style="fill:var(--${c})" opacity="0.45"/>`;
    const a = it.coef, coefT = Math.abs(a) === 1 ? '' : `${fmtT(Math.abs(a))}×`;
    const inner = b.w - 10;
    g += `<text x="${b.x + 6}" y="${y + 15}" font-size="12" style="fill:var(--fg)" pointer-events="none">${esc(fitText(it.name, inner, 12))}</text>`;
    g += `<text x="${b.x + 6}" y="${y + 30}" font-size="11" style="fill:var(--sub)" pointer-events="none">${esc(fitText(`${coefT}${fmtT(it.nom)} ${tolText(it)}`, inner, 11))}</text>`;
    hits += `<rect class="blk" x="${b.x}" y="${y}" width="${b.w}" height="${bh}" fill="transparent" data-drag="bmove" data-i="${it.idx}"/>`;
    handles += `<circle class="h-ring" cx="${xe}" cy="${y + bh / 2}" r="5.5" style="stroke:var(--${c})" pointer-events="none"/>`;
    handles += `<circle cx="${xe}" cy="${y + bh / 2}" r="13" fill="transparent" data-drag="bnom" data-i="${it.idx}"/>`;
  });
  // 並べ替え・パレットから置くときの挿入位置
  const tg = (drag && drag.kind === 'bmove' && drag.moved && drag.target) || (pal && pal.moved && pal.target);
  if (tg) { const y = tg.row === 'p' ? yP : yN; g += `<line x1="${tg.x}" y1="${y - 5}" x2="${tg.x}" y2="${y + bh + 5}" style="stroke:var(--fg)" stroke-width="3"/>`; }
  if (drag && drag.kind === 'bmove' && drag.moved && drag.pt) {
    const b = list.find(b => b.it.idx === drag.i);
    if (b) g += `<rect x="${drag.pt.x - b.w / 2}" y="${drag.pt.y - bh / 2}" width="${b.w}" height="${bh}" rx="4" style="fill:var(--card);stroke:var(--fg)" fill-opacity="0.85" stroke-dasharray="4 3" pointer-events="none"/><text x="${drag.pt.x - b.w / 2 + 6}" y="${drag.pt.y + 4}" font-size="12" style="fill:var(--fg)" pointer-events="none">${esc(fitText(b.it.name, b.w - 10))}</text>`;
  }

  // ---- 下段：すき間の内訳（ワーストケースの積み上げ） ----
  const yG = yN + bh + 40;
  const labW = narrow ? 112 : 200, ax0 = L + labW, ax1 = W - R;
  // すき間の枠から内訳への拡大線
  g += `<path d="M${gx0},${yN + bh}L${ax0},${yG}M${gx1},${yN + bh}L${ax1},${yG}" fill="none" style="stroke:var(--line)" stroke-dasharray="3 3"/>`;
  const sp = state.d1.spec[0], smin = sp.min, smax = sp.max;
  let lo = Math.min(r.wcMin, r.stMin), hi = Math.max(r.wcMax, r.stMax);
  if (r.mc) { lo = Math.min(lo, r.mc.lo); hi = Math.max(hi, r.mc.hi); }
  if (isNum(smin)) lo = Math.min(lo, smin);
  if (isNum(smax)) hi = Math.max(hi, smax);
  let span = hi - lo; if (!(span > 0)) span = Math.abs(r.center) * 0.1 || 1;
  lo -= span * 0.06; hi += span * 0.06;
  const fzs = drag && drag.kind === 'spec' && drag.fig === 'blk' ? drag.frz : null;
  if (fzs) { lo = fzs.lo; hi = fzs.hi; }
  FIG.blk = {lo, hi, x0: ax0, x1: ax1};
  const X = v => ax0 + (v - lo) / (hi - lo) * (ax1 - ax0);
  g += `<rect x="${L}" y="${yG}" width="${W - L - R}" height="1" style="fill:var(--line)"/>`;
  g += `<text x="${L}" y="${yG + 16}" font-size="12" font-weight="600" style="fill:var(--fg)">すき間の内訳（ワーストケースの積み上げ）</text>`;
  const rowH = 18, yr0 = yG + 46, ce = r.center;
  let cum = 0;
  items.forEach((it, k) => {
    const c = r.contrib[k], e = Math.abs(c.a) * c.h, y = yr0 + k * rowH;
    const col = it.type !== 'dim' ? 'pur' : it.coef >= 0 ? 'acc' : 'warn';
    const isSel = sel === it.idx;
    g += `<text x="${L}" y="${y + 4}" font-size="11.5" style="fill:var(--fg)"${isSel ? ' font-weight="700"' : ''}>${esc(fitText(it.name, labW - 62, 11.5))}</text>`;
    g += `<text x="${ax0 - 6}" y="${y + 4}" text-anchor="end" font-size="11" style="fill:var(--sub)">±${fmt(e)}</text>`;
    if (cum > 0) g += `<rect x="${X(ce - cum)}" y="${y - 2}" width="${Math.max(0.5, X(ce + cum) - X(ce - cum))}" height="4" style="fill:var(--bar2)" opacity="0.6"/>`;
    if (e > 0) {
      g += `<rect x="${X(ce - cum - e)}" y="${y - 5}" width="${Math.max(0.8, X(ce - cum) - X(ce - cum - e))}" height="10" rx="2" style="fill:var(--${col})" opacity="0.85"/>`;
      g += `<rect x="${X(ce + cum)}" y="${y - 5}" width="${Math.max(0.8, X(ce + cum + e) - X(ce + cum))}" height="10" rx="2" style="fill:var(--${col})" opacity="0.85"/>`;
    }
    cum += e;
    if (it.type !== 'float') hits += `<rect x="${L}" y="${y - rowH / 2}" width="${W - L - R}" height="${rowH}" fill="transparent" data-drag="tol" data-i="${it.idx}"/>`;
  });
  let ys = yr0 + items.length * rowH + 6;
  g += `<line x1="${L}" y1="${ys - 4}" x2="${W - R}" y2="${ys - 4}" style="stroke:var(--line)"/>`;
  const sbar = (y, mn, mx, label, c) =>
    `<text x="${L}" y="${y + 4}" font-size="11.5" font-weight="600" style="fill:var(--${c})">${label}</text>
     <line x1="${X(mn)}" y1="${y}" x2="${X(mx)}" y2="${y}" style="stroke:var(--${c})" stroke-width="7" stroke-linecap="round"/>
     <text x="${Math.max(ax0 + 14, X(mn))}" y="${y - 6}" text-anchor="middle" font-size="10.5" style="fill:var(--sub)">${fmt(mn)}</text>
     <text x="${Math.min(ax1 - 14, X(mx))}" y="${y - 6}" text-anchor="middle" font-size="10.5" style="fill:var(--sub)">${fmt(mx)}</text>`;
  ys += 16;
  g += sbar(ys, r.wcMin, r.wcMax, 'ワーストケース', 'warn'); ys += rowH + 8;
  g += sbar(ys, r.stMin, r.stMax, '統計 ±3σ', 'acc'); ys += rowH + 8;
  if (r.mc) { g += sbar(ys, r.mc.lo, r.mc.hi, 'モンテカルロ', 'pur'); ys += rowH + 8; }
  g += `<line x1="${X(ce)}" y1="${yr0 - 12}" x2="${X(ce)}" y2="${ys - 8}" style="stroke:var(--fg)" stroke-width="1" stroke-dasharray="2 3"/>`;
  const sl = specLines(smin, smax, X, yr0 - 14, ys - 8, yG + 34, 'blk', 0);
  const yAxis = ys + 4;
  g += sl.g + axisTicks(lo, hi, X, yAxis, narrow ? 4 : 8);
  if (geo.length) g += `<text x="${W - R}" y="${yN + bh + 16}" text-anchor="end" font-size="11" style="fill:var(--pur)">＋ 幾何公差・遊び ${geo.length} 項目（基準値 0。内訳に表示）</text>`;
  const H = yAxis + 24;
  return `<svg xmlns="${SVGNS}" viewBox="0 0 ${W} ${H}" role="img" aria-label="積み上げブロック図">${g}${hits}${handles}${sl.hit}</svg>`;
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
  g += `<circle cx="${X(0)}" cy="${Y(0)}" r="4" style="fill:var(--sub)"/><text x="${X(0) + 6}" y="${Y(0) + 14}" font-size="11" style="fill:var(--sub)">原点</text>`;
  const f = (d.phi || 0) * Math.PI / 180, al = Math.min(W, H) * 0.16;
  const ax = [[Math.cos(f), Math.sin(f), d.names[0] || '出力1', 'ok'], [-Math.sin(f), Math.cos(f), d.names[1] || '出力2', 'warn']];
  ax.forEach(([ux, uy, t, c]) => {
    g += `<line x1="${X(tx)}" y1="${Y(ty)}" x2="${X(tx) + ux * al}" y2="${Y(ty) - uy * al}" style="stroke:var(--${c})" stroke-width="1.6" stroke-dasharray="4 3" marker-end="url(#ah-${c})"/>`;
    g += `<text x="${X(tx) + ux * (al + 12)}" y="${Y(ty) - uy * (al + 12) + 4}" text-anchor="middle" font-size="11" style="fill:var(--${c})">${esc(t)}</text>`;
  });
  g += `<path d="M${X(tx) - 5},${Y(ty) - 5}L${X(tx) + 5},${Y(ty) + 5}M${X(tx) - 5},${Y(ty) + 5}L${X(tx) + 5},${Y(ty) - 5}" style="stroke:var(--fg)" stroke-width="1.6"/>`;
  g += `<text x="${Math.max(X(tx) - 8, textW('目標点', 11) + 2)}" y="${Y(ty) - 8}" text-anchor="end" font-size="11" style="fill:var(--fg)">目標点</text>`;
  vecs.forEach((v, i) => {
    const a = pts[i], b = pts[i + 1];
    g += `<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" style="stroke:var(--acc)" stroke-width="2.4" marker-end="url(#ah-acc)"/>`;
    const mx = (X(a.x) + X(b.x)) / 2, my = (Y(a.y) + Y(b.y)) / 2;
    const nx = -(Y(b.y) - Y(a.y)), ny = X(b.x) - X(a.x), nl = Math.hypot(nx, ny) || 1;
    const lbl = `${v.name} ${v.ln}`;
    const lx = Math.min(Math.max(mx + nx / nl * 12, textW(lbl, 11.5) / 2 + 2), pw - textW(lbl, 11.5) / 2 - 2);
    g += `<text x="${lx}" y="${my + ny / nl * 12 + 4}" text-anchor="middle" font-size="11.5" style="fill:var(--fg)" pointer-events="none">${esc(lbl)}</text>`;
    g += `<circle class="h-ring" cx="${X(b.x)}" cy="${Y(b.y)}" r="5.5" style="stroke:var(--acc)" pointer-events="none"/>`;
  });
  g += drawInset(pts, d, wide ? W - iw - 6 : 6, wide ? (H - ih) / 2 : ph + 4, iw, ih, mp.s);
  vecs.forEach((v, i) => { const b = pts[i + 1]; g += `<circle cx="${X(b.x)}" cy="${Y(b.y)}" r="15" fill="transparent" data-drag="tip" data-i="${v.idx}" data-k="${i}"/>`; });
  return `<svg xmlns="${SVGNS}" viewBox="0 0 ${W} ${H}" role="img" aria-label="ベクトル図">${g}</svg>`;
}
// 目標点付近の拡大図：全体図では見えない小さなすき間・段差を、終点と目標点の関係として示す
function drawInset(pts, d, ox, oy, iw, ih, s0){
  const tx = d.tx || 0, ty = d.ty || 0, end = pts[pts.length - 1];
  const f = (d.phi || 0) * Math.PI / 180, ux = Math.cos(f), uy = Math.sin(f);
  const dx = end.x - tx, dy = end.y - ty;
  const g1 = dx * ux + dy * uy, g2 = -dx * uy + dy * ux;
  const ext = Math.max(Math.abs(dx), Math.abs(dy), 1e-6);
  const s = Math.min(iw, ih) * 0.32 / ext;
  const cx = ox + iw / 2, cy = oy + ih / 2 + 6;
  const P = (x, y) => [cx + (x - tx) * s, cy - (y - ty) * s];
  let g = `<rect x="${ox}" y="${oy}" width="${iw}" height="${ih}" rx="6" style="fill:var(--card);stroke:var(--line)"/>`;
  const mag = s / s0;
  g += `<text x="${ox + 8}" y="${oy + 15}" font-size="11" style="fill:var(--sub)">目標点付近の拡大（約 ${mag >= 10 ? Math.round(mag).toLocaleString('ja-JP') : mag.toPrecision(2)} 倍）</text>`;
  const al = Math.min(iw, ih) * 0.4;
  [[ux, uy, 'ok', g1], [-uy, ux, 'warn', g2]].forEach(([ax, ay, c, val]) => {
    const [x0, y0] = P(tx, ty);
    g += `<line x1="${x0 - ax * al * 0.5}" y1="${y0 + ay * al * 0.5}" x2="${x0 + ax * al}" y2="${y0 - ay * al}" style="stroke:var(--${c})" stroke-width="1.2" stroke-dasharray="4 3" marker-end="url(#ah-${c})"/>`;
    const [fx, fy] = P(tx + ax * val, ty + ay * val), [ex, ey] = P(end.x, end.y);
    g += `<line x1="${ex}" y1="${ey}" x2="${fx}" y2="${fy}" style="stroke:var(--${c})" stroke-width="1" opacity="0.7"/>`;
    g += `<line x1="${x0}" y1="${y0}" x2="${fx}" y2="${fy}" style="stroke:var(--${c})" stroke-width="3" opacity="0.8"/>`;
  });
  const [x0, y0] = P(tx, ty), [ex, ey] = P(end.x, end.y);
  g += `<path d="M${x0 - 4},${y0 - 4}L${x0 + 4},${y0 + 4}M${x0 - 4},${y0 + 4}L${x0 + 4},${y0 - 4}" style="stroke:var(--fg)" stroke-width="1.5"/>`;
  g += `<circle cx="${ex}" cy="${ey}" r="3.5" style="fill:var(--acc)"/>`;
  g += `<text x="${ox + 8}" y="${oy + ih - 22}" font-size="11.5" font-weight="600" style="fill:var(--ok)">${esc(d.names[0] || '出力1')} ${fmt(g1)}</text>`;
  g += `<text x="${ox + 8}" y="${oy + ih - 7}" font-size="11.5" font-weight="600" style="fill:var(--warn)">${esc(d.names[1] || '出力2')} ${fmt(g2)}</text>`;
  return g;
}

// ===== 図とグラフの直接操作 =====
const snapTo = (v, step) => +(Math.round(v / step) * step).toFixed(decOf(step) + 1);
function svgXY(el, e){
  const svg = el.querySelector('svg'); if (!svg) return {x: 0, y: 0};
  const rc = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
  return {x: (e.clientX - rc.left) * vb.width / rc.width, y: (e.clientY - rc.top) * vb.height / rc.height};
}
// ブロック図の上の位置から、置く段と挿入位置を求める（exclude はドラッグ中のブロック）
function blockTarget(pt, exclude){
  const F = FIG.blocks; if (!F) return null;
  const row = pt.y < F.midY ? 'p' : 'n';
  const lst = F.list.filter(b => b.row === row && b.it.idx !== exclude);
  const b = lst.find(b => b.x + b.w / 2 > pt.x);
  const end = lst.length ? lst[lst.length - 1].x + lst[lst.length - 1].w : F.L;
  return {row, before: b ? b.it.idx : null, x: b ? b.x : end};
}
function applyDrag(e){
  const k = drag.kind;
  if (k === 'bnom') {
    const it = state.d1.items[drag.i], pt = svgXY(drag.el, e);
    const s = drag.sc.s > 0 ? drag.sc.s : 10;
    const v = (pt.x - drag.bx - drag.sc.mw) / s / Math.abs(it.coef || 1);
    it.nom = Math.max(0, snapTo(v, Math.max(0.001, niceStep(1 / s / Math.abs(it.coef || 1)))));
  } else if (k === 'bmove') {
    drag.pt = svgXY(drag.el, e);
    drag.target = blockTarget(drag.pt, drag.i);
    redrawBlocks(); return;
  } else if (k === 'spec') {
    const f = FIG[drag.fig], sp = specArr()[drag.o];
    const v = f.lo + (svgXY(drag.el, e).x - f.x0) / (f.x1 - f.x0) * (f.hi - f.lo);
    const step = niceStep((f.hi - f.lo) / 300);
    let x = snapTo(v, step);
    if (drag.s === 'min' && isNum(sp.max)) x = Math.min(x, snapTo(sp.max - step, step));
    if (drag.s === 'max' && isNum(sp.min)) x = Math.max(x, snapTo(sp.min + step, step));
    sp[drag.s] = x;
  } else if (k === 'tol' || k === 'tol2') {
    // 右へ動かすと公差幅が広がる（120px で約 e 倍）。中心は保つ
    const dx = e.clientX - drag.x0;
    let h = drag.h0 > 0 ? drag.h0 * Math.exp(dx / 120) : Math.max(0, dx) * 1e-3;
    h = Math.max(0, snapTo(h, niceStep(Math.max(h, 1e-4) / 50)));
    const o = drag.obj, [ku, kl, kt] = drag.keys;
    if (kt) o[kt] = +(2 * h).toFixed(4);
    else { o[ku] = +(drag.c0 + h).toFixed(4); o[kl] = +(drag.c0 - h).toFixed(4); }
  } else if (k === 'tip') {
    // 終点の位置 → 長さと角度（「前から」なら前のベクトルの向きとの差）
    const m = FIG.vec, pt = svgXY(drag.el, e);
    const px = m.cx + (pt.x - m.pw / 2) / m.s, py = m.cy - (pt.y - m.ph / 2) / m.s;
    const a = drag.start, v = state.d2.vecs[drag.i];
    let ang = Math.atan2(py - a.y, px - a.x) * 180 / Math.PI;
    if (v.rel) ang -= drag.prevTh * 180 / Math.PI;
    ang = ((ang + 540) % 360) - 180;
    v.ln = snapTo(Math.hypot(px - a.x, py - a.y), niceStep(drag.span / 400));
    v.an = snapTo(ang, 0.1);
  }
  syncInputs(); calc();
}
function startDrag(e, el){
  const t = e.target.closest('[data-drag]'); if (!t) return;
  const kind = t.dataset.drag, i = Number(t.dataset.i);
  drag = {kind, i, el, x0: e.clientX, y0: e.clientY, moved: false};
  if (kind === 'bnom' || kind === 'bmove') {
    const b = FIG.blocks.list.find(b => b.it.idx === i);
    if (!b) { drag = null; return; }
    drag.bx = b.x; drag.sc = b.row === 'p' ? FIG.blocks.p : FIG.blocks.n;
    drag.frz = {p: {...FIG.blocks.p, s: FIG.blocks.p.s > 0 ? FIG.blocks.p.s : 10}, n: {...FIG.blocks.n, s: FIG.blocks.n.s > 0 ? FIG.blocks.n.s : 10}};
  }
  if (kind === 'spec') { drag.fig = t.dataset.fig; drag.o = +t.dataset.o; drag.s = t.dataset.s; const f = FIG[drag.fig]; drag.frz = {lo: f.lo, hi: f.hi}; }
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
// ブロックを別の位置・段へ移す（段が変わると係数の符号を反転）
function applyMove(){
  const arr = state.d1.items, i = drag.i, it = arr[i], tg = drag.target;
  if (!it || !tg) return;
  const toPos = tg.row === 'p';
  arr.splice(i, 1);
  if (((it.coef ?? 1) >= 0) !== toPos) it.coef = -it.coef || (toPos ? 1 : -1);
  const before = tg.before === null ? null : tg.before > i ? tg.before - 1 : tg.before;
  sel = insertDim(it, tg.row, before);
}
function bindDrag(id){
  const el = $(id);
  el.addEventListener('pointerdown', e => startDrag(e, el));
  el.addEventListener('pointermove', e => {
    if (!drag || drag.el !== el) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
    drag.moved = true;
    applyDrag(e);
  });
  const end = cancel => {
    if (!drag || drag.el !== el) return;
    const d = drag; drag = null;
    if (!cancel && d.moved && d.kind === 'bmove') { drag = d; applyMove(); drag = null; commit(); save(); renderInputs(); calc(); setSel(sel, true); return; }
    // 動かさずに離したら「選択」：ブロックや内訳の行を押すと、その入力欄に移る
    if (!cancel && !d.moved && (d.kind === 'bmove' || d.kind === 'bnom' || (d.kind === 'tol' && id !== 'contrib'))) { setSel(d.i, true); calc(); return; }
    if (d.moved) commit();
    save(); syncInputs(); calc();
  };
  el.addEventListener('pointerup', () => end(false));
  el.addEventListener('pointercancel', () => end(true));
}
['blockFig', 'vecFig', 'distFig0', 'distFig1', 'contrib'].forEach(bindDrag);

// ---- パレットからブロック図へ部品を置く ----
const ghost = $('ghost');
$('palette').addEventListener('pointerdown', e => {
  const b = e.target.closest('[data-pal]'); if (!b) return;
  pal = {kind: b.dataset.pal, x0: e.clientX, y0: e.clientY, moved: false, target: null};
  b.setPointerCapture(e.pointerId); e.preventDefault();
  ghost.textContent = b.textContent; ghost.style.borderColor = getComputedStyle(b).borderColor;
});
$('palette').addEventListener('pointermove', e => {
  if (!pal) return;
  if (!pal.moved && Math.hypot(e.clientX - pal.x0, e.clientY - pal.y0) < 6) return;
  pal.moved = true;
  ghost.style.display = 'block'; ghost.style.left = (e.clientX + 12) + 'px'; ghost.style.top = (e.clientY + 12) + 'px';
  const svg = $('blockFig').querySelector('svg');
  let tg = null;
  if (svg) {
    const rc = svg.getBoundingClientRect();
    if (e.clientX >= rc.left && e.clientX <= rc.right && e.clientY >= rc.top && e.clientY <= rc.bottom) {
      tg = (pal.kind === 'pos' || pal.kind === 'neg') ? blockTarget(svgXY($('blockFig'), e), -1) : {drop: true};
    }
  }
  const changed = JSON.stringify(tg) !== JSON.stringify(pal.target);
  pal.target = tg;
  if (changed) redrawBlocks();
});
const palEnd = cancel => {
  if (!pal) return;
  const p = pal; pal = null; ghost.style.display = 'none';
  if (cancel) { redrawBlocks(); return; }
  if (!p.moved) addItem(p.kind, null);
  else if (p.target) addItem(p.kind, p.target.drop ? null : p.target);
  else redrawBlocks();
};
$('palette').addEventListener('pointerup', () => palEnd(false));
$('palette').addEventListener('pointercancel', () => palEnd(true));

// ===== 必要な公差の逆算 =====
let lastAlloc = null;
const floor3 = x => Math.floor(x * 1000 + 1e-9) / 1000;
function allocLabel(p, v){
  if (p.mode === '1d') return p.items[v.i].name;
  return `${p.vecs[v.i].name} ${v.part === 'l' ? '長さ' : '角度'}`;
}
// 調整の対象（変数）の現在の公差の表記と、k 倍したときの表記
function allocTol(p, v, k = 1){
  if (p.mode === '1d') {
    const it = p.items[v.i];
    if (it.type === 'dim') return `±${fmtT(floor3(k * (it.up - it.lo) / 2))}`;
    return `${it.type === 'pos' ? 'φ' : 't'}${fmtT(floor3(k * it.t))}`;
  }
  const q = p.vecs[v.i], [u, l] = v.part === 'l' ? ['lup', 'llo'] : ['aup', 'alo'];
  return `±${fmtT(floor3(k * (q[u] - q[l]) / 2))}${v.part === 'l' ? '' : '°'}`;
}
function renderAlloc(){
  if (!last) { $('allocBox').innerHTML = ''; return; }
  const p = last.p, names = outNames();
  const target = state.alloc.type === 'wc' ? {type: 'wc'} : {type: 'cpk', cpk: state.alloc.cpk > 0 ? state.alloc.cpk : 1.33};
  const data = p.mode === '1d' ? {items: p.items, spec: p.spec} : {vecs: p.vecs, phi: p.opt.phi, tx: p.opt.tx, ty: p.opt.ty, spec: p.spec};
  let a;
  try { a = allocate(p.mode, data, target); } catch(err) { $('allocBox').innerHTML = `<p class="err">計算できなかった：${esc(err.message)}</p>`; return; }
  lastAlloc = {a, p, target};
  if (!a.hasSpec) { $('allocBox').innerHTML = '<p class="note">規格（下限・上限）を入れると、目標を満たすのに必要な公差を計算する。</p>'; return; }
  const tName = target.type === 'wc' ? 'ワーストケースで規格内' : `出力の Cpk ≥ ${fmtT(target.cpk)}`;
  let h = '';
  // 現状
  const st = a.base.map((r, k) => {
    const sp = p.spec[k] || {};
    if (!isNum(sp.min) && !isNum(sp.max)) return null;
    return `${names.length > 1 ? esc(names[k]) + '：' : ''}Cpk ${fmtCpk(r.cpk)}、ワーストケース ${fmt(r.wcMin)} 〜 ${fmt(r.wcMax)}（規格 ${isNum(sp.min) ? fmt(sp.min) : '—'} 〜 ${isNum(sp.max) ? fmt(sp.max) : '—'}）`;
  }).filter(Boolean);
  h += `<p class="alloc-s">現状：${st.join('<br>')}</p>`;
  h += `<p class="alloc-s"><b>${a.met ? '現状で目標（' + tName + '）を満たしている。' : '現状では目標（' + tName + '）を満たしていない。'}</b></p>`;
  // 案A：全項目を同じ倍率で
  const u = a.uniform;
  if (!a.vars.length) h += '<p class="alloc-s">調整できる項目がない（実測分布と組付けの遊びは対象外）。</p>';
  else if (u.k === null) h += '<p class="alloc-s"><b>案A</b>：調整できる項目の公差をすべて 0 にしても届かない。対象外の項目（実測分布・組付けの遊び）か、平均の位置が原因。</p>';
  else {
    const pct = Math.round((u.k - 1) * 100);
    const msg = u.cap ? '全項目の公差を 10 倍以上に広げても成立する。'
      : u.k >= 1 ? `全項目の公差を <b>×${u.k.toFixed(3)}</b>（${pct >= 0 ? '+' : ''}${pct}%）まで広げても成立する。`
      : `全項目の公差を <b>×${u.k.toFixed(3)}</b>（${pct}%）に縮めれば成立する。`;
    h += `<p class="alloc-s"><b>案A　全項目を同じ倍率で変える</b>：${msg}${u.cap ? '' : ' <button class="sm" data-apply="u">この案を反映</button>'}</p>`;
    if (!u.cap) h += `<details class="note"><summary>変更後の公差</summary><p class="note">${a.vars.map(v => `${esc(allocLabel(p, v))}：${allocTol(p, v)} → ${allocTol(p, v, u.k)}`).join('<br>')}</p></details>`;
  }
  // 案B：1項目だけ変える
  if (a.vars.length) {
    const rows = a.single.map((s, n) => ({s, n})).sort((x, y) => (y.s.k ?? -1) - (x.s.k ?? -1));
    h += `<p class="alloc-s"><b>案B　1項目だけ変える</b>（効きやすい順）</p><div class="scroll"><table class="tb"><thead><tr><th class="l">項目</th><th>現在</th><th>必要（上限）</th><th>倍率</th><th></th></tr></thead><tbody>`;
    h += rows.map(({s, n}) => {
      const v = a.vars[n];
      const need = s.k === null ? 'この項目だけでは不可' : s.cap ? '10倍以上でも可' : allocTol(p, v, s.k);
      const kk = s.k === null ? '—' : s.cap ? '≥10' : '×' + s.k.toFixed(3);
      const btn = s.k !== null && !s.cap ? `<button class="sm" data-apply="s${n}">反映</button>` : '';
      return `<tr><td class="l">${esc(allocLabel(p, v))}</td><td>${allocTol(p, v)}</td><td>${need}</td><td>${kk}</td><td>${btn}</td></tr>`;
    }).join('');
    h += '</tbody></table></div>';
  }
  // 平均の位置
  if (target.type === 'cpk') a.center.forEach((c, k) => {
    if (c === null) return;
    const sp = p.spec[k], half = (sp.max - sp.min) / 2;
    if (Math.abs(c) > half * 0.02) h += `<p class="note">${names.length > 1 ? esc(names[k]) + '：' : ''}平均が規格の中心から ${fmt(-c)} ずれている。基準寸法などで ${c > 0 ? '+' : ''}${fmt(c)} 寄せると中心に来て、必要な公差は緩くなる。</p>`;
  });
  if (p.mode === '1d') {
    const ex = p.items.filter(it => it.dist === 'meas' || it.type === 'float').map(it => esc(it.name));
    if (ex.length) h += `<p class="note">対象外（固定として計算）：${ex.join('、')}</p>`;
  }
  h += `<p class="note">逆算は正規近似（統計±3σ）とワーストケースで行い、モンテカルロは使っていない。公差域の中心は変えない。反映すると公差は 0.001 単位に切り捨てる。位置度は φt だけを変え、ボーナス公差のもとのサイズ公差は変えない。</p>`;
  $('allocBox').innerHTML = h;
}
// 逆算の結果を入力に反映する
$('allocBox').addEventListener('click', e => {
  const b = e.target.closest('[data-apply]'); if (!b || !lastAlloc) return;
  const {a, p} = lastAlloc, key = b.dataset.apply;
  const pairs = key === 'u' ? a.vars.map(v => [v, a.uniform.k]) : [[a.vars[+key.slice(1)], a.single[+key.slice(1)].k]];
  for (const [v, k] of pairs) {
    if (p.mode === '1d') {
      const it = state.d1.items[p.items[v.i].idx];
      if (it.type === 'dim') { const c = (it.up + it.lo) / 2, hn = floor3(k * (it.up - it.lo) / 2); it.up = +(c + hn).toFixed(4); it.lo = +(c - hn).toFixed(4); }
      else it.t = floor3(k * it.t);
    } else {
      const q = state.d2.vecs[p.vecs[v.i].idx], [uk, lk] = v.part === 'l' ? ['lup', 'llo'] : ['aup', 'alo'];
      const c = (q[uk] + q[lk]) / 2, hn = floor3(k * (q[uk] - q[lk]) / 2);
      q[uk] = +(c + hn).toFixed(4); q[lk] = +(c - hn).toFixed(4);
    }
  }
  commit(); save(); renderInputs(); calc();
  notice('逆算の結果を公差に反映した。「元に戻す」で戻せる。');
});

// ===== ケースの比較 =====
const caseCache = new Map();
function caseResult(mode, data){
  const p = prepare(mode, data);
  if (p.empty) return null;
  const res = compute(p, 0);
  const nC = Math.min(state.n, 100000);
  if (nC > 0) {
    const key = JSON.stringify([mode, data, nC]);
    const c = caseCache.get(key);
    if (c && c !== 'pending') return {p, res: c, pending: false};
    if (!c) {
      caseCache.set(key, 'pending');
      runJob({mode, items: p.items, vecs: p.vecs, opt: p.opt, n: nC}, m => { if (!m.error) { caseCache.set(key, m.r); renderCases(); } });
    }
    return {p, res, pending: true};
  }
  return {p, res, pending: false};
}
function renderCases(){
  const list = [{name: '現在の入力', cur: true, mode: state.mode, data: state.mode === '1d' ? state.d1 : state.d2}, ...cases.map((c, i) => ({...c, i}))];
  let h = `<div class="scroll"><table class="tb wide"><thead><tr><th class="l">ケース</th><th class="l">出力</th><th>ワーストケース</th><th>統計 ±3σ</th><th>Cpk</th><th>規格外れ率<br>MC / 正規</th><th>判定</th><th></th></tr></thead><tbody>`;
  for (const c of list) {
    let rr;
    if (c.cur) rr = last ? {p: last.p, res: last.res, pending: last.pending} : null;
    else rr = caseResult(c.mode, c.data);
    const ops = c.cur ? '' : `<button class="sm" data-cload="${c.i}">呼び出す</button> <button class="sm" data-cdel="${c.i}">削除</button>`;
    const title = `${esc(c.name)}<br><span class="sub" style="color:var(--sub);font-size:11px">${c.mode === '1d' ? '1次元' : '2次元'}</span>`;
    if (!rr) { h += `<tr${c.cur ? ' class="cur"' : ''}><td class="l">${title}</td><td class="l" colspan="6">計算できる項目がない</td><td>${ops}</td></tr>`; continue; }
    const outs = rr.res.outs, nm = outNames(c.mode, c.mode === '2d' ? c.data : state.d2);
    outs.forEach((o, k) => {
      const mc = rr.pending ? '…' : o.mc ? ppmText(o.mc.ppm) : '—';
      const v = o.verdict ? `<span class="v-${o.verdict}">${{ok:'合格', warn:'条件付き', ng:'不合格'}[o.verdict]}</span>` : '—';
      h += `<tr${c.cur ? ' class="cur"' : ''}>${k === 0 ? `<td class="l" rowspan="${outs.length}">${title}</td>` : ''}<td class="l">${esc(nm[k])}</td>
        <td>${fmt(o.wcMin)} 〜 ${fmt(o.wcMax)}</td><td>${fmt(o.stMin)} 〜 ${fmt(o.stMax)}</td><td>${fmtCpk(o.cpk)}</td>
        <td>${mc} / ${ppmText(o.ppmNormal)}</td><td>${v}</td>${k === 0 ? `<td rowspan="${outs.length}">${ops}</td>` : ''}</tr>`;
    });
  }
  h += '</tbody></table></div>';
  if (!cases.length) h += '<p class="note">対策前・対策後のように入力を保存しておくと、ここに並べて比べられる。ケースはこの端末のブラウザに保存される（元に戻すの対象外）。</p>';
  $('casesBox').innerHTML = h;
}
$('caseSave').onclick = () => {
  const name = $('caseName').value.trim() || `ケース${cases.length + 1}`;
  cases.push({name, saved: new Date().toISOString(), mode: state.mode, data: clone(state.mode === '1d' ? state.d1 : state.d2)});
  saveCases(); $('caseName').value = ''; renderCases();
};
$('casesBox').addEventListener('click', e => {
  const ld = e.target.closest('[data-cload]'), dl = e.target.closest('[data-cdel]');
  if (ld) {
    const c = cases[+ld.dataset.cload];
    state.mode = c.mode; state[c.mode === '1d' ? 'd1' : 'd2'] = clone(c.data); sel = null;
    commit(); save(); renderInputs(); calc();
    notice(`「${c.name}」を呼び出した。呼び出す前の入力には「元に戻す」で戻れる。`);
  } else if (dl) {
    const c = cases[+dl.dataset.cdel];
    if (confirm(`ケース「${c.name}」を削除しますか？（元に戻せない）`)) { cases.splice(+dl.dataset.cdel, 1); saveCases(); renderCases(); }
  }
});

// ===== 共有URL =====
const b64u = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = str => { str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; const bin = atob(str), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
async function encodeShare(){
  const bytes = new TextEncoder().encode(snap());
  if (typeof CompressionStream === 'function') {
    try { return 'z=' + b64u(new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())); } catch(e) {}
  }
  return 'j=' + b64u(bytes);
}
async function decodeShare(hash){
  const m = /^#?(z|j)=([A-Za-z0-9_-]+)$/.exec(hash); if (!m) return null;
  let bytes = unb64u(m[2]);
  if (m[1] === 'z') bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function loadFromHash(){
  if (!/^#(z|j)=/.test(location.hash)) return;
  try {
    const d = await decodeShare(location.hash);
    const s = sanitize(d);
    if (commitTimer) commit();
    state = s.state; sel = null;
    commit(); save(); renderInputs(); calc();
    notice('共有URLの内容を読み込んだ。読み込む前の入力には「元に戻す」で戻れる。' + (s.dropped ? `（読めない項目 ${s.dropped} 件を外した）` : ''));
  } catch(e) { notice('共有URLを読み込めなかった（URLが途中で切れている可能性がある）。'); }
  history.replaceState(null, '', location.pathname + location.search);
}
$('share').onclick = async () => {
  if (commitTimer) commit();
  $('shareUrl').value = location.href.split('#')[0] + '#' + await encodeShare();
  $('sharePanel').hidden = false; $('shareUrl').select();
};
$('shareCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('shareUrl').value); $('shareCopy').textContent = 'コピーした'; }
  catch(e) { $('shareUrl').select(); try { document.execCommand('copy'); $('shareCopy').textContent = 'コピーした'; } catch(_) { $('shareCopy').textContent = '手動でコピー'; } }
  setTimeout(() => $('shareCopy').textContent = 'コピー', 2000);
};
$('shareClose').onclick = () => { $('sharePanel').hidden = true; };
addEventListener('hashchange', loadFromHash);

// ===== 印刷用レポート =====
function nowText(){ const d = new Date(), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; }
function itemValueText(it){
  let s;
  if (it.type === 'dim') s = `${fmtT(it.nom)}（${tolText(it)}）`;
  else if (it.type === 'prof') s = `t ${fmtT(it.t)}`;
  else if (it.type === 'pos') s = `φ${fmtT(it.t)}${it.mmc ? ` Ⓜ（サイズ ${sgn(it.sup)}/${sgn(it.slo)}）` : ''}`;
  else s = `穴 ${fmtT(it.hnom)} ${sgn(it.hup)}/${sgn(it.hlo)}、軸 ${fmtT(it.fnom)} ${sgn(it.fup)}/${sgn(it.flo)}`;
  return s;
}
function distText(o){
  let s = DIST_NAME[o.dist] || o.dist;
  if (o.dist === 'cpk') s += `（Cpk ${fmtT(o.cpk)}${o.shift ? `、平均のずれ ${fmtT(o.shift)}` : ''}）`;
  if (o.dist === 'meas') s += `（平均 ${fmtT(o.mean)}、σ ${fmtT(o.sd)}）`;
  return s;
}
function buildReport(){
  if (!last) { $('report').innerHTML = '<p>計算できる入力がない。</p>'; return; }
  const p = last.p, names = outNames(), o0 = last.res.outs;
  let h = `<h1>公差積み上げ計算 レポート</h1><p>作成：${nowText()}　計算の種類：${p.mode === '1d' ? '1次元' : '2次元ベクトルループ'}　モンテカルロ：${state.n ? state.n.toLocaleString('ja-JP') + ' 回（乱数の種 1）' : '行わない'}</p>`;
  h += '<h2>入力</h2><table class="tb"><thead><tr>';
  if (p.mode === '1d') {
    h += '<th class="l">#</th><th class="l">名称</th><th class="l">種類</th><th>係数</th><th class="l">値</th><th class="l">分布</th><th>±半幅</th></tr></thead><tbody>';
    h += p.items.map((it, k) => `<tr><td class="l">${it.idx + 1}</td><td class="l">${esc(it.name)}</td><td class="l">${TYPE_NAME[it.type]}</td><td>${fmtT(it.coef)}</td><td class="l">${itemValueText(it)}</td><td class="l">${distText(it)}</td><td>${fmtT(o0[0].contrib[k].h)}</td></tr>`).join('');
  } else {
    h += '<th class="l">#</th><th class="l">名称</th><th>長さ</th><th>角度（°）</th><th class="l">角度の基準</th><th class="l">分布</th></tr></thead><tbody>';
    h += p.vecs.map(v => `<tr><td class="l">${v.idx + 1}</td><td class="l">${esc(v.name)}</td><td>${fmtT(v.ln)} ${sgn(v.lup)}/${sgn(v.llo)}</td><td>${fmtT(v.an)} ${sgn(v.aup)}/${sgn(v.alo)}</td><td class="l">${v.rel ? '前のベクトルから' : 'x軸から'}</td><td class="l">${distText(v)}</td></tr>`).join('');
  }
  h += '</tbody></table>';
  if (p.mode === '2d') h += `<p>測定方向 ${fmtT(p.opt.phi)}°、目標点 (${fmtT(p.opt.tx)}, ${fmtT(p.opt.ty)})</p>`;
  if (p.errs.length) h += `<p>入力に不備があり計算から外した行：${p.errs.map(i => i + 1).join('・')}</p>`;
  h += `<p>規格：${p.spec.map((sp, k) => `${esc(names[k])} ${isNum(sp.min) ? fmt(sp.min) : '—'} 〜 ${isNum(sp.max) ? fmt(sp.max) : '—'}`).join('　')}</p>`;
  h += '<h2>結果</h2>' + $('resBox').innerHTML;
  h += '<h2>図</h2>';
  (p.mode === '1d' ? ['blockFig', 'distFig0'] : ['vecFig', 'distFig0', 'distFig1']).forEach(id => { h += `<div class="fig">${$(id).innerHTML}</div>`; });
  h += '<h2>寄与率</h2><table class="tb"><thead><tr><th class="l">項目</th><th>±半幅</th><th>係数・感度</th>' + (p.mode === '1d' ? '<th>統計の寄与</th><th>WCの寄与</th>' : `<th>${esc(names[0])}の寄与</th><th>${esc(names[1])}の寄与</th>`) + '</tr></thead><tbody>';
  if (p.mode === '1d') h += p.items.map((it, k) => { const c = o0[0].contrib[k]; return `<tr><td class="l">${esc(it.name)}</td><td>${fmtT(c.h)}</td><td>${fmtT(c.a)}</td><td>${pctT(c.var)}</td><td>${pctT(c.wc)}</td></tr>`; }).join('');
  else p.vecs.forEach((v, i) => ['長さ', '角度'].forEach((t, j) => { const k = 2 * i + j, c0 = o0[0].contrib[k], c1 = o0[1].contrib[k]; h += `<tr><td class="l">${esc(v.name)} ${t}</td><td>${fmtT(c0.h)}</td><td>${fmtT(c0.a)} / ${fmtT(c1.a)}</td><td>${pctT(c0.var)}</td><td>${pctT(c1.var)}</td></tr>`; }));
  h += '</tbody></table>';
  if (lastAlloc && lastAlloc.a.hasSpec) h += `<h2>必要な公差の逆算（目標：${lastAlloc.target.type === 'wc' ? 'ワーストケースで規格内' : '出力の Cpk ≥ ' + fmtT(lastAlloc.target.cpk)}）</h2>` + $('allocBox').innerHTML.replace(/<details[^>]*>/g, '<details open>');
  h += `<h2>計算の前提</h2><p class="note">ワーストケース：各項目の |係数|×公差の半幅 の和（2次元は感度係数による線形近似）。統計：各項目の分布から求めた σ に係数を掛けた二乗和平方根（正規分布の項目は公差＝±3σ）。判定：全部品が公差内である前提でワーストケースが規格内なら合格、統計（モンテカルロの 0.135〜99.865%、なければ ±3σ）で規格内なら条件付き、それ以外は不合格。</p>`;
  $('report').innerHTML = h;
}
async function waitMC(){ for (let i = 0; i < 100 && last && last.pending; i++) await new Promise(r => setTimeout(r, 100)); }
$('print').onclick = async () => { await waitMC(); buildReport(); window.print(); };
addEventListener('beforeprint', buildReport);

// ===== ファイルへの保存 =====
$('exp').onclick = () => {
  const blob = new Blob([JSON.stringify({...JSON.parse(snap()), cases}, null, 2)], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'stackup.json'; a.click();
  URL.revokeObjectURL(a.href);
};
$('imp').onclick = () => $('file').click();
$('file').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || typeof d !== 'object' || !(Array.isArray(d.rows) || d.d1 || d.d2)) throw 0;
    const s = sanitize(d);
    if (commitTimer) commit();
    state = s.state; sel = null;
    let added = 0;
    if (Array.isArray(d.cases)) { const cs = d.cases.map(sanCase).filter(Boolean); cases.push(...cs); added = cs.length; saveCases(); }
    commit(); save(); renderInputs(); calc();
    notice(`ファイルを読み込んだ。${added ? `ケース ${added} 件を一覧に追加した。` : ''}${s.dropped ? `読めない項目 ${s.dropped} 件を外した。` : ''}読み込む前の入力には「元に戻す」で戻れる。`);
  } catch(_) { notice('読み込めない形式のファイルだった。'); }
  e.target.value = '';
};

// ===== 起動 =====
initWorker();
try {
  renderInputs(); calc();
} catch(err) {
  // 想定外の保存データで描画できない場合は、初期状態に戻して起動する
  state = freshState(); sel = null; save();
  renderInputs(); calc();
  notice('保存データを読み込めなかったため、初期状態に戻した。');
}
hist = [snap()]; hpos = 0; updUndo();
if (L0.broken) notice('保存データが壊れていたため、初期状態に戻した。');
else if (L0.dropped) notice(`保存データのうち読めない項目 ${L0.dropped} 件を外した。`);
loadFromHash();
// 画面幅が変わったら図を描き直す
let rsz; addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(() => { if (last) { renderFigs(); } }, 150); });
// ===== 画面ここまで =====
