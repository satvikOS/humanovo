import { describe, it, expect } from 'vitest'
import { run } from './computeEngine'
import { WORKSTATION_TEMPLATES } from './workstationTemplates'

// localStorage / window shims so the imaging-bridge builtins do not throw
// at module scope when run under node.
const g = globalThis as unknown as {
  localStorage?: Storage
  window?: { dispatchEvent: () => boolean }
  performance?: { now: () => number }
}
if (!g.localStorage) {
  const store = new Map<string, string>()
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage
}
if (!g.window) g.window = { dispatchEvent: () => true }
if (!g.performance) g.performance = { now: () => Date.now() }

/** Run a script and return the numeric value of `ans` (or named var). */
function val(src: string, name = 'ans'): number {
  const res = run(src)
  const err = res.outputs.find(o => o.kind === 'error')
  if (err) throw new Error(`engine error: ${err.text}`)
  const v = res.workspace.vars.get(name)
  if (!v) throw new Error(`variable ${name} not set`)
  if (v.kind === 'num') return v.v
  if (v.kind === 'bool') return v.v ? 1 : 0
  if (v.kind === 'mat' && v.data.length === 1) return v.data[0]
  throw new Error(`variable ${name} is not a scalar`)
}

/** Return the matrix data for a named workspace variable. */
function mat(src: string, name: string): { rows: number; cols: number; data: number[] } {
  const res = run(src)
  const err = res.outputs.find(o => o.kind === 'error')
  if (err) throw new Error(`engine error: ${err.text}`)
  const v = res.workspace.vars.get(name)
  if (!v) throw new Error(`variable ${name} not set`)
  if (v.kind === 'mat') return { rows: v.rows, cols: v.cols, data: Array.from(v.data) }
  if (v.kind === 'num') return { rows: 1, cols: 1, data: [v.v] }
  throw new Error(`variable ${name} is not a matrix`)
}

describe('implicit expansion (broadcasting)', () => {
  it('40x2 + 1x2 row vector broadcasts across rows', () => {
    const m = mat('A = ones(40, 2) + [10 20];', 'A')
    expect(m.rows).toBe(40)
    expect(m.cols).toBe(2)
    expect(m.data[0]).toBe(11)
    expect(m.data[1]).toBe(21)
    expect(m.data[78]).toBe(11)
    expect(m.data[79]).toBe(21)
  })
  it('3x1 column vector + 1x3 row vector forms a 3x3 grid', () => {
    const m = mat('A = [1;2;3] + [10 20 30];', 'A')
    expect(m.rows).toBe(3)
    expect(m.cols).toBe(3)
    expect(m.data).toEqual([11, 21, 31, 12, 22, 32, 13, 23, 33])
  })
  it('Mx3 ./ 1x3 broadcasts', () => {
    const m = mat('A = [2 4 6; 8 10 12] ./ [2 2 2];', 'A')
    expect(m.data).toEqual([1, 2, 3, 4, 5, 6])
  })
  it('column + matrix broadcasts each column', () => {
    const m = mat('A = [1;2] + [10 20 30; 40 50 60];', 'A')
    expect(m.data).toEqual([11, 21, 31, 42, 52, 62])
  })
  it('elementwise comparison broadcasts', () => {
    const m = mat('A = [1 2 3; 4 5 6] >= [3 3 3];', 'A')
    expect(m.data).toEqual([0, 0, 1, 1, 1, 1])
  })
  it('rejects genuinely nonconformant shapes', () => {
    const res = run('A = ones(3,2) + ones(2,3);')
    expect(res.outputs.some(o => o.kind === 'error')).toBe(true)
  })
})

describe('matrix arithmetic & linear algebra', () => {
  it('matrix multiply', () => {
    const m = mat('A = [1 2; 3 4] * [5 6; 7 8];', 'A')
    expect(m.data).toEqual([19, 22, 43, 50])
  })
  it('left division solves Ax=b', () => {
    expect(val('A=[2 0;0 4]; b=[4;8]; x=A\\b; r=x(1);', 'r')).toBeCloseTo(2)
    expect(val('A=[2 0;0 4]; b=[4;8]; x=A\\b; r=x(2);', 'r')).toBeCloseTo(2)
  })
  it('det and inv', () => {
    expect(val('d = det([1 2; 3 4]);', 'd')).toBeCloseTo(-2)
    const m = mat('M = inv([4 7; 2 6]);', 'M')
    expect(m.data[0]).toBeCloseTo(0.6)
    expect(m.data[3]).toBeCloseTo(0.4)
  })
  it('eig of symmetric 3x3 matches characteristic values', () => {
    const m = mat('e = eig([2 0 0; 0 3 0; 0 0 5]);', 'e')
    expect(m.data.slice().sort((a, b) => a - b)).toEqual([2, 3, 5])
  })
  it('eig of non-trivial symmetric matrix', () => {
    // [[2,1],[1,2]] -> eigenvalues 1, 3
    const m = mat('e = eig([2 1; 1 2]);', 'e')
    expect(m.data.slice().sort((a, b) => a - b).map(x => Math.round(x))).toEqual([1, 3])
  })
  it('svd singular values of diagonal matrix', () => {
    const m = mat('s = svd([3 0; 0 4]);', 's')
    expect(m.data.slice().sort((a, b) => b - a)).toEqual([4, 3])
  })
  it('norm of a vector', () => {
    expect(val('n = norm([3 4]);', 'n')).toBeCloseTo(5)
  })
  it('lu decomposition reproduces A', () => {
    // L*U should equal P*A
    const res = run('[L,U,P] = lu([4 3; 6 3]); R = P*([4 3;6 3]) - L*U;')
    expect(res.outputs.some(o => o.kind === 'error')).toBe(false)
    const m = mat('[L,U,P] = lu([4 3; 6 3]); R = P*([4 3;6 3]) - L*U;', 'R')
    for (const v of m.data) expect(Math.abs(v)).toBeLessThan(1e-9)
  })
  it('qr decomposition reproduces A', () => {
    const m = mat('[Q,R] = qr([1 2; 3 4]); D = Q*R - [1 2;3 4];', 'D')
    for (const v of m.data) expect(Math.abs(v)).toBeLessThan(1e-9)
  })
})

describe('reductions with dimension argument', () => {
  it('sum over columns (dim 1) and rows (dim 2)', () => {
    expect(mat('s = sum([1 2; 3 4], 1);', 's').data).toEqual([4, 6])
    expect(mat('s = sum([1 2; 3 4], 2);', 's').data).toEqual([3, 7])
  })
  it('mean with dim', () => {
    expect(mat('m = mean([2 4; 6 8], 1);', 'm').data).toEqual([4, 6])
  })
  it('max with dim', () => {
    expect(mat('m = max([1 9; 7 3], [], 1);', 'm').data).toEqual([7, 9])
  })
  it('cumsum on a vector', () => {
    expect(mat('c = cumsum([1 2 3 4]);', 'c').data).toEqual([1, 3, 6, 10])
  })
})

describe('builders & reshaping', () => {
  it('linspace', () => {
    const m = mat('v = linspace(0, 1, 5);', 'v')
    expect(m.data).toEqual([0, 0.25, 0.5, 0.75, 1])
  })
  it('colon range', () => {
    expect(mat('v = 1:5;', 'v').data).toEqual([1, 2, 3, 4, 5])
    expect(mat('v = 0:2:8;', 'v').data).toEqual([0, 2, 4, 6, 8])
  })
  it('reshape', () => {
    const m = mat('M = reshape(1:6, 2, 3);', 'M')
    expect(m.rows).toBe(2)
    expect(m.cols).toBe(3)
  })
  it('repmat', () => {
    const m = mat('M = repmat([1 2], 2, 2);', 'M')
    expect(m.data).toEqual([1, 2, 1, 2, 1, 2, 1, 2])
  })
  it('kron', () => {
    const m = mat('M = kron([1 0; 0 1], [1 2; 3 4]);', 'M')
    expect(m.rows).toBe(4)
    expect(m.cols).toBe(4)
  })
  it('meshgrid multi-output', () => {
    const X = mat('[X, Y] = meshgrid(1:3, 1:2);', 'X')
    const Y = mat('[X, Y] = meshgrid(1:3, 1:2);', 'Y')
    expect(X.data).toEqual([1, 2, 3, 1, 2, 3])
    expect(Y.data).toEqual([1, 1, 1, 2, 2, 2])
  })
})

describe('control flow & functions', () => {
  it('for loop accumulation', () => {
    expect(val('s = 0; for i = 1:10; s = s + i; end', 's')).toBe(55)
  })
  it('while loop', () => {
    expect(val('n = 0; k = 1; while k < 100; k = k * 2; n = n + 1; end', 'n')).toBe(7)
  })
  it('if/elseif/else', () => {
    expect(val('x = 5; if x > 10; y = 1; elseif x > 3; y = 2; else; y = 3; end', 'y')).toBe(2)
  })
  it('user function with return value', () => {
    expect(val('function r = sq(x); r = x^2; end\nans = sq(7);')).toBe(49)
  })
  it('anonymous function', () => {
    expect(val('f = @(x) x^2 + 1; ans = f(4);')).toBe(17)
  })
  it('arrayfun over anonymous function', () => {
    expect(mat('f = @(x) x.^2; v = arrayfun(f, [1 2 3 4]);', 'v').data).toEqual([1, 4, 9, 16])
  })
})

describe('indexing & slicing', () => {
  it('row and column slices', () => {
    expect(mat('M = [1 2 3; 4 5 6]; r = M(1,:);', 'r').data).toEqual([1, 2, 3])
    expect(mat('M = [1 2 3; 4 5 6]; c = M(:,2);', 'c').data).toEqual([2, 5])
  })
  it('end keyword', () => {
    expect(val('v = [10 20 30 40]; x = v(end);', 'x')).toBe(40)
  })
  it('logical indexing', () => {
    expect(mat('v = [1 2 3 4 5 6]; x = v(v > 3);', 'x').data).toEqual([4, 5, 6])
  })
  it('indexed assignment grows the matrix', () => {
    expect(mat('v = [1 2 3]; v(5) = 9;', 'v').data).toEqual([1, 2, 3, 0, 9])
  })
})

describe('polynomials & fft', () => {
  it('polyfit recovers a known line', () => {
    const p = mat('p = polyfit([0 1 2 3], [1 3 5 7], 1);', 'p')
    // p = [intercept, slope] in ascending order from this engine
    expect(p.data.map(x => Math.round(x))).toContain(2)
  })
  it('roots of x^2 - 3x + 2 are 1 and 2', () => {
    const m = mat('r = roots([1 -3 2]);', 'r')
    const reals = []
    for (let i = 0; i < m.rows; i++) reals.push(m.data[i * 2])
    expect(reals.slice().sort((a, b) => a - b).map(x => Math.round(x))).toEqual([1, 2])
  })
  it('fft multi-output [mag, freq]', () => {
    const res = run('t = 0:0.01:1; x = sin(2*pi*5*t); [mag, freq] = fft(x, 100);')
    expect(res.outputs.some(o => o.kind === 'error')).toBe(false)
    const freq = res.workspace.vars.get('freq')
    expect(freq && freq.kind === 'mat').toBe(true)
  })
})

describe('every workstation template runs without an engine error', () => {
  for (const tpl of WORKSTATION_TEMPLATES) {
    it(`${tpl.id} — ${tpl.name}`, () => {
      const res = run(tpl.code)
      const err = res.outputs.find(o => o.kind === 'error')
      if (err) throw new Error(`${tpl.id}: ${err.text}`)
      expect(err).toBeUndefined()
    })
  }
})
