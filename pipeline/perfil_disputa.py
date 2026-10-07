"""Who competes for the same *kind* of voter (beyond geography), using section-level data.

Votes are secret, so this is ecological inference: we compare the candidate's vote share across the
sections of each polling place with the profile of each section (age, schooling, sex). Sections inside the
same school differ (newer sections concentrate younger / recently registered voters), which lets us
separate *profile appeal* from *where* a candidate is strong.

Per candidate:
  composicao  — estimated profile of the candidate's voters (vote-weighted section profile), index vs city = 1.00
  apelo       — profile appeal net of geography: Σ votes·(section profile − profile of its polling place) / Σ votes,
                in percentage points (e.g. +3 p.p. of 16–24 = the candidate's voters are younger than the
                average voter of the very schools where they got the votes)
Per pair:
  terr_local  — territorial overlap on the 122 polling places (current analysis)
  terr_secao  — territorial overlap on the ~700 sections (finer)
  perfil      — cosine of the noise-normalised appeal vectors (t = appeal ÷ within-school permutation SE), shrunk by profile clarity
  disputa     — terr_secao × max(perfil, 0): high only when they share both territory and voter profile
"""
import numpy as np
import pandas as pd

from common import r, read
import results as res

FEATURES = {
    "j": ("16–24 anos", ["idade_16-17", "idade_18-24"]),
    "a25": ("25–34 anos", ["idade_25-34"]),
    "a35": ("35–44 anos", ["idade_35-44"]),
    "a45": ("45–59 anos", ["idade_45-59"]),
    "i": ("60+ anos", ["idade_60+"]),
    "eb": ("Analf./lê e escreve", ["esc_baixa"]),
    "ef": ("Fundamental", ["esc_fundamental"]),
    "em": ("Médio", ["esc_medio"]),
    "es": ("Superior", ["esc_superior"]),
    "f": ("Mulheres", ["fem"]),
}
# perfil similarity = cosine of noise-normalised appeal vectors, shrunk by how clear each profile is
TERR_HIGH, PERF_HIGH, PERF_LOW = 0.45, 0.35, -0.2
N_PERM = 300
RNG = np.random.default_rng(2028)


def section_profile() -> pd.DataFrame:
    from analysis import ESCOL, age_band
    p = read("perfil_secao_2024.csv")
    p["sec"] = p.NR_ZONA.astype(int).astype(str) + "-" + p.NR_SECAO.astype(int).astype(str)
    p["n"] = p.QT_ELEITORES_PERFIL.astype(int)
    p["idade"] = p.DS_FAIXA_ETARIA.map(age_band)
    p["esc"] = p.DS_GRAU_ESCOLARIDADE.map(ESCOL).fillna("nd")
    out = pd.DataFrame({"total": p.groupby("sec").n.sum()})
    out["fem"] = p[p.DS_GENERO == "FEMININO"].groupby("sec").n.sum()
    for k, g in p.groupby("idade"):
        out[f"idade_{k}"] = g.groupby("sec").n.sum()
    for k, g in p.groupby("esc"):
        out[f"esc_{k}"] = g.groupby("sec").n.sum()
    out = out.fillna(0)
    comp = pd.DataFrame({k: out[cols].sum(axis=1) / out.total.replace(0, np.nan) for k, (_, cols) in FEATURES.items()})
    comp["eleitores"] = out.total
    return comp.dropna()


def section_votes(sec_place: dict) -> pd.DataFrame:
    v = read("votacao_secao_2024.csv")
    v = v[(v.NR_TURNO == "1") & (v.DS_CARGO == "Vereador") & ~v.NR_VOTAVEL.isin(["95", "96"])]
    v["sec"] = v.NR_ZONA.astype(int).astype(str) + "-" + v.NR_SECAO.astype(int).astype(str)
    m = v.assign(q=v.QT_VOTOS.astype(int)).pivot_table(index="sec", columns="NR_VOTAVEL", values="q", aggfunc="sum", fill_value=0)
    return m


def analyse(ctx, cands, ids: list[str]) -> dict:
    sp = res.section_places(2024)
    sec_place = {f"{z}-{s}": pid for (z, s), pid in sp.items()}
    comp = section_profile()
    votes = section_votes(sec_place)
    secs = votes.index.intersection(comp.index)
    votes, comp = votes.loc[secs], comp.loc[secs]
    place = pd.Series({s: sec_place.get(s) for s in secs}).dropna()
    votes, comp = votes.loc[place.index], comp.loc[place.index]
    F = list(FEATURES)
    w = comp.eleitores
    # profile of each polling place (voter-weighted mean of its sections)
    place_comp = comp[F].mul(w, axis=0).groupby(place).sum().div(w.groupby(place).sum(), axis=0)
    dev = comp[F] - place_comp.loc[place.values].values  # section profile minus its school's profile
    city = (comp[F].mul(w, axis=0).sum() / w.sum())
    names = {c["numero"]: c for c in cands}
    keep = [n for n in ids if n in votes and votes[n].sum() > 0]
    X = votes[keep].values.astype(float)               # sections x candidates
    D = dev[F].values                                   # sections x features
    tot = X.sum(axis=0)
    apelo = (X.T @ D) / tot[:, None]                    # candidates x features
    # null: shuffle each candidate's votes among the sections of the same polling place
    groups = [np.where(place.values == g)[0] for g in pd.unique(place.values)]
    null = np.empty((N_PERM, len(keep), len(F)))
    for k in range(N_PERM):
        idx = np.arange(len(X))
        for g in groups:
            if len(g) > 1:
                idx[g] = RNG.permutation(g)
        null[k] = (X[idx].T @ D) / tot[:, None]
    se = null.std(axis=0)
    se[se == 0] = np.nan
    t = np.nan_to_num(apelo / se)                       # noise-normalised appeal
    nitidez = np.sqrt((t ** 2).mean(axis=1))            # ≈1 when the profile is indistinguishable from chance
    weight = np.clip(nitidez - 1, 0, 1)                 # 0 = no clear profile, 1 = clear profile (≥2× noise)
    norms = np.linalg.norm(t, axis=1)
    cos = (t @ t.T) / np.outer(norms, norms).clip(1e-9)
    prof = cos * np.sqrt(np.outer(weight, weight))
    out_c = {}
    for i, n in enumerate(keep):
        compo = (comp[F].mul(votes[n], axis=0).sum() / tot[i])
        out_c[n] = {"nome": names[n]["nome"], "partido": names[n]["partido"], "eleito": names[n]["eleito"],
                    "composicao": {k: r(compo[k] / city[k], 3) for k in F},
                    "apelo_pp": {k: r(apelo[i, j] * 100, 2) for j, k in enumerate(F)},
                    "apelo_t": {k: r(t[i, j], 2) for j, k in enumerate(F)},
                    "nitidez": r(nitidez[i], 2)}
    dist_sec = votes[keep] / votes[keep].sum()
    P = dist_sec.values
    terr_sec = np.array([[np.minimum(P[:, i], P[:, j]).sum() for j in range(len(keep))] for i in range(len(keep))])
    ov = ctx._overlap
    terr_loc = {(a, b): ov["matriz"][ov["ids"].index(a)][ov["ids"].index(b)] for a in keep for b in keep if a in ov["ids"] and b in ov["ids"]}
    pares = []
    for i, a in enumerate(keep):
        for j in range(i + 1, len(keep)):
            b = keep[j]
            t, pr = float(terr_sec[i, j]), float(prof[i, j])
            quad = ("disputa_direta" if t >= TERR_HIGH and pr >= PERF_HIGH else
                    "mesmo_lugar_publico_diferente" if t >= TERR_HIGH and pr <= PERF_LOW else
                    "disputa_territorial" if t >= TERR_HIGH else
                    "mesmo_publico_outro_lugar" if pr >= PERF_HIGH else "pouca_disputa")
            pares.append({"a": a, "b": b, "a_nome": names[a]["nome"], "b_nome": names[b]["nome"],
                          "ambos_eleitos": names[a]["eleito"] and names[b]["eleito"],
                          "terr_local": r(terr_loc.get((a, b)), 3), "terr_secao": r(t, 3), "perfil": r(pr, 3),
                          "disputa": r(t * max(pr, 0), 3), "quadrante": quad})
    pares.sort(key=lambda p: -p["disputa"])
    return {
        "features": {k: v[0] for k, v in FEATURES.items()}, "cidade": {k: r(city[k], 4) for k in F},
        "limiares": {"territorio": TERR_HIGH, "perfil": PERF_HIGH, "perfil_oposto": PERF_LOW},
        "ids": keep, "candidatos": out_c,
        "matriz_perfil": [[r(v, 3) for v in row] for row in prof],
        "matriz_terr_secao": [[r(v, 3) for v in row] for row in terr_sec],
        "pares": pares, "n_secoes": int(len(votes)),
    }


def insights(pd_out, add):
    P = pd_out["pares"]
    el = [p for p in P if p["ambos_eleitos"]]
    dd = [p for p in el if p["quadrante"] == "disputa_direta"][:5]
    if dd:
        add("vereadores", "Disputa direta: mesmo território e mesmo perfil de eleitor",
            "Eleitos que dividem as mesmas seções e atraem o mesmo tipo de eleitor (idade, escolaridade, gênero): "
            + "; ".join(f"{p['a_nome']} × {p['b_nome']} (território {p['terr_secao'] * 100:.0f}%, perfil {p['perfil']:+.2f})" for p in dd)
            + ". São os confrontos mais diretos de 2028.", 0.9, {"tab": "sobreposicao", "smodo": "disputa"})
    co = sorted([p for p in el if p["quadrante"] == "mesmo_lugar_publico_diferente"], key=lambda p: p["perfil"])[:4]
    if co:
        add("vereadores", "Mesmo lugar, públicos diferentes",
            "Pares que dividem território mas atraem eleitores de perfis opostos — convivem melhor do que a sobreposição geográfica sugere: "
            + "; ".join(f"{p['a_nome']} × {p['b_nome']} (território {p['terr_secao'] * 100:.0f}%, perfil {p['perfil']:+.2f})" for p in co) + ".",
            0.8, {"tab": "sobreposicao", "smodo": "disputa"})
    po = sorted([p for p in P if p["quadrante"] == "mesmo_publico_outro_lugar"], key=lambda p: -p["perfil"])[:4]
    if po:
        add("vereadores", "Mesmo público, territórios diferentes",
            "Candidatos que atraem o mesmo perfil de eleitor em bairros distintos — viram rivais se um deles expandir para a área do outro: "
            + "; ".join(f"{p['a_nome']} × {p['b_nome']} (perfil {p['perfil']:+.2f}, território só {p['terr_secao'] * 100:.0f}%)" for p in po) + ".",
            0.78, {"tab": "sobreposicao", "smodo": "disputa"})
    C = pd_out["candidatos"]
    feats = pd_out["features"]
    young = sorted(((n, c) for n, c in C.items() if c["eleito"]), key=lambda kv: -kv[1]["apelo_pp"]["j"])
    add("vereadores", "Quem atrai jovens e quem atrai idosos (dentro das mesmas escolas)",
        "Comparando seções da mesma escola, os eleitores destes vereadores são mais jovens que a média local: "
        + ", ".join(f"{c['nome']} ({c['apelo_pp']['j']:+.1f} p.p. de 16–24)" for _, c in young[:3])
        + ". Mais velhos: " + ", ".join(f"{c['nome']} ({c['apelo_pp']['i']:+.1f} p.p. de 60+)" for _, c in sorted(young, key=lambda kv: -kv[1]['apelo_pp']['i'])[:3]) + ".",
        0.76, {"tab": "sobreposicao", "smodo": "perfil"})
    _ = feats
