export type IntelligenceEvidenceStatus =
  | 'Missing'
  | 'To Verify'
  | 'Assumption'
  | 'Derived from Assumptions'
  | 'Hypothesis'
  | 'Reference Only'
  | 'User Provided'
  | 'User Approved'
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
  section: string
  content: string
  evidenceStatus: IntelligenceEvidenceStatus
  source?: SourceReference | null
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

export function sourceIsUsable(source?: SourceReference | null): boolean {
  return Boolean(source?.title?.trim() && (source.url?.trim() || source.date?.trim()))
}

export function formatSourceReference(source?: SourceReference | null): string {
  const title = source?.title?.trim()
  if (!title) return 'Source missing'
  const details = [source?.url?.trim(), source?.date?.trim()].filter(Boolean).join(' / ')
  return details ? `${title} (${details})` : title
}

export function canMarkMarketClaimVerified(claim: MarketClaim): boolean {
  return Boolean(claim.value?.trim() && sourceIsUsable(claim.source))
}

export function normalizedMarketClaimStatus(claim: MarketClaim): IntelligenceEvidenceStatus {
  if (claim.evidenceStatus === 'Verified' && !canMarkMarketClaimVerified(claim)) return 'To Verify'
  if (!claim.value?.trim()) return 'To Verify'
  return claim.evidenceStatus
}

export function formatMarketShare(value?: string | null): string {
  return value?.trim() ? value.trim() : 'To Verify'
}

export function isPresentationMaterialAllowed(material: PresentationMaterial): boolean {
  if (!material.content.trim()) return false
  if (material.evidenceStatus === 'Verified') return sourceIsUsable(material.source)
  return material.evidenceStatus === 'User Approved' ||
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
        (material.evidenceStatus === 'Approved Assumption'
          ? 'Approved assumption'
          : material.evidenceStatus === 'Derived from Assumptions'
            ? 'Derived from assumptions'
            : 'User approved'),
      sourceDetail: material.source
        ? formatSourceReference(material.source)
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
