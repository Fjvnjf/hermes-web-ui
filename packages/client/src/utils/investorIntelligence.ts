export type IntelligenceEvidenceStatus =
  | 'Missing'
  | 'To Verify'
  | 'Assumption'
  | 'User Approved'
  | 'Approved Assumption'
  | 'Verified'

export interface SourceReference {
  title: string
  url?: string
  date?: string
}

export interface MarketClaim {
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
}

export function sourceIsUsable(source?: SourceReference | null): boolean {
  return Boolean(source?.title?.trim() && (source.url?.trim() || source.date?.trim()))
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
  return material.evidenceStatus === 'User Approved' || material.evidenceStatus === 'Approved Assumption'
}

export function buildInvestorPresentationDraft(materials: PresentationMaterial[]): PresentationDraftSection[] {
  return materials
    .filter(isPresentationMaterialAllowed)
    .map(material => ({
      section: material.section,
      content: material.content,
      evidenceStatus: material.evidenceStatus,
      sourceLabel: material.source?.title || (material.evidenceStatus === 'Approved Assumption' ? 'Approved assumption' : 'User approved'),
    }))
}

export function calculateInvestorReadinessScore(items: ReadinessItem[]): number {
  const totalWeight = items.reduce((sum, item) => sum + (item.weight || 1), 0)
  if (totalWeight <= 0) return 0
  const earned = items.reduce((sum, item) => {
    const weight = item.weight || 1
    if (item.evidenceStatus === 'Verified') return sum + weight
    if (item.evidenceStatus === 'User Approved' || item.evidenceStatus === 'Approved Assumption') return sum + weight * 0.6
    if (item.evidenceStatus === 'Assumption') return sum + weight * 0.25
    return sum
  }, 0)
  return Math.round((earned / totalWeight) * 100)
}
