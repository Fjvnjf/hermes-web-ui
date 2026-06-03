import type { FeasibilityIntelligenceState } from '@/composables/useFeasibilityIntelligence'

export interface CoverageTarget {
  label: string
  aliases: string[]
}

export type CoverageTextScope = 'market' | 'competitor' | 'supplier' | 'regulatory' | 'financial' | 'investor'

export interface CoverageRequirement {
  area: string
  fills: string
  review: string
  textScope: CoverageTextScope
  targets: CoverageTarget[]
}

export interface CoverageRow extends CoverageRequirement {
  coveredCount: number
  totalTargets: number
  missingTargets: CoverageTarget[]
  status: 'covered' | 'partial' | 'missing'
}

export function normalizeCoverageAlias(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function target(label: string, ...aliases: string[]): CoverageTarget {
  return {
    label,
    aliases: aliases.map(normalizeCoverageAlias),
  }
}

export const dashboardCoverageRequirements: CoverageRequirement[] = [
  {
    area: 'Market Intelligence',
    fills: 'Trade proxies, country signals, market questions, source-backed segments',
    review: 'Market size, CAGR, consumption, and target claims stay To Verify unless strong evidence exists',
    textScope: 'market',
    targets: [
      target('China', 'china', 'zhejiang', 'guangdong', 'jiangsu'),
      target('Bangladesh', 'bangladesh'),
      target('India', 'india'),
      target('Vietnam', 'vietnam'),
      target('Pakistan', 'pakistan'),
      target('Turkey', 'turkey', 'turkiye'),
      target('Indonesia', 'indonesia'),
      target('EU / Germany', 'eu', 'europe', 'germany'),
      target('United States', 'united states', 'usa', 'u.s.'),
      target('GCC / Middle East', 'gcc', 'middle east', 'saudi', 'uae'),
    ],
  },
  {
    area: 'Competitor Intelligence',
    fills: 'Company presence, product equivalents, certifications, distribution evidence',
    review: 'Market share, pricing, strengths/weaknesses, and unsupported rankings are staged for review',
    textScope: 'competitor',
    targets: [
      target('Evonik Industries', 'evonik'),
      target('Stepan Company', 'stepan'),
      target('Kao Corporation', 'kao'),
      target('WACKER', 'wacker'),
      target('Rudolf Group', 'rudolf'),
      target('CHT Group', 'cht'),
      target('Archroma', 'archroma'),
      target('Transfar', 'transfar'),
      target('Zschimmer & Schwarz', 'zschimmer', 'schwarz'),
      target('Pulcra Chemicals', 'pulcra'),
      target('Syensqo / Solvay', 'syensqo', 'solvay'),
    ],
  },
  {
    area: 'Raw Materials / Supplier Scorecards',
    fills: 'Supplier evidence candidates, material signals, SDS/TDS/COA/quote references',
    review: 'Supplier prices, payment terms, quality/reliability scores, and cost data remain sensitive',
    textScope: 'supplier',
    targets: [
      target('Stearic acid', 'stearic'),
      target('Triethanolamine / TEA', 'triethanolamine', 'tea'),
      target('Dimethyl sulfate / DMS', 'dimethyl sulfate', 'dms'),
      target('PDMS silicone oil', 'pdms', 'silicone oil'),
      target('Acetic acid', 'acetic acid'),
      target('Ethoxylates', 'ethoxylate'),
      target('Packaging', 'packaging'),
      target('Wilmar', 'wilmar'),
      target('KLK OLEO', 'klk'),
      target('BASF', 'basf'),
      target('Dow', 'dow'),
      target('WACKER', 'wacker'),
    ],
  },
  {
    area: 'Investment / IRR',
    fills: 'Approved internal scenario snapshots and finance evidence candidates',
    review: 'IRR, NPV, payback, ROI, capex, costing, and investor claims are never silently approved',
    textScope: 'financial',
    targets: [
      target('Lean scenario', 'lean'),
      target('Base scenario', 'base'),
      target('Conservative scenario', 'conservative'),
      target('Aggressive scenario', 'aggressive'),
      target('Total investment', 'total investment'),
      target('IRR', 'irr'),
      target('NPV', 'npv'),
      target('Payback', 'payback'),
      target('ROI', 'roi'),
      target('Working capital', 'working capital'),
      target('Capex breakdown', 'capex', 'investment breakdown'),
    ],
  },
  {
    area: 'Regulatory / Data Room',
    fills: 'Regulatory findings, source gaps, document evidence candidates',
    review: 'DMS, CAS, formula, permit, factory approval, and safety claims require owner review',
    textScope: 'regulatory',
    targets: [
      target('DMS safety / regulatory status', 'dms', 'dimethyl sulfate'),
      target('SDS / TDS / CAS evidence', 'sds', 'tds', 'cas'),
      target('China import / storage / transport / use', 'china import', 'storage', 'transport', 'use requirements'),
      target('Factory chemical approvals', 'factory approval', 'chemical approval', 'permit'),
      target('IECSC / China inventory', 'iecsc', 'china chemical inventory'),
    ],
  },
  {
    area: 'Reports / Presentation',
    fills: 'Investor material candidates only after evidence labels are preserved',
    review: 'Investor-approved material remains approval-gated and excludes unsupported claims',
    textScope: 'investor',
    targets: [
      target('Approved facts', 'approved fact', 'source-backed'),
      target('Approved assumptions', 'approved assumption'),
      target('Risk register', 'risk register', 'risk'),
      target('Data-room gaps', 'data-room', 'data room'),
      target('Presentation snippets', 'presentation', 'slide', 'snippet'),
    ],
  },
]

export function coverageTextHasAlias(text: string, alias: string): boolean {
  if (!alias) return false
  if (alias.length <= 3) {
    return new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(text)
  }
  return text.includes(alias)
}

export function coverageTextForScope(
  state: FeasibilityIntelligenceState,
  scope: CoverageTextScope,
): string {
  const marketParts = [
    ...state.marketClaims.map(item => `${item.label} ${item.value} ${item.evidenceStatus} ${item.source?.title || ''}`),
    ...state.dataRoomSources
      .filter(item => item.area === 'market' || item.dashboardGroup === 'rawMaterialSignals')
      .map(item => `${item.checklistLabel} ${item.proposedValue || ''} ${item.notes} ${item.source?.title || ''}`),
    ...state.researchFindings
      .filter(item => item.area === 'market' || item.dashboardTarget?.group === 'marketClaims')
      .map(item => `${item.keyClaim} ${item.summary} ${item.dashboardTarget?.proposedDashboardField || ''}`),
  ]
  const competitorParts = [
    ...state.competitors.map(item => `${item.companyName} ${item.countryRegion} ${item.productEquivalent} ${item.notes} ${item.source?.title || ''}`),
    ...state.researchFindings
      .filter(item => item.dashboardTarget?.group === 'competitorRecords')
      .map(item => `${item.keyClaim} ${item.summary} ${item.dashboardTarget?.companyName || ''} ${item.dashboardTarget?.productEquivalent || ''}`),
  ]
  const supplierParts = [
    ...state.dataRoomSources
      .filter(item => item.area === 'factory' || item.dashboardGroup === 'supplierScorecards' || item.dashboardGroup === 'rawMaterialSignals')
      .map(item => `${item.checklistLabel} ${item.supplier || ''} ${item.material || ''} ${item.proposedValue || ''} ${item.notes} ${item.source?.title || ''}`),
    ...state.researchFindings
      .filter(item => item.dashboardTarget?.group === 'supplierScorecards' || item.dashboardTarget?.group === 'rawMaterialSignals')
      .map(item => `${item.keyClaim} ${item.summary} ${item.dashboardTarget?.supplier || ''} ${item.dashboardTarget?.material || ''}`),
  ]
  const regulatoryParts = [
    ...state.dataRoomSources
      .filter(item => item.area === 'regulatory' || item.dashboardGroup === 'regulatoryFindings')
      .map(item => `${item.checklistLabel} ${item.proposedValue || ''} ${item.notes} ${item.source?.title || ''}`),
    ...state.researchFindings
      .filter(item => item.area === 'regulatory' || item.dashboardTarget?.group === 'regulatoryFindings')
      .map(item => `${item.keyClaim} ${item.summary} ${item.dashboardTarget?.proposedDashboardField || ''}`),
  ]
  const financialParts = [
    ...state.financialModels.map(item => `${item.scenarioName} ${item.projectName} IRR NPV payback ROI capex working capital ${item.warnings.join(' ')}`),
    ...state.dataRoomSources
      .filter(item => item.area === 'financial' || item.dashboardGroup === 'financialEvidence')
      .map(item => `${item.checklistLabel} ${item.proposedValue || ''} ${item.notes} ${item.source?.title || ''}`),
    ...state.researchFindings
      .filter(item => item.area === 'financial' || item.dashboardTarget?.group === 'financialEvidence')
      .map(item => `${item.keyClaim} ${item.summary} ${item.dashboardTarget?.proposedDashboardField || ''}`),
  ]
  const investorParts = [
    ...state.presentationMaterials.map(item => `${item.section} ${item.content} ${item.evidenceStatus}`),
    ...state.researchFindings
      .filter(item => item.area === 'presentation' || item.dashboardTarget?.group === 'investorMaterialCandidates')
      .map(item => `${item.keyClaim} ${item.summary} ${item.suggestedInvestorMaterial || ''}`),
    ...state.dataRoomSources.map(item => `${item.checklistLabel} ${item.area} ${item.evidenceStatus}`),
  ]

  const byScope: Record<CoverageTextScope, string[]> = {
    market: marketParts,
    competitor: competitorParts,
    supplier: supplierParts,
    regulatory: regulatoryParts,
    financial: financialParts,
    investor: investorParts,
  }
  return normalizeCoverageAlias(byScope[scope].join(' '))
}

export function buildDashboardCoverageRows(
  state: FeasibilityIntelligenceState,
  requirements: CoverageRequirement[] = dashboardCoverageRequirements,
): CoverageRow[] {
  return requirements.map(row => {
    const text = coverageTextForScope(state, row.textScope)
    const missingTargets = row.targets.filter(item => !item.aliases.some(alias => coverageTextHasAlias(text, alias)))
    const coveredCount = row.targets.length - missingTargets.length
    return {
      ...row,
      coveredCount,
      totalTargets: row.targets.length,
      missingTargets,
      status: missingTargets.length === 0 ? 'covered' : coveredCount > 0 ? 'partial' : 'missing',
    }
  })
}

export function missingDashboardCoverageTargetCount(rows: CoverageRow[]): number {
  return rows.reduce((sum, row) => sum + row.missingTargets.length, 0)
}
