# エンジンの計算結果を、Python で独立に計算し直して照合する
#   node tests/cases.js → python tests/verify.py
import json, math, itertools, random
from pathlib import Path

d = json.loads((Path(__file__).parent / 'out.json').read_text(encoding='utf-8'))
fails = []
def check(name, got, exp, tol):
    ok = abs(got - exp) <= tol
    print(f"{'OK ' if ok else 'NG '} {name}: エンジン {got:.6f} / 検算 {exp:.6f}")
    if not ok: fails.append(name)

# ---- 1次元：各項目の (係数, 中心, 半幅, 平均, σ) を独立に求める ----
def model(it):
    a, t = it['coef'], it['type']
    if t == 'dim':
        c = it['nom'] + (it['up'] + it['lo']) / 2; h = (it['up'] - it['lo']) / 2
        dist = it['dist']
        sd = {'normal': h/3, 'uniform': h/math.sqrt(3), 'tri': h/math.sqrt(6)}.get(dist)
        mu = c
        if dist == 'cpk': sd = h / (3 * it['cpk'])
        if dist == 'meas': mu, sd = it['mean'], it['sd']
        return a, it['nom'], c, h, mu, sd
    if t == 'prof':
        h = it['t'] / 2
        return a, 0, 0, h, 0, {'normal': h/3, 'uniform': h/math.sqrt(3), 'tri': h/math.sqrt(6)}[it['dist']]
    if t == 'pos':
        w = (it['sup'] - it['slo']) if it['mmc'] else 0
        h = (it['t'] + w) / 2
        # 公差域の直径 D = t + ボーナス（ボーナスは平均 w/2、σ w/6）。円内一様なら1方向の分散は E[(D/2)²]/4
        ED2 = (it['t'] + w/2)**2 + (w/6)**2
        sd = math.sqrt(ED2/4/4) if it['dist'] == 'disc' else math.sqrt(ED2/4/9)
        return a, 0, 0, h, 0, sd
    if t == 'float':
        hmax = it['hnom'] + it['hup']; fmin = it['fnom'] + it['flo']
        h = (hmax - fmin) / 2
        cm = (it['hnom'] + (it['hup']+it['hlo'])/2) - (it['fnom'] + (it['fup']+it['flo'])/2)
        cv = ((it['hup']-it['hlo'])/6)**2 + ((it['fup']-it['flo'])/6)**2
        return a, 0, 0, h, 0, math.sqrt((cm*cm + cv) / 12)

for k, case in enumerate(d['d1'], 1):
    items, r = case['items'], case['res']
    ms = [model(it) for it in items]
    check(f'1次元 例{k} 基準値', r['nom'], sum(a*n for a, n, *_ in ms), 1e-9)
    # ワーストケースは、寸法の上下限の全組み合わせ（総当たり）と、幾何公差・遊びの ±半幅 で求める
    lims = [(c - h, c + h) for a, n, c, h, mu, sd in ms]
    vals = [sum(a * v for (a, *_), v in zip(ms, combo)) for combo in itertools.product(*lims)]
    check(f'1次元 例{k} WC最小（総当たり）', r['wcMin'], min(vals), 1e-9)
    check(f'1次元 例{k} WC最大（総当たり）', r['wcMax'], max(vals), 1e-9)
    mu = sum(a*m for a, n, c, h, m, sd in ms); sd = math.sqrt(sum((a*s)**2 for a, n, c, h, m, s in ms))
    check(f'1次元 例{k} 統計の平均', r['mean'], mu, 1e-9)
    check(f'1次元 例{k} 統計のσ', r['sd'], sd, 1e-9)
    check(f'1次元 例{k} MCのσ（±1.5%）', r['mc']['sd'], sd, sd * 0.015)
    check(f'1次元 例{k} MCの平均（±σ/100）', r['mc']['mean'], mu, sd * 0.01)

# ---- 2次元：ループの式を独立に書き、感度は前進・後退差分で別に求める ----
v, opt = d['d2']['vecs'], d['d2']['opt']
def loop(p):
    th = x = y = 0.0
    for i, q in enumerate(v):
        A = math.radians(p[2*i+1]); th = th + A if q['rel'] else A
        x += p[2*i] * math.cos(th); y += p[2*i] * math.sin(th)
    f = math.radians(opt['phi']); dx, dy = x - opt['tx'], y - opt['ty']
    return [dx*math.cos(f) + dy*math.sin(f), -dx*math.sin(f) + dy*math.cos(f)]
cen, hs, sds = [], [], []
for q in v:
    for nom, up, lo in ((q['ln'], q['lup'], q['llo']), (q['an'], q['aup'], q['alo'])):
        c, h = nom + (up+lo)/2, (up-lo)/2
        cen.append(c); hs.append(h); sds.append({'normal': h/3, 'uniform': h/math.sqrt(3), 'tri': h/math.sqrt(6)}[q['dist']])
f0 = loop(cen)
sens = []
for i in range(len(cen)):
    e = 1e-5; p = cen[:]; p[i] += e; f1 = loop(p)
    sens.append([(f1[k] - f0[k]) / e for k in range(2)])
for i in range(len(cen)):
    for k in range(2):
        check(f'2次元 感度 変数{i+1} 出力{k+1}', d['d2']['sens'][i][k], sens[i][k], 1e-3 * max(1, abs(sens[i][k])))
# モンテカルロ（Python 側でも別の乱数で回す）
random.seed(11)
def samp(c, h, dist):
    if dist == 'uniform': return c + random.uniform(-h, h)
    if dist == 'tri': return c + random.triangular(-h, h, 0)
    return random.gauss(c, h/3)
dists = [q['dist'] for q in v for _ in (0, 1)]
N = 200000; acc = [[0.0, 0.0], [0.0, 0.0]]
for _ in range(N):
    o = loop([samp(c, h, ds) for c, h, ds in zip(cen, hs, dists)])
    for k in range(2): acc[k][0] += o[k]; acc[k][1] += o[k]**2
for k in range(2):
    r = d['d2']['outs'][k]
    check(f'2次元 出力{k+1} 中心値', r['center'], f0[k], 1e-9)
    check(f'2次元 出力{k+1} WC半幅（線形）', r['wcHalf'], sum(abs(s[k])*h for s, h in zip(sens, hs)), 1e-4)
    sd = math.sqrt(sum((s[k]*q)**2 for s, q in zip(sens, sds)))
    check(f'2次元 出力{k+1} 統計のσ（線形）', r['sd'], sd, sd * 1e-3)
    m = acc[k][0]/N; s2 = math.sqrt(acc[k][1]/N - m*m)
    check(f'2次元 出力{k+1} MCのσ（Python のMCと ±2%）', r['mc']['sd'], s2, s2 * 0.02)

print('\n不一致：' + ('なし' if not fails else '、'.join(fails)))
raise SystemExit(1 if fails else 0)
