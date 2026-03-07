export function LobsterIcon({ size = 24 }: { size?: number; color?: string }) {
  return (
    <img
      src="/icon.png"
      alt=""
      width={size}
      height={size}
      style={{ objectFit: "contain", display: "block" }}
      draggable={false}
    />
  );
}
