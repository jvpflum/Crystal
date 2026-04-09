import type { CSSProperties, MouseEvent } from "react";

export const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
export const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

export const MONO = "'SF Mono', 'JetBrains Mono', monospace";

export const cardBase: CSSProperties = {
  background: "rgba(255,255,255,0.022)",
  border: "1px solid rgba(255,255,255,0.055)",
  borderRadius: 16,
  transition: `all 0.3s ${EASE}`,
  position: "relative",
  overflow: "hidden",
};

export function glowCard(color: string, extra?: CSSProperties): CSSProperties {
  return {
    ...cardBase,
    boxShadow: `0 0 24px color-mix(in srgb, ${color} 6%, transparent), inset 0 1px 0 rgba(255,255,255,0.035)`,
    ...extra,
  };
}

export function hoverLift(e: MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  el.style.transform = "translateY(-2px) scale(1.005)";
  el.style.borderColor = "rgba(255,255,255,0.1)";
  el.style.boxShadow = el.dataset.glow
    ? `0 8px 32px color-mix(in srgb, ${el.dataset.glow} 12%, transparent), inset 0 1px 0 rgba(255,255,255,0.06)`
    : "0 8px 32px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)";
}

export function hoverReset(e: MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  el.style.transform = "";
  el.style.borderColor = "";
  el.style.boxShadow = "";
}

export function pressDown(e: MouseEvent<HTMLElement>) {
  e.currentTarget.style.transform = "translateY(0px) scale(0.98)";
}

export function pressUp(e: MouseEvent<HTMLElement>) {
  e.currentTarget.style.transform = "translateY(-2px) scale(1.005)";
}

export const innerPanel: CSSProperties = {
  background: "rgba(255,255,255,0.018)",
  border: "1px solid rgba(255,255,255,0.04)",
  borderRadius: 10,
  transition: `all 0.2s ${EASE}`,
};

export const sectionLabel: CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 6,
};

export const pageHeader: CSSProperties = {
  fontSize: 17,
  fontWeight: 700,
  color: "var(--text)",
  letterSpacing: "-0.025em",
  lineHeight: 1,
};

export const pageSubtitle: CSSProperties = {
  fontSize: 9,
  color: "var(--text-muted)",
  letterSpacing: "0.12em",
  fontWeight: 500,
  textTransform: "uppercase",
};

export const monoValue: CSSProperties = {
  fontFamily: MONO,
  fontWeight: 700,
  lineHeight: 1,
  letterSpacing: "-0.02em",
  color: "var(--text)",
};

export const mutedCaption: CSSProperties = {
  fontSize: 9,
  color: "var(--text-muted)",
  letterSpacing: "0.04em",
  fontWeight: 500,
};

export const iconTile = (color: string, size = 32): CSSProperties => ({
  width: size,
  height: size,
  borderRadius: size * 0.3,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: `color-mix(in srgb, ${color} 10%, transparent)`,
  flexShrink: 0,
  transition: `all 0.25s ${SPRING}`,
});

export const inputStyle: CSSProperties = {
  background: "rgba(255,255,255,0.035)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 10,
  padding: "8px 12px",
  color: "var(--text)",
  fontSize: 13,
  outline: "none",
  width: "100%",
  transition: `border-color 0.2s ${EASE}, box-shadow 0.2s ${EASE}`,
};

export const btnPrimary: CSSProperties = {
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "8px 16px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  transition: `all 0.2s ${EASE}`,
  letterSpacing: "0.02em",
};

export const btnSecondary: CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  color: "var(--text-secondary)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 10,
  padding: "7px 14px",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  transition: `all 0.2s ${EASE}`,
};

export const pillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "4px 10px",
  borderRadius: 20,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.03em",
  transition: `all 0.2s ${EASE}`,
};

export const scrollArea: CSSProperties = {
  overflowY: "auto",
  overflowX: "hidden",
  flex: 1,
  minHeight: 0,
};

export const viewContainer: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  padding: "20px 24px",
  gap: 16,
  overflow: "hidden",
};

export const headerRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexShrink: 0,
};

export const badge = (color: string): CSSProperties => ({
  fontSize: 10,
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 20,
  background: `color-mix(in srgb, ${color} 12%, transparent)`,
  color,
  letterSpacing: "0.03em",
});

export const emptyState: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: "48px 24px",
  color: "var(--text-muted)",
  fontSize: 13,
  textAlign: "center",
};

export const tabBar: CSSProperties = {
  display: "flex",
  gap: 2,
  padding: 3,
  background: "rgba(255,255,255,0.02)",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.04)",
};

export const tab = (active: boolean): CSSProperties => ({
  padding: "6px 14px",
  fontSize: 11,
  fontWeight: active ? 600 : 500,
  borderRadius: 9,
  cursor: "pointer",
  color: active ? "var(--text)" : "var(--text-muted)",
  background: active ? "rgba(255,255,255,0.06)" : "transparent",
  border: "none",
  transition: `all 0.2s ${EASE}`,
  letterSpacing: "0.02em",
});

export const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 14px",
  borderRadius: 12,
  background: "rgba(255,255,255,0.015)",
  border: "1px solid rgba(255,255,255,0.035)",
  transition: `all 0.2s ${EASE}`,
  cursor: "default",
};

export const grid = (cols: number, gap = 12): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: `repeat(${cols}, 1fr)`,
  gap,
});

export const dropShadow = (color: string, blur = 6) =>
  `drop-shadow(0 0 ${blur}px ${color})`;
