// Free exploration: any election / office / metric, plus census and boundary layers.
import type { App } from "../app";
import { aggVotes, candName, candParty, esc, fmt, pct, pp, ranked, valid } from "../data";
import { div, DIV_STOPS, scaler, seq, SEQ_STOPS, partyColor } from "../colors";
import type { PlaceStyle } from "../map";
import { bindHrefs, csvDownload, legendRamp, partyLegend } from "./common";

export const CARGOS: Record<string, [string, string][]> = {
  "2016": [["prefeito", "Prefeito"], ["vereador", "Vereador"]],
  "2020": [["prefeito", "Prefeito"], ["vereador", "Vereador"]],
  "2022": [["presidente", "Presidente"], ["governador", "Governador"], ["senador", "Senador"], ["dep_federal", "Dep. federal"], ["dep_estadual", "Dep. estadual"]],
  "2022-2": [["presidente", "Presidente"], ["governador", "Governador"]],
  "2024": [["prefeito", "Prefeito"], ["vereador", "Vereador"]],
  "2026": [["presidente", "Presidente"], ["governador", "Governador"], ["senador", "Senador"], ["dep_federal", "Dep. federal"], ["dep_estadual", "Dep. estadual"]],
};
export const YEAR_LABEL: Record<string, string> = { "2016": "2016", "2020": "2020", "2022": "2022 · 1º t.", "2022-2": "2022 · 2º t.", "2024": "2024", "2026": "2026 · 1º t." };
let timer: number | undefined;
const METRICS: [string, string, string][] = [
  ["vencedor", "Mais votado", "Cor = candidato (ou campo, para vereador) mais votado no local"],
  ["candidato", "Candidato escolhido (%)", "Participação do candidato escolhido nos votos válidos do local"],
  ["delta_numero", "Candidato/partido: variação vs eleição anterior", "Participação do mesmo número (candidato ou partido) em relação à eleição anterior do mesmo cargo"],
  ["comparecimento", "Comparecimento", "Comparecimento ÷ aptos"],
  ["abstencao", "Abstenção", "Abstenções ÷ aptos"],
  ["brancos_nulos", "Brancos + nulos", "(Brancos + nulos) ÷ comparecimento"],
  ["swing", "Grupo Coelho 2020→2024", "Simão 2024 − Miguel Coelho 2020 (% válidos), por local"],
  ["swing_comp", "Comparecimento 2020→2024", "Variação do comparecimento em p.p."],
  ["divergencia", "Prefeito − vereadores do governo", "Simão (% válidos) − soma dos vereadores e legendas da coligação dele"],
  ["eleitos", "% do voto de vereador em eleitos", "Parte dos votos de vereador que elegeu alguém"],
  ["nec", "Fragmentação (vereador)", "Número efetivo de candidatos a vereador no local"],
  ["jovem", "Eleitores 16–24", "% do eleitorado do local"],
  ["idoso", "Eleitores 60+", "% do eleitorado do local"],
  ["superior", "Ensino superior", "% do eleitorado com superior (completo ou incompleto)"],
];
const SMETRICS: [string, string, (p: Record<string, number>) => number, (x: number) => string][] = [
  ["densidade", "Densidade (hab/km²)", (p) => p.densidade, (x) => fmt(x)],
  ["v0001", "População", (p) => p.v0001, (x) => fmt(x)],
  ["pop_10_14", "Pessoas 10–14 anos (novos eleitores 2028)", (p) => p.pop_10_14, (x) => fmt(x)],
  ["taxa_alfab", "Alfabetização 15+", (p) => p.taxa_alfab, (x) => pct(x)],
  ["renda_media", "Renda média do responsável (R$)", (p) => p.renda_media, (x) => `R$ ${fmt(x)}`],
  ["infra", "Infraestrutura urbana (entorno)", (p) => p.infra, (x) => pct(x, 0)],
  ["pavimentacao", "Ruas pavimentadas", (p) => p.pavimentacao, (x) => pct(x, 0)],
  ["onibus", "Ponto de ônibus na quadra", (p) => p.onibus, (x) => pct(x, 0)],
  ["pct_60m", "% com 60+ anos", (p) => p.pct_60m, (x) => pct(x)],
];

function detVal(app: App, year: string, cargo: string, id: string, k: string) {
  const d = app.db.detalhe[year]?.[cargo]?.[id];
  if (!d) return NaN;
  const [aptos, comp, abst, , br, nu] = d;
  return k === "comparecimento" ? comp / aptos : k === "abstencao" ? abst / aptos : (br + nu) / comp;
}

export function metricValue(app: App, id: string, metric: string, year: string, cargo: string, num?: string): number {
  const db = app.db;
  const p = db.byId.get(id)!;
  const share = (y: string, c: string, n: string) => { const v = db.votos[y]?.[c]?.[id] ?? {}; return (v[n] ?? 0) / (valid(v) || NaN); };
  switch (metric) {
    case "candidato": return num ? share(year, cargo, num) : NaN;
    case "delta_numero": {
      const prev = prevYear(year, cargo);
      return num && prev ? share(year, cargo, num) - share(prev, cargo, num) : NaN;
    }
    case "comparecimento": case "abstencao": case "brancos_nulos": return detVal(app, year, cargo === "vereador" ? "vereador" : cargo, id, metric);
    case "swing": return share("2024", "prefeito", "44") - share("2020", "prefeito", "15");
    case "swing_comp": return detVal(app, "2024", "prefeito", id, "comparecimento") - detVal(app, "2020", "prefeito", id, "comparecimento");
    case "divergencia": {
      const v = db.votos["2024"].vereador[id] ?? {};
      let gov = 0;
      for (const [n, x] of Object.entries(v)) {
        const camp = n.length > 2 ? db.vByNum.get(n)?.campo : db.cadeiras.partidos.find((q) => db.vereadores.some((c) => c.partido_chave === q.partido && c.numero.startsWith(n)))?.campo;
        if (camp === "SIMÃO DURANDO") gov += x;
      }
      return share("2024", "prefeito", "44") - gov / (valid(v) || NaN);
    }
    case "eleitos": { const v = db.votos["2024"].vereador[id] ?? {}; return Object.entries(v).reduce((s, [n, x]) => s + (db.vByNum.get(n)?.eleito ? x : 0), 0) / (valid(v) || NaN); }
    case "nec": { const v = ranked(db.votos["2024"].vereador[id] ?? {}).filter(([n]) => n.length > 2); const t = v.reduce((s, [, x]) => s + x, 0); return 1 / v.reduce((s, [, x]) => s + (x / t) ** 2, 0); }
    case "jovem": return ((p.perfil["idade_16-17"] ?? 0) + (p.perfil["idade_18-24"] ?? 0)) / p.perfil.total;
    case "idoso": return (p.perfil["idade_60+"] ?? 0) / p.perfil.total;
    case "superior": return (p.perfil.esc_superior ?? 0) / p.perfil.total;
  }
  return NaN;
}

const FMT: Record<string, (x: number) => string> = { delta_numero: (x) => pp(x), swing: (x) => pp(x), swing_comp: (x) => pp(x), divergencia: (x) => pp(x), nec: (x) => x.toFixed(0) };
const DIVERGING = new Set(["swing", "swing_comp", "divergencia", "delta_numero"]);

/** Most recent earlier election with the same office (e.g. 2026 presidente → 2022 2º turno). */
export function prevYear(year: string, cargo: string): string | null {
  const ys = Object.keys(CARGOS);
  for (let i = ys.indexOf(year) - 1; i >= 0; i--) if (CARGOS[ys[i]].some(([k]) => k === cargo)) return ys[i];
  return null;
}

export function renderExplorar(app: App) {
  const { db, state } = app;
  const year = state.year in CARGOS ? state.year : "2024";
  const cargo = CARGOS[year].some(([k]) => k === state.cargo) ? state.cargo : CARGOS[year][0][0];
  const metric = state.metric;
  const cityIds = db.locais.map((p) => p.id);
  const city = ranked(aggVotes(db, year, cargo, cityIds)).filter(([n]) => n.length > 2 || ["prefeito", "governador"].includes(cargo));
  const num = state.num && city.some(([n]) => n === state.num) ? state.num : city[0]?.[0];
  // ---- places
  const st = new Map<string, PlaceStyle>();
  let legend = "";
  if (metric === "vencedor") {
    const winners: string[] = [];
    for (const p of db.locais) {
      const v = ranked(db.votos[year]?.[cargo]?.[p.id] ?? {}).filter(([n]) => n.length > 2 || ["prefeito", "governador"].includes(cargo));
      if (!v.length) continue;
      const [n] = v[0];
      if (cargo === "vereador" && year === "2024") st.set(p.id, { color: partyColor(db.vByNum.get(n)?.partido), label: db.vByNum.get(n)?.nome });
      else st.set(p.id, { color: partyColor(candParty(db, year, cargo, n)), label: candName(db, year, cargo, n) });
      winners.push(cargo === "vereador" ? candParty(db, year, cargo, n) : `${candName(db, year, cargo, n)} (${candParty(db, year, cargo, n)})`);
    }
    legend = cargo === "vereador"
      ? partyLegend(winners, "Partido do mais votado no local (nº de locais)", [], partyColor)
      : partyLegend(winners, "Mais votado no local (nº de locais)", [], (k) => partyColor(k.match(/\(([^)]+)\)$/)?.[1]));
  } else {
    const vals = new Map(cityIds.map((id) => [id, metricValue(app, id, metric, year, cargo, num)]));
    const arr = [...vals.values()].filter(isFinite);
    const f = FMT[metric] ?? ((x: number) => pct(x));
    if (DIVERGING.has(metric)) {
      const m = Math.max(...arr.map(Math.abs));
      vals.forEach((x, id) => isFinite(x) && st.set(id, { color: div(x / m) }));
      const pv = prevYear(year, cargo);
      legend = legendRamp(DIV_STOPS(), f(-m), f(m), metric === "delta_numero" ? `${candName(db, year, cargo, num!)} (nº ${num}) — ${pv ? YEAR_LABEL[pv] : "?"} → ${YEAR_LABEL[year]}` : METRICS.find((x) => x[0] === metric)![1]);
    } else {
      const sc = scaler(arr, 0.98);
      vals.forEach((x, id) => isFinite(x) && st.set(id, { color: seq(0.1 + 0.9 * sc.f(x)) }));
      legend = legendRamp(SEQ_STOPS, f(sc.lo), f(sc.hi), metric === "candidato" ? `${candName(db, year, cargo, num!)} — % válidos` : METRICS.find((x) => x[0] === metric)![1]);
    }
  }
  app.map.setPlaces(st, (id) => {
    const p = db.byId.get(id)!;
    const v = db.votos[year]?.[cargo]?.[id] ?? {};
    const t = valid(v);
    const top = ranked(v).slice(0, 3);
    const mv = metric !== "vencedor" ? `<br>${esc(METRICS.find((x) => x[0] === metric)?.[1])}: ${(FMT[metric] ?? ((x: number) => pct(x)))(metricValue(app, id, metric, year, cargo, num))}` : "";
    return `<b>${esc(p.nome)}</b><br>${esc(p.regiao)} · ${fmt(p.eleitores)} eleitores${mv}<br>${top.map(([n, x]) => `${esc(candName(db, year, cargo, n))}: ${pct(x / t)}`).join("<br>")}`;
  });
  app.map.setOverlay([]);
  // ---- polygons
  const sm = SMETRICS.find((x) => x[0] === state.smetric) ?? SMETRICS[0];
  if (state.layer === "setores") {
    const props = db.geo.setores.features.map((f) => f.properties as Record<string, number>);
    const sc = scaler(props.map(sm[2]).filter(isFinite), 0.97);
    const fills = new Map(db.geo.setores.features.map((f) => [String((f.properties as Record<string, unknown>).CD_SETOR), seq(sc.f(sm[2](f.properties as Record<string, number>)))]));
    const byCode = new Map(db.geo.setores.features.map((f) => [String((f.properties as Record<string, unknown>).CD_SETOR), f.properties as Record<string, number & string>]));
    app.map.setPoly("setores", fills, (k) => { const p = byCode.get(k)!; return `<b>Setor ${esc(k)}</b><br>${esc(p.NM_BAIRRO ?? p.NM_DIST)} · ${esc(p.regiao)}<br>${esc(sm[1])}: ${sm[3](sm[2](p))}<br>População: ${fmt(p.v0001)}`; }, undefined, 0.6);
    legend += `<div class="sep"></div>` + legendRamp(SEQ_STOPS, sm[3](sc.lo), sm[3](sc.hi), `Censo 2022 — ${sm[1]}`);
  } else if (state.layer === "bairros") {
    app.map.setPoly("bairros", new Map(db.geo.bairros.features.map((f) => [String((f.properties as Record<string, unknown>).NM_BAIRRO), "rgba(0,0,0,0)"])), (k) => `<b>${esc(k)}</b> (clique para analisar o bairro)`, undefined, 0.01);
  } else if (state.layer === "regioes") {
    app.map.setPoly("regioes", new Map(Object.keys(db.regioes).map((k) => [k, "rgba(0,0,0,0)"])), (k) => `<b>${esc(k)}</b> (clique para abrir)`, undefined, 0.01);
  } else app.map.setPoly("none");
  app.legend(legend);
  // ---- panel
  const total = valid(Object.fromEntries(city));
  app.panel.innerHTML = `
    <div class="ph"><div class="eyebrow">Explorador</div><h2>Qualquer eleição, cargo e métrica</h2></div>
    <div class="form">
      <div class="wide"><label>Linha do tempo</label><div class="seg small timeline">${Object.keys(CARGOS).map((y) => `<button class="${y === year ? "on" : ""}" data-y="${y}">${YEAR_LABEL[y]}</button>`).join("")}<button id="play" title="Animar a sequência de eleições">${timer ? "■ parar" : "▶ animar"}</button></div></div>
      <label>Cargo <select id="c">${CARGOS[year].map(([k, l]) => `<option value="${k}" ${k === cargo ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="wide">Métrica <select id="m">${METRICS.map(([k, l]) => `<option value="${k}" ${k === metric ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="wide">Candidato <input id="q" list="cands" placeholder="buscar nome ou número" value="${num ? esc(`${candName(db, year, cargo, num)} (${num})`) : ""}"><datalist id="cands">${city.map(([n]) => `<option value="${esc(candName(db, year, cargo, n))} (${n})">`).join("")}</datalist></label>
      <label>Camada <select id="l">${[["regioes", "Regiões"], ["bairros", "Bairros (IBGE)"], ["setores", "Setores censitários"], ["none", "Nenhuma"]].map(([k, l]) => `<option value="${k}" ${k === state.layer ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${state.layer === "setores" ? `<label class="wide">Variável do Censo <select id="sm">${SMETRICS.map(([k, l]) => `<option value="${k}" ${k === sm[0] ? "selected" : ""}>${l}</option>`).join("")}</select></label>` : ""}
    </div>
    <p class="muted small">${esc(METRICS.find((x) => x[0] === metric)?.[2] ?? "")}. Clique num local para o detalhe; clique numa região/bairro para o recorte.</p>
    <h3>Resultado na cidade — ${esc(CARGOS[year].find(([k]) => k === cargo)![1])} ${YEAR_LABEL[year]}</h3>
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>#</th><th>Candidato</th><th>Partido</th><th class="num">Votos</th><th class="num">%</th></tr></thead><tbody>
    ${city.slice(0, 25).map(([n, x], i) => `<tr class="clickable ${n === num ? "sel" : ""}" data-href="num=${n}&metric=candidato"><td>${i + 1}</td><td>${esc(candName(db, year, cargo, n))}</td><td>${esc(candParty(db, year, cargo, n))}</td><td class="num">${fmt(x)}</td><td class="num">${pct(x / total)}</td></tr>`).join("")}
    </tbody></table></div>
    <button class="btn" id="csv">Exportar resultados por local (CSV)</button>`;
  const P = app.panel;
  const sel = (id: string) => P.querySelector<HTMLSelectElement>(id)!;
  P.querySelectorAll<HTMLButtonElement>(".timeline [data-y]").forEach((b) => b.addEventListener("click", () => { stopTimer(); app.go({ year: b.dataset.y!, num: undefined }); }));
  P.querySelector("#play")!.addEventListener("click", () => {
    if (timer) { stopTimer(); app.go({}); return; }
    const ys = Object.keys(CARGOS);
    timer = window.setInterval(() => {
      if (app.state.tab !== "mapa") return stopTimer();
      const next = ys[(ys.indexOf(app.state.year) + 1) % ys.length];
      app.go({ year: next, num: undefined }, true);
    }, 1800);
    app.go({});
  });
  sel("#c").addEventListener("change", (e) => app.go({ cargo: (e.target as HTMLSelectElement).value, num: undefined }));
  sel("#m").addEventListener("change", (e) => app.go({ metric: (e.target as HTMLSelectElement).value }));
  sel("#l").addEventListener("change", (e) => app.go({ layer: (e.target as HTMLSelectElement).value as never }));
  P.querySelector("#sm")?.addEventListener("change", (e) => app.go({ smetric: (e.target as HTMLSelectElement).value }));
  P.querySelector<HTMLInputElement>("#q")!.addEventListener("change", (e) => {
    const m = /\((\d+)\)\s*$/.exec((e.target as HTMLInputElement).value);
    if (m) app.go({ num: m[1], metric: "candidato" });
  });
  bindHrefs(P, (h) => app.go(Object.fromEntries(new URLSearchParams(h))));
  P.querySelector("#csv")!.addEventListener("click", () => {
    const cands = city.map(([n]) => n);
    csvDownload(`petrolina_${year}_${cargo}_por_local.csv`, ["local_id", "local", "regiao", "bairro", "eleitores", ...cands.map((n) => `${candName(db, year, cargo, n)} (${n})`)],
      db.locais.map((p) => { const v = db.votos[year]?.[cargo]?.[p.id] ?? {}; return [p.id, p.nome, p.regiao, p.bairro_tse, p.eleitores, ...cands.map((n) => v[n] ?? 0)]; }));
  });
}

function stopTimer() { if (timer) { clearInterval(timer); timer = undefined; } }
