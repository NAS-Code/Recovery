import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#1E2A4A",
          accent: "#2F8F83",
          surface: "#F3F5F8",
          "surface-dark": "#E4E8EE",
        }
      }
    }
  },
  plugins: []
};

export default config;
