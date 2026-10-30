/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Atkinson Hyperlegible"', 'system-ui', 'sans-serif'] },
      colors: {
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        bg: 'rgb(var(--bg) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        panel2: 'rgb(var(--panel2) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        amber: 'rgb(var(--amber) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        ok: 'rgb(var(--ok) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
