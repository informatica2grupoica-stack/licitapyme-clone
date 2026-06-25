// PostCSS: Mantine (preset + breakpoints como vars) + Tailwind 4.
// El orden importa: los presets de Mantine van antes de Tailwind.
// Las clases de Mantine van SIN capa (cascade layer), así ganan sobre el preflight
// de Tailwind (que va en @layer base) y los componentes de Mantine se ven correctos.
const config = {
  plugins: {
    'postcss-preset-mantine': {},
    'postcss-simple-vars': {
      variables: {
        'mantine-breakpoint-xs': '36em',
        'mantine-breakpoint-sm': '48em',
        'mantine-breakpoint-md': '62em',
        'mantine-breakpoint-lg': '75em',
        'mantine-breakpoint-xl': '88em',
      },
    },
    '@tailwindcss/postcss': {},
  },
};

export default config;
