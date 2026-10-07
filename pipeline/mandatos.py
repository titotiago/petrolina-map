"""Roadmap items 13–14: council activity and public money, joined to the electoral data.

Inputs (collected once, static) in data/externos — see pipeline/externos/*.py:
  camara_indicacoes.csv, camara_requerimentos.csv, camara_votacoes_lista.csv   (Câmara de Petrolina site)
  tce_despesas_petrolina.csv.gz                                                (TCE-PE open data)
  emendas_petrolina.csv, emendas_favorecidos_petrolina.csv.gz, transferencias_especiais_petrolina.csv,
  obras_federais_petrolina.csv, licitacoes_petrolina.csv                      (federal open data / Prefeitura)
Each part is skipped gracefully if its file is missing.
"""
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analysis import fmt  # noqa: E402
from common import ROOT, r  # noqa: E402
from externos.texto_geo import Gazetteer, norm  # noqa: E402

EXT = ROOT / "data" / "externos"


def _read(name, **kw):
    f = EXT / name
    return pd.read_csv(f, dtype=str, **kw) if f.exists() else None


# names used at the Câmara that differ from the ballot name (documented, verified against the councillor list)
ALIASES = {"AERO CRUZ": "AERO SIM", "PRESIDENTE AERO": "AERO SIM", "GILMAR SANTOS": "PROF GILMAR SANTOS", "MARIA ELENA DE ALENCAR": "MARIA ELENA",
           "MARQUINHOS DO N4": "MARQUINHOS DO N QUATRO"}


def match_author(autor: str, cands: list, by_tokens: dict) -> str | None:
    """'Vereador Josivaldo Barros' → councillor number (2024 candidates). Tolerates OCR typos in PDFs
    (fuzzy match on the compact name); joint authorships ('X e Y', 'todos os vereadores') stay unmatched."""
    from rapidfuzz import fuzz, process
    a = norm(autor)
    for pre in ("VEREADORA ", "VEREADOR ", "VER ", "PRESIDENTE "):
        if a.startswith(pre):
            a = a[len(pre):]
    a = a.strip()
    if not a or " E " in f" {a} " and not a.startswith(("COSME E", "JOSE E")) or "TODOS" in a or "COMISSAO" in a or "MESA" in a or "BANCADA" in a:
        return None
    a = ALIASES.get(a, a)
    if a in by_tokens:
        return by_tokens[a]
    choices = {}
    for c in cands:
        for name in (c["nome"], c["nome_completo"]):
            choices[norm(name)] = c["numero"]
    hit = process.extractOne(a, list(choices), scorer=fuzz.token_set_ratio, score_cutoff=88)
    if hit:
        return choices[hit[0]]
    hit = process.extractOne(a.replace(" ", ""), {k: k.replace(" ", "") for k in choices}, scorer=fuzz.ratio, score_cutoff=86)
    return choices[hit[2]] if hit else None


def camara(cands, base) -> dict | None:
    parts = [d for d in (_read("camara_indicacoes.csv"), _read("camara_requerimentos.csv")) if d is not None]
    if not parts:
        return None
    df = pd.concat(parts, ignore_index=True)
    df["ano"] = df.data.str[-4:]
    gaz = Gazetteer()
    loc = df.ementa.fillna("").map(gaz.find)
    df["bairro"] = loc.map(lambda x: x[0] if x else None)
    df["regiao"] = loc.map(lambda x: x[1] if x else None)
    by_tokens = {norm(c["nome"]): c["numero"] for c in cands}
    authors = {a: match_author(a, cands, by_tokens) for a in df.autor.dropna().unique()}
    df["numero"] = df.autor.map(authors)
    names = {c["numero"]: c for c in cands}
    el = {c["numero"] for c in cands if c["eleito"]}
    # bairro coordinates = mean of polling places in that TSE bairro (for the map)
    bc = base.assign(k=base.bairro_tse.map(norm)).groupby("k")[["lat", "lon"]].mean()
    out_v = {}
    for n, g in df[df.numero.notna()].groupby("numero"):
        c = names[n]
        geo = g[g.regiao.notna()]
        base_reg = (c.get("territorio") or {}).get("regiao_base")
        por_reg = geo.regiao.value_counts()
        votos_reg = (c.get("territorio") or {}).get("por_regiao", {})
        pct_votos_base = votos_reg.get(base_reg, 0) / max(c["votos"], 1) if base_reg else None
        out_v[n] = {
            "nome": c["nome"], "eleito": n in el, "total": int(len(g)),
            "por_tipo": g.tipo.value_counts().to_dict(),
            "por_ano": {k: int(v) for k, v in g.ano.value_counts().sort_index().items()},
            "localizadas": int(len(geo)), "por_regiao": {k: int(v) for k, v in por_reg.items()},
            "top_bairros": [{"bairro": b, "n": int(k)} for b, k in geo.bairro.value_counts().head(8).items()],
            "pct_indicacoes_base": r(por_reg.get(base_reg, 0) / len(geo), 3) if len(geo) and base_reg else None,
            "pct_votos_base": r(pct_votos_base, 3) if pct_votos_base is not None else None,
            "exemplos": g.sort_values("data").tail(5)[["data", "tipo", "ementa", "pdf"]].to_dict("records"),
        }
    bairros = []
    for (b, rg), k in df[df.bairro.notna()].groupby(["bairro", "regiao"]).size().items():
        xy = bc.loc[norm(b)] if norm(b) in bc.index else None
        if xy is not None:
            bairros.append({"bairro": b, "regiao": rg, "n": int(k), "lat": r(xy.lat, 5), "lon": r(xy.lon, 5)})
    por_vereador_bairro = {n: g.groupby("bairro").size().astype(int).to_dict() for n, g in df[df.numero.notna() & df.bairro.notna()].groupby("numero")}
    votos = roll_calls(cands, by_tokens)
    for n, m in (votos or {}).get("por_vereador", {}).items():
        out_v.setdefault(n, {"nome": names[n]["nome"], "eleito": n in el, "total": 0, "por_tipo": {}, "por_ano": {}, "localizadas": 0,
                             "por_regiao": {}, "top_bairros": [], "pct_indicacoes_base": None, "pct_votos_base": None, "exemplos": []})["votacoes"] = m
    return {
        "votacoes": {k: v for k, v in (votos or {}).items() if k != "por_vereador"},
        "total": int(len(df)), "anos": sorted(df.ano.dropna().unique().tolist()), "localizadas": int(df.regiao.notna().sum()),
        "autores_sem_match": sorted(a for a, n in authors.items() if n is None)[:40],
        "vereadores": out_v, "bairros": bairros, "por_vereador_bairro": por_vereador_bairro,
        "por_regiao_ano": {f"{rg}|{a}": int(k) for (rg, a), k in df[df.regiao.notna()].groupby(["regiao", "ano"]).size().items()},
        "votacoes_pdfs": int(len(_read("camara_votacoes_lista.csv"))) if _read("camara_votacoes_lista.csv") is not None else 0,
    }


def roll_calls(cands, by_tokens) -> dict | None:
    """Roll-call votes parsed from the Câmara PDFs: attendance, votes against, dissent from the majority."""
    v = _read("camara_votacoes_nominais.csv")
    if v is None or not len(v):
        return None
    compact = {norm(c["nome"]).replace(" ", ""): c["numero"] for c in cands}
    compact.update({norm(c["nome_completo"]).replace(" ", ""): c["numero"] for c in cands})

    def who(name):
        k = norm(re.sub(r"\d+ª\s*Vota[çc][ãa]o", "", str(name))).replace(" ", "")
        if k in compact:
            return compact[k]
        return match_author(name, cands, by_tokens)
    v["numero"] = v.nome.map(who)
    v = v[v.numero.notna()]
    present = v.voto.isin(["favoravel", "contrario", "abstencao", "presidente"])
    voting = v[v.voto.isin(["favoravel", "contrario"])]
    maj = voting.groupby("pdf").voto.agg(lambda s: s.value_counts().idxmax())
    voting = voting.assign(contra_maioria=voting.voto.values != voting.pdf.map(maj).values)
    out = {}
    for n, g in v.groupby("numero"):
        gv = voting[voting.numero == n]
        out[n] = {"sessoes": int(g.pdf.nunique()), "presenca": r(float(present[g.index].mean()), 3),
                  "contrarios": int((gv.voto == "contrario").sum()), "contra_maioria": r(float(gv.contra_maioria.mean()), 3) if len(gv) else None,
                  "ausencias_justificadas": int((g.voto == "justificada").sum())}
    return {"n_votacoes": int(v.pdf.nunique()), "unanimes": int((voting.groupby("pdf").voto.nunique() == 1).sum()), "por_vereador": out}


def investimentos(base, regions_out) -> dict | None:
    f = EXT / "tce_despesas_petrolina.csv.gz"
    if not f.exists():
        return None
    df = pd.read_csv(f, dtype=str)
    for c in ("VALOREMPENHADO", "VALORPAGO"):
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
    df["investimento"] = df.investimento.astype(str).str.lower() == "true"
    gaz = Gazetteer()  # re-locate with the shared (stricter) matcher, not the collector's first pass
    loc_ = df.HISTORICO.fillna("").map(gaz.find)
    df["bairro"] = loc_.map(lambda x: x[0] if x else None)
    df["regiao"] = loc_.map(lambda x: x[1] if x else None)
    total = df.VALOREMPENHADO.sum()
    loc = df[df.regiao.notna()]
    el = base.groupby("regiao").eleitores.sum()
    by = loc.groupby(["regiao", "ANOREFERENCIA", "investimento"]).VALOREMPENHADO.sum()
    regioes = {}
    for rg in el.index:
        d = {"total": 0.0, "investimento": 0.0, "por_ano": {}}
        for (rr, a, inv), v in by.items():
            if rr != rg:
                continue
            d["total"] += v
            d["investimento"] += v if inv else 0
            d["por_ano"][a] = r(d["por_ano"].get(a, 0) + v, 0)
        d["total"], d["investimento"] = r(d["total"], 0), r(d["investimento"], 0)
        d["por_eleitor"] = r(d["total"] / el[rg], 1)
        d["investimento_por_eleitor"] = r(d["investimento"] / el[rg], 1)
        regioes[rg] = d
    top_b = loc.groupby(["bairro", "regiao"]).VALOREMPENHADO.sum().sort_values(ascending=False).head(25)
    funcao = loc.groupby("FUNCAO").VALOREMPENHADO.sum().sort_values(ascending=False).head(10)
    exemplos = loc[loc.investimento].sort_values("VALOREMPENHADO", ascending=False).head(30)
    return {
        "total_empenhado": r(total, 0), "localizado": r(loc.VALOREMPENHADO.sum(), 0), "n_empenhos": int(len(df)), "n_localizados": int(len(loc)),
        "anos": sorted(df.ANOREFERENCIA.unique().tolist()), "regioes": regioes,
        "top_bairros": [{"bairro": b, "regiao": rg, "valor": r(v, 0)} for (b, rg), v in top_b.items()],
        "por_funcao": {k: r(v, 0) for k, v in funcao.items()},
        "maiores_investimentos": [{"data": e.DATAEMPENHO[:10], "bairro": e.bairro, "regiao": e.regiao, "valor": r(e.VALOREMPENHADO, 0),
                                   "fornecedor": e.FORNECEDOR, "funcao": e.FUNCAO, "historico": str(e.HISTORICO)[:220]} for e in exemplos.itertuples()],
    }


def emendas(ctx) -> dict | None:
    fav = _read("emendas_favorecidos_petrolina.csv.gz")
    if fav is None:
        return None
    fav["Valor Recebido"] = fav["Valor Recebido"].astype(float)
    by_author = fav.groupby("Nome do Autor da Emenda")["Valor Recebido"].sum().sort_values(ascending=False)
    # link authors to their Petrolina votes as federal deputy / senator in 2022 and 2026
    votes = {}
    for y in (2022, 2026):
        c = ctx.cands[y]
        for cargo in ("dep_federal", "senador"):
            cc = c[c.cargo == cargo]
            v = ctx.votes[y]
            tot = v[v.cargo == cargo].groupby("numero").votos.sum()
            for full, urna, n in zip(cc.NM_CANDIDATO, cc.NM_URNA_CANDIDATO, cc.NR_CANDIDATO):
                for nm in (norm(full), norm(urna)):
                    votes.setdefault(nm, {})[f"{cargo}_{y}"] = int(tot.get(n, 0))
    autores = []
    for a, v in by_author.head(25).items():
        vv = votes.get(norm(a), {})
        autores.append({"autor": a, "valor": r(v, 0), "votos_petrolina": vv})
    sim = _read("transferencias_especiais_petrolina.csv")
    loc = _read("emendas_petrolina.csv")
    return {
        "total_recebido": r(fav["Valor Recebido"].sum(), 0), "por_ano": {k: r(v, 0) for k, v in fav.groupby("ano")["Valor Recebido"].sum().items()},
        "autores": autores,
        "favorecidos": [{"nome": k, "valor": r(v, 0)} for k, v in fav.groupby("Favorecido")["Valor Recebido"].sum().sort_values(ascending=False).head(15).items()],
        "por_tipo": {k: r(v, 0) for k, v in fav.groupby("Tipo de Emenda")["Valor Recebido"].sum().sort_values(ascending=False).items()},
        "transferencias_especiais": sim.to_dict("records") if sim is not None else [],
        "aplicacao_local_por_funcao": ({k: r(v, 0) for k, v in loc.assign(v=loc["Valor Pago"].astype(float)).groupby("Nome Função").v.sum().sort_values(ascending=False).items()} if loc is not None else {}),
    }


def obras() -> list:
    o = _read("obras_federais_petrolina.csv")
    if o is None:
        return []
    o = o.where(o.notna(), None)
    return [{"nome": x.nome, "situacao": x.situacao, "especie": x.especie, "inicio": x.inicio_previsto, "fim": x.fim_previsto,
             "lat": float(x.lat) if x.lat else None, "lon": float(x.lon) if x.lon else None} for x in o.itertuples()]


def add_insights(cam, inv, em, cands, regions_out, add):
    if cam:
        V = [v for v in cam["vereadores"].values() if v["eleito"]]
        top = sorted(V, key=lambda v: -v["total"])[:5]
        low = sorted(V, key=lambda v: v["total"])[:3]
        add("vereadores", "Produção legislativa (indicações e requerimentos)",
            f"{fmt(cam['total'])} indicações e requerimentos coletados no site da Câmara ({cam['anos'][0]}–{cam['anos'][-1]}). Entre os eleitos em 2024, mais produtivos: "
            + ", ".join(f"{v['nome']} ({fmt(v['total'])})" for v in top) + "; menos: " + ", ".join(f"{v['nome']} ({fmt(v['total'])})" for v in low)
            + ". Volume não mede qualidade, mas mostra presença junto às demandas de bairro.", 0.82, {"tab": "mandatos"})
        fo = [v for v in V if v["pct_indicacoes_base"] is not None and v["localizadas"] >= 20]
        if fo:
            fo.sort(key=lambda v: v["pct_indicacoes_base"] - (v["pct_votos_base"] or 0))
            add("vereadores", "Trabalha onde é votado?",
                "Compara a parcela das indicações (com bairro identificado) feitas para a região-base do vereador com a parcela dos votos que vem de lá. "
                "Mais focados na própria base: " + ", ".join(f"{v['nome']} ({v['pct_indicacoes_base'] * 100:.0f}% das indicações × {v['pct_votos_base'] * 100:.0f}% dos votos)" for v in fo[::-1][:3])
                + ". Mais voltados a outras áreas: " + ", ".join(f"{v['nome']} ({v['pct_indicacoes_base'] * 100:.0f}% × {v['pct_votos_base'] * 100:.0f}%)" for v in fo[:3]) + ".",
                0.8, {"tab": "mandatos"})
    if cam and cam.get("votacoes"):
        VV = [(v["nome"], v["votacoes"]) for v in cam["vereadores"].values() if v.get("eleito") and v.get("votacoes") and v["votacoes"]["sessoes"] >= 10]
        if VV:
            pres = sorted(VV, key=lambda x: x[1]["presenca"])
            dis = sorted([x for x in VV if x[1]["contra_maioria"] is not None], key=lambda x: -x[1]["contra_maioria"])
            add("vereadores", "Presença e independência nas votações nominais",
                f"{cam['votacoes']['n_votacoes']} votações nominais lidas dos PDFs da Câmara ({cam['votacoes']['unanimes']} unânimes entre os presentes). "
                "Menor presença: " + ", ".join(f"{n} ({x['presenca'] * 100:.0f}%)" for n, x in pres[:3])
                + ". Mais votos contra a maioria: " + ", ".join(f"{n} ({x['contra_maioria'] * 100:.0f}%)" for n, x in dis[:3] if x["contra_maioria"] > 0) + ".",
                0.79, {"tab": "mandatos"})
    if inv:
        R = sorted(((k, v) for k, v in inv["regioes"].items() if v["total"] > 0), key=lambda kv: -kv[1]["por_eleitor"])
        add("regioes", "Gasto da prefeitura com bairro identificado, por região",
            f"Dos R$ {fmt(inv['total_empenhado'])} empenhados pela prefeitura ({inv['anos'][0]}–{inv['anos'][-1]}, TCE-PE), R$ {fmt(inv['localizado'])} "
            f"({inv['localizado'] / inv['total_empenhado'] * 100:.1f}%) citam um bairro na descrição. Por eleitor: maior em "
            + ", ".join(f"{k} (R$ {v['por_eleitor']:,.0f})".replace(",", ".") for k, v in R[:3]) + "; menor em "
            + ", ".join(f"{k} (R$ {v['por_eleitor']:,.0f})".replace(",", ".") for k, v in R[::-1][:3]) + ". É uma amostra: a maior parte do gasto não informa o local.",
            0.78, {"tab": "mandatos", "mmodo": "investimentos"})
    if em:
        a = em["autores"]
        add("2026", "Emendas parlamentares para Petrolina",
            f"Entidades de Petrolina receberam R$ {fmt(em['total_recebido'])} em emendas federais (Portal da Transparência). Maiores origens: "
            + ", ".join(f"{x['autor'].title()} (R$ {fmt(x['valor'])})" for x in a[:5]) + ". "
            + (f"Emendas de relator ('orçamento secreto') somam R$ {fmt(next((x['valor'] for x in a if x['autor'] == 'RELATOR GERAL'), 0))}. " if any(x['autor'] == 'RELATOR GERAL' for x in a) else "")
            + "Pagamentos a empresas sediadas na cidade podem se referir a obras em outros municípios.", 0.76, {"tab": "mandatos", "mmodo": "emendas"})
