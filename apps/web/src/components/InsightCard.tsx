type Chart = {
  type: "bar" | "line";
  title: string;
  unit: "₹" | "days" | "qty";
  labels: string[];
  values: number[];
  highlight?: number[];
};

const fmt = (v: number, unit: Chart["unit"]) =>
  unit === "₹"
    ? `${v < 0 ? "-" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`
    : unit === "days"
      ? `${+v.toFixed(1)} d`
      : String(+v.toFixed(2));

/** Horizontal bars (items, customers) or a compact column chart (days). */
export function ChartView({ chart }: { chart: Chart }) {
  const max = Math.max(...chart.values.map(Math.abs), 1);
  const signed = chart.values.some((v) => v < 0);
  if (chart.type === "line" || chart.labels.length > 12) {
    const w = 640,
      h = 180,
      pad = 24,
      step = (w - pad * 2) / Math.max(chart.values.length - 1, 1);
    const top = Math.max(...chart.values, 1);
    const points = chart.values.map(
      (v, i) => `${pad + i * step},${h - pad - (v / top) * (h - pad * 2)}`,
    );
    return (
      <figure className="chart" aria-label={chart.title}>
        <figcaption>
          {chart.title}
          {chart.labels.some(weekend) ? " · weekends in red" : ""}
        </figcaption>
        <svg viewBox={`0 0 ${w} ${h}`} role="img" preserveAspectRatio="none">
          <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} className="axis" />
          {chart.values.map((v, i) => {
            const bh = (v / top) * (h - pad * 2);
            return (
              <rect
                key={i}
                x={pad + i * step - Math.min(step * 0.35, 8)}
                width={Math.min(step * 0.7, 16)}
                y={h - pad - bh}
                height={bh}
                className={weekend(chart.labels[i]) ? "bar alt" : "bar"}
              >
                <title>{`${chart.labels[i]}: ${fmt(v, chart.unit)}`}</title>
              </rect>
            );
          })}
          <polyline points={points.join(" ")} className="trend" />
          <text x={pad} y={h - 6} className="tick">{chart.labels[0]}</text>
          <text x={w - pad} y={h - 6} className="tick" textAnchor="end">
            {chart.labels.at(-1)}
          </text>
          <text x={pad} y={14} className="tick">{fmt(top, chart.unit)}</text>
        </svg>
      </figure>
    );
  }
  return (
    <figure className="chart" aria-label={chart.title}>
      <figcaption>{chart.title}</figcaption>
      <ul className="bars">
        {chart.labels.map((label, i) => {
          const v = chart.values[i];
          const pct = (Math.abs(v) / max) * (signed ? 50 : 100);
          return (
            <li key={label + i}>
              <span className="bar-label">{label}</span>
              <span className={"bar-track" + (signed ? " signed" : "")}>
                <span
                  className={
                    "bar-fill" +
                    (v < 0 ? " negative" : "") +
                    (chart.highlight?.includes(i) ? " hot" : "")
                  }
                  style={
                    signed
                      ? v < 0
                        ? { right: "50%", width: `${pct}%` }
                        : { left: "50%", width: `${pct}%` }
                      : { width: `${pct}%` }
                  }
                />
              </span>
              <b>{(v > 0 && signed ? "+" : "") + fmt(v, chart.unit)}</b>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
const weekend = (label?: string) => {
  if (!label || !/^\d{2}-\d{2}$/.test(label)) return false;
  const year = new Date().getFullYear();
  const day = new Date(`${year}-${label}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
};

/** Card for analyst answers and lists returned by read-only tools. */
export function InsightCard({ insight }: { insight: any }) {
  const rows: { name: string; value: string }[] =
    insight.tool === "who_owes"
      ? (insight.customers ?? []).map((c: any) => ({ name: c.name, value: c.balanceText }))
      : insight.tool === "check_stock"
        ? (insight.items ?? []).map((i: any) => ({ name: i.name, value: i.stockText }))
        : insight.tool === "recent_entries"
          ? (insight.entries ?? []).map((e: any) => ({ name: e.type, value: e.text }))
          : insight.tool === "credit_risk"
            ? (insight.customers ?? []).map((c: any) => ({
                name: `${c.name} · ${c.risk} risk`,
                value: `${c.balanceText} — ${c.why}`,
              }))
            : insight.tool === "dead_stock"
              ? (insight.items ?? []).map((i: any) => ({
                  name: i.name,
                  value: `${i.stockText}${i.tiedUp ? ` · ₹${Math.round(i.tiedUp / 100).toLocaleString("en-IN")} tied up` : ""}`,
                }))
              : [];
  return (
    <section className="insight" data-testid="insight">
      <div className="eyebrow">From your ledger · {insight.tool.replaceAll("_", " ")}</div>
      <p className="insight-say">{insight.say}</p>
      {insight.chart && insight.chart.labels.length > 0 && <ChartView chart={insight.chart} />}
      {rows.length > 0 && (
        <ul className="lines">
          {rows.map((r, i) => (
            <li key={i}>
              <span>
                <strong>{r.name}</strong>
              </span>
              <span>{r.value}</span>
            </li>
          ))}
        </ul>
      )}
      {insight.evidence?.length > 0 && (
        <details>
          <summary>{insight.evidence.length} supporting receipts</summary>
          <small className="ids">{insight.evidence.join(", ")}</small>
        </details>
      )}
    </section>
  );
}
