/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./sidepanel.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        background: '#09090b', // zinc-950
        foreground: '#fafafa', // zinc-50
        card: '#18181b', // zinc-900
        'card-foreground': '#fafafa',
        popover: '#18181b',
        'popover-foreground': '#fafafa',
        primary: {
          DEFAULT: '#fafafa',
          foreground: '#18181b',
        },
        secondary: {
          DEFAULT: '#27272a', // zinc-800
          foreground: '#fafafa',
        },
        muted: {
          DEFAULT: '#27272a',
          foreground: '#a1a1aa', // zinc-400
        },
        accent: {
          DEFAULT: '#27272a',
          foreground: '#fafafa',
        },
        destructive: {
          DEFAULT: '#ef4444',
          foreground: '#fafafa',
        },
        border: '#27272a', // zinc-800
        input: '#27272a',
        ring: '#d4d4d8', // zinc-300
      }
    },
  },
  plugins: [],
}
