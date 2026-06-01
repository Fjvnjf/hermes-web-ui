import type { IntelligenceEvidenceStatus, SourceReference } from '@/utils/investorIntelligence'

export type TrustedSourceTier = 'tier1-official' | 'tier2-market-reference' | 'tier3-supplier-evidence' | 'tier4-public-listing' | 'candidate-source'

export type TrustedSourceConnectorType = 'API' | 'web_reference' | 'manual_upload' | 'supplier_quote' | 'paid_source' | 'research_job'

export type TrustedSourceCategory =
  | 'trade'
  | 'macro'
  | 'regulatory'
  | 'chemical'
  | 'price'
  | 'supplier'
  | 'textile'
  | 'market'
  | 'competitor'
  | 'finance'
  | 'internal'

export type TrustedSourceDataType =
  | 'trade_data'
  | 'market_size'
  | 'price_data'
  | 'competitor_data'
  | 'company_data'
  | 'regulatory_data'
  | 'financial_data'
  | 'supplier_quote'
  | 'document_evidence'
  | 'internal_activity'

export type AutopilotScreen = 'executive' | 'market' | 'investment' | 'competitor'

export interface TrustedSourceRecord {
  source_id: string
  name: string
  domain: string
  url: string
  tier: TrustedSourceTier
  category: TrustedSourceCategory
  data_type: TrustedSourceDataType
  data_types_supported: TrustedSourceDataType[]
  allowed_for: AutopilotScreen[]
  connector_type: TrustedSourceConnectorType
  update_frequency: string
  confidence_default: 'low' | 'medium' | 'high'
  auto_update_allowed: boolean
  requires_review: boolean
  enabled: boolean
  last_checked?: string | null
  last_failure?: string | null
  notes: string
}

export interface TrustedSourceSnapshotClaim {
  id: string
  label: string
  value: string
  previousValue?: string
  changePercent?: number | null
  evidenceStatus: IntelligenceEvidenceStatus
  confidence: 'low' | 'medium' | 'high'
  source: SourceReference
  dataType: TrustedSourceDataType
  reviewRequired: boolean
  sensitive?: boolean
  notes?: string
}

export interface TrustedSourceSnapshot {
  snapshot_id: string
  screen: AutopilotScreen
  generated_at: string
  source_ids: string[]
  claims: TrustedSourceSnapshotClaim[]
  evidence_status: IntelligenceEvidenceStatus
  confidence: 'low' | 'medium' | 'high'
  changed_fields: string[]
  conflicts: string[]
  review_required: boolean
  job_id?: string
  user_visibility: 'owner-only' | 'employee-safe' | 'financial-only' | 'investor-blocked'
  redaction_rules: string[]
}

export interface TrustedSourceCandidate {
  name?: string
  url?: string
  domain?: string
  dataType: TrustedSourceDataType
  screen?: AutopilotScreen
}

const TIER1_DOMAINS = [
  'comtradeplus.un.org',
  'comtrade.un.org',
  'uncomtrade.org',
  'trademap.org',
  'intracen.org',
  'worldbank.org',
  'wits.worldbank.org',
  'wto.org',
  'imf.org',
  'oecd.org',
  'stat.unido.org',
  'unctadstat.unctad.org',
  'ilostat.ilo.org',
  'fao.org',
  'europa.eu',
  'census.gov',
  'usitc.gov',
  'fred.stlouisfed.org',
  'bls.gov',
  'stats.gov.cn',
  'customs.gov.cn',
  'mofcom.gov.cn',
  'mee.gov.cn',
  'english.www.gov.cn',
  'samr.gov.cn',
  'mem.gov.cn',
  'miit.gov.cn',
  'pbc.gov.cn',
  'safe.gov.cn',
  'bb.org.bd',
  'epb.gov.bd',
  'sec.gov',
  'hkexnews.hk',
  'echa.europa.eu',
  'pubchem.ncbi.nlm.nih.gov',
  'comptox.epa.gov',
  'nite.go.jp',
]

const TIER2_DOMAINS = [
  'zdhc-gateway.com',
  'roadmaptozero.com',
  'oeko-tex.com',
  'global-standard.org',
  'cirs-group.com',
  'chemlinked.com',
  'intertek.com',
  'sgs.com',
  'tuv.com',
  'ulprospector.com',
  'chemicalbook.com',
  'sunsirs.com',
  'echemi.com',
  'icis.com',
  'argusmedia.com',
  'spglobal.com',
  'chemanalyst.com',
  'chemorbis.com',
  'polymerupdate.com',
  'asianmetal.com',
  'dce.com.cn',
  'shfe.com.cn',
  'czce.com.cn',
  'bursamalaysia.com',
  'itmf.org',
  'textileexchange.org',
  'iafnet.eu',
  'fibre2fashion.com',
  'just-style.com',
  'grandviewresearch.com',
  'marketsandmarkets.com',
  'researchandmarkets.com',
  'mordorintelligence.com',
  'statista.com',
  'euromonitor.com',
  'mckinsey.com',
  'deloitte.com',
  'evonik.com',
  'stepan.com',
  'kao.com',
  'wacker.com',
  'rudolf.de',
  'cht.com',
  'archroma.com',
  'zschimmer-schwarz.com',
  'pulcra-chemicals.com',
  'transfarchem.com',
  'syensqo.com',
  'basf.com',
  'dow.com',
  'shinetsu.co.jp',
  'momentive.com',
]

const TIER4_DOMAINS = [
  'alibaba.com',
  'made-in-china.com',
  '1688.com',
  'lookchem.com',
  'guidechem.com',
  'chembk.com',
  'specialchem.com',
]

type SourceSeed = {
  source_id: string
  name: string
  url: string
  tier: TrustedSourceTier
  category: TrustedSourceCategory
  dataTypes: TrustedSourceDataType[]
  connector: TrustedSourceConnectorType
  frequency: string
  allowedFor: AutopilotScreen[]
  confidence: 'low' | 'medium' | 'high'
  autoUpdate: boolean
  requiresReview: boolean
  notes: string
}

const officialScreens: AutopilotScreen[] = ['executive', 'market']
const marketScreens: AutopilotScreen[] = ['market']
const chemicalScreens: AutopilotScreen[] = ['market', 'competitor']
const competitorScreens: AutopilotScreen[] = ['competitor']
const supplierScreens: AutopilotScreen[] = ['executive', 'investment', 'competitor']

function seed(
  source_id: string,
  name: string,
  url: string,
  tier: TrustedSourceTier,
  category: TrustedSourceCategory,
  dataTypes: TrustedSourceDataType[],
  connector: TrustedSourceConnectorType,
  allowedFor: AutopilotScreen[],
  notes: string,
  options: Partial<Pick<SourceSeed, 'frequency' | 'confidence' | 'autoUpdate' | 'requiresReview'>> = {},
): SourceSeed {
  const isWeak = tier === 'tier4-public-listing' || tier === 'candidate-source'
  return {
    source_id,
    name,
    url,
    tier,
    category,
    dataTypes,
    connector,
    frequency: options.frequency || (connector === 'API' ? 'twice_daily' : 'daily_review'),
    allowedFor,
    confidence: options.confidence || (tier === 'tier1-official' ? 'high' : tier === 'tier2-market-reference' || tier === 'tier3-supplier-evidence' ? 'medium' : 'low'),
    autoUpdate: options.autoUpdate ?? !isWeak,
    requiresReview: options.requiresReview ?? isWeak,
    notes,
  }
}

const SOURCE_SEEDS: SourceSeed[] = [
  seed('un-comtrade', 'UN Comtrade', 'https://comtrade.un.org/', 'tier1-official', 'trade', ['trade_data', 'market_size'], 'API', marketScreens, 'Official trade/import/export data. Use exact HS-code evidence or label proxy/To Verify.'),
  seed('un-comtrade-plus', 'UN Comtrade Plus', 'https://comtradeplus.un.org/', 'tier1-official', 'trade', ['trade_data', 'market_size'], 'API', marketScreens, 'Official trade/import/export data. API-ready connector; exact consumption still needs HS-code review.'),
  seed('itc-trade-map', 'ITC Trade Map', 'https://www.trademap.org/', 'tier1-official', 'trade', ['trade_data', 'market_size'], 'paid_source', marketScreens, 'High-quality trade reference; paid/session access may require research job fallback.'),
  seed('international-trade-centre', 'International Trade Centre', 'https://www.intracen.org/', 'tier1-official', 'trade', ['trade_data', 'market_size'], 'web_reference', marketScreens, 'Official ITC publications and trade methodology references.'),
  seed('world-bank-indicators-api', 'World Bank Indicators API', 'https://api.worldbank.org/v2', 'tier1-official', 'macro', ['company_data', 'trade_data', 'market_size'], 'API', marketScreens, 'Official country and macro indicators connector.'),
  seed('world-bank-databank', 'World Bank DataBank', 'https://databank.worldbank.org/', 'tier1-official', 'macro', ['company_data', 'market_size'], 'web_reference', marketScreens, 'Official country and macro data reference.'),
  seed('world-bank-documents-api', 'World Bank Documents API', 'https://documents.worldbank.org/', 'tier1-official', 'macro', ['document_evidence', 'market_size'], 'API', marketScreens, 'Official World Bank document metadata and reports.'),
  seed('world-bank-wits', 'World Bank WITS', 'https://wits.worldbank.org/', 'tier1-official', 'trade', ['trade_data', 'market_size'], 'web_reference', marketScreens, 'Official trade and tariff reference.'),
  seed('wto-data', 'WTO Data', 'https://data.wto.org/', 'tier1-official', 'trade', ['trade_data'], 'API', marketScreens, 'Official WTO statistics and trade indicators.'),
  seed('imf-data', 'IMF Data', 'https://data.imf.org/', 'tier1-official', 'macro', ['company_data'], 'API', marketScreens, 'Official macroeconomic data reference.'),
  seed('oecd-data-api', 'OECD Data API', 'https://www.oecd.org/en/data/', 'tier1-official', 'macro', ['company_data', 'market_size'], 'API', marketScreens, 'Official OECD data connector skeleton.'),
  seed('oecd-data-explorer', 'OECD Data Explorer', 'https://data-explorer.oecd.org/', 'tier1-official', 'macro', ['company_data', 'market_size'], 'web_reference', marketScreens, 'Official OECD explorer reference.'),
  seed('unido-statistics', 'UNIDO Statistics', 'https://stat.unido.org/', 'tier1-official', 'macro', ['market_size', 'trade_data'], 'web_reference', marketScreens, 'Official manufacturing and industrial statistics.'),
  seed('unctadstat', 'UNCTADstat', 'https://unctadstat.unctad.org/', 'tier1-official', 'trade', ['trade_data', 'market_size'], 'web_reference', marketScreens, 'Official trade and development statistics.'),
  seed('ilostat', 'ILOSTAT', 'https://ilostat.ilo.org/', 'tier1-official', 'macro', ['company_data'], 'API', marketScreens, 'Official labor and wage indicators.'),
  seed('faostat', 'FAOSTAT', 'https://www.fao.org/faostat/', 'tier1-official', 'macro', ['company_data'], 'API', marketScreens, 'Official commodity and macro reference where relevant.'),
  seed('eurostat', 'Eurostat', 'https://ec.europa.eu/eurostat/', 'tier1-official', 'macro', ['company_data', 'trade_data'], 'API', marketScreens, 'Official EU statistics.'),
  seed('us-census-international-trade', 'US Census International Trade', 'https://www.census.gov/foreign-trade/', 'tier1-official', 'trade', ['trade_data'], 'API', marketScreens, 'Official US international trade data.'),
  seed('usitc-dataweb', 'USITC DataWeb', 'https://dataweb.usitc.gov/', 'tier1-official', 'trade', ['trade_data'], 'web_reference', marketScreens, 'Official US trade database.'),
  seed('fred-economic-data', 'FRED Economic Data', 'https://fred.stlouisfed.org/', 'tier1-official', 'macro', ['company_data'], 'API', marketScreens, 'Official Federal Reserve economic data.'),
  seed('bls-ppi', 'U.S. BLS Producer Price Index', 'https://www.bls.gov/ppi/', 'tier1-official', 'price', ['price_data'], 'API', marketScreens, 'Official PPI data; not product price proof.'),
  seed('eu-access2markets', 'EU Access2Markets', 'https://trade.ec.europa.eu/access-to-markets/', 'tier1-official', 'trade', ['trade_data', 'regulatory_data'], 'web_reference', marketScreens, 'Official EU trade barrier and tariff reference.'),
  seed('china-nbs', 'China National Bureau of Statistics', 'https://www.stats.gov.cn/', 'tier1-official', 'macro', ['market_size', 'company_data'], 'web_reference', marketScreens, 'Official China statistical data.'),
  seed('china-customs', 'China General Administration of Customs', 'http://english.customs.gov.cn/', 'tier1-official', 'trade', ['trade_data'], 'web_reference', marketScreens, 'Official China customs statistics and notices.'),
  seed('china-mofcom', 'China Ministry of Commerce', 'http://english.mofcom.gov.cn/', 'tier1-official', 'trade', ['trade_data', 'regulatory_data'], 'web_reference', officialScreens, 'Official China commerce policy and trade reference.'),
  seed('china-mee', 'China Ministry of Ecology and Environment', 'https://english.mee.gov.cn/', 'tier1-official', 'regulatory', ['regulatory_data'], 'web_reference', officialScreens, 'Official environmental regulatory source.'),
  seed('china-state-council', 'China State Council', 'https://english.www.gov.cn/', 'tier1-official', 'regulatory', ['regulatory_data'], 'web_reference', officialScreens, 'Official China government notices.'),
  seed('china-samr', 'China SAMR', 'https://www.samr.gov.cn/', 'tier1-official', 'regulatory', ['regulatory_data'], 'web_reference', officialScreens, 'Official China market regulation source.'),
  seed('china-mem', 'China Ministry of Emergency Management', 'https://www.mem.gov.cn/', 'tier1-official', 'regulatory', ['regulatory_data'], 'web_reference', officialScreens, 'Official safety and emergency management source.'),
  seed('china-miit', 'China MIIT', 'https://www.miit.gov.cn/', 'tier1-official', 'regulatory', ['regulatory_data', 'market_size'], 'web_reference', officialScreens, 'Official industry policy and industrial data source.'),
  seed('pbc', 'People’s Bank of China', 'https://www.pbc.gov.cn/', 'tier1-official', 'finance', ['financial_data'], 'web_reference', ['investment'], 'Official China monetary and financial reference.'),
  seed('safe-china', 'SAFE China', 'https://www.safe.gov.cn/', 'tier1-official', 'finance', ['financial_data', 'regulatory_data'], 'web_reference', ['investment'], 'Official foreign exchange regulatory source.'),
  seed('guangdong-ftz-nansha', 'Guangdong Free Trade Zone / Nansha official sources', 'https://www.gzns.gov.cn/', 'tier1-official', 'regulatory', ['regulatory_data', 'company_data'], 'web_reference', officialScreens, 'Official regional investment and industrial policy source.'),
  seed('guangzhou-government-commerce', 'Guangzhou government / commerce sources', 'https://www.gz.gov.cn/', 'tier1-official', 'regulatory', ['regulatory_data', 'company_data'], 'web_reference', officialScreens, 'Official Guangzhou policy and commerce reference.'),
  seed('zhejiang-stat-commerce', 'Zhejiang statistical/commerce sources', 'https://www.zj.gov.cn/', 'tier1-official', 'macro', ['market_size', 'company_data'], 'web_reference', marketScreens, 'Official Zhejiang data and commerce source.'),
  seed('jiangsu-stat-commerce', 'Jiangsu statistical/commerce sources', 'https://www.jiangsu.gov.cn/', 'tier1-official', 'macro', ['market_size', 'company_data'], 'web_reference', marketScreens, 'Official Jiangsu data and commerce source.'),
  seed('fujian-stat-commerce', 'Fujian statistical/commerce sources', 'https://www.fujian.gov.cn/', 'tier1-official', 'macro', ['market_size', 'company_data'], 'web_reference', marketScreens, 'Official Fujian data and commerce source.'),
  seed('shandong-stat-commerce', 'Shandong statistical/commerce sources', 'https://www.shandong.gov.cn/', 'tier1-official', 'macro', ['market_size', 'company_data'], 'web_reference', marketScreens, 'Official Shandong data and commerce source.'),
  seed('bangladesh-bank', 'Bangladesh Bank', 'https://www.bb.org.bd/', 'tier1-official', 'finance', ['financial_data', 'company_data'], 'web_reference', ['investment', 'market'], 'Official Bangladesh financial and macro reference.'),
  seed('bangladesh-epb', 'Bangladesh Export Promotion Bureau', 'https://epb.gov.bd/', 'tier1-official', 'trade', ['trade_data', 'market_size'], 'web_reference', marketScreens, 'Official Bangladesh export data reference.'),
  seed('zdhc-gateway', 'ZDHC Gateway', 'https://www.zdhc-gateway.com/', 'tier2-market-reference', 'chemical', ['regulatory_data', 'document_evidence'], 'web_reference', chemicalScreens, 'Textile chemical compliance reference; verify exact product records.'),
  seed('zdhc-roadmap', 'ZDHC MRSL / Roadmap to Zero', 'https://www.roadmaptozero.com/', 'tier2-market-reference', 'chemical', ['regulatory_data'], 'web_reference', chemicalScreens, 'Textile chemical compliance and MRSL reference.'),
  seed('oeko-tex', 'OEKO-TEX', 'https://www.oeko-tex.com/', 'tier2-market-reference', 'chemical', ['regulatory_data'], 'web_reference', chemicalScreens, 'Textile certification and chemical compliance reference.'),
  seed('gots', 'GOTS', 'https://global-standard.org/', 'tier2-market-reference', 'chemical', ['regulatory_data'], 'web_reference', chemicalScreens, 'Textile certification and chemical input reference.'),
  seed('echa', 'ECHA', 'https://echa.europa.eu/', 'tier1-official', 'chemical', ['regulatory_data'], 'web_reference', chemicalScreens, 'Official EU chemical regulatory database.'),
  seed('pubchem', 'PubChem', 'https://pubchem.ncbi.nlm.nih.gov/', 'tier1-official', 'chemical', ['regulatory_data', 'document_evidence'], 'API', chemicalScreens, 'Official public chemical identity/reference database.'),
  seed('epa-comptox', 'US EPA CompTox', 'https://comptox.epa.gov/', 'tier1-official', 'chemical', ['regulatory_data'], 'API', chemicalScreens, 'Official US EPA chemical information source.'),
  seed('nite-chrip', 'NITE Japan CHRIP', 'https://www.nite.go.jp/', 'tier1-official', 'chemical', ['regulatory_data'], 'web_reference', chemicalScreens, 'Official Japan chemical regulatory reference.'),
  seed('cirs-china-chemical', 'CIRS Group China chemical regulatory resources', 'https://www.cirs-group.com/', 'tier2-market-reference', 'chemical', ['regulatory_data'], 'web_reference', chemicalScreens, 'Specialist regulatory reference; review before Verified.'),
  seed('chemlinked-china-chemical', 'ChemLinked China chemical regulatory resources', 'https://chemical.chemlinked.com/', 'tier2-market-reference', 'chemical', ['regulatory_data'], 'paid_source', chemicalScreens, 'Specialist regulatory reference; paid access may require research job.'),
  seed('intertek-chemical', 'Intertek chemical regulatory resources', 'https://www.intertek.com/', 'tier2-market-reference', 'chemical', ['regulatory_data'], 'web_reference', chemicalScreens, 'Compliance service reference; not official regulator.'),
  seed('sgs-chemical', 'SGS chemical/regulatory services', 'https://www.sgs.com/', 'tier2-market-reference', 'chemical', ['regulatory_data'], 'web_reference', chemicalScreens, 'Compliance service reference; not official regulator.'),
  seed('tuv-rheinland-chemical', 'TÜV Rheinland chemical/regulatory services', 'https://www.tuv.com/', 'tier2-market-reference', 'chemical', ['regulatory_data'], 'web_reference', chemicalScreens, 'Compliance service reference; not official regulator.'),
  seed('ul-prospector', 'UL Prospector / ingredient information', 'https://www.ulprospector.com/', 'tier2-market-reference', 'chemical', ['document_evidence', 'regulatory_data'], 'paid_source', chemicalScreens, 'Ingredient reference; review access and source context.'),
  seed('chemicalbook-sds', 'ChemicalBook SDS/reference', 'https://www.chemicalbook.com/', 'tier2-market-reference', 'chemical', ['document_evidence', 'supplier_quote'], 'web_reference', chemicalScreens, 'Chemical reference and supplier data; confirm against SDS/TDS.'),
  seed('sunsirs-commodity', 'SunSirs China Commodity Data', 'https://www.sunsirs.com/', 'tier2-market-reference', 'price', ['price_data'], 'web_reference', ['market', 'competitor', 'investment'], 'Market reference only. Capture source/date and keep price-sensitive fields redacted.'),
  seed('sunsirs-chemical-spot', 'SunSirs Chemical Spot Prices', 'https://www.sunsirs.com/uk/sectors-14.html', 'tier2-market-reference', 'price', ['price_data'], 'web_reference', ['market', 'competitor', 'investment'], 'Chemical spot price reference; not supplier quote.'),
  seed('echemi-weekly-price', 'ECHEMI Chemical Prices', 'https://www.echemi.com/weekly-price.html', 'tier2-market-reference', 'price', ['price_data'], 'web_reference', ['market', 'competitor', 'investment'], 'Market reference only. Do not treat listings as final verified pricing.'),
  seed('echemi-price-database', 'ECHEMI Price Database', 'https://www.echemi.com/price-database.html', 'tier2-market-reference', 'price', ['price_data'], 'web_reference', ['market', 'competitor', 'investment'], 'Price database reference; supplier quote still required for procurement.'),
  seed('icis', 'ICIS', 'https://www.icis.com/', 'tier2-market-reference', 'price', ['price_data', 'market_size'], 'paid_source', ['market', 'investment'], 'Market intelligence source; paid access requires review/fallback.'),
  seed('argus-media', 'Argus Media', 'https://www.argusmedia.com/', 'tier2-market-reference', 'price', ['price_data', 'market_size'], 'paid_source', ['market', 'investment'], 'Commodity price reference; paid access requires review/fallback.'),
  seed('sp-global-commodity', 'S&P Global Commodity Insights', 'https://www.spglobal.com/commodityinsights/', 'tier2-market-reference', 'price', ['price_data', 'market_size'], 'paid_source', ['market', 'investment'], 'Commodity intelligence reference; paid access requires review/fallback.'),
  seed('chemanalyst', 'ChemAnalyst', 'https://www.chemanalyst.com/', 'tier2-market-reference', 'price', ['price_data', 'market_size'], 'paid_source', ['market', 'investment'], 'Chemical market reference; review source license and date.'),
  seed('chemorbis', 'ChemOrbis', 'https://www.chemorbis.com/', 'tier2-market-reference', 'price', ['price_data'], 'paid_source', ['market', 'investment'], 'Commodity market reference; review source license and date.'),
  seed('polymerupdate', 'Polymerupdate', 'https://www.polymerupdate.com/', 'tier2-market-reference', 'price', ['price_data'], 'paid_source', ['market', 'investment'], 'Commodity market reference; review source license and date.'),
  seed('asian-metal', 'Asian Metal', 'https://www.asianmetal.com/', 'tier2-market-reference', 'price', ['price_data'], 'paid_source', ['market', 'investment'], 'Market reference; paid access requires review/fallback.'),
  seed('dalian-commodity-exchange', 'Dalian Commodity Exchange', 'https://www.dce.com.cn/', 'tier1-official', 'price', ['price_data'], 'API', ['market', 'investment'], 'Official futures exchange reference where relevant.'),
  seed('shanghai-futures-exchange', 'Shanghai Futures Exchange', 'https://www.shfe.com.cn/', 'tier1-official', 'price', ['price_data'], 'API', ['market', 'investment'], 'Official futures exchange reference where relevant.'),
  seed('zhengzhou-commodity-exchange', 'Zhengzhou Commodity Exchange', 'https://www.czce.com.cn/', 'tier1-official', 'price', ['price_data'], 'API', ['market', 'investment'], 'Official futures exchange reference where relevant.'),
  seed('bursa-malaysia-palm-oil', 'Bursa Malaysia palm oil futures', 'https://www.bursamalaysia.com/', 'tier1-official', 'price', ['price_data'], 'web_reference', ['market', 'investment'], 'Official exchange source for palm-oil-linked inputs where relevant.'),
  seed('alibaba', 'Alibaba', 'https://www.alibaba.com/', 'tier4-public-listing', 'supplier', ['price_data', 'supplier_quote'], 'web_reference', ['market', 'competitor'], 'Weak public listing. Reference Only, never Verified without supplier confirmation.'),
  seed('made-in-china', 'Made-in-China', 'https://www.made-in-china.com/', 'tier4-public-listing', 'supplier', ['price_data', 'supplier_quote'], 'web_reference', ['market', 'competitor'], 'Weak public listing. Reference Only, never Verified without supplier confirmation.'),
  seed('1688', '1688', 'https://www.1688.com/', 'tier4-public-listing', 'supplier', ['price_data', 'supplier_quote'], 'web_reference', ['market', 'competitor'], 'Weak public listing. Reference Only, never Verified without supplier confirmation.'),
  seed('chemicalbook-supplier', 'ChemicalBook supplier/reference', 'https://www.chemicalbook.com/', 'tier4-public-listing', 'supplier', ['supplier_quote', 'document_evidence'], 'web_reference', ['market', 'competitor'], 'Supplier/reference listing; confirm with SDS/TDS or quote.'),
  seed('lookchem', 'LookChem', 'https://www.lookchem.com/', 'tier4-public-listing', 'supplier', ['supplier_quote'], 'web_reference', ['market', 'competitor'], 'Supplier listing; confirm with direct supplier evidence.'),
  seed('guidechem', 'GuideChem', 'https://www.guidechem.com/', 'tier4-public-listing', 'supplier', ['supplier_quote'], 'web_reference', ['market', 'competitor'], 'Supplier listing; confirm with direct supplier evidence.'),
  seed('chembk', 'ChemBK', 'https://www.chembk.com/', 'tier4-public-listing', 'supplier', ['supplier_quote', 'document_evidence'], 'web_reference', ['market', 'competitor'], 'Chemical reference; confirm with source documents.'),
  seed('specialchem', 'SpecialChem', 'https://www.specialchem.com/', 'tier4-public-listing', 'supplier', ['document_evidence', 'company_data'], 'web_reference', ['market', 'competitor'], 'Industry/product reference; verify exact claims.'),
  seed('molbase-molichem', 'Molbase / Molichem-style chemical supplier references', 'https://www.molbase.com/', 'tier4-public-listing', 'supplier', ['supplier_quote'], 'web_reference', ['market', 'competitor'], 'Supplier reference if accessible; confirm directly.'),
  seed('supplier-uploaded-quote', 'Supplier-uploaded quotation / PI / invoice files', 'uploaded supplier evidence', 'tier3-supplier-evidence', 'supplier', ['supplier_quote', 'price_data', 'document_evidence'], 'supplier_quote', supplierScreens, 'Supplier evidence can update quote fields, but cost/formula visibility remains restricted.'),
  seed('itmf', 'ITMF', 'https://www.itmf.org/', 'tier2-market-reference', 'textile', ['market_size', 'company_data'], 'paid_source', marketScreens, 'Textile industry reference; review source date and scope.'),
  seed('textile-exchange', 'Textile Exchange', 'https://textileexchange.org/', 'tier2-market-reference', 'textile', ['market_size', 'company_data'], 'web_reference', marketScreens, 'Textile industry reference.'),
  seed('cntac', 'China National Textile and Apparel Council sources', 'https://www.cntac.org.cn/', 'tier2-market-reference', 'textile', ['market_size', 'company_data'], 'web_reference', marketScreens, 'China textile industry association reference.'),
  seed('ctic', 'China Textile Information Center sources', 'https://www.ctei.cn/', 'tier2-market-reference', 'textile', ['market_size', 'company_data'], 'web_reference', marketScreens, 'China textile information reference.'),
  seed('iaf', 'International Apparel Federation', 'https://iafnet.eu/', 'tier2-market-reference', 'textile', ['market_size', 'company_data'], 'web_reference', marketScreens, 'Apparel industry reference.'),
  seed('fibre2fashion', 'Fibre2Fashion', 'https://www.fibre2fashion.com/', 'tier2-market-reference', 'textile', ['market_size', 'company_data'], 'web_reference', marketScreens, 'Industry media reference; review before investor use.'),
  seed('just-style', 'Just Style', 'https://www.just-style.com/', 'tier2-market-reference', 'textile', ['market_size', 'company_data'], 'web_reference', marketScreens, 'Industry media reference; review before investor use.'),
  seed('grand-view-research', 'Grand View Research', 'https://www.grandviewresearch.com/', 'tier2-market-reference', 'market', ['market_size'], 'paid_source', marketScreens, 'Market report reference; paid/source details require review.'),
  seed('marketsandmarkets', 'MarketsandMarkets', 'https://www.marketsandmarkets.com/', 'tier2-market-reference', 'market', ['market_size'], 'paid_source', marketScreens, 'Market report reference; paid/source details require review.'),
  seed('research-and-markets', 'Research and Markets', 'https://www.researchandmarkets.com/', 'tier2-market-reference', 'market', ['market_size'], 'paid_source', marketScreens, 'Market report marketplace; review exact report/source.'),
  seed('mordor-intelligence', 'Mordor Intelligence', 'https://www.mordorintelligence.com/', 'tier2-market-reference', 'market', ['market_size'], 'paid_source', marketScreens, 'Market report reference; review scope and date.'),
  seed('statista', 'Statista', 'https://www.statista.com/', 'tier2-market-reference', 'market', ['market_size'], 'paid_source', marketScreens, 'Market statistics reference; review scope and source.'),
  seed('euromonitor', 'Euromonitor', 'https://www.euromonitor.com/', 'tier2-market-reference', 'market', ['market_size'], 'paid_source', marketScreens, 'Market report reference; paid access requires review.'),
  seed('mckinsey-apparel-fashion', 'McKinsey apparel/fashion reports', 'https://www.mckinsey.com/', 'tier2-market-reference', 'market', ['market_size', 'company_data'], 'web_reference', marketScreens, 'Consulting report reference; review relevance and date.'),
  seed('deloitte-chemical-manufacturing', 'Deloitte chemical/manufacturing reports', 'https://www.deloitte.com/', 'tier2-market-reference', 'market', ['market_size', 'company_data'], 'web_reference', marketScreens, 'Consulting report reference; review relevance and date.'),
  seed('evonik', 'Evonik official', 'https://www.evonik.com/', 'tier2-market-reference', 'competitor', ['competitor_data', 'company_data'], 'web_reference', competitorScreens, 'Official competitor source for company/product claims.'),
  seed('stepan', 'Stepan official', 'https://www.stepan.com/', 'tier2-market-reference', 'competitor', ['competitor_data', 'company_data'], 'web_reference', competitorScreens, 'Official competitor source for company/product claims.'),
  seed('kao', 'Kao official', 'https://www.kao.com/', 'tier2-market-reference', 'competitor', ['competitor_data', 'company_data'], 'web_reference', competitorScreens, 'Official competitor source for company/product claims.'),
  seed('wacker', 'Wacker official', 'https://www.wacker.com/', 'tier2-market-reference', 'competitor', ['competitor_data', 'company_data'], 'web_reference', competitorScreens, 'Official competitor source for company/product claims.'),
  seed('rudolf', 'Rudolf official', 'https://www.rudolf.de/', 'tier2-market-reference', 'competitor', ['competitor_data', 'company_data'], 'web_reference', competitorScreens, 'Official competitor source for company/product claims.'),
  seed('cht-group', 'CHT Group official', 'https://www.cht.com/', 'tier2-market-reference', 'competitor', ['competitor_data', 'company_data'], 'web_reference', competitorScreens, 'Official competitor source for company/product claims.'),
  seed('archroma', 'Archroma official', 'https://www.archroma.com/', 'tier2-market-reference', 'competitor', ['competitor_data', 'company_data'], 'web_reference', competitorScreens, 'Official competitor source for company/product claims.'),
  seed('zschimmer-schwarz', 'Zschimmer & Schwarz official', 'https://www.zschimmer-schwarz.com/', 'tier2-market-reference', 'competitor', ['competitor_data', 'company_data'], 'web_reference', competitorScreens, 'Official competitor source for company/product claims.'),
  seed('pulcra-chemicals', 'Pulcra Chemicals official', 'https://www.pulcra-chemicals.com/', 'tier2-market-reference', 'competitor', ['competitor_data', 'company_data'], 'web_reference', competitorScreens, 'Official competitor source for company/product claims.'),
  seed('transfar', 'Transfar official', 'https://www.transfarchem.com/', 'tier2-market-reference', 'competitor', ['competitor_data', 'company_data'], 'web_reference', competitorScreens, 'Official competitor source for company/product claims.'),
  seed('syensqo', 'Solvay / Syensqo official', 'https://www.syensqo.com/', 'tier2-market-reference', 'competitor', ['competitor_data', 'company_data'], 'web_reference', competitorScreens, 'Official competitor source for company/product claims.'),
  seed('basf', 'BASF official', 'https://www.basf.com/', 'tier2-market-reference', 'competitor', ['competitor_data', 'company_data'], 'web_reference', competitorScreens, 'Official competitor source for company/product claims.'),
  seed('dow', 'Dow official', 'https://www.dow.com/', 'tier2-market-reference', 'competitor', ['competitor_data', 'company_data'], 'web_reference', competitorScreens, 'Official competitor source for company/product claims.'),
  seed('shin-etsu', 'Shin-Etsu official', 'https://www.shinetsu.co.jp/', 'tier2-market-reference', 'competitor', ['competitor_data', 'company_data'], 'web_reference', competitorScreens, 'Official competitor source for company/product claims.'),
  seed('momentive', 'Momentive official', 'https://www.momentive.com/', 'tier2-market-reference', 'competitor', ['competitor_data', 'company_data'], 'web_reference', competitorScreens, 'Official competitor source for company/product claims.'),
]

export const DEFAULT_TRUSTED_SOURCES: TrustedSourceRecord[] = SOURCE_SEEDS.map(sourceRecord)

function sourceRecord(seedRecord: SourceSeed): TrustedSourceRecord {
  return {
    source_id: seedRecord.source_id,
    name: seedRecord.name,
    domain: normalizeDomain(seedRecord.url) || seedRecord.url,
    url: seedRecord.url,
    tier: seedRecord.tier,
    category: seedRecord.category,
    data_type: seedRecord.dataTypes[0],
    data_types_supported: seedRecord.dataTypes,
    allowed_for: seedRecord.allowedFor,
    connector_type: seedRecord.connector,
    update_frequency: seedRecord.frequency,
    confidence_default: seedRecord.confidence,
    auto_update_allowed: seedRecord.autoUpdate,
    requires_review: seedRecord.requiresReview,
    enabled: true,
    last_checked: null,
    last_failure: null,
    notes: seedRecord.notes,
  }
}

export function normalizeDomain(input = ''): string {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return ''
  try {
    return new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`).hostname.replace(/^www\./, '')
  } catch {
    return trimmed.replace(/^www\./, '').split('/')[0]
  }
}

export function classifySourceCandidate(candidate: TrustedSourceCandidate): Omit<TrustedSourceRecord, 'source_id' | 'last_checked' | 'last_failure'> {
  const domain = normalizeDomain(candidate.domain || candidate.url || '')
  const isTier1 = TIER1_DOMAINS.some(item => domain.endsWith(item))
  const isTier2 = TIER2_DOMAINS.some(item => domain.endsWith(item))
  const isTier4 = TIER4_DOMAINS.some(item => domain.endsWith(item))
  const tier: TrustedSourceTier = isTier1
    ? 'tier1-official'
    : isTier2
      ? 'tier2-market-reference'
      : isTier4
        ? 'tier4-public-listing'
        : 'candidate-source'
  return {
    name: candidate.name?.trim() || domain || 'Candidate Source',
    domain: domain || 'unknown',
    url: candidate.url || (domain ? `https://${domain}` : ''),
    tier,
    category: candidate.dataType === 'price_data' ? 'price' : candidate.dataType === 'competitor_data' ? 'competitor' : candidate.dataType === 'financial_data' ? 'finance' : candidate.dataType === 'regulatory_data' ? 'regulatory' : 'market',
    data_type: candidate.dataType,
    data_types_supported: [candidate.dataType],
    allowed_for: candidate.screen ? [candidate.screen] : ['executive', 'market', 'investment', 'competitor'],
    connector_type: tier === 'tier1-official' ? 'API' : tier === 'candidate-source' ? 'research_job' : 'web_reference',
    update_frequency: tier === 'tier1-official' ? 'twice_daily' : 'daily_review',
    confidence_default: tier === 'tier1-official' ? 'high' : tier === 'tier2-market-reference' ? 'medium' : 'low',
    auto_update_allowed: tier === 'tier1-official' || tier === 'tier2-market-reference',
    requires_review: tier === 'tier4-public-listing' || tier === 'candidate-source',
    enabled: true,
    notes: tier === 'candidate-source'
      ? 'Unknown source. Store as Candidate Source / To Verify until owner classifies it.'
      : 'Auto-classified from allowlisted domain.',
  }
}

export function evidenceStatusForTier(tier: TrustedSourceTier, hasConflict = false): IntelligenceEvidenceStatus {
  if (hasConflict) return 'Conflict Detected'
  if (tier === 'tier1-official') return 'Trusted Source Auto-Updated'
  if (tier === 'tier2-market-reference') return 'Market Reference'
  if (tier === 'tier3-supplier-evidence') return 'Supplier Evidence'
  if (tier === 'tier4-public-listing') return 'Reference Only'
  return 'Candidate Source'
}

export function sourceRequiresReview(source: TrustedSourceRecord, options: {
  hasConflict?: boolean
  investorApprovedImpact?: boolean
  largeChange?: boolean
  sensitiveVisibilityRisk?: boolean
  overwritesUserApprovedAssumption?: boolean
} = {}): boolean {
  return source.requires_review ||
    !!options.hasConflict ||
    !!options.investorApprovedImpact ||
    !!options.largeChange ||
    !!options.sensitiveVisibilityRisk ||
    !!options.overwritesUserApprovedAssumption
}

export function isSensitiveAutopilotDataType(dataType: TrustedSourceDataType): boolean {
  return dataType === 'price_data' ||
    dataType === 'financial_data' ||
    dataType === 'supplier_quote'
}

export function snapshotVisibility(screen: AutopilotScreen, dataTypes: TrustedSourceDataType[]): TrustedSourceSnapshot['user_visibility'] {
  if (screen === 'investment' || dataTypes.some(isSensitiveAutopilotDataType)) return 'financial-only'
  if (screen === 'executive') return 'owner-only'
  return 'employee-safe'
}
