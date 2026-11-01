import { readFile } from 'node:fs/promises';
import semver from 'semver';
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
function validRepository(value) {
  if (typeof value !== 'string' || value.length > 160 || !REPOSITORY.test(value)) return false;
  return value.split('/').every(part => part.length <= 100 && part !== '.' && part !== '..');
}
function stableVersion(value) {
  return semver.valid(value) !== null && semver.prerelease(value) === null;
}
export function validatePluginIcon(value) {
  const prefix = 'data:image/png;base64,';
  if (typeof value !== 'string' || !value.startsWith(prefix)) throw new Error('Invalid plugin icon.');
  const encoded = value.slice(prefix.length);
  if (!encoded || encoded.length > 49152 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid plugin icon.');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 8 || bytes.length > 36864 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid plugin icon.');
  return value;
}
export function validateSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || source.type !== 'github-release' || !validRepository(source.repository)) throw new Error('Invalid plugin source.');
  return source;
}
export function validateCatalog(value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.plugins) || value.plugins.length > 1000) throw new Error('Invalid catalog.');
  const identities = new Set();
  for (const entry of value.plugins) {
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(entry.id) || entry.id.startsWith('system.') || identities.has(entry.id) || !stableVersion(entry.version) || entry.api !== undefined && (typeof entry.api !== 'string' || !semver.validRange(entry.api)) || typeof entry.title !== 'string' || !entry.title || entry.title.length > 80 || typeof entry.description !== 'string' || entry.description.length > 2000 || entry.category !== undefined && (typeof entry.category !== 'string' || !entry.category.trim() || entry.category.length > 40) || entry.releaseNotes !== undefined && (typeof entry.releaseNotes !== 'string' || entry.releaseNotes.length > 64000)) throw new Error('Invalid plugin entry.');
    validateSource(entry.source);
    if (entry.icon !== undefined) validatePluginIcon(entry.icon);
    if (entry.stats !== undefined && (!entry.stats || typeof entry.stats !== 'object' || Array.isArray(entry.stats) || entry.stats.downloads !== undefined && (!Number.isSafeInteger(entry.stats.downloads) || entry.stats.downloads < 0))) throw new Error('Invalid plugin stats.');
    identities.add(entry.id);
    if (entry.artifacts !== undefined) {
      if (!entry.artifacts || typeof entry.artifacts !== 'object' || Array.isArray(entry.artifacts)) throw new Error('Invalid signed artifact.');
      for (const [platform, artifact] of Object.entries(entry.artifacts)) {
        const url = artifact && new URL(artifact.url);
        if (!['darwin-arm64', 'win32-x64'].includes(platform) || !artifact || url.protocol !== 'https:' || url.username || url.password || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || !/^[A-Za-z0-9+/]{86}==$/.test(artifact.signature)) throw new Error('Invalid signed artifact.');
      }
    }
  }
  return value;
}
export function validatePublisherCatalog(catalog, publishers) {
  validateCatalog(catalog);
  const repositories = new Map();
  for (const [repository, id] of Object.entries(publishers)) {
    if (!validRepository(repository) || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(id) || repositories.has(repository)) throw new Error('Invalid publisher registry.');
    repositories.set(repository, id);
  }
  for (const entry of catalog.plugins) {
    const publisherId = repositories.get(entry.source.repository);
    if (publisherId !== entry.id) throw new Error('Plugin source is not registered.');
  }
  return catalog;
}
if (process.argv[1]?.endsWith('/validate.mjs')) {
  const catalog = JSON.parse(await readFile('catalog.json', 'utf8'));
  const publishers = JSON.parse(await readFile('publishers.json', 'utf8'));
  validatePublisherCatalog(catalog, publishers);
}
