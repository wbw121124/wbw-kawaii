;; 测试 guest：死循环（fuel 耗尽 trap）
(module
  (memory (export "memory") 1)
  (func (export "alloc") (param i32) (result i32) (i32.const 64))
  (func (export "transform") (param i32 i32 i32 i32) (result i64)
    (loop $l (br $l))
    (i64.const 0)))
