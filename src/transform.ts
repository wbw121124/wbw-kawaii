// 纯文本改写核心：不依赖 vscode 模块，便于 node 直接单测。
import { RULES, RULES_VERSION, IDENTITY_VALUES } from './rules.generated';
import * as crypto from 'crypto';
import { getFallbackSuffix, shouldSkipDecorate, KawaiiOptions } from './kawaii-options';
import { pickVariant } from './variant-picker';

export { RULES, RULES_VERSION, IDENTITY_VALUES };
export interface PatchOptions extends KawaiiOptions {}

// 向后兼容：默认兜底后缀（soft 人设）
export const FALLBACK_SUFFIX = " ~";

export type EntryKind = 'null' | 'hit' | 'decorated' | 'kept' | 'already' | 'identity';

export interface EntryResult {
  value: string | null;
  kind: EntryKind;
}

export interface PatchStats {
  total: number;
  nulls: number;
  hits: number;
  decorated: number;
  identity: number;
  kept: number;
  already: number;
  changed: number;
}

export interface PatchResult {
  content: string;
  stats: PatchStats;
  changed: boolean;
}

// 占位符形态：%% | %[方括号] | %字母族+数字下标 | {N}（TS/语言包）。
// RegExp 构造器避免字面量转义歧义；cpptools 文案不含 {N}，扩展不改变其行为。
const TOKEN_RE = new RegExp('%%|%\\[[^\\]]*\\]|%[A-Za-z]+\\d*|\\{\\d+\\}', 'g');

export function tokenize(s: string): string[] {
  return s.match(TOKEN_RE) ?? [];
}

const CUTE_VALUES: Set<string> = (() => {
  const set = new Set<string>();
  for (const variants of Object.values(RULES)) {
    for (const v of variants) set.add(v);
  }
  return set;
})();

// 参考文案原样保留的原文（拼接片段/类型名/标签等）：运行时会被拼进完整消息，
// 兜底后缀若加在这些条目上会注进消息中间，因此一律保持原样
const IDENTITY: ReadonlySet<string> = new Set(IDENTITY_VALUES);

function placeholderSeqEqual(a: string, b: string): boolean {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length !== tb.length) return false;
  for (let i = 0; i < ta.length; i++) {
    if (ta[i] !== tb[i]) return false;
  }
  return true;
}

export function transformValue(value: string, index: number, opts: PatchOptions): EntryResult {
  // 参考保持：identity 条目（多为拼接片段）原样保留，绝不注入后缀
  if (IDENTITY.has(value)) return { value, kind: 'identity' };
  // 幂等保护：已是可爱文案（规则产物）或已带兜底后缀的，不再动
  if (CUTE_VALUES.has(value)) return { value, kind: 'already' };

  const variants = RULES[value];
  if (variants && variants.length > 0) {
    const pick = pickVariant(variants, value);
    if (placeholderSeqEqual(value, pick)) {
      return { value: pick, kind: 'hit' };
    }
    // 占位符序列不一致（生成期已拦截，这里是运行时兜底）→ 落到兜底分支
  }

  // 空串/纯空白是占位片段，装饰后会凭空多出内容
  if (value.trim() === '') return { value, kind: 'kept' };
  const suffix = getFallbackSuffix(opts);
  if (suffix && value.endsWith(suffix)) return { value, kind: 'already' };
  if (shouldSkipDecorate(value, opts.intensity)) return { value, kind: 'kept' };
  if (opts.decorateFallback && suffix) {
    return { value: value.replace(/\\s+$/u, '') + suffix, kind: 'decorated' };
  }
  return { value, kind: 'kept' };
}

interface LineOutcome {
  line: string;
  isEntry: boolean;
  result?: EntryResult;
}

function transformLine(line: string, index: number, opts: PatchOptions): LineOutcome {
  const trimmed = line.trim();
  if (trimmed === '') return { line, isEntry: false };

  const hasComma = trimmed.endsWith(',');
  const body = (hasComma ? trimmed.slice(0, -1) : trimmed).trim();

  if (body === 'null') {
    return { line, isEntry: true, result: { value: null, kind: 'null' } };
  }
  if (!body.startsWith('"')) {
    return { line, isEntry: false }; // '['、']' 等结构行
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { line, isEntry: false };
  }
  if (typeof parsed !== 'string') return { line, isEntry: false };

  const result = transformValue(parsed, index, opts);
  if (result.value === parsed) return { line, isEntry: true, result };

  const indent = line.slice(0, line.length - line.trimStart().length);
  const newLine = indent + JSON.stringify(result.value) + (hasComma ? ',' : '');
  return { line: newLine, isEntry: true, result };
}

function emptyStats(): PatchStats {
  return { total: 0, nulls: 0, hits: 0, decorated: 0, identity: 0, kept: 0, already: 0, changed: 0 };
}

function accumulate(stats: PatchStats, kind: EntryKind): void {
  stats.total++;
  switch (kind) {
    case 'null': stats.nulls++; break;
    case 'hit': stats.hits++; break;
    case 'decorated': stats.decorated++; break;
    case 'identity': stats.identity++; break;
    case 'kept': stats.kept++; break;
    case 'already': stats.already++; break;
  }
}

export function patchContent(content: string, opts: PatchOptions): PatchResult {
  const stats = emptyStats();
  // 按行拆分并保留原始换行符（CRLF/LF/CR 混用也不改变）
  const parts = content.split(/(\r\n|\n|\r)/);
  let entryIndex = 0;
  let changed = false;

  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i];
    const eol = parts[i + 1] ?? '';
    const out = transformLine(line, entryIndex, opts);
    if (out.isEntry) {
      accumulate(stats, out.result!.kind!);
      entryIndex++; // null 也占一个数组索引，保证变体轮转与数组下标对齐
    }
    if (out.line !== line) {
      changed = true;
      stats.changed++;
      parts[i] = out.line;
    }
    parts[i + 1] = eol;
  }

  return { content: parts.join(''), stats, changed };
}

export function formatStats(stats: PatchStats): string {
  return (
    `条目 ${stats.total}（null ${stats.nulls}）| 命中规则 ${stats.hits} | ` +
    `兜底装饰 ${stats.decorated} | 参考保持 ${stats.identity} | 保持原文 ${stats.kept} | ` +
    `已是文案 ${stats.already} | 改写行 ${stats.changed}`
  );
}
