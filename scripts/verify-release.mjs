import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyPackage } from './verify.mjs';
import { validatePublisherCatalog } from './validate.mjs';

const publishers = JSON.parse(await readFile('publishers.json', 'utf8'));
const catalog = JSON.parse(await readFile('catalog.json', 'utf8'));
const requested = process.env.PLUGIN_REPOSITORY || process.argv[2];
const tag = process.env.PLUGIN_TAG || process.argv[3];
if (requested && !Object.hasOwn(publishers, requested)) throw new Error('Publisher is not registered.');
if (tag && !/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Only stable version tags are accepted.');
validatePublisherCatalog(catalog, publishers);

const command = (name, args) => execFileSync(name, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const repositories = requested ? [requested] : Object.keys(publishers);

async function download(url, limit) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error('Download failed: ' + response.status);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('Artifact too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

for (const repository of repositories) {
  let release;
  try {
    release = JSON.parse(command('gh', ['api', 'repos/' + repository + '/releases/' + (tag ? 'tags/' + tag : 'latest')]));
  } catch (error) {
    if (!requested && /404/.test(String(error.stderr))) continue;
    throw error;
  }
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) {
    throw new Error('Release is not stable.');
  }

  const identity = publishers[repository];
  const registered = catalog.plugins.find(entry => entry.id === identity);
  if (registered?.source?.repository !== repository) throw new Error('Catalog source is not registered.');
  const version = release.tag_name.slice(1);
  let metadata;

  for (const platform of ['darwin-arm64', 'win32-x64']) {
    const fragment = release.assets.find(asset => asset.name === 'catalog-' + platform + '.json');
    if (!fragment) throw new Error('Release lacks catalog-' + platform + '.json.');
    const fragmentUrl = 'https://github.com/' + repository + '/releases/download/' + release.tag_name + '/catalog-' + platform + '.json';
    if (fragment.browser_download_url !== fragmentUrl) throw new Error('Release fragment provenance mismatch.');
    const descriptor = JSON.parse((await download(fragment.browser_download_url, 256 * 1024)).toString());
    if (descriptor.schemaVersion !== 1 || descriptor.plugins?.length !== 1) throw new Error('Invalid release fragment.');

    const entry = descriptor.plugins[0];
    const name = identity + '-' + version + '-' + platform + '.ecplugin';
    const asset = release.assets.find(candidate => candidate.name === name);
    const expected = 'https://github.com/' + repository + '/releases/download/' + release.tag_name + '/' + name;
    const artifact = entry.artifacts?.[platform];
    if (!asset || entry.id !== identity || entry.version !== version || artifact?.url !== expected
      || asset.browser_download_url !== expected || asset.size !== artifact.size
      || asset.digest !== 'sha256:' + artifact.sha256) {
      throw new Error('Release asset provenance mismatch.');
    }
    const bytes = await download(expected, 512 * 1024 ** 2);
    if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
      throw new Error('GitHub asset digest mismatch.');
    }
    const verified = verifyPackage(bytes, entry, platform, identity);
    const current = Object.fromEntries(
      ['id', 'title', 'description', 'category', 'version', 'api', 'releaseNotes', 'icon']
        .map(field => [field, entry[field]]),
    );
    if (metadata && JSON.stringify(metadata) !== JSON.stringify(current)) throw new Error('Platform metadata mismatch.');
    metadata = current;
    if (verified.size !== artifact.size || verified.sha256 !== artifact.sha256) throw new Error('Verified artifact mismatch.');
  }
  console.log(identity + ' ' + release.tag_name + ': verified darwin-arm64 and win32-x64.');
}
