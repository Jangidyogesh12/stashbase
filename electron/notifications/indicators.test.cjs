const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { createDesktopIndicators } = require('../../dist/electron/notifications/indicators.cjs');

for (const platform of ['darwin', 'win32', 'linux']) test(`${platform}: live session menu, badge clearing, and stale menu safety`, () => {
  let tray, menu, opens = 0;
  const badges = [], overlays = [], images = [];
  class NativeTray extends EventEmitter {
    constructor() { super(); tray = this; }
    setImage(image) { images.push(image.file); }
    setToolTip(value) { this.tip = value; }
    setContextMenu(value) { menu = value; }
    destroy() { this.destroyed = true; }
  }
  const indicators = createDesktopIndicators({ platform, Tray: NativeTray,
    app: { setBadgeCount: (count) => badges.push(count), quit() {} },
    Menu: { buildFromTemplate: (template) => template },
    image: (file) => ({ file, setTemplateImage() {} }), iconDirectory: '/icons',
    windows: () => [{ isDestroyed: () => false, setOverlayIcon: (...args) => overlays.push(args) }],
    openApp: () => {}, report: (error) => { throw error; },
  });
  const item = { id: 'one', label: 'Draft introduction', open: () => opens++ };
  const running = { id: 'running', title: 'Running', items: [item, { ...item, id: 'two', label: 'Revise outline' }] };
  indicators.update({ unread: 1, working: 1, waiting: 1, sections: [running] });
  assert.equal(menu[2].label, 'Running');
  assert.equal(menu[3].label, 'Draft introduction');
  assert.match(tray.tip, /2 running.*1 waiting/);
  assert.match(images.at(-1), /attention/);
  if (platform === 'win32') assert.match(overlays.at(-1)[0].file, /badge.png/);
  else assert.equal(badges.at(-1), platform === 'darwin' ? undefined : 1);
  const stale = menu[4].click;
  menu[3].click(); assert.equal(opens, 1);
  indicators.update({ unread: 0, working: 1, waiting: 0, sections: [{ ...running, items: [item] }] });
  stale(); assert.equal(opens, 1);
  assert.match(images.at(-1), /working/);
  if (platform === 'win32') assert.equal(overlays.at(-1)[0], null);
  else assert.equal(badges.at(-1), 0);
  // A second producer uses the same renderer without introducing task/schedule logic.
  const upcoming = { id: 'upcoming', title: 'Upcoming', items: [{ ...item, label: 'Weekly review · Tomorrow, 09:00', open: () => { opens += 10; } }] };
  indicators.update({ unread: 0, working: 1, waiting: 0, sections: [running, upcoming] });
  const scheduled = menu.find((row) => row.label?.startsWith('Weekly review'));
  scheduled.click(); assert.equal(opens, 11);
  // Identity includes the section; the same ID in Running cannot keep a removed task alive.
  indicators.update({ unread: 0, working: 1, waiting: 0, sections: [running, { ...upcoming, items: [] }] });
  scheduled.click(); assert.equal(opens, 11);
  assert.equal(menu.some((row) => row.label === 'Upcoming'), false);
  indicators.update({ unread: 0, working: 0, waiting: 0, sections: [] });
  assert.equal(menu.some((row) => row.label === 'Running'), false);
  assert.equal(menu.some((row) => row.label === 'No running chats'), true);
  indicators.dispose(); assert.equal(tray.destroyed, true);
  indicators.update({ unread: 2, working: 0, waiting: 0, sections: [] });
  assert.equal(badges.at(-1) ?? 0, 0);
});

test('missing Linux tray support does not prevent launcher badge updates', () => {
  const failures = [], badges = [];
  const indicators = createDesktopIndicators({ platform: 'linux',
    Tray: class { constructor() { throw new Error('No tray host'); } },
    app: { setBadgeCount: (value) => badges.push(value), quit() {} },
    Menu: { buildFromTemplate: () => { throw new Error('Should not build menu'); } },
    image: () => ({}), iconDirectory: '/icons', windows: () => [], openApp() {}, report: error => failures.push(error),
  });
  indicators.update({ unread: 2, working: 0, waiting: 0, sections: [] });
  assert.equal(badges.at(-1), 2);
  assert.equal(failures.length, 1);
  indicators.dispose();
});
