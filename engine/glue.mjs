// engine.wasm 胶水：手写 C-ABI 封装（浏览器 / Node 通用 ESM，无顶层 await）。
// 协议：输入经 kawaii_alloc 写入线性内存；输出走结果槽（kawaii_result_ptr/len）。
// loadRules 的 `file:` 由 Node 调用方（index.js）先读文本；本层只认 builtin / 原始 DSL。

const enc = new TextEncoder();
const dec = new TextDecoder();

async function toBytes(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (source instanceof URL || (typeof source === 'string' && /^https?:\/\//.test(source))) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`下载 wasm 失败: ${res.status} ${source}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  if (typeof source === 'string') {
    // 文件路径：仅 Node 可达（浏览器端请传 URL 或字节）
    const { readFile } = await import('node:fs/promises');
    return new Uint8Array(await readFile(source));
  }
  throw new Error('不支持的 wasm 来源（需 URL / 路径 / 字节）');
}

function optsJson(opts) {
  return opts === undefined || opts === null ? '' : JSON.stringify(opts);
}

function rulesJson(rules) {
  return rules === undefined || rules === null ? 'null' : JSON.stringify(rules);
}

/**
 * 由已实例化的 wasm instance 构造引擎对象（同步；与 createWasmEngine 返回值镜像）。
 * @param {WebAssembly.Instance} instance
 */
export function engineFromInstance(instance) {
  const exp = instance.exports;

  function allocWrite(str) {
    const data = enc.encode(str);
    if (data.length === 0) return [0, 0];
    const ptr = exp.kawaii_alloc(data.length);
    if (!ptr) throw new Error('wasm 内存分配失败');
    // alloc 可能触发 memory.grow，必须在 alloc 之后取视图
    new Uint8Array(exp.memory.buffer).set(data, ptr);
    return [ptr, data.length];
  }

  function freeInput(ptr, len) {
    if (ptr && len) exp.kawaii_free(ptr, len);
  }

  function readResult() {
    const ptr = exp.kawaii_result_ptr();
    const len = exp.kawaii_result_len();
    if (!len) return '';
    return dec.decode(new Uint8Array(exp.memory.buffer, ptr, len));
  }

  /** 把若干字符串依次写入内存，调用 fn(p0,l0,p1,l1,...)，返回结果槽文本。 */
  function callStrs(fn, strs) {
    const inputs = strs.map(allocWrite);
    try {
      const args = [];
      for (const [p, l] of inputs) args.push(p, l);
      const status = fn(...args);
      const out = readResult();
      if (status !== 0) {
        throw new Error(out || `wasm 调用失败 (status ${status})`);
      }
      return out;
    } finally {
      for (const [p, l] of inputs) freeInput(p, l);
    }
  }

  function callJson(fn, strs) {
    return JSON.parse(callStrs(fn, strs));
  }

  return {
    path: 'wasm',
    transformMessage(msg, opts) {
      return callStrs((...a) => exp.kawaii_transform_message(...a), [
        msg,
        optsJson(opts),
      ]);
    },
    transformMarkdownlint(msg, opts, code) {
      return callStrs((...a) => exp.kawaii_transform_markdownlint(...a), [
        msg,
        optsJson(opts),
        code ?? '',
      ]);
    },
    transformPylint(msg, opts, code) {
      return callStrs((...a) => exp.kawaii_transform_pylint(...a), [
        msg,
        optsJson(opts),
        code ?? '',
      ]);
    },
    transformWhimper(input, opts) {
      return callStrs((...a) => exp.kawaii_transform_whimper(...a), [
        input,
        optsJson(opts),
      ]);
    },
    loadRules(source) {
      if (typeof source === 'string' && source.startsWith('file:')) {
        throw new Error(
          'wasm 直连不支持 file:（无同步 fs）；经 index.js loadEngine 或改用 loadRulesText',
        );
      }
      return callStrs((...a) => exp.kawaii_load_rules(...a), [source]);
    },
    loadRulesText(text) {
      return callStrs((...a) => exp.kawaii_load_rules_text(...a), [text]);
    },
    cyclePersona() {
      const status = exp.kawaii_cycle_persona();
      const out = readResult();
      if (status !== 0) throw new Error(out || 'cyclePersona 失败');
      return out;
    },
    getStats() {
      const status = exp.kawaii_get_stats();
      const out = readResult();
      if (status !== 0) throw new Error(out || 'getStats 失败');
      return JSON.parse(out);
    },

    // ── P4 patch 级 API（与 napi 壳 / TS transform 系列镜像） ──

    tokenize(s) {
      return callJson((...a) => exp.kawaii_tokenize(...a), [s]);
    },
    transformValue(value, index, opts) {
      // index 是标量（TS 内未参与运算），单独走参数位
      const [vp, vl] = allocWrite(value);
      const [op, ol] = allocWrite(optsJson(opts));
      try {
        const status = exp.kawaii_transform_value(vp, vl, index | 0, op, ol);
        const out = readResult();
        if (status !== 0) throw new Error(out || 'transformValue 失败');
        return JSON.parse(out);
      } finally {
        freeInput(vp, vl);
        freeInput(op, ol);
      }
    },
    patchContent(content, opts) {
      return callJson((...a) => exp.kawaii_patch_content(...a), [
        content,
        optsJson(opts),
      ]);
    },
    formatStats(stats) {
      return callStrs((...a) => exp.kawaii_format_stats(...a), [
        JSON.stringify(stats),
      ]);
    },
    patchTsDiag(content, rules, opts) {
      return callJson((...a) => exp.kawaii_patch_ts_diag(...a), [
        content,
        rulesJson(rules),
        optsJson(opts),
      ]);
    },
    patchJsonObject(content, rules, opts) {
      return callJson((...a) => exp.kawaii_patch_json_object(...a), [
        content,
        rulesJson(rules),
        optsJson(opts),
      ]);
    },
    patchPackBundle(content, rules, opts) {
      return callJson((...a) => exp.kawaii_patch_pack_bundle(...a), [
        content,
        rulesJson(rules),
        optsJson(opts),
      ]);
    },
    patchBundleTemplate(content, rules, opts) {
      return callJson((...a) => exp.kawaii_patch_bundle_template(...a), [
        content,
        rulesJson(rules),
        optsJson(opts),
      ]);
    },
    transformMarkdownlintWithRules(msg, rules, opts, code) {
      return callStrs((...a) => exp.kawaii_transform_markdownlint_rules(...a), [
        msg,
        rulesJson(rules),
        optsJson(opts),
        code ?? '',
      ]);
    },
    transformPylintWithRules(msg, rules, opts, code) {
      return callStrs((...a) => exp.kawaii_transform_pylint_rules(...a), [
        msg,
        rulesJson(rules),
        optsJson(opts),
        code ?? '',
      ]);
    },
  };
}

/**
 * 实例化 engine.wasm 并返回引擎对象（与 native 壳 API 镜像）。
 * @param {string|URL|Uint8Array|ArrayBuffer} wasmSource wasm 字节 / 文件路径 / URL
 */
export async function createWasmEngine(wasmSource) {
  const bytes = await toBytes(wasmSource);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return engineFromInstance(instance);
}
