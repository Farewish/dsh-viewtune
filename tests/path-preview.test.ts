import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extensionOf, fileNameOf, formatBytes, previewKindOf } from '../src/client/path-preview.ts';

// The hover card's decisions, which are all this suite can reach (it has no DOM). Fixture names avoid a `.ts` extension: this
// runner rewrites `.ts` to `.js` across the emitted tree, string literals included.
test('a file link knows its name, its extension, and whether a preview can render it', () => {
  assert.equal(fileNameOf('src/client/Reader.md'), 'Reader.md');
  assert.equal(fileNameOf('C:\\work\\pics\\a.png'), 'a.png', 'the Windows separator splits too');
  assert.equal(fileNameOf('a.png'), 'a.png', 'a bare name is its own file name');
  assert.equal(fileNameOf('src/dir/'), '', 'a trailing separator leaves an empty name');
  assert.equal(extensionOf('pics/A.PNG'), 'png', 'the extension is lowercased');
  assert.equal(extensionOf('src/.gitignore'), '', 'a leading dot is a hidden name, not an extension');
  assert.equal(extensionOf('src/archive.tar.gz'), 'gz', 'only the last extension counts');
  assert.equal(extensionOf('src/Makefile'), '', 'no dot means no extension');
  assert.equal(previewKindOf('pics/circuit.png'), 'image', 'a raster image gets a rendered preview');
  assert.equal(previewKindOf('pics/diagram.SVG'), 'image', 'case does not matter');
  assert.equal(previewKindOf('src/client/Reader.md'), 'file', 'text is named, not rendered');
  assert.equal(previewKindOf('bin/tool'), 'file', 'an extensionless file is named');
});

// The size label on a sent file's card. A `FileAttachmentRef` carries nothing else — no MIME type, no path — so this and the
// name are the whole card.
test('a byte count becomes a short label, and a nonsense count becomes nothing', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(999), '999 B', 'three digits stay bytes');
  assert.equal(formatBytes(1000), '1.0 KB', 'the kilobyte boundary is decimal, not binary');
  assert.equal(formatBytes(1500), '1.5 KB');
  assert.equal(formatBytes(2500000), '2.5 MB');
  assert.equal(formatBytes(25000000), '25 MB', 'two digits and up lose the fraction');
  assert.equal(formatBytes(1000000000), '1.0 GB');
  assert.equal(formatBytes(Number.NaN), '', 'a value that is not a size renders nothing');
  assert.equal(formatBytes(-1), '', 'a negative size is not a size either');
});
