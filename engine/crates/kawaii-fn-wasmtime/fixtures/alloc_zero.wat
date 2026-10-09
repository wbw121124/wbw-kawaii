;; 测试 guest：alloc 恒返回 0（分配失败路径）
(module
  (memory (export "memory") 1)
  (func (export "alloc") (param i32) (result i32) (i32.const 0))
  (func (export "transform") (param i32 i32 i32 i32) (result i64)
    (i64.const 0)))
