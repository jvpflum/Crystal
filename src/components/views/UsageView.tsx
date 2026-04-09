import React, { useState, useMemo } from "react";
import {
  useTokenUsageStore,
  formatLifetimeTokens,
  formatCost,
  estimateCost,
  hypotheticalCloudCost,
  PROVIDER_META,
  type ProviderId,
  type ProviderUsage,
} from "@/stores/tokenUsageStore";
import {
  BarChart3, TrendingUp, AlertTriangle, XCircle, DollarSign,
  Cpu, Globe, Zap, ArrowDownRight, Info, Leaf,
} from "lucide-react";
import { EASE, glowCard, hoverLift, hoverReset, pressDown, pressUp, innerPanel, sectionLabel, MONO } from "@/styles/viewStyles";

type TimeRange = "today" | "7d" | "30d" | "all";

// ── Bar chart for daily history ──────────────────────────────

function DailyChart({ data, color }: { data: { date: string; tokens: number; cost: number }[]; color: string }) {
  const max = Math.max(1, ...data.map(d => d.tokens));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 80, width: "100%" }}>
      {data.map((d, i) => {
        const h = Math.max(2, (d.tokens / max) * 72);
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div
              title={`${d.date}: ${formatLifetimeTokens(d.tokens)} tokens · ${formatCost(d.cost)}`}
              style={{
                width: "100%", maxWidth: 18, height: h, borderRadius: 4,
                background: `linear-gradient(180deg, ${color}, color-mix(in srgb, ${color} 60%, transparent))`,
                boxShadow: `0 0 6px color-mix(in srgb, ${color} 30%, transparent)`,
                transition: `height 0.6s ${EASE}`,
                cursor: "default",
              }}
            />
            {data.length <= 14 && (
              <span style={{ fontSize: 7, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                {d.date.slice(5)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Provider row ─────────────────────────────────────────────

function ProviderRow({ id, usage }: { id: ProviderId; usage: ProviderUsage }) {
  const meta = PROVIDER_META[id];
  const cost = estimateCost(id, usage.inputTokens, usage.outputTokens);
  const lastUsedStr = usage.lastUsed
    ? new Date(usage.lastUsed).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Never";

  return (
    <div
      style={{
        ...innerPanel,
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 14px", borderRadius: 12,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = `color-mix(in srgb, ${meta.color} 6%, transparent)`;
        e.currentTarget.style.borderColor = `color-mix(in srgb, ${meta.color} 15%, transparent)`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "rgba(255,255,255,0.018)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.04)";
      }}
    >
      {/* Icon */}
      <div style={{
        width: 34, height: 34, borderRadius: 10, flexShrink: 0,
        background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {meta.isLocal
          ? <Cpu style={{ width: 15, height: 15, color: meta.color }} />
          : <Globe style={{ width: 15, height: 15, color: meta.color }} />
        }
      </div>

      {/* Name + type */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
          {meta.name}
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.04em" }}>
          {meta.isLocal ? "Local Compute" : "Cloud API"} · Last: {lastUsedStr}
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 20, alignItems: "center", flexShrink: 0 }}>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--text)", fontFamily: MONO }}>
            {formatLifetimeTokens(usage.totalTokens)}
          </p>
          <p style={{ margin: "1px 0 0", fontSize: 8, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Tokens
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: cost > 0 ? "#fbbf24" : "var(--text-muted)", fontFamily: MONO }}>
            {formatCost(cost)}
          </p>
          <p style={{ margin: "1px 0 0", fontSize: 8, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Est. Cost
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text-muted)", fontFamily: MONO }}>
            {usage.requests.toLocaleString()}
          </p>
          <p style={{ margin: "1px 0 0", fontSize: 8, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Requests
          </p>
        </div>
        {usage.errors > 0 && (
          <div style={{
            padding: "3px 8px", borderRadius: 6,
            background: "color-mix(in srgb, var(--error) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--error) 25%, transparent)",
          }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "var(--error)" }}>
              {usage.errors} err
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; color: string;
}) {
  return (
    <div style={glowCard(color, { padding: "18px 20px" })} data-glow={color} onMouseEnter={hoverLift} onMouseLeave={hoverReset} onMouseDown={pressDown} onMouseUp={pressUp}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 11, flexShrink: 0,
          background: `color-mix(in srgb, ${color} 12%, transparent)`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon style={{ width: 18, height: 18, color, filter: `drop-shadow(0 0 4px ${color})` }} />
        </div>
        <div>
          <p style={{
            margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text)",
            fontFamily: MONO, lineHeight: 1,
            filter: `drop-shadow(0 0 6px ${color})`,
          }}>
            {value}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500 }}>
            {label}
          </p>
          {sub && <p style={{ margin: "2px 0 0", fontSize: 9, color: "var(--text-muted)" }}>{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Donut chart ──────────────────────────────────────────────

function ProviderDonut({ data, size = 140 }: {
  data: { id: ProviderId; tokens: number }[];
  size?: number;
}) {
  const total = Math.max(1, data.reduce((s, d) => s + d.tokens, 0));
  const cx = size / 2, cy = size / 2, r = size * 0.38;
  const stroke = 10;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth={stroke} />
        {data.map(d => {
          const pct = d.tokens / total;
          const dash = circ * pct;
          const meta = PROVIDER_META[d.id];
          const el = (
            <circle key={d.id} cx={cx} cy={cy} r={r}
              fill="none" stroke={meta.color} strokeWidth={stroke}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 4px ${meta.color})`, transition: `all 0.6s ${EASE}` }}
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", fontFamily: MONO, lineHeight: 1 }}>
          {formatLifetimeTokens(total)}
        </span>
        <span style={{ fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 3 }}>
          Total Tokens
        </span>
      </div>
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────

export function UsageView() {
  const totalTokens = useTokenUsageStore(s => s.totalTokens);
  const providers = useTokenUsageStore(s => s.providers);
  const dailyHistory = useTokenUsageStore(s => s.dailyHistory);
  const creditAlerts = useTokenUsageStore(s => s.creditAlerts);
  const dismissCreditAlert = useTokenUsageStore(s => s.dismissCreditAlert);
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");

  const activeProviders = useMemo(() => {
    return (Object.entries(providers) as [ProviderId, ProviderUsage][])
      .filter(([, u]) => u.totalTokens > 0 || u.requests > 0)
      .sort((a, b) => b[1].totalTokens - a[1].totalTokens);
  }, [providers]);

  const allProviders = useMemo(() => {
    return (Object.entries(providers) as [ProviderId, ProviderUsage][])
      .sort((a, b) => b[1].totalTokens - a[1].totalTokens);
  }, [providers]);

  const totalCost = useMemo(() => {
    return allProviders.reduce((sum, [id, u]) => sum + estimateCost(id, u.inputTokens, u.outputTokens), 0);
  }, [allProviders]);

  const totalRequests = useMemo(() => {
    return allProviders.reduce((sum, [, u]) => sum + u.requests, 0);
  }, [allProviders]);

  const totalErrors = useMemo(() => {
    return allProviders.reduce((sum, [, u]) => sum + u.errors, 0);
  }, [allProviders]);

  const localTokens = useMemo(() => {
    return allProviders.filter(([id]) => PROVIDER_META[id].isLocal).reduce((s, [, u]) => s + u.totalTokens, 0);
  }, [allProviders]);

  const cloudTokens = useMemo(() => {
    return allProviders.filter(([id]) => !PROVIDER_META[id].isLocal).reduce((s, [, u]) => s + u.totalTokens, 0);
  }, [allProviders]);

  const localCost = useMemo(() => {
    return allProviders
      .filter(([id]) => PROVIDER_META[id].isLocal)
      .reduce((sum, [id, u]) => sum + estimateCost(id, u.inputTokens, u.outputTokens), 0);
  }, [allProviders]);

  const cloudCost = useMemo(() => {
    return allProviders
      .filter(([id]) => !PROVIDER_META[id].isLocal)
      .reduce((sum, [id, u]) => sum + estimateCost(id, u.inputTokens, u.outputTokens), 0);
  }, [allProviders]);

  const localInputTokens = useMemo(() => {
    return allProviders.filter(([id]) => PROVIDER_META[id].isLocal).reduce((s, [, u]) => s + u.inputTokens, 0);
  }, [allProviders]);

  const localOutputTokens = useMemo(() => {
    return allProviders.filter(([id]) => PROVIDER_META[id].isLocal).reduce((s, [, u]) => s + u.outputTokens, 0);
  }, [allProviders]);

  const wouldHaveCostCloud = useMemo(() => {
    return hypotheticalCloudCost(localInputTokens, localOutputTokens);
  }, [localInputTokens, localOutputTokens]);

  const localSavings = useMemo(() => Math.max(0, wouldHaveCostCloud - localCost), [wouldHaveCostCloud, localCost]);

  const savingsMultiplier = useMemo(() => {
    if (localCost <= 0) return 0;
    return wouldHaveCostCloud / localCost;
  }, [wouldHaveCostCloud, localCost]);

  const donutData = useMemo(() => {
    return activeProviders
      .filter(([, u]) => u.totalTokens > 0)
      .map(([id, u]) => ({ id, tokens: u.totalTokens }));
  }, [activeProviders]);

  const filteredDaily = useMemo(() => {
    if (timeRange === "all") return dailyHistory;
    const now = new Date();
    const daysBack = timeRange === "today" ? 1 : timeRange === "7d" ? 7 : 30;
    const cutoff = new Date(now.getTime() - daysBack * 86_400_000).toISOString().slice(0, 10);
    return dailyHistory.filter(b => b.date >= cutoff);
  }, [dailyHistory, timeRange]);

  const chartData = useMemo(() => {
    return filteredDaily.map(b => {
      let tokens = 0, cost = 0;
      for (const [pid, u] of Object.entries(b.providers) as [ProviderId, ProviderUsage][]) {
        tokens += u.totalTokens;
        cost += estimateCost(pid, u.inputTokens, u.outputTokens);
      }
      return { date: b.date, tokens, cost };
    });
  }, [filteredDaily]);

  const ranges: { id: TimeRange; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "7d", label: "7 Days" },
    { id: "30d", label: "30 Days" },
    { id: "all", label: "All Time" },
  ];

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "22px 26px 40px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>
            Usage
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
            Token consumption, costs, and provider health across all APIs
          </p>
        </div>
        <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: 3 }}>
          {ranges.map(r => (
            <button
              key={r.id}
              aria-label={`Show ${r.label}`}
              onClick={() => setTimeRange(r.id)}
              style={{
                padding: "5px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
                background: timeRange === r.id ? "rgba(255,255,255,0.08)" : "transparent",
                color: timeRange === r.id ? "var(--text)" : "var(--text-muted)",
                transition: `all 0.2s ${EASE}`,
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Credit Alerts */}
      {creditAlerts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {creditAlerts.map(alert => (
            <div
              key={alert.providerId}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", borderRadius: 12,
                background: alert.severity === "critical"
                  ? "color-mix(in srgb, var(--error) 10%, transparent)"
                  : "color-mix(in srgb, #fbbf24 8%, transparent)",
                border: `1px solid ${alert.severity === "critical" ? "color-mix(in srgb, var(--error) 25%, transparent)" : "color-mix(in srgb, #fbbf24 20%, transparent)"}`,
              }}
            >
              <AlertTriangle style={{
                width: 16, height: 16, flexShrink: 0,
                color: alert.severity === "critical" ? "var(--error)" : "#fbbf24",
              }} />
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                  {PROVIDER_META[alert.providerId]?.name ?? alert.providerId}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
                  {alert.message}
                </p>
              </div>
              <button
                aria-label="Dismiss alert"
                onClick={() => dismissCreditAlert(alert.providerId)}
                style={{
                  background: "none", border: "none", cursor: "pointer", padding: 4,
                  color: "var(--text-muted)", display: "flex",
                }}
              >
                <XCircle style={{ width: 14, height: 14 }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Top Stats Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        <StatCard
          label="Total Tokens" value={formatLifetimeTokens(totalTokens)}
          sub={`${formatLifetimeTokens(cloudTokens)} cloud · ${formatLifetimeTokens(localTokens)} local`}
          icon={BarChart3} color="#c084fc"
        />
        <StatCard
          label="Est. Total Spend" value={formatCost(totalCost)}
          sub={`$${cloudCost.toFixed(2)} cloud · $${localCost.toFixed(4)} local`}
          icon={DollarSign} color="#fbbf24"
        />
        <StatCard
          label="Total Requests" value={totalRequests.toLocaleString()}
          sub={`${totalErrors > 0 ? `${totalErrors} errors` : "No errors"}`}
          icon={TrendingUp} color="#3b82f6"
        />
        <StatCard
          label="Active Providers" value={String(activeProviders.length)}
          sub={`of ${Object.keys(PROVIDER_META).length} configured`}
          icon={Zap} color="#10b981"
        />
      </div>

      {/* Local vs Cloud Savings */}
      {localTokens > 0 && (
        <div style={{
          ...glowCard("#10b981", { padding: "20px 22px" }),
          marginBottom: 20,
          background: "linear-gradient(135deg, rgba(16,185,129,0.06) 0%, rgba(16,185,129,0.02) 100%)",
          border: "1px solid rgba(16,185,129,0.15)",
        }} data-glow="#10b981" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <Leaf style={{ width: 16, height: 16, color: "#10b981", filter: "drop-shadow(0 0 4px #10b981)" }} />
            <span style={{ ...sectionLabel, margin: 0 }}>Local Compute Savings</span>
            <div style={{
              marginLeft: "auto", display: "flex", alignItems: "center", gap: 6,
              padding: "3px 10px", borderRadius: 8,
              background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.2)",
            }}>
              <Cpu style={{ width: 11, height: 11, color: "#10b981" }} />
              <span style={{ fontSize: 9, color: "#10b981", fontWeight: 600, letterSpacing: "0.04em" }}>
                RTX 5090 · CA Electricity
              </span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto", gap: 18, alignItems: "center" }}>
            {/* Cloud cost column */}
            <div>
              <p style={{ margin: 0, fontSize: 8, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
                If sent to cloud API
              </p>
              <p style={{ margin: "6px 0 0", fontSize: 22, fontWeight: 700, fontFamily: MONO, color: "#ef4444", lineHeight: 1 }}>
                {formatCost(wouldHaveCostCloud)}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 9, color: "var(--text-muted)" }}>
                {formatLifetimeTokens(localTokens)} tokens at Anthropic rates
              </p>
            </div>

            {/* Arrow */}
            <ArrowDownRight style={{ width: 20, height: 20, color: "#10b981", opacity: 0.6 }} />

            {/* Local cost column */}
            <div>
              <p style={{ margin: 0, fontSize: 8, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
                Actual electricity cost
              </p>
              <p style={{ margin: "6px 0 0", fontSize: 22, fontWeight: 700, fontFamily: MONO, color: "#10b981", lineHeight: 1, filter: "drop-shadow(0 0 6px rgba(16,185,129,0.4))" }}>
                {formatCost(localCost)}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 9, color: "var(--text-muted)" }}>
                ~350 W avg · $0.32/kWh · ~60 tok/s
              </p>
            </div>

            {/* Savings badge */}
            <div style={{
              padding: "14px 18px", borderRadius: 14, textAlign: "center",
              background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)",
            }}>
              <p style={{
                margin: 0, fontSize: 26, fontWeight: 800, fontFamily: MONO, color: "#10b981",
                lineHeight: 1, filter: "drop-shadow(0 0 8px rgba(16,185,129,0.5))",
              }}>
                {localSavings >= 0.01 ? formatCost(localSavings) : savingsMultiplier > 0 ? `${savingsMultiplier.toFixed(0)}×` : "—"}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 8, color: "#10b981", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {localSavings >= 0.01 ? "Saved" : "Cheaper"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Chart + Donut Row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 14, marginBottom: 20 }}>
        <div style={glowCard("#3b82f6", { padding: "18px 20px" })} data-glow="#3b82f6" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <span style={sectionLabel}>Daily Token Usage</span>
          </div>
          {chartData.length > 0 ? (
            <DailyChart data={chartData} color="#3b82f6" />
          ) : (
            <div style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)" }}>No usage data yet for this period</p>
            </div>
          )}
        </div>

        <div style={glowCard("#c084fc", { padding: "18px 20px" })} data-glow="#c084fc" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
          <span style={sectionLabel}>Provider Split</span>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
            {donutData.length > 0 ? (
              <ProviderDonut data={donutData} size={130} />
            ) : (
              <div style={{ width: 130, height: 130, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <p style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center" }}>No data yet</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Donut Legend */}
      {donutData.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 20, paddingLeft: 4 }}>
          {donutData.map(d => {
            const meta = PROVIDER_META[d.id];
            const pct = totalTokens > 0 ? ((d.tokens / totalTokens) * 100).toFixed(1) : "0";
            return (
              <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color, flexShrink: 0, boxShadow: `0 0 4px ${meta.color}` }} />
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  {meta.name} <span style={{ fontWeight: 600, color: "var(--text)" }}>{pct}%</span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Provider Breakdown */}
      <div style={{ marginBottom: 20 }}>
        <span style={sectionLabel}>Provider Breakdown</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          {allProviders.map(([id, usage]) => (
            <ProviderRow key={id} id={id} usage={usage} />
          ))}
        </div>
      </div>

      {/* Input/Output breakdown table */}
      {activeProviders.length > 0 && (
        <div style={glowCard("transparent", { padding: "18px 20px" })}>
          <span style={sectionLabel}>Input / Output Token Split</span>
          <div style={{ marginTop: 12 }}>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 90px 90px 90px 90px 60px",
              gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}>
              <span style={{ fontSize: 8, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>Provider</span>
              <span style={{ fontSize: 8, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", textAlign: "right" }}>Input</span>
              <span style={{ fontSize: 8, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", textAlign: "right" }}>Output</span>
              <span style={{ fontSize: 8, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", textAlign: "right" }}>Total</span>
              <span style={{ fontSize: 8, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", textAlign: "right" }}>Cost</span>
              <span style={{ fontSize: 8, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", textAlign: "right" }}>$/M Tok</span>
            </div>
            {activeProviders.map(([id, u]) => {
              const meta = PROVIDER_META[id];
              const cost = estimateCost(id, u.inputTokens, u.outputTokens);
              const blended = u.totalTokens > 0 ? (cost / u.totalTokens) * 1_000_000 : 0;
              return (
                <div key={id} style={{
                  display: "grid", gridTemplateColumns: "1fr 90px 90px 90px 90px 60px",
                  gap: 8, padding: "8px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.025)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 500 }}>{meta.name}</span>
                    {meta.isLocal && (
                      <span style={{
                        fontSize: 7, padding: "1px 5px", borderRadius: 4,
                        background: "rgba(16,185,129,0.12)", color: "#10b981", fontWeight: 600,
                      }}>GPU</span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text)", textAlign: "right", fontFamily: MONO }}>
                    {formatLifetimeTokens(u.inputTokens)}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text)", textAlign: "right", fontFamily: MONO }}>
                    {formatLifetimeTokens(u.outputTokens)}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 600, textAlign: "right", fontFamily: MONO }}>
                    {formatLifetimeTokens(u.totalTokens)}
                  </span>
                  <span style={{ fontSize: 11, color: cost > 0 ? "#fbbf24" : "var(--text-muted)", fontWeight: 600, textAlign: "right", fontFamily: MONO }}>
                    {formatCost(cost)}
                  </span>
                  <span style={{
                    fontSize: 10, textAlign: "right", fontFamily: MONO, fontWeight: 500,
                    color: meta.isLocal ? "#10b981" : "var(--text-muted)",
                  }}>
                    {blended > 0 ? `$${blended.toFixed(2)}` : "—"}
                  </span>
                </div>
              );
            })}
            {/* Totals row */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 90px 90px 90px 90px 60px",
              gap: 8, padding: "10px 0 4px",
              borderTop: "1px solid rgba(255,255,255,0.08)",
            }}>
              <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 700 }}>Total</span>
              <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 700, textAlign: "right", fontFamily: MONO }}>
                {formatLifetimeTokens(activeProviders.reduce((s, [, u]) => s + u.inputTokens, 0))}
              </span>
              <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 700, textAlign: "right", fontFamily: MONO }}>
                {formatLifetimeTokens(activeProviders.reduce((s, [, u]) => s + u.outputTokens, 0))}
              </span>
              <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 700, textAlign: "right", fontFamily: MONO }}>
                {formatLifetimeTokens(totalTokens)}
              </span>
              <span style={{ fontSize: 11, color: "#fbbf24", fontWeight: 700, textAlign: "right", fontFamily: MONO }}>
                {formatCost(totalCost)}
              </span>
              <span />
            </div>
          </div>
        </div>
      )}

      {/* Pricing Methodology */}
      <div style={{
        marginTop: 24, padding: "16px 18px", borderRadius: 12,
        background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Info style={{ width: 13, height: 13, color: "var(--text-muted)", flexShrink: 0 }} />
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.04em" }}>
            How costs are estimated
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <p style={{ margin: 0, fontSize: 9, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Cloud APIs
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Published per-token pricing from each provider. OpenAI GPT-4o: $2.50/$10 per M tokens.
              Anthropic Sonnet: $3/$15 per M. DeepSeek: $0.27/$1.10 per M. Blended estimates —
              actual cost depends on exact model used.
            </p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 9, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Local GPU (Electricity Only)
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--text-muted)", lineHeight: 1.5 }}>
              RTX 5090 at ~350 W average during inference, California residential rate of ~$0.32/kWh.
              At ~60 tokens/sec output throughput: ≈$0.07 per million output tokens. Does not include
              hardware amortization. Local GPU inference is roughly <strong style={{ color: "#10b981" }}>100–200× cheaper</strong> than cloud API calls.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
