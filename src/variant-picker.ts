// 确定性变体选择器：基于 key 的 sha256 hash 选择变体索引
// 供 transform.ts 和 transform-new.ts 共用，避免重复实现

import * as crypto from 'crypto';

/**
 * 根据 key 的 sha256 hash 确定性选择一个变体索引。
 * 相同 key 永远返回相同索引，不同 key 均匀分布。
 */
export function pickVariantIndex(variants: string[], key: string): number {
  const h = crypto.createHash('sha256').update(key).digest();
  return h.readUInt32BE(0) % variants.length;
}

/**
 * 获取确定性变体文本。
 * @param variants 候选变体数组
 * @param key 用于确定索引的键（如错误码、消息 key）
 * @returns 选中的变体文本
 */
export function pickVariant(variants: string[], key: string): string {
  const idx = pickVariantIndex(variants, key);
  return variants[idx];
}
