import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Dark theme background range (#050510 to #0a0a1a)
        background: {
          DEFAULT: "#050510",
          deep: "#050510",
          mid: "#070714",
          surface: "#0a0a1a",
        },
        // Single accent color: electric cyan (#00d4ff)
        accent: {
          DEFAULT: "#00d4ff",
          dim: "rgba(0, 212, 255, 0.5)",
          subtle: "rgba(0, 212, 255, 0.15)",
        },
        // Foreground / text
        foreground: {
          DEFAULT: "#e2e8f0",
          muted: "#94a3b8",
          dim: "#64748b",
        },
        // Semantic colors for existing UI components
        primary: {
          DEFAULT: "#00d4ff",
          foreground: "#050510",
        },
        muted: {
          DEFAULT: "rgba(10, 10, 26, 0.6)",
          foreground: "#94a3b8",
        },
        card: {
          DEFAULT: "rgba(10, 10, 26, 0.8)",
          foreground: "#e2e8f0",
        },
        // Border
        border: {
          DEFAULT: "rgba(0, 212, 255, 0.1)",
          hover: "rgba(0, 212, 255, 0.2)",
          active: "rgba(0, 212, 255, 0.3)",
        },
        // Status colors
        destructive: {
          DEFAULT: "#ef4444",
        },
        success: "#22c55e",
        warning: "#eab308",
        ring: "#00d4ff",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      letterSpacing: {
        display: "-0.02em",
      },
      boxShadow: {
        glow: "0 0 15px rgba(0, 212, 255, 0.3), 0 0 30px rgba(0, 212, 255, 0.1)",
        "glow-sm": "0 0 8px rgba(0, 212, 255, 0.2), 0 0 15px rgba(0, 212, 255, 0.05)",
        "glow-lg": "0 0 25px rgba(0, 212, 255, 0.4), 0 0 50px rgba(0, 212, 255, 0.15)",
        "glow-inner": "inset 0 0 15px rgba(0, 212, 255, 0.1)",
      },
      backdropBlur: {
        glass: "12px",
      },
      animation: {
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "fade-in": "fade-in 0.5s ease-out",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 15px rgba(0, 212, 255, 0.3)" },
          "50%": { boxShadow: "0 0 25px rgba(0, 212, 255, 0.5)" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
