// 人设定义：不同 persona 对应不同的兜底后缀、彩蛋文案和风格偏好。
export type PersonaStyle = 'soft' | 'tsundere' | 'derriere' | 'cool';

export interface Persona {
  name: string;
  fallbackSuffix: string;
  easterEggMessage: string;
  statusEmoji: string;
}

const PERSONAS: Record<PersonaStyle, Persona> = {
  soft: { name: '软萌', fallbackSuffix: ' ~', easterEggMessage: '你不要再批话了，不然我就不理你了~', statusEmoji: '🌸' },
  tsundere: { name: '傲娇', fallbackSuffix: ' 哼~', easterEggMessage: '哼，笨蛋！再这样说就不理你了哦~', statusEmoji: '🔥' },
  derriere: { name: '毒舌', fallbackSuffix: ' ……真是的', easterEggMessage: '……真是的，别说了啦。', statusEmoji: '😒' },
  cool: { name: '冷淡可爱', fallbackSuffix: '', easterEggMessage: '', statusEmoji: '❄️' },
};

export function getPersona(style: PersonaStyle): Persona { return PERSONAS[style] ?? PERSONAS.soft; }
export function getAllPersonaStyles(): PersonaStyle[] { return (Object.keys(PERSONAS) as PersonaStyle[]); }

export const WHIMPER_KEYWORDS = [
  '我太菜了', '我是蒟蒻', '我是蛆', '我是虫', '我连蛆都不如',
  '太菜了', '太弱了', '弱爆了', '不会写', '好菜', '我太弱了',
  '不会', '太笨了', '笨死了', '菜鸡', '蒟蒻',
];

export function isWhimperInput(text: string): boolean {
  return WHIMPER_KEYWORDS.some(kw => text.includes(kw));
}
