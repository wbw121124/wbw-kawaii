// 纯文本改写核心（不含 vscode 依赖）：TS diag 表 / zh JSON / 语言包 bundle / bundle 模板串补丁
// 供 patcher.ts 调用 + 单独测试使用。
import * as crypto from 'crypto';

// TS diag 表补丁：正则匹配 diag(key, category, "messageKey", "English text") 行，
// 将 English text 替换为可爱变体。保留原有注释和换行。
export function patchTsDiag(content: string, rules: Record<string, string[]>): { content: string; stats: { hits: number; decorated: number }; changed: boolean } {
  const re = /([A-Za-z_$][\w$]*)\s*:\s*diag\(\s*\d+\s*,\s*[^,]+?,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g;
  let hits = 0, decorated = 0;
  let result = content;
  let changed = false;
  // 用 exec 逐个替换以追踪变化
  let match: RegExpExecArray | null;
  const parts: string[] = [];
  let lastIndex = 0;
  while ((match = re.exec(content)) !== null) {
    const [, propName, msgKey, enText] = match;
    parts.push(content.slice(lastIndex, match.index));
    const variants = rules[msgKey];
    if (variants && variants.length > 0) {
      const h = crypto.createHash('sha256').update(msgKey).digest();
      const idx = h.readUInt32BE(0) % variants.length;
      const cute = variants[idx].replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      // 保留原始 diag 调用格式（前缀不变，仅替换第四个参数）
      const prefix = `${propName}: diag(`;
      // 提取 category 部分（第2-3个逗号之间）
      const afterKey = match[0].slice(match[0].indexOf(msgKey) + msgKey.length);
      const catEnd = afterKey.indexOf('",');
      parts.push(prefix + afterKey.slice(0, catEnd + 1) + `"${cute}")`);
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
  const beforeDecorated = result;
  result = result.replace(/"((?:[^"\\]|\\.)*[^"\\])"\s*\)/g, (m, text) => {
    if (!text.includes('喵~') && text.length > 3) {
      decorated++;
      changed = true;
      return `"${text} 喵~")`;
    }
    return m;
  });
  return { content: result, stats: { hits, decorated }, changed: result !== content || changed };
}

// zh JSON 补丁（jsonObject）：逐行替换 value
export function patchJsonObject(content: string, rules: Record<string, string[]>): { content: string; stats: { hits: number; decorated: number }; changed: boolean } {
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
      const h = crypto.createHash('sha256').update(key).digest();
      const idx = h.readUInt32BE(0) % variants.length;
      const cute = variants[idx];
      if (cute !== val) {
        // 只替换 value 部分，保留 key/缩进/逗号结构
        const indent = line.match(/^(\s*)/)?.[1] ?? '';
        const trailing = line.slice(line.lastIndexOf(val) + val.length);
        lines[i] = `${indent}"${key}": "${cute}"${trailing}`;
        hits++;
        changed = true;
      }
    } else if (val.trim() && !val.endsWith(' 喵~')) {
      const indent = line.match(/^(\s*)/)?.[1] ?? '';
      const trailing = line.slice(line.lastIndexOf(val) + val.length);
      lines[i] = `${indent}"${key}": "${val} 喵~"${trailing}`;
      decorated++;
      changed = true;
    }
  }
  return { content: lines.join(''), stats: { hits, decorated }, changed };
}

// packBundle 补丁（语言包 contents.bundle）
export function patchPackBundle(content: string, rules: Record<string, string[]>): { content: string; stats: { hits: number; decorated: number }; changed: boolean } {
  let obj: any;
  try { obj = JSON.parse(content); } catch {
    return patchJsonObject(content, rules);
  }
  const bundle = obj?.contents?.bundle;
  if (!bundle || typeof bundle !== 'object') return { content, stats: { hits: 0, decorated: 0 }, changed: false };
  let hits = 0, decorated = 0;
  let changed = false;
  for (const [key, val] of Object.entries(bundle)) {
    if (typeof val !== 'string') continue;
    const variants = rules[key];
    if (variants && variants.length > 0) {
      const h = crypto.createHash('sha256').update(key).digest();
      const idx = h.readUInt32BE(0) % variants.length;
      const cute = variants[idx];
      if (cute !== val) {
        bundle[key] = cute;
        hits++;
        changed = true;
      }
    } else if (val.trim() && !val.endsWith(' 喵~') && !val.endsWith('…') && !val.endsWith('~')) {
      bundle[key] = val + ' 喵~';
      decorated++;
      changed = true;
    }
  }
  if (!changed) return { content, stats: { hits: 0, decorated: 0 }, changed: false };
  const compact = JSON.stringify(obj);
  return { content: compact, stats: { hits, decorated }, changed: compact !== content };
}

// bundleTemplate 补丁：在 bundle 中找到并替换模板字面量
export function patchBundleTemplate(content: string, suffix: string): { content: string; stats: { hits: number; decorated: number }; changed: boolean } {
  // 捕获三段：前缀、${...}插值、后缀，保留插值原样
  const re = /`([^`]*)(\$\{[^}]+\})([^`]*)`/g;
  let hits = 0, decorated = 0;
  let changed = false;
  let result = content;
  let m: RegExpExecArray | null;
  const parts: string[] = [];
  let last = 0;
  while ((m = re.exec(content)) !== null) {
    parts.push(content.slice(last, m.index));
    const full = m[1] + m[3]; // 插值前后文本（不含 ${...}）
    if (full.includes('喵~')) {
      parts.push(m[0]);
    } else {
      decorated++;
      parts.push('`' + m[1] + m[2] + m[3] + ' ' + suffix.trim() + '`');
      hits++;
      changed = true;
    }
    last = m.index + m[0].length;
  }
  parts.push(content.slice(last));
  result = parts.join('');
  return { content: result, stats: { hits, decorated }, changed };
}
