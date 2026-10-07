// targets-manifest：记录本次扩展改写的所有文件（绝对路径），供卸载钩子还原。
// 格式: { targets: [{ id, file, backupFile, metaFile, state, sourceVersion }] }
// 由 patcher 在每次成功补丁后更新；卸载钩子只处理 state=patched 的文件。
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ManifestTarget {
  id: string;
  file: string;
  backupFile: string;
  metaFile: string;
  state: 'patched' | 'restored' | 'inactive';
  sourceVersion: string;
}

export interface Manifest {
  version: 1;
  updatedAt: string;
  locale: string;
  rulesVersion: string;
  targets: ManifestTarget[];
}

const MANIFEST_NAME = 'targets-manifest.json';

export function readManifest(extDir: string): Manifest | null {
  const p = path.join(extDir, MANIFEST_NAME);
  try {
    if (!fs.existsSync(p)) return null;
    const v = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (v && v.version === 1 && Array.isArray(v.targets)) return v as Manifest;
    return null;
  } catch { return null; }
}

export function writeManifest(extDir: string, manifest: Manifest): void {
  fs.writeFileSync(path.join(extDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

export function buildManifest(targets: ManifestTarget[]): Manifest {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    locale: process.env.VSCODE_LANGUAGE ?? 'unknown',
    rulesVersion: '', // 由调用方填充
    targets
  };
}
