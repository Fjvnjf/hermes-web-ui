import { describe, expect, it } from 'vitest'
import {
  buildVisualResearchPrompt,
  stripVisualResearchPrompt,
  VISUAL_RESEARCH_PRESETS,
} from '../../packages/client/src/utils/visualResearchMode'

describe('visual research mode prompt wrapper', () => {
  it('adds source-backed visual research instructions around the user request', () => {
    const prompt = buildVisualResearchPrompt('Research CWAS market evidence')

    expect(prompt).toContain('Owner-approved research permission is active')
    expect(prompt).toContain('source/evidence matrices')
    expect(prompt).toContain('country-by-country tables')
    expect(prompt).toContain('supplier scorecards')
    expect(prompt).toContain('competitor matrices')
    expect(prompt).toContain('at least one useful visual structure')
    expect(prompt).toContain('fieldKey')
    expect(prompt).toContain('reviewRequired')
    expect(prompt).toContain('riskReason')
    expect(prompt).toContain('approved dashboard truth')
    expect(prompt).toContain('Research CWAS market evidence')
  })

  it('provides one-click visual research presets for common business analysis needs', () => {
    expect(VISUAL_RESEARCH_PRESETS.map(preset => preset.label)).toEqual([
      'Fill dashboard',
      'Market map',
      'Country growth',
      'Competitors',
      'Suppliers',
      'Investment',
    ])
    expect(VISUAL_RESEARCH_PRESETS.map(preset => preset.icon)).toEqual(['🧭', '🌍', '📈', '🏭', '🧾', '💎'])
    expect(VISUAL_RESEARCH_PRESETS[0].prompt).toContain('dashboard-fill candidates')
    expect(VISUAL_RESEARCH_PRESETS[0].prompt).toContain('Supplier Scorecards')
    expect(VISUAL_RESEARCH_PRESETS[0].prompt).toContain('fieldKey')
    expect(VISUAL_RESEARCH_PRESETS[0].prompt).toContain('source tier')
    expect(VISUAL_RESEARCH_PRESETS[0].prompt).toContain('reviewRequired')
    expect(VISUAL_RESEARCH_PRESETS[0].prompt).toContain('dashboard_updates JSON')
    expect(VISUAL_RESEARCH_PRESETS[0].prompt).toContain('do not approve investor material automatically')
    expect(VISUAL_RESEARCH_PRESETS[1].prompt).toContain('country-wise market map')
    expect(VISUAL_RESEARCH_PRESETS[2].prompt).toContain('direct softener evidence')
    expect(VISUAL_RESEARCH_PRESETS[2].prompt).toContain('proxy signals')
    expect(VISUAL_RESEARCH_PRESETS[3].prompt).toContain('To Verify market share')
    expect(VISUAL_RESEARCH_PRESETS[4].prompt).toContain('supplier scorecards')
    expect(VISUAL_RESEARCH_PRESETS[5].prompt).toContain('IRR/NPV')
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
