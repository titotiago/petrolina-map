"""Roadmap item 8 — vote transfers between elections (ecological inference).

Votes are secret, so transfers are *estimated* from how results co-vary across the 122 polling places.
For a pair of elections we solve, at place level,

    y_p ≈ x_p · T        with every row of T a probability vector (T ≥ 0, rows sum to 1)

where x_p are the shares of the electorate (eligible voters) of each option in election A (including blank/null
and abstention) and y_p the same for election B. T[i, j] = estimated share of option-i voters of A who chose
option j in B. Solved by projected gradient (weighted by electorate); 90% intervals by bootstrapping places.
Limitations (shown in the UI): ecological fallacy, electorate turnover between elections, small number of units.
"""
import numpy as np
import pandas as pd

from common import r

RNG = np.random.default_rng(2028)
N_BOOT = 200

# (key, title, (election, office, groups), (election, office, groups)); groups: label -> list of numbers; rest -> "Outros"
FLOWS = [
    ("prefeito_2020_2024", "Prefeito 2020 → Prefeito 2024",
     (2020, "prefeito", {"Miguel Coelho": ["15"], "Júlio Lóssio Filho": ["55"], "Odacy": ["13"]}),
     (2024, "prefeito", {"Simão Durando": ["44"], "Dr. Julio": ["45"], "Lara": ["22"], "Odacy": ["13"]})),
    ("lula_prefeito", "Presidente 2022 (2º t.) → Prefeito 2024",
     ("2022-2", "presidente", {"Lula": ["13"], "Bolsonaro": ["22"]}),
     (2024, "prefeito", {"Simão Durando": ["44"], "Dr. Julio": ["45"], "Lara": ["22"], "Odacy": ["13"]})),
    ("prefeito_governador", "Prefeito 2024 → Governador 2026",
     (2024, "prefeito", {"Simão Durando": ["44"], "Dr. Julio": ["45"], "Lara": ["22"], "Odacy": ["13"]}),
     (2026, "governador", {"Raquel Lyra": ["55"], "João Campos": ["40"]})),
    ("presidente_2022_2026", "Presidente 2022 (2º t.) → Presidente 2026",
     ("2022-2", "presidente", {"Lula": ["13"], "Bolsonaro": ["22"]}),
     (2026, "presidente", {"Lula": ["13"], "Flávio Bolsonaro": ["22"]})),
]


def shares_of_electorate(ctx, key, cargo, groups) -> pd.DataFrame:
    v = ctx.votes[key]
    v = v[v.cargo == cargo]
    m = v.pivot_table(index="place", columns="numero", values="votos", aggfunc="sum", fill_value=0)
    out = pd.DataFrame(index=m.index)
    used = set()
    for label, nums in groups.items():
        out[label] = m[[n for n in nums if n in m]].sum(axis=1)
        used |= set(nums)
    bn = [n for n in ("95", "96") if n in m]
    out["Outros"] = m[[c for c in m.columns if c not in used and c not in bn]].sum(axis=1)
    out["Branco/nulo"] = m[bn].sum(axis=1)
    d = ctx.det[key]
    d = d[d.cargo == (cargo if cargo in set(d.cargo) else d.cargo.iloc[0])].set_index("place")
    aptos = d.QT_APTOS.reindex(out.index)
    out["Abstenção"] = (aptos - out.sum(axis=1)).clip(lower=0)
    tot = out.sum(axis=1)
    keep = [c for c in out.columns if out[c].sum() >= 0.005 * tot.sum()]  # drop options that barely exist (e.g. "Outros" in a 2-candidate runoff)
    out = out[keep]
    return out.div(out.sum(axis=1), axis=0), out.sum(axis=1)


def project_rows(T):
    """Project each row onto the probability simplex."""
    out = np.empty_like(T)
    for i, v in enumerate(T):
        u = np.sort(v)[::-1]
        css = np.cumsum(u) - 1
        k = np.nonzero(u - css / (np.arange(len(u)) + 1) > 0)[0][-1]
        out[i] = np.maximum(v - css[k] / (k + 1), 0)
    return out


def solve(X, Y, w, iters=4000):
    T = np.full((X.shape[1], Y.shape[1]), 1 / Y.shape[1])
    W = w / w.sum()
    L = np.linalg.norm((X * W[:, None]).T @ X, 2) * 2 + 1e-9
    for _ in range(iters):
        G = 2 * (X * W[:, None]).T @ (X @ T - Y)
        T = project_rows(T - G / L)
    return T


def run(ctx) -> dict:
    out = {}
    for key, title, (ka, ca, ga), (kb, cb, gb) in FLOWS:
        A, na = shares_of_electorate(ctx, ka, ca, ga)
        B, nb = shares_of_electorate(ctx, kb, cb, gb)
        idx = A.index.intersection(B.index)
        idx = idx[(na.reindex(idx) > 0) & (nb.reindex(idx) > 0)]
        X, Y, w = A.loc[idx].values, B.loc[idx].values, nb.loc[idx].values.astype(float)
        T = solve(X, Y, w)
        boots = []
        for _ in range(N_BOOT):
            s = RNG.integers(0, len(idx), len(idx))
            boots.append(solve(X[s], Y[s], w[s], iters=1500))
        boots = np.array(boots)
        lo, hi = np.percentile(boots, 5, axis=0), np.percentile(boots, 95, axis=0)
        # absolute flows in voters: row share of A's electorate (city) × transfer
        tot_a = (A.loc[idx].mul(na.loc[idx], axis=0)).sum()
        fit = 1 - np.sum(w[:, None] * (Y - X @ T) ** 2) / np.sum(w[:, None] * (Y - np.average(Y, axis=0, weights=w)) ** 2)
        out[key] = {
            "titulo": title, "de": list(A.columns), "para": list(B.columns), "locais": int(len(idx)), "r2": r(fit, 3),
            "T": [[r(v, 3) for v in row] for row in T], "lo": [[r(v, 3) for v in row] for row in lo], "hi": [[r(v, 3) for v in row] for row in hi],
            "eleitores_origem": {c: int(v) for c, v in tot_a.items()},
            "fluxos": [[int(round(tot_a.iloc[i] * T[i, j])) for j in range(T.shape[1])] for i in range(T.shape[0])],
        }
    return out


def add_insights(ei, add):
    def cell(k, a, b):
        f = ei[k]
        i, j = f["de"].index(a), f["para"].index(b)
        return f["T"][i][j], f["lo"][i][j], f["hi"][i][j]
    try:
        m, lo, hi = cell("prefeito_2020_2024", "Miguel Coelho", "Simão Durando")
        a, alo, ahi = cell("prefeito_2020_2024", "Miguel Coelho", "Abstenção")
        add("2026", "Transferência Miguel 2020 → Simão 2024 (estimativa)",
            f"Estimativa por inferência ecológica: cerca de {m * 100:.0f}% dos eleitores de Miguel Coelho em 2020 votaram em Simão em 2024 "
            f"(intervalo de 90%: {lo * 100:.0f}–{hi * 100:.0f}%); cerca de {a * 100:.0f}% se abstiveram ({alo * 100:.0f}–{ahi * 100:.0f}%). "
            "Estimativa a partir de 122 locais — indica tendência, não o voto de cada pessoa.", 0.8, {"tab": "insights"})
        l, llo, lhi = cell("lula_prefeito", "Lula", "Simão Durando")
        b, blo, bhi = cell("lula_prefeito", "Bolsonaro", "Simão Durando")
        add("2026", "Eleitor de Lula e de Bolsonaro no voto para prefeito (estimativa)",
            f"Dos eleitores de Lula no 2º turno de 2022, cerca de {l * 100:.0f}% votaram em Simão em 2024 ({llo * 100:.0f}–{lhi * 100:.0f}%); "
            f"dos de Bolsonaro, cerca de {b * 100:.0f}% ({blo * 100:.0f}–{bhi * 100:.0f}%). Intervalos largos indicam incerteza alta.", 0.74, {"tab": "insights"})
        s, slo, shi = cell("prefeito_governador", "Simão Durando", "Raquel Lyra")
        add("2026", "Eleitor de Simão no governo do estado em 2026 (estimativa)",
            f"Cerca de {s * 100:.0f}% dos eleitores de Simão (2024) votaram em Raquel Lyra para governadora em 2026 ({slo * 100:.0f}–{shi * 100:.0f}%).",
            0.72, {"tab": "insights"})
    except (KeyError, ValueError):
        pass
