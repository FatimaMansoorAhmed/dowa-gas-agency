import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B2138",
        paper: "#F5F3EE",
        panel: "#FFFFFF",
        teal: "#0F8B8D",
        tealdeep: "#0B6567",
        brand: {
          red: "#C8102E",
          green: "#1E8A5F",
          amber: "#D98E04",
        },
        steel: "#5B6B76",
        hairline: "#DFDCD2",
      },
      fontFamily: {
        display: ["var(--font-space-grotesk)", "sans-serif"],
        body: ["var(--font-ibm-plex-sans)", "sans-serif"],
        mono: ["var(--font-ibm-plex-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
