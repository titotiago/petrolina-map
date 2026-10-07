"""Roadmap item 7 — expected vs actual vote per polling place.

For each relevant candidate, a weighted ridge regression predicts the candidate's share at each polling place
from what the place *is* (voter profile, Census income/infrastructure, density, turnout, 2022 Lula vote),
never from who the candidate is locally. Predictions are made **out of block**: places are grouped into 15
spatial blocks of neighbours and each block is predicted by a model trained on the others, so the model cannot
memorise the candidate's own turf.

  esperado  = votes the profile of the place "predicts" (out-of-region)
  residuo   = actual − expected  (+ personal network / turf, − untapped potential)
  r2_oos    = out-of-block R² (how much of the candidate's map the profile explains)
"""
import numpy as np
import pandas as pd

from analysis import matrix, shares
from common import r

LAMBDAS = [0.3, 1, 3, 10, 30, 100, 300, 1000, 1e4, 1e6]  # the largest ≈ predicting the mean
N_BLOCKS = 15
FEATURES = {
    "jovem": "eleitores 16–24", "idoso": "eleitores 60+", "superior": "ensino superior", "baixa_esc": "baixa escolaridade",
    "mulheres": "mulheres", "renda": "renda (log)", "infra": "infraestrutura urbana", "densidade": "densidade (log)",
    "comparecimento": "comparecimento", "lula": "voto em Lula 2022", "rural": "área rural",
}


def features(ctx, catch, ideo) -> pd.DataFrame:
    base = ctx.base.set_index("id")
    pf = ctx.perfil.reindex(base.index).fillna(0)
    tot = pf.total.replace(0, np.nan)
    cg = catch.set_index("id").reindex(base.index)
    d = ctx.det[2024].query("cargo == 'prefeito'").set_index("place").reindex(base.index)
    f = pd.DataFrame(index=base.index)
    f["jovem"] = (pf["idade_16-17"] + pf["idade_18-24"]) / tot
    f["idoso"] = pf["idade_60+"] / tot
    f["superior"] = pf.esc_superior / tot
    f["baixa_esc"] = pf.esc_baixa / tot
    f["mulheres"] = pf.fem / tot
    f["renda"] = np.log(cg.renda_media.astype(float))
    f["infra"] = cg.infra.astype(float)
    f["densidade"] = np.log1p(cg["pop"] / cg.area_km2.replace(0, np.nan))
    f["comparecimento"] = d.QT_COMPARECIMENTO / d.QT_APTOS
    f["lula"] = pd.Series(ideo["lula_2022_2t"]).reindex(base.index).astype(float)
    f["rural"] = (base.bairro_ibge == "").astype(float)
    return f.fillna(f.mean())


def spatial_blocks(b: pd.DataFrame, k: int = N_BLOCKS) -> np.ndarray:
    """k-means on coordinates: groups of neighbouring places, held out together in cross-validation."""
    rng = np.random.default_rng(7)
    P = np.column_stack([b.lat.values, b.lon.values * np.cos(np.radians(b.lat.values.mean()))])
    C = P[rng.choice(len(P), k, replace=False)]
    for _ in range(100):
        lab = ((P[:, None] - C[None]) ** 2).sum(-1).argmin(1)
        C2 = np.array([P[lab == j].mean(0) if (lab == j).any() else C[j] for j in range(k)])
        if np.allclose(C, C2):
            break
        C = C2
    return lab


def ridge(X, y, w, lam):
    Xw = X * w[:, None]
    A = X.T @ Xw + lam * np.eye(X.shape[1])
    A[0, 0] -= lam  # don't penalise the intercept
    return np.linalg.solve(A, Xw.T @ y)


def fit_predict_oor(F, y, w, groups):
    """Out-of-region predictions with the ridge penalty chosen by out-of-region error."""
    Z = (F - np.average(F, axis=0, weights=w)) / F.std(axis=0).clip(1e-9)
    X = np.column_stack([np.ones(len(Z)), Z])
    best = None
    for lam in LAMBDAS:
        pred = np.empty(len(y))
        for g in np.unique(groups):
            te = groups == g
            beta = ridge(X[~te], y[~te], w[~te], lam)
            pred[te] = X[te] @ beta
        sse = np.sum(w * (y - pred.clip(0, 1)) ** 2)
        if best is None or sse < best[0]:
            best = (sse, lam, pred.clip(0, 1))
    sse, lam, pred = best
    sst = np.sum(w * (y - np.average(y, weights=w)) ** 2)
    beta_full = ridge(X, y, w, lam)
    return pred, 1 - sse / sst if sst > 0 else 0.0, beta_full[1:], lam


def run(ctx, cands, catch, ideo) -> dict:
    F = features(ctx, catch, ideo)
    groups = spatial_blocks(ctx.base.set_index("id").reindex(F.index))
    mv = matrix(ctx, 2024, "vereador")
    valid = mv.sum(axis=1).reindex(F.index).astype(float)
    sh = shares(mv).reindex(F.index)
    w = valid.values
    out = {"features": FEATURES, "candidatos": {}}
    targets = [(c["numero"], c["nome"], sh[c["numero"]].values, valid.values) for c in cands if c["votos"] >= 500 and c["numero"] in sh]
    pm = matrix(ctx, 2024, "prefeito").reindex(F.index)
    pv = pm.sum(axis=1).astype(float).values
    for n, nome in (("44", "SIMÃO DURANDO"), ("45", "DR. JULIO")):
        targets.append((f"prefeito:{n}", nome, (pm[n] / pm.sum(axis=1)).fillna(0).values, pv))
    for key, nome, y, tot in targets:
        pred, r2, beta, lam = fit_predict_oor(F.values, y, tot, groups)
        exp_votes = pred * tot
        act = y * tot
        out["candidatos"][key] = {
            "nome": nome, "r2_oos": r(r2, 3), "lambda": lam,
            "coef": {k: r(b, 4) for k, b in zip(F.columns, beta)},
            "esperado": {i: int(round(e)) for i, e in zip(F.index, exp_votes)},
            "residuo": {i: int(round(a - e)) for i, a, e in zip(F.index, act, exp_votes)},
            "esperado_total": int(round(exp_votes.sum())), "real_total": int(round(act.sum())),
        }
    return out


R2_OK = 0.25  # below this the profile does not predict the candidate's map; the model is not used


def add_insights(mod, cands, base, add):
    C = mod["candidatos"]
    el = [c for c in cands if c["eleito"] and c["numero"] in C]
    ok = [c for c in el if C[c["numero"]]["r2_oos"] >= R2_OK]
    r2 = sorted(((c, C[c["numero"]]["r2_oos"]) for c in el), key=lambda x: -x[1])
    add("vereadores", "Voto de perfil × voto de rede pessoal",
        f"Um modelo que prevê a votação de cada local só pelo perfil dele (idade, escolaridade, renda, infraestrutura, voto em Lula), testado em áreas que não viu, "
        f"explica bem o mapa de {len(ok)} dos 23 eleitos: " + ", ".join(f"{c['nome']} (R² {v:.2f})" for c, v in r2 if v >= R2_OK)
        + f". Para os outros {len(el) - len(ok)}, o perfil não prevê onde eles têm voto (R² perto de zero): a votação vem de rede pessoal e território próprio, "
        "e o crescimento depende de presença física, não de 'público-alvo'.", 0.85, {"tab": "vereadores"})
    pot = sorted(((c, sum(max(0, -v) for v in C[c["numero"]]["residuo"].values())) for c in ok), key=lambda x: -x[1])
    if pot:
        add("vereadores", "Potencial não realizado (onde o modelo é confiável)",
            "Para os eleitos cujo voto é bem explicado pelo perfil, votos que locais parecidos com a base deles 'preveem' e eles não obtiveram: "
            + ", ".join(f"{c['nome']} (+{v:,.0f})".replace(",", ".") for c, v in pot)
            + ". Estes são os locais com eleitor parecido com o deles, ainda pouco trabalhados (ver Plano de votos).", 0.84, {"tab": "planejador", "pmodo": "plano"})
    s, j = C.get("prefeito:44"), C.get("prefeito:45")
    if s and j:
        add("regioes", "O voto para prefeito não é explicado pelo perfil social",
            f"O perfil dos locais explica pouco do voto em Simão (R² {s['r2_oos']:.2f}) e um pouco mais o de Dr. Julio (R² {j['r2_oos']:.2f}): "
            "em 2024 o voto municipal seguiu fatores locais (território, lideranças), não recortes de renda, idade ou escolaridade.",
            0.7, {"tab": "regioes"})
