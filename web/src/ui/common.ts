// Small HTML building blocks (bars, tiles, tables, legends, CSV).
import { esc, fmt, pct } from "../data";

export interface BarRow { label: string; value: number; color?: string; note?: string; href?: string; sub?: string }

/** Horizontal bars; value in [0,1] shares unless max given. Labels in ink, colour only on the mark. */
export function bars(rows: BarRow[], opts: { max?: number; format?: (v: number) => string } = {}) {
  const max = opts.max ?? Math.max(...rows.map((r) => r.value), 1e-9);
  const f = opts.format ?? ((v: number) => pct(v));
  return `<div class="bars">${rows.map((r) => `
    <div class="bar-row"${r.href ? ` data-href="${esc(r.href)}" tabindex="0"` : ""} title="${esc(r.label)}: ${esc(f(r.value))}${r.note ? " · " + esc(r.note) : ""}">
      <div class="bar-label">${r.color ? `<span class="sw" style="background:${r.color}"></span>` : ""}${esc(r.label)}${r.sub ? ` <span class="muted">${esc(r.sub)}</span>` : ""}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(0.5, (100 * r.value) / max)}%;background:${r.color ?? "var(--series-1)"}"></div></div>
      <div class="bar-val">${esc(f(r.value))}${r.note ? ` <span class="muted">${esc(r.note)}</span>` : ""}</div>
    </div>`).join("")}</div>`;
}

export function tiles(items: { label: string; value: string; sub?: string }[]) {
  return `<div class="tiles">${items.map((t) => `<div class="tile"><div class="tile-label">${esc(t.label)}</div><div class="tile-value">${t.value}</div>${t.sub ? `<div class="tile-sub">${t.sub}</div>` : ""}</div>`).join("")}</div>`;
}

export interface Col<T> { key: string; label: string; get: (r: T) => string | number | null | undefined; fmt?: (v: never, r: T) => string; num?: boolean; cls?: string }

/** Sortable table; click a row to call onRow(row). */
export function table<T>(el: HTMLElement, rows: T[], cols: Col<T>[], opts: { sort?: string; desc?: boolean; onRow?: (r: T) => void; rowCls?: (r: T) => string; limit?: number } = {}) {
  let sort = opts.sort ?? cols[0].key, desc = opts.desc ?? true;
  const draw = () => {
    const c = cols.find((x) => x.key === sort)!;
    const sorted = [...rows].sort((a, b) => {
      const va = c.get(a), vb = c.get(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      const r = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
      return desc ? -r : r;
    }).slice(0, opts.limit ?? 10000);
    el.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr>${cols.map((x) => `<th data-k="${x.key}" class="${x.num ? "num" : ""} ${x.key === sort ? (desc ? "desc" : "asc") : ""}">${esc(x.label)}</th>`).join("")}</tr></thead>
      <tbody>${sorted.map((r, i) => `<tr data-i="${i}" class="${opts.rowCls?.(r) ?? ""}${opts.onRow ? " clickable" : ""}">${cols.map((x) => {
        const v = x.get(r);
        return `<td class="${x.num ? "num" : ""} ${x.cls ?? ""}">${x.fmt ? x.fmt(v as never, r) : esc(v == null ? "–" : typeof v === "number" ? fmt(v) : v)}</td>`;
      }).join("")}</tr>`).join("")}</tbody></table></div>`;
    el.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.k!;
      if (k === sort) desc = !desc; else { sort = k; desc = true; }
      draw();
    }));
    if (opts.onRow) el.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((tr) => tr.addEventListener("click", () => opts.onRow!(sorted[+tr.dataset.i!])));
  };
  draw();
  return { rows: () => rows, cols };
}

export function csvDownload(name: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const blob = new Blob(["﻿" + [header, ...rows].map((r) => r.map(q).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function legendCats(items: { label: string; color: string }[], titleTxt = "") {
  return `${titleTxt ? `<div class="lg-title">${esc(titleTxt)}</div>` : ""}${items.map((i) => `<div class="lg-item"><span class="sw" style="background:${i.color}"></span>${esc(i.label)}</div>`).join("")}`;
}
export function legendRamp(stops: string[], lo: string, hi: string, titleTxt = "") {
  return `${titleTxt ? `<div class="lg-title">${esc(titleTxt)}</div>` : ""}<div class="lg-ramp" style="background:linear-gradient(90deg,${stops.join(",")})"></div><div class="lg-ends"><span>${esc(lo)}</span><span>${esc(hi)}</span></div>`;
}

/** Simple age/sex-free profile bars from a perfil record. */
export function perfilBlock(p: Record<string, number>, city?: Record<string, number>) {
  const tot = p.total || 1, ct = city?.total || 1;
  const ages = ["16-17", "18-24", "25-34", "35-44", "45-59", "60+"];
  const esc_ = [["baixa", "Analf./lê e escreve"], ["fundamental", "Fundamental"], ["medio", "Médio"], ["superior", "Superior"]];
  const row = (label: string, k: string) => ({ label, value: (p[k] ?? 0) / tot, note: city ? `cidade ${pct((city[k] ?? 0) / ct, 0)}` : undefined });
  return `<div class="grid2">
    <div><h4>Faixa etária</h4>${bars(ages.map((a) => row(a, `idade_${a}`)), { max: 0.4 })}</div>
    <div><h4>Escolaridade</h4>${bars(esc_.map(([k, l]) => row(l, `esc_${k}`)), { max: 0.6 })}
      <p class="muted small">Mulheres: ${pct((p.fem ?? 0) / tot)} · Eleitores: ${fmt(p.total)}</p></div>
  </div>`;
}

export function bindHrefs(root: HTMLElement, go: (href: string) => void) {
  root.querySelectorAll<HTMLElement>("[data-href]").forEach((el) => {
    el.addEventListener("click", (e) => { e.stopPropagation(); go(el.dataset.href!); });
    el.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") go(el.dataset.href!); });
  });
}

// ---------------------------------------------------------------- identity components
export function initials(name: string) {
  const w = name.replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter((x) => x.length > 1 && !["DA", "DE", "DO", "DOS", "DAS"].includes(x.toUpperCase()));
  return ((w[0]?.[0] ?? "") + (w[1]?.[0] ?? "")).toUpperCase();
}
export function avatar(name: string, ring: string, size: "" | "sm" | "lg" = "") {
  return `<span class="avatar ${size}" style="--ring:${ring}" aria-hidden="true">${esc(initials(name))}</span>`;
}
export function chip(label: string, color?: string) {
  return `<span class="chip">${color ? `<i style="background:${color}"></i>` : ""}${esc(label)}</span>`;
}
export function badge(sit: string) {
  if (sit === "ELEITO POR QP") return `<span class="badge qp">Eleito · QP</span>`;
  if (sit === "ELEITO POR MÉDIA") return `<span class="badge media">Eleito · média</span>`;
  if (sit === "SUPLENTE") return `<span class="badge">Suplente</span>`;
  return `<span class="badge">${esc(sit.charAt(0) + sit.slice(1).toLowerCase())}</span>`;
}
/** Diverging bars for values in [-1, 1] (correlations, standardised scores). */
export function dbars(rows: { label: string; value: number; fmt?: string }[], max = 1) {
  return rows.map((r) => {
    const w = Math.min(50, (Math.abs(r.value) / max) * 50);
    const pos = r.value >= 0;
    return `<div class="dbar"><div class="bar-label">${esc(r.label)}</div><div class="dbar-track"><div class="dbar-fill" style="${pos ? `left:50%` : `right:50%`};width:${w}%;background:${pos ? "var(--series-1)" : "#e34948"}"></div></div><div class="dbar-val">${esc(r.fmt ?? r.value.toFixed(2).replace(".", ","))}</div></div>`;
  }).join("");
}
export function meter(x: number, color: string) {
  return `<span class="meter"><span><i style="width:${Math.round(Math.max(0, Math.min(1, x)) * 100)}%;background:${color}"></i></span>${x.toFixed(2).replace(".", ",")}</span>`;
}

/** Legend of the parties present in a styling pass, most frequent first. */
export function partyLegend(parties: (string | null | undefined)[], titleTxt: string, extra: { label: string; color: string }[] = [], colorOf: (p: string) => string) {
  const n = new Map<string, number>();
  for (const p of parties) if (p) n.set(p, (n.get(p) ?? 0) + 1);
  const items = [...n.entries()].sort((a, b) => b[1] - a[1]).map(([p, k]) => ({ label: `${p} · ${k}`, color: colorOf(p) }));
  return legendCats([...items, ...extra], titleTxt);
}

/** Tiny inline line chart (votes over elections). Values may be null (did not run). */
export function sparkline(points: { label: string; value: number | null }[], color = "var(--series-1)") {
  const W = 220, H = 56, P = 18;
  const vals = points.map((p) => p.value ?? 0);
  const max = Math.max(...vals, 1);
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - 16 - (v / max) * (H - 26);
  const seg = points.map((p, i) => (p.value == null ? null : `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`));
  const path = seg.filter(Boolean).join(" ");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Votos por eleição">
    <polyline points="${path}" fill="none" stroke="${color}" stroke-width="2"/>
    ${points.map((p, i) => p.value == null ? `<text x="${x(i)}" y="${H - 18}" text-anchor="middle">–</text>` : `<circle cx="${x(i)}" cy="${y(p.value)}" r="3.5" fill="${color}"><title>${esc(p.label)}: ${fmt(p.value)}</title></circle><text x="${x(i)}" y="${y(p.value) - 6}" text-anchor="middle">${fmt(p.value)}</text>`).join("")}
    ${points.map((p, i) => `<text x="${x(i)}" y="${H - 3}" text-anchor="middle" class="lbl">${esc(p.label)}</text>`).join("")}
  </svg>`;
}
