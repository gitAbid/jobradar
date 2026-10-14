import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f2a43" }}>
        <svg width="132" height="132" viewBox="0 0 64 64" fill="none">
          <circle cx="32" cy="32" r="21" stroke="#35b99a" strokeWidth="3" opacity="0.4" />
          <circle cx="32" cy="32" r="12" stroke="#35b99a" strokeWidth="3" opacity="0.75" />
          <path d="M32 32 49 17" stroke="#70d8bd" strokeWidth="4" strokeLinecap="round" />
          <circle cx="32" cy="32" r="4" fill="#70d8bd" />
          <circle cx="46" cy="40" r="3.5" fill="#f98c70" />
        </svg>
      </div>
    ),
    size,
  );
}
