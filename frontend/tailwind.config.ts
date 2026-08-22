import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Font sizes sizing up for better readability across app
      fontSize: {
        "2xs": ["11.5px", "16px"],
        xs: ["13px", "18px"], // Default 12px -> 13px
        sm: ["15px", "22px"], // Default 14px -> 15px
        base: ["16.5px", "26px"], // Default 16px -> 16.5px
        lg: ["19px", "28px"], // Default 18px -> 19px
        xl: ["22px", "32px"], // Default 20px -> 22px
        "2xl": ["26px", "36px"],
        "3xl": ["32px", "40px"],
      },
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
        // Darker readable shades for better text visibility
        steel: "#2D3748",
        mutedDark: "#1E293B",
        hairline: "#C5C1B4",
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