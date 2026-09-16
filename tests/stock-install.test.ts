import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  name: string;
  main: string;
  scripts?: { prepare?: string };
  exports: Record<string, { default?: string } | string>;
  files: string[];
  dsh: { bundle?: { patch?: string } };
};
const clientJs = readFileSync(resolve(root, 'lib', 'client.js'), 'utf8');

test('declares dsh.bundle.patch so official add joins the profile layer stack', () => {
  assert.equal(pkg.dsh.bundle?.patch, './cordis.patch.yml');
  assert.equal(existsSync(resolve(root, 'cordis.patch.yml')), true);
  const patch = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /id: dsh-better-display/);
  // Rows resolve by package name, so the boot specifier is this fork's name.
  assert.match(patch, new RegExp(`name: ${pkg.name}\\s*$`, 'm'));
  assert.equal(pkg.files.includes('cordis.patch.yml'), true);
});

test('commits compiled lib entries and does not require a prepare script', () => {
  assert.equal(pkg.scripts?.prepare, undefined);
  assert.equal(pkg.main, 'lib/dsh-better-display.js');
  const client = pkg.exports['./client'];
  assert.equal(typeof client === 'object' && client !== null ? client.default : client, './lib/client.js');
  assert.equal(existsSync(resolve(root, 'lib/dsh-better-display.js')), true);
  assert.equal(existsSync(resolve(root, 'lib/client.js')), true);
  assert.match(clientJs, /window\.__ModuleLoader__\.load/);
});

test('registers the client bundle under this package name', () => {
  // The Host derives the client row id from the installed manifest's package
  // name, and the browser loader rejects a bundle that registers anything else
  // ("bundle … loaded without registering \"<id>\" via __ModuleLoader__.load").
  // The upstream name must not come back here: a rename has to carry it along.
  const registered = /window\.__ModuleLoader__\.load\(\{\s*\n\s*id: "([^"]+)"/u.exec(clientJs)?.[1];
  assert.equal(registered, pkg.name);

  // Style ownership (HMR removes this plugin's <style> tags by plugin id) is
  // stamped with the same id.
  const owners = [...clientJs.matchAll(/tag\.dataset\.plugin = "([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual([...new Set(owners)], [pkg.name]);
  const cssOwners = [...clientJs.matchAll(/const tagId\S* = "([^"/]+)\//gu)].map((match) => match[1]);
  assert.deepEqual([...new Set(cssOwners)], [pkg.name]);
});

test('READMEs install this fork by package name and name pnpm', () => {
  for (const name of ['README.md', 'README.en.md']) {
    const text = readFileSync(resolve(root, name), 'utf8');
    assert.match(text, new RegExp(`dsh plugin --profile web add \\./${pkg.name}`));
    assert.match(text, new RegExp(`dsh plugin --profile web remove ${pkg.name}`));
    assert.match(text, /pnpm/);
    // Upstream is the one package these docs must never tell people to add.
    assert.doesNotMatch(text, /add github:aa2246740\/dsh-better-display\b/);
    assert.doesNotMatch(text, /activate-new-client/);
    assert.doesNotMatch(text, /my-plugins/);
    assert.doesNotMatch(text, /DSHX_HARNESS/);
  }
});
