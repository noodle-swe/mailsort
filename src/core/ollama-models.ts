export interface RecommendedModel {
  name: string
  /** Download size. */
  size: string
  note: string
  /** The chat assistant needs tool calling; tagging works with any model. */
  tools: boolean
}

/** Models that work well for tagging job mail, smallest graphics cards first. */
export const RECOMMENDED_MODELS: RecommendedModel[] = [
  { name: 'qwen3:1.7b', size: '1.4 GB', tools: true, note: 'Fastest. Fits almost any graphics card.' },
  { name: 'qwen2.5:3b', size: '1.9 GB', tools: true, note: 'Small and quick.' },
  { name: 'llama3.2:3b', size: '2.0 GB', tools: true, note: 'Small, follows instructions well.' },
  { name: 'qwen3:4b', size: '2.5 GB', tools: true, note: 'Good balance. Fits a 4 GB graphics card.' },
  { name: 'gemma3:4b', size: '3.3 GB', tools: false, note: 'Tagging only. No tool calling, so not for the chat.' },
  { name: 'qwen2.5:7b', size: '4.7 GB', tools: true, note: 'More accurate. Needs about 6 GB of video memory.' },
  { name: 'qwen3:8b', size: '5.2 GB', tools: true, note: 'Most accurate of these. Needs about 8 GB.' }
]

/** Whether a model is known to support tool calling: true or false for the listed ones, null when unknown. */
export function supportsTools(name: string): boolean | null {
  const listed = RECOMMENDED_MODELS.find((m) => m.name === name)
  if (listed) return listed.tools
  if (/^gemma|^phi-?[0-9]*(:|$)/i.test(name)) return false
  return null
}
