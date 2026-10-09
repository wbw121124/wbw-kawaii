;; 测试 guest：输出非法 UTF-8 字节
(module
  (memory (export "memory") 1)
  (func $alloc (export "alloc") (param i32) (result i32) (i32.const 64))
  (func (export "transform") (param i32 i32 i32 i32) (result i64)
    (i32.store8 (i32.const 64) (i32.const 255))
    (i32.store8 (i32.const 65) (i32.const 254))
    (i64.or (i64.shl (i64.const 2) (i64.const 32)) (i64.const 64))))
