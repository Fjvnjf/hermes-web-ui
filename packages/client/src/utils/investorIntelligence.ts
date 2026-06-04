export type IntelligenceEvidenceStatus =
  | 'Missing'
  | 'To Verify'
  | 'Assumption'
  | 'Powerful Assumption'
  | 'Source-backed'
  | 'Official Data'
  | 'Trusted Source Auto-Updated'
  | 'Supplier Evidence'
  | 'Market Reference'
  | 'Trade Proxy'
  | 'Candidate Source'
  | 'Conflict Detected'
  | 'Derived from Assumptions'
  | 'Hypothesis'
  | 'Reference Only'
  | 'User Provided'
  | 'User Approved'
  | 'Investor Approved'
  | 'Approved Assumption'
  | 'Verified'

export interface SourceReference {
  title: string
  url?: string
  date?: string
}

export interface MarketClaim {
  id?: string
  label: string
  value?: string
  source?: SourceReference | null
  confidence?: 'low' | 'medium' | 'high'
  evidenceStatus: IntelligenceEvidenceStatus
  lastChecked?: string
}

export interface PresentationMaterial {
  id?: string
  section: string
  content: string
  evidenceStatus: IntelligenceEvidenceStatus
  source?: SourceReference | null
  updatedAt?: string
}

export interface ReadinessItem {
  label: string
  evidenceStatus: IntelligenceEvidenceStatus
  weight?: number
}

export interface PresentationDraftSection {
  section: string
  content: string
  evidenceStatus: IntelligenceEvidenceStatus
  sourceLabel: string
  sourceDetail: string
}

export interface InvestorSlideDraft {
  section: string
  status: 'Ready' | 'Missing / To Verify'
  materials: PresentationDraftSection[]
  content: string
  missingAction: string
}

export interface InvestorNextAction {
  id: string
  title: string
  reason: string
  routeName: string
  routeLabel: string
  evidenceStatus: IntelligenceEvidenceStatus | 'Pending Review' | 'Not Started'
  priority: 'high' | 'medium' | 'low'
}

interface NextActionEvidenceItem extends ReadinessItem {
  id?: string
  description?: string
  nextAction?: string
}

interface NextActionResearchFinding {
  keyClaim?: string
  summary?: string
  status: string
}

interface NextActionFinancialModel {
  scenarioName: string
  evidenceStatus: IntelligenceEvidenceStatus
  warnings?: string[]
}

interface NextActionResearchJob {
  title: string
  status: string
}

export interface InvestorNextActionSource {
  evidenceItems: NextActionEvidenceItem[]
  marketClaims: MarketClaim[]
  competitors: Array<{
    companyName?: string
    evidenceStatus: IntelligenceEvidenceStatus
    source?: SourceReference | null
  }>
  presentationMaterials: PresentationMaterial[]
  researchJobs: NextActionResearchJob[]
  researchFindings: NextActionResearchFinding[]
  financialModels: NextActionFinancialModel[]
}

export const INVESTOR_PRESENTATION_SECTIONS = [
  'Cover',
  'Executive Summary',
  'Problem / Opportunity',
  'Chemicon Background',
  'Product Plan',
  'China Feasibility',
  'Raw Material Strategy',
  'Market Evidence',
  'Competitor Landscape',
  'Manufacturing Plan',
  'Factory / Plant Plan',
  'Regulatory Plan',
  'Regulatory / EHS',
  'Financial Model',
  'IRR / Investor Return',
  'IRR / NPV / Payback',
  'Use of Funds',
  'Risk & Mitigation',
  'Evidence / Data Room',
  'Next Steps',
]

export function sourceIsUsable(source?: SourceReference | null): boolean {
  return Boolean(source?.title?.trim() && (source.url?.trim() || source.date?.trim()))
}

export function formatSourceReference(source?: SourceReference | null): string {
  const title = source?.title?.trim()
  if (!title) return 'Source search running'
  const details = [source?.url?.trim(), source?.date?.trim()].filter(Boolean).join(' / ')
  return details ? `${title} (${details})` : title
}

export const AUTOMATIC_VERIFICATION_LABEL = 'Hermes verifying twice daily'

export function displayEvidenceStatus(status?: string | null): string {
  const normalized = String(status || '').trim()
  if (!normalized || normalized === 'To Verify') return AUTOMATIC_VERIFICATION_LABEL
  if (normalized === 'Missing' || normalized === 'Missing / To Verify') return AUTOMATIC_VERIFICATION_LABEL
  if (normalized === 'Trade Proxy / To Verify') return `Trade Proxy / ${AUTOMATIC_VERIFICATION_LABEL}`
  return normalized
}

export function displayUnresolvedValue(value?: string | number | null): string {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized === 'To Verify') return AUTOMATIC_VERIFICATION_LABEL
  if (normalized === 'Missing' || normalized === 'Missing / To Verify') return AUTOMATIC_VERIFICATION_LABEL
  if (normalized === 'Trade Proxy / To Verify') return `Trade Proxy / ${AUTOMATIC_VERIFICATION_LABEL}`
  return normalized
}

export function displayAutomaticVerificationText(text?: string | null): string {
  return String(text || '')
    .replace(/Missing \/ To Verify/g, AUTOMATIC_VERIFICATION_LABEL)
    .replace(/Trade Proxy \/ To Verify/g, `Trade Proxy / ${AUTOMATIC_VERIFICATION_LABEL}`)
    .replace(/\bTo Verify\b/g, AUTOMATIC_VERIFICATION_LABEL)
}

export function canMarkMarketClaimVerified(claim: MarketClaim): boolean {
  return Boolean(claim.value?.trim() && sourceIsUsable(claim.source))
}

export function normalizedMarketClaimStatus(claim: MarketClaim): IntelligenceEvidenceStatus {
  if ((claim.evidenceStatus === 'Verified' || claim.evidenceStatus === 'Source-backed') && !canMarkMarketClaimVerified(claim)) return 'To Verify'
  if (!claim.value?.trim()) return 'To Verify'
  return claim.evidenceStatus
}

export function presentationSectionForEvidence(area?: string, text = ''): string {
  const normalizedArea = (area || '').toLowerCase()
  const lower = `${normalizedArea} ${text}`.toLowerCase()

  if (lower.includes('competitor')) return 'Competitor Landscape'
  if (lower.includes('use of funds') || lower.includes('funding')) return 'Use of Funds'
  if (lower.includes('risk') || lower.includes('mitigation')) return 'Risk & Mitigation'
  if (lower.includes('raw material') || lower.includes('supplier') || lower.includes('sourcing')) return 'Raw Material Strategy'
  if (lower.includes('irr') || lower.includes('npv') || lower.includes('payback') || lower.includes('return')) return 'IRR / Investor Return'
  if (lower.includes('data room') || lower.includes('source document') || lower.includes('evidence room')) return 'Evidence / Data Room'
  if (lower.includes('market') || lower.includes('customer') || lower.includes('demand') || lower.includes('price')) return 'Market Evidence'
  if (lower.includes('regulatory') || lower.includes('dms') || lower.includes('permit') || lower.includes('permission')) return 'Regulatory Plan'
  if (lower.includes('factory') || lower.includes('plant') || lower.includes('manufacturing') || lower.includes('machine')) return 'Manufacturing Plan'
  if (lower.includes('product') || lower.includes('cwas') || lower.includes('cwms') || lower.includes('sds') || lower.includes('tds') || lower.includes('cas')) return 'Product Plan'
  if (lower.includes('company') || lower.includes('legal') || lower.includes('license') || normalizedArea === 'companylegal') return 'Chemicon Background'

  if (normalizedArea === 'product') return 'Product Plan'
  if (normalizedArea === 'factory') return 'Manufacturing Plan'
  if (normalizedArea === 'regulatory') return 'Regulatory Plan'
  if (normalizedArea === 'market') return 'Market Evidence'
  if (normalizedArea === 'financial') return 'IRR / Investor Return'
  if (normalizedArea === 'presentation') return 'Evidence / Data Room'
  return 'Executive Summary'
}

export function formatMarketShare(value?: string | null): string {
  return value?.trim() ? value.trim() : 'To Verify'
}

export function formatSourcedMarketShare(
  value: string | null | undefined,
  source: SourceReference | null | undefined,
  evidenceStatus: IntelligenceEvidenceStatus,
): string {
  const trimmed = value?.trim() || ''
  if (!trimmed) return 'To Verify'
  if (evidenceStatus === 'Assumption' || evidenceStatus === 'Powerful Assumption' || evidenceStatus === 'Approved Assumption') return `${evidenceStatus}: ${trimmed}`
  if ((evidenceStatus === 'Verified' || evidenceStatus === 'Source-backed' || evidenceStatus === 'User Approved') && sourceIsUsable(source)) return trimmed
  return 'To Verify'
}

export function isPresentationMaterialAllowed(material: PresentationMaterial): boolean {
  if (!material.content.trim()) return false
  if (material.evidenceStatus === 'Verified' || material.evidenceStatus === 'Source-backed') return sourceIsUsable(material.source)
  return material.evidenceStatus === 'User Approved' ||
    material.evidenceStatus === 'Investor Approved' ||
    material.evidenceStatus === 'Powerful Assumption' ||
    material.evidenceStatus === 'Approved Assumption' ||
    material.evidenceStatus === 'Derived from Assumptions'
}

export function buildInvestorPresentationDraft(materials: PresentationMaterial[]): PresentationDraftSection[] {
  return materials
    .filter(isPresentationMaterialAllowed)
    .map(material => ({
      section: material.section,
      content: material.content,
      evidenceStatus: material.evidenceStatus,
      sourceLabel: material.source?.title ||
        (material.evidenceStatus === 'Source-backed'
          ? 'Source-backed material'
          : material.evidenceStatus === 'Investor Approved'
            ? 'Investor approved'
            : material.evidenceStatus === 'Powerful Assumption'
              ? 'Powerful assumption'
          : material.evidenceStatus === 'Approved Assumption'
          ? 'Approved assumption'
          : material.evidenceStatus === 'Derived from Assumptions'
            ? 'Derived from assumptions'
            : 'User approved'),
      sourceDetail: material.source
        ? formatSourceReference(material.source)
        : material.evidenceStatus === 'Source-backed'
          ? 'Source-backed material requires source title plus URL or date'
          : material.evidenceStatus === 'Investor Approved'
            ? 'Investor approved material'
            : material.evidenceStatus === 'Powerful Assumption'
              ? 'Powerful assumption - not a fact; source validation still recommended'
          : material.evidenceStatus === 'Approved Assumption'
          ? 'Approved assumption - source not required, but label must stay visible'
          : material.evidenceStatus === 'Derived from Assumptions'
            ? 'Derived from assumption-labeled financial model'
            : 'User approved - source optional',
    }))
}

export function buildInvestorSlideOutline(slideSections: string[], materials: PresentationMaterial[]): InvestorSlideDraft[] {
  const approved = buildInvestorPresentationDraft(materials)
  return slideSections.map(section => {
    const sectionMaterials = approved.filter(item => item.section === section)
    return {
      section,
      status: sectionMaterials.length > 0 ? 'Ready' : 'Missing / To Verify',
      materials: sectionMaterials,
      content: sectionMaterials.map(item => item.content).join('\n\n'),
      missingAction: `Add verified, user-approved, or assumption-labeled material for ${section}.`,
    }
  })
}

export function formatInvestorPresentationOutline(slides: InvestorSlideDraft[]): string {
  const readySlides = slides.filter(slide => slide.status === 'Ready')
  const missingSlides = slides.filter(slide => slide.status !== 'Ready')
  return [
    '# Investor Presentation Draft',
    '',
    'Generated from approved material only. This is draft text, not final truth.',
    `Ready slides: ${readySlides.length}/${slides.length}`,
    missingSlides.length ? `Missing / To Verify slides: ${missingSlides.map(slide => slide.section).join(', ')}` : 'Missing / To Verify slides: none',
    '',
    ...slides.map(slide => [
      `## ${slide.section}`,
      `Status: ${slide.status}`,
      slide.materials.length
        ? slide.materials.map(item => [
            item.content,
            `Evidence status: ${item.evidenceStatus}`,
            `Source: ${item.sourceDetail || item.sourceLabel}`,
          ].join('\n')).join('\n\n')
        : slide.missingAction,
    ].join('\n\n')),
  ].join('\n\n---\n\n')
}

function routeForEvidenceArea(id?: string): string {
  if (id === 'market') return 'hermes.marketIntelligence'
  if (id === 'financial') return 'hermes.investmentCalculator'
  if (id === 'presentation') return 'hermes.investorPresentation'
  if (id === 'factory') return 'hermes.kanban'
  if (id === 'regulatory') return 'hermes.chat'
  return 'hermes.investorReadiness'
}

function actionPriority(status: IntelligenceEvidenceStatus): InvestorNextAction['priority'] {
  if (status === 'Missing') return 'high'
  if (status === 'To Verify' || status === 'Hypothesis') return 'medium'
  return 'low'
}

export function buildInvestorNextActions(source: InvestorNextActionSource): InvestorNextAction[] {
  const actions: InvestorNextAction[] = []
  const evidenceGaps = source.evidenceItems
    .filter(item => item.evidenceStatus === 'Missing' || item.evidenceStatus === 'To Verify')
    .sort((a, b) => {
      if (a.evidenceStatus === b.evidenceStatus) return (b.weight || 1) - (a.weight || 1)
      return a.evidenceStatus === 'Missing' ? -1 : 1
    })

  for (const item of evidenceGaps.slice(0, 2)) {
    actions.push({
      id: `evidence-${item.id || item.label}`,
      title: `Resolve ${item.label}`,
      reason: item.nextAction || item.description || 'Create or collect source evidence before using this in investor material.',
      routeName: routeForEvidenceArea(item.id),
      routeLabel: item.id === 'factory' ? 'Tasks' : item.id === 'regulatory' ? 'Chat' : 'Open evidence area',
      evidenceStatus: item.evidenceStatus,
      priority: actionPriority(item.evidenceStatus),
    })
  }

  const pendingFindings = source.researchFindings.filter(item => item.status === 'Pending Review' || item.status === 'To Verify')
  if (pendingFindings.length > 0) {
    actions.push({
      id: 'research-findings',
      title: `Review ${pendingFindings.length} research finding${pendingFindings.length === 1 ? '' : 's'}`,
      reason: 'Approve, reject, or keep findings To Verify before they affect readiness or investor material.',
      routeName: 'hermes.researchResultReview',
      routeLabel: 'Review results',
      evidenceStatus: 'Pending Review',
      priority: 'high',
    })
  }

  const latestFinancialModel = source.financialModels[0] || null
  if (!latestFinancialModel) {
    actions.push({
      id: 'financial-model',
      title: 'Save a financial model snapshot',
      reason: 'Use the IRR calculator to capture a scenario with evidence-status labels before discussing investor returns.',
      routeName: 'hermes.investmentCalculator',
      routeLabel: 'Open IRR calculator',
      evidenceStatus: 'Not Started',
      priority: 'medium',
    })
  } else if (latestFinancialModel.warnings?.length || latestFinancialModel.evidenceStatus !== 'Verified') {
    actions.push({
      id: 'financial-review',
      title: `Review ${latestFinancialModel.scenarioName} financial assumptions`,
      reason: 'Financial outputs should stay labeled as assumptions until inputs are source-backed or user-approved.',
      routeName: 'hermes.investmentCalculator',
      routeLabel: 'Review model',
      evidenceStatus: latestFinancialModel.evidenceStatus,
      priority: 'medium',
    })
  }

  const verifiedMarketClaims = source.marketClaims.filter(claim => normalizedMarketClaimStatus(claim) === 'Verified')
  if (verifiedMarketClaims.length === 0) {
    actions.push({
      id: 'market-evidence',
      title: 'Collect source-backed market evidence',
      reason: 'Market size, pricing, demand, and growth claims must remain To Verify until source-backed.',
      routeName: 'hermes.marketIntelligence',
      routeLabel: 'Open Market Intelligence',
      evidenceStatus: 'To Verify',
      priority: 'medium',
    })
  }

  if (source.competitors.length === 0) {
    actions.push({
      id: 'competitor-evidence',
      title: 'Add competitor evidence records',
      reason: 'Track product equivalents, pricing proof, sources, and unknown market share as To Verify.',
      routeName: 'hermes.competitorIntelligence',
      routeLabel: 'Open Competitors',
      evidenceStatus: 'To Verify',
      priority: 'medium',
    })
  } else if (source.competitors.some(item => item.evidenceStatus === 'Missing' || item.evidenceStatus === 'To Verify')) {
    actions.push({
      id: 'competitor-review',
      title: 'Verify competitor claims',
      reason: 'Competitor claims need source links before they can support investor material.',
      routeName: 'hermes.competitorIntelligence',
      routeLabel: 'Review competitors',
      evidenceStatus: 'To Verify',
      priority: 'medium',
    })
  }

  if (buildInvestorPresentationDraft(source.presentationMaterials).length === 0) {
    actions.push({
      id: 'presentation-material',
      title: 'Stage approved investor material',
      reason: 'The presentation builder only uses verified, user-approved, or assumption-labeled material.',
      routeName: 'hermes.investorPresentation',
      routeLabel: 'Open Presentation Builder',
      evidenceStatus: 'To Verify',
      priority: 'medium',
    })
  }

  if (source.researchJobs.length > 0) {
    actions.push({
      id: 'research-jobs',
      title: `Review ${source.researchJobs.length} research job${source.researchJobs.length === 1 ? '' : 's'}`,
      reason: 'Turn completed research jobs into reviewed findings before updating readiness or investor material.',
      routeName: 'hermes.researchResultReview',
      routeLabel: 'Open Research Review',
      evidenceStatus: 'Pending Review',
      priority: 'low',
    })
  }

  return actions.slice(0, 6)
}

export function calculateInvestorReadinessScore(items: ReadinessItem[]): number {
  const totalWeight = items.reduce((sum, item) => sum + (item.weight || 1), 0)
  if (totalWeight <= 0) return 0
  const earned = items.reduce((sum, item) => {
    const weight = item.weight || 1
    if (item.evidenceStatus === 'Verified') return sum + weight
    if (item.evidenceStatus === 'User Approved' || item.evidenceStatus === 'User Provided' || item.evidenceStatus === 'Approved Assumption') return sum + weight * 0.6
    if (item.evidenceStatus === 'Derived from Assumptions') return sum + weight * 0.4
    if (item.evidenceStatus === 'Assumption' || item.evidenceStatus === 'Reference Only') return sum + weight * 0.25
    return sum
  }, 0)
  return Math.round((earned / totalWeight) * 100)
}
