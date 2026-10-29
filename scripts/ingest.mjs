import { readFile, writeFile } from 'node:fs/promises';
import { createHash, createPrivateKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import semver from 'semver';
import { verifyPackage } from './verify.mjs';
import { validateCatalog } from './validate.mjs';

const publishers = JSON.parse(await readFile('publishers.json', 'utf8'));
const requested = process.env.PLUGIN_REPOSITORY || process.argv[2], tag = process.env.PLUGIN_TAG || process.argv[3];
if (requested && !Object.hasOwn(publishers, requested)) throw new Error('Publisher is not registered.');
if (tag && !/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Only stable version tags are accepted.');
if (!process.env.COMMERCE_PLUGIN_SIGNING_KEY) throw new Error('Market signing key is required.');
const key = createPrivateKey(process.env.COMMERCE_PLUGIN_SIGNING_KEY);
if (key.asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 key required.');
const command = (name, args) => execFileSync(name, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const repositories = requested ? [requested] : Object.keys(publishers);
async function download(url, limit) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error('Download failed: ' + response.status);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > limit) throw new Error('Artifact too large.'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
for (const repository of repositories) {
  let release;
  try { release = JSON.parse(command('gh', ['api', 'repos/' + repository + '/releases/' + (tag ? 'tags/' + tag : 'latest')])); }
  catch (error) { if (!requested && /404/.test(String(error.stderr))) continue; throw error; }
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error('Release is not stable.');
  command('git', ['fetch', 'origin', 'main']);
  command('git', ['checkout', '-B', 'market-ingest-base', 'origin/main']);
  const catalog = JSON.parse(await readFile('catalog.json', 'utf8')), identity = publishers[repository];
  const existing = catalog.plugins.find(entry => entry.id === identity), version = release.tag_name.slice(1);
  if (existing && !semver.gt(version, existing.version)) continue;
  const mainCommit = command('git', ['rev-parse', 'origin/main']);
  let result;
  for (const platform of ['darwin-arm64', 'win32-x64']) {
    const fragment = release.assets.find(asset => asset.name === 'catalog-' + platform + '.json');
    if (!fragment) throw new Error('Release lacks both platform fragments.');
    const descriptor = JSON.parse((await download(fragment.browser_download_url, 65536)).toString());
    if (descriptor.schemaVersion !== 1 || descriptor.plugins?.length !== 1) throw new Error('Invalid release fragment.');
    const entry = descriptor.plugins[0], name = identity + '-' + version + '-' + platform + '.ecplugin';
    const asset = release.assets.find(asset => asset.name === name), expected = 'https://github.com/' + repository + '/releases/download/' + release.tag_name + '/' + name;
    if (!asset || entry.version !== version || entry.artifacts?.[platform]?.url !== expected || asset.browser_download_url !== expected || asset.size !== entry.artifacts[platform].size || asset.digest !== 'sha256:' + entry.artifacts[platform].sha256) throw new Error('Release asset provenance mismatch.');
    const bytes = await download(expected, 512 * 1024 ** 2);
    if (createHash('sha256').update(bytes).digest('hex') !== asset.digest.slice(7)) throw new Error('GitHub asset digest mismatch.');
    const artifact = verifyPackage(bytes, entry, platform, identity, key);
    const metadata = Object.fromEntries(['id', 'title', 'description', 'category', 'version', 'api', 'releaseNotes'].map(field => [field, entry[field]]));
    if (result && JSON.stringify(metadata) !== JSON.stringify(Object.fromEntries(Object.keys(metadata).map(field => [field, result[field]])))) throw new Error('Platform metadata mismatch.');
    result = { ...metadata, ...(existing?.stats ? { stats: existing.stats } : {}), artifacts: { ...result?.artifacts, [platform]: artifact } };
  }
  catalog.plugins = [...catalog.plugins.filter(entry => entry.id !== identity), result].sort((left, right) => left.id.localeCompare(right.id));
  validateCatalog(catalog);
  command('git', ['checkout', '-B', 'market-ingest-publish', 'origin/main']);
  await writeFile('catalog.json', JSON.stringify(catalog, null, 2) + '\n');
  command('git', ['config', 'user.name', 'qingzuo-market']);
  command('git', ['config', 'user.email', 'qingzuo-market@users.noreply.github.com']);
  command('git', ['add', 'catalog.json']);
  command('git', ['commit', '-m', 'market: ' + identity + ' ' + version]);
  command('git', ['push', '--force-with-lease=refs/heads/main:' + mainCommit, 'origin', 'market-ingest-publish:main']);
}
