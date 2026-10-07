// MapLibre wrapper. Each polling place is drawn two ways: its catchment area (Voronoi cell, choropleth)
// and a point. Views style places through setPlaces(); both representations follow.
import maplibregl, { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { DB } from "./data";

export interface PlaceStyle { color: string; radius?: number; label?: string; stroke?: string; opacity?: number }
export type PolyKind = "none" | "regioes" | "bairros" | "setores";
export type Vis = "areas" | "pontos";

export const isDark = () => document.documentElement.dataset.theme === "dark" ||
  (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);

export class ElectionMap {
  map: MLMap;
  private db: DB;
  private ready: Promise<void>;
  private clickCb: (id: string) => void = () => {};
  private polyClickCb: (kind: PolyKind, key: string) => void = () => {};
  private lassoPts: [number, number][] | null = null;
  private lassoDone: (ids: string[], ring: [number, number][]) => void = () => {};
  private hovered: string | null = null;
  polyKind: PolyKind = "regioes";
  vis: Vis = "areas";
  private visCb: (v: Vis) => void = () => {};

  constructor(el: HTMLElement, db: DB) {
    this.db = db;
    const tiles = isDark() ? "Dark_Gray_Base" : "Light_Gray_Base";
    this.map = new maplibregl.Map({
      container: el,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: { base: { type: "raster", tileSize: 256, maxzoom: 16,
          tiles: [`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${tiles}/MapServer/tile/{z}/{y}/{x}`],
          attribution: "Basemap © Esri, HERE, Garmin, © OpenStreetMap · Dados: TSE, IBGE" } },
        layers: [{ id: "base", type: "raster", source: "base", paint: { "raster-saturation": -0.3 } }],
      },
      center: [-40.53, -9.3], zoom: 9.3, attributionControl: { compact: true },
    });
    if (import.meta.env.DEV) (window as unknown as { __map: MLMap }).__map = this.map;
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    this.ready = new Promise((res) => this.map.once("style.load", () => { this.setup(); res(); }));
  }

  whenReady() { return this.ready; }

  private setup() {
    const m = this.map;
    const dk = isDark();
    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    const surface = dk ? "#15171a" : "#ffffff";
    const ink = dk ? "#f3f4f6" : "#0f172a";
    m.addSource("distritos", { type: "geojson", data: this.db.geo.distritos });
    m.addSource("areas", { type: "geojson", data: empty, promoteId: "id" });
    m.addSource("poly", { type: "geojson", data: empty });
    m.addSource("places", { type: "geojson", data: empty });
    m.addSource("overlay", { type: "geojson", data: empty });
    m.addSource("lasso", { type: "geojson", data: empty });
    m.addLayer({ id: "areas-fill", type: "fill", source: "areas", paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.92, ["get", "fop"]] } });
    m.addLayer({ id: "areas-line", type: "line", source: "areas", paint: { "line-color": surface, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.3, 13, 1.2], "line-opacity": ["get", "lop"] } });
    m.addLayer({ id: "areas-hover", type: "line", source: "areas", paint: { "line-color": ink, "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2, 0] } });
    m.addLayer({ id: "poly-fill", type: "fill", source: "poly", paint: { "fill-color": ["coalesce", ["get", "fill"], "rgba(0,0,0,0)"], "fill-opacity": ["coalesce", ["get", "fop"], 0.55] } });
    m.addLayer({ id: "poly-line", type: "line", source: "poly", paint: { "line-color": dk ? "#2a2e35" : "#ffffff", "line-width": ["coalesce", ["get", "lw"], 1] } });
    m.addLayer({ id: "poly-sel", type: "line", source: "poly", filter: ["==", ["get", "sel"], true], paint: { "line-color": ink, "line-width": 2.5 } });
    m.addLayer({ id: "distritos-line", type: "line", source: "distritos", paint: { "line-color": dk ? "#9aa3af" : "#475569", "line-width": 1, "line-dasharray": [3, 2], "line-opacity": 0.55 } });
    m.addLayer({ id: "overlay-fill", type: "fill", source: "overlay", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["get", "color"], "fill-opacity": 0.06 } });
    m.addLayer({ id: "overlay-line", type: "line", source: "overlay", paint: { "line-color": ["get", "color"], "line-width": 1.6, "line-dasharray": [2, 1.2] } });
    m.addLayer({ id: "places", type: "circle", source: "places", paint: {
      "circle-color": ["get", "color"], "circle-radius": ["get", "radius"], "circle-opacity": ["get", "opacity"],
      "circle-stroke-color": ["coalesce", ["get", "stroke"], surface], "circle-stroke-width": ["case", ["has", "stroke"], 2.5, 1.2],
    } });
    m.addLayer({ id: "places-label", type: "symbol", source: "places", filter: ["has", "label"], minzoom: 11.5,
      layout: { "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top", "text-font": ["Open Sans Semibold"], "text-max-width": 9 },
      paint: { "text-color": ink, "text-halo-color": surface, "text-halo-width": 1.6 } });
    m.addLayer({ id: "lasso-fill", type: "fill", source: "lasso", paint: { "fill-color": "#2a78d6", "fill-opacity": 0.12 } });
    m.addLayer({ id: "lasso-line", type: "line", source: "lasso", paint: { "line-color": "#2a78d6", "line-width": 2 } });

    const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "tip", maxWidth: "300px" });
    const setHover = (id: string | null) => {
      if (this.hovered) m.setFeatureState({ source: "areas", id: this.hovered }, { hover: false });
      this.hovered = id;
      if (id) m.setFeatureState({ source: "areas", id }, { hover: true });
    };
    const placeAt = (pt: maplibregl.PointLike) =>
      (m.queryRenderedFeatures(pt, { layers: ["places"] })[0] ?? (this.vis === "areas" ? m.queryRenderedFeatures(pt, { layers: ["areas-fill"] })[0] : undefined))?.properties as Record<string, string> | undefined;
    m.on("mousemove", (e) => {
      if (this.lassoPts) return;
      const p = placeAt(e.point);
      if (p?.tip) {
        m.getCanvas().style.cursor = "pointer";
        setHover(p.id);
        tip.setLngLat(e.lngLat).setHTML(p.tip).addTo(m);
        return;
      }
      setHover(null);
      const pf = m.queryRenderedFeatures(e.point, { layers: ["poly-fill"] })[0]?.properties as Record<string, string> | undefined;
      if (pf?.tip) { m.getCanvas().style.cursor = "pointer"; tip.setLngLat(e.lngLat).setHTML(pf.tip).addTo(m); }
      else { m.getCanvas().style.cursor = ""; tip.remove(); }
    });
    m.on("mouseout", () => { setHover(null); tip.remove(); });
    m.on("click", (e) => {
      if (this.lassoPts) {
        this.lassoPts.push([e.lngLat.lng, e.lngLat.lat]);
        this.drawLasso();
        return;
      }
      const pl = m.queryRenderedFeatures(e.point, { layers: ["places"] })[0];
      if (pl) return this.clickCb(String(pl.properties!.id));
      const pf = m.queryRenderedFeatures(e.point, { layers: ["poly-fill"] })[0];
      if (pf && pf.properties?.key && pf.properties?.fop > 0.05) return this.polyClickCb(this.polyKind, String(pf.properties.key));
      const ar = this.vis === "areas" ? m.queryRenderedFeatures(e.point, { layers: ["areas-fill"] })[0] : undefined;
      if (ar) return this.clickCb(String(ar.properties!.id));
      if (pf && pf.properties?.key) this.polyClickCb(this.polyKind, String(pf.properties.key));
    });
    m.on("dblclick", (e) => {
      if (!this.lassoPts) return;
      e.preventDefault();
      this.finishLasso();
    });
  }

  onPlaceClick(cb: (id: string) => void) { this.clickCb = cb; }
  onPolyClick(cb: (kind: PolyKind, key: string) => void) { this.polyClickCb = cb; }
  onVisChange(cb: (v: Vis) => void) { this.visCb = cb; }
  setVis(v: Vis) { this.vis = v; this.visCb(v); }

  /** Style every polling place (point + catchment area). Unstyled places are drawn faint. */
  setPlaces(styles: Map<string, PlaceStyle>, tips: (id: string) => string, opts: { areaOpacity?: number } = {}) {
    const maxE = Math.max(...this.db.locais.map((p) => p.eleitores));
    const dk = isDark();
    const areas = this.vis === "areas";
    const faint = dk ? "#4b5160" : "#b8bec8";
    const tipOf = new Map<string, string>();
    const features = this.db.locais.map((p) => {
      const s = styles.get(p.id);
      const t = tips(p.id);
      tipOf.set(p.id, t);
      const base = 3 + 11 * Math.sqrt(p.eleitores / maxE);
      const props: Record<string, unknown> = {
        id: p.id, tip: t, color: s?.color ?? faint,
        radius: areas ? (s?.label ? 3.5 : 2.2) : s?.radius ?? base,
        opacity: areas ? 0.95 : s?.opacity ?? (s ? 0.92 : 0.55),
      };
      if (s?.label) props.label = s.label;
      if (s?.stroke && !areas) props.stroke = s.stroke;
      return { type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] }, properties: props };
    });
    features.sort((a, b) => (b.properties.radius as number) - (a.properties.radius as number));
    const areaFeatures = this.db.geo.areas.features.map((f) => {
      const id = String((f.properties as Record<string, unknown>).id);
      const s = styles.get(id);
      return { ...f, properties: { ...f.properties, id, tip: tipOf.get(id) ?? "", color: s?.color ?? faint,
        fop: areas ? (s ? Math.min(0.8, s.opacity ?? opts.areaOpacity ?? 0.62) : 0.06) : 0, lop: areas ? 0.9 : 0 } };
    });
    this.whenReady().then(() => {
      (this.map.getSource("places") as GeoJSONSource).setData({ type: "FeatureCollection", features });
      (this.map.getSource("areas") as GeoJSONSource).setData({ type: "FeatureCollection", features: areaFeatures });
    });
  }

  /** Polygon layer; fills keyed by region name / bairro name / tract code. */
  setPoly(kind: PolyKind, fills: Map<string, string> = new Map(), tips: (key: string) => string = () => "", selected?: string, opacity = 0.55) {
    this.polyKind = kind;
    const src = kind === "regioes" ? this.db.geo.regioes : kind === "bairros" ? this.db.geo.bairros : kind === "setores" ? this.db.geo.setores : null;
    const keyOf = (p: Record<string, unknown>) => String(kind === "regioes" ? p.regiao : kind === "bairros" ? p.NM_BAIRRO : p.CD_SETOR);
    const data: GeoJSON.FeatureCollection = src
      ? { type: "FeatureCollection", features: src.features.map((f) => {
          const key = keyOf(f.properties as Record<string, unknown>);
          return { ...f, properties: { ...f.properties, key, fill: fills.get(key) ?? null, fop: fills.has(key) ? opacity : 0, tip: tips(key), sel: key === selected, lw: kind === "setores" ? 0.3 : 1.4 } };
        }) }
      : { type: "FeatureCollection", features: [] };
    this.whenReady().then(() => (this.map.getSource("poly") as GeoJSONSource).setData(data));
  }

  /** Dashed circles (e.g. radius holding 50%/80% of a candidate's vote). */
  setOverlay(items: { center: [number, number]; km: number; color: string }[]) {
    const features = items.map((it) => {
      const ring: [number, number][] = [];
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * 2 * Math.PI;
        ring.push([it.center[1] + (it.km / (111.32 * Math.cos((it.center[0] * Math.PI) / 180))) * Math.cos(a), it.center[0] + (it.km / 110.57) * Math.sin(a)]);
      }
      return { type: "Feature" as const, geometry: { type: "Polygon" as const, coordinates: [ring] }, properties: { color: it.color } };
    });
    this.whenReady().then(() => (this.map.getSource("overlay") as GeoJSONSource).setData({ type: "FeatureCollection", features }));
  }

  fitPlaces(ids: string[], maxZoom = 13) {
    const pts = ids.map((id) => this.db.byId.get(id)).filter(Boolean);
    if (!pts.length) return;
    const b = new maplibregl.LngLatBounds();
    pts.forEach((p) => b.extend([p!.lon, p!.lat]));
    this.map.fitBounds(b, { padding: 70, maxZoom, duration: 600 });
  }
  fitAll() { this.fitPlaces(this.db.locais.map((p) => p.id), 11); }
  fitCity() { this.map.fitBounds([[-40.575, -9.42], [-40.45, -9.33]], { padding: 30, duration: 600 }); }

  // ---------------------------------------------------------- lasso
  startLasso(done: (ids: string[], ring: [number, number][]) => void) {
    this.lassoPts = [];
    this.lassoDone = done;
    this.map.doubleClickZoom.disable();
    this.map.getCanvas().style.cursor = "crosshair";
    this.drawLasso();
  }
  cancelLasso() {
    this.lassoPts = null;
    this.map.doubleClickZoom.enable();
    this.map.getCanvas().style.cursor = "";
    this.clearLasso();
  }
  finishLasso() {
    const ring = this.lassoPts ?? [];
    this.lassoPts = null;
    this.map.doubleClickZoom.enable();
    this.map.getCanvas().style.cursor = "";
    if (ring.length < 3) return this.clearLasso();
    const ids = this.db.locais.filter((p) => inside([p.lon, p.lat], ring)).map((p) => p.id);
    this.drawRing([...ring, ring[0]]);
    this.lassoDone(ids, ring);
  }
  clearLasso() { (this.map.getSource("lasso") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] }); }
  private drawLasso() {
    const pts = this.lassoPts ?? [];
    this.drawRing(pts.length > 2 ? [...pts, pts[0]] : pts);
  }
  private drawRing(r: [number, number][]) {
    const f: GeoJSON.Feature[] = r.length > 3
      ? [{ type: "Feature", geometry: { type: "Polygon", coordinates: [r] }, properties: {} }]
      : r.length > 1 ? [{ type: "Feature", geometry: { type: "LineString", coordinates: r }, properties: {} }] : [];
    (this.map.getSource("lasso") as GeoJSONSource).setData({ type: "FeatureCollection", features: f });
  }
}

function inside(pt: [number, number], ring: [number, number][]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
