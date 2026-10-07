// Geography of the vote: territorial domain, conflict zones, statistical strongholds (LISA),
// electoral segments (k-means) and voter-registration gaps, drawn on catchment areas.
import type { App } from "../app";
import { candName, esc, fmt, pct } from "../data";
import { cat, div, DIV_STOPS, OTHER, seq, SEQ_STOPS, partyColor } from "../colors";
import type { PlaceStyle } from "../map";
import { avatar, bars, bindHrefs, chip, dbars, legendCats, legendRamp, partyLegend, table } from "./common";

const MODES: [string, string, string][] = [
  ["dominio", "Domínio", "Quem lidera cada área entre os 23 eleitos"],
  ["conflito", "Conflito", "Quantos eleitos têm 6%+ em cada área"],
  ["lisa", "Redutos", "Clusters estatísticos de força (Moran local)"],
  ["segmentos", "Perfis", "Áreas com comportamento eleitoral parecido"],
  ["registro", "Registro", "Eleitores por adulto (Censo 2022)"],
  ["polarizacao", "Polarização", "Lula × Bolsonaro por área (2022) e variação até 2026"],
  ["censo", "Renda e infraestrutura", "Renda do responsável e infraestrutura urbana (Censo 2022)"],
  ["equipamentos", "Equipamentos", "UBS e hospitais (CNES/SUS), escolas e praças (OpenStreetMap)"],
];

const LISA_CLASSES: [string, string, string][] = [
  ["HH", "Reduto — forte, cercado de força", "#104281"],
  ["HL", "Ilha — forte, vizinhança fraca", "#86b6ef"],
  ["LH", "Brecha — fraco, vizinhança forte", "#f4b3b2"],
  ["0", "Sem votos neste local", "#7c8696"],
];

export function renderGeografia(app: App) {
  const { db, state } = app;
  const modo = MODES.some(([k]) => k === state.gmodo) ? state.gmodo! : "dominio";
  app.map.setPoly("none");
  app.map.setOverlay([]);
  const head = `
    <div class="ph"><div class="eyebrow">Geografia do voto</div><h2>${esc(MODES.find(([k]) => k === modo)![1])}</h2>
    <p class="lead">${esc(MODES.find(([k]) => k === modo)![2])}. Cada polígono é a <b>área de influência</b> de um local de votação (Voronoi recortado no município, até 8 km).</p></div>
    <div class="seg">${MODES.map(([k, l]) => `<button class="${k === modo ? "on" : ""}" data-href="gmodo=${k}">${l}</button>`).join("")}</div>`;
  const body = modo === "dominio" ? dominio(app) : modo === "conflito" ? conflito(app) : modo === "lisa" ? lisa(app) : modo === "segmentos" ? segmentos(app) : modo === "polarizacao" ? polarizacao(app) : modo === "censo" ? censo(app) : modo === "equipamentos" ? equipamentos(app) : registro(app);
  app.panel.innerHTML = head + body;
  bindHrefs(app.panel, (h) => app.go(Object.fromEntries(new URLSearchParams(h))));
  app.panel.querySelector<HTMLSelectElement>("#lisa-cand")?.addEventListener("change", (e) => app.go({ num: (e.target as HTMLSelectElement).value }));
  if (modo === "lisa") {
    const el = app.panel.querySelector<HTMLElement>("#moran");
    if (el) {
      const rows = db.vereadores.filter((v) => v.eleito && v.lisa);
      table(el, rows, [
        { key: "nome", label: "Vereador", get: (v) => v.nome, fmt: (_, v) => `<div class="namecell">${avatar(v.nome, partyColor(v.partido), "sm")}<span>${esc(v.nome)}</span></div>` },
        { key: "moran", label: "Moran's I", get: (v) => v.lisa!.moran, num: true, fmt: (x: number) => x.toFixed(2).replace(".", ",") },
        { key: "red", label: "Locais-reduto", get: (v) => v.lisa!.redutos.length, num: true },
      ], { sort: "moran", onRow: (v) => app.go({ num: `vereador:${v.numero}` }) });
    }
  }
}

function tipBase(app: App, id: string) {
  const p = app.db.byId.get(id)!;
  return `<b>${esc(p.nome)}</b><br><span style="opacity:.75">${esc(p.regiao)} · ${fmt(p.eleitores)} eleitores</span>`;
}

// ------------------------------------------------------------------ domínio
function dominio(app: App) {
  const { db } = app;
  const D = db.geografia.dominios;
  const st = new Map<string, PlaceStyle>();
  for (const [id, d] of Object.entries(D.locais)) {
    const v = db.vByNum.get(d.lider)!;
    st.set(id, d.terra_de_ninguem
      ? { color: OTHER(), opacity: 0.35 }
      : { color: partyColor(v.partido), opacity: 0.3 + Math.min(0.65, d.lider_pct * 2.6), label: v.nome });
  }
  app.map.setPlaces(st, (id) => {
    const d = D.locais[id];
    if (!d) return `${tipBase(app, id)}<br><i>Sem votos suficientes para análise</i>`;
    return `${tipBase(app, id)}<br>${d.terra_de_ninguem ? "<i>Terra de ninguém</i><br>" : ""}${d.fortes.slice(0, 4).map((f) => `${esc(db.vByNum.get(f.numero)?.nome)} ${pct(f.pct)}`).join("<br>") || `Líder: ${esc(db.vByNum.get(d.lider)?.nome)} ${pct(d.lider_pct)}`}`;
  });
  app.legend(partyLegend(Object.values(D.locais).filter((d) => !d.terra_de_ninguem).map((d) => db.vByNum.get(d.lider)?.partido), "Partido do eleito que lidera a área — intensidade = % do líder", [{ label: "Terra de ninguém (líder < 8%)", color: OTHER() }], partyColor));
  const owners = Object.entries(D.dominio).sort((a, b) => b[1] - a[1]);
  const elOf = (n: string) => Object.entries(D.locais).filter(([, d]) => d.lider === n && !d.terra_de_ninguem).reduce((s, [id]) => s + db.byId.get(id)!.eleitores, 0);
  const tn = Object.entries(D.locais).filter(([, d]) => d.terra_de_ninguem).map(([id]) => db.byId.get(id)!).sort((a, b) => b.eleitores - a.eleitores);
  const none = db.vereadores.filter((v) => v.eleito && !D.dominio[v.numero]);
  return `
    <h3>Donos de território</h3>
    ${bars(owners.map(([n, k]) => { const v = db.vByNum.get(n)!; return { label: v.nome, sub: v.partido, value: k, note: `${fmt(elOf(n))} eleitores`, color: partyColor(v.partido), href: `tab=vereadores&cand=${n}` }; }), { format: (x) => `${x} locais` })}
    <p class="muted small">Sem nenhum local liderado: ${none.map((v) => `<a data-href="tab=vereadores&cand=${v.numero}">${esc(v.nome)}</a>`).join(", ") || "–"}. Votação pulverizada — depende de rede pessoal, não de bairro.</p>
    <h3>Terra de ninguém · ${tn.length} locais · ${fmt(tn.reduce((s, p) => s + p.eleitores, 0))} eleitores</h3>
    <p class="small">Nenhum eleito passa de 8% dos votos de vereador. Território aberto para 2028.</p>
    ${bars(tn.slice(0, 12).map((p) => ({ label: p.nome, sub: p.regiao, value: p.eleitores, href: `place=${p.id}`, color: OTHER() })), { format: (x) => fmt(x) })}`;
}

// ------------------------------------------------------------------ conflito
function conflito(app: App) {
  const { db, state } = app;
  const D = db.geografia.dominios;
  const [a, b] = (state.pair ?? "").split(",");
  const st = new Map<string, PlaceStyle>();
  if (a && b) {
    for (const [id, d] of Object.entries(D.locais)) {
      const fa = d.fortes.find((f) => f.numero === a), fb = d.fortes.find((f) => f.numero === b);
      if (fa && fb) st.set(id, { color: div((fa.pct - fb.pct) / Math.max(fa.pct, fb.pct)), opacity: 0.9 });
      else if (fa || fb) st.set(id, { color: OTHER(), opacity: 0.25 });
    }
    app.legend(legendRamp(DIV_STOPS(), db.vByNum.get(b)!.nome, db.vByNum.get(a)!.nome, "Áreas em que ambos têm 6%+ — cor = quem é mais forte"));
  } else {
    for (const [id, d] of Object.entries(D.locais)) st.set(id, { color: seq(Math.min(1, d.n_fortes / 5)), opacity: d.n_fortes ? 0.85 : 0.25, label: d.n_fortes >= 4 ? String(d.n_fortes) : undefined });
    app.legend(legendRamp(SEQ_STOPS, "0", "5+", "Nº de eleitos com 6%+ dos votos de vereador na área"));
  }
  app.map.setPlaces(st, (id) => `${tipBase(app, id)}<br>${(D.locais[id]?.fortes ?? []).map((f) => `${esc(db.vByNum.get(f.numero)?.nome)} ${pct(f.pct)}`).join("<br>")}`);
  return `
    ${a && b ? `<div class="callout">Conflito: <b>${esc(db.vByNum.get(a)?.nome)}</b> × <b>${esc(db.vByNum.get(b)?.nome)}</b> · <a data-href="pair=">limpar</a> · <a data-href="tab=sobreposicao&pair=${a},${b}">ver sobreposição total</a></div>` : ""}
    <h3>Pares que dividem mais áreas</h3>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Par</th><th class="num">Áreas</th><th class="num">Eleitores</th></tr></thead><tbody>
    ${D.conflitos.slice(0, 15).map((c) => `<tr class="clickable ${state.pair === `${c.a},${c.b}` ? "sel" : ""}" data-href="pair=${c.a},${c.b}"><td>${esc(c.a_nome)} × ${esc(c.b_nome)}</td><td class="num">${c.locais.length}</td><td class="num">${fmt(c.locais.reduce((s, id) => s + db.byId.get(id)!.eleitores, 0))}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="muted small">Área de conflito = local onde dois eleitos têm, cada um, ao menos 6% dos votos de vereador. É onde o voto de um tende a sair do outro em 2028.</p>`;
}

// ------------------------------------------------------------------ LISA
function lisa(app: App) {
  const { db, state } = app;
  const L = db.geografia.lisa;
  const key = state.num && L[state.num] ? state.num : `vereador:${db.vereadores[0].numero}`;
  const pack = L[key];
  const label = (k: string) => {
    const [kind, n] = k.split(":");
    if (kind === "vereador") return `${db.vByNum.get(n)?.nome} (vereador)`;
    const y = kind.slice(-4), c = kind.slice(0, -4);
    return `${candName(db, y, c, n)} (${c} ${y})`;
  };
  const st = new Map<string, PlaceStyle>();
  const colors = Object.fromEntries(LISA_CLASSES.map(([k, , c]) => [k, c]));
  for (const [id, c] of Object.entries(pack.classe)) if (c !== "ns" && colors[c]) st.set(id, { color: colors[c], opacity: c === "0" ? 0.45 : 0.85 });
  app.map.setPlaces(st, (id) => `${tipBase(app, id)}<br>${esc(LISA_CLASSES.find(([k]) => k === pack.classe[id])?.[1] ?? "Sem padrão significativo")}`);
  app.legend(legendCats([...LISA_CLASSES.map(([, l, c]) => ({ label: l, color: c })), { label: "Sem padrão significativo (p ≥ 0,05)", color: OTHER() }], `Moran local — ${label(key)}`));
  const groups: Record<string, string[]> = {};
  for (const k of Object.keys(L)) (groups[k.split(":")[0]] ??= []).push(k);
  const names: Record<string, string> = { vereador: "Vereadores 2024", prefeito2024: "Prefeito 2024", governador2026: "Governador 2026", senador2026: "Senador 2026" };
  const redutos = pack.redutos.map((id) => db.byId.get(id)!).sort((a, b) => b.eleitores - a.eleitores);
  return `
    <label class="wide">Candidato <select id="lisa-cand">${Object.entries(groups).map(([g, ks]) => `<optgroup label="${esc(names[g] ?? g)}">${ks.map((k) => `<option value="${k}" ${k === key ? "selected" : ""}>${esc(label(k))}</option>`).join("")}</optgroup>`).join("")}</select></label>
    <div class="tiles"><div class="tile"><div class="tile-label">Moran's I global</div><div class="tile-value">${pack.moran.toFixed(2).replace(".", ",")}</div><div class="tile-sub">0 = aleatório · 1 = manchas contíguas</div></div>
      <div class="tile"><div class="tile-label">Locais-reduto</div><div class="tile-value">${pack.redutos.length}</div><div class="tile-sub">${fmt(redutos.reduce((s, p) => s + p.eleitores, 0))} eleitores</div></div></div>
    <p class="small">Um <b>reduto</b> é um local onde o candidato é forte <i>e</i> os 6 vizinhos mais próximos também — força territorial real, não um ponto isolado (teste de permutação, 999 sorteios, p &lt; 0,05). <b>Brechas</b> são locais fracos (às vezes com zero votos) no meio da área forte: o alvo mais barato para crescer. Locais com zero votos fora disso aparecem sempre como <b>Sem votos</b>.</p>
    ${redutos.length ? `<h3>Redutos</h3><ul class="plain cols">${redutos.map((p) => `<li><a data-href="place=${p.id}">${esc(p.nome)}</a> <span class="muted">${fmt(p.eleitores)}</span></li>`).join("")}</ul>` : ""}
    ${(() => { const br = Object.entries(pack.classe).filter(([, c]) => c === "LH").map(([id]) => db.byId.get(id)!); return br.length ? `<h3>Brechas para crescer</h3><ul class="plain cols">${br.map((p) => `<li><a data-href="place=${p.id}">${esc(p.nome)}</a> <span class="muted">${fmt(p.eleitores)}</span></li>`).join("")}</ul>` : ""; })()}
    <h3>Quão territorial é cada eleito</h3><div id="moran"></div>`;
}

// ------------------------------------------------------------------ segments
function segmentos(app: App) {
  const { db, state } = app;
  const S = db.geografia.segmentos;
  const sel = state.seg != null && state.seg !== "" ? +state.seg : -1;
  const st = new Map<string, PlaceStyle>();
  for (const [id, s] of Object.entries(S.por_local)) st.set(id, { color: cat(s), opacity: sel < 0 || sel === s ? 0.82 : 0.12, label: sel < 0 || sel === s ? String(s + 1) : undefined });
  app.map.setPlaces(st, (id) => `${tipBase(app, id)}<br>Perfil ${S.por_local[id] + 1}: ${esc(S.segmentos[S.por_local[id]].rotulo)}`);
  app.legend(legendCats(S.segmentos.map((s) => ({ label: `${s.id + 1}. ${s.rotulo}`, color: cat(s.id) })), "Perfis de território (k-means)"));
  const feat = S.features;
  return `
    <p class="small">Agrupamento k-means (k=${S.k}) dos locais pela combinação de voto (prefeito 2024, governador 2026), comparecimento, fragmentação e perfil do eleitorado, ponderado pelo número de eleitores. Clique num perfil para isolá-lo no mapa.</p>
    ${S.segmentos.map((s) => `
      <div class="seg-card ${sel === s.id ? "on" : ""}" data-href="seg=${sel === s.id ? "" : s.id}">
        <h4><span class="sw" style="background:${cat(s.id)}"></span>${s.id + 1}. ${esc(s.rotulo)}</h4>
        <div class="muted small">${s.locais.length} locais · ${fmt(s.eleitores)} eleitores · Simão ${pct(s.media.simao, 0)} · comparecimento ${pct(s.media.comparecimento, 0)}</div>
        ${sel === s.id ? `<h4>Diferença para a média da cidade (desvios-padrão)</h4>${dbars(Object.entries(s.z).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).map(([k, z]) => ({ label: feat[k], value: z, fmt: (z > 0 ? "+" : "") + z.toFixed(1).replace(".", ",") })), 2)}
          <h4>Vereadores mais votados neste perfil</h4>${s.vereadores.map((v) => `${chip((v.eleito ? "★ " : "") + v.nome, partyColor(db.vByNum.get(v.numero)?.partido))}`).join(" ")}` : ""}
      </div>`).join("")}`;
}

// ------------------------------------------------------------------ registration
function registro(app: App) {
  const { db } = app;
  const props = new Map(db.geo.areas.features.map((f) => [String((f.properties as Record<string, unknown>).id), f.properties as Record<string, number>]));
  const st = new Map<string, PlaceStyle>();
  for (const [id, p] of props) if (p.eleitor_adulto != null) st.set(id, { color: div(Math.max(-1, Math.min(1, (p.eleitor_adulto - 0.85) / 0.5))), opacity: 0.8 });
  app.map.setPlaces(st, (id) => { const p = props.get(id)!; return `${tipBase(app, id)}<br>${(p.eleitor_adulto ?? 0).toFixed(2).replace(".", ",")} eleitor/adulto (vizinhança)<br>Pop. 15+ na área: ${fmt(p.pop15)}`; });
  app.legend(legendRamp(DIV_STOPS(), "0,35", "1,35", "Eleitores ÷ adultos (15+), vizinhança de 7 locais — vermelho = muitos moradores sem título local"));
  const rs = Object.entries(db.regioes).map(([k, r]) => ({ k, v: r.censo.eleitores_por_hab, pop: r.censo.populacao })).sort((a, b) => a.v - b.v);
  return `
    <p class="small">Compara os eleitores que votam na área com a população adulta do Censo 2022. Como o eleitor nem sempre vota no local mais próximo, a razão é suavizada pelos 7 locais vizinhos — leia como tendência regional, não por escola.</p>
    <h3>Por região (eleitores ÷ habitantes)</h3>
    ${bars(rs.map((r) => ({ label: r.k, value: r.v, note: `${fmt(r.pop)} hab.`, color: r.v < 0.6 ? "#e34948" : "var(--series-1)", href: `tab=regioes&region=${encodeURIComponent(r.k)}` })), { format: (x) => x.toFixed(2).replace(".", ","), max: 1.2 })}
    <p class="muted small">Valores baixos: bairros novos/em crescimento, moradores que mantêm título de outro bairro/cidade, ou não cadastrados. São alvo de transferência de título e de presença de rua; valores altos indicam o contrário (eleitores de fora votando ali).</p>`;
}

// ------------------------------------------------------------------ polarization
function polarizacao(app: App) {
  const { db, state } = app;
  const I = db.extras.ideologia;
  const var26 = state.seg === "var";
  const st = new Map<string, PlaceStyle>();
  for (const p of db.locais) {
    const l22 = I.lula_2022_2t[p.id], l26 = I.lula_2026_1t[p.id];
    if (l22 == null) continue;
    // PT red for Lula-leaning, PL green for Bolsonaro-leaning; neutral at 50%
    const t = var26 ? (l26 - l22) / 0.15 : (l22 - 0.5) / 0.35;
    st.set(p.id, { color: var26 ? div(Math.max(-1, Math.min(1, t))) : t >= 0 ? mix(partyColor("PT"), Math.min(1, t)) : mix(partyColor("PL"), Math.min(1, -t)), opacity: 0.85 });
  }
  app.map.setPlaces(st, (id) => `${tipBase(app, id)}<br>Lula 2022 (2º t.): ${pct(I.lula_2022_2t[id])}<br>Lula 2026 (1º t.): ${pct(I.lula_2026_1t[id])}`);
  app.legend(var26 ? legendRamp(DIV_STOPS(), "−15 p.p.", "+15 p.p.", "Lula: 2º turno 2022 → 1º turno 2026 (p.p.)")
    : legendCats([{ label: "Lula > 85%", color: mix(partyColor("PT"), 1) }, { label: "Lula ~ 67%", color: mix(partyColor("PT"), 0.5) }, { label: "Empate (50%)", color: mix(partyColor("PT"), 0) }, { label: "Bolsonaro > 60%", color: mix(partyColor("PL"), 0.3) }], "2º turno presidencial 2022"));
  const el = db.vereadores.filter((v) => v.eleito && v.alinhamento_lula != null).sort((a, b) => b.alinhamento_lula! - a.alinhamento_lula!);
  return `
    <div class="seg small"><button class="${var26 ? "" : "on"}" data-href="seg=">2022 (2º turno)</button><button class="${var26 ? "on" : ""}" data-href="seg=var">Variação 2022 → 2026</button></div>
    <p class="small">Lula venceu em quase toda a cidade, mas com intensidade muito diferente entre o Centro e a zona rural. Correlação por local entre o voto de Simão (2024) e o de Lula: <b>${I.simao_x_lula != null ? (I.simao_x_lula > 0 ? "+" : "") + I.simao_x_lula.toFixed(2).replace(".", ",") : "–"}</b>.</p>
    <h3>Vereadores eleitos: território mais lulista ↔ menos lulista</h3>
    ${dbars(el.map((v) => ({ label: v.nome, value: v.alinhamento_lula!, fmt: (v.alinhamento_lula! > 0 ? "+" : "") + v.alinhamento_lula!.toFixed(2).replace(".", ",") })), 0.5)}
    <p class="muted small">Correlação (ponderada por eleitores) entre a participação do vereador em cada local e a votação de Lula. Mede o perfil do território onde o vereador é votado, não a posição política dele nem a de cada eleitor.</p>`;
}

/** Blend a colour toward the neutral surface: k=0 neutral, k=1 full colour. */
function mix(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const base = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches) ? [56, 56, 53] : [226, 225, 220];
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(base[i] + (v - base[i]) * Math.max(0, Math.min(1, k))));
  return `rgb(${c.join(",")})`;
}

// ------------------------------------------------------------------ income & urban infrastructure
function censo(app: App) {
  const { db, state } = app;
  const v = state.seg === "infra" ? "infra" : "renda";
  const props = new Map(db.geo.areas.features.map((f) => [String((f.properties as Record<string, unknown>).id), f.properties as Record<string, number>]));
  const vals = [...props.values()].map((p) => p[v === "renda" ? "renda_media" : "infra"]).filter((x) => x != null && isFinite(x));
  const lo = Math.min(...vals), hi = v === "renda" ? Math.min(Math.max(...vals), 6000) : 1;
  const st = new Map<string, PlaceStyle>();
  for (const [id, p] of props) {
    const x = p[v === "renda" ? "renda_media" : "infra"];
    if (x == null) continue;
    st.set(id, { color: seq(Math.max(0, Math.min(1, (x - lo) / (hi - lo)))), opacity: 0.82 });
  }
  const brl = (x: number) => `R$ ${fmt(x)}`;
  app.map.setPlaces(st, (id) => { const p = props.get(id)!; return `${tipBase(app, id)}<br>Renda média do responsável: ${p.renda_media != null ? brl(p.renda_media) : "–"}<br>Infraestrutura urbana: ${p.infra != null ? pct(p.infra, 0) : "– (setor rural)"}`; });
  app.legend(legendRamp(SEQ_STOPS, v === "renda" ? brl(lo) : "0%", v === "renda" ? brl(hi) + "+" : "100%", v === "renda" ? "Renda média mensal do responsável (Censo 2022)" : "Infraestrutura urbana: pavimentação, iluminação, bueiro e calçada"));
  const rs = Object.entries(db.regioes).sort((a, b) => b[1].censo.renda_media - a[1].censo.renda_media);
  return `<div class="seg small"><button class="${v === "renda" ? "on" : ""}" data-href="seg=">Renda</button><button class="${v === "infra" ? "on" : ""}" data-href="seg=infra">Infraestrutura</button></div>
    <p class="small">Censo 2022 (IBGE): rendimento nominal médio mensal do responsável pelo domicílio e características do entorno (só setores urbanos). Médias por área de influência, ponderadas por domicílio.</p>
    <h3>Por região</h3>
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Região</th><th class="num">Renda média</th><th class="num">Infraestrutura</th><th class="num">Simão 2024</th><th class="num">Lula 2022</th></tr></thead><tbody>
    ${rs.map(([k, r]) => `<tr class="clickable" data-href="tab=regioes&region=${encodeURIComponent(k)}"><td>${esc(k)}</td><td class="num">${brl(r.censo.renda_media)}</td><td class="num">${r.censo.infra != null ? pct(r.censo.infra, 0) : "–"}</td><td class="num">${pct(r.prefeito_2024["44"] ?? 0, 0)}</td><td class="num">${r.lula_2022_2t != null ? pct(r.lula_2022_2t, 0) : "–"}</td></tr>`).join("")}
    </tbody></table></div>`;
}

// ------------------------------------------------------------------ public facilities
const EQ_COLOR: Record<string, string> = { ubs: "#c0392b", hospital: "#7b2c8f", saude_outros: "#e08a3a", escola: "#2a78d6", lazer: "#1baf7a" };
function equipamentos(app: App) {
  const { db, state } = app;
  const E = db.equip;
  const cat = state.seg && E.categorias[state.seg] ? state.seg : "ubs";
  app.map.setPois(E.pontos.filter((p) => p.c === cat || (cat === "ubs" && p.c === "hospital")).map((p) => ({ lat: p.lat, lon: p.lon, color: EQ_COLOR[p.c], name: `<b>${esc(p.n || E.categorias[p.c])}</b><br>${esc(E.categorias[p.c])}` })));
  const st = new Map<string, PlaceStyle>();
  const distKey = cat === "escola" ? "dist_escola_km" : "dist_ubs_km";
  for (const p of db.locais) {
    const d = E.por_local[p.id]?.[distKey];
    if (d != null && (cat === "ubs" || cat === "escola")) st.set(p.id, { color: div(Math.max(-1, Math.min(1, (1.5 - d) / 3))), opacity: 0.55 });
  }
  app.map.setPlaces(st, (id) => { const q = E.por_local[id] ?? {}; return `${tipBase(app, id)}<br>UBS mais próxima: ${q.dist_ubs_km != null ? q.dist_ubs_km.toFixed(1).replace(".", ",") + " km" : "–"}<br>Escola mais próxima: ${q.dist_escola_km != null ? q.dist_escola_km.toFixed(1).replace(".", ",") + " km" : "–"}`; });
  app.legend(legendCats([{ label: E.categorias[cat], color: EQ_COLOR[cat] }, ...(cat === "ubs" ? [{ label: E.categorias.hospital, color: EQ_COLOR.hospital }] : []),
    ...(cat === "ubs" || cat === "escola" ? [{ label: "Área perto (<1,5 km)", color: div(0.6) }, { label: "Área longe (>3 km)", color: div(-0.6) }] : [])], "Equipamentos públicos"));
  const regs = Object.entries(E.por_regiao).sort((a, b) => db.regioes[b[0]].eleitores - db.regioes[a[0]].eleitores);
  return `<div class="seg small">${Object.entries(E.categorias).filter(([k]) => k !== "hospital").map(([k, l]) => `<button class="${k === cat ? "on" : ""}" data-href="seg=${k}">${esc(l.split(" (")[0])}</button>`).join("")}</div>
    <p class="small">Saúde: cadastro oficial do SUS (CNES/DataSUS), unidades com atendimento SUS e coordenadas. Escolas e praças: OpenStreetMap (cobertura incompleta). Assistência social e templos não têm fonte confiável com coordenadas e não foram incluídos.</p>
    <h3>Por região (por 10 mil eleitores)</h3>
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Região</th><th class="num">UBS</th><th class="num">Hospitais</th><th class="num">Escolas</th><th class="num">Praças</th></tr></thead><tbody>
    ${regs.map(([k, r]) => { const x = r.por_10mil_eleitores as Record<string, number>; return `<tr><td>${esc(k)}</td><td class="num">${x.ubs.toFixed(1).replace(".", ",")}</td><td class="num">${x.hospital.toFixed(1).replace(".", ",")}</td><td class="num">${x.escola.toFixed(1).replace(".", ",")}</td><td class="num">${x.lazer.toFixed(1).replace(".", ",")}</td></tr>`; }).join("")}
    </tbody></table></div>`;
}
