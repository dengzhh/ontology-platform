import { type ClassValue } from './types'

/** 拼接 tailwind 类名（忽略空值） */
export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(' ')
}

/** 简单确定性伪随机（用于示例数据，保证每次渲染一致） */
export function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}
