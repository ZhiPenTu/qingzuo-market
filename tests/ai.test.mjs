import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import AdmZip from 'adm-zip';
import { verifyPackage } from '../scripts/verify.mjs';

test('API 1.2 AI permissions are verified before signing for both platforms', () => {
  const keys = generateKeyPairSync('ed25519');
  for (const platform of ['darwin-arm64', 'win32-x64']) {
    const descriptor = { version: '0.1.0', commerce: { manifestVersion: 1, id: 'official.ai-image', title: 'AI 批图', description: 'Batch editing', api: '^1.2.0', ui: 'ui/index.html', permissions: { files: true, ai: ['assistant', 'image-edit'] } } };
    const archive = new AdmZip();
    archive.addFile('package.json', Buffer.from(JSON.stringify(descriptor)));
    archive.addFile('ui/index.html', Buffer.from('<h1>AI 批图</h1>'));
    const bytes = archive.toBuffer();
    const entry = { ...descriptor.commerce, version: descriptor.version, artifacts: { [platform]: { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } };
    const signed = verifyPackage(bytes, entry, platform, 'official.ai-image', keys.privateKey);
    assert.equal(verify(null, bytes, keys.publicKey, Buffer.from(signed.signature, 'base64')), true);
    descriptor.commerce.permissions.ai = ['unrestricted'];
    archive.addFile('package.json', Buffer.from(JSON.stringify(descriptor)));
    const invalid = archive.toBuffer();
    entry.artifacts[platform] = { size: invalid.length, sha256: createHash('sha256').update(invalid).digest('hex') };
    assert.throws(() => verifyPackage(invalid, entry, platform, 'official.ai-image', keys.privateKey), /AI/);
  }
});

test('API 1.4 text AI permissions are verified before signing', () => {
  const keys = generateKeyPairSync('ed25519'), platform = 'darwin-arm64';
  const descriptor = { version: '0.2.0', commerce: { manifestVersion: 1, id: 'official.shein-full', title: '希音全托管铺货', description: 'Draft publishing', api: '^1.4.0', ui: 'ui/index.html', permissions: { ai: ['image-edit', 'text'] } } };
  const archive = new AdmZip();
  archive.addFile('package.json', Buffer.from(JSON.stringify(descriptor)));
  archive.addFile('ui/index.html', Buffer.from('<h1>希音全托管铺货</h1>'));
  const bytes = archive.toBuffer();
  const entry = { ...descriptor.commerce, version: descriptor.version, artifacts: { [platform]: { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } };
  const signed = verifyPackage(bytes, entry, platform, descriptor.commerce.id, keys.privateKey);
  assert.equal(verify(null, bytes, keys.publicKey, Buffer.from(signed.signature, 'base64')), true);
});
