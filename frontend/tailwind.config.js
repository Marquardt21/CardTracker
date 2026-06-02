/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        navy: { 900: "#0D1B2A", 800: "#1A2E45" },
        ice: "#A8DADC",
      },
    },
  },
  plugins: [],
}

