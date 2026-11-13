'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { exportPublic } = require('../../scripts/export-public.cjs');
const { scan, patterns, locations } = require('../../scripts/check-private.cjs');

function fixture(t) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-public-boundary-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'source');
  fs.mkdirSync(root);
  const git = (...args) => {
    const result = spawnSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: path.join(scratch, 'no-config'),
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q', '--initial-branch=main');
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), value);
  };
  const commit = () => {
    git('add', '-A');
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture tree');
    return git('rev-parse', 'HEAD');
  };
  return { scratch, root, git, write, commit };
}

test('export selects a commit, excludes ledgers and ignores all working-tree changes', t => {
  const f = fixture(t);
  f.write('README.md', 'First committed content\n');
  f.write('private/profile.json', 'Synthetic overlay\n');
  f.write('docs/parity-ledger.md', 'Synthetic private ledger\n');
  f.write('lighthouse/verification/setup-proof.md', 'Synthetic private proof\n');
  f.write('lighthouse/verification/cards/README.md', 'Public model mapping\n');
  const first = f.commit();
  f.write('README.md', 'Second committed content\n');
  f.commit();
  fs.unlinkSync(path.join(f.root, 'README.md'));
  f.write('docs/untracked.md', 'Untracked content\n');
  for (const name of ['one', 'two']) {
    const out = path.join(f.scratch, name);
    const result = exportPublic(f.root, out, first, { env: {} });
    assert.equal(result.commit, first);
    assert.equal(result.files, 2);
    assert.equal(fs.readFileSync(path.join(out, 'README.md'), 'utf8'), 'First committed content\n');
    assert.deepEqual(
      result.excluded.map(entry => entry.file),
      ['docs/parity-ledger.md', 'lighthouse/verification/setup-proof.md', 'private/'],
    );
    assert.equal(fs.existsSync(path.join(out, 'private')), false);
    assert.equal(fs.existsSync(path.join(out, 'docs/untracked.md')), false);
    assert.ok(fs.existsSync(path.join(out, 'lighthouse/verification/cards/README.md')));
  }
});

test('excluded report paths are redacted in the API and both CLIs for file and environment dictionaries', t => {
  const f = fixture(t);
  const canary = ['Synthetic', 'Excluded', 'Canary'].join('');
  const address = [10, 23, 45, 67].join('.');
  for (const name of [canary, address, 'setup']) f.write('lighthouse/verification/' + name + '-proof.md', 'Ledger\n');
  f.write('README.md', 'Harmless\n');
  for (const name of [
    'export-public.cjs',
    'dry-export.cjs',
    'check-private.cjs',
    'shared-files.cjs',
    'git-args.cjs',
    'export-inventory.json',
    'privacy-allowlist.json',
  ])
    f.write('scripts/' + name, fs.readFileSync(path.resolve(__dirname, '../../scripts', name)));
  const revision = f.commit();
  const dictionary = path.join(f.scratch, 'dictionary.txt');
  fs.writeFileSync(dictionary, canary + '\n');
  let expected;
  for (const [index, env] of [{ PRIVATE_TERMS: canary }, { PRIVATE_TERMS_PATH: dictionary }].entries()) {
    const result = exportPublic(f.root, path.join(f.scratch, 'api-' + index), revision, { env });
    const output = JSON.stringify(result);
    assert.ok(!output.includes(canary));
    assert.ok(!output.includes(address));
    assert.equal(result.excluded.filter(entry => entry.file.startsWith('[path withheld ')).length, 2);
    assert.ok(result.excluded.some(entry => entry.file === 'lighthouse/verification/setup-proof.md'));
    if (expected) assert.deepEqual(result.excluded, expected);
    expected = result.excluded;
    for (const cli of ['export-public.cjs', 'dry-export.cjs']) {
      const args = [path.join(f.root, 'scripts', cli), '--out', path.join(f.scratch, cli + index)];
      if (cli === 'export-public.cjs') args.push('--ref', revision);
      const child = spawnSync(process.execPath, args, {
        encoding: 'utf8',
        env: { ...process.env, TYPESAFE_API_KEY: '', PRIVATE_TERMS: '', PRIVATE_TERMS_PATH: '', ...env },
      });
      assert.equal(child.status, 0, child.stderr);
      assert.ok(!(child.stdout + child.stderr).includes(canary));
      assert.ok(!(child.stdout + child.stderr).includes(address));
      assert.deepEqual(JSON.parse(child.stdout).excluded, expected);
    }
  }
});

test('local agent settings and worktrees are ignored by working-tree checks', t => {
  const f = fixture(t);
  f.write('.gitignore', fs.readFileSync(path.resolve(__dirname, '../../.gitignore'), 'utf8'));
  f.write('README.md', 'Harmless\n');
  const revision = f.commit();
  f.write('.claude/settings.local.json', '{}\n');
  f.write('.claude/worktrees/local/README.md', 'Local scratch\n');
  assert.deepEqual(scan(f.root, { env: {} }).violations, []);
  const out = path.join(f.scratch, 'public');
  exportPublic(f.root, out, revision, { env: {} });
  assert.equal(fs.existsSync(path.join(out, '.claude')), false);
  f.git('add', '-f', '.claude/settings.local.json');
  f.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'Accidental local settings commit');
  assert.throws(() => exportPublic(f.root, path.join(f.scratch, 'refused'), 'HEAD'), /inventory/);
});

test('privacy failure prevents completed export and reports locations without term contents', t => {
  const f = fixture(t);
  const canary = ['Sensitive', 'Fixture', 'Canary'].join('');
  f.write('README.md', 'Harmless first line\n' + canary + '\n' + canary + '\n');
  const revision = f.commit();
  const out = path.join(f.scratch, 'refused');
  assert.throws(
    () => exportPublic(f.root, out, revision, { env: { PRIVATE_TERMS: canary } }),
    error => {
      assert.deepEqual(error.violations, [
        { file: 'README.md', line: 2 },
        { file: 'README.md', line: 3 },
      ]);
      assert.ok(!JSON.stringify(error).includes(canary));
      return true;
    },
  );
  assert.equal(fs.existsSync(out), false);
  assert.deepEqual(fs.readdirSync(f.scratch), ['source']);
});

test('generic privacy checks run without a dictionary and private filenames are redacted', t => {
  const f = fixture(t);
  f.write('README.md', 'Invented email: fixture@example.invalid\n');
  assert.deepEqual(scan(f.root, { env: {} }).violations, []);
  const credential = 'ghp_' + 'a'.repeat(36);
  f.write('README.md', 'First line\n' + credential + '\n');
  assert.deepEqual(scan(f.root, { env: {} }).violations, [{ file: 'README.md', line: 2 }]);
  const canary = ['Private', 'Path', 'Fixture'].join('');
  f.write('docs/' + canary + '.md', 'Nothing sensitive in this body\n');
  const result = scan(f.root, { env: { PRIVATE_TERMS: canary } });
  assert.ok(result.violations.some(hit => hit.file.startsWith('[path withheld ')));
  assert.ok(!JSON.stringify(result).includes(canary));
  assert.deepEqual(locations('first\n// hidden\n// phrase\nlast', patterns(['hidden phrase'], [])), [2]);
  assert.throws(() => scan(f.root, { env: { PRIVATE_TERMS_PATH: path.join(f.scratch, 'missing') } }));
});

test('generic email exceptions require a complete reserved domain', t => {
  const f = fixture(t);
  const domains = ['example-corp.com', 'invalid-co.net', 'example.realco.com', 'example.com.realco.com'];
  f.write('README.md', domains.map(domain => 'fixture' + '@' + domain).join('\n'));
  assert.deepEqual(
    scan(f.root, { env: {} }).violations.map(hit => hit.line),
    [1, 2, 3, 4],
  );
  f.write(
    'README.md',
    ['example.com.', 'sub.example.org', 'example.invalid', 'fixture.example']
      .map(domain => 'fixture' + '@' + domain)
      .join('\n'),
  );
  assert.deepEqual(scan(f.root, { env: {} }).violations, []);
});

test('malformed configured dictionaries fail closed without exposing their contents', t => {
  const f = fixture(t);
  f.write('README.md', 'Harmless\n');
  const dictionary = path.join(f.scratch, 'dictionary.txt');
  for (const bytes of [Buffer.from('SyntheticCanary', 'utf16le'), Buffer.from([0xff, 0xfe, 0x61])]) {
    fs.writeFileSync(dictionary, bytes);
    assert.throws(() => scan(f.root, { env: { PRIVATE_TERMS_PATH: dictionary } }), /valid UTF-8/);
  }
  assert.throws(() => scan(f.root, { env: { PRIVATE_TERMS: 'Synthetic\u0000Canary' } }), /valid UTF-8/);
});

test('privacy CLI withholds matched text and checks excluded files in a public tree', t => {
  const f = fixture(t);
  const canary = ['Private', 'Diagnostic', 'Canary'].join('');
  f.write('README.md', 'First line\n' + canary + '\n');
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, '../../scripts/check-private.cjs'), '--root', f.root],
    {
      encoding: 'utf8',
      env: { ...process.env, PRIVATE_TERMS_PATH: '', PRIVATE_TERMS: canary },
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), 'README.md:2');
  assert.ok(!(result.stdout + result.stderr).includes(canary));
  f.write('README.md', 'Harmless\n');
  f.write('private/notes.md', 'Harmless but excluded\n');
  assert.deepEqual(scan(f.root, { env: {}, publicTree: true }).violations, [{ file: 'private/notes.md', line: 1 }]);
});

test('export refuses repositories, nonempty targets, unknown roots and shared symbolic links', t => {
  const f = fixture(t);
  f.write('README.md', 'Harmless\n');
  const revision = f.commit();
  assert.throws(() => exportPublic(f.root, path.join(f.root, 'nested'), revision), /outside repositories/);
  const target = path.join(f.scratch, 'populated');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'keep.txt'), 'Keep\n');
  assert.throws(() => exportPublic(f.root, target, revision), /empty/);
  f.write('unknown.txt', 'Unlisted\n');
  assert.throws(() => exportPublic(f.root, path.join(f.scratch, 'unknown'), f.commit()), /inventory/);
  f.git('rm', 'unknown.txt');
  f.write('.claude/settings.local.json', '{}\n');
  assert.throws(() => exportPublic(f.root, path.join(f.scratch, 'settings'), f.commit()), /inventory/);
  f.git('rm', '.claude/settings.local.json');
  const blob = f.git('rev-parse', revision + ':README.md');
  f.git('update-index', '--add', '--cacheinfo', '120000', blob, 'docs/link');
  f.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic symlink');
  assert.throws(() => exportPublic(f.root, path.join(f.scratch, 'link'), 'HEAD'), /file type/);
});
