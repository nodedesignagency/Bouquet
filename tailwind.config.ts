import type { Config } from "tailwindcss";

/**
 * The palette is the studio the reference photographs were shot in: warm
 * seamless paper gone dark, kraft tan for anything you can act on, and a sage
 * that only ever marks a measurement.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bench: {
          900: "#141110",
          800: "#1b1715",
          700: "#221d1a",
          600: "#2c2521",
          500: "#3a312b",
          400: "#6b5f56",
          300: "#a2948a",
          200: "#d8cdc3",
          100: "#f2ebe4",
        },
        kraft: {
          DEFAULT: "#d7a05a",
          soft: "#e8c290",
          deep: "#a4713a",
        },
        sage: {
          DEFAULT: "#93a983",
          deep: "#5d6f51",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      letterSpacing: {
        label: "0.14em",
      },
    },
  },
  plugins: [],
};

export default config;
