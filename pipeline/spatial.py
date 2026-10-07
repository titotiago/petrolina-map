"""Geographic layer 2: catchment areas, local spatial autocorrelation (LISA), territorial
domains/conflict, intra-party competition, electoral segments and demographic signatures."""
import geopandas as gpd
import numpy as np
import pandas as pd
from shapely import voronoi_polygons
from shapely.geometry import MultiPoint, Point

from analysis import BRANCO_NULO, fmt, matrix, shares, shares_nan
from common import haversine, r
from geo import METRIC

RNG = np.random.default_rng(2028)
CATCH_MAX_KM = 8.0  # rural cells are capped to this radius so empty caatinga isn't painted


# ------------------------------------------------------------------ catchments
def catchments(base: pd.DataFrame, municipio: gpd.GeoDataFrame, setores: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Voronoi cell of each polling place, clipped to the municipality and a max radius."""
    pts = gpd.GeoSeries([Point(xy) for xy in zip(base.lon, base.lat)], crs=4326).to_crs(METRIC)
    # jitter exact duplicates (approximate coordinates) so every place gets a cell
    seen = {}
    xy = []
    for p in pts:
        k = (round(p.x), round(p.y))
        n = seen.get(k, 0)
        seen[k] = n + 1
        xy.append(Point(p.x + 15 * n, p.y + 15 * n))
    pts = gpd.GeoSeries(xy, crs=METRIC)
    muni = municipio.to_crs(METRIC).geometry.union_all()
    cells = voronoi_polygons(MultiPoint(list(pts)), extend_to=muni.envelope.buffer(5000))
    cell_list = list(cells.geoms)
    geoms = []
    for p in pts:
        c = next(g for g in cell_list if g.contains(p))
        geoms.append(c.intersection(muni).intersection(p.buffer(CATCH_MAX_KM * 1000)))
    g = gpd.GeoDataFrame({"id": base.id.values}, geometry=geoms, crs=METRIC)
    g["area_km2"] = g.area / 1e6
    # census attached through tract -> nearest place (same rule as the Voronoi)
    st = setores.drop_duplicates("CD_SETOR").assign(
        renda_x=lambda d: d.renda_media * d.responsaveis, resp_r=lambda d: d.responsaveis.where(d.renda_media.notna()),
        infra_x=lambda d: d.infra * d.dom_entorno, dom_i=lambda d: d.dom_entorno.where(d.infra.notna()))
    agg = st.groupby("local_id").agg(pop=("v0001", "sum"), pop15=("pop15", "sum"), alfab15=("alfab15", "sum"),
                                     pop_10_14=("pop_10_14", "sum"), pop_15_19=("pop_15_19", "sum"), dom=("v0007", "sum"),
                                     renda_x=("renda_x", "sum"), resp_r=("resp_r", "sum"), infra_x=("infra_x", "sum"), dom_i=("dom_i", "sum"))
    agg["renda_media"] = agg.renda_x / agg.resp_r.replace(0, np.nan)
    agg["infra"] = agg.infra_x / agg.dom_i.replace(0, np.nan)
    agg = agg.drop(columns=["renda_x", "resp_r", "infra_x", "dom_i"])
    g = g.merge(agg, left_on="id", right_index=True, how="left")
    g[["pop", "pop15", "alfab15", "pop_10_14", "pop_15_19", "dom"]] = g[["pop", "pop15", "alfab15", "pop_10_14", "pop_15_19", "dom"]].fillna(0)
    # neighbourhood-smoothed voters per adult (self + 6 nearest places)
    lat, lon, el = base.lat.values, base.lon.values, base.eleitores.values
    p15 = g.pop15.values
    sm = []
    for i in range(len(base)):
        nb = np.argsort(haversine(lat[i], lon[i], lat, lon))[:7]
        sm.append(el[nb].sum() / max(p15[nb].sum(), 1))
    g["eleitor_adulto"] = sm
    return g.to_crs(4326)


def knn_weights(base: pd.DataFrame, k: int = 6) -> np.ndarray:
    lat, lon = base.lat.values, base.lon.values
    n = len(base)
    W = np.zeros((n, n))
    for i in range(n):
        d = haversine(lat[i], lon[i], lat, lon)
        d[i] = np.inf
        W[i, np.argsort(d)[:k]] = 1
    return W / W.sum(axis=1, keepdims=True)


# ------------------------------------------------------------------ LISA
_PERM = {}


def _perm_index(n: int, k: int, perms: int):
    """Shared conditional-permutation draws: for place i, `perms` random k-subsets of the other places."""
    key = (n, k, perms)
    if key not in _PERM:
        idx = np.empty((n, perms, k), dtype=int)
        for i in range(n):
            others = np.delete(np.arange(n), i)
            idx[i] = others[RNG.random((perms, n - 1)).argsort(1)[:, :k]]
        _PERM[key] = idx
    return _PERM[key]


def lisa(x: np.ndarray, W: np.ndarray, perms: int = 9999):
    """Local Moran's I with conditional permutation pseudo p-values. Returns (I, p, quadrant, global I)."""
    z = (x - x.mean()) / (x.std() or 1)
    lag = W @ z
    I = z * lag
    n = len(z)
    k = int((W[0] > 0).sum())
    idx = _perm_index(n, k, perms)
    sim = z[:, None] * z[idx].mean(axis=2)  # (n, perms)
    # one-sided test in the direction of the observed association (as in PySAL's folded p-values)
    pos = I >= 0
    extreme = np.where(pos[:, None], sim >= I[:, None], sim <= I[:, None]).sum(axis=1)
    p = (extreme + 1) / (perms + 1)
    quad = np.where(z > 0, np.where(lag > 0, "HH", "HL"), np.where(lag > 0, "LH", "LL"))
    gI = float((z * lag).sum() / (z * z).sum())
    return I, p, quad, gI


def lisa_all(ctx, cands, W) -> dict:
    """Clusters for each elected councillor + top alternates + mayor 2024 + 2026 governor leaders."""
    ids = ctx.base.id.values
    out = {}
    sh = shares(matrix(ctx, 2024, "vereador"))
    targets = [c["numero"] for c in cands if c["eleito"]] + [c["numero"] for c in cands if not c["eleito"]][:15]
    for n in targets:
        x = sh[n].values if n in sh else np.zeros(len(ids))
        _, p, q, gI = lisa(x, W)
        out[f"vereador:{n}"] = _lisa_pack(ids, p, q, gI, x)
    for (y, cargo, nums) in [(2024, "prefeito", ["44", "45"]), (2026, "governador", None), (2026, "senador", None)]:
        s = shares(matrix(ctx, y, cargo, include_legenda=cargo == "prefeito"))
        s = s[[c for c in s.columns if c not in BRANCO_NULO]]
        for n in nums or list(s.sum().sort_values(ascending=False).index[:3]):
            _, p, q, gI = lisa(s[n].values, W)
            out[f"{cargo}{y}:{n}"] = _lisa_pack(ids, p, q, gI, s[n].values)
    return out


def _lisa_pack(ids, p, q, gI, x):
    """Classes: HH reduto, HL ilha, LH brecha (significant); '0' = no votes (deterministic); 'ns' otherwise.
    Low-surrounded-by-low (LL) only describes absence, so it is folded into 'ns' / '0'."""
    sig = p < 0.05
    cls = {}
    for i, qq, s_, v in zip(ids, q, sig, x):
        if s_ and qq in ("HH", "HL", "LH"):
            cls[i] = str(qq)  # a zero inside a strong area stays a 'brecha' — that is actionable
        elif v <= 0:
            cls[i] = "0"
        else:
            cls[i] = "ns"
    return {"moran": r(gI, 3), "classe": cls, "redutos": [i for i, c in cls.items() if c == "HH"]}


# ------------------------------------------------------------------ domains / conflict
def domains(ctx, cands) -> dict:
    mv = matrix(ctx, 2024, "vereador")
    sh = shares(mv)
    elected = [c["numero"] for c in cands if c["eleito"]]
    names = {c["numero"]: c["nome"] for c in cands}
    e = sh.loc[mv.sum(axis=1) >= 50, elected]  # ignore places with (almost) no votes
    out = {}
    for pid, row in e.iterrows():
        top = row.sort_values(ascending=False)
        strong = top[top >= 0.06]
        pair = None
        if len(top) > 1:
            pair = {"a": top.index[0], "b": top.index[1], "min": r(top.iloc[1])}
        out[pid] = {
            "lider": top.index[0], "lider_pct": r(top.iloc[0]), "segundo": top.index[1], "segundo_pct": r(top.iloc[1]),
            "n_fortes": int(len(strong)), "terra_de_ninguem": bool(top.iloc[0] < 0.08),
            "conflito": r(float(top.iloc[1]) * (len(strong) >= 2)),  # strength of the runner-up when 2+ strong
            "par": pair, "fortes": [{"numero": k, "pct": r(v)} for k, v in strong.items()],
        }
    # how many places each elected councillor "owns" and contested places per pair
    owner = pd.Series({k: v["lider"] for k, v in out.items() if not v["terra_de_ninguem"]}).value_counts()
    conflicts = {}
    for k, v in out.items():
        fs = [f["numero"] for f in v["fortes"]]
        for i in range(len(fs)):
            for j in range(i + 1, len(fs)):
                key = tuple(sorted((fs[i], fs[j])))
                conflicts.setdefault(key, []).append(k)
    top_conf = sorted(conflicts.items(), key=lambda kv: -len(kv[1]))[:25]
    return {"locais": out, "dominio": {k: int(v) for k, v in owner.items()},
            "conflitos": [{"a": a, "b": b, "a_nome": names[a], "b_nome": names[b], "locais": ls} for (a, b), ls in top_conf]}


# ------------------------------------------------------------------ intra-party competition
def intra_party(ctx, cands, ov_fn) -> dict:
    """For each elected councillor: same-party candidates sharing territory (threat for the list position)."""
    m = matrix(ctx, 2024, "vereador")
    dist = m / m.sum().replace(0, np.nan)
    by_party = {}
    for c in cands:
        by_party.setdefault(c["partido_chave"], []).append(c)
    out = {}
    for c in cands:
        if not c["eleito"]:
            continue
        p = dist[c["numero"]].fillna(0).values
        rivals = []
        for o in by_party[c["partido_chave"]]:
            if o["numero"] == c["numero"] or o["votos"] < 0.25 * c["votos"]:
                continue
            q = dist[o["numero"]].fillna(0).values if o["numero"] in dist else np.zeros_like(p)
            s = float(np.minimum(p, q).sum())
            rivals.append({"numero": o["numero"], "nome": o["nome"], "votos": o["votos"], "eleito": o["eleito"], "sobreposicao": r(s, 3),
                           "ameaca": r(s * min(1.0, o["votos"] / c["votos"]), 3)})
        rivals.sort(key=lambda x: -x["ameaca"])
        out[c["numero"]] = rivals[:5]
    return out


# ------------------------------------------------------------------ electoral segments (k-means)
FEATURES = {
    "simao": "voto em Simão", "julio": "voto em Dr. Julio", "comparecimento": "comparecimento", "fragmentacao": "fragmentação do voto",
    "voto_eleitos": "voto em eleitos", "jovem": "eleitores jovens", "idoso": "eleitores 60+", "superior": "ensino superior",
    "baixa_esc": "baixa escolaridade", "swing": "ganho do grupo Coelho", "raquel": "voto em Raquel Lyra (2026)",
}


def place_features(ctx) -> pd.DataFrame:
    ids = ctx.base.id
    pf = shares(matrix(ctx, 2024, "prefeito"))
    pf20 = shares_nan(matrix(ctx, 2020, "prefeito"))   # NaN where the place didn't exist in 2020
    gov = shares_nan(matrix(ctx, 2026, "governador"))
    ver = matrix(ctx, 2024, "vereador")
    vs = shares(ver)
    nominal = vs[[c for c in vs.columns if len(c) > 2]]
    elected = [c for c in nominal.columns if c in ctx._elected]
    d = ctx.det[2024]
    d = d[d.cargo == "prefeito"].set_index("place").reindex(ids)
    prof = ctx.perfil.reindex(ids).fillna(0)
    tot = prof.total.replace(0, np.nan)
    f = pd.DataFrame(index=ids)
    f["simao"] = pf.get("44", 0)
    f["julio"] = pf.get("45", 0)
    f["comparecimento"] = (d.QT_COMPARECIMENTO / d.QT_APTOS).values
    nn = nominal.div(nominal.sum(axis=1), axis=0)
    f["fragmentacao"] = 1 / (nn ** 2).sum(axis=1)
    f["voto_eleitos"] = vs[elected].sum(axis=1)
    f["jovem"] = (prof["idade_16-17"] + prof["idade_18-24"]) / tot
    f["idoso"] = prof["idade_60+"] / tot
    f["superior"] = prof.esc_superior / tot
    f["baixa_esc"] = prof.esc_baixa / tot
    f["swing"] = f.simao - pf20.get("15", 0)
    f["raquel"] = gov.get("55", 0)
    return f.fillna(f.mean())


def kmeans(X: np.ndarray, k: int, w: np.ndarray, iters=100, inits=30):
    best, best_inertia = None, np.inf
    for _ in range(inits):
        C = X[RNG.choice(len(X), k, replace=False)]
        for _ in range(iters):
            lab = ((X[:, None, :] - C[None]) ** 2).sum(-1).argmin(1)
            newC = np.array([np.average(X[lab == j], axis=0, weights=w[lab == j]) if (lab == j).any() else C[j] for j in range(k)])
            if np.allclose(newC, C):
                break
            C = newC
        inertia = (w * ((X - C[lab]) ** 2).sum(-1)).sum()
        if inertia < best_inertia:
            best, best_inertia = (lab, C), inertia
    return best


def segments(ctx, cands, k=6) -> dict:
    f = place_features(ctx)
    mu, sd = f.mean(), f.std().replace(0, 1)
    X = ((f - mu) / sd).values
    w = ctx.base.set_index("id").eleitores.reindex(f.index).values.astype(float)
    lab, C = kmeans(X, k, w)
    # order segments by electorate size
    sizes = pd.Series(w).groupby(lab).sum().sort_values(ascending=False)
    remap = {old: new for new, old in enumerate(sizes.index)}
    lab = np.array([remap[x] for x in lab])
    C = C[sizes.index]
    vm = matrix(ctx, 2024, "vereador")
    names = {c["numero"]: c for c in cands}
    segs = []
    for j in range(k):
        z = pd.Series(C[j], index=f.columns)
        top = z.abs().sort_values(ascending=False).index[:3]
        label = " · ".join(f"{'mais' if z[t] > 0 else 'menos'} {FEATURES[t]}" for t in top[:2])
        members = f.index[lab == j]
        votes = vm.loc[members].sum()
        votes = votes[[c for c in votes.index if len(c) > 2]].sort_values(ascending=False)
        segs.append({
            "id": j, "rotulo": label, "locais": list(members), "eleitores": int(w[lab == j].sum()),
            "media": {c: r(float(f.loc[members, c].mean()), 4) for c in f.columns},
            "z": {c: r(float(z[c]), 2) for c in f.columns},
            "vereadores": [{"numero": n, "nome": names[n]["nome"], "votos": int(v), "eleito": names[n]["eleito"]} for n, v in votes.head(6).items() if n in names],
        })
    return {"k": k, "features": FEATURES, "cidade": {c: r(float(mu[c]), 4) for c in f.columns}, "segmentos": segs,
            "por_local": {pid: int(l) for pid, l in zip(f.index, lab)}}


# ------------------------------------------------------------------ demographic signatures
def signatures(ctx, cands, catch) -> dict:
    f = place_features(ctx)
    cg = catch.set_index("id")
    f["alfab_censo"] = (cg.alfab15 / cg.pop15.replace(0, np.nan)).reindex(f.index)
    f["densidade"] = np.log1p((cg["pop"] / cg.area_km2.replace(0, np.nan)).reindex(f.index))
    f = f.fillna(f.mean())
    labels = {**FEATURES, "alfab_censo": "alfabetização (Censo)", "densidade": "densidade populacional"}
    sh = shares(matrix(ctx, 2024, "vereador"))
    w = ctx.base.set_index("id").eleitores.reindex(f.index).values.astype(float)
    out = {}
    for c in cands:
        if not c["eleito"] and c["votos"] < 1500:
            continue
        x = sh[c["numero"]].values

        def wcorr(a, b):
            am, bm = np.average(a, weights=w), np.average(b, weights=w)
            cov = np.average((a - am) * (b - bm), weights=w)
            return cov / np.sqrt(np.average((a - am) ** 2, weights=w) * np.average((b - bm) ** 2, weights=w))

        cs = {k: float(wcorr(x, f[k].values)) for k in f.columns if k not in ("voto_eleitos",)}
        best = sorted(cs.items(), key=lambda kv: -abs(kv[1]))[:4]
        out[c["numero"]] = [{"var": k, "rotulo": labels[k], "r": r(v, 2)} for k, v in best]
    return out


# ------------------------------------------------------------------ extra insights
def extra_insights(ctx, cands, dom, intra, segs, lisas, catch, add):
    names = {c["numero"]: c["nome"] for c in cands}
    el = [c for c in cands if c["eleito"]]
    base = ctx.base.set_index("id")
    # territorial domain
    d = dom["dominio"]
    top = sorted(d.items(), key=lambda kv: -kv[1])[:4]
    tn = [k for k, v in dom["locais"].items() if v["terra_de_ninguem"]]
    tn_el = int(base.loc[tn, "eleitores"].sum())
    none = [c["nome"] for c in el if d.get(c["numero"], 0) == 0]
    add("geografia", "Quem é 'dono' de mais território",
        "Eleitos que lideram mais locais (entre os eleitos): " + ", ".join(f"{names[k]} ({v} locais)" for k, v in top)
        + f". {len(none)} eleitos não lideram nenhum local — votação espalhada, sem reduto próprio: " + ", ".join(none[:8]) + ".",
        0.86, {"tab": "geografia", "modo": "dominio"})
    add("geografia", "Terra de ninguém",
        f"{len(tn)} locais ({fmt(tn_el)} eleitores) não têm nenhum vereador eleito com mais de 8% dos votos. São o principal espaço de expansão para 2028: "
        + ", ".join(base.loc[i, "nome"].title() for i in sorted(tn, key=lambda i: -base.loc[i, "eleitores"])[:5]) + ".",
        0.9, {"tab": "geografia", "modo": "dominio"})
    c0 = dom["conflitos"][:3]
    add("geografia", "Zonas de conflito entre eleitos",
        "; ".join(f"{c['a_nome']} × {c['b_nome']}: ambos com 6%+ em {len(c['locais'])} locais" for c in c0) + ".",
        0.84, {"tab": "geografia", "modo": "conflito"})
    # LISA
    ml = sorted([(c, lisas.get(f"vereador:{c['numero']}", {})) for c in el], key=lambda x: -(x[1].get("moran") or 0))
    add("geografia", "Força territorial estatisticamente agrupada",
        "Moran's I mede o quanto a votação forma manchas contíguas (1 = totalmente agrupada). Mais agrupados: "
        + ", ".join(f"{c['nome']} (I={l['moran']:.2f}, {len(l['redutos'])} locais-reduto)" for c, l in ml[:3])
        + ". Menos agrupados: " + ", ".join(f"{c['nome']} (I={l['moran']:.2f})" for c, l in ml[-3:]) + " — dependem de rede pessoal, não de bairro.",
        0.8, {"tab": "geografia", "modo": "lisa"})
    # intra-party
    threats = []
    for c in el:
        t = next((t for t in intra.get(c["numero"], []) if not t["eleito"] and t["ameaca"] >= 0.3), None)
        if t:
            threats.append((c, t))
    threats.sort(key=lambda x: -x[1]["ameaca"])
    if threats:
        add("vereadores", "Ameaça dentro do próprio partido",
            "Suplentes do mesmo partido que disputam o mesmo território do eleito (sobreposição × força relativa): "
            + "; ".join(f"{c['nome']} ← {t['nome']} ({t['sobreposicao'] * 100:.0f}% sobreposição, {fmt(t['votos'])} votos)" for c, t in threats[:6])
            + ". Na lista proporcional, o rival mais perigoso costuma ser o colega de chapa.", 0.91, {"tab": "vereadores", "ordenar": "vulnerabilidade"})
    # segments
    add("geografia", "Perfis de território",
        f"Os {len(base)} locais se agrupam em {segs['k']} perfis eleitorais (k-means sobre voto, comparecimento e perfil do eleitorado): "
        + "; ".join(f"{s['id'] + 1}) {s['rotulo']} — {len(s['locais'])} locais, {fmt(s['eleitores'])} eleitores" for s in segs["segmentos"]) + ".",
        0.83, {"tab": "geografia", "modo": "segmentos"})
    # 2024 mayor -> 2026 governor
    pf = shares(matrix(ctx, 2024, "prefeito"))
    gv = shares(matrix(ctx, 2026, "governador"))
    rr = {n: float(np.corrcoef(pf["44"], gv[n])[0, 1]) for n in ["55", "40"] if n in gv}
    add("2026", "Para onde foi a base de Simão em 2026",
        f"Correlação por local entre o voto em Simão (2024) e governador 2026: Raquel Lyra r={rr.get('55', 0):+.2f}, João Campos r={rr.get('40', 0):+.2f}. "
        + ("A base do prefeito migrou mais para Raquel." if rr.get("55", 0) > rr.get("40", 0) else "A base do prefeito migrou mais para João Campos."),
        0.78, {"tab": "mapa", "eleicao": 2026, "cargo": "governador"})
    # registration gap (regional: voters don't always vote at the nearest place, so never per place)
    reg_ratio = []
    for rg, ids in base.groupby("regiao").groups.items():
        p15 = float(cg.loc[list(ids), "pop15"].sum()) if (cg := catch.set_index("id")) is not None else 0
        reg_ratio.append((rg, float(base.loc[list(ids), "eleitores"].sum()) / max(p15, 1), p15))
    reg_ratio = sorted([x for x in reg_ratio if x[2] > 3000], key=lambda x: x[1])
    add("regioes", "Eleitores registrados por adulto",
        "Eleitores 2024 ÷ população de 15+ anos (Censo 2022) por região: menores razões em "
        + ", ".join(f"{k} ({v:.2f})" for k, v, _ in reg_ratio[:3]) + "; maiores em " + ", ".join(f"{k} ({v:.2f})" for k, v, _ in reg_ratio[-2:])
        + ". Razão baixa = moradores que votam em outra região (ex.: bairros novos que mantêm título antigo) ou não cadastrados — alvo para transferência de título e campanha de rua.",
        0.74, {"tab": "geografia", "modo": "registro"})
    # electorate growth
    a20 = ctx.det[2020].query("cargo == 'prefeito'").groupby("place").QT_APTOS.sum()
    a24 = ctx.det[2024].query("cargo == 'prefeito'").groupby("place").QT_APTOS.sum()
    a26 = ctx.det[2026].query("cargo == 'governador'").groupby("place").QT_APTOS.sum()
    reg = base.regiao
    g = pd.DataFrame({"a20": a20.groupby(reg).sum(), "a24": a24.groupby(reg).sum(), "a26": a26.groupby(reg).sum()}).fillna(0)
    g["cres"] = g.a26 / g.a20.replace(0, np.nan) - 1
    g = g.sort_values("cres", ascending=False)
    tot = g.sum()
    add("regioes", "Onde o eleitorado mais cresce (2020 → 2026)",
        f"Cidade: {fmt(tot.a20)} → {fmt(tot.a24)} → {fmt(tot.a26)} aptos ({(tot.a26 / tot.a20 - 1) * 100:+.1f}%). Maior crescimento: "
        + ", ".join(f"{k} ({v * 100:+.0f}%)" for k, v in g.cres.head(3).items()) + ". Menor: " + ", ".join(f"{k} ({v * 100:+.0f}%)" for k, v in g.cres.tail(2).items()) + ".",
        0.8, {"tab": "regioes", "metrica": "pct_eleitorado"})
    # women
    women = [c for c in cands if c["genero"] == "Feminino"]
    we = [c for c in women if c["eleito"]]
    add("vereadores", "Mulheres na disputa",
        f"{len(women)} candidatas ({len(women) * 100 / len(cands):.0f}% das candidaturas) somaram {sum(c['votos'] for c in women) * 100 / sum(c['votos'] for c in cands):.0f}% dos votos nominais "
        f"e elegeram {len(we)} das 23 vagas ({', '.join(c['nome'] for c in we)}). Mais votada não eleita: "
        + next((f"{c['nome']} ({c['partido']}, {fmt(c['votos'])})" for c in women if not c["eleito"]), "–") + ".", 0.62, {"tab": "vereadores", "filtro": "todos"})
    # money
    fin = [(c, (c.get("financas") or {}).get("despesa_total", 0)) for c in cands]
    tot_sp = sum(x for _, x in fin) or 1
    el_sp = sum(x for c, x in fin if c["eleito"])
    add("financas", "Quanto o dinheiro pesou na eleição de vereador",
        f"Os 23 eleitos gastaram {el_sp * 100 / tot_sp:.0f}% do total contratado pelos candidatos a vereador. Correlação gasto × votos entre todos: "
        f"r={np.corrcoef([x for _, x in fin], [c['votos'] for c, _ in fin])[0, 1]:+.2f}. {sum(1 for c in el if (c.get('custo_por_voto') or 99) < 2)} dos 23 eleitos tiveram custo por voto abaixo de R$ 2.",
        0.6, {"tab": "vereadores", "ordenar": "custo"})
