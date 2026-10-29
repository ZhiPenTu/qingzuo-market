import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCatalogDownloads, sumReleaseDownloads } from '../scripts/update-downloads.mjs';
import { validateCatalog } from '../scripts/validate.mjs';

function release(tag, assets, overrides = {}) {
  return { tag_name: tag, draft: false, prerelease: false, assets, ...overrides };
}

function asset(name, downloadCount) {
  return { name, download_count: downloadCount };
}

test('download totals include every stable release for both exact plugin artifacts', () => {
  const releases = [
    release('v0.1.0', [
      asset('official.fixture-0.1.0-darwin-arm64.ecplugin', 10),
      asset('official.fixture-0.1.0-win32-x64.ecplugin', 20),
      asset('catalog-darwin-arm64.json', 1000),
    ]),
    release('v0.2.0', [
      asset('official.fixture-0.2.0-darwin-arm64.ecplugin', 7),
      asset('official.other-0.2.0-darwin-arm64.ecplugin', 900),
      asset('official.fixture-0.2.0-linux-x64.ecplugin', 800),
    ]),
    release('v0.3.0', [asset('official.fixture-0.3.0-darwin-arm64.ecplugin', 500)], { draft: true }),
    release('v0.4.0', [asset('official.fixture-0.4.0-darwin-arm64.ecplugin', 600)], { prerelease: true }),
    release('nightly', [asset('official.fixture-0.5.0-darwin-arm64.ecplugin', 700)]),
  ];
  assert.equal(sumReleaseDownloads(releases, 'official.fixture'), 37);
});

test('download totals reject malformed GitHub counters instead of silently undercounting', () => {
  assert.throws(
    () => sumReleaseDownloads([release('v0.1.0', [asset('official.fixture-0.1.0-darwin-arm64.ecplugin', -1)])], 'official.fixture'),
    /Invalid download count/,
  );
});

test('catalog updates preserve release metadata and existing stats', () => {
  const catalog = {
    schemaVersion: 1,
    plugins: [
      { id: 'official.fixture', version: '0.1.0', title: 'Fixture', stats: { installs: 9 } },
      { id: 'official.unpublished', version: '0.1.0', title: 'Unpublished' },
    ],
  };
  const publishers = {
    'owner/fixture': 'official.fixture',
    'owner/unpublished': 'official.unpublished',
  };
  const releases = {
    'owner/fixture': [release('v0.1.0', [asset('official.fixture-0.1.0-darwin-arm64.ecplugin', 12)])],
    'owner/unpublished': [],
  };
  const next = applyCatalogDownloads(catalog, publishers, releases);
  assert.deepEqual(next.plugins[0].stats, { installs: 9, downloads: 12 });
  assert.deepEqual(next.plugins[1].stats, { downloads: 0 });
  assert.equal(catalog.plugins[0].stats.downloads, undefined);
});

test('catalog validation accepts optional download stats and rejects invalid values', () => {
  const artifact = {
    size: 1,
    sha256: 'a'.repeat(64),
    signature: 'A'.repeat(86) + '==',
    url: 'https://example.com/plugin.ecplugin',
  };
  const entry = {
    id: 'official.fixture',
    version: '0.1.0',
    title: 'Fixture',
    description: '',
    api: '^1.0.0',
    releaseNotes: '',
    artifacts: { 'darwin-arm64': artifact, 'win32-x64': artifact },
  };
  assert.doesNotThrow(() => validateCatalog({ schemaVersion: 1, plugins: [{ ...entry, stats: { downloads: 31_000 } }] }));
  for (const downloads of [-1, 1.5, '31K', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateCatalog({ schemaVersion: 1, plugins: [{ ...entry, stats: { downloads } }] }));
  }
});
