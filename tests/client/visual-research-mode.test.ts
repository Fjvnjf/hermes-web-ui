import { describe, expect, it } from 'vitest'
import {
  buildVisualResearchPrompt,
  stripVisualResearchPrompt,
} from '../../packages/client/src/utils/visualResearchMode'

describe('visual research mode prompt wrapper', () => {
  it('adds source-backed visual research instructions around the user request', () => {
    const prompt = buildVisualResearchPrompt('Research CWAS market evidence')

    expect(prompt).toContain('Owner-approved research permission is active')
    expect(prompt).toContain('source/evidence matrices')
    expect(prompt).toContain('Research CWAS market evidence')
  })

  it('strips the frontend instruction before displaying user messages', () => {
    const prompt = buildVisualResearchPrompt('Show verified competitor evidence')

    expect(stripVisualResearchPrompt(prompt)).toBe('Show verified competitor evidence')
  })

  it('leaves ordinary messages untouched', () => {
    expect(stripVisualResearchPrompt('Normal chat message')).toBe('Normal chat message')
    expect(stripVisualResearchPrompt('[Hermes Visual Research Mode - frontend instruction] partial')).toBe(
      '[Hermes Visual Research Mode - frontend instruction] partial',
    )
  })
})
