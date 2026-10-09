;; 测试 guest：请求 +200 页（12.8MB）内存——超出 StoreLimits 上限
(module
  (memory (export "memory") 1)
  (func (export "alloc") (param i32) (result i32) (i32.const 64))
  (func (export "transform") (param i32 i32 i32 i32) (result i64)
    (if (i32.eq (memory.grow (i32.const 200)) (i32.const -1))
      (then (return (i64.const -1))))
    (i64.const 0)))
