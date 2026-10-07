// Vote transfers between elections (roadmap 8): Sankey diagram + matrix with 90% intervals.
import type { App } from "../app";
import { esc, fmt, pct } from "../data";
import { OTHER, partyColor } from "../colors";
import { bindHrefs } from "./common";

const COLOR: Record<string, string> = {
  "Simão Durando": "UNIÃO", "Miguel Coelho": "UNIÃO", "Dr. Julio": "PSDB", "Júlio Lóssio Filho": "PSDB", "Odacy": "PT", "Lara": "PL",
  "Lula": "PT", "Bolsonaro": "PL", "Flávio Bolsonaro": "PL", "Raquel Lyra": "PSD", "João Campos": "PSB",
};
const col = (l: string) => (COLOR[l] ? partyColor(COLOR[l]) : l === "Abstenção" ? "#7c8696" : l === "Branco/nulo" ? "#b8bec8" : OTHER());

function sankey(f: { de: string[]; para: string[]; fluxos: number[][] }) {
  const W = 560, H = 380, NW = 12, PAD = 6;
  const left = f.de.map((_, i) => f.fluxos[i].reduce((a, b) => a + b, 0));
  const right = f.para.map((_, j) => f.fluxos.reduce((a, row) => a + row[j], 0));
  const total = left.reduce((a, b) => a + b, 0) || 1;
  const scaleY = (H - PAD * (Math.max(f.de.length, f.para.length) + 1)) / total;
  const ly: number[] = [], ry: number[] = [];
  let y = PAD; left.forEach((v) => { ly.push(y); y += v * scaleY + PAD; });
  y = PAD; right.forEach((v) => { ry.push(y); y += v * scaleY + PAD; });
  const lOff = [...ly], rOff = [...ry];
  const x0 = 150, x1 = W - 150;
  let links = "";
  f.de.forEach((a, i) => f.para.forEach((b, j) => {
    const v = f.fluxos[i][j];
    if (v < total * 0.004) return;
    const h = v * scaleY, ya = lOff[i] + h / 2, yb = rOff[j] + h / 2;
    lOff[i] += h; rOff[j] += h;
    links += `<path d="M${x0 + NW},${ya} C${(x0 + x1) / 2},${ya} ${(x0 + x1) / 2},${yb} ${x1},${yb}" stroke="${col(a)}" stroke-width="${Math.max(1, h)}" fill="none" stroke-opacity="0.35"><title>${esc(a)} → ${esc(b)}: ~${fmt(v)} eleitores</title></path>`;
  }));
  const nodes = f.de.map((a, i) => `<rect x="${x0}" y="${ly[i]}" width="${NW}" height="${Math.max(1, left[i] * scaleY)}" fill="${col(a)}" rx="2"/><text x="${x0 - 6}" y="${ly[i] + (left[i] * scaleY) / 2 + 4}" text-anchor="end">${esc(a)} · ${fmt(left[i])}</text>`).join("")
    + f.para.map((b, j) => `<rect x="${x1}" y="${ry[j]}" width="${NW}" height="${Math.max(1, right[j] * scaleY)}" fill="${col(b)}" rx="2"/><text x="${x1 + NW + 6}" y="${ry[j] + (right[j] * scaleY) / 2 + 4}">${esc(b)} · ${fmt(right[j])}</text>`).join("");
  return `<svg class="sankey" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fluxo de votos">${links}${nodes}</svg>`;
}

export function renderTransferencias(app: App) {
  const { db, state } = app;
  const keys = Object.keys(db.transferencias);
  const k = keys.includes(state.fluxo ?? "") ? state.fluxo! : keys[0];
  const f = db.transferencias[k];
  app.map.setPoly("none");
  app.map.setPlaces(new Map(), (id) => esc(db.byId.get(id)!.nome));
  app.map.setOverlay([]);
  app.legend("");
  app.panel.innerHTML = `<div class="ph"><div class="eyebrow">Inferência ecológica</div><h2>Para onde foi o voto</h2></div>
    <div class="seg small">${keys.map((x) => `<button class="${x === k ? "on" : ""}" data-href="fluxo=${x}">${esc(db.transferencias[x].titulo)}</button>`).join("")}</div>
    <p class="lead">Estimativa de quanto do eleitorado de cada opção numa eleição foi para cada opção na seguinte, a partir de como os resultados variam juntos nos ${f.locais} locais de votação. Inclui brancos/nulos e abstenção.</p>
    ${sankey(f)}
    <h3>Matriz de transferência (% do eleitorado de origem)</h3>
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>De \\ Para</th>${f.para.map((b) => `<th class="num">${esc(b)}</th>`).join("")}</tr></thead><tbody>
      ${f.de.map((a, i) => `<tr><td><span class="sw" style="background:${col(a)}"></span>${esc(a)}</td>${f.para.map((_, j) => {
        const v = f.T[i][j];
        return `<td class="num" title="intervalo de 90%: ${pct(f.lo[i][j], 0)}–${pct(f.hi[i][j], 0)}" style="background:color-mix(in srgb, var(--series-1) ${Math.round(v * 60)}%, transparent)">${pct(v, 0)}<div class="muted small">${pct(f.lo[i][j], 0)}–${pct(f.hi[i][j], 0)}</div></td>`;
      }).join("")}</tr>`).join("")}
    </tbody></table></div>
    <p class="muted small">Ajuste do modelo: R² = ${f.r2.toFixed(2).replace(".", ",")}. Cada célula mostra a estimativa e o intervalo de 90% (bootstrap de locais). Limitações: o voto é secreto, então isto é inferência a partir de dados agregados (falácia ecológica); o eleitorado muda entre eleições (novos eleitores, mudanças de domicílio); estimativas com intervalo largo ou em 0%/100% indicam baixa precisão, típica de grupos pequenos.</p>`;
  bindHrefs(app.panel, (h) => app.go(Object.fromEntries(new URLSearchParams(h))));
}
