// Territorial overlap between councillors: heatmap matrix + head-to-head map.
import type { App } from "../app";
import { esc, fmt, pct, valid } from "../data";
import { div, DIV_STOPS, seq, partyColor } from "../colors";
import type { PlaceStyle } from "../map";
import { avatar, bindHrefs, chip, dbars, legendCats, legendRamp } from "./common";

function renderTerritorio(app: App, head: string) {
  const { db, state } = app;
  const o = db.sobreposicao;
  // order elected by their base region so territorial clusters sit together
  const idx = o.ids.map((_, i) => i).filter((i) => o.eleitos[i]);
  const reg = (i: number) => db.vByNum.get(o.ids[i])?.territorio?.regiao_base ?? "";
  idx.sort((a, b) => reg(a).localeCompare(reg(b)) || (db.vByNum.get(o.ids[b])!.votos - db.vByNum.get(o.ids[a])!.votos));
  const [a, b] = (state.pair ?? "").split(",");
  duelMap(app);
  const cell = (i: number, j: number) => {
    const v = o.matriz[i][j];
    const sel = (o.ids[i] === a && o.ids[j] === b) || (o.ids[i] === b && o.ids[j] === a);
    return i === j ? `<td class="hm diag"></td>` : `<td class="hm${sel ? " sel" : ""}" style="background:${seq(Math.max(0, Math.min(1, (v - 0.3) / 0.55)))}" title="${esc(o.nomes[i])} × ${esc(o.nomes[j])}: ${pct(v, 0)}" data-href="pair=${o.ids[i]},${o.ids[j]}"></td>`;
  };
  const pairs = o.pares.filter((p) => p.ambos_eleitos).slice(0, 10);
  const view = state.sview === "matriz" ? "matriz" : "rede";
  app.panel.innerHTML = `${head}
    <p class="lead">Sobreposição territorial = fração da distribuição dos votos de dois candidatos que coincide nos mesmos locais (0–100%). Mede <b>onde</b> disputam — não <b>quem</b> é o eleitor (veja "Perfil do eleitor").</p>
    ${a && b ? duelBox(app, a, b) : ""}
    <div class="seg"><button class="${view === "rede" ? "on" : ""}" data-href="sview=rede">Rede</button><button class="${view === "matriz" ? "on" : ""}" data-href="sview=matriz">Matriz</button></div>
    ${view === "rede" ? `${network(app)}<p class="muted small">Nós = candidatos (tamanho = votos; cor = partido; contorno tracejado = suplente). Proximidade = territórios parecidos (MDS sobre 1 − sobreposição). Linhas = sobreposição ≥ 60%. Clique numa linha para ver o duelo no mapa; num nó para abrir o perfil.</p>` : `
    <div class="hm-wrap"><table class="hm-table"><thead><tr><th></th>${idx.map((i) => `<th class="rot"><span>${esc(o.nomes[i])}</span></th>`).join("")}</tr></thead>
    <tbody>${idx.map((i) => `<tr><th class="rowh" data-href="tab=vereadores&cand=${o.ids[i]}"><span class="sw" style="background:${partyColor(db.vByNum.get(o.ids[i])?.partido)}"></span>${esc(o.nomes[i])}</th>${idx.map((j) => cell(i, j)).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="lg-inline">${legendRamp([seq(0), seq(0.5), seq(1)], "≤30%", "85%+", "")}</div>`}
    <h3>Pares com maior sobreposição (ambos eleitos)</h3>
    <ol>${pairs.map((p) => `<li><a data-href="pair=${p.a},${p.b}">${esc(p.a_nome)} × ${esc(p.b_nome)}</a> — ${pct(p.sobreposicao, 0)}</li>`).join("")}</ol>
    <h3>Eleitos × suplentes fortes</h3>
    <ol>${o.pares.filter((p) => !p.ambos_eleitos).slice(0, 8).map((p) => `<li><a data-href="pair=${p.a},${p.b}">${esc(p.a_nome)} × ${esc(p.b_nome)}</a> — ${pct(p.sobreposicao, 0)}</li>`).join("")}</ol>
    <p class="muted small">Um suplente forte com alta sobreposição é ameaça direta ao mandato em 2028 — especialmente se estiver no mesmo partido.</p>`;
  bindHrefs(app.panel, (h) => app.go(Object.fromEntries(new URLSearchParams(h))));
}


/** Map for a selected pair (any mode): who is stronger in each place. */
function duelMap(app: App) {
  const { db, state } = app;
  const [a, b] = (state.pair ?? "").split(",");
  if (a && b && (!db.vByNum.has(a) || !db.vByNum.has(b))) return;
  app.map.setPoly("regioes", new Map(), () => "");
  app.map.setOverlay([]);
  if (a && b) {
    const ca = db.vByNum.get(a)!, cb = db.vByNum.get(b)!;
    const st = new Map<string, PlaceStyle>();
    let m = 0;
    const diff = new Map<string, number>();
    for (const p of db.locais) {
      const v = db.votos["2024"].vereador[p.id] ?? {};
      const t = valid(v) || 1;
      const d = ((v[a] ?? 0) - (v[b] ?? 0)) / t;
      if ((v[a] ?? 0) + (v[b] ?? 0) === 0) continue;
      diff.set(p.id, d);
      m = Math.max(m, Math.abs(d));
    }
    diff.forEach((d, id) => {
      const v = db.votos["2024"].vereador[id] ?? {};
      const tot = (v[a] ?? 0) + (v[b] ?? 0);
      st.set(id, { color: div(d / (m || 1)), radius: 3 + 12 * Math.sqrt(tot / Math.max(ca.votos, cb.votos) * 8) });
    });
    app.map.setPlaces(st, (id) => {
      const v = db.votos["2024"].vereador[id] ?? {};
      const t = valid(v) || 1;
      return `<b>${esc(db.byId.get(id)!.nome)}</b><br>${esc(ca.nome)}: ${fmt(v[a] ?? 0)} (${pct((v[a] ?? 0) / t)})<br>${esc(cb.nome)}: ${fmt(v[b] ?? 0)} (${pct((v[b] ?? 0) / t)})`;
    });
    app.legend(legendRamp(DIV_STOPS(), cb.nome, ca.nome, "Quem é mais forte em cada local (tamanho = votos somados)"));
  } else {
    app.map.setPlaces(new Map(), (id) => esc(db.byId.get(id)!.nome));
    app.legend("");
  }
}

/** Overlap network: classical MDS on distance = 1 − overlap (similar candidates sit close), then collision relaxation. */
function network(app: App) {
  const { db, state } = app;
  const o = db.sobreposicao;
  const n = o.ids.length;
  const W = 560, H = 560, PAD = 50;
  const edges: { i: number; j: number; w: number }[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (o.matriz[i][j] >= 0.6) edges.push({ i, j, w: o.matriz[i][j] });
  // double-centred squared distances
  const D2 = o.matriz.map((row) => row.map((v) => (1 - v) ** 2));
  const rm = D2.map((r) => r.reduce((a, b) => a + b, 0) / n);
  const gm = rm.reduce((a, b) => a + b, 0) / n;
  const B = D2.map((r, i) => r.map((v, j) => -0.5 * (v - rm[i] - rm[j] + gm)));
  const eig = (M: number[][], deflate?: { v: number[]; l: number }) => {
    let v = M.map((_, i) => Math.sin(i + 1) + (deflate ? Math.cos(3 * i) : 0.5));
    let l = 0;
    for (let it = 0; it < 300; it++) {
      let w = M.map((r) => r.reduce((s, x, j) => s + x * v[j], 0));
      if (deflate) { const d = deflate.v.reduce((s, x, j) => s + x * v[j], 0); w = w.map((x, i) => x - deflate.l * d * deflate.v[i]); }
      l = Math.hypot(...w);
      v = w.map((x) => x / (l || 1));
    }
    return { v, l };
  };
  const e1 = eig(B), e2 = eig(B, e1);
  let pos = o.ids.map((_, i) => ({ x: e1.v[i] * Math.sqrt(e1.l), y: e2.v[i] * Math.sqrt(e2.l) }));
  const xs = pos.map((p) => p.x), ys = pos.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  pos = pos.map((p) => ({ x: PAD + ((p.x - x0) / (x1 - x0 || 1)) * (W - 2 * PAD), y: PAD + ((p.y - y0) / (y1 - y0 || 1)) * (H - 2 * PAD) }));
  for (let it = 0; it < 250; it++) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const dx = pos[j].x - pos[i].x, dy = pos[j].y - pos[i].y, d = Math.hypot(dx, dy) || 0.01, min = 44;
    if (d < min) {
      const push = (min - d) / 2, ux = dx / d, uy = dy / d;
      pos[i].x -= ux * push; pos[i].y -= uy * push; pos[j].x += ux * push; pos[j].y += uy * push;
    }
  }
  pos.forEach((p) => { p.x = Math.max(PAD, Math.min(W - PAD, p.x)); p.y = Math.max(20, Math.min(H - 24, p.y)); });
  const maxV = Math.max(...o.ids.map((id) => db.vByNum.get(id)!.votos));
  const [pa, pb] = (state.pair ?? "").split(",");
  const edgeSvg = edges.sort((a, b) => a.w - b.w).map((e) => {
    const sel = (o.ids[e.i] === pa && o.ids[e.j] === pb) || (o.ids[e.i] === pb && o.ids[e.j] === pa);
    return `<line x1="${pos[e.i].x.toFixed(1)}" y1="${pos[e.i].y.toFixed(1)}" x2="${pos[e.j].x.toFixed(1)}" y2="${pos[e.j].y.toFixed(1)}"
      stroke="${sel ? "var(--text-primary)" : seq(Math.min(1, (e.w - 0.55) / 0.3))}" stroke-width="${(sel ? 2 : 0) + 0.8 + (e.w - 0.6) * 12}" stroke-opacity="${sel ? 1 : 0.6}" stroke-linecap="round"
      style="cursor:pointer" data-href="pair=${o.ids[e.i]},${o.ids[e.j]}"><title>${esc(o.nomes[e.i])} × ${esc(o.nomes[e.j])}: ${pct(e.w, 0)}</title></line>`;
  }).join("");
  const nodeSvg = o.ids.map((id, i) => {
    const v = db.vByNum.get(id)!;
    const r = 5 + 11 * Math.sqrt(v.votos / maxV);
    return `<g><circle cx="${pos[i].x.toFixed(1)}" cy="${pos[i].y.toFixed(1)}" r="${r.toFixed(1)}" fill="${partyColor(v.partido)}" ${o.eleitos[i] ? "" : `stroke-dasharray="2 2" fill-opacity="0.45" stroke="${partyColor(v.partido)}"`} data-href="tab=vereadores&cand=${id}"><title>${esc(v.nome)} (${esc(v.partido)}) — ${fmt(v.votos)} votos</title></circle>
      <text x="${pos[i].x.toFixed(1)}" y="${(pos[i].y + r + 10).toFixed(1)}" text-anchor="middle">${esc(v.nome.length > 18 ? v.nome.slice(0, 17) + "…" : v.nome)}</text></g>`;
  }).join("");
  return `<svg class="net" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rede de sobreposição territorial">${edgeSvg}${nodeSvg}</svg>`;
}

// ======================================================================= profile-based competition
export const QUAD: Record<string, [string, string, string]> = {
  disputa_direta: ["Disputa direta", "mesmo território e mesmo perfil de eleitor", "#c0392b"],
  disputa_territorial: ["Disputa territorial", "mesmo território, perfil neutro ou pouco nítido", "#e08a3a"],
  mesmo_lugar_publico_diferente: ["Mesmo lugar, públicos diferentes", "dividem o território mas atraem eleitores opostos", "#2a78d6"],
  mesmo_publico_outro_lugar: ["Mesmo público, outro lugar", "mesmo perfil em territórios diferentes — rival se expandir", "#7b2c8f"],
  pouca_disputa: ["Pouca disputa", "territórios e perfis diferentes", "#a9a8a2"],
};

export function renderSobreposicao(app: App) {
  const { state } = app;
  const modo = state.smodo === "perfil" || state.smodo === "disputa" ? state.smodo : "territorio";
  const head = `<div class="ph"><div class="eyebrow">Disputa por eleitor</div><h2>Quem disputa o mesmo eleitorado</h2></div>
    <div class="seg">${[["territorio", "Território (onde)"], ["perfil", "Perfil do eleitor (quem)"], ["disputa", "Disputa combinada"]].map(([k, l]) =>
      `<button class="${k === modo ? "on" : ""}" data-href="smodo=${k}">${l}</button>`).join("")}</div>`;
  if (modo === "territorio") return renderTerritorio(app, head);
  duelMap(app);
  const [a, b] = (state.pair ?? "").split(",");
  if (!(a && b)) { app.map.setPlaces(new Map(), (id) => esc(app.db.byId.get(id)!.nome)); app.legend(""); }
  app.panel.innerHTML = head + (a && b ? duelBox(app, a, b) : "") + (modo === "perfil" ? perfilView(app) : disputaView(app));
  bindHrefs(app.panel, (h) => app.go(Object.fromEntries(new URLSearchParams(h))));
  app.panel.querySelector<HTMLInputElement>("input.todos")?.addEventListener("change", (e) => app.go({ todos: (e.target as HTMLInputElement).checked ? "1" : "" }));
}

function findPair(app: App, a: string, b: string) {
  return app.db.perfilDisputa.pares.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
}

const sgn = (x: number, d = 2) => (x > 0 ? "+" : "") + x.toFixed(d).replace(".", ",");

/** Head-to-head box: territory (places + sections), profile similarity, and both voter-profile appeals. */
function duelBox(app: App, a: string, b: string) {
  const { db } = app;
  const PD = db.perfilDisputa;
  const ca = db.vByNum.get(a), cb = db.vByNum.get(b);
  if (!ca || !cb) return "";
  const p = findPair(app, a, b);
  const A = PD.candidatos[a], B = PD.candidatos[b];
  const o = db.sobreposicao;
  const tl = o.matriz[o.ids.indexOf(a)]?.[o.ids.indexOf(b)];
  const q = p ? QUAD[p.quadrante] : null;
  const feats = Object.entries(PD.features);
  const block = (c: typeof A, nome: string) => c ? `<div><h4>${esc(nome)} <span class="muted">nitidez ${c.nitidez.toFixed(1).replace(".", ",")}</span></h4>
      ${dbars(feats.map(([k, l]) => ({ label: l, value: Math.max(-4, Math.min(4, c.apelo_t[k])), fmt: `${sgn(c.apelo_pp[k], 1)} p.p.` })), 4)}</div>` : "";
  return `<div class="callout">
    <div class="drawer-head"><div class="namecell">${avatar(ca.nome, partyColor(ca.partido), "sm")}<b>${esc(ca.nome)}</b> × ${avatar(cb.nome, partyColor(cb.partido), "sm")}<b>${esc(cb.nome)}</b></div><a data-href="pair=">limpar</a></div>
    ${q ? `<p><span class="badge" style="background:color-mix(in srgb, ${q[2]} 18%, transparent);color:${q[2]}">${q[0]}</span> ${q[1]}.</p>` : ""}
    <div class="tiles">
      <div class="tile"><div class="tile-label">Território · locais</div><div class="tile-value">${tl != null ? pct(tl, 0) : "–"}</div><div class="tile-sub">análise atual (122 locais)</div></div>
      <div class="tile"><div class="tile-label">Território · seções</div><div class="tile-value">${p ? pct(p.terr_secao, 0) : "–"}</div><div class="tile-sub">${PD.n_secoes} seções (mais fino)</div></div>
      <div class="tile"><div class="tile-label">Perfil do eleitor</div><div class="tile-value">${p ? sgn(p.perfil) : "–"}</div><div class="tile-sub">−1 opostos · 0 sem relação · +1 iguais</div></div>
    </div>
    ${A && B ? `<p class="muted small">Barras = como os eleitores de cada um diferem dos eleitores das <i>mesmas escolas</i> onde tiveram voto (p.p.; barra = intensidade acima do acaso).</p><div class="grid2">${block(A, ca.nome)}${block(B, cb.nome)}</div>` : ""}
  </div>`;
}

function perfilView(app: App) {
  const { db, state } = app;
  const PD = db.perfilDisputa;
  const el = PD.ids.filter((n) => PD.candidatos[n].eleito || state.todos === "1");
  // order by first feature axis (young → old appeal) so similar profiles sit together
  const ord = [...el].sort((x, y) => (PD.candidatos[y].apelo_t.j - PD.candidatos[y].apelo_t.i) - (PD.candidatos[x].apelo_t.j - PD.candidatos[x].apelo_t.i));
  const ix = (n: string) => PD.ids.indexOf(n);
  const cell = (x: string, y: string) => {
    if (x === y) return `<td class="hm diag"></td>`;
    const v = PD.matriz_perfil[ix(x)][ix(y)];
    const sel = (state.pair === `${x},${y}` || state.pair === `${y},${x}`);
    return `<td class="hm${sel ? " sel" : ""}" style="background:${div(Math.max(-1, Math.min(1, v / 0.8)))}" title="${esc(PD.candidatos[x].nome)} × ${esc(PD.candidatos[y].nome)}: ${sgn(v)}" data-href="pair=${x},${y}"></td>`;
  };
  const feats = Object.entries(PD.features);
  const sorted = [...el].sort((x, y) => PD.candidatos[y].nitidez - PD.candidatos[x].nitidez);
  return `
    <p class="lead">Compara <b>quem</b> é o eleitor de cada candidato, além de onde ele vota. Dentro de cada escola, as seções têm perfis diferentes (as mais novas concentram eleitores jovens/recém-cadastrados). Cruzando o voto de cada seção com o perfil dela (TSE), estimamos para quem cada candidato vai melhor <b>descontada a geografia</b>.</p>
    <div class="row"><label style="flex-direction:row;align-items:center;gap:6px;text-transform:none"><input type="checkbox" class="todos" ${state.todos === "1" ? "checked" : ""}> Incluir suplentes fortes</label></div>
    <h3>Semelhança de perfil</h3>
    <div class="hm-wrap"><table class="hm-table"><thead><tr><th></th>${ord.map((n) => `<th class="rot"><span>${esc(PD.candidatos[n].nome)}</span></th>`).join("")}</tr></thead>
    <tbody>${ord.map((x) => `<tr><th class="rowh" data-href="tab=vereadores&cand=${x}"><span class="sw" style="background:${partyColor(PD.candidatos[x].partido)}"></span>${esc(PD.candidatos[x].nome)}</th>${ord.map((y) => cell(x, y)).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="lg-inline">${legendRamp(DIV_STOPS(), "perfis opostos", "mesmo perfil", "")}</div>
    <p class="muted small">Ordenado de "eleitor mais jovem" (topo) a "eleitor mais velho". Clique numa célula para o duelo.</p>
    <h3>Perfil de cada candidato</h3>
    <p class="muted small"><b>Nitidez</b> = quão diferente do acaso é o perfil (≈1 indistinguível; ≥2 claro). Perfis pouco nítidos pesam menos na semelhança.</p>
    ${sorted.map((n) => {
      const c = PD.candidatos[n];
      const top = feats.map(([k, l]) => ({ k, l, t: c.apelo_t[k], pp: c.apelo_pp[k] })).filter((f) => Math.abs(f.t) >= 2).sort((x, y) => Math.abs(y.t) - Math.abs(x.t)).slice(0, 3);
      return `<div class="seg-card" data-href="tab=vereadores&cand=${n}"><h4>${avatar(c.nome, partyColor(c.partido), "sm")} ${esc(c.nome)} ${chip(c.partido, partyColor(c.partido))} <span class="muted small">nitidez ${c.nitidez.toFixed(1).replace(".", ",")}</span></h4>
        <div class="small">${top.length ? top.map((f) => `${f.t > 0 ? "mais" : "menos"} <b>${esc(f.l.toLowerCase())}</b> (${sgn(f.pp, 1)} p.p.)`).join(" · ") : `<span class="muted">sem perfil distinto — vota como a média das escolas onde é forte</span>`}</div></div>`;
    }).join("")}`;
}

function disputaView(app: App) {
  const { db, state } = app;
  const PD = db.perfilDisputa;
  const pares = PD.pares.filter((p) => p.ambos_eleitos || state.todos === "1");
  const W = 560, H = 420, L = 44, B = 36, T = 14, R = 14;
  const X = (t: number) => L + (t / 0.9) * (W - L - R);
  const Y = (v: number) => T + ((1 - v) / 2) * (H - T - B);
  const lt = PD.limiares;
  const dots = pares.map((p) => {
    const q = QUAD[p.quadrante];
    const sel = state.pair === `${p.a},${p.b}` || state.pair === `${p.b},${p.a}`;
    return `<circle cx="${X(Math.min(0.9, p.terr_secao)).toFixed(1)}" cy="${Y(p.perfil).toFixed(1)}" r="${sel ? 7 : 4.5}" fill="${q[2]}" fill-opacity="${p.quadrante === "pouca_disputa" ? 0.35 : 0.85}" stroke="${sel ? "var(--text-primary)" : "var(--surface-1)"}" stroke-width="${sel ? 2 : 1}" data-href="pair=${p.a},${p.b}"><title>${esc(p.a_nome)} × ${esc(p.b_nome)} — território ${pct(p.terr_secao, 0)}, perfil ${sgn(p.perfil)}</title></circle>`;
  }).join("");
  const grid = [0, 0.2, 0.4, 0.6, 0.8].map((t) => `<line x1="${X(t)}" x2="${X(t)}" y1="${T}" y2="${H - B}" class="g"/><text x="${X(t)}" y="${H - B + 14}" text-anchor="middle">${t * 100}%</text>`).join("")
    + [-1, -0.5, 0, 0.5, 1].map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="g"/><text x="${L - 6}" y="${Y(v) + 3}" text-anchor="end">${sgn(v, 1)}</text>`).join("");
  const thr = `<line x1="${X(lt.territorio)}" x2="${X(lt.territorio)}" y1="${T}" y2="${H - B}" class="thr"/><line x1="${L}" x2="${W - R}" y1="${Y(lt.perfil)}" y2="${Y(lt.perfil)}" class="thr"/><line x1="${X(lt.territorio)}" x2="${W - R}" y1="${Y(lt.perfil_oposto)}" y2="${Y(lt.perfil_oposto)}" class="thr"/>`;
  const qlabels = `<text x="${W - R - 4}" y="${T + 12}" text-anchor="end" class="ql">DISPUTA DIRETA</text><text x="${L + 6}" y="${T + 12}" class="ql">MESMO PÚBLICO, OUTRO LUGAR</text><text x="${W - R - 4}" y="${H - B - 8}" text-anchor="end" class="ql">MESMO LUGAR, PÚBLICOS DIFERENTES</text>`;
  const list = (k: string, n = 6) => {
    const ps = pares.filter((p) => p.quadrante === k).sort((x, y) => (k === "mesmo_lugar_publico_diferente" ? x.perfil - y.perfil : y.disputa - x.disputa || y.perfil - x.perfil)).slice(0, n);
    return ps.length ? `<h4><span class="sw" style="background:${QUAD[k][2]}"></span>${QUAD[k][0]} · ${pares.filter((p) => p.quadrante === k).length}</h4><ul class="plain">${ps.map((p) => `<li><a data-href="pair=${p.a},${p.b}">${esc(p.a_nome)} × ${esc(p.b_nome)}</a> <span class="muted">território ${pct(p.terr_secao, 0)} · perfil ${sgn(p.perfil)}</span></li>`).join("")}</ul>` : "";
  };
  if (!state.pair) app.legend(legendCats(Object.values(QUAD).map(([l, , c]) => ({ label: l, color: c })), "Tipos de disputa"));
  return `
    <p class="lead">Cada ponto é um par de candidatos. Horizontal = quanto dividem as mesmas <b>seções</b>; vertical = quanto atraem o mesmo <b>perfil de eleitor</b>. O canto superior direito é a disputa mais direta.</p>
    <div class="row"><label style="flex-direction:row;align-items:center;gap:6px;text-transform:none"><input type="checkbox" class="todos" ${state.todos === "1" ? "checked" : ""}> Incluir suplentes fortes</label></div>
    <svg class="scatter" viewBox="0 0 ${W} ${H}" role="img" aria-label="Disputa: território × perfil">
      ${grid}${thr}${qlabels}${dots}
      <text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle" class="ax">Território compartilhado (seções) →</text>
      <text x="12" y="${(T + H - B) / 2}" text-anchor="middle" class="ax" transform="rotate(-90 12 ${(T + H - B) / 2})">Mesmo perfil de eleitor →</text>
    </svg>
    ${list("disputa_direta")}${list("mesmo_publico_outro_lugar")}${list("mesmo_lugar_publico_diferente")}${list("disputa_territorial", 5)}
    <p class="muted small">Limiares: território ≥ ${pct(lt.territorio, 0)}; perfil ≥ ${sgn(lt.perfil)} (mesmo público) ou ≤ ${sgn(lt.perfil_oposto)} (públicos opostos). Inferência a partir de dados agregados por seção — o voto é secreto; o resultado indica tendências, não o voto individual.</p>`;
}
