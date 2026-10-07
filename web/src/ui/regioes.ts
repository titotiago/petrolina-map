// Region-first views: ranking + small multiples, region profile, free-hand (lasso) areas.
import type { App } from "../app";
import { brl, esc, fmt, pct, pp, title, type Regiao } from "../data";
import { campColor, cat, div, DIV_STOPS, OTHER, scaler, seq, SEQ_STOPS, partyColor } from "../colors";
import type { PlaceStyle } from "../map";
import { areaReport, mayorRows, officeRows, turnoutTiles } from "./place";
import { bars, bindHrefs, legendRamp, perfilBlock, table, tiles } from "./common";

interface Metric { key: string; label: string; get: (r: Regiao) => number; fmt: (x: number) => string; diverging?: boolean; mid?: number; help: string }

export const METRICS: Metric[] = [
  { key: "representacao", label: "Representação na Câmara", get: (r) => r.representacao, fmt: (x) => `${x.toFixed(2).replace(".", ",")}×`, diverging: true, mid: 1,
    help: "Vereadores eleitos com base na região ÷ cadeiras proporcionais ao eleitorado. <1 = sub-representada." },
  { key: "pct_eleitorado", label: "% do eleitorado", get: (r) => r.pct_eleitorado, fmt: (x) => pct(x), help: "Participação no eleitorado de 2024." },
  { key: "vereador_nec", label: "Fragmentação do voto (vereador)", get: (r) => r.vereador_nec, fmt: (x) => x.toFixed(0), help: "Número efetivo de candidatos: quanto maior, mais pulverizado e mais 'aberto' o território." },
  { key: "pct_voto_em_eleitos", label: "% do voto em eleitos", get: (r) => r.pct_voto_em_eleitos, fmt: (x) => pct(x, 0), help: "Parcela dos votos de vereador que elegeu alguém." },
  { key: "divergencia_governo", label: "Prefeito − vereadores do governo", get: (r) => r.divergencia_governo, fmt: (x) => pp(x, 0), diverging: true, mid: 0,
    help: "Voto em Simão menos a soma dos vereadores da coligação dele. Positivo = eleitor do prefeito sem vereador aliado forte." },
  { key: "margem_prefeito_2024", label: "Margem do 1º colocado (prefeito 2024)", get: (r) => r.margem_prefeito_2024, fmt: (x) => pp(x, 0), help: "Diferença entre 1º e 2º colocados." },
  { key: "simao", label: "Simão Durando 2024 (% válidos)", get: (r) => r.prefeito_2024["44"] ?? 0, fmt: (x) => pct(x, 0), help: "Votação do prefeito eleito." },
  { key: "swing", label: "Grupo Coelho 2020→2024", get: (r) => (r.prefeito_2024["44"] ?? 0) - (r.prefeito_2020["15"] ?? 0), fmt: (x) => pp(x, 0), diverging: true, mid: 0,
    help: "Simão 2024 menos Miguel Coelho 2020 (% válidos)." },
  { key: "abstencao", label: "Abstenção 2024", get: (r) => r.comparecimento["2024"].abst, fmt: (x) => pct(x), help: "Abstenção no 1º turno de 2024." },
  { key: "novos", label: "Novos eleitores 2028 (est.)", get: (r) => r.censo.novos_eleitores_2028_est, fmt: (x) => fmt(x), help: "Censo 2022: 10–14 anos + 40% dos 15–19 (chegarão a 16–21 anos em 2028)." },
  { key: "alfab", label: "Taxa de alfabetização (15+)", get: (r) => r.censo.taxa_alfab, fmt: (x) => pct(x), help: "Censo 2022." },
  { key: "eleitores_por_hab", label: "Eleitores por habitante", get: (r) => r.censo.eleitores_por_hab, fmt: (x) => x.toFixed(2).replace(".", ","), help: "Eleitores 2024 ÷ população do Censo 2022 na área. Baixo = possível sub-registro ou crescimento recente." },
];

function colorize(rs: [string, Regiao][], m: Metric) {
  const vals = rs.map(([, r]) => m.get(r));
  const out = new Map<string, string>();
  if (m.diverging) {
    const span = Math.max(...vals.map((x) => Math.abs(x - (m.mid ?? 0))), 1e-9);
    rs.forEach(([k, r]) => out.set(k, div((m.get(r) - (m.mid ?? 0)) / span)));
    return { fills: out, legend: legendRamp(DIV_STOPS(), m.fmt((m.mid ?? 0) - span), m.fmt((m.mid ?? 0) + span), m.label) };
  }
  const sc = scaler(vals, 1);
  rs.forEach(([k, r]) => out.set(k, seq(0.1 + 0.9 * sc.f(m.get(r)))));
  return { fills: out, legend: legendRamp(SEQ_STOPS, m.fmt(sc.lo), m.fmt(sc.hi), m.label) };
}

/** Mini SVG choropleth of the regions (small multiples). */
function miniMap(app: App, fills: Map<string, string>, label: string) {
  const fs = app.db.geo.regioes.features;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  const rings: [string, number[][][]][] = [];
  for (const f of fs) {
    const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    rings.push([String((f.properties as Record<string, unknown>).regiao), polys.map((p) => p[0])]);
  }
  const W = 150, H = (W * (y1 - y0)) / (x1 - x0);
  const pt = ([x, y]: number[]) => `${(((x - x0) / (x1 - x0)) * W).toFixed(1)},${(((y1 - y) / (y1 - y0)) * H).toFixed(1)}`;
  return `<figure class="mini"><svg viewBox="0 0 ${W} ${H.toFixed(0)}" role="img" aria-label="${esc(label)}">${rings.map(([k, ps]) =>
    ps.map((ring) => `<polygon points="${ring.filter((_, i) => i % 2 === 0).map(pt).join(" ")}" fill="${fills.get(k) ?? "none"}" stroke="var(--surface-1)" stroke-width="0.6"><title>${esc(k)}</title></polygon>`).join("")).join("")}</svg><figcaption>${esc(label)}</figcaption></figure>`;
}

function placesByCamp(app: App, ids?: Set<string>) {
  const st = new Map<string, PlaceStyle>();
  for (const p of app.db.locais) {
    if (ids && !ids.has(p.id)) continue;
    const v = app.db.votos["2024"].prefeito[p.id] ?? {};
    const s44 = (v["44"] ?? 0) / Object.entries(v).reduce((s, [n, x]) => (n === "95" || n === "96" ? s : s + x), 0);
    st.set(p.id, { color: div((s44 - 0.5) * 2.5), opacity: 0.95 });
  }
  return st;
}

export function renderRegioes(app: App) {
  const { db, state } = app;
  if (state.region === "__lasso" && app.lassoIds) return renderLasso(app);
  if (state.region && db.regioes[state.region]) return renderRegion(app, state.region);
  const m = METRICS.find((x) => x.key === state.rmetric) ?? METRICS[0];
  const rs = Object.entries(db.regioes);
  const { fills, legend } = colorize(rs, m);
  app.map.setPoly("regioes", fills, (k) => `<b>${esc(k)}</b><br>${esc(m.label)}: ${m.fmt(m.get(db.regioes[k]))}`, undefined, 0.6);
  app.map.setPlaces(new Map(), (id) => `<b>${esc(db.byId.get(id)!.nome)}</b><br>${esc(db.byId.get(id)!.regiao)}`);
  app.map.setOverlay([]);
  app.legend(legend);
  const smKeys = ["representacao", "vereador_nec", "divergencia_governo", "swing", "abstencao", "novos"];
  app.panel.innerHTML = `
    <div class="ph"><div class="eyebrow">Território</div><h2>Análise por região</h2></div>
    <p class="lead">${rs.length} regiões formadas por bairros (IBGE) e distritos/projetos rurais. As regiões vêm de <code>pipeline/regions.csv</code> e podem ser reagrupadas. Use <b>Desenhar área</b> para analisar qualquer recorte livre.</p>
    <div class="row"><label>Métrica <select id="rm">${METRICS.map((x) => `<option value="${x.key}" ${x.key === m.key ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select></label>
      <button class="btn" id="lasso">✎ Desenhar área</button></div>
    <p class="muted small">${m.help}</p>
    <div id="rtable"></div>
    <h3>Comparativo</h3><div class="minis">${smKeys.map((k) => { const mm = METRICS.find((x) => x.key === k)!; return `<a data-href="rmetric=${k}">${miniMap(app, colorize(rs, mm).fills, mm.label)}</a>`; }).join("")}</div>`;
  app.panel.querySelector<HTMLSelectElement>("#rm")!.addEventListener("change", (e) => app.go({ rmetric: (e.target as HTMLSelectElement).value }));
  app.panel.querySelector("#lasso")!.addEventListener("click", () => startLasso(app));
  bindHrefs(app.panel, (h) => app.go(Object.fromEntries(new URLSearchParams(h))));
  table(app.panel.querySelector("#rtable")!, rs, [
    { key: "nome", label: "Região", get: ([k]) => k, cls: "wrap" },
    { key: "el", label: "Eleitores", get: ([, r]) => r.eleitores, num: true },
    { key: "vb", label: "Vereadores c/ base", get: ([, r]) => r.vereadores_com_base, num: true, fmt: (x: number, [, r]) => `${x} <span class="muted">/ ${r.vereadores_esperados.toFixed(1).replace(".", ",")}</span>` },
    { key: "m", label: m.label, get: ([, r]) => m.get(r), num: true, fmt: (x: number) => m.fmt(x) },
  ], { sort: "m", onRow: ([k]) => app.go({ region: k }) });
}

function startLasso(app: App) {
  app.legend(`<div class="lg-title">Clique para marcar os vértices; duplo clique para fechar a área.</div><button class="btn small" id="lcancel">Cancelar</button>`);
  document.querySelector("#lcancel")?.addEventListener("click", () => { app.map.cancelLasso(); app.go({}); });
  app.map.startLasso((ids) => {
    app.lassoIds = ids;
    app.go({ tab: "regioes", region: "__lasso" });
  });
}

function renderLasso(app: App) {
  const ids = app.lassoIds!;
  const set = new Set(ids);
  app.map.setPoly("none");
  app.map.setPlaces(placesByCamp(app, set), (id) => esc(app.db.byId.get(id)!.nome));
  app.legend(legendRamp(DIV_STOPS(), "oposição", "Simão", "Prefeito 2024 nos locais selecionados"));
  app.panel.innerHTML = `<div class="drawer-head"><button class="back" data-href="region=">← regiões</button><button class="btn small" id="again">✎ Nova área</button></div>
    <h2>Área desenhada</h2>${ids.length ? areaReport(app, ids) : "<p>Nenhum local de votação dentro da área.</p>"}`;
  bindHrefs(app.panel, (h) => { if (h === "region=") app.map.clearLasso(); app.go(Object.fromEntries(new URLSearchParams(h))); });
  app.panel.querySelector("#again")!.addEventListener("click", () => { app.map.clearLasso(); startLasso(app); });
}

function renderRegion(app: App, name: string) {
  const { db } = app;
  const r = db.regioes[name];
  const ids = db.locais.filter((p) => p.regiao === name).map((p) => p.id);
  app.map.setPoly("regioes", new Map([[name, cat(0)]]), (k) => esc(k), name, 0.12);
  const st = new Map<string, PlaceStyle>();
  for (const id of ids) {
    const v = db.votos["2024"].vereador[id] ?? {};
    const top = Object.entries(v).filter(([n]) => n.length > 2).sort((a, b) => b[1] - a[1])[0];
    const c = top ? db.vByNum.get(top[0]) : undefined;
    st.set(id, { color: partyColor(c?.partido), label: c?.nome, stroke: c?.eleito ? undefined : OTHER() });
  }
  app.map.setPlaces(st, (id) => `<b>${esc(db.byId.get(id)!.nome)}</b>`);
  app.map.setOverlay([]);
  app.map.fitPlaces(ids, 13);
  app.legend(`<div class="lg-title">Locais da região — cor = partido do vereador mais votado; rótulo = nome</div>`);
  const city = Object.values(db.regioes).reduce((acc, x) => { for (const [k, v] of Object.entries(x.perfil)) acc[k] = (acc[k] ?? 0) + v; return acc; }, {} as Record<string, number>);
  const camps = Object.entries(r.vereador_por_campo);
  const rk = (key: string) => {
    const m = METRICS.find((x) => x.key === key)!;
    const sorted = Object.entries(db.regioes).sort((a, b) => m.get(b[1]) - m.get(a[1]));
    return `${sorted.findIndex(([k]) => k === name) + 1}º/${sorted.length}`;
  };
  app.panel.innerHTML = `
    <div class="drawer-head"><button class="back" data-href="region=">← regiões</button></div>
    <h2>${esc(name)}</h2>
    <p class="muted">${r.locais} locais de votação${r.bairros_ibge.length ? ` · bairros: ${esc(r.bairros_ibge.join(", "))}` : ""}</p>
    ${tiles([
      { label: "Eleitores", value: fmt(r.eleitores), sub: `${pct(r.pct_eleitorado)} da cidade` },
      { label: "Vereadores com base aqui", value: `${r.vereadores_com_base}`, sub: `proporcional seria ${r.vereadores_esperados.toFixed(1).replace(".", ",")} → ${r.representacao.toFixed(2).replace(".", ",")}×` },
      { label: "Voto em eleitos", value: pct(r.pct_voto_em_eleitos, 0), sub: `${r.vereador_nec.toFixed(0)} candidatos efetivos (${rk("vereador_nec")} mais pulverizada)` },
    ])}
    <h3>Vereadores</h3>
    ${r.vereadores_base_nomes.length ? `<p>Eleitos com a maior parte dos votos aqui: <b>${esc(r.vereadores_base_nomes.join(", "))}</b> (arrecadaram juntos ${brl(r.receita_vereadores_base)}).</p>` : `<p class="warn">Nenhum vereador eleito tem sua principal base nesta região.</p>`}
    <h4>Mais votados na região</h4>
    ${bars(r.vereadores_top.map((v) => ({ label: (v.eleito ? "★ " : "") + v.nome, sub: db.vByNum.get(v.numero)?.partido, value: v.pct, note: fmt(v.votos), color: partyColor(db.vByNum.get(v.numero)?.partido), href: `tab=vereadores&cand=${v.numero}` })), { max: Math.max(...r.vereadores_top.map((v) => v.pct)) })}
    <h4>Voto para vereador por campo (inclui legenda)</h4>
    ${bars(camps.map(([k, x]) => ({ label: k === "Outros" ? "Outros" : `Campo ${title(k)}`, value: x, color: campColor(k) })), { max: 1 })}
    <p class="muted small">Prefeito − vereadores do governo: <b>${pp(r.divergencia_governo, 0)}</b>. ${r.divergencia_governo > 0.05 ? "O prefeito puxa mais voto aqui do que os vereadores aliados: espaço para um nome governista novo." : r.divergencia_governo < -0.05 ? "Os vereadores do governo somam mais que o próprio prefeito: base de vereadores forte." : "Voto em prefeito e vereadores aliados alinhados."}</p>
    <h3>Prefeito</h3><div class="grid2"><div><h4>2024</h4>${bars(mayorRows(app, "2024", ids), { max: 1 })}</div><div><h4>2020</h4>${bars(mayorRows(app, "2020", ids), { max: 1 })}</div></div>
    <p class="muted small">Margem 2024: ${pp(r.margem_prefeito_2024, 0)} · Grupo Coelho 2020→2024: ${pp((r.prefeito_2024["44"] ?? 0) - (r.prefeito_2020["15"] ?? 0), 1)}</p>
    <h3>Comparecimento</h3>${turnoutTiles(app, ids)}
    <h3>Presidente</h3><div class="grid2"><div><h4>2022 · 2º turno</h4>${bars(officeRows(app, "2022-2", "presidente", ids, 2), { max: 1 })}</div><div><h4>2026 · 1º turno</h4>${bars(officeRows(app, "2026", "presidente", ids, 3), { max: 1 })}</div></div>
    <h3>Prefeito 2016</h3>${bars(mayorRows(app, "2016", ids), { max: 1 })}
    <h3>2026 (1º turno)</h3><div class="grid2"><div><h4>Governador</h4>${bars(officeRows(app, "2026", "governador", ids, 3), { max: 1 })}</div><div><h4>Senador</h4>${bars(officeRows(app, "2026", "senador", ids, 4), { max: 0.6 })}</div></div>
    <div class="grid2"><div><h4>Dep. estadual</h4>${bars(officeRows(app, "2026", "dep_estadual", ids, 5), { max: 0.4 })}</div><div><h4>Dep. federal</h4>${bars(officeRows(app, "2026", "dep_federal", ids, 5), { max: 0.4 })}</div></div>
    <h3>Censo 2022</h3>${tiles([
      { label: "População", value: fmt(r.censo.populacao), sub: `${fmt(r.censo.domicilios)} domicílios` },
      { label: "Novos eleitores 2028", value: `~${fmt(r.censo.novos_eleitores_2028_est)}`, sub: `${fmt(r.censo.pop_10_19)} pessoas com 10–19 anos` },
      { label: "Alfabetização 15+", value: pct(r.censo.taxa_alfab), sub: `${r.censo.eleitores_por_hab.toFixed(2).replace(".", ",")} eleitores/hab.` },
      { label: "Renda média", value: `R$ ${fmt(r.censo.renda_media)}`, sub: r.censo.infra != null ? `infraestrutura urbana ${pct(r.censo.infra, 0)}` : "área rural" },
    ])}
    <h3>Perfil do eleitorado</h3>${perfilBlock(r.perfil, city)}
    <h3>Locais de votação</h3><ul class="plain cols">${ids.map((id) => `<li><a data-href="place=${id}">${esc(db.byId.get(id)!.nome)}</a> <span class="muted">${fmt(db.byId.get(id)!.eleitores)}</span></li>`).join("")}</ul>`;
  bindHrefs(app.panel, (h) => app.go(Object.fromEntries(new URLSearchParams(h))));
}
