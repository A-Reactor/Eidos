/** Fixed names let author surfaces share the host theme without granting access to host styles or settings. */
export const THEME_SDK = `
 const applyTheme = theme => {
  if (!theme || !['light', 'dark'].includes(theme.mode)) return;
  const root = document.documentElement;
  root.dataset.theme = theme.mode; root.style.colorScheme = theme.mode;
  if (typeof theme.fontSize === 'number' && Number.isFinite(theme.fontSize) && theme.fontSize >= 10 && theme.fontSize <= 40) root.style.fontSize = theme.fontSize + 'px';
  root.dataset.motion = theme.reducedMotion === true ? 'reduced' : 'full';
  const tokens = { background: '--eidos-paper', surface: '--eidos-surface', ink: '--eidos-ink', accent: '--eidos-accent', fontSans: '--font-geist-sans', fontMono: '--font-geist-mono' };
  for (const [key, name] of Object.entries(tokens)) {
   const value = theme[key];
   if (typeof value === 'string' && value.length > 0 && value.length <= 1024) root.style.setProperty(name, value);
  }
 };
`;
