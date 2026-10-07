const fs = require('fs');
const input = JSON.parse(fs.readFileSync('G:/wbw-kawaii/scripts/rules/inventory/ts.json', 'utf8'));
const chunk = input.slice(1440, 1620);
const result = [];

function p(zh) { return zh.match(/\{\d+\}/g) || []; }
function cl(zh) { return zh.replace(/[。！？]$/, ''); }

// Hand-crafted variant generation per entry type
const gen = (zh, idx) => {
  const base = cl(zh);
  const phs = p(zh);
  const hasPh = phs.length > 0;
  
  // Error/forbidden patterns
  if (/不能返回/.test(zh)) return [base + '哦~', '欸，' + base + '呀喵~'];
  if (/只能在.*文件中使用/.test(zh)) return [base + '咯~', '欸，' + base + '呢喵~'];
  if (/不允许/.test(zh)) return [base + '不行哦~', '欸，' + base + '呀~'];
  if (/无效的/.test(zh) || /无效/.test(zh)) return [base + '哦~', '欸，' + base + '呢喵~'];
  
  // Must/required patterns
  if (/必须/.test(zh) && !/不能/.test(zh)) return [base + '才行呢', '欸，' + base + '喵~'];
  if (/需要/.test(zh) && !/不能/.test(zh)) return [base + '才行哦~', '欸，' + base + '呀喵~'];
  
  // Suggestion patterns
  if (/建议|请考虑|试试|可以|应该/.test(zh)) return [base + '吧~', '欸，' + base + '咯喵~'];
  
  // "将...设置为" pattern
  if (/将.*设置为/.test(zh)) {
    const v1 = base.replace('将', '把').replace('设置为', '改成') + '就好啦';
    const v2 = '欸，' + base.replace('将', '把') + '嘛~';
    return [v1, v2];
  }
  
  // Skip patterns
  if (/跳过/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Show/display patterns
  if (/显示/.test(zh) && !/诊断/.test(zh)) return [base + '咯~', '噫，' + base.replace('显示', '秀出来') + '喵~'];
  if (/显示.*诊断/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Successfully patterns
  if (/已成功/.test(zh) || /成功创建/.test(zh)) return [base.replace('已成功', '搞定啦') + '咯~', '欸，' + base + '喵~'];
  
  // Updating patterns
  if (/正在更新/.test(zh) || /更新.*时间戳/.test(zh)) return [base + '中咯~', '欸，' + base + '中喵~'];
  
  // Using patterns
  if (/使用/.test(zh) && !/cannot be used/.test(zh)) return [base + '就行啦~', '欸，' + base + '吧喵~'];
  
  // Specify patterns
  if (/指定/.test(zh)) return [base + '嘛~', '欸，' + base + '咯喵~'];
  
  // Target/source patterns
  if (/目标仅允许/.test(zh) || /目标只需要/.test(zh)) return [base + '哦~', '欸，' + base + '呢喵~'];
  if (/源具有/.test(zh) || /源有/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  if (/源不提供/.test(zh)) return [base + '哦~', '欸，' + base + '呢喵~'];
  
  // Modifier/修饰符 patterns
  if (/修饰符/.test(zh)) return [base + '哦~', '欸，' + base + '呀喵~'];
  
  // Signature/签名 patterns
  if (/签名/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Type/类型 patterns
  if (/类型.*不兼容/.test(zh) || /类型.*不匹配/.test(zh)) return [base + '呢喵~', '欸，' + base + '啦~'];
  if (/类型.*不能/.test(zh) || /类型.*不可/.test(zh)) return [base + '哦~', '欸，' + base + '呀喵~'];
  if (/类型.*没有/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  if (/类型.*不是/.test(zh)) return [base + '哦~', '欸，' + base + '呢喵~'];
  if (/类型.*缺少/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  if (/推断.*类型/.test(zh) || /类型.*推断/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  if (/类型.*无法/.test(zh)) return [base + '哦~', '欸，' + base + '呀喵~'];
  if (/类型.*不满足/.test(zh)) return [base + '哦~', '欸，' + base + '呢喵~'];
  if (/类型.*不可与/.test(zh)) return [base + '哦~', '欸，' + base + '呀喵~'];
  if (/类型.*不能赋/.test(zh) || /类型.*不可赋/.test(zh)) return [base + '哦~', '欸，' + base + '呀喵~'];
  if (/类型.*不是泛型/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  if (/类型.*循环/.test(zh) || /循环.*引用/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  if (/循环约束/.test(zh) || /循环默认/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Operator/运算符 patterns
  if (/运算符/.test(zh)) return [base + '哦~', '欸，' + base + '呀喵~'];
  if (/操作数/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  if (/左侧/.test(zh) || /右侧/.test(zh)) return [base + '哦~', '欸，' + base + '呢喵~'];
  
  // Expression/表达式 patterns
  if (/表达式/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Statement/语句 patterns
  if (/语句/.test(zh)) return [base + '哦~', '欸，' + base + '呢喵~'];
  
  // Property/属性 patterns
  if (/属性/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Variable/变量 patterns
  if (/变量/.test(zh)) return [base + '哦~', '欸，' + base + '呢喵~'];
  
  // Import/export/导入导出 patterns
  if (/导入/.test(zh) || /导出/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Module/模块 patterns
  if (/模块/.test(zh)) return [base + '哦~', '欸，' + base + '呢喵~'];
  
  // File/文件 patterns
  if (/文件/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Function/函数 patterns
  if (/函数/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Parameter/参数 patterns
  if (/参数/.test(zh)) return [base + '哦~', '欸，' + base + '呢喵~'];
  
  // Call/调用 patterns
  if (/调用/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Class/类 patterns
  if (/类/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Interface/接口 patterns
  if (/接口/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Return/返回 patterns
  if (/返回/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Promise/承诺 patterns
  if (/Promise/.test(zh) || /承诺/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Async/异步 patterns
  if (/异步/.test(zh) || /async/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Iterator/迭代 patterns
  if (/迭代/.test(zh) || /iterator/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // For/循环 patterns
  if (/for.*in/.test(zh) || /for.*of/.test(zh) || /for await/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Spread/展开 patterns
  if (/展开/.test(zh) || /spread/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Static/静态 patterns
  if (/静态/.test(zh) || /static/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Delete/删除 patterns
  if (/delete/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Instanceof patterns
  if (/instanceof/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Arrow/箭头 patterns
  if (/箭头/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Decorator/装饰器 patterns
  if (/装饰器/.test(zh) || /修饰器/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Override/覆盖 patterns
  if (/override/.test(zh) || /覆盖/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // JSDoc patterns
  if (/JSDoc/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // JSX patterns
  if (/JSX/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Tag/标记 patterns
  if (/标记/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Syntax/语法 patterns
  if (/语法/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Regular expression/正则 patterns
  if (/正则/.test(zh) || /regexp/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Unicode patterns
  if (/Unicode/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Token/标记 patterns
  if (/标记/.test(zh) || /token/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Expected/期望 patterns
  if (/期望/.test(zh) || /expected/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Unexpected/意外 patterns
  if (/意外/.test(zh) || /unexpected/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Unknown/未知 patterns
  if (/未知/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Cannot find/找不到 patterns
  if (/找不到/.test(zh) || /不存在/.test(zh) || /没有/.test(zh)) return [base + '呢喵~', '欸，' + base + '呀~'];
  
  // Can only be used/只能被用 patterns
  if (/只能/.test(zh) && /使用/.test(zh)) return [base + '哦~', '欸，' + base + '呀喵~'];
  
  // Has no /没有 patterns
  if (/没有/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Is not /不是 patterns
  if (/不是/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Is not assignable /不可分配 patterns
  if (/不可分配/.test(zh) || /不能分配/.test(zh)) return [base + '哦~', '欸，' + base + '呀喵~'];
  
  // Are incompatible /不兼容 patterns
  if (/不兼容/.test(zh)) return [base + '呢喵~', '欸，' + base + '啦~'];
  
  // Has no match /没有匹配 patterns
  if (/没有匹配/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Too large /太大 patterns
  if (/太大/.test(zh) || /过深/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Missing /缺少 patterns
  if (/缺少/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Conflict/冲突 patterns
  if (/冲突/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Reduce to never /缩减为 never patterns
  if (/never/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Deprecated/弃用 patterns
  if (/弃用/.test(zh) || /deprecated/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Shadow/遮蔽 patterns
  if (/阴影/.test(zh) || /遮蔽/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Project/项目 patterns
  if (/项目/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Build/构建 patterns
  if (/构建/.test(zh) || /build/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Emit/发出 patterns
  if (/发出/.test(zh) || /emitting/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Watch/监视 patterns
  if (/监视/.test(zh) || /watch/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Option/选项 patterns
  if (/选项/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Target/目标 patterns
  if (/目标/.test(zh) && !/targeting/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Source/源 patterns
  if (/源/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Position/位置 patterns
  if (/位置/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Member/成员 patterns
  if (/成员/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Method/方法 patterns
  if (/方法/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Property/属性 patterns (also handled above)
  if (/属性/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Value/值 patterns
  if (/值/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Name/名称 patterns
  if (/名称/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Path/路径 patterns
  if (/路径/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Directory/目录 patterns
  if (/目录/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Root/根 patterns
  if (/根/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Default/默认 patterns
  if (/默认/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Export assignment/导出赋值 patterns
  if (/导出分配/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Ambient/环境 patterns
  if (/环境/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Constraint/约束 patterns
  if (/约束/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Generic/泛型 patterns
  if (/泛型/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Tuple/元组 patterns
  if (/元组/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Intersection/交集 patterns
  if (/交集/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Union/联合 patterns
  if (/联合/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Intrinsic/内置 patterns
  if (/intrinsic/.test(zh) || /内部/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Factory/工厂 patterns
  if (/工厂/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Fragment/片段 patterns
  if (/片段/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Literal/文本 patterns
  if (/文本/.test(zh) || /字面量/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Escape/转义 patterns
  if (/转义/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Trailing/尾部 patterns
  if (/尾随/.test(zh) || /尾/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Unterminated/未终止 patterns
  if (/未终止/.test(zh)) return [base + '咯~', '欸，' + base + '喵~'];
  
  // Placeholder handling - ensure placeholders are preserved
  let v1 = base + '哦~';
  let v2 = '欸，' + base + '呢喵~';
  
  // Ensure not equal to original
  if (v1 === zh) v1 = base + '咯~';
  if (v2 === zh || v2 === v1) v2 = '噫，' + base + '呀喵~';
  
  // Ensure no trailing period
  v1 = v1.replace(/[。]$/, '');
  v2 = v2.replace(/[。]$/, '');
  
  // Ensure no double spaces
  v1 = v1.replace(/  +/g, ' ');
  v2 = v2.replace(/  +/g, ' ');
  
  return [v1, v2];
};

for (let i = 0; i < chunk.length; i++) {
  const entry = chunk[i];
  const zh = entry.zh || entry.en;
  const key = entry.key;
  const [v1, v2] = gen(zh, i);
  result.push({ key, variants: [v1, v2] });
}

fs.writeFileSync('G:/wbw-kawaii/scripts/rules/chunks/ts-09.json', JSON.stringify(result, null, null), 'utf8');
console.log('Written', result.length, 'entries');
