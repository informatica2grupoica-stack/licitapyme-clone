// Tema Mantine con la MISMA fuente del sistema que el resto de la app (para que cuadren).
import { createTheme } from '@mantine/core';

const SISTEMA = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const theme = createTheme({
  primaryColor: 'indigo',
  primaryShade: { light: 6, dark: 5 },
  fontFamily: SISTEMA,
  fontFamilyMonospace: 'var(--font-geist-mono), ui-monospace, monospace',
  headings: { fontFamily: SISTEMA, fontWeight: '700' },
  defaultRadius: 'md',
  cursorType: 'pointer',
});
