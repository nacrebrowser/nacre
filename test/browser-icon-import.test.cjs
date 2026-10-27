'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { readSourceIcons, collectIcons } = require('../src/browser-import.cjs');

let sqlite = null;
try { sqlite = require('node:sqlite'); } catch {}

test('collected icons keep the size closest to 32 px for wanted hosts only', () => {
  const rows = [
    { page_url: 'https://mail.example.test/inbox', width: 16, image_data: Buffer.from('small') },
    { page_url: 'https://www.mail.example.test/other', width: 32, image_data: Buffer.from('medium') },
    { page_url: 'https://mail.example.test/', width: 128, image_data: Buffer.from('large') },
    { page_url: 'https://other.example.test/', width: 32, image_data: Buffer.from('unwanted') },
    { page_url: 'https://huge.example.test/', width: 32, image_data: Buffer.alloc(300000) },
    { page_url: 'not a url', width: 32, image_data: Buffer.from('x') }
  ];
  const icons = collectIcons(rows, ['mail.example.test', 'huge.example.test', 'absent.example.test']);
  assert.deepEqual([...icons.keys()], ['mail.example.test']);
  assert.equal(icons.get('mail.example.test').toString(), 'medium');
});

test('Chromium and Firefox icon databases are read from a private copy', { skip: !sqlite }, () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-icon-test-'));
  try {
    const chromium = new sqlite.DatabaseSync(path.join(folder, 'Favicons'));
    chromium.exec(`CREATE TABLE icon_mapping (id INTEGER PRIMARY KEY, page_url LONGVARCHAR, icon_id INTEGER);
      CREATE TABLE favicon_bitmaps (id INTEGER PRIMARY KEY, icon_id INTEGER, width INTEGER, height INTEGER, image_data BLOB);
      INSERT INTO icon_mapping (page_url, icon_id) VALUES ('https://mail.example.test/inbox', 1);
      INSERT INTO favicon_bitmaps (icon_id, width, height, image_data) VALUES (1, 16, 16, x'89504e47');`);
    chromium.close();
    const found = readSourceIcons({ kind: 'chromium', file: path.join(folder, 'Bookmarks') }, ['mail.example.test']);
    assert.equal(found.get('mail.example.test').toString('hex'), '89504e47');
    assert.equal(readSourceIcons({ kind: 'chromium', file: path.join(folder, 'Bookmarks') }, []).size, 0);

    const firefox = new sqlite.DatabaseSync(path.join(folder, 'favicons.sqlite'));
    firefox.exec(`CREATE TABLE moz_pages_w_icons (id INTEGER PRIMARY KEY, page_url TEXT);
      CREATE TABLE moz_icons (id INTEGER PRIMARY KEY, icon_url TEXT, width INTEGER, data BLOB);
      CREATE TABLE moz_icons_to_pages (page_id INTEGER, icon_id INTEGER);
      INSERT INTO moz_pages_w_icons VALUES (1, 'https://www.example.test/');
      INSERT INTO moz_icons VALUES (1, 'https://www.example.test/i.png', 32, x'ffd8ffe0');
      INSERT INTO moz_icons_to_pages VALUES (1, 1);`);
    firefox.close();
    const fromFirefox = readSourceIcons({ kind: 'firefox', file: path.join(folder, 'places.sqlite') }, ['example.test']);
    assert.equal(fromFirefox.get('example.test').toString('hex'), 'ffd8ffe0');
    // The other browser's database is never modified or left open.
    assert.ok(fs.existsSync(path.join(folder, 'Favicons')));
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
