export type EvidenceStatus = 'Assumption' | 'User Provided' | 'To Verify' | 'Verified'

export interface EvidenceNumber {
  value: number
  evidenceStatus: EvidenceStatus
}

export interface ProductRevenueAssumption {
  name: string
  annualVolumeTon: number[]
  sellingPricePerTon: number[]
  capacityUtilization: number[]
  evidenceStatus: EvidenceStatus
}

export interface WorkingCapitalAssumptions {
  rawMaterialInventoryDays: EvidenceNumber
  finishedGoodsInventoryDays: EvidenceNumber
  customerCreditDays: EvidenceNumber
  supplierCreditDays: EvidenceNumber
  safetyCashBuffer: EvidenceNumber
}

export interface FundingAssumptions {
  investorAmount: EvidenceNumber
  founderContribution: EvidenceNumber
  investorEquityPercent: EvidenceNumber
  exitYear: EvidenceNumber
  exitMultiple: EvidenceNumber
}

export interface InvestmentScenarioInput {
  projectName: string
  currency: string
  timelineYears: number
  setupMonths: EvidenceNumber
  operatingYears: number
  discountRate: EvidenceNumber
  taxRate: EvidenceNumber
  salvageValue: EvidenceNumber
  products: ProductRevenueAssumption[]
  variableCostPerTon: Record<string, EvidenceNumber>
  annualFixedCosts: Record<string, EvidenceNumber>
  capex: Record<string, EvidenceNumber>
  workingCapital: WorkingCapitalAssumptions
  funding: FundingAssumptions
}

export interface YearlyInvestmentResult {
  year: number
  volumeTon: number
  revenue: number
  variableCost: number
  grossProfit: number
  ebitda: number
  depreciation: number
  operatingProfit: number
  tax: number
  workingCapitalRequirement: number
  workingCapitalChange: number
  freeCashFlow: number
  cumulativeCashFlow: number
}

export interface SensitivityResult {
  label: string
  priceFactor: number
  costFactor: number
  npv: number
  irr: number | null
}

export interface InvestmentScenarioResult {
  yearly: YearlyInvestmentResult[]
  cashFlows: number[]
  capexTotal: number
  npv: number
  irr: number | null
  mirr: number | null
  paybackYear: number | null
  breakEvenVolumeTon: number | null
  finalCumulativeCashFlow: number
  sensitivity: SensitivityResult[]
  warnings: string[]
  incomplete: boolean
}

const VARIABLE_COST_LABELS = [
  'rawMaterials',
  'packaging',
  'labor',
  'utilities',
  'maintenance',
  'qcLab',
  'regulatory',
  'salesAdmin',
  'logistics',
  'insurance',
  'wasteTreatment',
  'contingency',
]

const FIXED_COST_LABELS = [
  'rent',
  'fixedLabor',
  'admin',
  'maintenanceFixed',
  'regulatoryFixed',
  'insuranceFixed',
]

const CAPEX_LABELS = [
  'machinery',
  'installation',
  'factorySetup',
  'labEquipment',
  'safetyFireSystems',
  'wastewaterTreatment',
  'tanksReactorsMixers',
  'engineering',
  'permitLegalCosts',
  'officeSetup',
]

function safeNumber(value: number | undefined | null): number {
  return Number.isFinite(value) ? Number(value) : 0
}

function clampYearCount(value: number): number {
  return Math.max(1, Math.min(20, Math.floor(safeNumber(value) || 1)))
}

export function evidenceNumber(value = 0, evidenceStatus: EvidenceStatus = 'Assumption'): EvidenceNumber {
  return { value, evidenceStatus }
}

export function createEmptyInvestmentScenario(projectName = 'Chemicon China Feasibility'): InvestmentScenarioInput {
  return {
    projectName,
    currency: 'USD',
    timelineYears: 5,
    setupMonths: evidenceNumber(0, 'To Verify'),
    operatingYears: 5,
    discountRate: evidenceNumber(0.12, 'Assumption'),
    taxRate: evidenceNumber(0, 'To Verify'),
    salvageValue: evidenceNumber(0, 'To Verify'),
    products: [
      {
        name: 'Product line 1',
        annualVolumeTon: [0, 0, 0, 0, 0],
        sellingPricePerTon: [0, 0, 0, 0, 0],
        capacityUtilization: [1, 1, 1, 1, 1],
        evidenceStatus: 'To Verify',
      },
    ],
    variableCostPerTon: Object.fromEntries(VARIABLE_COST_LABELS.map(key => [key, evidenceNumber(0, 'To Verify')])),
    annualFixedCosts: Object.fromEntries(FIXED_COST_LABELS.map(key => [key, evidenceNumber(0, 'To Verify')])),
    capex: Object.fromEntries(CAPEX_LABELS.map(key => [key, evidenceNumber(0, 'To Verify')])),
    workingCapital: {
      rawMaterialInventoryDays: evidenceNumber(0, 'To Verify'),
      finishedGoodsInventoryDays: evidenceNumber(0, 'To Verify'),
      customerCreditDays: evidenceNumber(0, 'To Verify'),
      supplierCreditDays: evidenceNumber(0, 'To Verify'),
      safetyCashBuffer: evidenceNumber(0, 'To Verify'),
    },
    funding: {
      investorAmount: evidenceNumber(0, 'To Verify'),
      founderContribution: evidenceNumber(0, 'To Verify'),
      investorEquityPercent: evidenceNumber(0, 'To Verify'),
      exitYear: evidenceNumber(0, 'To Verify'),
      exitMultiple: evidenceNumber(0, 'To Verify'),
    },
  }
}

export function npv(discountRate: number, cashFlows: number[]): number {
  return cashFlows.reduce((total, cashFlow, index) => {
    return total + safeNumber(cashFlow) / ((1 + discountRate) ** index)
  }, 0)
}

export function irr(cashFlows: number[]): number | null {
  const hasPositive = cashFlows.some(value => safeNumber(value) > 0)
  const hasNegative = cashFlows.some(value => safeNumber(value) < 0)
  if (!hasPositive || !hasNegative) return null

  let low = -0.9999
  let high = 10
  let lowValue = npv(low, cashFlows)
  let highValue = npv(high, cashFlows)

  if (Math.sign(lowValue) === Math.sign(highValue)) {
    return null
  }

  for (let i = 0; i < 120; i += 1) {
    const mid = (low + high) / 2
    const midValue = npv(mid, cashFlows)
    if (Math.abs(midValue) < 0.000001) return mid
    if (Math.sign(midValue) === Math.sign(lowValue)) {
      low = mid
      lowValue = midValue
    } else {
      high = mid
      highValue = midValue
    }
  }

  return (low + high) / 2
}

export function mirr(cashFlows: number[], financeRate: number, reinvestRate: number): number | null {
  const periods = cashFlows.length - 1
  if (periods <= 0) return null
  let positiveFutureValue = 0
  let negativePresentValue = 0

  cashFlows.forEach((cashFlow, index) => {
    const value = safeNumber(cashFlow)
    if (value > 0) positiveFutureValue += value * ((1 + reinvestRate) ** (periods - index))
    if (value < 0) negativePresentValue += value / ((1 + financeRate) ** index)
  })

  if (positiveFutureValue <= 0 || negativePresentValue >= 0) return null
  return ((positiveFutureValue / Math.abs(negativePresentValue)) ** (1 / periods)) - 1
}

function sumValues(values: Record<string, EvidenceNumber>): number {
  return Object.values(values).reduce((sum, item) => sum + safeNumber(item.value), 0)
}

function statusValues(input: InvestmentScenarioInput): EvidenceStatus[] {
  return [
    input.setupMonths.evidenceStatus,
    input.discountRate.evidenceStatus,
    input.taxRate.evidenceStatus,
    input.salvageValue.evidenceStatus,
    ...input.products.map(item => item.evidenceStatus),
    ...Object.values(input.variableCostPerTon).map(item => item.evidenceStatus),
    ...Object.values(input.annualFixedCosts).map(item => item.evidenceStatus),
    ...Object.values(input.capex).map(item => item.evidenceStatus),
    ...Object.values(input.workingCapital).map(item => item.evidenceStatus),
    ...Object.values(input.funding).map(item => item.evidenceStatus),
  ]
}

function isWeakEvidence(status: EvidenceStatus): boolean {
  return status === 'Assumption' || status === 'To Verify'
}

function workingCapitalRequirement(
  revenue: number,
  variableCost: number,
  rawMaterialCost: number,
  assumptions: WorkingCapitalAssumptions,
): number {
  const rawInventory = (rawMaterialCost / 365) * safeNumber(assumptions.rawMaterialInventoryDays.value)
  const finishedGoods = (variableCost / 365) * safeNumber(assumptions.finishedGoodsInventoryDays.value)
  const receivables = (revenue / 365) * safeNumber(assumptions.customerCreditDays.value)
  const payables = (rawMaterialCost / 365) * safeNumber(assumptions.supplierCreditDays.value)
  return Math.max(0, rawInventory + finishedGoods + receivables - payables + safeNumber(assumptions.safetyCashBuffer.value))
}

function cloneScenarioWithFactors(input: InvestmentScenarioInput, priceFactor: number, costFactor: number): InvestmentScenarioInput {
  return {
    ...input,
    products: input.products.map(product => ({
      ...product,
      sellingPricePerTon: product.sellingPricePerTon.map(value => safeNumber(value) * priceFactor),
    })),
    variableCostPerTon: Object.fromEntries(
      Object.entries(input.variableCostPerTon).map(([key, item]) => [key, { ...item, value: safeNumber(item.value) * costFactor }]),
    ),
    annualFixedCosts: Object.fromEntries(
      Object.entries(input.annualFixedCosts).map(([key, item]) => [key, { ...item, value: safeNumber(item.value) * costFactor }]),
    ),
  }
}

function calculateCore(input: InvestmentScenarioInput, includeSensitivity: boolean): InvestmentScenarioResult {
  const years = clampYearCount(input.operatingYears || input.timelineYears)
  const discountRate = safeNumber(input.discountRate.value)
  const taxRate = Math.max(0, safeNumber(input.taxRate.value))
  const capexTotal = sumValues(input.capex)
  const variableCostPerTon = sumValues(input.variableCostPerTon)
  const fixedCostTotal = sumValues(input.annualFixedCosts)
  const rawMaterialCost = safeNumber(input.variableCostPerTon.rawMaterials?.value)
  const depreciation = years > 0 ? capexTotal / years : 0
  const cashFlows = [-capexTotal]
  const yearly: YearlyInvestmentResult[] = []
  let previousWorkingCapital = 0
  let cumulativeCashFlow = -capexTotal

  for (let index = 0; index < years; index += 1) {
    let revenue = 0
    let volumeTon = 0
    for (const product of input.products) {
      const volume = safeNumber(product.annualVolumeTon[index])
      const price = safeNumber(product.sellingPricePerTon[index])
      const utilization = product.capacityUtilization[index] == null ? 1 : safeNumber(product.capacityUtilization[index])
      const effectiveVolume = volume * utilization
      volumeTon += effectiveVolume
      revenue += effectiveVolume * price
    }
    const variableCost = volumeTon * variableCostPerTon
    const grossProfit = revenue - variableCost
    const ebitda = grossProfit - fixedCostTotal
    const operatingProfit = ebitda - depreciation
    const tax = Math.max(0, operatingProfit * taxRate)
    const workingCapital = workingCapitalRequirement(revenue, variableCost, volumeTon * rawMaterialCost, input.workingCapital)
    const workingCapitalChange = workingCapital - previousWorkingCapital
    const terminalValue = index === years - 1 ? safeNumber(input.salvageValue.value) : 0
    const freeCashFlow = operatingProfit + depreciation - tax - workingCapitalChange + terminalValue
    cumulativeCashFlow += freeCashFlow
    cashFlows.push(freeCashFlow)
    yearly.push({
      year: index + 1,
      volumeTon,
      revenue,
      variableCost,
      grossProfit,
      ebitda,
      depreciation,
      operatingProfit,
      tax,
      workingCapitalRequirement: workingCapital,
      workingCapitalChange,
      freeCashFlow,
      cumulativeCashFlow,
    })
    previousWorkingCapital = workingCapital
  }

  const projectNpv = npv(discountRate, cashFlows)
  const projectIrr = irr(cashFlows)
  const projectMirr = mirr(cashFlows, discountRate, discountRate)
  const paybackYear = yearly.find(item => item.cumulativeCashFlow >= 0)?.year ?? null
  const firstYear = yearly[0]
  const averageSellingPrice = firstYear && firstYear.volumeTon > 0 ? firstYear.revenue / firstYear.volumeTon : 0
  const marginPerTon = averageSellingPrice - variableCostPerTon
  const breakEvenVolumeTon = marginPerTon > 0 ? fixedCostTotal / marginPerTon : null
  const statuses = statusValues(input)
  const weakEvidence = statuses.filter(isWeakEvidence).length
  const warnings: string[] = []
  if (capexTotal <= 0) warnings.push('Capex is missing, so investment returns are incomplete.')
  if (yearly.every(item => item.revenue <= 0)) warnings.push('Revenue assumptions are missing.')
  if (weakEvidence > 0) warnings.push('Outputs are derived from assumptions or unverified inputs.')
  if (projectIrr == null) warnings.push('IRR cannot be calculated unless cash flows include at least one negative and one positive value.')

  const sensitivity = includeSensitivity
    ? [
        { label: 'Price -10%, Cost Base', priceFactor: 0.9, costFactor: 1 },
        { label: 'Price Base, Cost +10%', priceFactor: 1, costFactor: 1.1 },
        { label: 'Price +10%, Cost Base', priceFactor: 1.1, costFactor: 1 },
      ].map(item => {
        const result = calculateCore(cloneScenarioWithFactors(input, item.priceFactor, item.costFactor), false)
        return {
          label: item.label,
          priceFactor: item.priceFactor,
          costFactor: item.costFactor,
          npv: result.npv,
          irr: result.irr,
        }
      })
    : []

  return {
    yearly,
    cashFlows,
    capexTotal,
    npv: projectNpv,
    irr: projectIrr,
    mirr: projectMirr,
    paybackYear,
    breakEvenVolumeTon,
    finalCumulativeCashFlow: cumulativeCashFlow,
    sensitivity,
    warnings,
    incomplete: warnings.length > 0,
  }
}

export function calculateInvestmentScenario(input: InvestmentScenarioInput): InvestmentScenarioResult {
  return calculateCore(input, true)
}
