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
  const body = modo === "dominio" ? dominio(app) : modo === "conflito" ? conflito(app) : modo === "lisa" ? lisa(app) : modo === "segmentos" ? segmentos(app) : registro(app);
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
