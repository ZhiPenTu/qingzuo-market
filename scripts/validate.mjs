import { readFile } from 'node:fs/promises';
import semver from 'semver';
export function validatePluginIcon(value) {
  const prefix = 'data:image/png;base64,';
  if (typeof value !== 'string' || !value.startsWith(prefix)) throw new Error('Invalid plugin icon.');
  const encoded = value.slice(prefix.length);
  if (!encoded || encoded.length > 49152 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid plugin icon.');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 8 || bytes.length > 36864 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid plugin icon.');
  return value;
}
export function validateCatalog(value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.plugins) || value.plugins.length > 1000) throw new Error('Invalid catalog.');
  const identities = new Set();
  for (const entry of value.plugins) {
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(entry.id) || entry.id.startsWith('system.') || identities.has(entry.id) || !semver.valid(entry.version) || !semver.validRange(entry.api) || typeof entry.title !== 'string' || !entry.title || entry.title.length > 80 || typeof entry.description !== 'string' || entry.description.length > 2000 || typeof entry.releaseNotes !== 'string' || entry.releaseNotes.length > 64000) throw new Error('Invalid plugin entry.');
    if (entry.icon !== undefined) validatePluginIcon(entry.icon);
    if (entry.stats !== undefined && (!entry.stats || typeof entry.stats !== 'object' || Array.isArray(entry.stats) || entry.stats.downloads !== undefined && (!Number.isSafeInteger(entry.stats.downloads) || entry.stats.downloads < 0))) throw new Error('Invalid plugin stats.');
    identities.add(entry.id);
    for (const platform of ['darwin-arm64', 'win32-x64']) {
      const artifact = entry.artifacts?.[platform], url = artifact && new URL(artifact.url);
      if (!artifact || url.protocol !== 'https:' || url.username || url.password || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || !/^[A-Za-z0-9+/]{86}==$/.test(artifact.signature)) throw new Error('Invalid signed artifact.');
    }
  }
  return value;
}
if (process.argv[1]?.endsWith('/validate.mjs')) validateCatalog(JSON.parse(await readFile('catalog.json', 'utf8')));
