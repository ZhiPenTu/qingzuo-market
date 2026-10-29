import { createHash, sign } from 'node:crypto';
import AdmZip from 'adm-zip';
import { validateManifest, safeRelative } from '@commerce/plugin-sdk/manifest';
import { validatePluginIcon } from './validate.mjs';

export function verifyPackage(bytes, entry, platform, publisherId, privateKey) {
  const artifact = entry.artifacts?.[platform];
  if (!artifact || artifact.size !== bytes.length || bytes.length > 512 * 1024 ** 2 || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('Artifact digest or size mismatch.');
  const zip = new AdmZip(bytes), entries = zip.getEntries(), seen = new Set();
  if (entries.length > 20000) throw new Error('Too many archive entries.');
  let total = 0;
  for (const item of entries) {
    const relative = item.entryName.replace(/\/$/, ''); safeRelative(relative);
    const normalized = relative.toLowerCase(), type = (item.header.attr >>> 16) & 0xf000;
    if (seen.has(normalized) || ![0, 0x8000, 0x4000].includes(type)) throw new Error('Unsafe archive entry.');
    seen.add(normalized); total += item.header.size;
    if (total > 2 * 1024 ** 3) throw new Error('Expanded archive is too large.');
  }
  const descriptor = zip.getEntry('package.json');
  if (!descriptor || descriptor.header.size > 65536) throw new Error('Missing or oversized manifest.');
  const manifest = validateManifest(JSON.parse(descriptor.getData().toString()), platform);
  if (manifest.id !== publisherId || entry.id !== publisherId || manifest.version !== entry.version || manifest.api !== entry.api || manifest.title !== entry.title || manifest.description !== entry.description || (manifest.releaseNotes ?? '') !== (entry.releaseNotes ?? '') || (manifest.icon ?? '') !== (entry.icon ?? '')) throw new Error('Publisher, catalog and package manifest differ.');
  if (entry.icon !== undefined) validatePluginIcon(entry.icon);
  if (!zip.getEntry(manifest.ui) || manifest.backend && !zip.getEntry(manifest.backend.entry[platform])) throw new Error('Missing declared plugin entry.');
  return { ...artifact, signature: sign(null, bytes, privateKey).toString('base64') };
}
