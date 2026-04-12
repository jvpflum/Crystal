import { getCurrentWindow } from "@tauri-apps/api/window";

const EDGE = 6;
const CORNER = 12;

const directions = [
  { dir: "North",     style: { top: 0, left: CORNER, right: CORNER, height: EDGE, cursor: "n-resize" } },
  { dir: "South",     style: { bottom: 0, left: CORNER, right: CORNER, height: EDGE, cursor: "s-resize" } },
  { dir: "West",      style: { left: 0, top: CORNER, bottom: CORNER, width: EDGE, cursor: "w-resize" } },
  { dir: "East",      style: { right: 0, top: CORNER, bottom: CORNER, width: EDGE, cursor: "e-resize" } },
  { dir: "NorthWest", style: { top: 0, left: 0, width: CORNER, height: CORNER, cursor: "nw-resize" } },
  { dir: "NorthEast", style: { top: 0, right: 0, width: CORNER, height: CORNER, cursor: "ne-resize" } },
  { dir: "SouthWest", style: { bottom: 0, left: 0, width: CORNER, height: CORNER, cursor: "sw-resize" } },
  { dir: "SouthEast", style: { bottom: 0, right: 0, width: CORNER, height: CORNER, cursor: "se-resize" } },
] as const;

export function ResizeHandles() {
  const appWindow = getCurrentWindow();

  return (
    <>
      {directions.map(({ dir, style }) => (
        <div
          key={dir}
          onMouseDown={(e) => {
            e.preventDefault();
            appWindow.startResizeDragging(dir);
          }}
          style={{
            position: "fixed",
            zIndex: 9999,
            background: "transparent",
            ...style,
          }}
        />
      ))}
    </>
  );
}
