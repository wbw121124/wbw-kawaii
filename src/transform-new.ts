// 纯文本改写核心（不含 vscode 依赖）：TS diag 表 / zh JSON / 语言包 bundle / bundle 模板串补丁
// 供 patcher.ts 调用 + 单独测试使用。
import * as crypto from 'crypto';
import { getFallbackSuffix, shouldSkipDecorate, KawaiiOptions } from './kawaii-options';

const DEFAULT_OPTS: KawaiiOptions = { personaStyle: 'soft', intensity: 'normal' };

function getOpts(opts: KawaiiOptions | undefined): KawaiiOptions {
  return opts ?? DEFAULT_OPTS;
}

function pickVariant(variants: string[], key: string): string {
  const h = crypto.createHash('sha256').update(key).digest();
  const idx = h.readUInt32BE(0) % variants.length;
  return variants[idx];
}

// TS diag 表补丁：正则匹配 diag(key, category, "messageKey", "English text") 行，
// 将 English text 替换为可爱变体。保留原有注释和换行。
export function patchTsDiag(
  content: string,
  rules: Record<string, string[]>,
  opts?: KawaiiOptions
): { content: string; stats: { hits: number; decorated: number }; changed: boolean } {
  const o = getOpts(opts);
  const suffix = getFallbackSuffix(o);
  const re = /([A-Za-z_$][\w$]*)\s*:\s*diag\(\s*\d+\s*,\s*[^,]+?,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g;
  let hits = 0, decorated = 0;
  let result = content;
  let changed = false;
  let match: RegExpExecArray | null;
  const parts: string[] = [];
  let lastIndex = 0;
  while ((match = re.exec(content)) !== null) {
    const [, propName, msgKey, enText] = match;
    parts.push(content.slice(lastIndex, match.index));
    const variants = rules[msgKey];
    if (variants && variants.length > 0) {
      const cute = pickVariant(variants, msgKey).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const afterKey = match[0].slice(match[0].indexOf(msgKey) + msgKey.length);
      const catEnd = afterKey.indexOf('",');
      parts.push(`${propName}: diag(${afterKey.slice(0, catEnd + 1)}"${cute}")`);
      hits++;
      changed = true;
    } else {
      parts.push(match[0]);
    }
    lastIndex = match.index + match[0].length;
  }
  parts.push(content.slice(lastIndex));
  result = parts.join('');

  // 兜底：未命中的英文文本加后缀
  result = result.replace(/"((?:[^"\\]|\\.)*[^"\\])"\s*\)/g, (m, text) => {
    if (!text.includes(suffix) && text.length > 3 && !shouldSkipDecorate(text, o.intensity)) {
      decorated++;
      changed = true;
      return `"${text} ${suffix}")`;
    }
    return m;
  });
  return { content: result, stats: { hits, decorated }, changed: result !== content || changed };
}

// zh JSON 补丁（jsonObject）：逐行替换 value
export function patchJsonObject(
  content: string,
  rules: Record<string, string[]>,
  opts?: KawaiiOptions
): { content: string; stats: { hits: number; decorated: number }; changed: boolean } {
  const o = getOpts(opts);
  const suffix = getFallbackSuffix(o);
  const lines = content.split(/(\r\n|\n|\r)/);
  let hits = 0, decorated = 0;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i % 2 === 1) continue;
    const m = line.match(/^\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2];
    const variants = rules[key];
    if (variants && variants.length > 0) {
      const cute = pickVariant(variants, key);
      if (cute !== val) {
        const indent = line.match(/^(\s*)/)?.[1] ?? '';
        const trailing = line.slice(line.indexOf(val) + val.length);
        lines[i] = `${indent}"${key}": "${cute}"${trailing}`;
        hits++;
        changed = true;
      }
    } else if (val.trim() && !val.endsWith(suffix) && !shouldSkipDecorate(val, o.intensity)) {
      const indent = line.match(/^(\s*)/)?.[1] ?? '';
      const trailing = line.slice(line.lastIndexOf(val) + val.length);
      lines[i] = `${indent}"${key}": "${val}${suffix}"${trailing}`;
      decorated++;
      changed = true;
    }
  }
  return { content: lines.join(''), stats: { hits, decorated }, changed };
}

// packBundle 补丁（语言包 contents.bundle）
export function patchPackBundle(
  content: string,
  rules: Record<string, string[]>,
  opts?: KawaiiOptions
): { content: string; stats: { hits: number; decorated: number }; changed: boolean } {
  const o = getOpts(opts);
  const suffix = getFallbackSuffix(o);
  let obj: any;
  try { obj = JSON.parse(content); } catch {
    return patchJsonObject(content, rules, opts);
  }
  const bundle = obj?.contents?.bundle;
  if (!bundle || typeof bundle !== 'object') return { content, stats: { hits: 0, decorated: 0 }, changed: false };
  let hits = 0, decorated = 0;
  let changed = false;
  for (const [key, val] of Object.entries(bundle)) {
    if (typeof val !== 'string') continue;
    const variants = rules[key];
    if (variants && variants.length > 0) {
      const cute = pickVariant(variants, key);
      if (cute !== val) {
        bundle[key] = cute;
        hits++;
        changed = true;
      }
    } else if (val.trim() && !val.endsWith(suffix) && !val.endsWith('…') && !val.endsWith('~') && !shouldSkipDecorate(val, o.intensity)) {
      bundle[key] = val + suffix;
      decorated++;
      changed = true;
    }
  }
  if (!changed) return { content, stats: { hits: 0, decorated: 0 }, changed: false };
  const compact = JSON.stringify(obj);
  return { content: compact, stats: { hits, decorated }, changed: compact !== content };
}

// bundleTemplate 补丁：在 bundle 中找到并替换模板字面量
export function patchBundleTemplate(
  content: string,
  rules: Record<string, string[]> | null,
  opts?: KawaiiOptions
): { content: string; stats: { hits: number; decorated: number }; changed: boolean } {
  const o = getOpts(opts);
  const suffix = getFallbackSuffix(o);
  const re = /`([^`]*)(\$\{[^}]+\})([^`]*)`/g;
  let hits = 0, decorated = 0;
  let changed = false;
  let result = content;
  let m: RegExpExecArray | null;
  const parts: string[] = [];
  let last = 0;
  while ((m = re.exec(content)) !== null) {
    parts.push(content.slice(last, m.index));
    const full = m[1] + m[3];
    if (full.includes(suffix)) {
      parts.push(m[0]);
    } else {
      decorated++;
      parts.push('`' + m[1] + m[2] + m[3] + suffix + '`');
      hits++;
      changed = true;
    }
    last = m.index + m[0].length;
  }
  parts.push(content.slice(last));
  result = parts.join('');
  return { content: result, stats: { hits, decorated }, changed };
}

// MarkdownLint 消息变换：按 ruleCode 查规则表，变 description 部分
// 消息格式："MD013" 或 "MD001/atx: heading style"
export function transformMarkdownlint(
  message: string,
  rules: Record<string, string[]>,
  opts?: KawaiiOptions
): string {
  const o = getOpts(opts);
  const suffix = getFallbackSuffix(o);
  const m = message.match(/^([A-Z]{2}\d{3}(?:\/[\w-]+)?):\s*(.*)$/);
  if (!m) return message;
  const [, code, desc] = m;
  const variants = rules[code];
  if (variants && variants.length > 0) {
    return `${code}: ${pickVariant(variants, code)}`;
  }
  if (desc.trim() && !desc.endsWith(suffix)) {
    return `${code}: ${desc} ${suffix}`;
  }
  return message;
}

// PyLint 消息变换：按 msg_id 查规则表，变 description 部分
// 消息格式："C0114: Missing module docstring"
export function transformPylint(
  message: string,
  rules: Record<string, string[]>,
  opts?: KawaiiOptions
): string {
  const o = getOpts(opts);
  const suffix = getFallbackSuffix(o);
  const m = message.match(/^([A-Za-z]\d{4}):?\s*(.*)$/);
  if (!m) return message;
  const [, code, desc] = m;
  const variants = rules[code];
  if (variants && variants.length > 0) {
    return `${code}: ${pickVariant(variants, code)}`;
  }
  if (desc.trim() && !desc.endsWith(suffix)) {
    return `${code}: ${desc} ${suffix}`;
  }
  return message;
}
