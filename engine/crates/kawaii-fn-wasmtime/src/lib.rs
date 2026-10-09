//! Wasmtime 沙箱宿主：按名注册用户 wasm 模块，为 `call("name", ...)` 提供执行。
//!
//! 安全边界（v1）：
//! - **不授 WASI**，guest 零 import（加载时校验，`Linker` 空表二次兜底）；
//! - **fuel 预算**：单次调用超预算即 trap；
//! - **内存上限**：`StoreLimits` 限制线性内存增长，`alloc` 返回 0 视为失败；
//! - **输出限制**：长度封顶 + 必须合法 UTF-8，越界读即拒绝；
//! - 返回值破坏占位符不变量 → 由 core 求值层拒绝回滚（本层不感知）。
//!
//! ABI v1：guest 导出 `memory`、`alloc(i32)->i32`、
//! `transform(in_ptr, in_len, ctx_ptr, ctx_len) -> i64`
//! （`(len << 32) | ptr`，`-1` = guest 报错），可选 `dealloc(ptr, len)`。
#![deny(warnings)]

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use kawaii_core::fnhost::CustomFnHost;
use wasmtime::{
    Config, Engine, ExternType, InstancePre, Linker, Module, Store, StoreLimits,
    StoreLimitsBuilder, TypedFunc,
};

/// 单次调用 fuel 预算（覆盖恶意死循环；正常消息转换 < 1%）。
const FUEL: u64 = 50_000_000;
/// guest 线性内存上限（128 页）。
const MEMORY_LIMIT: usize = 128 * 65_536;
/// 返回长度上限（错误消息远小于此；防 guest 谎报超大长度）。
const MAX_OUTPUT: usize = 64 * 1024;

/// Store 携带的限制状态。
struct StoreState {
    limits: StoreLimits,
}

/// 按名注册的模块（编译一次，实例按调用新建——池化留后续优化）。
struct Loaded {
    pre: InstancePre<StoreState>,
}

/// Wasmtime 宿主。构造成本高（编译器初始化），进程内复用一个实例。
pub struct WasmtimeHost {
    engine: Engine,
    modules: Mutex<HashMap<String, Loaded>>,
}

impl Default for WasmtimeHost {
    fn default() -> Self {
        Self::new()
    }
}

impl WasmtimeHost {
    pub fn new() -> Self {
        let mut cfg = Config::new();
        cfg.consume_fuel(true);
        // 显式关掉非 MVP 能力；wasi 相关本就不在 Config 默认里（Linker 空表）
        cfg.wasm_multi_memory(false);
        cfg.wasm_component_model(false);
        let engine = Engine::new(&cfg).expect("wasmtime Engine 构造失败");
        Self {
            engine,
            modules: Mutex::new(HashMap::new()),
        }
    }

    /// 编译并注册一个模块（覆盖同名）。
    pub fn load_module(&self, name: &str, wasm: &[u8]) -> Result<(), String> {
        let module = Module::new(&self.engine, wasm)
            .map_err(|e| format!("`{name}` 编译失败: {e}"))?;
        validate(&module, name)?;
        let linker: Linker<StoreState> = Linker::new(&self.engine);
        // 空 Linker：guest 任何 import 都会在 instantiate 时失败（validate 已提前拦）
        let pre = linker
            .instantiate_pre(&module)
            .map_err(|e| format!("`{name}` 链接失败: {e}"))?;
        self.modules
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(name.to_string(), Loaded { pre });
        Ok(())
    }

    /// 从目录加载全部 `*.wasm`（文件名 stem 为函数名），返回注册名单。
    pub fn load_dir(&self, dir: &Path) -> Result<Vec<String>, String> {
        if !dir.is_dir() {
            return Err(format!("{} 不是目录", dir.display()));
        }
        let mut names = Vec::new();
        let mut entries: Vec<_> = std::fs::read_dir(dir)
            .map_err(|e| format!("读取目录失败: {e}"))?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("wasm"))
            .collect();
        entries.sort();
        for path in entries {
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .ok_or_else(|| format!("非法文件名: {}", path.display()))?
                .to_string();
            let bytes =
                std::fs::read(&path).map_err(|e| format!("读取 {} 失败: {e}", path.display()))?;
            self.load_module(&stem, &bytes)?;
            names.push(stem);
        }
        Ok(names)
    }

    /// 已注册函数名（排序）。
    pub fn names(&self) -> Vec<String> {
        let mut v: Vec<String> = self
            .modules
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .keys()
            .cloned()
            .collect();
        v.sort();
        v
    }

    fn call_inner(&self, name: &str, input: &str, ctx_json: &str) -> Result<String, String> {
        let pre = {
            let guard = self.modules.lock().unwrap_or_else(|e| e.into_inner());
            guard
                .get(name)
                .map(|l| l.pre.clone())
                .ok_or_else(|| format!("未注册的自定义函数 `{name}`"))?
        };

        let limits = StoreLimitsBuilder::new()
            .memory_size(MEMORY_LIMIT)
            .instances(4)
            .tables(4)
            .build();
        let mut store = Store::new(
            &self.engine,
            StoreState { limits },
        );
        store.limiter(|s| &mut s.limits);
        store
            .set_fuel(FUEL)
            .map_err(|e| format!("fuel 设置失败: {e}"))?;

        let instance = pre
            .instantiate(&mut store)
            .map_err(|e| format!("`{name}` 实例化失败: {e}"))?;
        let memory = instance
            .get_memory(&mut store, "memory")
            .ok_or_else(|| format!("`{name}` 未导出 memory"))?;
        let alloc: TypedFunc<i32, i32> = instance
            .get_typed_func(&mut store, "alloc")
            .map_err(|e| format!("`{name}` 缺少 alloc 导出: {e}"))?;
        let transform: TypedFunc<(i32, i32, i32, i32), i64> = instance
            .get_typed_func(&mut store, "transform")
            .map_err(|e| format!("`{name}` 缺少 transform 导出: {e}"))?;

        // 输入缓冲：input + ctx 连续放一块
        let in_bytes = input.as_bytes();
        let ctx_bytes = ctx_json.as_bytes();
        let total = in_bytes.len() + ctx_bytes.len();
        if total == 0 {
            return Err(format!("`{name}` 输入为空"));
        }
        let buf = alloc
            .call(&mut store, total as i32)
            .map_err(|e| format!("`{name}` alloc 失败: {e}"))?;
        if buf <= 0 {
            return Err(format!("`{name}` 内存分配被拒（超出内存上限）"));
        }
        let data = memory.data_mut(&mut store);
        let start = buf as usize;
        let end = start + total;
        let slot = data
            .get_mut(start..end)
            .ok_or_else(|| format!("`{name}` 写入越界"))?;
        slot[..in_bytes.len()].copy_from_slice(in_bytes);
        slot[in_bytes.len()..].copy_from_slice(ctx_bytes);

        let ret = transform
            .call(&mut store, (buf, in_bytes.len() as i32, buf + in_bytes.len() as i32, ctx_bytes.len() as i32))
            .map_err(|e| map_trap(name, e))?;
        if ret == -1 {
            return Err(format!("`{name}` guest 报错"));
        }
        if ret < 0 {
            return Err(format!("`{name}` 返回非法值 {ret}"));
        }
        let out_ptr = ((ret as u64) & 0xFFFF_FFFF) as usize;
        let out_len = ((ret as u64) >> 32) as usize;
        if out_len == 0 {
            return Err(format!("`{name}` 返回空输出"));
        }
        if out_len > MAX_OUTPUT {
            return Err(format!("`{name}` 输出超长 ({out_len} > {MAX_OUTPUT})"));
        }
        let out = {
            let data = memory.data(&store);
            let range = data
                .get(out_ptr..out_ptr + out_len)
                .ok_or_else(|| format!("`{name}` 读取越界"))?;
            String::from_utf8(range.to_vec())
                .map_err(|_| format!("`{name}` 输出不是合法 UTF-8"))?
        };

        // 可选 dealloc：尽力释放输入块（失败不致命）
        if let Ok(dealloc) = instance.get_typed_func::<(i32, i32), ()>(&mut store, "dealloc") {
            let _ = dealloc.call(&mut store, (buf, total as i32));
        }
        Ok(out)
    }
}

impl CustomFnHost for WasmtimeHost {
    fn call(&self, name: &str, input: &str, ctx_json: &str) -> Result<String, String> {
        self.call_inner(name, input, ctx_json)
    }

    fn kind(&self) -> &'static str {
        "wasmtime"
    }
}

/// 加载期校验：零 import、memory/alloc/transform 三件套类型正确。
fn validate(module: &Module, name: &str) -> Result<(), String> {
    if module.imports().next().is_some() {
        return Err(format!(
            "`{name}` 不得有 import（沙箱不授 WASI，仅允许纯 core wasm）"
        ));
    }
    let mut mem = false;
    let mut alloc = false;
    let mut transform = false;
    for e in module.exports() {
        match e.name() {
            "memory" => mem = matches!(e.ty(), ExternType::Memory(_)),
            "alloc" => {
                alloc = matches!(&e.ty(), ExternType::Func(f)
                    if sig_matches(f,
                        &[wasmtime::ValType::I32],
                        &[wasmtime::ValType::I32]))
            }
            "transform" => {
                transform = matches!(&e.ty(), ExternType::Func(f)
                    if sig_matches(f,
                        &[
                            wasmtime::ValType::I32,
                            wasmtime::ValType::I32,
                            wasmtime::ValType::I32,
                            wasmtime::ValType::I32,
                        ],
                        &[wasmtime::ValType::I64]))
            }
            _ => {}
        }
    }
    if !mem || !alloc || !transform {
        return Err(format!(
            "`{name}` 必须导出 memory + alloc(i32)->i32 + transform(i32,i32,i32,i32)->i64（memory={mem} alloc={alloc} transform={transform}）"
        ));
    }
    Ok(())
}

/// 函数签名精确匹配（wasmtime 49 `ValType` 无 `PartialEq`，用自带 `eq`）。
fn sig_matches(f: &wasmtime::FuncType, params: &[wasmtime::ValType], results: &[wasmtime::ValType]) -> bool {
    let p: Vec<wasmtime::ValType> = f.params().collect();
    let r: Vec<wasmtime::ValType> = f.results().collect();
    p.len() == params.len()
        && r.len() == results.len()
        && p.iter().zip(params).all(|(a, b)| wasmtime::ValType::eq(a, b))
        && r.iter().zip(results).all(|(a, b)| wasmtime::ValType::eq(a, b))
}

/// trap → 人类可读错误（fuel 耗尽单独点名）。
fn map_trap(name: &str, e: wasmtime::Error) -> String {
    if let Some(fuel) = e.downcast_ref::<wasmtime::Trap>() {
        if *fuel == wasmtime::Trap::OutOfFuel {
            return format!("`{name}` 执行超出燃料预算（疑似死循环）");
        }
        return format!("`{name}` trap: {fuel}");
    }
    format!("`{name}` 执行失败: {e}")
}
