// Detail drawer for one polling place, or for any set of places (bairro, lasso selection).
import type { App } from "../app";
import { aggDet, aggPerfil, aggVotes, candName, candParty, esc, fmt, pct, pp, ranked, valid } from "../data";
import { partyColor } from "../colors";
import { bars, perfilBlock, tiles } from "./common";

export function mayorRows(app: App, year: string, ids: string[]) {
  const v = aggVotes(app.db, year, "prefeito", ids);
  const t = valid(v);
  return ranked(v).map(([n, x]) => ({ label: candName(app.db, year, "prefeito", n), sub: candParty(app.db, year, "prefeito", n), value: x / t, note: fmt(x),
    color: partyColor(candParty(app.db, year, "prefeito", n)) }));
}

export function officeRows(app: App, year: string, cargo: string, ids: string[], top = 5) {
  const v = aggVotes(app.db, year, cargo, ids);
  const t = valid(v);
  return ranked(v).filter(([n]) => n.length > 2 || cargo === "governador" || cargo === "prefeito").slice(0, top).map(([n, x]) => ({
    label: candName(app.db, year, cargo, n), sub: candParty(app.db, year, cargo, n), value: x / t, note: fmt(x), color: partyColor(candParty(app.db, year, cargo, n)),
  }));
}

export function turnoutTiles(app: App, ids: string[]) {
  const rows = [["2020", "prefeito"], ["2024", "prefeito"], ["2026", "governador"]].map(([y, c]) => ({ y, d: aggDet(app.db, y, c, ids) }));
  return `<table class="tbl compact"><thead><tr><th>Eleição</th><th class="num">Aptos</th><th class="num">Comparec.</th><th class="num">Abstenção</th><th class="num">Brancos+nulos</th></tr></thead><tbody>
    ${rows.map(({ y, d }) => `<tr><td>${y}${y === "2026" ? " (gov.)" : ""}</td><td class="num">${fmt(d.aptos)}</td><td class="num">${pct(d.comp / d.aptos)}</td><td class="num">${pct(d.abst / d.aptos)}</td><td class="num">${pct((d.brancos + d.nulos) / d.comp)}</td></tr>`).join("")}
  </tbody></table>`;
}

export function vereadorRows(app: App, ids: string[], top = 10) {
  const v = aggVotes(app.db, "2024", "vereador", ids);
  const t = valid(v);
  return ranked(v).filter(([n]) => n.length > 2).slice(0, top).map(([n, x]) => {
    const c = app.db.vByNum.get(n);
    return { label: (c?.eleito ? "★ " : "") + (c?.nome ?? n), sub: c?.partido, value: x / t, note: fmt(x), color: partyColor(c?.partido), href: `tab=vereadores&cand=${n}` };
  });
}

/** Full breakdown for a set of places. */
export function areaReport(app: App, ids: string[]) {
  const db = app.db;
  const el = ids.reduce((s, id) => s + (db.byId.get(id)?.eleitores ?? 0), 0);
  const cityEl = db.locais.reduce((s, p) => s + p.eleitores, 0);
  const m24 = mayorRows(app, "2024", ids), m20 = mayorRows(app, "2020", ids);
  const coelho24 = (aggVotes(db, "2024", "prefeito", ids)["44"] ?? 0) / valid(aggVotes(db, "2024", "prefeito", ids));
  const coelho20 = (aggVotes(db, "2020", "prefeito", ids)["15"] ?? 0) / valid(aggVotes(db, "2020", "prefeito", ids));
  const vv = aggVotes(db, "2024", "vereador", ids);
  const vt = valid(vv);
  const inElected = Object.entries(vv).reduce((s, [n, x]) => s + (db.vByNum.get(n)?.eleito ? x : 0), 0);
  const nominal = ranked(vv).filter(([n]) => n.length > 2);
  const nt = nominal.reduce((s, [, x]) => s + x, 0);
  const nec = 1 / nominal.reduce((s, [, x]) => s + (x / nt) ** 2, 0);
  return `
    ${tiles([
      { label: "Eleitores 2024", value: fmt(el), sub: `${pct(el / cityEl)} da cidade · ${ids.length} locais` },
      { label: "Simão (2024)", value: pct(coelho24), sub: `Miguel 2020: ${pct(coelho20)} (${pp(coelho24 - coelho20)})` },
      { label: "Voto em eleitos", value: pct(inElected / vt), sub: `${nec.toFixed(0)} candidatos efetivos` },
    ])}
    <h3>Vereador 2024 — mais votados aqui</h3>${bars(vereadorRows(app, ids, 10), { max: 0.35 })}
    <p class="muted small">★ = eleito. Cor = partido do candidato.</p>
    <h3>Prefeito</h3><div class="grid2"><div><h4>2024</h4>${bars(m24, { max: 1 })}</div><div><h4>2020</h4>${bars(m20, { max: 1 })}</div></div>
    <h3>Comparecimento</h3>${turnoutTiles(app, ids)}
    <h3>2026 (1º turno)</h3><div class="grid2"><div><h4>Governador</h4>${bars(officeRows(app, "2026", "governador", ids, 3), { max: 1 })}</div>
      <div><h4>Senador</h4>${bars(officeRows(app, "2026", "senador", ids, 4), { max: 0.6 })}</div></div>
    <div class="grid2"><div><h4>Dep. estadual</h4>${bars(officeRows(app, "2026", "dep_estadual", ids, 5), { max: 0.4 })}</div>
      <div><h4>Dep. federal</h4>${bars(officeRows(app, "2026", "dep_federal", ids, 5), { max: 0.4 })}</div></div>
    <h3>Perfil do eleitorado</h3>${perfilBlock(aggPerfil(db, ids), aggPerfil(db, db.locais.map((p) => p.id)))}
  `;
}

export function renderPlace(app: App, id: string) {
  const p = app.db.byId.get(id);
  if (!p) return "";
  return `<div class="drawer-head"><button class="back" data-href="place=">← voltar</button></div>
    <h2>${esc(p.nome)}</h2>
    <p class="muted">${esc(p.endereco)} · ${esc(p.bairro_tse)} · Zona ${p.zona}, local ${p.local}<br>
    Região: <a data-href="tab=regioes&region=${encodeURIComponent(p.regiao)}&place=">${esc(p.regiao)}</a>${p.bairro_ibge ? ` · Bairro IBGE: ${esc(p.bairro_ibge)}` : ""} · Seções: ${p.secoes.join(", ")}
    ${p.geo_src !== "tse" ? `<br><span class="warn">Localização aproximada (${esc(p.geo_src)})</span>` : ""}</p>
    ${areaReport(app, [id])}
    <p class="muted small">População (Censo 2022) na área de influência deste local: ${fmt(p.pop_censo_area)} hab.</p>`;
}
