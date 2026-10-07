"""Roadmap items 3–5: 2022 ideological layer, 2022 deputies affinity, 2016 trajectories, 2026 president."""
import numpy as np
import pandas as pd

from analysis import fmt, matrix, shares, shares_nan
from common import r
from more import SUCCESSOR, wcorr

LULA, BOLSONARO = "13", "22"


def lula_share(ctx, key) -> pd.Series:
    s = shares_nan(matrix(ctx, key, "presidente", include_legenda=False))
    return s.get(LULA, pd.Series(np.nan, index=s.index))


def ideology(ctx, cands) -> dict:
    """Lula share (2nd round 2022) per place and each councillor's correlation with it."""
    w = ctx.base.set_index("id").eleitores.astype(float)
    lula = lula_share(ctx, "2022-2").reindex(w.index)
    lula26 = lula_share(ctx, 2026).reindex(w.index)
    ok = lula.notna().values  # places that didn't exist in 2022 are excluded, not counted as 0%
    sh = shares(matrix(ctx, 2024, "vereador"))
    simao = shares(matrix(ctx, 2024, "prefeito")).get("44")
    per_cand = {c["numero"]: r(wcorr(sh[c["numero"]].values[ok], lula.values[ok], w.values[ok]), 2)
                for c in cands if c["votos"] >= 800 and c["numero"] in sh}
    return {
        "lula_2022_2t": {i: (r(v, 4) if pd.notna(v) else None) for i, v in lula.items()},
        "lula_2026_1t": {i: (r(v, 4) if pd.notna(v) else None) for i, v in lula26.items()},
        "por_candidato": per_cand, "locais_sem_2022": int((~ok).sum()),
        "simao_x_lula": r(wcorr(simao.reindex(w.index).values[ok], lula.values[ok], w.values[ok]), 2) if simao is not None else None,
    }


def deputies_2022(ctx, cands) -> dict:
    """For each councillor with relevant votes: 2022 deputies whose Petrolina vote pattern matches theirs."""
    sh = shares(matrix(ctx, 2024, "vereador"))
    out = {}
    m22 = {k: matrix(ctx, 2022, k, include_legenda=False) for k in ("dep_estadual", "dep_federal")}
    for c in cands:
        if c["votos"] < 300 or c["numero"] not in sh:
            continue
        x = sh[c["numero"]].values
        d = {}
        for k, mm in m22.items():
            big = mm.columns[mm.sum() >= 300]
            s22 = shares(mm)[big]
            cs = sorted(((col, float(np.corrcoef(x, s22[col].values)[0, 1])) for col in big if s22[col].std() > 0), key=lambda kv: -kv[1])[:3]
            d[k] = [{"numero": col, "r": r(v, 3), "votos_petrolina": int(mm[col].sum())} for col, v in cs]
        out[c["numero"]] = d
    return out


def history_2016(ctx, cands) -> dict:
    """Match 2024 candidates to their 2016 candidacy by voter title."""
    c16 = ctx.cands[2016].set_index("NR_TITULO_ELEITORAL_CANDIDATO")
    c24 = ctx.cands[2024]
    title = dict(zip(c24.NR_CANDIDATO, c24.NR_TITULO_ELEITORAL_CANDIDATO))
    m16 = {k: matrix(ctx, 2016, k) for k in ("vereador", "prefeito")}
    out = {}
    for c in cands:
        t = title.get(c["numero"])
        if t in c16.index:
            h = c16.loc[[t]].iloc[0]
            out[c["numero"]] = {"cargo": h.DS_CARGO.title(), "partido": h.SG_PARTIDO, "situacao": h.DS_SIT_TOT_TURNO, "numero": h.NR_CANDIDATO,
                                "votos": int(m16[h.cargo][h.NR_CANDIDATO].sum()) if h.cargo in m16 and h.NR_CANDIDATO in m16[h.cargo] else None}
    return out


def renewal(ctx) -> dict:
    """Elected councillors per cycle and how many came back."""
    el = {}
    for y in (2016, 2020, 2024):
        c = ctx.cands[y]
        c = c[(c.cargo == "vereador") & c.DS_SIT_TOT_TURNO.str.startswith("ELEITO")]
        el[y] = dict(zip(c.NR_TITULO_ELEITORAL_CANDIDATO, c.NM_URNA_CANDIDATO.str.strip()))
    tres = [el[2024][t] for t in el[2024] if t in el[2020] and t in el[2016]]
    return {"reeleitos_2016_2020": len(set(el[2016]) & set(el[2020])), "reeleitos_2020_2024": len(set(el[2020]) & set(el[2024])),
            "eleitos": {y: len(v) for y, v in el.items()}, "tres_mandatos": tres}


def benches_2016(ctx) -> dict:
    c = ctx.cands[2016]
    c = c[(c.cargo == "vereador") & c.DS_SIT_TOT_TURNO.str.startswith("ELEITO")]
    return {p: int(n) for p, n in c.SG_PARTIDO.map(lambda p: SUCCESSOR.get(p, p)).value_counts().items()}


def region_layers(ctx, regions_out, ideo):
    """Add 2016/2022/2026-president figures to each region summary."""
    base = ctx.base.set_index("id")
    for rg, ids in base.groupby("regiao").groups.items():
        ids = list(ids)
        d = regions_out[rg]
        for key, cargo, label in [("2022-2", "presidente", "presidente_2022_2t"), (2026, "presidente", "presidente_2026"), (2016, "prefeito", "prefeito_2016")]:
            mm = matrix(ctx, key, cargo, include_legenda=False).loc[ids].sum()
            sh = (mm / mm.sum()).sort_values(ascending=False).head(4)
            d[label] = {n: r(v) for n, v in sh.items()}
        for key, cargo in [(2016, "prefeito"), ("2022-2", "presidente")]:
            t = ctx.det[key]
            t = t[(t.cargo == cargo) & t.place.isin(ids)].sum(numeric_only=True)
            d["comparecimento"][str(key)] = {"aptos": int(t.QT_APTOS), "comp": r(t.QT_COMPARECIMENTO / max(t.QT_APTOS, 1)),
                                             "abst": r(t.QT_ABSTENCOES / max(t.QT_APTOS, 1)),
                                             "brancos_nulos": r((t.QT_VOTOS_BRANCOS + t.QT_VOTOS_NULOS) / max(t.QT_COMPARECIMENTO, 1))}
        d["lula_2022_2t"] = d["presidente_2022_2t"].get(LULA)
        d["lula_2026"] = d["presidente_2026"].get(LULA)


def add_insights(ctx, cands, ideo, dep22, hist16, ren, bench16, regions_out, add):
    el = [c for c in cands if c["eleito"]]
    pc = ideo["por_candidato"]
    srt = sorted([(c, pc[c["numero"]]) for c in el if c["numero"] in pc], key=lambda x: -x[1])
    l22 = matrix(ctx, "2022-2", "presidente").sum()  # city vote totals
    add("geografia", "Território lulista × território bolsonarista dos vereadores",
        f"Lula teve {l22.get(LULA, 0) / l22.sum() * 100:.0f}% em Petrolina no 2º turno de 2022, mas de forma desigual (bem menos no Centro). "
        "Correlação por local entre o voto do vereador (2024) e o voto em Lula: votam mais em áreas lulistas "
        + ", ".join(f"{c['nome']} ({c['partido']}, r={v:+.2f})" for c, v in srt[:4])
        + "; votam mais em áreas onde Bolsonaro foi melhor " + ", ".join(f"{c['nome']} ({c['partido']}, r={v:+.2f})" for c, v in srt[::-1][:4])
        + f". Simão × Lula por local: r={ideo['simao_x_lula']:+.2f}. Mede o território, não a ideologia do candidato nem de cada eleitor.",
        0.88, {"tab": "mapa", "eleicao": "2022-2", "cargo": "presidente"})
    gov_bolso = [c for c, v in srt if c["campo"] == "SIMÃO DURANDO" and v < -0.15]
    opp_lula = [c for c, v in srt if c["campo"] != "SIMÃO DURANDO" and v > 0.15]
    if gov_bolso or opp_lula:
        add("vereadores", "Território e alinhamento político dos vereadores",
            ("Governistas que votam mais em áreas menos lulistas: " + ", ".join(c["nome"] for c in gov_bolso) + ". " if gov_bolso else "")
            + ("Oposição que vota mais em áreas lulistas: " + ", ".join(c["nome"] for c in opp_lula) + ". " if opp_lula else "")
            + "Em 2028, a polarização nacional pode puxar esses territórios em direções diferentes do mandato.", 0.8, {"tab": "vereadores"})
    R = pd.DataFrame(regions_out).T
    R["dl"] = R.lula_2026.astype(float) - R.lula_2022_2t.astype(float)
    add("2026", "Lula 2022 → 2026 por região",
        "Variação da votação de Lula (2º turno 2022 → 1º turno 2026): "
        + "; ".join(f"{k} {v.lula_2022_2t * 100:.0f}% → {v.lula_2026 * 100:.0f}% ({v.dl * 100:+.0f} p.p.)" for k, v in R.sort_values("dl").iterrows() if pd.notna(v.dl))
        + ". (Comparação entre turnos diferentes: o 1º turno de 2026 dispersa votos em mais candidatos.)", 0.72, {"tab": "mapa", "eleicao": 2026, "cargo": "presidente"})
    c22 = ctx.cands[2022]
    name22 = dict(zip(c22[c22.cargo == "dep_estadual"].NR_CANDIDATO, c22[c22.cargo == "dep_estadual"].NM_URNA_CANDIDATO.str.strip()))
    own = {c["numero"]: c["nome_completo"] for c in el}
    full22 = dict(zip(c22.NR_CANDIDATO, c22.NM_CANDIDATO.str.strip()))
    with_dep = []
    for c in el:
        for d in (dep22.get(c["numero"], {}).get("dep_estadual") or []):
            if full22.get(d["numero"]) != own[c["numero"]]:  # skip the councillor's own 2022 candidacy
                with_dep.append((c, d))
                break
    if with_dep:
        add("2026", "Puxadores de 2022: deputados com a mesma base dos vereadores",
            "Deputado estadual de 2022 cuja votação por local mais se parece com a do vereador (indício de dobradinha): "
            + "; ".join(f"{c['nome']} ↔ {name22.get(d['numero'], d['numero'])} (r={d['r']:+.2f})" for c, d in sorted(with_dep, key=lambda x: -x[1]["r"])[:8]) + ".",
            0.74, {"tab": "vereadores"})
    add("vereadores", "Renovação da Câmara em três eleições",
        f"Reeleitos 2016→2020: {ren['reeleitos_2016_2020']} de {ren['eleitos'][2016]}; 2020→2024: {ren['reeleitos_2020_2024']} de {ren['eleitos'][2020]}. "
        f"Com três mandatos seguidos (2016, 2020, 2024): {len(ren['tres_mandatos'])}" + (f" — {', '.join(ren['tres_mandatos'])}." if ren["tres_mandatos"] else "."),
        0.7, {"tab": "vereadores"})
    hist = [(c, hist16[c["numero"]]) for c in el if c["numero"] in hist16 and hist16[c["numero"]].get("votos") and hist16[c["numero"]]["cargo"] == "Vereador"]
    if hist:
        growth = sorted(hist, key=lambda x: -(x[0]["votos"] - x[1]["votos"]))
        add("vereadores", "Trajetória longa (2016 → 2024)",
            "Maior crescimento em oito anos: " + ", ".join(f"{c['nome']} ({fmt(h['votos'])} → {fmt(c['votos'])})" for c, h in growth[:4])
            + ". Maior queda: " + ", ".join(f"{c['nome']} ({fmt(h['votos'])} → {fmt(c['votos'])})" for c, h in growth[::-1][:3] if c["votos"] < h["votos"]) + ".",
            0.68, {"tab": "vereadores"})
    _ = (bench16, l22)
