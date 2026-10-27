'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeWorkspaces,
  createWorkspace,
  renameWorkspace,
  removeWorkspace,
  workspaceForTab,
  publicWorkspaceState,
  persistWorkspaceState
} = require('../src/workspace-model.cjs');

const defaults = [
  { id: 'personal', name: 'Personal' },
  { id: 'work', name: 'Work' }
];

test('normalization falls back for missing, malformed, and unusable JSON', () => {
  assert.deepEqual(normalizeWorkspaces(undefined), defaults);
  assert.deepEqual(normalizeWorkspaces('{broken'), defaults);
  assert.deepEqual(normalizeWorkspaces('{"workspaces":[]}'), defaults);
});

test('normalization sanitizes records and excludes private and prototype ids', () => {
  const normalized = normalizeWorkspaces(JSON.stringify([
    { id: 'home', name: '  Home  ' },
    { id: 'private', name: 'Private' },
    { id: '__proto__', name: 'Prototype' },
    { id: 'constructor', name: 'Constructor' },
    { id: 'home', name: 'Duplicate' },
    { id: 42, name: 'Wrong id type' },
    { id: 'notes', name: '  Notes  ' }
  ]));

  assert.deepEqual(normalized, [
    { id: 'home', name: 'Home' },
    { id: 'notes', name: 'Notes' }
  ]);
});

test('normalization accepts a workspace envelope and bounds names and count', () => {
  const raw = Array.from({ length: 25 }, (_, index) => ({
    id: `space-${index}`,
    name: index === 0 ? 'x'.repeat(100) : `Space ${index}`
  }));
  const normalized = normalizeWorkspaces({ workspaces: raw });

  assert.equal(normalized.length, 20);
  assert.equal(normalized[0].name.length, 64);
  assert.equal(normalized[19].id, 'space-19');
});

test('workspace creation is immutable and rejects invalid, duplicate, and over-limit input', () => {
  const current = [...defaults];
  const created = createWorkspace(current, '  Research  ', 'research');
  assert.deepEqual(created, [...defaults, { id: 'research', name: 'Research' }]);
  assert.notEqual(created, current);
  assert.deepEqual(current, defaults);

  assert.equal(createWorkspace(current, '', 'new-space'), current);
  assert.equal(createWorkspace(current, 'New space', 'private'), current);
  assert.equal(createWorkspace(current, 'New space', 'constructor'), current);
  assert.equal(createWorkspace(current, 'New space', 'work'), current);
  assert.equal(createWorkspace(current, 'x'.repeat(65), 'large-name'), current);

  const full = Array.from({ length: 20 }, (_, index) => ({ id: `id-${index}`, name: `Name ${index}` }));
  assert.equal(createWorkspace(full, 'Extra', 'extra'), full);
});

test('rename and removal return new sanitized arrays only for valid operations', () => {
  const current = [...defaults];
  const renamed = renameWorkspace(current, 'work', '  Projects  ');
  assert.deepEqual(renamed, [defaults[0], { id: 'work', name: 'Projects' }]);
  assert.notEqual(renamed, current);
  assert.equal(renameWorkspace(current, 'private', 'Private'), current);
  assert.equal(renameWorkspace(current, 'missing', 'Missing'), current);
  assert.equal(renameWorkspace(current, 'work', '  '), current);

  const removed = removeWorkspace(current, 'work');
  assert.deepEqual(removed, [defaults[0]]);
  assert.notEqual(removed, current);
  assert.equal(removeWorkspace(removed, 'personal'), removed, 'the final normal workspace is retained');
  assert.equal(removeWorkspace(current, 'private'), current);
});

test('normal tabs with a private or invalid workspace id fall back to a normal workspace', () => {
  const workspaces = [...defaults];

  assert.equal(workspaceForTab({ workspaceId: 'private' }, workspaces, 'work'), 'work');
  assert.equal(workspaceForTab({ workspaceId: '__proto__' }, workspaces, 'personal'), 'personal');
  assert.equal(workspaceForTab({ private: 'true', workspaceId: 'work' }, workspaces, 'personal'), 'work');
  assert.equal(workspaceForTab({ workspaceId: 'missing' }, workspaces, 'missing'), 'personal');
  assert.equal(workspaceForTab({ private: true, workspaceId: 'work' }, workspaces, 'personal'), 'private');
});

test('public state exposes workspace names and tab counts without tab data', () => {
  const tabs = [
    { id: 'n1', url: 'https://normal.example', workspaceId: 'work' },
    { id: 'n2', url: 'https://normal.example/2', workspaceId: 'private' },
    { id: 'p1', url: 'https://private.example', private: true, title: 'Secret title' }
  ];
  const state = publicWorkspaceState(defaults, 'private', tabs);

  assert.deepEqual(state, {
    items: [
      ...defaults,
      { id: 'private', name: '', private: true }
    ],
    activeId: 'private',
    counts: { personal: 1, work: 1, private: 1 }
  });
  assert.equal(JSON.stringify(state).includes('https://'), false);
  assert.equal(JSON.stringify(state).includes('Secret title'), false);
});

test('persistence keeps only normal workspace records and falls back from private selection', () => {
  const persisted = persistWorkspaceState([
    ...defaults,
    { id: 'private', name: 'Secret' },
    { id: '__proto__', name: 'Prototype' }
  ], 'private');

  assert.deepEqual(persisted, {
    workspaces: defaults,
    activeId: 'personal'
  });
  assert.equal(JSON.stringify(persisted).includes('private'), false);
  assert.equal(JSON.stringify(persisted).includes('url'), false);
});
