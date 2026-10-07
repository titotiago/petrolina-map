# Petrolina-PE electoral map (2024 → 2028)

An interactive map of Petrolina's elections, built to plan for 2028. It focuses on the **23 councillors (vereadores) elected in 2024** and on **region-level analysis**. It also includes:
- every election since 2016: municipal 2016, 2020 and 2024; general 2022 (both rounds) and 2026 (1st round, including president);
- the voter profile by section and polling place;
- Census 2022 data (demography, literacy, income, urban infrastructure) and public facilities (CNES health units, OSM schools);
- campaign finance;
- council activity (Câmara de Petrolina), municipal spending (TCE-PE), federal amendments and works.

The interface is in Portuguese (pt-BR). Auto-generated findings are also written to [`INSIGHTS.md`](INSIGHTS.md).

## Quick start

```bash
# 1. data (Python 3.11+)
python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
.venv/bin/python -I pipeline/download.py     # ~3 GB of TSE/IBGE zips into data/raw (cached)
.venv/bin/python -I pipeline/extract.py      # keep only Petrolina rows -> data/interim
.venv/bin/python -I pipeline/externos/camara.py   # optional: Câmara listings (slow, polite crawl; cached)
.venv/bin/python -I pipeline/externos/tce.py      # optional: TCE-PE municipal expenses (cached)
.venv/bin/python -I pipeline/externos/federal.py  # optional: amendments, special transfers, federal works, procurement
.venv/bin/python -I pipeline/build.py        # analysis -> web/public/data/*.json + INSIGHTS.md
.venv/bin/python -m pytest pipeline/tests -q # data tests (official totals, seats, integrity)

# 2. web app
cd web && npm install && npm run dev         # http://localhost:5173
npm run build                                # static bundle in web/dist (works from any host/sub-path)
npx playwright test                          # UI tests (every view, simulator, Monte Carlo, routes, search, geolocation)
```

## What's in the app

| Tab | Purpose |
|---|---|
| **Vereadores** (default) | Table of the 23 elected councillors, plus names to watch, those who ran in 2026, and all 254 candidates. Columns: votes, how they were elected (party quotient or leftover seats), base region, territorial profile, change since 2020, 2028 vulnerability score, cost per vote. The map colours each polling place by the camp of its most-voted councillor candidate. |
| Councillor profile | Vote share, raw votes, relative strength (vs. city average) or change since 2020 at every polling place. Also shows: the radius holding 50% and 80% of the vote; votes by region; top polling places; margin over the party's first alternate; 2020 history; 2026 candidacy; 2026 candidates with matching vote patterns; typical voter profile; overlapping rivals; finance (sources, donations from other candidates, suppliers, assets). |
| **Geografia do voto** | Each polling place drawn as its **catchment area**: a Voronoi cell, clipped to the municipality and capped at 8 km. Modes include **Polarização** (Lula × Bolsonaro 2022 and the change to 2026), **Renda e infraestrutura** (Census 2022) and **Equipamentos** (CNES/SUS health units, OSM schools and squares, distance to the nearest UBS), plus: **Domínio** (which elected councillor leads each area, plus "no-man's-land" areas where no elected councillor has 8%); **Conflito** (areas where 2+ elected councillors each have 6%+, with head-to-head pairs); **Redutos** (local Moran's I / LISA with 9,999 permutations: statistically significant strongholds, isolated strengths and gaps for each councillor, mayor, governor and senator; zero-vote places shown as "sem votos"); **Perfis** (k-means segmentation of places by vote, turnout, fragmentation and voter profile); **Registro** (voters per adult, Census 2022, neighbourhood-smoothed). |
| **Regiões** | Region ranking on 12 metrics: representation on the council, vote fragmentation, mayor vs. allied councillors, swing, abstention, new voters in 2028, literacy, and more. Includes small-multiple maps, a page per region, a **lasso tool** for any custom area, and a view per IBGE neighbourhood (click a neighbourhood on the map). |
| **Planejador 2028** | **Cenários + Monte Carlo:** apply projected electorate growth, region × camp swings and per-candidate changes (plus the slate moves) and simulate thousands of elections with uncertainty calibrated on 2020→2024 changes → probability of election per candidate and seat ranges per party. **Field routes:** turns the vote plan into daily visit routes (nearest neighbour + 2-opt), with Google Maps links. **Slate simulator:** move any candidate to another party or federation (they keep their 2024 votes), add hypothetical candidates, optionally scale votes to the projected 2028 electorate, and see who gets elected under the full rules. Shows who comes in, who goes out, and seats by party. **Vote plan:** for any candidate and a vote target, a ranked list of polling places where the missing votes are most reachable. Each place's ceiling is the share the candidate already gets in the 6 nearest places (80th percentile), applied to the 2028 projected electorate; places are tagged as LISA gaps or strongholds. |
| **Comparar candidatos** | Up to 3 candidates side by side: votes, trend, margin, vulnerability, territory, Moran's I, mayor coattail, finance, 2026 run. Map of who leads where, and votes by region. |
| Achados | Auto-generated, ranked findings. Each opens the matching view. |
| Sobreposição | Three modes. **Território (onde):** the original place-level overlap (network and matrix). **Perfil do eleitor (quem):** voter-profile similarity, net of geography, from section-level data. **Disputa combinada:** territory × profile quadrants (disputa direta, disputa territorial, mesmo lugar com públicos diferentes, mesmo público em outro lugar). Selecting a pair shows a head-to-head panel with both measures. Territory-mode details: overlap **network**: classical MDS on 1 − overlap, so candidates with similar territories sit close; links show overlap ≥ 60%. Also a 23×23 heatmap and a head-to-head map for any pair. |
| Cadeiras & simulador | 2024 seat allocation rebuilt and checked against the official result (party quotient, leftover seats, first alternates, votes needed for one more seat), plus an editable 2028 seat simulator. |
| Explorar mapa | Any election (2016 → 2026, both rounds of 2022), any office and any metric, with an animated **timeline** and a "change vs previous election" metric (same number/party). Census tract choropleth (incl. income and infrastructure), CSV export. |
| **Mandatos e recursos** | **Câmara:** indicações and requerimentos per councillor, where they point (neighbourhoods on the map) and "does the councillor work where they are voted?". **Gasto da prefeitura:** TCE-PE commitments whose description names a neighbourhood, by region and per voter (a sample — only ~1.5% of spending names a place). **Emendas federais:** money received by Petrolina entities, by author, linked to the author's votes in Petrolina. **Obras federais** (Obrasgov). |
| **Transferência de votos** | Ecological-inference estimates of where each option's voters went (2020→2024 mayor, 2022 president→2024 mayor, 2024 mayor→2026 governor, 2022→2026 president), with 90% bootstrap intervals and a Sankey diagram. |
| Fontes | Sources, definitions, and polling places with approximate coordinates. |

The view state is kept in the URL, so links can be shared.

**Colours:** each party uses its traditional identity colour (table in `web/src/colors.ts` → `PARTY`). Federations take their lead party's colour. Mayoral "camps" use the colour of the mayoral candidate's party: Simão = União, Dr. Julio = PSDB, Odacy = PT, Lara = PL.

**Global search** (top bar): jump to any candidate, polling place, IBGE neighbourhood or region.

## Data sources

- **TSE open data** (`cdn.tse.jus.br/estatistica/sead/odsele/…`), for 2020, 2024 and 2026:
  - votes by section (`votacao_secao`)
  - turnout, blank and null votes by section (`detalhe_votacao_secao`)
  - polling places with coordinates (`eleitorado_local_votacao`)
  - voter profile by section (`perfil_eleitor_secao`)
  - candidates and coalitions (`consulta_cand`, `consulta_coligacao`)
  - declared assets (`bem_candidato`)
  - campaign receipts and contracted expenses (`prestacao_contas`)
- **IBGE Census 2022:**
  - census tract, neighbourhood and district boundaries, with their attributes
  - per-tract aggregates: demographics and literacy. IBGE has not published per-tract income in these aggregates.

TSE municipality code: 25216. IBGE code: 2611101.

## Method notes

- **Geographic unit:** the polling place, which aggregates its sections. Sections are assigned to polling places from that year's polling-place file.
  - Polling places from 2020 and 2026 are matched to 2024 places by number and name, then name, then distance, then TSE neighbourhood. The build prints any vote total that doesn't match.
- **Coordinates:** the 2024 TSE coordinates are used where available. Otherwise:
  - the same school's coordinates from 2026 or 2020;
  - then `pipeline/geocode_fix.csv`;
  - then the IBGE neighbourhood centroid or the mean position of other polling places in the same TSE neighbourhood.
  - These approximate places are listed in the Fontes tab.
- **Regions:** defined in `pipeline/regions.csv`, one row per polling place.
  - On the first run the file is generated from the IBGE neighbourhoods (direction and distance from the Centro) and the rural districts and irrigation projects.
  - **Edit the `regiao` column and re-run `build.py`** to regroup.
  - Region polygons are census tracts grouped by their nearest polling place.
- **Camps:** each party is mapped to the mayoral candidate its 2024 coalition backed (`consulta_coligacao`).
- **Seat allocation** follows Lei 14.211/2021 and STF ADI 7228:
  - Electoral quotient (QE) = valid votes ÷ 23, rounded.
  - Seats by party quotient (QP) go to candidates with at least 10% of the QE.
  - Leftover seats go by highest averages, among parties with at least 80% of the QE and candidates with at least 20% of it.
  - Any seats still left go to all parties by highest average.
  - The reconstruction reproduces the official 23 exactly. `build.py` checks this.
- **Vulnerability score (0–1):**
  - margin over the party's first alternate: 30%
  - change in votes since 2020: 20%
  - elected by leftover seats: 15%
  - overlap with a stronger colleague: 15%
  - cost per vote: 10%
  - dependence on the party's total: 10%
- **Intra-party competition:** for each elected councillor, candidates from the same party or federation, scored by overlap × (their votes ÷ the councillor's votes). A strong alternate from the same list is added as a vulnerability reason.
- **Demographic signature:** correlation, weighted by voters, between a candidate's vote share per place and place features (voter age and education, turnout, mayoral vote, Census literacy and density).
- **LISA:** row-standardised k-nearest weights (k = 6), with one-sided conditional permutation pseudo p-values (9,999 draws, p < 0.05). Classes: reduto (HH), ilha (HL) and brecha (LH, which can be a zero-vote place inside a strong area). Every other place with zero votes is labelled "Sem votos"; everything else is "no significant pattern". The low-surrounded-by-low class (LL) is not shown, because it only describes absence.
- **Coattails ("efeito Simão"):** correlation, weighted by voters, between a councillor's share and Simão's share across polling places.
- **Vote inheritance:** for each 2020 councillor no longer in the council, the 2024 candidates whose per-place share best correlates with that councillor's 2020 share.
- **2028 projection:** voters per place = 2026 voters × regional growth (60% of the 2024→26 pace + 40% of the 2020→24 pace, per two years). The projected QE assumes 2024's valid-vote rate.
- **Voter-profile competition** (`pipeline/perfil_disputa.py`): uses the 701 sections and the TSE profile per section (age bands, schooling, sex).
  - **Appeal:** for each candidate, Σ votes × (section profile − profile of its polling place) ÷ Σ votes. This measures how the candidate's voters differ from the voters of the *same schools*, which removes geography.
  - **Noise:** the appeal is normalised by a within-school permutation test (300 shuffles of the candidate's votes among the sections of each school).
  - **Profile clarity ("nitidez"):** the RMS of those t-values; about 1 means indistinguishable from chance.
  - **Profile similarity:** the cosine of two candidates' t-vectors, shrunk by their clarity. Section-level territorial overlap is Σ min(pᵢ, qᵢ) over sections.
  - **Limits:** this is ecological inference, because the vote is secret. It shows tendencies, not individual votes.
- **Overlap** between two candidates = Σ min(pᵢ, qᵢ), where p and q are each candidate's share of their own vote at each polling place.
- **2026 vote-pattern match:** Pearson correlation across polling places between the councillor's 2024 vote share and each 2026 candidate's share.
- **New voters in 2028:** Census 2022 people aged 10–14, plus 40% of those aged 15–19. This is a rough estimate.

## App extras
- **Installable / offline (PWA):** add to the phone's home screen; app shell, data and viewed map tiles are cached for field use.
- **"Onde estou":** uses GPS to open the nearest polling place with the local summary and the next closest places.
- **Tests gate every deploy:** pytest (official totals, seat allocation, data integrity) and Playwright (every view and key interactions).

## Refreshing for 2028

When TSE publishes the 2026 2nd round or the 2028 files, add the zips to `SOURCES` in `pipeline/download.py` and the matching jobs to `pipeline/extract.py`. Then re-run the three pipeline steps. Everything downstream is computed from those files.
