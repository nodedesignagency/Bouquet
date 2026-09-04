import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0b0a0c",
          900: "#141216",
          800: "#1d1a20",
          700: "#2a262e",
          600: "#3b3541",
          400: "#8a8291",
          200: "#cfc8d4",
        },
        petal: {
          500: "#d9799a",
          400: "#e592ae",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
