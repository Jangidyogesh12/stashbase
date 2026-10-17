const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { createNotificationCenter } = require('../../dist/electron/notifications/center.cjs');

const item = (id, title = 'Notice') => ({ id, delivery: 'pending', content: { title, body: 'A pending operation' } });
function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const notices = [], activations = [], delivery = [];
  const center = createNotificationCenter({
    canNotify: () => true, isForeground: () => false,
    create(content) {
      const notice = new EventEmitter();
      Object.assign(notice, { content, closed: false, show() { this.emit('show'); }, close() { this.closed = true; } });
      notices.push(notice); return notice;
    },
    activate: (...args) => activations.push(args),
    delivery: (value) => delivery.push(value),
    unreadChanged: () => {},
  });
  t.after(() => center.dispose());
  return { center, notices, activations, delivery, tick: () => t.mock.timers.tick(350) };
}

test('independent producers can reuse IDs and retract only their own snapshot', (t) => {
  const h = fixture(t);
  h.center.sync('window', 'agent-confirmation', [item('same', 'Agent')]);
  // A second synthetic producer proves extension without registering a fake
  // production feature, wire command, or OS-specific implementation.
  h.center.sync('window', 'download-result', [item('same', 'Download')]);
  h.tick(); assert.equal(h.notices.length, 2);
  h.center.sync('window', 'agent-confirmation', []);
  assert.equal(h.notices[0].closed, true);
  assert.equal(h.notices[1].closed, false);
  h.notices[0].emit('click'); h.notices[1].emit('click');
  assert.deepEqual(h.activations, [['window', 'download-result', 'same']]);
  h.center.refresh(); h.tick();
  assert.equal(h.notices.length, 2);
});

test('owner retirement revokes every category, timer, and late native event', (t) => {
  const h = fixture(t);
  h.center.sync('window', 'first', [item('one')]); h.tick();
  h.center.sync('window', 'second', [item('two')]);
  h.center.remove('window');
  h.notices[0].emit('click'); h.notices[0].emit('failed'); h.tick();
  assert.equal(h.notices.length, 1);
  assert.deepEqual(h.activations, []);
  assert.deepEqual(h.delivery, ['sent']);
});

test('native close failure revokes clicks and preserves other producers', (t) => {
  const h = fixture(t);
  h.center.sync('window', 'first', [item('one')]); h.tick();
  h.notices[0].close = () => { throw new Error('native dismissal failed'); };
  h.center.sync('window', 'first', []);
  h.notices[0].emit('click');
  h.center.sync('window', 'second', [item('two')]); h.tick();
  h.notices[1].emit('click');
  assert.deepEqual(h.activations, [['window', 'second', 'two']]);
  assert.ok(h.delivery.includes('failed'));
});
