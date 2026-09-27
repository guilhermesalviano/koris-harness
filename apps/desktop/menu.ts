import { Menu, type MenuItemConstructorOptions } from 'electron';

/**
 * Minimal window menu built entirely from Electron's standard roles so
 * copy/paste, reload, devtools, zoom and window controls behave natively.
 * The richer application menu (New chat, Settings, Providers, Skills,
 * Check for updates, ...) is deferred — see features/native-menu.ts.
 */
export function applyMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
