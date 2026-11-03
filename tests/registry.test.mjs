import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseJsonStrict,
  validateCatalog,
  validatePublisherCatalog,
  validatePublisherRegistry,
} from '../scripts/validate.mjs';
import { validateReleaseFragment } from '../scripts/verify-release.mjs';

function catalogEntry(overrides = {}) {
  return {
    id: 'official.fixture',
    tier: 'official',
    official: true,
    version: '0.1.0',
    title: 'Fixture',
    description: '',
    source: { type: 'github-release', repository: 'owner/fixture' },
    ...overrides,
  };
}

function registry(overrides = {}) {
  return {
    schemaVersion: 2,
    publishers: {
      'owner/fixture': { id: 'official.fixture', tier: 'official' },
    },
    ...overrides,
  };
}

test('registry v2 accepts all publisher tiers and catalog uses the official projection', () => {
  for (const [index, tier] of ['platform', 'official', 'community'].entries()) {
    const id = tier === 'community' ? 'community.fixture' : 'official.fixture';
    const repository = 'owner/fixture' + index;
    const publisherRegistry = {
      schemaVersion: 2,
      publishers: { [repository]: { id, tier } },
    };
    const catalog = {
      schemaVersion: 1,
      plugins: [catalogEntry({ id, tier, official: tier !== 'community', source: { type: 'github-release', repository } })],
    };
    assert.doesNotThrow(() => validatePublisherCatalog(catalog, publisherRegistry));
  }
});

test('registry v2 rejects the legacy map, duplicate IDs, duplicate repositories and invalid tiers', () => {
  assert.throws(() => validatePublisherRegistry({ 'owner/fixture': 'official.fixture' }), /registry/);
  assert.throws(() => validatePublisherRegistry({
    schemaVersion: 2,
    publishers: {
      'owner/one': { id: 'official.same', tier: 'official' },
      'owner/two': { id: 'official.same', tier: 'platform' },
    },
  }), /Duplicate publisher ID/);
  assert.throws(() => validatePublisherRegistry({
    schemaVersion: 2,
    publishers: {
      'owner/fixture': { id: 'official.one', tier: 'official' },
      'Owner/Fixture': { id: 'official.two', tier: 'official' },
    },
  }), /Duplicate publisher repository/);
  assert.throws(() => validatePublisherRegistry({
    schemaVersion: 2,
    publishers: { 'owner/fixture': { id: 'official.fixture', tier: 'trusted' } },
  }), /tier/);
  assert.throws(() => validatePublisherRegistry({
    schemaVersion: 2,
    publishers: { 'owner/fixture': { id: 'official.fixture', tier: 'official', extra: true } },
  }), /registry/);
  assert.throws(() => validatePublisherRegistry({
    schemaVersion: 2,
    publishers: {},
    extra: true,
  }), /registry/);
});

test('strict JSON parsing rejects duplicate registry repositories before object keys collapse', () => {
  const duplicateRepository = '{"schemaVersion":2,"publishers":{"owner/fixture":{"id":"official.one","tier":"official"},"owner/fixture":{"id":"official.two","tier":"official"}}}';
  assert.throws(() => parseJsonStrict(duplicateRepository, 'publishers.json'), /duplicate key "owner\/fixture"/);
});

test('catalog requires exact repository, ID and tier registry matches', () => {
  assert.doesNotThrow(() => validatePublisherCatalog({ schemaVersion: 1, plugins: [catalogEntry()] }, registry()));
  assert.throws(() => validatePublisherCatalog({
    schemaVersion: 1,
    plugins: [catalogEntry({ source: { type: 'github-release', repository: 'owner/other' } })],
  }, registry()), /not registered/);
  assert.throws(() => validatePublisherCatalog({
    schemaVersion: 1,
    plugins: [catalogEntry()],
  }, {
    schemaVersion: 2,
    publishers: { 'owner/fixture': { id: 'official.other', tier: 'official' } },
  }), /identity mismatch/);
  assert.throws(() => validatePublisherCatalog({
    schemaVersion: 1,
    plugins: [catalogEntry({ tier: 'platform' })],
  }, registry()), /tier mismatch/);
});

test('catalog official projection must equal tier !== community', () => {
  assert.throws(() => validateCatalog({
    schemaVersion: 1,
    plugins: [catalogEntry({ official: false })],
  }), /plugin entry/);
  assert.throws(() => validateCatalog({
    schemaVersion: 1,
    plugins: [catalogEntry({ tier: 'community', official: true })],
  }), /plugin entry/);
  assert.doesNotThrow(() => validateCatalog({
    schemaVersion: 1,
    plugins: [catalogEntry({ id: 'community.fixture', tier: 'community', official: false })],
  }));
});

test('release fragments reject trust and unknown fields', () => {
  const descriptor = {
    schemaVersion: 1,
    plugins: [{
      id: 'official.fixture',
      version: '0.2.0',
      title: 'Fixture',
      description: '',
      category: 'Tools',
      api: '^1.10.0',
      releaseNotes: '',
      icon: 'data:image/png;base64,iVBORw0KGgo=',
      artifacts: {},
    }],
  };
  assert.equal(validateReleaseFragment(descriptor, { id: 'official.fixture', version: '0.2.0' }).version, '0.2.0');
  for (const [field, value] of Object.entries({
    tier: 'platform',
    official: true,
    source: { type: 'github-release', repository: 'owner/fixture' },
    stats: { downloads: 1 },
    verification: 'github-release',
    unexpected: true,
  })) {
    assert.throws(
      () => validateReleaseFragment({ schemaVersion: 1, plugins: [{ ...descriptor.plugins[0], [field]: value }] }, { id: 'official.fixture', version: '0.2.0' }),
      new RegExp(field),
    );
  }
  assert.throws(
    () => validateReleaseFragment(descriptor, { id: 'official.other', version: '0.2.0' }),
    /identity mismatch/,
  );
});
