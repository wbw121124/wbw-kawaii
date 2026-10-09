;; 测试 guest：带 import（必须在加载期被拒）
(module
  (import "env" "log" (func $log (param i32)))
  (memory (export "memory") 1)
  (func (export "alloc") (param i32) (result i32) (i32.const 64))
  (func (export "transform") (param i32 i32 i32 i32) (result i64)
    (i64.const 0)))
