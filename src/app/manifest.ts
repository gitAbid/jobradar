import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JobRadar",
    short_name: "JobRadar",
    description: "Gather, filter, save, and track the job openings that fit your next move.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1720",
    theme_color: "#0f2a43",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
