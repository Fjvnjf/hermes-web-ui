import { describe, expect, it } from 'vitest'

import {
  classifySensitivityFromText,
  filterEmployeeVisibleFileEntries,
  isEmployeeFilePathAllowed,
  isTaskVisibleToRole,
  redactRestrictedObjectForRole,
  roleCanAccessText,
} from '../../packages/server/src/services/hermes/sensitivity'

describe('employee sensitivity guardrails', () => {
  it('classifies employee-safe, cost, formula, product-development, investor, and system content', () => {
    expect(classifySensitivityFromText('general market research note')).toBe('internal')
    expect(classifySensitivityFromText('supplier price and landed cost')).toBe('price-cost-sensitive')
    expect(classifySensitivityFromText('formula/CAS list and raw material ratio')).toBe('formula-secret')
    expect(classifySensitivityFromText('product development reactor discussion')).toBe('product-development-secret')
    expect(classifySensitivityFromText('product-development reactor discussion')).toBe('product-development-secret')
    expect(classifySensitivityFromText('product_development reactor discussion')).toBe('product-development-secret')
    expect(classifySensitivityFromText('investor terms and valuation')).toBe('investor-sensitive')
    expect(classifySensitivityFromText('investor_terms and term-sheet')).toBe('investor-sensitive')
    expect(classifySensitivityFromText('provider config api key')).toBe('system-admin-only')
  })

  it('lets employees see normal research text but blocks price, formula, product-development, investor, and system text', () => {
    expect(roleCanAccessText('employee', 'customer interview questions')).toBe(true)
    expect(roleCanAccessText('employee', 'supplier quote with landed cost')).toBe(false)
    expect(roleCanAccessText('employee', 'formula/CAS list')).toBe(false)
    expect(roleCanAccessText('employee', 'product development DMS process note')).toBe(false)
    expect(roleCanAccessText('employee', 'investor terms and ownership')).toBe(false)
    expect(roleCanAccessText('employee', 'api key provider config')).toBe(false)
  })

  it('allows financial analysts to see cost text but not formula, product-development, investor, or system secrets', () => {
    expect(roleCanAccessText('financial_analyst', 'supplier price and working capital')).toBe(true)
    expect(roleCanAccessText('financial_analyst', 'formula/CAS list')).toBe(false)
    expect(roleCanAccessText('financial_analyst', 'product development DMS process note')).toBe(false)
    expect(roleCanAccessText('financial_analyst', 'investor terms and ownership')).toBe(false)
    expect(roleCanAccessText('financial_analyst', 'api key provider config')).toBe(false)
  })

  it('redacts restricted fields before returning objects to employees', () => {
    expect(redactRestrictedObjectForRole({
      supplierPrice: '$5/kg',
      grossMargin: '30%',
      publicNote: 'market interview pending',
      nested: { formulaCasList: 'secret CAS' },
      productDevelopmentPlan: 'pilot reactor',
      investorTerms: 'valuation note',
    }, 'employee')).toEqual({
      supplierPrice: '[Restricted]',
      grossMargin: '[Restricted]',
      publicNote: 'market interview pending',
      nested: { formulaCasList: '[Restricted]' },
      productDevelopmentPlan: '[Restricted]',
      investorTerms: '[Restricted]',
    })
  })

  it('limits employee file browsing to explicitly safe categories and blocks sensitive downloads', () => {
    expect(isEmployeeFilePathAllowed('employee-safe/research-note.md')).toBe(true)
    expect(isEmployeeFilePathAllowed('research/customer-interview.md')).toBe(true)
    expect(isEmployeeFilePathAllowed('supplier-quotes/quote.pdf')).toBe(false)
    expect(isEmployeeFilePathAllowed('formula/CAS-list.xlsx')).toBe(false)
    expect(isEmployeeFilePathAllowed('.env')).toBe(false)

    const entries = filterEmployeeVisibleFileEntries([
      { name: 'employee-safe', path: 'employee-safe', isDir: true },
      { name: 'supplier-quotes', path: 'supplier-quotes', isDir: true },
      { name: 'note.md', path: 'research/note.md', isDir: false },
      { name: 'cost.xlsx', path: 'research/cost.xlsx', isDir: false },
    ])
    expect(entries.map(entry => entry.path)).toEqual(['employee-safe', 'research/note.md'])
  })

  it('filters restricted Kanban tasks for employee roles', () => {
    expect(isTaskVisibleToRole({ title: 'Collect customer interview questions', body: 'No sensitive values' }, 'employee')).toBe(true)
    expect(isTaskVisibleToRole({ title: 'Upload supplier cost sheet', body: 'Contains landed cost and margin' }, 'employee')).toBe(false)
    expect(isTaskVisibleToRole({ title: 'Review formula/CAS list', body: 'Formula secret' }, 'employee')).toBe(false)
  })
})
