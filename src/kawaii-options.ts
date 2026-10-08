// 可爱强度：控制兜底装饰的激进程度
import { PersonaStyle, getPersona } from './persona';

export type KawaiiIntensity = 'subtle' | 'normal' | 'bold';

export interface KawaiiOptions {
  personaStyle: PersonaStyle;
  intensity: KawaiiIntensity;
  customFallback?: string | null;
  targets?: Record<string, boolean>;
  decorateFallback?: boolean;
}

export function getFallbackSuffix(opts: KawaiiOptions): string {
  if (opts.customFallback !== undefined && opts.customFallback !== null) return opts.customFallback;
  return getPersona(opts.personaStyle).fallbackSuffix;
}

export function shouldSkipDecorate(value: string, intensity: KawaiiIntensity): boolean {
  if (intensity === 'bold') return false;
  if (intensity === 'normal') return false;
  if (/\{\d+\}/.test(value)) return false;
  const plainLen = value.replace(/\{\d+\}/g, '').length;
  return plainLen <= 8;
}
