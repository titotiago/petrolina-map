"""Councillor-first and region-first analysis + generated insights."""
from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd

from common import SEATS, haversine, norm, r, read
import results as res

BRANCO_NULO = {"95", "96", "97"}
ELEICAO_2024 = date(2024, 10, 6)


@dataclass
class Context:
    base: pd.DataFrame
    votes: dict
    det: dict
    cands: dict
    camp: dict
    perfil: pd.DataFrame
    setores: object
    fin: pd.DataFrame
    bens: pd.Series


# ------------------------------------------------------------------ helpers
def fmt(n, sign=False) -> str:
    """pt-BR thousands separator."""
    t = f"{abs(int(round(n))):,}".replace(",", ".")
    return (("+" if n >= 0 else "-") if sign else ("-" if n < 0 else "")) + t


def fed_label(k: str) -> str:
    """'13-PT/65-PC do B/43-PV' -> 'Fed. PT/PC do B/PV'."""
    return "Fed. " + "/".join(x.split("-", 1)[1] for x in k.split("/")) if "/" in k and "-" in k else k


def party_key(row) -> str:
    return fed_label(row.SG_FEDERACAO) if row.NR_FEDERACAO not in ("-1", "", "#NULO") else row.SG_PARTIDO


def matrix(ctx, year, cargo, include_legenda=True) -> pd.DataFrame:
    """places x numero vote matrix (no blank/null)."""
    v = ctx.votes[year]
    v = v[(v.cargo == cargo) & ~v.numero.isin(BRANCO_NULO)]
    if not include_legenda:
        v = v[v.numero.str.len() > 2]
    m = v.pivot_table(index="place", columns="numero", values="votos", aggfunc="sum", fill_value=0)
    return m.reindex(ctx.base.id, fill_value=0)


def age_band(desc: str) -> str:
    try:
        a = int(str(desc).split()[0])
    except ValueError:
        return "nd"
    if a < 18:
        return "16-17"
    if a < 25:
        return "18-24"
    if a < 35:
        return "25-34"
    if a < 45:
        return "35-44"
    if a < 60:
        return "45-59"
    return "60+"


ESCOL = {
    "ANALFABETO": "baixa", "LÊ E ESCREVE": "baixa", "ENSINO FUNDAMENTAL INCOMPLETO": "fundamental",
    "ENSINO FUNDAMENTAL COMPLETO": "fundamental", "ENSINO MÉDIO INCOMPLETO": "medio", "ENSINO MÉDIO COMPLETO": "medio",
    "SUPERIOR INCOMPLETO": "superior", "SUPERIOR COMPLETO": "superior",
}


def profile_by_place() -> pd.DataFrame:
    p = read("perfil_secao_2024.csv")
    p["place"] = res._place(p, 2024)
    p["n"] = p.QT_ELEITORES_PERFIL.astype(int)
    p["idade"] = p.DS_FAIXA_ETARIA.map(age_band)
    p["esc"] = p.DS_GRAU_ESCOLARIDADE.map(ESCOL).fillna("nd")
    out = pd.DataFrame({"total": p.groupby("place").n.sum()})
    out["fem"] = p[p.DS_GENERO == "FEMININO"].groupby("place").n.sum()
    for k, g in p.groupby("idade"):
        out[f"idade_{k}"] = g.groupby("place").n.sum()
    for k, g in p.groupby("esc"):
        out[f"esc_{k}"] = g.groupby("place").n.sum()
    out["casado"] = p[p.DS_ESTADO_CIVIL.str.startswith("CASADO")].groupby("place").n.sum()
    return out.fillna(0).astype(int)


def shares(df: pd.DataFrame) -> pd.DataFrame:
    return df.div(df.sum(axis=1).replace(0, np.nan), axis=0).fillna(0)


def wquantile_radius(lat, lon, w, clat, clon, q):
    d = haversine(clat, clon, lat, lon)
    o = np.argsort(d)
    cw = np.cumsum(w[o]) / w.sum()
    return float(d[o][np.searchsorted(cw, q)])


def corr(a: np.ndarray, b: np.ndarray, w=None) -> float:
    if a.std() == 0 or b.std() == 0:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])


# ------------------------------------------------------------------ seats
def seat_math(ctx) -> dict:
    c = ctx.cands[2024]
    c = c[c.cargo == "vereador"].copy()
    c["pkey"] = c.apply(party_key, axis=1)
    m = matrix(ctx, 2024, "vereador")
    tot = m.sum()
    num_to_key = dict(zip(c.NR_CANDIDATO, c.pkey))
    party_num_to_key = {}
    for _, row in c.iterrows():
        party_num_to_key[row.NR_PARTIDO] = row.pkey
        if row.NR_FEDERACAO not in ("-1", "", "#NULO"):
            for part in row.SG_FEDERACAO.split("/"):
                party_num_to_key.setdefault(part.split("-")[0], row.pkey)
    pv, nominal, legenda = {}, {}, {}
    for numero, v in tot.items():
        if len(numero) == 2:
            k = party_num_to_key.get(numero, numero)
            legenda[k] = legenda.get(k, 0) + int(v)
        else:
            k = num_to_key.get(numero)
            if k is None:
                continue
            nominal[k] = nominal.get(k, 0) + int(v)
        pv[k] = pv.get(k, 0) + int(v)
    cv = {}
    for _, row in c.iterrows():
        cv.setdefault(row.pkey, []).append((row.NR_CANDIDATO, int(tot.get(row.NR_CANDIDATO, 0))))
    sim = res.allocate(pv, cv, SEATS)
    official = set(c[c.DS_SIT_TOT_TURNO.str.startswith("ELEITO")].NR_CANDIDATO)
    simulated = {e["cand"] for e in sim["eleitos"]}
    qe = sim["qe"]
    # winning averages -> votes each party needed for one more seat
    seats_p = sim["cadeiras"]
    last_avg = min(pv[e["partido"]] / (sum(1 for x in sim["eleitos"][: i + 1] if x["partido"] == e["partido"]))
                   for i, e in enumerate(sim["eleitos"]) if e["via"] != "QP") if any(e["via"] != "QP" for e in sim["eleitos"]) else qe
    partidos = []
    for k, v in sorted(pv.items(), key=lambda x: -x[1]):
        ranked = sorted(cv.get(k, []), key=lambda x: -x[1])
        s = seats_p.get(k, 0)
        first_sup = ranked[s] if len(ranked) > s else None
        partidos.append({
            "partido": k, "votos": v, "nominais": nominal.get(k, 0), "legenda": legenda.get(k, 0),
            "pct": r(v / sim["total_validos"]), "qp": sim["qp"].get(k, 0), "cadeiras": s,
            "pct_qe": r(v / qe), "candidatos": len(ranked),
            "votos_sem_cadeira": v if s == 0 else max(0, v - s * qe) if v > s * qe else 0,
            "faltou_p_mais_uma": max(0, int(np.ceil(last_avg * (s + 1) - v)) + 1),
            "primeiro_suplente": {"numero": first_sup[0], "votos": first_sup[1]} if first_sup else None,
            "campo": ctx.camp.get(k) or next((ctx.camp.get(p) for p in c[c.pkey == k].SG_PARTIDO), None),
        })
    eleitos = sorted(sim["eleitos"], key=lambda e: -e["votos"])
    return {
        "assentos": SEATS, "qe": qe, "validos": sim["total_validos"], "ultima_media_vencedora": r(last_avg, 1),
        "corte_votos_min_eleito": min(e["votos"] for e in eleitos), "partidos": partidos, "eleitos_simulados": eleitos,
        "confere_com_oficial": simulated == official, "diferencas": sorted(simulated ^ official),
    }


# ------------------------------------------------------------------ councillors
def candidates_2024(ctx, seats) -> list:
    base = ctx.base.set_index("id")
    c = ctx.cands[2024]
    c = c[c.cargo == "vereador"].copy()
    c["pkey"] = c.apply(party_key, axis=1)
    m = matrix(ctx, 2024, "vereador")
    valid_place = m.sum(axis=1)
    sh = m.div(valid_place.replace(0, np.nan), axis=0).fillna(0)
    nominal = matrix(ctx, 2024, "vereador", include_legenda=False)
    leader = nominal.idxmax(axis=1)
    tot = m.sum()
    city_valid = tot.sum()
    lat, lon = base.lat.values, base.lon.values
    reg = base.regiao
    qe = seats["qe"]
    # 2020 history and 2026 candidacy by voter title
    c20 = ctx.cands[2020]
    c20 = c20.set_index("NR_TITULO_ELEITORAL_CANDIDATO")
    m20 = pd.concat([matrix(ctx, 2020, "vereador"), matrix(ctx, 2020, "prefeito")], axis=1)
    c26 = ctx.cands[2026].set_index("NR_TITULO_ELEITORAL_CANDIDATO")
    m26 = {k: matrix(ctx, 2026, k, include_legenda=False) for k in ("dep_estadual", "dep_federal", "governador", "senador")}
    # place electorate profile shares (for "typical voter")
    pf = ctx.perfil.reindex(base.index).fillna(0)
    city_pf = pf.sum()
    prof_cols = {"jovem": ["idade_16-17", "idade_18-24"], "idoso": ["idade_60+"], "superior": ["esc_superior"], "baixa_esc": ["esc_baixa"], "mulheres": ["fem"]}
    prof_place = pd.DataFrame({k: pf[cols].sum(axis=1) / pf.total.replace(0, np.nan) for k, cols in prof_cols.items()}).fillna(0)
    city_prof = {k: city_pf[cols].sum() / city_pf.total for k, cols in prof_cols.items()}
    sit_off = dict(zip(c.NR_CANDIDATO, c.DS_SIT_TOT_TURNO))
    out = []
    rank = tot[tot.index.str.len() > 2].rank(ascending=False, method="min")
    party_rank = {}
    for k, g in c.assign(v=c.NR_CANDIDATO.map(tot).fillna(0)).sort_values("v", ascending=False).groupby("pkey"):
        for i, n in enumerate(g.NR_CANDIDATO):
            party_rank[n] = i + 1
    party_seats = {p["partido"]: p for p in seats["partidos"]}
    for _, row in c.iterrows():
        n = row.NR_CANDIDATO
        w = m[n].values.astype(float) if n in m else np.zeros(len(base))
        total = float(w.sum())
        d = {
            "numero": n, "nome": row.NM_URNA_CANDIDATO.strip(), "nome_completo": row.NM_CANDIDATO.strip(), "partido": row.SG_PARTIDO,
            "partido_chave": row.pkey, "federacao": row.NM_FEDERACAO if row.NM_FEDERACAO != "#NULO" else None,
            "campo": ctx.camp.get(row.SG_PARTIDO), "situacao": sit_off.get(n), "eleito": sit_off.get(n, "").startswith("ELEITO"),
            "votos": int(total), "rank": int(rank.get(n, 0)) or None, "rank_partido": party_rank.get(n),
            "pct_validos": r(total / city_valid, 5), "pct_qe": r(total / qe), "genero": row.DS_GENERO.title(),
            "idade": _age(row.DT_NASCIMENTO), "instrucao": row.DS_GRAU_INSTRUCAO.title(), "ocupacao": row.DS_OCUPACAO.title(),
            "cor": row.DS_COR_RACA.title(), "sq": row.SQ_CANDIDATO,
        }
        # finance and assets
        f = ctx.fin.loc[row.SQ_CANDIDATO] if row.SQ_CANDIDATO in ctx.fin.index else None
        if f is not None:
            d["financas"] = {k: (r(v, 2) if isinstance(v, (float, int, np.floating)) else v) for k, v in f.items()}
            d["custo_por_voto"] = r(f.despesa_total / total, 2) if total else None
        d["bens"] = r(ctx.bens.get(row.SQ_CANDIDATO, 0), 2)
        if total > 0:
            p = w / total
            hhi = float((p ** 2).sum())
            clat, clon = float((lat * w).sum() / total), float((lon * w).sum() / total)
            top = np.argsort(-w)[:10]
            by_reg = pd.Series(w, index=base.index).groupby(reg).sum().sort_values(ascending=False)
            lq = (sh[n] / (total / city_valid)) if n in sh else None
            d["territorio"] = {
                "hhi": r(hhi), "locais_efetivos": r(1 / hhi, 1), "top10_pct": r(w[top].sum() / total),
                "centro": [r(clat, 5), r(clon, 5)], "raio50_km": r(wquantile_radius(lat, lon, w, clat, clon, 0.5), 2),
                "raio80_km": r(wquantile_radius(lat, lon, w, clat, clon, 0.8), 2),
                "regiao_base": by_reg.index[0], "regiao_base_pct": r(by_reg.iloc[0] / total),
                "por_regiao": {k: int(v) for k, v in by_reg.items() if v > 0},
                "lidera_em": [pid for pid in base.index[leader.values == n]],
                "top_locais": [{"id": base.index[i], "votos": int(w[i]), "pct_local": r(sh[n].iloc[i]), "lq": r(lq.iloc[i], 2)} for i in top if w[i] > 0],
                "tipo": "concentrado" if w[top].sum() / total >= 0.55 else ("regional" if by_reg.iloc[0] / total >= 0.4 else "espalhado"),
            }
            d["perfil_eleitor"] = {k: r(float((prof_place[k].values * w).sum() / total) / city_prof[k], 3) for k in prof_cols}
        # 2020 history
        t = row.NR_TITULO_ELEITORAL_CANDIDATO
        if t in c20.index:
            h = c20.loc[[t]].iloc[0]
            v20 = m20[h.NR_CANDIDATO] if h.NR_CANDIDATO in m20 else None
            hist = {"cargo": h.DS_CARGO.title(), "partido": h.SG_PARTIDO, "situacao": h.DS_SIT_TOT_TURNO, "numero": h.NR_CANDIDATO,
                    "votos": int(v20.sum()) if v20 is not None and h.cargo == "vereador" else None}
            if h.cargo == "vereador" and v20 is not None and total:
                delta = (pd.Series(w, index=base.index) - v20.values)
                hist["variacao"] = int(total - v20.sum())
                hist["ganhou_mais"] = [{"id": i, "delta": int(x)} for i, x in delta.sort_values(ascending=False).head(5).items() if x > 0]
                hist["perdeu_mais"] = [{"id": i, "delta": int(x)} for i, x in delta.sort_values().head(5).items() if x < 0]
                hist["por_local"] = {i: int(x) for i, x in v20.items() if x}
            d["hist_2020"] = hist
            d["trajetoria"] = "reeleito" if d["eleito"] and h.DS_SIT_TOT_TURNO.startswith("ELEITO") and h.cargo == "vereador" else (
                "ex-vereador" if h.DS_SIT_TOT_TURNO.startswith("ELEITO") and h.cargo == "vereador" else "concorreu em 2020")
        else:
            d["trajetoria"] = "estreante"
        # 2026 candidacy
        if t in c26.index:
            h = c26.loc[[t]].iloc[0]
            mm = m26.get(h.cargo)
            d["cand_2026"] = {"cargo": h.DS_CARGO.title(), "partido": h.SG_PARTIDO, "situacao": h.DS_SIT_TOT_TURNO, "numero": h.NR_CANDIDATO,
                              "votos_petrolina": int(mm[h.NR_CANDIDATO].sum()) if mm is not None and h.NR_CANDIDATO in mm else None}
        # 2026 link: deputies whose Petrolina vote pattern matches this councillor's
        if total >= 300:
            d["afinidade_2026"] = {}
            x = sh[n].values
            for k in ("dep_estadual", "dep_federal", "senador", "governador"):
                mm = m26[k]
                big = mm.columns[mm.sum() >= (300 if k.startswith("dep") else 0)]
                s26 = shares(m26[k])[big]
                cs = {col: corr(x, s26[col].values) for col in big}
                best = sorted(cs.items(), key=lambda kv: -kv[1])[:3]
                d["afinidade_2026"][k] = [{"numero": col, "r": r(v, 3), "votos_petrolina": int(mm[col].sum())} for col, v in best]
        if d["eleito"]:
            ps = party_seats.get(row.pkey, {})
            fs = ps.get("primeiro_suplente")
            d["margem_suplente"] = (int(total) - fs["votos"]) if fs else None
        out.append(d)
    out.sort(key=lambda d: -d["votos"])
    # 2020 sitting councillors who didn't return (beyond those matched)
    return out


def _age(dt: str):
    try:
        d, m, y = (int(x) for x in dt.split("/"))
        b = date(y, m, d)
        return ELEICAO_2024.year - b.year - ((ELEICAO_2024.month, ELEICAO_2024.day) < (b.month, b.day))
    except Exception:
        return None


# ------------------------------------------------------------------ overlaps
def overlaps(ctx, cands) -> dict:
    ids = [c["numero"] for c in cands if c["eleito"]] + [c["numero"] for c in cands if not c["eleito"]][:15]
    m = matrix(ctx, 2024, "vereador")[ids]
    p = m / m.sum()
    names = {c["numero"]: c["nome"] for c in cands}
    elected = {c["numero"] for c in cands if c["eleito"]}
    n = len(ids)
    mat = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            mat[i, j] = np.minimum(p.iloc[:, i].values, p.iloc[:, j].values).sum()
    pairs = []
    for i in range(n):
        for j in range(i + 1, n):
            a, b = ids[i], ids[j]
            if a in elected or b in elected:
                pairs.append({"a": a, "b": b, "a_nome": names[a], "b_nome": names[b], "sobreposicao": r(mat[i, j], 3),
                              "ambos_eleitos": a in elected and b in elected})
    pairs.sort(key=lambda x: -x["sobreposicao"])
    return {"ids": ids, "nomes": [names[i] for i in ids], "eleitos": [i in elected for i in ids],
            "matriz": [[r(v, 3) for v in row] for row in mat], "pares": pairs[:60]}


# ------------------------------------------------------------------ vulnerability
def vulnerability(ctx, cands) -> list:
    el = [c for c in cands if c["eleito"]]
    ov = overlaps(ctx, cands)
    idx = {n: i for i, n in enumerate(ov["ids"])}
    votes = {c["numero"]: c["votos"] for c in cands}
    cost = pd.Series({c["numero"]: c.get("custo_por_voto") or 0 for c in el})
    cost_rank = cost.rank(pct=True)

    def clip(x):
        return float(min(1, max(0, x)))

    for c in el:
        n = c["numero"]
        reasons = []
        margin = (c.get("margem_suplente") or 0) / max(c["votos"], 1)
        f_margin = clip(1 - margin / 0.5)  # <50% margin over first alternate -> risk
        if margin < 0.15:
            reasons.append(f"margem de apenas {c.get('margem_suplente')} votos sobre o 1º suplente do partido")
        f_media = 1.0 if c["situacao"] == "ELEITO POR MÉDIA" else 0.0
        if f_media:
            reasons.append("eleito por média (sobras), não pelo quociente partidário")
        f_trend = 0.0
        h = c.get("hist_2020") or {}
        if h.get("votos") and h.get("cargo") == "Vereador":
            ch = (c["votos"] - h["votos"]) / max(h["votos"], 1)
            f_trend = clip(-ch / 0.4)
            if ch < -0.1:
                reasons.append(f"perdeu {abs(ch) * 100:.0f}% dos votos em relação a 2020")
        f_overlap = 0.0
        i = idx[n]
        rivals = [(ov["ids"][j], ov["matriz"][i][j]) for j in range(len(ov["ids"])) if j != i and votes[ov["ids"][j]] > c["votos"]]
        if rivals:
            rv, val = max(rivals, key=lambda x: x[1])
            f_overlap = clip((val - 0.3) / 0.4)
            if val > 0.45:
                reasons.append(f"divide território ({val * 100:.0f}% de sobreposição) com {next(x['nome'] for x in cands if x['numero'] == rv)}, mais votado")
        f_cost = float(cost_rank.get(n, 0.5))
        if f_cost > 0.8:
            reasons.append(f"custo por voto alto (R$ {c.get('custo_por_voto') or 0:.2f})")
        f_dep = clip(1 - c["pct_qe"] / 0.6)
        score = 0.30 * f_margin + 0.15 * f_media + 0.20 * f_trend + 0.15 * f_overlap + 0.10 * f_cost + 0.10 * f_dep
        c["vulnerabilidade"] = {"score": r(score, 3), "fatores": {"margem": r(f_margin, 2), "media": f_media, "tendencia": r(f_trend, 2),
                                "sobreposicao": r(f_overlap, 2), "custo": r(f_cost, 2), "dependencia_partido": r(f_dep, 2)},
                                "motivos": reasons}
    ranked = sorted(el, key=lambda c: -c["vulnerabilidade"]["score"])
    for i, c in enumerate(ranked):
        c["vulnerabilidade"]["rank"] = i + 1
    return cands


# ------------------------------------------------------------------ regions
def regions_summary(ctx, cands) -> dict:
    base = ctx.base.set_index("id")
    reg = base.regiao
    city_el = base.eleitores.sum()
    el_home = pd.Series([c["territorio"]["regiao_base"] for c in cands if c["eleito"]]).value_counts()
    mv = matrix(ctx, 2024, "vereador")
    elected = [c["numero"] for c in cands if c["eleito"]]
    names = {c["numero"]: c["nome"] for c in cands}
    camp_of = {c["numero"]: c["campo"] for c in cands}
    party_nums = {}
    for _, row in ctx.cands[2024][ctx.cands[2024].cargo == "vereador"].iterrows():
        party_nums[row.NR_PARTIDO] = ctx.camp.get(row.SG_PARTIDO)
    gov = "SIMÃO DURANDO"
    st = ctx.setores
    out = {}
    for rg, ids in reg.groupby(reg).groups.items():
        ids = list(ids)
        e = int(base.loc[ids, "eleitores"].sum())
        d = {"locais": len(ids), "eleitores": e, "pct_eleitorado": r(e / city_el), "bairros_ibge": sorted(set(base.loc[ids, "bairro_ibge"]) - {""})}
        # turnout by election (main office)
        d["comparecimento"] = {}
        for y, cargo in [(2020, "prefeito"), (2024, "prefeito"), (2026, "governador")]:
            t = ctx.det[y]
            t = t[(t.cargo == cargo) & t.place.isin(ids)][res.DETALHE_COLS].sum()
            d["comparecimento"][y] = {"aptos": int(t.QT_APTOS), "comp": r(t.QT_COMPARECIMENTO / max(t.QT_APTOS, 1)),
                                      "abst": r(t.QT_ABSTENCOES / max(t.QT_APTOS, 1)),
                                      "brancos_nulos": r((t.QT_VOTOS_BRANCOS + t.QT_VOTOS_NULOS) / max(t.QT_COMPARECIMENTO, 1))}
        # mayor
        for y in (2020, 2024):
            mm = matrix(ctx, y, "prefeito").loc[ids].sum()
            sh = (mm / mm.sum()).sort_values(ascending=False)
            d[f"prefeito_{y}"] = {k: r(v) for k, v in sh.items()}
            d[f"margem_prefeito_{y}"] = r(sh.iloc[0] - sh.iloc[1])
        # councillors
        rv = mv.loc[ids].sum()
        tot = rv.sum()
        nominal = rv[rv.index.str.len() > 2]
        s = (nominal / tot).sort_values(ascending=False)
        d["vereadores_top"] = [{"numero": k, "nome": names.get(k), "votos": int(nominal[k]), "pct": r(v), "eleito": k in elected} for k, v in s.head(12).items()]
        d["vereador_nec"] = r(1 / float(((nominal / nominal.sum()) ** 2).sum()), 1)  # effective number of candidates
        d["pct_voto_em_eleitos"] = r(nominal[nominal.index.isin(elected)].sum() / tot)
        d["pct_legenda"] = r(rv[rv.index.str.len() == 2].sum() / tot)
        camps = {}
        for k, v in rv.items():
            cp = camp_of.get(k) if len(k) > 2 else party_nums.get(k)
            camps[cp or "Outros"] = camps.get(cp or "Outros", 0) + int(v)
        d["vereador_por_campo"] = {k: r(v / tot) for k, v in sorted(camps.items(), key=lambda x: -x[1])}
        d["divergencia_governo"] = r((d["prefeito_2024"].get("44") or 0) - d["vereador_por_campo"].get(gov, 0))
        d["vereadores_com_base"] = int(el_home.get(rg, 0))
        d["vereadores_esperados"] = r(SEATS * e / city_el, 1)
        d["representacao"] = r(d["vereadores_com_base"] / max(d["vereadores_esperados"], 0.01), 2)
        d["vereadores_base_nomes"] = [c["nome"] for c in cands if c["eleito"] and c["territorio"]["regiao_base"] == rg]
        d["receita_vereadores_base"] = r(sum((c.get("financas") or {}).get("receita_total", 0) for c in cands if c["eleito"] and c["territorio"]["regiao_base"] == rg), 2)
        # 2026
        for k in ("governador", "senador", "dep_federal", "dep_estadual"):
            mm = matrix(ctx, 2026, k, include_legenda=False).loc[ids].sum()
            sh = (mm / mm.sum()).sort_values(ascending=False).head(5)
            d[f"r2026_{k}"] = [{"numero": n, "pct": r(v)} for n, v in sh.items()]
        # census + electorate profile
        ss = st[st.regiao == rg]
        pop = float(ss.v0001.sum())
        d["censo"] = {"populacao": int(pop), "domicilios": int(ss.v0007.sum()), "pop_10_19": int(ss.pop_10_14.sum() + ss.pop_15_19.sum()),
                      "novos_eleitores_2028_est": int(ss.pop_10_14.sum() + 0.4 * ss.pop_15_19.sum()),
                      "taxa_alfab": r(ss.alfab15.sum() / max(ss.pop15.sum(), 1)), "eleitores_por_hab": r(e / max(pop, 1), 3)}
        pf = ctx.perfil.reindex(ids).fillna(0).sum()
        d["perfil"] = {k: int(v) for k, v in pf.items()}
        out[rg] = d
    return out


# ------------------------------------------------------------------ insights
def insights(ctx, cands, regions, seats, pairs) -> list:
    el = [c for c in cands if c["eleito"]]
    names = {c["numero"]: c["nome"] for c in cands}
    I = []

    def add(cat, title, text, score, view=None, data=None):
        I.append({"categoria": cat, "titulo": title, "texto": text, "relevancia": round(score, 2), "view": view or {}, "dados": data or {}})

    qe = seats["qe"]
    add("vereadores", "Ninguém se elegeu sozinho",
        f"O quociente eleitoral foi {fmt(qe)} votos. O vereador mais votado ({el[0]['nome']}, {fmt(el[0]['votos'])}) fez {el[0]['pct_qe'] * 100:.0f}% do QE: "
        f"todos os 23 dependeram dos votos do partido/federação. Em 2028, a chapa importa tanto quanto o candidato.", 0.95,
        {"tab": "cadeiras"})
    cut = seats["corte_votos_min_eleito"]
    sup_above = [c for c in cands if not c["eleito"] and c["votos"] > cut]
    add("vereadores", "Suplentes com mais votos que eleitos",
        f"O eleito com menos votos teve {fmt(cut)}. {len(sup_above)} não eleitos tiveram mais votos que isso — perderam pela força da chapa, não pela própria votação: "
        + ", ".join(f"{c['nome']} ({c['partido']}, {fmt(c['votos'])})" for c in sup_above[:8]) + ".", 0.9,
        {"tab": "vereadores", "filtro": "suplentes"}, {"candidatos": [c["numero"] for c in sup_above]})
    for p in seats["partidos"]:
        if p["cadeiras"] == 0 and p["pct_qe"] and p["pct_qe"] > 0.5:
            add("vereadores", f"{p['partido']}: votos sem cadeira",
                f"{p['partido']} somou {fmt(p['votos'])} votos ({p['pct_qe'] * 100:.0f}% do QE) e não elegeu ninguém. Faltaram ~{fmt(p['faltou_p_mais_uma'])} votos.",
                0.7, {"tab": "cadeiras"})
    near = sorted([p for p in seats["partidos"] if p["cadeiras"] > 0], key=lambda p: p["faltou_p_mais_uma"])[:3]
    add("vereadores", "Partidos mais perto de mais uma cadeira",
        "; ".join(f"{p['partido']} precisava de ~{fmt(p['faltou_p_mais_uma'])} votos a mais para a {p['cadeiras'] + 1}ª vaga" for p in near) + ".",
        0.75, {"tab": "cadeiras"})
    vul = sorted(el, key=lambda c: -c["vulnerabilidade"]["score"])[:5]
    add("vereadores", "Mandatos mais vulneráveis para 2028",
        " · ".join(f"{c['nome']} ({c['partido']}): " + ("; ".join(c["vulnerabilidade"]["motivos"][:2]) or "combinação de fatores") for c in vul), 0.92,
        {"tab": "vereadores", "ordenar": "vulnerabilidade"}, {"candidatos": [c["numero"] for c in vul]})
    safe = sorted(el, key=lambda c: c["vulnerabilidade"]["score"])[:3]
    add("vereadores", "Mandatos mais sólidos",
        ", ".join(f"{c['nome']} ({fmt(c['votos'])} votos, margem {fmt(c.get('margem_suplente') or 0)} sobre o suplente)" for c in safe) + ".", 0.6,
        {"tab": "vereadores"})
    traj = pd.Series([c["trajetoria"] for c in el]).value_counts().to_dict()
    add("vereadores", "Renovação da Câmara",
        f"Dos 23 eleitos, {traj.get('reeleito', 0)} foram reeleitos, {traj.get('estreante', 0)} são estreantes e {traj.get('concorreu em 2020', 0) + traj.get('ex-vereador', 0)} já tinham concorrido em 2020 sem mandato.",
        0.7, {"tab": "vereadores"})
    conc = sorted([c for c in el if "territorio" in c], key=lambda c: -c["territorio"]["top10_pct"])
    add("vereadores", "Vereadores de bairro vs. de cidade",
        f"Mais concentrados: " + ", ".join(f"{c['nome']} ({c['territorio']['top10_pct'] * 100:.0f}% dos votos em 10 locais, base: {c['territorio']['regiao_base']})" for c in conc[:4])
        + ". Mais espalhados: " + ", ".join(f"{c['nome']} (raio de 80% dos votos: {c['territorio']['raio80_km']:.1f} km)" for c in conc[-3:]) + ".", 0.8,
        {"tab": "vereadores", "ordenar": "hhi"})
    top_pairs = [p for p in pairs["pares"] if p["ambos_eleitos"]][:4]
    add("vereadores", "Vereadores que disputam o mesmo eleitorado",
        "; ".join(f"{p['a_nome']} × {p['b_nome']} ({p['sobreposicao'] * 100:.0f}% de sobreposição)" for p in top_pairs) + ". Em 2028 eles tendem a competir pelos mesmos locais.",
        0.85, {"tab": "sobreposicao"})
    lost = [c for c in el if c.get("hist_2020", {}).get("variacao") is not None]
    if lost:
        lo = sorted(lost, key=lambda c: c["hist_2020"]["variacao"])
        add("vereadores", "Quem cresceu e quem encolheu desde 2020",
            "Maiores perdas: " + ", ".join(f"{c['nome']} ({fmt(c['hist_2020']['variacao'], sign=True)})" for c in lo[:3] if c["hist_2020"]["variacao"] < 0)
            + ". Maiores ganhos: " + ", ".join(f"{c['nome']} ({fmt(c['hist_2020']['variacao'], sign=True)})" for c in lo[::-1][:3] if c["hist_2020"]["variacao"] > 0) + ".", 0.78,
            {"tab": "vereadores"})
    rising = [c for c in cands if not c["eleito"] and (c["votos"] >= 0.6 * cut or (c.get("territorio") and any(t["pct_local"] and t["pct_local"] > 0.15 for t in c["territorio"]["top_locais"][:1])))]
    rising = sorted(rising, key=lambda c: -c["votos"])[:10]
    add("vereadores", "Nomes a observar para 2028 (não eleitos)",
        ", ".join(f"{c['nome']} ({c['partido']}, {fmt(c['votos'])}" + (f", base em {c['territorio']['regiao_base']}" if c.get("territorio") else "") + ")" for c in rising) + ".",
        0.82, {"tab": "vereadores", "filtro": "observar"}, {"candidatos": [c["numero"] for c in rising]})
    run26 = [c for c in cands if c.get("cand_2026")]
    if run26:
        add("2026", "Candidatos de 2024 que disputaram 2026",
            ", ".join(f"{c['nome']} ({'eleito' if c['eleito'] else 'não eleito'} em 2024) → {c['cand_2026']['cargo']} pelo {c['cand_2026']['partido']}: {c['cand_2026']['situacao'].lower()}"
                      + (f", {fmt(c['cand_2026']['votos_petrolina'])} votos em Petrolina" if c['cand_2026'].get('votos_petrolina') else "") for c in run26) + ".",
            0.8, {"tab": "vereadores", "filtro": "2026"})
    prefeitos = ctx.cands[2024][ctx.cands[2024].cargo == "prefeito"]
    by_mayor = {}
    for c in cands:
        for d in (c.get("financas") or {}).get("doadores_candidatos", []):
            if "PREFEITO" not in (d.get("cargo") or "").upper():
                continue
            dn = norm(d["nome"])
            who = next((u for u, full in zip(prefeitos.NM_URNA_CANDIDATO, prefeitos.NM_CANDIDATO) if all(t in dn for t in norm(full).split()[:2])), d["nome"].title())
            by_mayor.setdefault(who, []).append((c, d["valor"]))
    if by_mayor:
        add("financas", "Repasses de campanhas a prefeito para vereadores (sinal de aliança)",
            " ".join(f"{who}: {len(v)} candidatos a vereador ({sum(1 for c, _ in v if c['eleito'])} eleitos), total R$ {fmt(sum(x for _, x in v))} — eleitos: "
                     + ", ".join(c["nome"] for c, _ in v if c["eleito"]) + "." for who, v in sorted(by_mayor.items(), key=lambda kv: -len(kv[1]))),
            0.7, {"tab": "vereadores"})
    cpv = sorted([c for c in el if c.get("custo_por_voto")], key=lambda c: c["custo_por_voto"])
    if cpv:
        add("financas", "Custo por voto dos eleitos",
            f"Mais eficiente: {cpv[0]['nome']} (R$ {cpv[0]['custo_por_voto']:.2f}/voto). Mais caro: {cpv[-1]['nome']} (R$ {cpv[-1]['custo_por_voto']:.2f}/voto). Mediana: R$ {np.median([c['custo_por_voto'] for c in cpv]):.2f}.",
            0.65, {"tab": "vereadores", "ordenar": "custo"})
    # regions
    R = pd.DataFrame(regions).T
    R["rep"] = R.representacao.astype(float)
    under = R[R.vereadores_esperados.astype(float) >= 1].sort_values("rep").head(3)
    add("regioes", "Regiões sub-representadas na Câmara",
        "; ".join(f"{k}: {v.pct_eleitorado * 100:.0f}% do eleitorado, {v.vereadores_com_base} vereador(es) com base (esperado ~{v.vereadores_esperados:.0f})" for k, v in under.iterrows()) + ".",
        0.93, {"tab": "regioes", "metrica": "representacao"})
    over = R.sort_values("rep", ascending=False).head(2)
    add("regioes", "Regiões sobre-representadas",
        "; ".join(f"{k}: {v.vereadores_com_base} vereadores com base para {v.pct_eleitorado * 100:.0f}% do eleitorado" for k, v in over.iterrows()) + ".",
        0.7, {"tab": "regioes", "metrica": "representacao"})
    frag = R.assign(n=R.vereador_nec.astype(float)).sort_values("n", ascending=False)
    add("regioes", "Onde o voto para vereador é mais pulverizado",
        f"{frag.index[0]} tem {frag.n.iloc[0]:.0f} candidatos efetivos e só {frag.pct_voto_em_eleitos.iloc[0] * 100:.0f}% dos votos foram para eleitos — território aberto para 2028. "
        f"O mais concentrado é {frag.index[-1]} ({frag.n.iloc[-1]:.0f} candidatos efetivos).", 0.88, {"tab": "regioes", "metrica": "vereador_nec"})
    wasted = R.assign(w=1 - R.pct_voto_em_eleitos.astype(float)).sort_values("w", ascending=False)
    add("regioes", "Votos sem representação",
        "; ".join(f"{k}: {v.w * 100:.0f}% dos votos de vereador foram para não eleitos" for k, v in wasted.head(3).iterrows()) + ".", 0.8,
        {"tab": "regioes", "metrica": "pct_voto_em_eleitos"})
    margin = R.assign(m=R.margem_prefeito_2024.astype(float)).sort_values("m")
    add("regioes", "Prefeito 2024: redutos e regiões mais disputadas",
        f"Maior margem: {margin.index[-1]} ({margin.m.iloc[-1] * 100:.0f} p.p.). Mais disputada: {margin.index[0]} ({margin.m.iloc[0] * 100:.0f} p.p.).", 0.75,
        {"tab": "mapa", "eleicao": 2024, "cargo": "prefeito"})
    div = R.assign(dv=R.divergencia_governo.astype(float)).sort_values("dv", ascending=False)
    add("regioes", "Onde o prefeito vai melhor que seus vereadores",
        f"Em {div.index[0]}, Simão teve {div.dv.iloc[0] * 100:.0f} p.p. a mais do que a soma dos vereadores da sua coligação — eleitor do prefeito sem vereador aliado forte. "
        f"Menor diferença: {div.index[-1]} ({div.dv.iloc[-1] * 100:.0f} p.p.).", 0.83, {"tab": "mapa", "metrica": "divergencia"})
    abst = R.assign(a=[v[2024]["abst"] for v in R.comparecimento]).sort_values("a", ascending=False)
    add("regioes", "Abstenção: votos deixados na mesa",
        "; ".join(f"{k}: {v.a * 100:.0f}% de abstenção" for k, v in abst.head(3).iterrows()) + ".", 0.7, {"tab": "mapa", "metrica": "abstencao"})
    ch = R.assign(d=[(v[2024]["comp"] or 0) - (v[2020]["comp"] or 0) for v in R.comparecimento]).sort_values("d")
    add("regioes", "Comparecimento 2020 → 2024",
        f"Maior queda: {ch.index[0]} ({ch.d.iloc[0] * 100:+.1f} p.p.). Maior alta: {ch.index[-1]} ({ch.d.iloc[-1] * 100:+.1f} p.p.).", 0.6, {"tab": "mapa", "metrica": "swing_comp"})
    young = R.assign(y=[v["censo"]["novos_eleitores_2028_est"] for v in R.censo] if False else [c["novos_eleitores_2028_est"] for c in R.censo]).sort_values("y", ascending=False)
    add("regioes", "Onde estão os novos eleitores de 2028",
        "Estimativa (Censo 2022, 10–14 anos + parte dos 15–19): " + "; ".join(f"{k}: ~{fmt(int(v.y))}" for k, v in young.head(3).iterrows()) + ".", 0.72,
        {"tab": "mapa", "camada": "setores", "metrica": "pop_10_14"})
    I.sort(key=lambda x: -x["relevancia"])
    for i, x in enumerate(I):
        x["id"] = i + 1
    return I


def insights_md(I, seats) -> str:
    lines = ["# Petrolina 2024 → 2028: principais achados", "", f"_Gerado automaticamente pelo pipeline. QE 2024 = {fmt(seats['qe'])} votos; alocação simulada confere com a oficial: {'sim' if seats['confere_com_oficial'] else 'NÃO'}._", ""]
    for cat, title in [("vereadores", "Vereadores"), ("geografia", "Geografia do voto"), ("regioes", "Regiões"), ("2026", "Sinal de 2026"), ("financas", "Finanças")]:
        items = [x for x in I if x["categoria"] == cat]
        if items:
            lines += [f"## {title}", ""] + [f"- **{x['titulo']}** — {x['texto']}" for x in items] + [""]
    return "\n".join(lines)


# ------------------------------------------------------------------ outputs
def candidate_meta(ctx) -> dict:
    """numero -> name/party per year+cargo (for every votable number in results)."""
    out = {}
    for y, c in ctx.cands.items():
        for cargo, g in c.groupby("cargo"):
            d = {n: {"nome": nm.strip(), "partido": p, "situacao": s} for n, nm, p, s in zip(g.NR_CANDIDATO, g.NM_URNA_CANDIDATO, g.SG_PARTIDO, g.DS_SIT_TOT_TURNO)}
            for n, p in zip(g.NR_PARTIDO, g.SG_PARTIDO):
                d.setdefault(n, {"nome": f"Legenda {p}", "partido": p, "situacao": "LEGENDA"})
            d["95"] = {"nome": "Branco", "partido": "", "situacao": ""}
            d["96"] = {"nome": "Nulo", "partido": "", "situacao": ""}
            out.setdefault(str(y), {})[cargo] = d
    return out


def places_out(ctx) -> list:
    b = ctx.base
    pf = ctx.perfil
    st = ctx.setores
    pop = st.groupby("local_id").v0001.sum()
    out = []
    for _, p in b.iterrows():
        d = {k: p[k] for k in ["id", "nome", "endereco", "bairro_tse", "bairro_ibge", "distrito", "regiao", "eleitores", "geo_src"]}
        d["zona"], d["local"] = int(p.zona), int(p.local)
        d["lat"], d["lon"] = r(p.lat, 6), r(p.lon, 6)
        d["secoes"] = p.secoes
        d["perfil"] = {k: int(v) for k, v in pf.loc[p.id].items()} if p.id in pf.index else {}
        d["pop_censo_area"] = int(pop.get(p.id, 0))
        out.append(d)
    return out


def results_out(ctx) -> dict:
    out = {"votos": {}, "detalhe": {}}
    for y, v in ctx.votes.items():
        yy = out["votos"].setdefault(str(y), {})
        for cargo, g in v.groupby("cargo"):
            dd = yy.setdefault(cargo, {})
            for place, gg in g.groupby("place"):
                dd[place] = {n: int(x) for n, x in zip(gg.numero, gg.votos) if x}
    for y, d in ctx.det.items():
        yy = out["detalhe"].setdefault(str(y), {})
        for cargo, g in d.groupby("cargo"):
            yy[cargo] = {pl: [int(x) for x in row] for pl, row in zip(g.place, g[res.DETALHE_COLS].values)}
    out["detalhe_cols"] = ["aptos", "comparecimento", "abstencoes", "nominais", "brancos", "nulos", "legenda"]
    return out
