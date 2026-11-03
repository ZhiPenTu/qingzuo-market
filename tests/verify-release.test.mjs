import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { validateReleaseFragment, verifyReleases } from '../scripts/verify-release.mjs';

const repository = 'ZhiPenTu/qingzuo-plugin-credentials';
const id = 'official.credentials';
const version = '0.1.0';
const tag = 'v0.1.0';

function packageBytes(entry, title) {
  const archive = new AdmZip();
  archive.addFile('package.json', Buffer.from(JSON.stringify({
    version,
    commerce: {
      manifestVersion: 1,
      id,
      title,
      description: entry.description,
      category: entry.category,
      api: entry.api,
      releaseNotes: entry.releaseNotes,
      ui: 'ui/index.html',
      permissions: {},
    },
  })));
  archive.addFile('ui/index.html', Buffer.from('<h1>Fixture</h1>'));
  return archive.toBuffer();
}

function releaseFixture(entry, titles = {}) {
  const urls = new Map();
  const assets = [];
  for (const platform of ['darwin-arm64', 'win32-x64']) {
    const title = titles[platform] ?? entry.title;
    const bytes = packageBytes(entry, title);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const artifactName = id + '-' + version + '-' + platform + '.ecplugin';
    const artifactUrl = 'https://github.com/' + repository + '/releases/download/' + tag + '/' + artifactName;
    assets.push({ name: artifactName, browser_download_url: artifactUrl, size: bytes.length, digest: 'sha256:' + sha256 });
    urls.set(artifactUrl, bytes);

    const fragmentName = 'catalog-' + platform + '.json';
    const fragmentUrl = 'https://github.com/' + repository + '/releases/download/' + tag + '/' + fragmentName;
    const fragment = {
      schemaVersion: 1,
      plugins: [{
        id,
        version,
        title,
        description: entry.description,
        category: entry.category,
        api: entry.api,
        releaseNotes: entry.releaseNotes,
        artifacts: { [platform]: { url: artifactUrl, size: bytes.length, sha256 } },
      }],
    };
    assets.push({ name: fragmentName, browser_download_url: fragmentUrl });
    urls.set(fragmentUrl, Buffer.from(JSON.stringify(fragment)));
  }
  return {
    release: { tag_name: tag, draft: false, prerelease: false, assets },
    urls,
  };
}

function fetchFixture(urls) {
  return async url => {
    const body = urls.get(url);
    if (!body) throw new Error('Unexpected URL: ' + url);
    return {
      ok: true,
      headers: { get: () => null },
      body: (async function* () {
        yield body;
      })(),
    };
  };
}

function interruptedResponse(bytes, total) {
  return {
    ok: true,
    status: 200,
    headers: { get: name => name === 'content-length' ? String(total) : null },
    body: (async function* () {
      yield bytes;
      throw new Error('socket closed');
    })(),
  };
}

function resumedResponse(bytes, start, total) {
  return {
    ok: true,
    status: 206,
    headers: {
      get: name => {
        if (name === 'content-range') return 'bytes ' + start + '-' + (total - 1) + '/' + total;
        if (name === 'content-length') return String(bytes.length);
        return null;
      },
    },
    body: (async function* () {
      yield bytes;
    })(),
  };
}

test('legacy release manifest fields are stripped and trust fields stay rejected', () => {
  const fragment = {
    schemaVersion: 1,
    plugins: [{
      id,
      version,
      title: 'Fixture',
      description: 'Fixture',
      manifestVersion: 1,
      ui: 'ui/index.html',
      permissions: { network: ['https://example.com'] },
      settings: { theme: 'light' },
      backend: { type: 'node', entry: 'backend/index.mjs' },
      services: { provides: ['fixture'] },
      artifacts: {},
    }],
  };
  const entry = validateReleaseFragment(fragment, { id, version });
  assert.equal(entry.id, id);
  for (const field of ['manifestVersion', 'ui', 'permissions', 'settings', 'backend', 'services']) {
    assert.equal(field in entry, false);
  }
  for (const field of ['tier', 'official', 'source', 'stats', 'verification']) {
    assert.throws(() => validateReleaseFragment({
      ...fragment,
      plugins: [{ ...fragment.plugins[0], [field]: true }],
    }, { id, version }), /cannot define/);
    assert.throws(() => validateReleaseFragment({
      ...fragment,
      [field]: true,
    }, { id, version }), /cannot define/);
  }
  assert.throws(() => validateReleaseFragment({
    ...fragment,
    plugins: [{
      ...fragment.plugins[0],
      artifacts: {
        'darwin-arm64': {
          url: 'https://github.com/' + repository + '/releases/download/' + tag + '/artifact.ecplugin',
          size: 1,
          sha256: 'a'.repeat(64),
          tier: 'platform',
        },
      },
    }],
  }, { id, version }), /cannot define/);
});

test('release fragment metadata matches catalog bounds', () => {
  const fragment = {
    schemaVersion: 1,
    plugins: [{
      id,
      version,
      title: 'Fixture',
      description: 'Fixture',
      artifacts: {},
    }],
  };
  for (const overrides of [
    { title: '   ' },
    { category: '   ' },
    { releaseNotes: 'x'.repeat(64001) },
    { api: 'not-a-range' },
  ]) {
    assert.throws(() => validateReleaseFragment({
      ...fragment,
      plugins: [{ ...fragment.plugins[0], ...overrides }],
    }, { id, version }), /metadata/);
  }
});

test('release verification checks both platform artifacts and matching metadata', async () => {
  const catalog = JSON.parse(await readFile('catalog.json', 'utf8'));
  const entry = catalog.plugins.find(plugin => plugin.id === id);
  const { release, urls } = releaseFixture(entry);
  const messages = [];
  await assert.doesNotReject(() => verifyReleases({
    requested: repository,
    tag,
    runCommand: () => JSON.stringify(release),
    fetchImpl: fetchFixture(urls),
    log: message => messages.push(message),
  }));
  assert.deepEqual(messages, [id + ' ' + tag + ': verified darwin-arm64 and win32-x64.']);
});

test('release verification resumes interrupted artifact downloads', async () => {
  const catalog = JSON.parse(await readFile('catalog.json', 'utf8'));
  const entry = catalog.plugins.find(plugin => plugin.id === id);
  const { release, urls } = releaseFixture(entry);
  const artifactName = id + '-' + version + '-darwin-arm64.ecplugin';
  const artifactUrl = 'https://github.com/' + repository + '/releases/download/' + tag + '/' + artifactName;
  const artifact = urls.get(artifactUrl);
  const split = Math.floor(artifact.length / 2);
  let attempts = 0;
  const fetchImpl = async (url, options = {}) => {
    if (url !== artifactUrl) return fetchFixture(urls)(url);
    attempts += 1;
    if (attempts === 1) return interruptedResponse(artifact.subarray(0, split), artifact.length);
    assert.equal(options.headers?.Range, 'bytes=' + split + '-');
    return resumedResponse(artifact.subarray(split), split, artifact.length);
  };
  await assert.doesNotReject(() => verifyReleases({
    requested: repository,
    tag,
    runCommand: () => JSON.stringify(release),
    fetchImpl,
    log: () => {},
  }));
  assert.equal(attempts, 2);
});

test('release verification rejects platform metadata differences', async () => {
  const catalog = JSON.parse(await readFile('catalog.json', 'utf8'));
  const entry = catalog.plugins.find(plugin => plugin.id === id);
  const { release, urls } = releaseFixture(entry, { 'win32-x64': entry.title + ' Windows' });
  await assert.rejects(() => verifyReleases({
    requested: repository,
    tag,
    runCommand: () => JSON.stringify(release),
    fetchImpl: fetchFixture(urls),
    log: () => {},
  }), /Platform metadata mismatch/);
});
