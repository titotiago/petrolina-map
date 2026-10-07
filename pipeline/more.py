"""Third wave of analysis: vote inheritance 2020->2024, mayor coattails, 2028 projections,
party benches 2020->2024 and abstention drivers."""
import numpy as np
import pandas as pd

from analysis import fmt, matrix, shares
from common import SEATS, r

# 2020 parties that merged/renamed by 2024
SUCCESSOR = {"DEM": "UNIÃO", "PSL": "UNIÃO", "PSC": "PODE", "PATRIOTA": "PRD", "PTC": "AGIR", "PROS": "SOLIDARIEDADE", "PMN": "MOBILIZA"}


def wcorr(a, b, w):
    am, bm = np.average(a, weights=w), np.average(b, weights=w)
    cov = np.average((a - am) * (b - bm), weights=w)
    den = np.sqrt(np.average((a - am) ** 2, weights=w) * np.average((b - bm) ** 2, weights=w))
    return float(cov / den) if den else 0.0


def coattails(ctx, cands) -> dict:
    """Correlation between each councillor's share and Simão's share by place (who rides the mayor's wave)."""
    w = ctx.base.set_index("id").eleitores.astype(float).values
    simao = shares(matrix(ctx, 2024, "prefeito"))["44"].values
    sh = shares(matrix(ctx, 2024, "vereador"))
    return {c["numero"]: r(wcorr(sh[c["numero"]].values, simao, w), 2) for c in cands if c["votos"] >= 800 and c["numero"] in sh}


def inheritance(ctx, cands) -> list:
    """For 2020 councillors who are not in the 2024 council: which 2024 candidates' territory matches theirs."""
    c20 = ctx.cands[2020]
    c20 = c20[(c20.cargo == "vereador") & c20.DS_SIT_TOT_TURNO.str.startswith("ELEITO")]
    t24 = {c["nome_completo"]: c for c in cands}
    by_title = {}
    c24 = ctx.cands[2024]
    for _, row in c24[c24.cargo == "vereador"].iterrows():
        by_title[row.NR_TITULO_ELEITORAL_CANDIDATO] = row.NR_CANDIDATO
    raw20 = matrix(ctx, 2020, "vereador")
    ok = (raw20.sum(axis=1) > 0).values  # only places that existed in 2020
    m20 = shares(raw20)
    sh24 = shares(matrix(ctx, 2024, "vereador"))
    w = ctx.base.set_index("id").eleitores.astype(float).values
    big = [c for c in cands if c["votos"] >= 700]
    out = []
    for _, row in c20.iterrows():
        n24 = by_title.get(row.NR_TITULO_ELEITORAL_CANDIDATO)
        c_now = next((c for c in cands if c["numero"] == n24), None)
        if c_now and c_now["eleito"]:
            continue  # still in the council
        x = m20[row.NR_CANDIDATO].values if row.NR_CANDIDATO in m20 else None
        if x is None or x.sum() == 0:
            continue
        heirs = sorted(((c, wcorr(x[ok], sh24[c["numero"]].values[ok], w[ok])) for c in big if c["numero"] != n24), key=lambda t: -t[1])[:3]
        out.append({
            "nome": row.NM_URNA_CANDIDATO.strip(), "partido_2020": row.SG_PARTIDO, "votos_2020": int(matrix(ctx, 2020, "vereador")[row.NR_CANDIDATO].sum()),
            "status_2024": ("não eleito" if c_now else "não concorreu"), "votos_2024": c_now["votos"] if c_now else None,
            "herdeiros": [{"numero": c["numero"], "nome": c["nome"], "partido": c["partido"], "eleito": c["eleito"], "r": r(v, 2)} for c, v in heirs],
        })
    return sorted(out, key=lambda d: -d["votos_2020"])


def projection(ctx) -> dict:
    """Linear projection of the electorate to 2028 per place/region, and the implied QE and cut."""
    base = ctx.base.set_index("id")
    a = {y: ctx.det[y].query(f"cargo == '{c}'").groupby("place").QT_APTOS.sum().reindex(base.index).fillna(0)
         for y, c in [(2020, "prefeito"), (2024, "prefeito"), (2026, "governador")]}
    # growth per region 2024->2026 (2 years) extrapolated 2 more years; damped by half the 2020->2024 pace
    reg = base.regiao
    g24_26 = a[2026].groupby(reg).sum() / a[2024].groupby(reg).sum().replace(0, np.nan)
    g20_24 = (a[2024].groupby(reg).sum() / a[2020].groupby(reg).sum().replace(0, np.nan)) ** 0.5
    growth = (0.6 * g24_26 + 0.4 * g20_24).fillna(1)
    a28 = a[2026] * reg.map(growth)
    d24 = ctx.det[2024].query("cargo == 'vereador'")[["QT_APTOS", "QT_COMPARECIMENTO", "QT_VOTOS_NOMINAIS", "QT_VOTOS_LEGENDA"]].sum()
    valid_rate = (d24.QT_VOTOS_NOMINAIS + d24.QT_VOTOS_LEGENDA) / d24.QT_APTOS
    total28 = float(a28.sum())
    valid28 = total28 * valid_rate
    qe28 = valid28 / SEATS
    return {
        "aptos": {y: int(v.sum()) for y, v in a.items()} | {2028: int(total28)},
        "validos_vereador_2028": int(valid28), "qe_2028": int(round(qe28)), "qe_2024": None,
        "taxa_voto_valido": r(valid_rate, 4),
        "por_regiao": {k: {"2020": int(a[2020].groupby(reg).sum()[k]), "2024": int(a[2024].groupby(reg).sum()[k]), "2026": int(a[2026].groupby(reg).sum()[k]),
                           "2028": int(a28.groupby(reg).sum()[k]), "crescimento_bienal": r(float(growth[k]) - 1, 4)} for k in growth.index},
        "por_local": {i: int(v) for i, v in a28.items()},
    }


def benches(ctx) -> dict:
    out = {}
    for y in (2020, 2024):
        c = ctx.cands[y]
        c = c[(c.cargo == "vereador") & c.DS_SIT_TOT_TURNO.str.startswith("ELEITO")]
        for p, n in c.SG_PARTIDO.map(lambda p: SUCCESSOR.get(p, p)).value_counts().items():
            out.setdefault(p, {"2020": 0, "2024": 0})[str(y)] = int(n)
    return dict(sorted(out.items(), key=lambda kv: -(kv[1]["2024"] * 10 + kv[1]["2020"])))


def abstention_drivers(ctx) -> dict:
    base = ctx.base.set_index("id")
    d = ctx.det[2024].query("cargo == 'prefeito'").set_index("place").reindex(base.index)
    ab = (d.QT_ABSTENCOES / d.QT_APTOS).values
    pf = ctx.perfil.reindex(base.index).fillna(0)
    tot = pf.total.replace(0, np.nan)
    feats = {"jovens 16–24": (pf["idade_16-17"] + pf["idade_18-24"]) / tot, "60+": pf["idade_60+"] / tot,
             "ensino superior": pf.esc_superior / tot, "baixa escolaridade": pf.esc_baixa / tot}
    w = base.eleitores.astype(float).values
    ok = ~np.isnan(ab)
    return {k: r(wcorr(ab[ok], v.fillna(v.mean()).values[ok], w[ok]), 2) for k, v in feats.items()}


def add_insights(ctx, cands, coat, heirs, proj, bench, absd, seats, add):
    el = [c for c in cands if c["eleito"]]
    ce = sorted([(c, coat[c["numero"]]) for c in el if c["numero"] in coat], key=lambda x: -x[1])
    add("vereadores", "Efeito Simão: quem cresce junto com o prefeito",
        "Correlação por local entre o voto do vereador e o de Simão. Mais 'colados' no prefeito: "
        + ", ".join(f"{c['nome']} (r={v:+.2f})" for c, v in ce[:4]) + ". Votação independente/contrária: "
        + ", ".join(f"{c['nome']} (r={v:+.2f})" for c, v in ce[-3:]) + ". Vereadores colados dependem do desempenho do grupo em 2028; os independentes têm base própria.",
        0.84, {"tab": "vereadores"})
    if heirs:
        add("vereadores", "Herança de votos: para onde foi a base dos ex-vereadores",
            "Vereadores de 2020 fora da Câmara em 2024 e o candidato de 2024 cuja votação por local mais se parece com a deles: "
            + "; ".join(f"{h['nome']} ({fmt(h['votos_2020'])} votos em 2020, {h['status_2024']}) → {h['herdeiros'][0]['nome']} (r={h['herdeiros'][0]['r']:+.2f})" for h in heirs[:6]) + ".",
            0.82, {"tab": "vereadores"})
    qe24 = seats["qe"]
    cut24 = seats["corte_votos_min_eleito"]
    ratio = proj["qe_2028"] / qe24
    reg = sorted(proj["por_regiao"].items(), key=lambda kv: -(kv[1]["2028"] - kv[1]["2024"]))
    add("regioes", "Projeção 2028: eleitorado e quociente",
        f"Mantido o ritmo recente, Petrolina terá ~{fmt(proj['aptos'][2028])} eleitores em 2028 (2024: {fmt(proj['aptos'][2024])}). "
        f"Com a mesma taxa de voto válido, o quociente eleitoral sobe para ~{fmt(proj['qe_2028'])} (2024: {fmt(qe24)}) e a menor votação eleita para ~{fmt(cut24 * ratio)}. "
        f"Mais eleitores novos: " + ", ".join(f"{k} (+{fmt(v['2028'] - v['2024'])})" for k, v in reg[:3]) + ".",
        0.9, {"tab": "planejador"})
    grow = [(p, v) for p, v in bench.items() if v["2024"] != v["2020"]]
    add("vereadores", "Bancadas 2020 → 2024",
        "Variação de cadeiras por partido (siglas de 2020 convertidas para as atuais): "
        + ", ".join(f"{p} {v['2020']}→{v['2024']}" for p, v in sorted(grow, key=lambda kv: -(kv[1]['2024'] - kv[1]['2020']))) + ".",
        0.7, {"tab": "cadeiras"})
    top = sorted(absd.items(), key=lambda kv: -abs(kv[1]))
    add("geografia", "Quem deixa de votar",
        "Correlação da abstenção 2024 com o perfil do local: " + ", ".join(f"{k} r={v:+.2f}" for k, v in top)
        + ". A abstenção é maior onde há mais " + " e ".join(k for k, v in top if v > 0.1)
        + " e menor onde há mais " + " e ".join(k for k, v in top if v < -0.1)
        + ". Mobilização para o comparecimento rende mais nas áreas do primeiro grupo.",
        0.66, {"tab": "mapa", "metrica": "abstencao"})
