import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        vdx: {
          plum: "#3B1A3E",
          coral: "#E8566D",
          cream: "#F5F0E8",
          "cream-dark": "#EDE7DC",
        }
      }
    }
  },
  plugins: []
};

export default config;
