import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const API_ROOT = 'https://api.github.com';
const PER_PAGE = 100;
const MAX_PAGES = 100;
const PLATFORMS = new Set(['darwin-arm64', 'win32-x64']);
const STABLE_TAG = /^v(\d+\.\d+\.\d+)$/;

function assetBelongsToPlugin(asset, pluginId, version) {
  if (!asset || typeof asset.name !== 'string') return false;
  const prefix = pluginId + '-' + version + '-';
  const suffix = '.ecplugin';
  if (!asset.name.startsWith(prefix) || !asset.name.endsWith(suffix)) return false;
  return PLATFORMS.has(asset.name.slice(prefix.length, -suffix.length));
}

export function sumReleaseDownloads(releases, pluginId) {
  if (!Array.isArray(releases)) throw new TypeError('Releases must be an array.');
  let total = 0;
  for (const release of releases) {
    if (!release || release.draft || release.prerelease) continue;
    const match = STABLE_TAG.exec(release.tag_name ?? '');
    if (!match) continue;
    for (const asset of release.assets ?? []) {
      if (!assetBelongsToPlugin(asset, pluginId, match[1])) continue;
      if (!Number.isSafeInteger(asset.download_count) || asset.download_count < 0) {
        throw new Error('Invalid download count for ' + asset.name + '.');
      }
      total += asset.download_count;
      if (!Number.isSafeInteger(total)) throw new Error('Download count exceeds the safe integer range.');
    }
  }
  return total;
}

export function applyCatalogDownloads(catalog, publishers, releasesByRepository) {
  if (!catalog || !Array.isArray(catalog.plugins)) throw new Error('Invalid catalog.');
  const next = structuredClone(catalog);
  for (const [repository, pluginId] of Object.entries(publishers)) {
    const entry = next.plugins.find(plugin => plugin.id === pluginId);
    if (!entry) continue;
    const releases = releasesByRepository[repository];
    if (!Array.isArray(releases)) throw new Error('Missing releases for ' + repository + '.');
    entry.stats = { ...entry.stats, downloads: sumReleaseDownloads(releases, pluginId) };
  }
  return next;
}

function repositoryPath(repository) {
  return repository.split('/').map(encodeURIComponent).join('/');
}

async function githubJson(url, token, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'qingzuo-market',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error('GitHub API ' + response.status + ' for ' + url + (detail ? ': ' + detail : ''));
  }
  return response.json();
}

export async function fetchRepositoryReleases(repository, { token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN, fetchImpl = fetch } = {}) {
  const releases = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = API_ROOT + '/repos/' + repositoryPath(repository) + '/releases?per_page=' + PER_PAGE + '&page=' + page;
    const batch = await githubJson(url, token, fetchImpl);
    if (!Array.isArray(batch)) throw new Error('Invalid GitHub release response for ' + repository + '.');
    releases.push(...batch);
    if (batch.length < PER_PAGE) return releases;
  }
  throw new Error('Too many GitHub releases for ' + repository + '.');
}

export async function updateDownloads({ catalogPath = 'catalog.json', publishersPath = 'publishers.json', token, fetchImpl = fetch } = {}) {
  const original = await readFile(catalogPath, 'utf8');
  const catalog = JSON.parse(original);
  const publishers = JSON.parse(await readFile(publishersPath, 'utf8'));
  const releasesByRepository = {};
  for (const repository of Object.keys(publishers)) {
    releasesByRepository[repository] = await fetchRepositoryReleases(repository, { token, fetchImpl });
  }
  const next = applyCatalogDownloads(catalog, publishers, releasesByRepository);
  const body = JSON.stringify(next, null, 2) + '\n';
  if (body !== original) await writeFile(catalogPath, body);
  return { catalog: next, changed: body !== original };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await updateDownloads();
  const counts = result.catalog.plugins
    .filter(plugin => Number.isSafeInteger(plugin.stats?.downloads))
    .map(plugin => plugin.id + ': ' + plugin.stats.downloads);
  console.log((result.changed ? 'Updated ' : 'Unchanged ') + path.basename('catalog.json') + '\n' + counts.join('\n'));
}
