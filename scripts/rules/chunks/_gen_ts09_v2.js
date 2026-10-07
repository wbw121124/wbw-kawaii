const fs = require('fs');
const input = JSON.parse(fs.readFileSync('G:/wbw-kawaii/scripts/rules/inventory/ts.json', 'utf8'));
const chunk = input.slice(1440, 1620);
const result = [];

function extractPh(zh) {
  return zh.match(/\{\d+\}/g) || [];
}

function cleanBase(zh) {
  return zh.replace(/[。！？]$/, '');
}

function genVariant1(base, phs) {
  // V1: direct cute rephrase with varied endings
  const endings = ['哦~', '啦', '嘛', '呀', '呢', '咯'];
  const mid = base.replace(/[。！？]$/, '');
  // Use different ending based on content
  if (base.includes('不能') || base.includes('不可') || base.includes('不允许') || base.includes('无效')) {
    return mid + '不行哦~';
  } else if (base.includes('必须') || base.includes('需要') || base.includes('要')) {
    return mid + '才行呢';
  } else if (base.includes('建议') || base.includes('请') || base.includes('考虑') || base.includes('试试')) {
    return mid + '吧~';
  } else if (base.includes('显示') || base.includes('正在') || base.includes('已')) {
    return mid + '咯~';
  } else if (base.includes('找不到') || base.includes('不存在') || base.includes('没有')) {
    return mid + '呢喵~';
  } else {
    return mid + endings[Math.floor(Math.random() * endings.length)];
  }
}

function genVariant2(base, phs) {
  // V2: "欸" style with different angle
  const mid = base.replace(/[。！？]$/, '');
  const starters = ['欸', '欸？', '噫', '哼'];
  const starter = starters[Math.floor(Math.random() * starters.length)];
  
  if (base.includes('不能') || base.includes('不可') || base.includes('不允许')) {
    return starter + '，' + mid + '呀~';
  } else if (base.includes('必须') || base.includes('需要') || base.includes('要')) {
    return starter + '，' + mid + '咯喵~';
  } else if (base.includes('建议') || base.includes('请') || base.includes('考虑') || base.includes('试试')) {
    return starter + '，' + mid + '吧~';
  } else if (base.includes('找不到') || base.includes('不存在') || base.includes('没有')) {
    return starter + '，' + mid + '呢~';
  } else if (base.includes('显示') || base.includes('正在') || base.includes('已')) {
    return starter + '，' + mid + '咯~';
  } else {
    return starter + '，' + mid + '喵~';
  }
}

for (const entry of chunk) {
  const zh = entry.zh || entry.en;
  const phs = extractPh(zh);
  const key = entry.key;
  
  let v1, v2;
  
  // Handle specific patterns for more natural Chinese
  if (zh.includes('将') && zh.includes('设置为')) {
    // "将...设置为..." pattern
    v1 = '把' + zh.replace('将', '').replace('设置为', '改成') + '就好啦';
    v2 = '欸，' + zh.replace('将', '') + '嘛~';
  } else if (zh.includes('显示') && !zh.includes('诊断')) {
    v1 = zh + '咯~';
    v2 = '噫，' + zh.replace('显示', '秀出来') + '喵~';
  } else if (zh.includes('跳过')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('不能') || zh.includes('不可') || zh.includes('不允许')) {
    v1 = zh.replace('不能', '没法').replace('不可', '没法').replace('不允许', '不认') + '哦~';
    v2 = '欸，' + zh + '呀~';
  } else if (zh.includes('必须') || zh.includes('需要')) {
    v1 = zh.replace('必须', '得').replace('需要', '得') + '才行呢';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('建议') || zh.includes('请') || zh.includes('考虑')) {
    v1 = zh + '吧~';
    v2 = '欸，' + zh + '咯~';
  } else if (zh.includes('找不到') || zh.includes('不存在') || zh.includes('没有')) {
    v1 = zh + '呢喵~';
    v2 = '欸，' + zh + '呀~';
  } else if (zh.includes('已') && zh.includes('创建')) {
    v1 = zh.replace('已成功', '搞定啦') + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('正在')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '进行中喵~';
  } else if (zh.includes('更新')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '中喵~';
  } else if (zh.includes('使用')) {
    v1 = '用' + zh.replace('使用', '') + '就行啦~';
    v2 = '欸，' + zh + '吧喵~';
  } else if (zh.includes('指定')) {
    v1 = zh + '嘛~';
    v2 = '欸，' + zh + '咯喵~';
  } else if (zh.includes('错误') || zh.includes('报错')) {
    v1 = zh + '哦~';
    v2 = '欸，' + zh + '呢喵~';
  } else if (zh.includes('参数')) {
    v1 = zh + '哦~';
    v2 = '欸，' + zh + '呀喵~';
  } else if (zh.includes('类型') && zh.includes('不兼容')) {
    v1 = zh + '呢喵~';
    v2 = '欸，' + zh + '啦~';
  } else if (zh.includes('赋值') || zh.includes('分配')) {
    v1 = zh + '哦~';
    v2 = '欸，' + zh + '呀~';
  } else if (zh.includes('导出') || zh.includes('导入')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('模块')) {
    v1 = zh + '哦~';
    v2 = '欸，' + zh + '呀喵~';
  } else if (zh.includes('函数')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('变量')) {
    v1 = zh + '哦~';
    v2 = '欸，' + zh + '呀喵~';
  } else if (zh.includes('属性')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('语句')) {
    v1 = zh + '哦~';
    v2 = '欸，' + zh + '呀喵~';
  } else if (zh.includes('表达式')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('签名')) {
    v1 = zh + '哦~';
    v2 = '欸，' + zh + '呀喵~';
  } else if (zh.includes('声明')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('标记') || zh.includes('注释')) {
    v1 = zh + '哦~';
    v2 = '欸，' + zh + '呀喵~';
  } else if (zh.includes('文件')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('路径')) {
    v1 = zh + '哦~';
    v2 = '欸，' + zh + '呀喵~';
  } else if (zh.includes('选项')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('参数')) {
    v1 = zh + '哦~';
    v2 = '欸，' + zh + '呀喵~';
  } else if (zh.includes('目标')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('源')) {
    v1 = zh + '哦~';
    v2 = '欸，' + zh + '呀喵~';
  } else if (zh.includes('类型') && zh.includes('推断')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('推断')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('循环')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('约束') || zh.includes('泛型')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('迭代') || zh.includes('枚举')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('元组')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('装饰器') || zh.includes('修饰符')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('运算符') || zh.includes('操作')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('类型谓词') || zh.includes('类型断言')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('重载')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('箭头')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('解构') || zh.includes('析构')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('展开') || zh.includes('spread')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('静态') || zh.includes('static')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('异步') || zh.includes('async')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('生成器')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('Promise') || zh.includes('承诺')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('类型别名') || zh.includes('类型别名')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('接口')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('类')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('枚举') || zh.includes('enum')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('命名空间')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('项目') || zh.includes('编译')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('监视') || zh.includes('watch')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('增量')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('诊断')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('正则')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('Unicode')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('JSX')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('模块')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes(' CommonJS')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else if (zh.includes('ESM') || zh.includes('ECMAScript')) {
    v1 = zh + '咯~';
    v2 = '欸，' + zh + '喵~';
  } else {
    // Generic fallback
    v1 = cleanBase(zh) + '哦~';
    v2 = '欸，' + cleanBase(zh) + '呢喵~';
  }
  
  // Ensure variants are not equal to base and not equal to each other
  if (v1 === zh) v1 = cleanBase(zh) + '咯~';
  if (v2 === zh || v2 === v1) v2 = '噫，' + cleanBase(zh) + '呀喵~';
  
  // Ensure no trailing period
  v1 = v1.replace(/[。]$/, '');
  v2 = v2.replace(/[。]$/, '');
  
  // Ensure no double spaces
  v1 = v1.replace(/  +/g, ' ');
  v2 = v2.replace(/  +/g, ' ');
  
  result.push({ key, variants: [v1, v2] });
}

fs.writeFileSync('G:/wbw-kawaii/scripts/rules/chunks/ts-09.json', JSON.stringify(result, null, null), 'utf8');
console.log('Written', result.length, 'entries');
