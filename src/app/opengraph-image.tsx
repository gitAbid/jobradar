import { ImageResponse } from "next/og";

export const alt = "JobRadar — your personal job search radar";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "#0f2a43", color: "#ffffff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <svg width="96" height="96" viewBox="0 0 64 64" fill="none">
            <circle cx="32" cy="32" r="21" stroke="#35b99a" strokeWidth="3" opacity="0.4" />
            <circle cx="32" cy="32" r="12" stroke="#35b99a" strokeWidth="3" opacity="0.75" />
            <path d="M32 32 49 17" stroke="#70d8bd" strokeWidth="4" strokeLinecap="round" />
            <circle cx="32" cy="32" r="4" fill="#70d8bd" />
            <circle cx="46" cy="40" r="3.5" fill="#f98c70" />
          </svg>
          <div style={{ fontSize: 72, fontWeight: 700 }}>JobRadar</div>
        </div>
        <div style={{ marginTop: 40, fontSize: 44, color: "#a9ebd8" }}>Your personal job search radar.</div>
        <div style={{ marginTop: 16, fontSize: 30, color: "#9aa8b5" }}>Gather, filter, save and track the openings that fit your next move.</div>
      </div>
    ),
    size,
  );
}
