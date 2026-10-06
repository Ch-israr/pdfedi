import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dbe7fe",
          500: "#2f6bff",
          600: "#2456d6",
          700: "#1d45ad",
        },
      },
    },
  },
  plugins: [],
};
export default config;
