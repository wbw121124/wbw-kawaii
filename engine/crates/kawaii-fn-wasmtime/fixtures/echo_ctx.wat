;; 测试 guest：原样输出 ctx_json（验证 ctx 透传）
(module
  (memory (export "memory") 1)
  (global $bump (mut i32) (i32.const 64))

  (func $alloc (export "alloc") (param $n i32) (result i32)
    (local $p i32)
    (local $next i32)
    (local.set $p (global.get $bump))
    (local.set $next
      (i32.and (i32.add (i32.add (local.get $p) (local.get $n)) (i32.const 3))
               (i32.const -4)))
    (if (i32.gt_u (local.get $next) (i32.const 65536))
      (then (return (i32.const 0))))
    (global.set $bump (local.get $next))
    (local.get $p))

  (func (export "transform") (param $in i32) (param $inlen i32)
                               (param $ctx i32) (param $ctxlen i32) (result i64)
    (local $out i32)
    (local $i i32)
    (local.set $out (call $alloc (local.get $ctxlen)))
    (if (i32.eqz (local.get $out)) (then (return (i64.const -1))))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $ctxlen)))
        (i32.store8 (i32.add (local.get $out) (local.get $i))
          (i32.load8_u (i32.add (local.get $ctx) (local.get $i))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (i64.or
      (i64.shl (i64.extend_i32_u (local.get $ctxlen)) (i64.const 32))
      (i64.extend_i32_u (local.get $out)))))
