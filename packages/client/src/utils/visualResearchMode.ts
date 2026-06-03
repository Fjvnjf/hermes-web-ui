export const VISUAL_RESEARCH_STORAGE_KEY = 'hermes.visualResearchMode'

const VISUAL_RESEARCH_PREFIX = '[Hermes Visual Research Mode - frontend instruction]'
const VISUAL_RESEARCH_SUFFIX = '[End Hermes Visual Research Mode]'
const USER_REQUEST_MARKER = 'User request:'

export const VISUAL_RESEARCH_PRESETS = [
  {
    icon: '🧭',
    label: 'Fill dashboard',
    prompt: 'Research trusted sources and return dashboard-fill candidates grouped by Executive Overview, Market Intelligence, Competitors, Raw Materials, Investment Analysis, Regulatory, Investor Readiness, and Reports. For every field include value, source title, URL/domain, date, confidence, evidence status, reviewRequired, and why it can or cannot auto-fill.',
  },
  {
    icon: '🌍',
    label: 'Market map',
    prompt: 'Build a country-wise market map with consumption/growth signals, source, confidence, evidence status, and gaps to verify.',
  },
  {
    icon: '📈',
    label: 'Country growth',
    prompt: 'Build a country-wise consumption growth tracker for textile softeners and related textile-finishing demand. Separate direct softener evidence from proxy signals such as cotton mill use, textile output, apparel exports, imports, and wet-processing clusters. Include source, date, confidence, evidence status, and next verification task for each country.',
  },
  {
    icon: '🏭',
    label: 'Competitors',
    prompt: 'Build a competitor matrix with product equivalents, price evidence only if sourced, source, confidence, strengths, weaknesses, and To Verify market share where unsupported.',
  },
  {
    icon: '🧾',
    label: 'Suppliers',
    prompt: 'Build supplier scorecards for key raw materials with quote/TDS/SDS/COA evidence gaps, source links, confidence, and suggested next tasks.',
  },
  {
    icon: '💎',
    label: 'Investment',
    prompt: 'Build an investment summary with assumption tables, sensitivity grid, evidence status, risks, and source-backed next actions. Do not present IRR/NPV as verified unless assumptions are approved.',
  },
] as const

export const VISUAL_RESEARCH_INSTRUCTION = `${VISUAL_RESEARCH_PREFIX}
Owner-approved research permission is active for this answer.

When the request needs facts, market data, competitors, finance, product/regulatory details, or other current business evidence:
- Use trusted and verified sources available to you, prioritizing official regulator/government pages, company product pages/catalogs, uploaded evidence, filings, and reputable market references.
- Cite source title, URL/domain, and source or access date for every important external fact.
- Label each key claim as Source-backed, User Provided, Derived from Assumptions, Assumption, To Verify, Missing, or Conflict Detected.
- Do not invent data, market share, prices, CAGR, IRR, NPV, formulas, CAS lists, supplier costs, or investor claims.
- Do not mark anything Verified without clear source evidence and user review.
- If sources conflict, explain the conflict and recommend a review step instead of choosing silently.
- For substantive answers, include good graphical content: Markdown tables, source/evidence matrices, KPI blocks, evidence-gap checklists, and Mermaid diagrams/charts when useful.
- For business/research answers, include at least one useful visual structure (table, matrix, checklist, diagram, or chart-ready summary) unless the user explicitly asks for plain text.
- For market, competitor, raw-material, supplier, finance, or dashboard-filling requests, prefer dense business visuals: country-by-country tables, competitor landscapes, competitor matrices, supplier scorecards, assumption/source matrices, sensitivity grids, and clearly labeled chart-ready summaries.
- Keep graphical output readable in Markdown: use concise column names, split very wide analysis into multiple tables, and put source/confidence/status columns near the right edge.
- For business work, finish with concrete next actions that can become tasks, documents, memory, or report snippets.
${VISUAL_RESEARCH_SUFFIX}

${USER_REQUEST_MARKER}
`

export function buildVisualResearchPrompt(userText: string): string {
  return `${VISUAL_RESEARCH_INSTRUCTION}${userText.trim()}`
}

export function stripVisualResearchPrompt(content: string): string {
  const trimmed = content.trim()
  if (!trimmed.startsWith(VISUAL_RESEARCH_PREFIX)) return content

  const suffixIndex = trimmed.indexOf(VISUAL_RESEARCH_SUFFIX)
  if (suffixIndex < 0) return content

  const markerIndex = trimmed.indexOf(USER_REQUEST_MARKER, suffixIndex + VISUAL_RESEARCH_SUFFIX.length)
  if (markerIndex < 0) return content

  return trimmed.slice(markerIndex + USER_REQUEST_MARKER.length).trim()
}
