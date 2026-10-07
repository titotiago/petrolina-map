// Territorial overlap between councillors: heatmap matrix + head-to-head map.
import type { App } from "../app";
import { esc, fmt, pct, valid } from "../data";
import { div, DIV_STOPS, seq, partyColor } from "../colors";
import type { PlaceStyle } from "../map";
import { bindHrefs, legendRamp } from "./common";

export function renderSobreposicao(app: App) {
  const { db, state } = app;
  const o = db.sobreposicao;
  // order elected by their base region so territorial clusters sit together
  const idx = o.ids.map((_, i) => i).filter((i) => o.eleitos[i]);
  const reg = (i: number) => db.vByNum.get(o.ids[i])?.territorio?.regiao_base ?? "";
  idx.sort((a, b) => reg(a).localeCompare(reg(b)) || (db.vByNum.get(o.ids[b])!.votos - db.vByNum.get(o.ids[a])!.votos));
  const [a, b] = (state.pair ?? "").split(",");
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
  const cell = (i: number, j: number) => {
    const v = o.matriz[i][j];
    const sel = (o.ids[i] === a && o.ids[j] === b) || (o.ids[i] === b && o.ids[j] === a);
    return i === j ? `<td class="hm diag"></td>` : `<td class="hm${sel ? " sel" : ""}" style="background:${seq(Math.max(0, Math.min(1, (v - 0.3) / 0.55)))}" title="${esc(o.nomes[i])} × ${esc(o.nomes[j])}: ${pct(v, 0)}" data-href="pair=${o.ids[i]},${o.ids[j]}"></td>`;
  };
  const pairs = o.pares.filter((p) => p.ambos_eleitos).slice(0, 10);
  const view = state.sview === "matriz" ? "matriz" : "rede";
  app.panel.innerHTML = `
    <div class="ph"><div class="eyebrow">Disputa por eleitor</div><h2>Quem disputa o mesmo eleitorado</h2>
    <p class="lead">Sobreposição territorial = fração da distribuição dos votos de dois candidatos que coincide nos mesmos locais (0–100%). Alta sobreposição = disputa direta pelo mesmo eleitor em 2028.</p></div>
    <div class="seg"><button class="${view === "rede" ? "on" : ""}" data-href="sview=rede">Rede</button><button class="${view === "matriz" ? "on" : ""}" data-href="sview=matriz">Matriz</button></div>
    ${view === "rede" ? `${network(app)}<p class="muted small">Nós = candidatos (tamanho = votos; cor = partido; contorno tracejado = suplente). Proximidade = territórios parecidos (MDS sobre 1 − sobreposição). Linhas = sobreposição ≥ 60%. Clique numa linha para ver o duelo no mapa; num nó para abrir o perfil.</p>` : `
    <div class="hm-wrap"><table class="hm-table"><thead><tr><th></th>${idx.map((i) => `<th class="rot"><span>${esc(o.nomes[i])}</span></th>`).join("")}</tr></thead>
    <tbody>${idx.map((i) => `<tr><th class="rowh" data-href="tab=vereadores&cand=${o.ids[i]}"><span class="sw" style="background:${partyColor(db.vByNum.get(o.ids[i])?.partido)}"></span>${esc(o.nomes[i])}</th>${idx.map((j) => cell(i, j)).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="lg-inline">${legendRamp([seq(0), seq(0.5), seq(1)], "≤30%", "85%+", "")}</div>`}
    ${a && b ? `<div class="callout">Duelo: <b>${esc(db.vByNum.get(a)?.nome)}</b> × <b>${esc(db.vByNum.get(b)?.nome)}</b> — ${pct(o.matriz[o.ids.indexOf(a)]?.[o.ids.indexOf(b)] ?? 0, 0)} de sobreposição. <a data-href="pair=">limpar</a></div>` : ""}
    <h3>Pares com maior sobreposição (ambos eleitos)</h3>
    <ol>${pairs.map((p) => `<li><a data-href="pair=${p.a},${p.b}">${esc(p.a_nome)} × ${esc(p.b_nome)}</a> — ${pct(p.sobreposicao, 0)}</li>`).join("")}</ol>
    <h3>Eleitos × suplentes fortes</h3>
    <ol>${o.pares.filter((p) => !p.ambos_eleitos).slice(0, 8).map((p) => `<li><a data-href="pair=${p.a},${p.b}">${esc(p.a_nome)} × ${esc(p.b_nome)}</a> — ${pct(p.sobreposicao, 0)}</li>`).join("")}</ol>
    <p class="muted small">Um suplente forte com alta sobreposição é ameaça direta ao mandato em 2028 — especialmente se estiver no mesmo partido.</p>`;
  bindHrefs(app.panel, (h) => app.go(Object.fromEntries(new URLSearchParams(h))));
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
