import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import AdmZip from 'adm-zip';
import { verifyPackage } from '../scripts/verify.mjs';
test('market verifies package identity, size, digest and signs original bytes without extraction', () => {
  const zip = new AdmZip(), keys = generateKeyPairSync('ed25519'), platform = 'darwin-arm64';
  zip.addFile('package.json', Buffer.from(JSON.stringify({ version: '0.1.0', commerce: { manifestVersion: 1, id: 'official.fixture', title: 'Fixture', description: '', api: '^1.1.0', ui: 'ui/index.html', permissions: {} } })));
  zip.addFile('ui/index.html', Buffer.from('<h1>Fixture</h1>'));
  const bytes = zip.toBuffer(), entry = { id: 'official.fixture', version: '0.1.0', title: 'Fixture', description: '', api: '^1.1.0', artifacts: { [platform]: { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } };
  const result = verifyPackage(bytes, entry, platform, entry.id, keys.privateKey);
  assert.equal(verify(null, bytes, keys.publicKey, Buffer.from(result.signature, 'base64')), true);
  assert.throws(() => verifyPackage(bytes, { ...entry, api: '^2.0.0' }, platform, entry.id, keys.privateKey));
  assert.throws(() => verifyPackage(bytes, entry, platform, 'official.other', keys.privateKey));
  assert.throws(() => verifyPackage(Buffer.from('invalid'), entry, platform, entry.id, keys.privateKey));
});

test('market rejects traversal, symlinks, duplicate paths, missing UI and unsupported backend targets', () => {
  const keys = generateKeyPairSync('ed25519'), platform = 'darwin-arm64';
  function fixture(overrides = {}) {
    const zip = new AdmZip();
    zip.addFile('package.json', Buffer.from(JSON.stringify({ version: '0.1.0', commerce: { manifestVersion: 1, id: 'official.fixture', title: 'Fixture', description: '', api: '^1.1.0', ui: 'ui/index.html', permissions: {}, ...overrides } })));
    zip.addFile('ui/index.html', Buffer.from('<h1>Fixture</h1>'));
    return zip;
  }
  function check(bytes) {
    const entry = { id: 'official.fixture', version: '0.1.0', title: 'Fixture', description: '', api: '^1.1.0', artifacts: { [platform]: { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } };
    return verifyPackage(bytes, entry, platform, entry.id, keys.privateKey);
  }
  const traversal = fixture().toBuffer(), source = Buffer.from('ui/index.html'), destination = Buffer.from('../index.html');
  for (let offset = traversal.indexOf(source); offset >= 0; offset = traversal.indexOf(source, offset + source.length)) destination.copy(traversal, offset);
  assert.throws(() => check(traversal));
  const symlink = fixture(); symlink.addFile('link', Buffer.from('/tmp')); symlink.getEntry('link').header.attr = (0o120777 << 16) >>> 0;
  assert.throws(() => check(symlink.toBuffer()));
  const duplicate = fixture(); duplicate.addFile('UI/INDEX.HTML', Buffer.from('duplicate'));
  assert.throws(() => check(duplicate.toBuffer()));
  const missing = fixture(); missing.deleteFile('ui/index.html');
  assert.throws(() => check(missing.toBuffer()));
  assert.throws(() => check(fixture({ backend: { type: 'executable', entry: { 'win32-x64': 'backend/run.exe' } } }).toBuffer()));
});
