import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "UHA Legal Client Portal",
    short_name: "UHA Legal",
    description: "Send visa documents to your caseworker securely.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#262626",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
