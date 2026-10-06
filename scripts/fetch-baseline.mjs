#!/usr/bin/env node
// 从 Visual Studio Marketplace 下载 ms-vscode.cpptools 各版本 vsix，
// 提取 extension/bin/messages/zh-cn/messages.json 到 assets/baseline/orig-<version>.json。
// 用法: node scripts/fetch-baseline.mjs [--force]
// 基线文件不进 git（Microsoft 内容，仅构建期使用）。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets', 'baseline');
const ENTRY = 'extension/bin/messages/zh-cn/messages.json';

// 规则生成需要的基准 + 覆盖率测试用的最新版
const VERSIONS = ['1.34.4', '1.19.7', '1.35.3'];
const PLATFORM = 'win32-x64';

const force = process.argv.includes('--force');

function vspackageUrl(version) {
  return `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/ms-vscode/vsextensions/cpptools/${version}/vspackage?targetPlatform=${PLATFORM}`;
}

function gunzipIfNeeded(buf) {
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return zlib.gunzipSync(buf);
  }
  return buf;
}

// 最小 zip 中央目录读取（无第三方依赖）
function unzipEntry(buf, entryName) {
  let eocd = -1;
  const min = Math.max(0, buf.length - 65558);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: EOCD 未找到');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('zip: 中央目录损坏');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    if (name === entryName) {
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`zip: 不支持的压缩方法 ${method}`);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`zip: 条目不存在 ${entryName}`);
}

async function downloadNode(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return gunzipIfNeeded(Buffer.from(await res.arrayBuffer()));
}

function downloadPwsh(url, dest) {
  // 系统代理兜底（本地开发机若走代理，设置 HTTPS_PROXY 环境变量即可）
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const ps = `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${url}' -OutFile '${dest}' -UseBasicParsing${proxy ? ` -Proxy '${proxy}'` : ''}`;
  const r = spawnSync('pwsh', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('pwsh 下载失败');
  return gunzipIfNeeded(fs.readFileSync(dest));
}

async function download(url) {
  try {
    return await downloadNode(url);
  } catch (e) {
    console.warn(`  node fetch 失败（${e.message}），改用 pwsh...`);
    const tmp = path.join(OUT_DIR, '.download.tmp');
    const buf = downloadPwsh(url, tmp);
    fs.rmSync(tmp, { force: true });
    return buf;
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const version of VERSIONS) {
  const out = path.join(OUT_DIR, `orig-${version}.json`);
  if (fs.existsSync(out) && !force) {
    console.log(`[skip] ${version} 已存在`);
    continue;
  }
  console.log(`[下载] cpptools ${version} ...`);
  let buf = null;
  let lastErr;
  for (const url of [vspackageUrl(version), vspackageUrl(version).split('?')[0]]) {
    try {
      buf = await download(url);
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!buf) throw lastErr;
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) throw new Error(`${version}: 返回内容不是 zip/vsix`);
  const json = unzipEntry(buf, ENTRY);
  JSON.parse(json.toString('utf8')); // 校验可解析
  fs.writeFileSync(out, json);
  console.log(`[完成] ${path.relative(ROOT, out)} (${json.length} bytes)`);
}
console.log('全部完成。');
