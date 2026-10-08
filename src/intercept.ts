// 运行时拦截：transform 任意扩展的 DiagnosticCollection 中的诊断消息。
// 原理：替换 vscode.languages.createDiagnosticCollection 的返回值，
// 使其 set() 方法自动调用 transformFn 对消息进行可爱化。
// 注意：在 Node.js 测试环境中 vscode 模块不可用，此时函数静默 no-op。
let _vscode: any = null;
try { _vscode = require('vscode'); } catch {}

export type MessageTransformFn = (source: string, message: string, code?: string) => string;

const PATCHED_SYMBOL = Symbol('wbw-kawaii-patched');

export function interceptDiagnosticCollection(
  source: string,
  transformFn: MessageTransformFn
): void {
  if (!_vscode) return; // 非 VS Code 环境（如测试）静默跳过
  const ext = _vscode.languages as any;
  const symbols = ext[PATCHED_SYMBOL];
  if (!symbols) { ext[PATCHED_SYMBOL] = new Set<string>(); }
  if (ext[PATCHED_SYMBOL].has(source)) return;
  ext[PATCHED_SYMBOL].add(source);

  const originalCreate = _vscode.languages.createDiagnosticCollection.bind(_vscode.languages);
    (_vscode.languages as any).createDiagnosticCollection = function (
    idOrName?: any
  ): any {
    const collection = originalCreate(idOrName);
    const name = typeof idOrName === 'string' ? idOrName : '';
    const shouldIntercept = name.toLowerCase().includes(source.toLowerCase());
    if (!shouldIntercept || (collection as any)[PATCHED_SYMBOL]) return collection;

    const originalSet = (collection as any).set.bind(collection);
    (collection as any)[PATCHED_SYMBOL] = true;
    (collection as any).set = function (...args: any[]): void {
      const entries = args[0];
      if (entries === null) { originalSet.apply(collection, args); return; }
      if (entries instanceof Map) {
        for (const [, diags] of entries) { transformDiagnostics(diags, source, transformFn); }
        originalSet.apply(collection, args);
        return;
      }
      if (Array.isArray(entries)) {
        for (const [, diags] of entries) { transformDiagnostics(diags, source, transformFn); }
        originalSet.apply(collection, args);
        return;
      }
      if (entries && typeof entries.then === 'function') {
        // Uri-like object
        originalSet.apply(collection, args);
        return;
      }
      originalSet.apply(collection, args);
    };
    return collection;
  };
}

function transformDiagnostics(
  diags: readonly any[],
  source: string,
  transformFn: MessageTransformFn
): void {
  for (const d of diags) {
    if (d?.source?.toLowerCase().includes(source.toLowerCase()) && typeof d.message === 'string') {
      d.message = transformFn(source, d.message, normalizeCode(d?.code));
    }
  }
}

// diagnostic.code 可能是 string | number | { value, target }，统一成字符串
function normalizeCode(code: unknown): string | undefined {
  if (typeof code === 'string') return code;
  if (typeof code === 'number') return String(code);
  if (code && typeof code === 'object') {
    const v = (code as any).value;
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}
