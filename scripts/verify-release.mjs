import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyPackage } from './verify.mjs';
import { parseJsonStrict, validatePluginMetadata, validatePublisherCatalog } from './validate.mjs';

const FRAGMENT_ROOT_FIELDS = new Set(['schemaVersion', 'plugins']);
const FRAGMENT_FIELDS = new Set([
  'id',
  'version',
  'title',
  'description',
  'category',
  'api',
  'releaseNotes',
  'icon',
  'artifacts',
]);
const FRAGMENT_ARTIFACT_FIELDS = new Set(['url', 'size', 'sha256']);
const SUPPORTED_PLATFORMS = new Set(['darwin-arm64', 'win32-x64']);
// Published releases made before the tier rollout still carry harmless manifest
// fields. Strip them after validation, while continuing to reject trust fields.
const LEGACY_FRAGMENT_FIELDS = new Set(['manifestVersion', 'ui', 'permissions', 'settings', 'backend', 'services']);
const METADATA_FIELDS = ['id', 'title', 'description', 'category', 'version', 'api', 'releaseNotes', 'icon'];
const MAX_DOWNLOAD_ATTEMPTS = 32;
const DOWNLOAD_TIMEOUT_MS = 300000;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertAllowedFields(value, allowed) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error('Release fragment cannot define ' + field + '.');
  }
}

export function validateReleaseFragment(fragment, { id, version } = {}) {
  if (!isRecord(fragment) || fragment.schemaVersion !== 1 || !Array.isArray(fragment.plugins) || fragment.plugins.length !== 1) {
    throw new Error('Invalid release fragment.');
  }
  assertAllowedFields(fragment, FRAGMENT_ROOT_FIELDS);
  const entry = fragment.plugins[0];
  if (!isRecord(entry)) throw new Error('Invalid release fragment.');
  assertAllowedFields(entry, new Set([...FRAGMENT_FIELDS, ...LEGACY_FRAGMENT_FIELDS]));
  if (entry.id !== id || entry.version !== version) throw new Error('Release fragment identity mismatch.');
  validatePluginMetadata(entry);
  if (entry.artifacts !== undefined) {
    if (!isRecord(entry.artifacts)) throw new Error('Invalid release fragment.');
    for (const [platform, artifact] of Object.entries(entry.artifacts)) {
      if (!SUPPORTED_PLATFORMS.has(platform) || !isRecord(artifact)) throw new Error('Invalid release fragment.');
      assertAllowedFields(artifact, FRAGMENT_ARTIFACT_FIELDS);
    }
  }
  return {
    id: entry.id,
    version: entry.version,
    title: entry.title,
    description: entry.description,
    ...(entry.category !== undefined ? { category: entry.category } : {}),
    ...(entry.api !== undefined ? { api: entry.api } : {}),
    ...(entry.releaseNotes !== undefined ? { releaseNotes: entry.releaseNotes } : {}),
    ...(entry.icon !== undefined ? { icon: entry.icon } : {}),
    artifacts: entry.artifacts,
  };
}

export function catalogMetadata(entry) {
  return Object.fromEntries(METADATA_FIELDS.map(field => [field, entry[field]]));
}

const command = (name, args) => execFileSync(name, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function contentRange(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(value ?? '');
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === '*' ? null : Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end
    || total !== null && (!Number.isSafeInteger(total) || end >= total)) return null;
  return { start, end, total };
}

async function download(url, limit, fetchImpl = fetch) {
  const chunks = [];
  let size = 0;
  let total = null;
  let lastError;
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          'Accept-Encoding': 'identity',
          ...(size > 0 ? { Range: 'bytes=' + size + '-' } : {}),
        },
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error;
      continue;
    }
    if (!response.ok) {
      if (response.status === 416 && total !== null && size === total) return Buffer.concat(chunks);
      throw new Error('Download failed: ' + response.status);
    }
    if (response.status === 206) {
      const range = contentRange(response.headers?.get?.('content-range'));
      if (!range || range.start !== size || total !== null && range.total !== null && range.total !== total) {
        throw new Error('Download resume mismatch.');
      }
      total = range.total ?? total;
    } else {
      if (size > 0) {
        chunks.length = 0;
        size = 0;
        total = null;
      }
      const lengthHeader = response.headers?.get?.('content-length');
      if (typeof lengthHeader === 'string' && /^\d+$/.test(lengthHeader)) {
        const length = Number(lengthHeader);
        if (Number.isSafeInteger(length) && length >= 0) total = length;
      }
    }
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit) throw new Error('Artifact too large.');
        chunks.push(chunk);
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Artifact too large.') throw error;
      lastError = error;
      continue;
    }
    if (total !== null && size < total) {
      lastError = new Error('Download ended before the declared length.');
      continue;
    }
    if (total !== null && size > total) throw new Error('Download exceeded the declared length.');
    return Buffer.concat(chunks);
  }
  throw new Error('Download failed after ' + MAX_DOWNLOAD_ATTEMPTS + ' attempts.', { cause: lastError });
}

export async function verifyReleases({
  publishersPath = 'publishers.json',
  catalogPath = 'catalog.json',
  requested = process.env.PLUGIN_REPOSITORY || process.argv[2],
  tag = process.env.PLUGIN_TAG || process.argv[3],
  runCommand = command,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const registry = parseJsonStrict(await readFile(publishersPath, 'utf8'), 'publishers.json');
  const catalog = parseJsonStrict(await readFile(catalogPath, 'utf8'), 'catalog.json');
  validatePublisherCatalog(catalog, registry);
  if (requested && !Object.hasOwn(registry.publishers, requested)) throw new Error('Publisher is not registered.');
  if (tag && !/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Only stable version tags are accepted.');

  const repositories = requested ? [requested] : Object.keys(registry.publishers);
  for (const repository of repositories) {
    let release;
    try {
      release = JSON.parse(runCommand('gh', ['api', 'repos/' + repository + '/releases/' + (tag ? 'tags/' + tag : 'latest')]));
    } catch (error) {
      if (!requested && /404/.test(String(error.stderr))) continue;
      throw error;
    }
    if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) {
      throw new Error('Release is not stable.');
    }

    const identity = registry.publishers[repository].id;
    const registered = catalog.plugins.find(entry => entry.id === identity);
    if (registered?.source?.repository !== repository) throw new Error('Catalog source is not registered.');
    const version = release.tag_name.slice(1);
    let metadata;

    for (const platform of ['darwin-arm64', 'win32-x64']) {
      const fragment = release.assets.find(asset => asset.name === 'catalog-' + platform + '.json');
      if (!fragment) throw new Error('Release lacks catalog-' + platform + '.json.');
      const fragmentUrl = 'https://github.com/' + repository + '/releases/download/' + release.tag_name + '/catalog-' + platform + '.json';
      if (fragment.browser_download_url !== fragmentUrl) throw new Error('Release fragment provenance mismatch.');
      const descriptor = parseJsonStrict(
        (await download(fragment.browser_download_url, 256 * 1024, fetchImpl)).toString(),
        'release fragment',
      );
      const entry = validateReleaseFragment(descriptor, { id: identity, version });

      const name = identity + '-' + version + '-' + platform + '.ecplugin';
      const asset = release.assets.find(candidate => candidate.name === name);
      const expected = 'https://github.com/' + repository + '/releases/download/' + release.tag_name + '/' + name;
      const artifact = entry.artifacts?.[platform];
      if (!asset || !isRecord(artifact) || artifact.url !== expected
        || asset.browser_download_url !== expected || asset.size !== artifact.size
        || asset.digest !== 'sha256:' + artifact.sha256) {
        throw new Error('Release asset provenance mismatch.');
      }
      const bytes = await download(expected, 512 * 1024 ** 2, fetchImpl);
      if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
        throw new Error('GitHub asset digest mismatch.');
      }
      const verified = verifyPackage(bytes, entry, platform, identity);
      const current = catalogMetadata(entry);
      if (metadata && JSON.stringify(metadata) !== JSON.stringify(current)) throw new Error('Platform metadata mismatch.');
      metadata = current;
      if (verified.size !== artifact.size || verified.sha256 !== artifact.sha256) throw new Error('Verified artifact mismatch.');
    }
    log(identity + ' ' + release.tag_name + ': verified darwin-arm64 and win32-x64.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await verifyReleases();
}
