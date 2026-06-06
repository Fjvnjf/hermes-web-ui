import type { AutopilotScreen, TrustedSourceCategory, TrustedSourceConnectorType, TrustedSourceDataType, TrustedSourceTier } from '@/utils/trustedSources'

export interface TrustedSourceUrlCandidate {
  source_id: string
  provider: string
  title: string
  url: string
  tier_label: string
  trust_tier: TrustedSourceTier
  category: TrustedSourceCategory
  data_types_supported: TrustedSourceDataType[]
  connector_type: TrustedSourceConnectorType
  allowed_for: AutopilotScreen[]
  confidence_default: 'low' | 'medium' | 'high'
  auto_update_allowed: boolean
  requires_review: boolean
  validation_note: string
}

export interface TrustedSourceUrlProviderSummary {
  provider: string
  source_count: number
  trust_tier: TrustedSourceTier
  connector_type: TrustedSourceConnectorType
  confidence_default: 'low' | 'medium' | 'high'
  requires_review: boolean
  notes: string
  sample_titles: string[]
}

interface BatchCountry { name: string; code: string }
interface WorldBankIndicatorSeed {
  label: string
  code: string
  category: TrustedSourceCategory
  dataTypes: TrustedSourceDataType[]
  allowedFor: AutopilotScreen[]
  requiresReview: boolean
}
interface ComtradeHsSeed { code: string; label: string }

const BATCH_COUNTRIES: BatchCountry[] = [
  {
    "name": "China",
    "code": "CN"
  },
  {
    "name": "Hong Kong",
    "code": "HK"
  },
  {
    "name": "Taiwan",
    "code": "TW"
  },
  {
    "name": "Bangladesh",
    "code": "BD"
  },
  {
    "name": "India",
    "code": "IN"
  },
  {
    "name": "Vietnam",
    "code": "VN"
  },
  {
    "name": "Turkey",
    "code": "TR"
  },
  {
    "name": "Pakistan",
    "code": "PK"
  },
  {
    "name": "Indonesia",
    "code": "ID"
  },
  {
    "name": "Malaysia",
    "code": "MY"
  },
  {
    "name": "Thailand",
    "code": "TH"
  },
  {
    "name": "Cambodia",
    "code": "KH"
  },
  {
    "name": "Laos",
    "code": "LA"
  },
  {
    "name": "Myanmar",
    "code": "MM"
  },
  {
    "name": "Philippines",
    "code": "PH"
  },
  {
    "name": "Sri Lanka",
    "code": "LK"
  },
  {
    "name": "Nepal",
    "code": "NP"
  },
  {
    "name": "United Arab Emirates",
    "code": "AE"
  },
  {
    "name": "Saudi Arabia",
    "code": "SA"
  },
  {
    "name": "Egypt",
    "code": "EG"
  },
  {
    "name": "Morocco",
    "code": "MA"
  },
  {
    "name": "Tunisia",
    "code": "TN"
  },
  {
    "name": "Ethiopia",
    "code": "ET"
  },
  {
    "name": "Kenya",
    "code": "KE"
  },
  {
    "name": "Nigeria",
    "code": "NG"
  },
  {
    "name": "South Africa",
    "code": "ZA"
  },
  {
    "name": "Brazil",
    "code": "BR"
  },
  {
    "name": "Mexico",
    "code": "MX"
  },
  {
    "name": "United States",
    "code": "US"
  },
  {
    "name": "Canada",
    "code": "CA"
  },
  {
    "name": "Germany",
    "code": "DE"
  },
  {
    "name": "Italy",
    "code": "IT"
  },
  {
    "name": "France",
    "code": "FR"
  },
  {
    "name": "Spain",
    "code": "ES"
  },
  {
    "name": "United Kingdom",
    "code": "GB"
  },
  {
    "name": "Netherlands",
    "code": "NL"
  },
  {
    "name": "Belgium",
    "code": "BE"
  },
  {
    "name": "Poland",
    "code": "PL"
  },
  {
    "name": "Czech Republic",
    "code": "CZ"
  },
  {
    "name": "Romania",
    "code": "RO"
  },
  {
    "name": "Japan",
    "code": "JP"
  },
  {
    "name": "South Korea",
    "code": "KR"
  },
  {
    "name": "Singapore",
    "code": "SG"
  },
  {
    "name": "Australia",
    "code": "AU"
  },
  {
    "name": "New Zealand",
    "code": "NZ"
  },
  {
    "name": "Uzbekistan",
    "code": "UZ"
  },
  {
    "name": "Kazakhstan",
    "code": "KZ"
  },
  {
    "name": "Peru",
    "code": "PE"
  },
  {
    "name": "Colombia",
    "code": "CO"
  },
  {
    "name": "Argentina",
    "code": "AR"
  },
  {
    "name": "Chile",
    "code": "CL"
  },
  {
    "name": "Paraguay",
    "code": "PY"
  },
  {
    "name": "Uruguay",
    "code": "UY"
  },
  {
    "name": "Ecuador",
    "code": "EC"
  },
  {
    "name": "Guatemala",
    "code": "GT"
  },
  {
    "name": "Honduras",
    "code": "HN"
  },
  {
    "name": "El Salvador",
    "code": "SV"
  },
  {
    "name": "Dominican Republic",
    "code": "DO"
  },
  {
    "name": "Jordan",
    "code": "JO"
  },
  {
    "name": "Israel",
    "code": "IL"
  },
  {
    "name": "Oman",
    "code": "OM"
  },
  {
    "name": "Qatar",
    "code": "QA"
  },
  {
    "name": "Bahrain",
    "code": "BH"
  },
  {
    "name": "Kuwait",
    "code": "KW"
  },
  {
    "name": "Algeria",
    "code": "DZ"
  },
  {
    "name": "Ghana",
    "code": "GH"
  },
  {
    "name": "Tanzania",
    "code": "TZ"
  },
  {
    "name": "Uganda",
    "code": "UG"
  },
  {
    "name": "Senegal",
    "code": "SN"
  },
  {
    "name": "Mali",
    "code": "ML"
  },
  {
    "name": "Mauritius",
    "code": "MU"
  },
  {
    "name": "Madagascar",
    "code": "MG"
  },
  {
    "name": "Portugal",
    "code": "PT"
  },
  {
    "name": "Greece",
    "code": "GR"
  },
  {
    "name": "Bulgaria",
    "code": "BG"
  },
  {
    "name": "Austria",
    "code": "AT"
  },
  {
    "name": "Switzerland",
    "code": "CH"
  },
  {
    "name": "Sweden",
    "code": "SE"
  },
  {
    "name": "Denmark",
    "code": "DK"
  },
  {
    "name": "Norway",
    "code": "NO"
  }
]

const WORLD_BANK_INDICATORS: WorldBankIndicatorSeed[] = [
  {
    "label": "GDP current US$",
    "code": "NY.GDP.MKTP.CD",
    "category": "finance",
    "dataTypes": [
      "financial_data",
      "company_data",
      "market_size"
    ],
    "allowedFor": [
      "executive",
      "market",
      "investment",
      "exportMarkets",
      "investorReadiness"
    ],
    "requiresReview": false
  },
  {
    "label": "GDP growth annual %",
    "code": "NY.GDP.MKTP.KD.ZG",
    "category": "finance",
    "dataTypes": [
      "financial_data",
      "company_data",
      "market_size"
    ],
    "allowedFor": [
      "executive",
      "market",
      "investment",
      "exportMarkets",
      "investorReadiness"
    ],
    "requiresReview": false
  },
  {
    "label": "Manufacturing value added current US$",
    "code": "NV.IND.MANF.CD",
    "category": "macro",
    "dataTypes": [
      "market_size",
      "company_data"
    ],
    "allowedFor": [
      "executive",
      "market",
      "investment",
      "exportMarkets"
    ],
    "requiresReview": false
  },
  {
    "label": "Manufacturing value added % of GDP",
    "code": "NV.IND.MANF.ZS",
    "category": "finance",
    "dataTypes": [
      "financial_data",
      "company_data",
      "market_size"
    ],
    "allowedFor": [
      "executive",
      "market",
      "investment",
      "exportMarkets",
      "investorReadiness"
    ],
    "requiresReview": false
  },
  {
    "label": "Industry value added current US$",
    "code": "NV.IND.TOTL.CD",
    "category": "macro",
    "dataTypes": [
      "market_size",
      "company_data"
    ],
    "allowedFor": [
      "executive",
      "market",
      "investment",
      "exportMarkets"
    ],
    "requiresReview": false
  },
  {
    "label": "Exports of goods and services current US$",
    "code": "NE.EXP.GNFS.CD",
    "category": "trade",
    "dataTypes": [
      "trade_data",
      "market_size"
    ],
    "allowedFor": [
      "executive",
      "market",
      "exportMarkets",
      "investorReadiness"
    ],
    "requiresReview": false
  },
  {
    "label": "Imports of goods and services current US$",
    "code": "NE.IMP.GNFS.CD",
    "category": "trade",
    "dataTypes": [
      "trade_data",
      "market_size"
    ],
    "allowedFor": [
      "executive",
      "market",
      "exportMarkets",
      "investorReadiness"
    ],
    "requiresReview": false
  },
  {
    "label": "Merchandise exports current US$",
    "code": "TX.VAL.MRCH.CD.WT",
    "category": "trade",
    "dataTypes": [
      "trade_data",
      "market_size"
    ],
    "allowedFor": [
      "executive",
      "market",
      "exportMarkets",
      "investorReadiness"
    ],
    "requiresReview": false
  },
  {
    "label": "Merchandise imports current US$",
    "code": "TM.VAL.MRCH.CD.WT",
    "category": "trade",
    "dataTypes": [
      "trade_data",
      "market_size"
    ],
    "allowedFor": [
      "executive",
      "market",
      "exportMarkets",
      "investorReadiness"
    ],
    "requiresReview": false
  },
  {
    "label": "Inflation consumer prices annual %",
    "code": "FP.CPI.TOTL.ZG",
    "category": "finance",
    "dataTypes": [
      "financial_data",
      "company_data",
      "market_size"
    ],
    "allowedFor": [
      "executive",
      "market",
      "investment",
      "exportMarkets",
      "investorReadiness"
    ],
    "requiresReview": true
  },
  {
    "label": "Official exchange rate LCU per USD",
    "code": "PA.NUS.FCRF",
    "category": "finance",
    "dataTypes": [
      "financial_data",
      "company_data",
      "market_size"
    ],
    "allowedFor": [
      "executive",
      "market",
      "investment",
      "exportMarkets",
      "investorReadiness"
    ],
    "requiresReview": true
  },
  {
    "label": "Labor force total",
    "code": "SL.TLF.TOTL.IN",
    "category": "macro",
    "dataTypes": [
      "company_data",
      "market_size"
    ],
    "allowedFor": [
      "executive",
      "market",
      "exportMarkets",
      "investorReadiness"
    ],
    "requiresReview": false
  },
  {
    "label": "Population total",
    "code": "SP.POP.TOTL",
    "category": "macro",
    "dataTypes": [
      "company_data",
      "market_size"
    ],
    "allowedFor": [
      "executive",
      "market",
      "exportMarkets",
      "investorReadiness"
    ],
    "requiresReview": false
  },
  {
    "label": "GNI per capita current US$",
    "code": "NY.GNP.PCAP.CD",
    "category": "finance",
    "dataTypes": [
      "financial_data",
      "company_data",
      "market_size"
    ],
    "allowedFor": [
      "executive",
      "market",
      "investment",
      "exportMarkets",
      "investorReadiness"
    ],
    "requiresReview": false
  },
  {
    "label": "Logistics performance index overall",
    "code": "LP.LPI.OVRL.XQ",
    "category": "trade",
    "dataTypes": [
      "trade_data",
      "market_size"
    ],
    "allowedFor": [
      "executive",
      "market",
      "exportMarkets",
      "investorReadiness"
    ],
    "requiresReview": false
  },
  {
    "label": "Cost to export documentary compliance US$",
    "code": "IC.EXP.COST.CD",
    "category": "trade",
    "dataTypes": [
      "trade_data",
      "market_size"
    ],
    "allowedFor": [
      "executive",
      "market",
      "exportMarkets",
      "investorReadiness"
    ],
    "requiresReview": false
  },
  {
    "label": "Cost to import documentary compliance US$",
    "code": "IC.IMP.COST.CD",
    "category": "trade",
    "dataTypes": [
      "trade_data",
      "market_size"
    ],
    "allowedFor": [
      "executive",
      "market",
      "exportMarkets",
      "investorReadiness"
    ],
    "requiresReview": false
  },
  {
    "label": "Energy use kg oil equivalent",
    "code": "EG.USE.COMM.KT.OE",
    "category": "macro",
    "dataTypes": [
      "company_data",
      "market_size"
    ],
    "allowedFor": [
      "executive",
      "market",
      "investment"
    ],
    "requiresReview": true
  }
]

const COMTRADE_HS_CODES: ComtradeHsSeed[] = [
  {
    "code": "3402",
    "label": "Organic surface-active agents; washing/cleaning preparations"
  },
  {
    "code": "3809",
    "label": "Finishing agents, dye carriers, textile/paper/leather auxiliaries"
  },
  {
    "code": "3910",
    "label": "Silicones in primary forms"
  },
  {
    "code": "2915",
    "label": "Saturated acyclic monocarboxylic acids and derivatives"
  },
  {
    "code": "2922",
    "label": "Oxygen-function amino-compounds"
  },
  {
    "code": "2920",
    "label": "Esters of other inorganic acids and their salts/derivatives"
  },
  {
    "code": "2916",
    "label": "Unsaturated acyclic monocarboxylic acids and derivatives"
  }
]

export const TRUSTED_SOURCE_BATCH_2_PROVIDER_SUMMARIES: TrustedSourceUrlProviderSummary[] = [
  {
    "provider": "World Bank Indicators API",
    "source_count": 1440,
    "trust_tier": "tier1-official",
    "connector_type": "API",
    "confidence_default": "high",
    "requires_review": false,
    "notes": "Official World Bank API indicator endpoints. Endpoint responses can be fetched automatically, but dashboard use still needs parsed source metadata and field-level policy checks.",
    "sample_titles": [
      "World Bank API — China — GDP current US$",
      "World Bank API — China — GDP growth annual %",
      "World Bank API — China — Manufacturing value added current US$",
      "World Bank API — China — Manufacturing value added % of GDP",
      "World Bank API — China — Industry value added current US$",
      "World Bank API — China — Exports of goods and services current US$",
      "World Bank API — China — Imports of goods and services current US$",
      "World Bank API — China — Merchandise exports current US$",
      "World Bank API — China — Merchandise imports current US$",
      "World Bank API — China — Inflation consumer prices annual %",
      "World Bank API — China — Official exchange rate LCU per USD",
      "World Bank API — China — Labor force total"
    ]
  },
  {
    "provider": "UN Comtrade / Comtrade Plus",
    "source_count": 560,
    "trust_tier": "tier1-official",
    "connector_type": "API",
    "confidence_default": "high",
    "requires_review": true,
    "notes": "Official UN Comtrade / Comtrade Plus HS-code source candidates. HS-code relevance remains review-gated before product, market-size, or consumption claims are trusted.",
    "sample_titles": [
      "UN Comtrade — China — HS 3402 — Organic surface-active agents; washing/cleaning preparations",
      "UN Comtrade — China — HS 3809 — Finishing agents, dye carriers, textile/paper/leather auxiliaries",
      "UN Comtrade — China — HS 3910 — Silicones in primary forms",
      "UN Comtrade — China — HS 2915 — Saturated acyclic monocarboxylic acids and derivatives",
      "UN Comtrade — China — HS 2922 — Oxygen-function amino-compounds",
      "UN Comtrade — China — HS 2920 — Esters of other inorganic acids and their salts/derivatives",
      "UN Comtrade — China — HS 2916 — Unsaturated acyclic monocarboxylic acids and derivatives",
      "UN Comtrade — Hong Kong — HS 3402 — Organic surface-active agents; washing/cleaning preparations",
      "UN Comtrade — Hong Kong — HS 3809 — Finishing agents, dye carriers, textile/paper/leather auxiliaries",
      "UN Comtrade — Hong Kong — HS 3910 — Silicones in primary forms",
      "UN Comtrade — Hong Kong — HS 2915 — Saturated acyclic monocarboxylic acids and derivatives",
      "UN Comtrade — Hong Kong — HS 2922 — Oxygen-function amino-compounds"
    ]
  }
]

function sourceNumber(offset: number): string {
  return `SRC-${String(751 + offset).padStart(5, '0')}`
}

function worldBankCandidate(country: BatchCountry, indicator: WorldBankIndicatorSeed, index: number): TrustedSourceUrlCandidate {
  return {
    source_id: sourceNumber(index),
    provider: 'World Bank Indicators API',
    title: `World Bank API — ${country.name} — ${indicator.label}`,
    url: `https://api.worldbank.org/v2/country/${country.code}/indicator/${indicator.code}?format=json`,
    tier_label: 'Tier 1 — Official / High Trust',
    trust_tier: 'tier1-official',
    category: indicator.category,
    data_types_supported: [...indicator.dataTypes],
    connector_type: 'API',
    allowed_for: [...indicator.allowedFor],
    confidence_default: 'high',
    auto_update_allowed: true,
    requires_review: indicator.requiresReview,
    validation_note: 'Trusted provider; endpoint data must be validated on fetch',
  }
}

function comtradeCandidate(country: BatchCountry, hs: ComtradeHsSeed, index: number): TrustedSourceUrlCandidate {
  return {
    source_id: sourceNumber(BATCH_COUNTRIES.length * WORLD_BANK_INDICATORS.length + index),
    provider: 'UN Comtrade / Comtrade Plus',
    title: `UN Comtrade — ${country.name} — HS ${hs.code} — ${hs.label}`,
    url: 'https://comtradeplus.un.org/',
    tier_label: 'Tier 1 — Official / High Trust',
    trust_tier: 'tier1-official',
    category: 'trade',
    data_types_supported: ['trade_data', 'market_size'],
    connector_type: 'API',
    allowed_for: ['market', 'exportMarkets', 'investorReadiness', 'presentation'],
    confidence_default: 'high',
    auto_update_allowed: true,
    requires_review: true,
    validation_note: 'Trusted provider; HS-code relevance must be verified',
  }
}

export const TRUSTED_SOURCE_BATCH_2_URL_CANDIDATES: TrustedSourceUrlCandidate[] = [
  ...BATCH_COUNTRIES.flatMap((country, countryIndex) =>
    WORLD_BANK_INDICATORS.map((indicator, indicatorIndex) =>
      worldBankCandidate(country, indicator, countryIndex * WORLD_BANK_INDICATORS.length + indicatorIndex),
    ),
  ),
  ...BATCH_COUNTRIES.flatMap((country, countryIndex) =>
    COMTRADE_HS_CODES.map((hs, hsIndex) =>
      comtradeCandidate(country, hs, countryIndex * COMTRADE_HS_CODES.length + hsIndex),
    ),
  ),
]

export const TRUSTED_SOURCE_BATCH_2_CANDIDATE_COUNT = TRUSTED_SOURCE_BATCH_2_URL_CANDIDATES.length
export const TRUSTED_SOURCE_BATCH_2_COUNTRY_COUNT = 80
export const TRUSTED_SOURCE_BATCH_2_INDICATOR_COUNT = 18
export const TRUSTED_SOURCE_BATCH_2_HS_CODE_COUNT = 7

export function trustedSourceBatch2ProviderPromptLines(maxExamplesPerProvider = 8): string[] {
  return TRUSTED_SOURCE_BATCH_2_PROVIDER_SUMMARIES.map(summary => {
    const shown = summary.sample_titles.slice(0, maxExamplesPerProvider).join('; ')
    const remaining = summary.source_count > maxExamplesPerProvider ? `; plus ${summary.source_count - maxExamplesPerProvider} more URL-backed candidates` : ''
    return `Batch 2 - ${summary.provider}: ${summary.source_count} Tier 1 source candidates. ${shown}${remaining}. Policy: ${summary.notes}`
  })
}

export function trustedSourceBatch2Examples(provider: string, count = 12): TrustedSourceUrlCandidate[] {
  return TRUSTED_SOURCE_BATCH_2_URL_CANDIDATES.filter(source => source.provider === provider).slice(0, count)
}

export function trustedSourceBatch2CandidatesForProvider(provider: string): TrustedSourceUrlCandidate[] {
  return TRUSTED_SOURCE_BATCH_2_URL_CANDIDATES.filter(source => source.provider === provider)
}
