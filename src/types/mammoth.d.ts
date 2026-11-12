declare module 'mammoth' {
  export function extractRawText(input: { arrayBuffer: ArrayBuffer } | { path: string }): Promise<{ value: string; messages: unknown[] }>
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer } | { path: string }): Promise<{ value: string; messages: unknown[] }>
}
