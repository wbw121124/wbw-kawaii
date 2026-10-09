;; 测试 guest：直接返回 -1（主动报错）
(module
  (memory (export "memory") 1)
  (func (export "alloc") (param i32) (result i32) (i32.const 64))
  (func (export "transform") (param i32 i32 i32 i32) (result i64)
    (i64.const -1)))
