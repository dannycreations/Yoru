import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

function main() {
  if (process.platform !== 'android') return;

  const require = createRequire(import.meta.url);
  const packageDir = dirname(require.resolve('better-sqlite3/package.json', { paths: [resolve(import.meta.dirname, '..')] }));
  const bindingPath = resolve(packageDir, 'build', 'Release', 'better_sqlite3.node');

  if (existsSync(bindingPath)) {
    console.log('better-sqlite3: native binding already built, skipping.');
    return;
  }

  const prefix = process.env.PREFIX || dirname(dirname(process.execPath));

  if (!existsSync(resolve(prefix, 'include', 'node', 'common.gypi'))) {
    console.error(`better-sqlite3: no Node headers under ${prefix}/include/node. Install the toolchain with: pkg install nodejs clang make python`);
    process.exit(1);
  }

  console.log(`better-sqlite3: building native binding for android-${process.arch}...`);

  const nodeGyp = process.env.npm_config_node_gyp;
  const command = nodeGyp ? process.execPath : 'node-gyp';
  const args = [...(nodeGyp ? [nodeGyp] : []), 'rebuild', '--release', '--force_build=1', `--nodedir=${prefix}`];
  const build = spawnSync(command, args, { cwd: packageDir, stdio: 'inherit' });

  if (build.error) {
    console.error(`better-sqlite3: could not run node-gyp: ${build.error.message}`);
    process.exit(1);
  }

  if (build.status !== 0 || !existsSync(bindingPath)) {
    console.error(`better-sqlite3: build failed (node-gyp exit ${build.status}), ${bindingPath} was not produced.`);
    process.exit(build.status || 1);
  }

  console.log(`better-sqlite3: built ${bindingPath}`);
}

void main();
