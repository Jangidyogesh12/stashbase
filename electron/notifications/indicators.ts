import path from 'node:path';
import type { App, BrowserWindow, Menu, MenuItemConstructorOptions, NativeImage, Tray } from 'electron';

/** Host-owned presentation. Producers supply ordered sections and live actions;
 * the native renderer knows neither session state nor scheduling rules. */
export interface IndicatorSection {
  id: string;
  title: string;
  items: { id: string; label: string; open(): void }[];
}
export interface IndicatorSnapshot {
  unread: number;
  working: number;
  waiting: number;
  sections: IndicatorSection[];
}
export interface DesktopIndicators { update(snapshot: IndicatorSnapshot): void; dispose(): void }
interface Dependencies {
  platform: NodeJS.Platform;
  app: Pick<App, 'setBadgeCount' | 'quit'>;
  Tray: typeof Tray;
  Menu: Pick<typeof Menu, 'buildFromTemplate'>;
  image(file: string): NativeImage;
  iconDirectory: string;
  windows(): Pick<BrowserWindow, 'setOverlayIcon' | 'isDestroyed'>[];
  openApp(): void;
  report(error: unknown): void;
}
const empty = (): IndicatorSnapshot => ({ unread: 0, working: 0, waiting: 0, sections: [] });

export function createDesktopIndicators(deps: Dependencies): DesktopIndicators {
  const template = deps.platform === 'darwin';
  const images = new Map<string, NativeImage>();
  for (const state of ['idle', 'working', 'attention']) {
    const image = deps.image(path.join(deps.iconDirectory, `${state}${template ? 'Template' : ''}.png`));
    if (template) image.setTemplateImage(true);
    images.set(state, image);
  }
  const badge = deps.image(path.join(deps.iconDirectory, 'badge.png'));
  let snapshot = empty();
  let tray: Tray | null = null;
  let fingerprint = '';
  let disposed = false;
  const attempt = (operation: () => void) => { try { operation(); } catch (error) { deps.report(error); } };
  try { tray = new deps.Tray(images.get('idle')!); } catch (error) { deps.report(error); }
  // macOS opens the context menu on click; Windows/Linux activation opens the app.
  if (deps.platform !== 'darwin') tray?.on('click', () => deps.openApp());
  const clean = (value: string) => {
    const label = value.replace(/[\r\n\t]/g, ' ').slice(0, 150);
    return deps.platform === 'win32' ? label.replace(/&/g, '&&') : label;
  };
  function update(next: IndicatorSnapshot) {
    if (disposed) return;
    snapshot = next;
    const running = next.working + next.waiting;
    const summary = [running ? `${running} running` : '', next.waiting ? `${next.waiting} waiting for confirmation` : '', next.unread ? `${next.unread} to review` : ''].filter(Boolean).join(' · ') || 'No running sessions';
    attempt(() => {
      if (deps.platform === 'win32') {
        for (const win of deps.windows()) if (!win.isDestroyed()) win.setOverlayIcon(next.unread ? badge : null, next.unread ? 'Notifications to review' : '');
      } else if (deps.platform === 'darwin') deps.app.setBadgeCount(next.unread ? undefined : 0);
      else deps.app.setBadgeCount(next.unread);
    });
    const key = JSON.stringify([summary, next.sections]);
    if (key === fingerprint || !tray) return;
    fingerprint = key;
    const sections: MenuItemConstructorOptions[] = next.sections.filter((section) => section.items.length).flatMap((section) => [
      { type: 'separator' },
      { label: clean(section.title), enabled: false },
      ...section.items.slice(0, 12).map((item) => ({
        label: clean(item.label),
        click: () => snapshot.sections.find((current) => current.id === section.id)?.items.find((current) => current.id === item.id)?.open(),
      })),
      ...(section.items.length > 12 ? [{ label: `Show ${section.items.length - 12} more…`, click: deps.openApp }] : []),
    ]);
    attempt(() => {
      tray!.setImage(images.get(next.waiting || next.unread ? 'attention' : next.working ? 'working' : 'idle')!);
      tray!.setToolTip(`StashBase — ${summary}`);
      tray!.setContextMenu(deps.Menu.buildFromTemplate([
        { label: 'Open StashBase', click: deps.openApp },
        ...sections,
        ...(!sections.length ? [{ type: 'separator' as const }, { label: 'No running sessions', enabled: false }] : []),
        { type: 'separator' },
        { label: 'Quit StashBase', click: () => deps.app.quit() },
      ]));
    });
  }
  update(snapshot);
  return {
    update,
    dispose() {
      if (disposed) return;
      update(empty());
      disposed = true;
      attempt(() => tray?.destroy());
      tray = null;
    },
  };
}
