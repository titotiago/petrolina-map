"""Votes, turnout details, candidates, coalitions and campaign finance."""
import numpy as np
import pandas as pd

from common import SEATS, num, place_id, read

CARGO_KEY = {
    "Prefeito": "prefeito", "Vereador": "vereador", "Governador": "governador", "Senador": "senador",
    "Deputado Federal": "dep_federal", "Deputado Estadual": "dep_estadual", "Presidente": "presidente",
}
DETALHE_COLS = ["QT_APTOS", "QT_COMPARECIMENTO", "QT_ABSTENCOES", "QT_VOTOS_NOMINAIS", "QT_VOTOS_BRANCOS", "QT_VOTOS_NULOS", "QT_VOTOS_LEGENDA"]


def section_places(year: int) -> dict:
    """(zona, secao) -> polling place id, from the electorate-by-place file (canonical)."""
    l = read(f"locais_{year}.csv")
    l = l[l.NR_TURNO == "1"]
    return {(int(z), int(s)): place_id(z, n) for z, s, n in zip(l.NR_ZONA, l.NR_SECAO, l.NR_LOCAL_VOTACAO)}


def _place(df, year):
    sp = section_places(year)
    return [sp.get((int(z), int(s)), place_id(z, n)) for z, s, n in zip(df.NR_ZONA, df.NR_SECAO, df.NR_LOCAL_VOTACAO)]


# vote / detail files per election (the national file adds the president for general elections)
VOTE_FILES = {2022: ["votacao_secao_2022.csv", "votacao_secao_2022_pres.csv"], 2026: ["votacao_secao_2026.csv", "votacao_secao_2026_pres.csv"]}
DETAIL_FILES = {2022: ["detalhe_secao_2022_pres.csv"]}  # the BRASIL detail file already contains every office for Petrolina


def _cargo(s: pd.Series) -> pd.Series:
    return s.str.title().map({k.title(): v for k, v in CARGO_KEY.items()})


def votes(year: int, idmap: dict | None = None, turno: str = "1") -> pd.DataFrame:
    """Long table: place (2024 id), cargo, numero, votos for one round."""
    v = pd.concat([read(f) for f in VOTE_FILES.get(year, [f"votacao_secao_{year}.csv"])], ignore_index=True)
    v = v[v.NR_TURNO == turno]
    v["place"] = _place(v, year)
    if idmap:
        v["place"] = v.place.map(lambda x: idmap.get(x, (x,))[0])
    v["cargo"] = _cargo(v.DS_CARGO)
    v["votos"] = v.QT_VOTOS.astype(int)
    return v.groupby(["place", "cargo", "NR_VOTAVEL"], as_index=False).votos.sum().rename(columns={"NR_VOTAVEL": "numero"})


def detalhe(year: int, idmap: dict | None = None, turno: str = "1") -> pd.DataFrame:
    d = pd.concat([read(f) for f in DETAIL_FILES.get(year, [f"detalhe_secao_{year}.csv"])], ignore_index=True)
    d = d[d.NR_TURNO == turno]
    d["place"] = _place(d, year)
    if idmap:
        d["place"] = d.place.map(lambda x: idmap.get(x, (x,))[0])
    d["cargo"] = _cargo(d.DS_CARGO)
    for c in DETALHE_COLS:
        d[c] = d[c].astype(int)
    return d.groupby(["place", "cargo"], as_index=False)[DETALHE_COLS].sum()


def candidates(year: int, turno: str = "1") -> pd.DataFrame:
    c = read(f"cand_{year}.csv", mun_col=None)
    if year in (2022, 2026):
        c = c[c.SG_UF.isin(["PE", "BR"])]
    else:
        c = c[c.SG_UE == "25216"]
    c = c[c.NR_TURNO == turno]
    c["cargo"] = _cargo(c.DS_CARGO)
    return c[c.cargo.notna()]


def mayor_coalitions() -> dict:
    """party -> mayoral camp label for 2024."""
    c = read("coligacao_2024.csv", mun_col=None)
    c = c[(c.SG_UE == "25216") & (c.DS_CARGO == "PREFEITO")]
    cand = candidates(2024)
    head = cand[cand.cargo == "prefeito"].set_index("SG_PARTIDO").NM_URNA_CANDIDATO.to_dict()
    camp = {}
    for col, grp in c.groupby("NM_COLIGACAO"):
        if col in ("#NULO", "PARTIDO ISOLADO"):  # parties running alone
            for p in grp.SG_PARTIDO:
                camp[p] = head.get(p, p)
            continue
        lead = next((head[p] for p in grp.SG_PARTIDO if p in head), None)
        for p in grp.SG_PARTIDO:
            camp[p] = lead or head.get(p) or p
    return camp


def finance() -> pd.DataFrame:
    rec = read("receitas_2024.csv", mun_col="SG_UE")
    dsp = read("despesas_2024.csv", mun_col="SG_UE")
    rec["v"] = num(rec.VR_RECEITA)
    dsp["v"] = num(dsp.VR_DESPESA_CONTRATADA)
    out = pd.DataFrame(index=sorted(set(rec.SQ_CANDIDATO) | set(dsp.SQ_CANDIDATO)))
    out["receita_total"] = rec.groupby("SQ_CANDIDATO").v.sum()
    origem = {
        "Recursos de partido político": "rec_partido", "Recursos próprios": "rec_proprios",
        "Recursos de pessoas físicas": "rec_pf", "Recursos de outros candidatos": "rec_outros_cand",
        "Recursos de Financiamento Coletivo": "rec_vaquinha",
    }
    for k, col in origem.items():
        out[col] = rec[rec.DS_ORIGEM_RECEITA == k].groupby("SQ_CANDIDATO").v.sum()
    out["rec_fundo_especial"] = rec[rec.DS_FONTE_RECEITA == "FUNDO ESPECIAL"].groupby("SQ_CANDIDATO").v.sum()
    out["despesa_total"] = dsp.groupby("SQ_CANDIDATO").v.sum()
    out = out.fillna(0)
    # donors that are other candidates (alliance signal) and top suppliers
    oc = rec[rec.DS_ORIGEM_RECEITA == "Recursos de outros candidatos"]
    out["doadores_candidatos"] = oc.groupby("SQ_CANDIDATO").apply(
        lambda g: [{"nome": n, "cargo": c.title(), "partido": p, "valor": round(v, 2)}
                   for (n, c, p), v in g.groupby(["NM_DOADOR", "DS_CARGO_CANDIDATO_DOADOR", "SG_PARTIDO_DOADOR"]).v.sum().sort_values(ascending=False).head(5).items()]
    )
    out["top_doadores_pf"] = rec[rec.DS_ORIGEM_RECEITA == "Recursos de pessoas físicas"].groupby("SQ_CANDIDATO").apply(
        lambda g: [{"nome": n, "valor": round(v, 2)} for n, v in g.groupby("NM_DOADOR").v.sum().sort_values(ascending=False).head(5).items()]
    )
    out["top_fornecedores"] = dsp.groupby("SQ_CANDIDATO").apply(
        lambda g: [{"nome": n, "tipo": t, "valor": round(v, 2)} for (n, t), v in g.groupby(["NM_FORNECEDOR", "DS_ORIGEM_DESPESA"]).v.sum().sort_values(ascending=False).head(6).items()]
    )
    out["despesas_por_tipo"] = dsp.groupby("SQ_CANDIDATO").apply(
        lambda g: {t: round(v, 2) for t, v in g.groupby("DS_ORIGEM_DESPESA").v.sum().sort_values(ascending=False).head(8).items()}
    )
    for c in ["doadores_candidatos", "top_doadores_pf", "top_fornecedores"]:
        out[c] = out[c].apply(lambda x: x if isinstance(x, list) else [])
    out["despesas_por_tipo"] = out.despesas_por_tipo.apply(lambda x: x if isinstance(x, dict) else {})
    return out


def assets() -> pd.Series:
    b = read("bens_2024.csv", mun_col="SG_UE")
    b["v"] = num(b.VR_BEM_CANDIDATO)
    return b.groupby("SQ_CANDIDATO").v.sum()


# ---------------------------------------------------------------- seat allocation
def allocate(party_votes: dict, cand_votes: dict, seats: int = SEATS) -> dict:
    """Proportional system used in 2024 (Lei 14.211/2021 + STF ADI 7228 for the 3rd phase).

    party_votes: {party: valid votes (nominal + legenda)}
    cand_votes:  {party: [(cand_id, votes), ...]}
    """
    total = sum(party_votes.values())
    qe = total / seats
    qe = int(qe) + (1 if qe - int(qe) > 0.5 else 0)
    cands = {p: sorted(cand_votes.get(p, []), key=lambda x: -x[1]) for p in party_votes}
    seats_p = {p: 0 for p in party_votes}
    elected = []
    # phase 1: party quotient, candidates need >= 10% QE
    qp = {p: v // qe for p, v in party_votes.items()}
    for p, n in qp.items():
        ok = [c for c in cands[p] if c[1] >= 0.1 * qe][:n]
        for c in ok:
            elected.append({"cand": c[0], "partido": p, "votos": c[1], "via": "QP"})
        seats_p[p] = len(ok)
    taken = {e["cand"] for e in elected}
    # phase 2: leftovers, party >= 80% QE and candidate >= 20% QE
    eligible = {p for p, v in party_votes.items() if v >= 0.8 * qe}
    while len(elected) < seats and eligible:
        best = max(eligible, key=lambda p: party_votes[p] / (seats_p[p] + 1))
        nxt = next((c for c in cands[best] if c[0] not in taken and c[1] >= 0.2 * qe), None)
        if not nxt:
            eligible.discard(best)
            continue
        elected.append({"cand": nxt[0], "partido": best, "votos": nxt[1], "via": "MEDIA"})
        taken.add(nxt[0])
        seats_p[best] += 1
    # phase 3: all parties, no individual threshold
    while len(elected) < seats:
        best = max((p for p in party_votes if any(c[0] not in taken for c in cands[p])),
                   key=lambda p: party_votes[p] / (seats_p[p] + 1))
        nxt = next(c for c in cands[best] if c[0] not in taken)
        elected.append({"cand": nxt[0], "partido": best, "votos": nxt[1], "via": "MEDIA_3"})
        taken.add(nxt[0])
        seats_p[best] += 1
    return {"qe": qe, "total_validos": total, "qp": qp, "cadeiras": seats_p, "eleitos": elected}
