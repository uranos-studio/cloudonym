// CLI 단일 실행 파일 (Node SEA — https://nodejs.org/api/single-executable-applications.html) — 이 기계의 node 로 build/cli-sea/ 에 만든다. 내지 않는다(릴리스 · tap 없음).
// 순서: cli/ 를 CommonJS 한 파일로 묶는다(SEA 는 CJS 스크립트 하나만 싣는다) → SEA blob → node 실행 파일 복사 → blob 주입(postject) → macOS 는 다시 서명 →
// 만든 파일로 --version 을 돌려 cloudonym-cli/<버전> 이 나오는지 본다 → tar.gz 와 sha256 → Homebrew 공식 틀(cli/packaging/homebrew)을 채운다.
// 쓰는 법: npm run build:cli-bin — 실패하면 exit 1. postject 는 npx 로 받는다(처음 한 번 npm 레지스트리에 닿는다 · package.json 에 넣지 않는다)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'build', 'cli-sea');
const POSTJECT = 'postject@1.0.0-alpha.6';
/** Node 문서의 SEA 퓨즈 — 이 글자가 실행 파일에 있어야 blob 을 찾는다 */
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const fail = (/** @type {string} */ msg) => { console.error(`cli-sea: ${msg}`); process.exit(1); };
const version = JSON.parse(readFileSync(join(ROOT, 'cli', 'package.json'), 'utf-8')).version;
const [major] = process.versions.node.split('.').map(Number);
if ((major ?? 0) < 22) fail(`Node ${process.versions.node}: SEA (--experimental-sea-config) needs Node 22 or later`);

let esbuild;
try { esbuild = await import('esbuild'); } catch { fail('esbuild is not installed (npm ci installs it with vite)'); }

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ① 묶기 — 진입점은 cloudonym.mjs 와 같다(터미널인지는 여기서 본다). http.mjs 의 버전 읽기(import.meta.url 옆 package.json)는 실행 파일 안에 파일이 없으므로 값으로 바꾼다
const VERSION_READ = "JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))";
let replaced = false;
const bundle = join(OUT, 'cloudonym.cjs');
await esbuild.build({
  stdin: {
    contents: "import { main } from './cli/lib/main.mjs';\nmain(process.argv.slice(2), { tty: { stdin: process.stdin.isTTY === true, stdout: process.stdout.isTTY === true } }).then((code) => { process.exitCode = code; });\n",
    resolveDir: ROOT, sourcefile: 'cli-sea-entry.mjs', loader: 'js',
  },
  bundle: true, platform: 'node', format: 'cjs', target: `node${major}`, outfile: bundle, logLevel: 'warning',
  plugins: [{
    name: 'cli-version',
    setup(b) {
      b.onLoad({ filter: /cli[\\/]lib[\\/]http\.mjs$/ }, (args) => {
        const src = readFileSync(args.path, 'utf-8');
        if (!src.includes(VERSION_READ)) return undefined;
        replaced = true;
        return { contents: src.replace(VERSION_READ, JSON.stringify({ version })), loader: 'js' };
      });
    },
  }],
});
if (!replaced) fail(`cli/lib/http.mjs no longer reads the version as ${VERSION_READ}; update this script`);

// ② blob
const config = join(OUT, 'sea-config.json');
const blob = join(OUT, 'cloudonym.blob');
writeFileSync(config, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false }));
execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });

// ③ 실행 파일 — 이 node 를 복사해 blob 을 넣는다. macOS 는 서명을 떼고 넣은 뒤 ad-hoc 서명(없으면 실행이 막힌다)
const exe = join(OUT, process.platform === 'win32' ? 'cloudonym.exe' : 'cloudonym');
copyFileSync(process.execPath, exe);
chmodSync(exe, 0o755);
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', exe], { stdio: 'inherit' });
execFileSync('npx', ['--yes', POSTJECT, exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', FUSE, ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : [])], { stdio: 'inherit' });
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', exe], { stdio: 'inherit' });

// ④ 돌려 본다 — 파일이 생긴 것이 아니라 CLI 로 도는지
const got = execFileSync(exe, ['--version'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
if (got !== `cloudonym-cli/${version}`) fail(`${exe} --version printed "${got}", expected "cloudonym-cli/${version}"`);
const help = execFileSync(exe, ['completion', 'zsh'], { encoding: 'utf-8' });
if (!help.startsWith('#compdef cloudonym')) fail(`${exe} completion zsh did not print a zsh completion script`);

// ⑤ 꾸러미 · sha256 · Homebrew 공식(채운 사본은 build/ 에만 — 저장소의 틀은 그대로)
const arch = process.arch === 'arm64' ? 'arm64' : process.arch;
const archive = `cloudonym-${version}-${process.platform}-${arch}.tar.gz`;
execFileSync('tar', ['-czf', join(OUT, archive), '-C', OUT, process.platform === 'win32' ? 'cloudonym.exe' : 'cloudonym']);
const sha256 = createHash('sha256').update(readFileSync(join(OUT, archive))).digest('hex');
const url = `https://github.com/uranos-studio/cloudonym/releases/download/v${version}/${archive}`;
const formula = readFileSync(join(ROOT, 'cli', 'packaging', 'homebrew', 'cloudonym.rb.tmpl'), 'utf-8')
  .replaceAll('@VERSION@', version).replaceAll('@URL@', url).replaceAll('@SHA256@', sha256);
if (/@[A-Z0-9_]+@/.test(formula)) fail('the Homebrew template has a placeholder this script does not fill');
// 틀은 macOS arm64 만 받는다(depends_on) — 다른 호스트의 실행 파일로 공식을 채우면 설치가 거부되거나 맞지 않는 파일이 깔린다
const brewTarget = process.platform === 'darwin' && process.arch === 'arm64';
if (brewTarget) writeFileSync(join(OUT, 'cloudonym.rb'), formula);

console.log(`cli-sea: ${exe} (${got}) · ${archive} sha256 ${sha256} · ${brewTarget ? 'build/cli-sea/cloudonym.rb' : 'no Homebrew formula (the template is for macOS arm64 only)'}`);
