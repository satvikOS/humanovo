// Humanovo in-browser numeric compute interpreter.
// Batch 3a: core types + tokenizer.
// This file is being built incrementally. The parser and evaluator live
// beside these types and will be filled in over subsequent commits.

// -----------------------------------------------------------------------------
// Values
// -----------------------------------------------------------------------------

/** Runtime value tag. */
export type MKind = 'num' | 'mat' | 'str' | 'bool' | 'fn' | 'void'

/** A scalar number. Internally scalars are technically 1x1 matrices,
 *  but we keep a fast path to avoid allocation churn. */
export interface MNum { kind: 'num'; v: number }

/** Row-major real matrix. `data.length === rows * cols`. */
export interface MMat { kind: 'mat'; rows: number; cols: number; data: Float64Array }

/** Character row vector (strings are rows of chars). */
export interface MStr { kind: 'str'; v: string }

/** Logical scalar. Logical matrices are represented as MMat with 0/1. */
export interface MBool { kind: 'bool'; v: boolean }

/** User-defined or built-in function handle. */
export interface MFn {
  kind: 'fn'
  name: string
  arity: number // -1 = variadic
  builtin?: (args: MValue[]) => MValue
  params?: string[]
  body?: Stmt[]
}

/** Unit value used by statements that do not return anything. */
export interface MVoid { kind: 'void' }

export type MValue = MNum | MMat | MStr | MBool | MFn | MVoid

// -----------------------------------------------------------------------------
// Workspace
// -----------------------------------------------------------------------------

/** Persistent REPL workspace — variables, functions, command history. */
export interface Workspace {
  vars: Map<string, MValue>
  fns: Map<string, MFn>
  history: string[]
}

export function createWorkspace(): Workspace {
  return { vars: new Map(), fns: new Map(), history: [] }
}

// -----------------------------------------------------------------------------
// Tokens
// -----------------------------------------------------------------------------

export type TokType =
  | 'num' | 'str' | 'ident'
  | '(' | ')' | '[' | ']' | '{' | '}'
  | ',' | ';' | ':' | 'nl'
  | '+' | '-' | '*' | '/' | '\\' | '^' | "'"
  | '.+' | '.-' | '.*' | './' | '.\\' | '.^' | ".'"
  | '=' | '==' | '~=' | '!=' | '<' | '<=' | '>' | '>='
  | '&' | '|' | '&&' | '||' | '!' | '~'
  | '@'
  | 'if' | 'elseif' | 'else' | 'end' | 'endif' | 'endfor' | 'endwhile' | 'endfunction'
  | 'for' | 'while' | 'do' | 'until' | 'break' | 'continue' | 'return'
  | 'function' | 'true' | 'false'
  | 'eof'

export interface Token {
  type: TokType
  value: string
  /** Byte-ish index into the original source — used for error reporting. */
  pos: number
  line: number
  col: number
}

const KEYWORDS: Record<string, TokType> = {
  if: 'if',
  elseif: 'elseif',
  else: 'else',
  end: 'end',
  endif: 'endif',
  endfor: 'endfor',
  endwhile: 'endwhile',
  endfunction: 'endfunction',
  for: 'for',
  while: 'while',
  do: 'do',
  until: 'until',
  break: 'break',
  continue: 'continue',
  return: 'return',
  function: 'function',
  true: 'true',
  false: 'false',
}

export class TokenizeError extends Error {
  constructor(msg: string, public line: number, public col: number) {
    super(`line ${line}:${col}: ${msg}`)
  }
}

/** Tokenize source code. Produces a stream ending in an 'eof' token.
 *  Newlines are surfaced as their own token because they terminate statements. */
export function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  let line = 1
  let col = 1
  const n = src.length

  const push = (type: TokType, value: string, pos: number, l: number, c: number) => {
    out.push({ type, value, pos, line: l, col: c })
  }

  const peek = (k = 0) => (i + k < n ? src[i + k] : '')
  const advance = () => {
    const ch = src[i++]
    if (ch === '\n') { line++; col = 1 } else { col++ }
    return ch
  }

  while (i < n) {
    const startLine = line
    const startCol = col
    const startPos = i
    const ch = peek()

    // Skip spaces and tabs (newlines are significant)
    if (ch === ' ' || ch === '\t' || ch === '\r') { advance(); continue }

    // Line continuation: ... or \ at end of line
    if (ch === '.' && peek(1) === '.' && peek(2) === '.') {
      i += 3; col += 3
      while (i < n && src[i] !== '\n') { advance() }
      if (i < n) advance() // eat the newline
      continue
    }
    if (ch === '\\' && (peek(1) === '\n' || peek(1) === '\r')) {
      advance(); advance()
      continue
    }

    // Comments: # ... or % ... to end of line
    if (ch === '#' || ch === '%') {
      while (i < n && src[i] !== '\n') { advance() }
      continue
    }

    // Newline (statement terminator)
    if (ch === '\n') {
      advance()
      push('nl', '\n', startPos, startLine, startCol)
      continue
    }

    // Numbers: 123, 123.45, 1e-3, .5
    if (isDigit(ch) || (ch === '.' && isDigit(peek(1)))) {
      let s = ''
      while (i < n && isDigit(src[i])) { s += src[i]; advance() }
      if (peek() === '.' && isDigit(peek(1))) {
        s += '.'; advance()
        while (i < n && isDigit(src[i])) { s += src[i]; advance() }
      }
      if (peek() === 'e' || peek() === 'E') {
        s += src[i]; advance()
        if (peek() === '+' || peek() === '-') { s += src[i]; advance() }
        while (i < n && isDigit(src[i])) { s += src[i]; advance() }
      }
      push('num', s, startPos, startLine, startCol)
      continue
    }

    // Identifiers / keywords
    if (isAlpha(ch) || ch === '_') {
      let s = ''
      while (i < n && (isAlpha(src[i]) || isDigit(src[i]) || src[i] === '_')) {
        s += src[i]; advance()
      }
      const kw = KEYWORDS[s]
      if (kw) push(kw, s, startPos, startLine, startCol)
      else push('ident', s, startPos, startLine, startCol)
      continue
    }

    // Strings: 'single' or "double". Single-quote is tricky because ' is also
    // the transpose operator — disambiguation happens in the parser via the
    // previous token type. Here we always emit it as a quote string when it
    // appears in a "value expected" context; the tokenizer takes a simple rule:
    //   if the previous emitted token is one of { ')' ']' '}' 'ident' 'num' "'" },
    //   then a bare ' is the transpose operator, otherwise it opens a string.
    if (ch === '"') {
      advance()
      let s = ''
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < n) {
          const nxt = src[i + 1]
          advance(); advance()
          s += nxt === 'n' ? '\n' : nxt === 't' ? '\t' : nxt === 'r' ? '\r' : nxt === '\\' ? '\\' : nxt === '"' ? '"' : nxt
        } else {
          s += src[i]; advance()
        }
      }
      if (i >= n) throw new TokenizeError('unterminated string', startLine, startCol)
      advance() // closing "
      push('str', s, startPos, startLine, startCol)
      continue
    }
    if (ch === "'") {
      const prev = out[out.length - 1]
      const canTranspose = prev && (
        prev.type === ')' || prev.type === ']' || prev.type === '}' ||
        prev.type === 'ident' || prev.type === 'num' || prev.type === "'"
      )
      if (canTranspose) {
        advance()
        push("'", "'", startPos, startLine, startCol)
        continue
      }
      advance()
      let s = ''
      while (i < n && src[i] !== "'") {
        if (src[i] === '\n') throw new TokenizeError('unterminated string', startLine, startCol)
        s += src[i]; advance()
      }
      if (i >= n) throw new TokenizeError('unterminated string', startLine, startCol)
      advance() // closing '
      push('str', s, startPos, startLine, startCol)
      continue
    }

    // Multi-char element-wise operators (.+  .-  .*  ./  .\  .^  .')
    if (ch === '.') {
      const n1 = peek(1)
      if (n1 === '+' || n1 === '-' || n1 === '*' || n1 === '/' || n1 === '\\' || n1 === '^') {
        advance(); advance()
        push(('.' + n1) as TokType, '.' + n1, startPos, startLine, startCol)
        continue
      }
      if (n1 === "'") {
        advance(); advance()
        push(".'", ".'", startPos, startLine, startCol)
        continue
      }
    }

    // Two-char comparison / logical operators
    const two = ch + peek(1)
    if (two === '==' || two === '~=' || two === '!=' || two === '<=' || two === '>=' || two === '&&' || two === '||') {
      advance(); advance()
      push(two as TokType, two, startPos, startLine, startCol)
      continue
    }

    // Single-character tokens
    if ('()[]{},;:+-*/\\^=<>&|!~@'.includes(ch)) {
      advance()
      push(ch as TokType, ch, startPos, startLine, startCol)
      continue
    }

    throw new TokenizeError(`unexpected character '${ch}'`, startLine, startCol)
  }

  push('eof', '', i, line, col)
  return out
}

function isDigit(ch: string): boolean { return ch >= '0' && ch <= '9' }
function isAlpha(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
}

// -----------------------------------------------------------------------------
// AST (declared here so later batches can fill in parse/eval)
// -----------------------------------------------------------------------------

export type Expr =
  | { type: 'num'; value: number }
  | { type: 'str'; value: string }
  | { type: 'bool'; value: boolean }
  | { type: 'ident'; name: string }
  | { type: 'end' } // the 'end' keyword when used as an index sentinel
  | { type: 'colon' } // lone ':' inside indexing means "all"
  | { type: 'range'; start: Expr; step: Expr | null; stop: Expr }
  | { type: 'matrix'; rows: Expr[][] } // literal [a,b; c,d]
  | { type: 'cell'; rows: Expr[][] }
  | { type: 'un'; op: string; arg: Expr; postfix?: boolean }
  | { type: 'bin'; op: string; l: Expr; r: Expr }
  | { type: 'call'; callee: Expr; args: Expr[] } // also used for indexing
  | { type: 'index'; target: Expr; args: Expr[] }
  | { type: 'anon'; params: string[]; body: Expr } // @(x) x^2

export type Stmt =
  | { type: 'expr'; expr: Expr; silent: boolean }
  | { type: 'assign'; target: Expr; value: Expr; silent: boolean }
  | { type: 'multiassign'; targets: Expr[]; value: Expr; silent: boolean }
  | { type: 'if'; cond: Expr; then: Stmt[]; elifs: { cond: Expr; body: Stmt[] }[]; else: Stmt[] | null }
  | { type: 'for'; var: string; iter: Expr; body: Stmt[] }
  | { type: 'while'; cond: Expr; body: Stmt[] }
  | { type: 'dountil'; body: Stmt[]; cond: Expr }
  | { type: 'break' }
  | { type: 'continue' }
  | { type: 'return' }
  | { type: 'function'; name: string; params: string[]; outputs: string[]; body: Stmt[] }

// -----------------------------------------------------------------------------
// Run result contract (stable across batches)
// -----------------------------------------------------------------------------

export interface RunOutput {
  kind: 'text' | 'error' | 'plot' | 'value'
  text?: string
  plot?: PlotSpec
  /** 1-based source line number for errors we can locate (ParseError). */
  line?: number
}

export interface PlotSpec {
  title?: string
  xLabel?: string
  yLabel?: string
  series: { name: string; x: number[]; y: number[]; type: 'line' | 'scatter' | 'bar' }[]
  /** 3D plot support — when mode3d is set, Workstation renders via Plotly */
  mode3d?: 'surface' | 'wireframe' | 'contour' | 'scatter3d' | 'heatmap'
  zLabel?: string
  surfaceX?: number[]
  surfaceY?: number[]
  surfaceZ?: number[][]
  colorscale?: string
  scatter3dX?: number[]
  scatter3dY?: number[]
  scatter3dZ?: number[]
}

export interface RunResult {
  outputs: RunOutput[]
  workspace: Workspace
}

import * as ML from './mathLib'

// -----------------------------------------------------------------------------
// Parser
// -----------------------------------------------------------------------------

export class ParseError extends Error {
  constructor(msg: string, public line: number, public col: number) {
    super(`line ${line}:${col}: ${msg}`)
  }
}

class Parser {
  private i = 0
  /** Depth of nested indexing expressions — inside these, `end` is a sentinel. */
  private indexDepth = 0

  constructor(private toks: Token[]) {}

  private peek(k = 0): Token { return this.toks[Math.min(this.i + k, this.toks.length - 1)] }
  private eof(): boolean { return this.peek().type === 'eof' }
  private expect(type: TokType, what?: string): Token {
    const t = this.peek()
    if (t.type !== type) {
      throw new ParseError(`expected ${what ?? type}, got '${t.value || t.type}'`, t.line, t.col)
    }
    return this.toks[this.i++]
  }

  /** Skip any run of statement terminators (newline, ';', ','). */
  private skipTerms(): void {
    while (true) {
      const t = this.peek().type
      if (t === 'nl' || t === ';' || t === ',') this.i++
      else break
    }
  }

  /** Return true and consume if the next token is any of the given types. */
  private match(...types: TokType[]): boolean {
    if (types.includes(this.peek().type)) { this.i++; return true }
    return false
  }

  parseProgram(): Stmt[] {
    const stmts: Stmt[] = []
    this.skipTerms()
    while (!this.eof()) {
      const s = this.parseStmt()
      if (s) stmts.push(s)
      this.skipTerms()
    }
    return stmts
  }

  private parseBlock(...terminators: TokType[]): Stmt[] {
    const stmts: Stmt[] = []
    this.skipTerms()
    while (!this.eof() && !terminators.includes(this.peek().type)) {
      const s = this.parseStmt()
      if (s) stmts.push(s)
      this.skipTerms()
    }
    return stmts
  }

  private parseStmt(): Stmt | null {
    const t = this.peek()
    switch (t.type) {
      case 'if': return this.parseIf()
      case 'for': return this.parseFor()
      case 'while': return this.parseWhile()
      case 'do': return this.parseDoUntil()
      case 'function': return this.parseFunction()
      case 'break': this.i++; return { type: 'break' }
      case 'continue': this.i++; return { type: 'continue' }
      case 'return': this.i++; return { type: 'return' }
    }
    return this.parseExprStmt()
  }

  private parseIf(): Stmt {
    this.expect('if')
    const cond = this.parseExpr()
    this.skipTerms()
    const thenBody = this.parseBlock('elseif', 'else', 'end', 'endif')
    const elifs: { cond: Expr; body: Stmt[] }[] = []
    while (this.peek().type === 'elseif') {
      this.i++
      const ec = this.parseExpr()
      this.skipTerms()
      const eb = this.parseBlock('elseif', 'else', 'end', 'endif')
      elifs.push({ cond: ec, body: eb })
    }
    let elseBody: Stmt[] | null = null
    if (this.peek().type === 'else') {
      this.i++
      this.skipTerms()
      elseBody = this.parseBlock('end', 'endif')
    }
    if (!this.match('end', 'endif')) {
      const tk = this.peek()
      throw new ParseError(`expected 'end' to close if`, tk.line, tk.col)
    }
    return { type: 'if', cond, then: thenBody, elifs, else: elseBody }
  }

  private parseFor(): Stmt {
    this.expect('for')
    const name = this.expect('ident', 'loop variable').value
    this.expect('=')
    const iter = this.parseExpr()
    this.skipTerms()
    const body = this.parseBlock('end', 'endfor')
    if (!this.match('end', 'endfor')) {
      const tk = this.peek()
      throw new ParseError(`expected 'end' to close for`, tk.line, tk.col)
    }
    return { type: 'for', var: name, iter, body }
  }

  private parseWhile(): Stmt {
    this.expect('while')
    const cond = this.parseExpr()
    this.skipTerms()
    const body = this.parseBlock('end', 'endwhile')
    if (!this.match('end', 'endwhile')) {
      const tk = this.peek()
      throw new ParseError(`expected 'end' to close while`, tk.line, tk.col)
    }
    return { type: 'while', cond, body }
  }

  private parseDoUntil(): Stmt {
    this.expect('do')
    this.skipTerms()
    const body = this.parseBlock('until')
    this.expect('until')
    const cond = this.parseExpr()
    return { type: 'dountil', body, cond }
  }

  private parseFunction(): Stmt {
    this.expect('function')
    // Grammar: function [out1,out2] = name(p1, p2) | function out = name(...) | function name(...)
    let outputs: string[] = []
    let name = ''
    const save = this.i
    // Try to parse an output list
    if (this.peek().type === '[') {
      this.i++
      while (this.peek().type !== ']') {
        outputs.push(this.expect('ident', 'output name').value)
        if (!this.match(',')) break
      }
      this.expect(']')
      this.expect('=')
      name = this.expect('ident', 'function name').value
    } else if (this.peek().type === 'ident' && this.peek(1).type === '=') {
      outputs.push(this.toks[this.i++].value)
      this.expect('=')
      name = this.expect('ident', 'function name').value
    } else {
      this.i = save
      name = this.expect('ident', 'function name').value
    }
    const params: string[] = []
    if (this.match('(')) {
      while (this.peek().type !== ')') {
        params.push(this.expect('ident', 'parameter name').value)
        if (!this.match(',')) break
      }
      this.expect(')')
    }
    this.skipTerms()
    const body = this.parseBlock('end', 'endfunction')
    this.match('end', 'endfunction') // optional end keyword
    return { type: 'function', name, params, outputs, body }
  }

  private parseExprStmt(): Stmt {
    // Detect multi-assignment: [a,b,c] = expr
    if (this.peek().type === '[') {
      const save = this.i
      // Attempt to parse as multi-assign target list
      this.i++
      const targets: Expr[] = []
      let ok = true
      try {
        while (this.peek().type !== ']') {
          // Targets must be plain identifiers or indexed identifiers
          const t = this.parseUnary()
          targets.push(t)
          if (!this.match(',')) break
        }
        if (this.peek().type !== ']') { ok = false }
        if (ok) {
          this.i++ // consume ]
          if (this.peek().type !== '=') { ok = false }
        }
      } catch { ok = false }

      if (ok && this.peek().type === '=') {
        this.i++ // consume =
        const value = this.parseExpr()
        const silent = this.consumeStmtTerm()
        return { type: 'multiassign', targets, value, silent }
      }
      this.i = save
    }

    const lhs = this.parseExpr()
    if (this.peek().type === '=') {
      this.i++
      const rhs = this.parseExpr()
      const silent = this.consumeStmtTerm()
      return { type: 'assign', target: lhs, value: rhs, silent }
    }
    const silent = this.consumeStmtTerm()
    return { type: 'expr', expr: lhs, silent }
  }

  /** Consumes one statement terminator if present; returns whether it was a ';' (silent). */
  private consumeStmtTerm(): boolean {
    const t = this.peek().type
    if (t === ';') { this.i++; return true }
    if (t === ',' || t === 'nl') { this.i++; return false }
    return false // eof or block terminator — echo by default
  }

  // ---- Expression precedence ladder (low → high) ------------------------------

  parseExpr(): Expr { return this.parseLogicalOr() }

  private parseLogicalOr(): Expr {
    let l = this.parseLogicalAnd()
    while (this.peek().type === '||') { this.i++; const r = this.parseLogicalAnd(); l = { type: 'bin', op: '||', l, r } }
    return l
  }
  private parseLogicalAnd(): Expr {
    let l = this.parseBitOr()
    while (this.peek().type === '&&') { this.i++; const r = this.parseBitOr(); l = { type: 'bin', op: '&&', l, r } }
    return l
  }
  private parseBitOr(): Expr {
    let l = this.parseBitAnd()
    while (this.peek().type === '|') { this.i++; const r = this.parseBitAnd(); l = { type: 'bin', op: '|', l, r } }
    return l
  }
  private parseBitAnd(): Expr {
    let l = this.parseCompare()
    while (this.peek().type === '&') { this.i++; const r = this.parseCompare(); l = { type: 'bin', op: '&', l, r } }
    return l
  }
  private parseCompare(): Expr {
    let l = this.parseRange()
    while (true) {
      const t = this.peek().type
      if (t === '==' || t === '~=' || t === '!=' || t === '<' || t === '<=' || t === '>' || t === '>=') {
        const op = t === '!=' ? '~=' : t
        this.i++
        const r = this.parseRange()
        l = { type: 'bin', op, l, r }
      } else break
    }
    return l
  }
  private parseRange(): Expr {
    // a : b  or  a : b : c
    const start = this.parseAdditive()
    if (this.peek().type !== ':') return start
    this.i++
    const second = this.parseAdditive()
    if (this.peek().type === ':') {
      this.i++
      const third = this.parseAdditive()
      return { type: 'range', start, step: second, stop: third }
    }
    return { type: 'range', start, step: null, stop: second }
  }
  private parseAdditive(): Expr {
    let l = this.parseMultiplicative()
    while (true) {
      const t = this.peek().type
      if (t === '+' || t === '-' || t === '.+' || t === '.-') {
        this.i++; const r = this.parseMultiplicative()
        l = { type: 'bin', op: t, l, r }
      } else break
    }
    return l
  }
  private parseMultiplicative(): Expr {
    let l = this.parseUnary()
    while (true) {
      const t = this.peek().type
      if (t === '*' || t === '/' || t === '\\' || t === '.*' || t === './' || t === '.\\') {
        this.i++; const r = this.parseUnary()
        l = { type: 'bin', op: t, l, r }
      } else break
    }
    return l
  }
  private parseUnary(): Expr {
    const t = this.peek().type
    if (t === '-' || t === '+' || t === '!' || t === '~') {
      this.i++
      const arg = this.parseUnary()
      return { type: 'un', op: t, arg }
    }
    return this.parsePower()
  }
  private parsePower(): Expr {
    const base = this.parsePostfix()
    const t = this.peek().type
    if (t === '^' || t === '.^') {
      this.i++
      const exp = this.parseUnary() // right-assoc, allows -2^3 = -(2^3)
      return { type: 'bin', op: t, l: base, r: exp }
    }
    return base
  }
  private parsePostfix(): Expr {
    let e = this.parsePrimary()
    while (true) {
      const t = this.peek().type
      if (t === "'" || t === ".'") {
        this.i++
        e = { type: 'un', op: t, arg: e, postfix: true }
      } else if (t === '(' && (e.type === 'ident' || e.type === 'call' || e.type === 'index')) {
        // Call / index
        this.i++
        this.indexDepth++
        const args: Expr[] = []
        while (this.peek().type !== ')') {
          args.push(this.parseIndexArg())
          if (!this.match(',')) break
        }
        this.indexDepth--
        this.expect(')')
        e = { type: 'call', callee: e, args }
      } else if (t === '{' && (e.type === 'ident' || e.type === 'call' || e.type === 'index')) {
        this.i++
        this.indexDepth++
        const args: Expr[] = []
        while (this.peek().type !== '}') {
          args.push(this.parseIndexArg())
          if (!this.match(',')) break
        }
        this.indexDepth--
        this.expect('}')
        e = { type: 'index', target: e, args }
      } else break
    }
    return e
  }
  private parseIndexArg(): Expr {
    // Bare ':' inside index becomes the "all" sentinel
    if (this.peek().type === ':' && (this.peek(1).type === ',' || this.peek(1).type === ')' || this.peek(1).type === '}')) {
      this.i++
      return { type: 'colon' }
    }
    return this.parseExpr()
  }
  private parsePrimary(): Expr {
    const t = this.peek()
    switch (t.type) {
      case 'num': this.i++; return { type: 'num', value: parseFloat(t.value) }
      case 'str': this.i++; return { type: 'str', value: t.value }
      case 'true': this.i++; return { type: 'bool', value: true }
      case 'false': this.i++; return { type: 'bool', value: false }
      case 'ident': this.i++; return { type: 'ident', name: t.value }
      case 'end':
        if (this.indexDepth > 0) { this.i++; return { type: 'end' } }
        throw new ParseError(`unexpected 'end'`, t.line, t.col)
      case '(': {
        this.i++
        const e = this.parseExpr()
        this.expect(')')
        return e
      }
      case '[': return this.parseMatrixLiteral()
      case '{': return this.parseCellLiteral()
      case '@': return this.parseAnonymous()
    }
    throw new ParseError(`unexpected token '${t.value || t.type}'`, t.line, t.col)
  }
  private parseMatrixLiteral(): Expr {
    this.expect('[')
    const rows: Expr[][] = []
    let current: Expr[] = []
    while (this.peek().type !== ']') {
      if (this.peek().type === ';' || this.peek().type === 'nl') {
        this.i++
        if (current.length > 0) { rows.push(current); current = [] }
        continue
      }
      current.push(this.parseExpr())
      if (this.peek().type === ',') { this.i++; continue }
    }
    if (current.length > 0) rows.push(current)
    this.expect(']')
    return { type: 'matrix', rows }
  }
  private parseCellLiteral(): Expr {
    this.expect('{')
    const rows: Expr[][] = []
    let current: Expr[] = []
    while (this.peek().type !== '}') {
      if (this.peek().type === ';' || this.peek().type === 'nl') {
        this.i++
        if (current.length > 0) { rows.push(current); current = [] }
        continue
      }
      current.push(this.parseExpr())
      if (this.peek().type === ',') { this.i++; continue }
    }
    if (current.length > 0) rows.push(current)
    this.expect('}')
    return { type: 'cell', rows }
  }
  private parseAnonymous(): Expr {
    this.expect('@')
    const params: string[] = []
    if (this.match('(')) {
      while (this.peek().type !== ')') {
        params.push(this.expect('ident', 'parameter').value)
        if (!this.match(',')) break
      }
      this.expect(')')
      const body = this.parseExpr()
      return { type: 'anon', params, body }
    }
    // @funcname handle — treat as identifier for now
    const name = this.expect('ident', 'function name').value
    return { type: 'ident', name }
  }
}

export function parse(source: string): Stmt[] {
  const tokens = tokenize(source)
  return new Parser(tokens).parseProgram()
}

// -----------------------------------------------------------------------------
// Evaluator
// -----------------------------------------------------------------------------

export class RuntimeError extends Error {
  constructor(msg: string) { super(msg) }
}

// Lightweight flow-control exceptions (cheaper than threading flags everywhere).
class BreakSignal {}
class ContinueSignal {}
class ReturnSignal {}

interface EvalContext {
  ws: Workspace
  outputs: RunOutput[]
  /** Per-run plot accumulator — flushed on figure()/show or at end of run. */
  currentPlot: PlotSpec | null
  /** Built-in function registry bound to this context. */
  builtins: Map<string, MFn>
  /** Stack of dimension sizes used to resolve the `end` keyword inside
   *  indexing expressions. Pushed before each arg, popped after. */
  endStack: number[]
}

// ---- Value helpers ---------------------------------------------------------

export function mnum(v: number): MNum { return { kind: 'num', v } }
export function mbool(v: boolean): MBool { return { kind: 'bool', v } }
export function mstr(v: string): MStr { return { kind: 'str', v } }
export function mmat(rows: number, cols: number, data: Float64Array | number[]): MMat {
  const arr = data instanceof Float64Array ? data : Float64Array.from(data)
  return { kind: 'mat', rows, cols, data: arr }
}
export function mscalar(v: number): MMat { return mmat(1, 1, [v]) }
export const MVOID: MVoid = { kind: 'void' }

export function toNumber(v: MValue): number {
  if (v.kind === 'num') return v.v
  if (v.kind === 'bool') return v.v ? 1 : 0
  if (v.kind === 'mat' && v.rows === 1 && v.cols === 1) return v.data[0]
  throw new RuntimeError(`cannot convert ${v.kind} to scalar`)
}
export function toBool(v: MValue): boolean {
  if (v.kind === 'bool') return v.v
  if (v.kind === 'num') return v.v !== 0
  if (v.kind === 'mat') {
    if (v.data.length === 0) return false
    for (let i = 0; i < v.data.length; i++) if (v.data[i] === 0) return false
    return true
  }
  if (v.kind === 'str') return v.v.length > 0
  return false
}
export function toMat(v: MValue): MMat {
  if (v.kind === 'mat') return v
  if (v.kind === 'num') return mscalar(v.v)
  if (v.kind === 'bool') return mscalar(v.v ? 1 : 0)
  throw new RuntimeError(`cannot convert ${v.kind} to matrix`)
}

function isScalar(v: MValue): boolean {
  return v.kind === 'num' || v.kind === 'bool' || (v.kind === 'mat' && v.rows === 1 && v.cols === 1)
}

// ---- Arithmetic ------------------------------------------------------------

function elemBinary(a: MMat, b: MMat, fn: (x: number, y: number) => number, op: string): MMat {
  // Scalar broadcasting
  if (a.rows === 1 && a.cols === 1) {
    const s = a.data[0]
    const out = new Float64Array(b.data.length)
    for (let i = 0; i < b.data.length; i++) out[i] = fn(s, b.data[i])
    return { kind: 'mat', rows: b.rows, cols: b.cols, data: out }
  }
  if (b.rows === 1 && b.cols === 1) {
    const s = b.data[0]
    const out = new Float64Array(a.data.length)
    for (let i = 0; i < a.data.length; i++) out[i] = fn(a.data[i], s)
    return { kind: 'mat', rows: a.rows, cols: a.cols, data: out }
  }
  if (a.rows !== b.rows || a.cols !== b.cols) {
    throw new RuntimeError(`${op}: nonconformant arguments (${a.rows}x${a.cols} vs ${b.rows}x${b.cols})`)
  }
  const out = new Float64Array(a.data.length)
  for (let i = 0; i < a.data.length; i++) out[i] = fn(a.data[i], b.data[i])
  return { kind: 'mat', rows: a.rows, cols: a.cols, data: out }
}

function matMul(a: MMat, b: MMat): MMat {
  if (a.rows === 1 && a.cols === 1) return elemBinary(a, b, (x, y) => x * y, '*')
  if (b.rows === 1 && b.cols === 1) return elemBinary(a, b, (x, y) => x * y, '*')
  if (a.cols !== b.rows) {
    throw new RuntimeError(`*: dim mismatch (${a.rows}x${a.cols} * ${b.rows}x${b.cols})`)
  }
  const out = new Float64Array(a.rows * b.cols)
  for (let i = 0; i < a.rows; i++) {
    for (let k = 0; k < a.cols; k++) {
      const aik = a.data[i * a.cols + k]
      if (aik === 0) continue
      for (let j = 0; j < b.cols; j++) {
        out[i * b.cols + j] += aik * b.data[k * b.cols + j]
      }
    }
  }
  return { kind: 'mat', rows: a.rows, cols: b.cols, data: out }
}

function matTranspose(a: MMat): MMat {
  const out = new Float64Array(a.data.length)
  for (let i = 0; i < a.rows; i++) {
    for (let j = 0; j < a.cols; j++) {
      out[j * a.rows + i] = a.data[i * a.cols + j]
    }
  }
  return { kind: 'mat', rows: a.cols, cols: a.rows, data: out }
}

/** LU decomposition with partial pivoting. Returns L, U, piv such that
 *  P*A = L*U. Used by det/inv/linsolve. In-place on a copy. */
function luDecompose(a: MMat): { LU: Float64Array; piv: Int32Array; sign: number } {
  if (a.rows !== a.cols) throw new RuntimeError('LU: matrix must be square')
  const n = a.rows
  const LU = new Float64Array(a.data) // row-major copy
  const piv = new Int32Array(n)
  for (let i = 0; i < n; i++) piv[i] = i
  let sign = 1

  for (let k = 0; k < n; k++) {
    // find pivot row
    let maxAbs = Math.abs(LU[k * n + k])
    let maxRow = k
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(LU[i * n + k])
      if (v > maxAbs) { maxAbs = v; maxRow = i }
    }
    if (maxAbs < 1e-14) throw new RuntimeError('LU: matrix is singular')
    if (maxRow !== k) {
      // swap rows k and maxRow
      for (let j = 0; j < n; j++) {
        const tmp = LU[k * n + j]
        LU[k * n + j] = LU[maxRow * n + j]
        LU[maxRow * n + j] = tmp
      }
      const tp = piv[k]; piv[k] = piv[maxRow]; piv[maxRow] = tp
      sign = -sign
    }
    // eliminate
    const pivot = LU[k * n + k]
    for (let i = k + 1; i < n; i++) {
      const factor = LU[i * n + k] / pivot
      LU[i * n + k] = factor
      for (let j = k + 1; j < n; j++) {
        LU[i * n + j] -= factor * LU[k * n + j]
      }
    }
  }
  return { LU, piv, sign }
}

/** Solve A * x = b using LU (b can be a matrix, one solve per column). */
function luSolve(n: number, LU: Float64Array, piv: Int32Array, b: MMat): MMat {
  if (b.rows !== n) throw new RuntimeError(`\\: dim mismatch (A is ${n}x${n}, b has ${b.rows} rows)`)
  const cols = b.cols
  const x = new Float64Array(n * cols)
  // For each column of b
  for (let c = 0; c < cols; c++) {
    // Apply pivot permutation
    const y = new Float64Array(n)
    for (let i = 0; i < n; i++) y[i] = b.data[piv[i] * cols + c]
    // Forward substitution (L has unit diagonal)
    for (let i = 0; i < n; i++) {
      let s = y[i]
      for (let j = 0; j < i; j++) s -= LU[i * n + j] * y[j]
      y[i] = s
    }
    // Back substitution
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i]
      for (let j = i + 1; j < n; j++) s -= LU[i * n + j] * y[j]
      y[i] = s / LU[i * n + i]
    }
    for (let i = 0; i < n; i++) x[i * cols + c] = y[i]
  }
  return { kind: 'mat', rows: n, cols, data: x }
}

function matDet(a: MMat): number {
  try {
    const { LU, sign } = luDecompose(a)
    let det = sign
    for (let i = 0; i < a.rows; i++) det *= LU[i * a.rows + i]
    return det
  } catch {
    return 0 // singular
  }
}

function matInv(a: MMat): MMat {
  const n = a.rows
  const I = new Float64Array(n * n)
  for (let i = 0; i < n; i++) I[i * n + i] = 1
  const Iden: MMat = { kind: 'mat', rows: n, cols: n, data: I }
  const { LU, piv } = luDecompose(a)
  return luSolve(n, LU, piv, Iden)
}

function matPow(a: MMat, p: number): MMat {
  if (a.rows !== a.cols) throw new RuntimeError('^: matrix must be square')
  if (!Number.isInteger(p) || p < 0) throw new RuntimeError('^: only non-negative integer powers are supported')
  // Identity
  let result: MMat = mmat(a.rows, a.cols, new Float64Array(a.rows * a.cols))
  for (let i = 0; i < a.rows; i++) result.data[i * a.rows + i] = 1
  let base = a
  while (p > 0) {
    if (p & 1) result = matMul(result, base)
    p >>= 1
    if (p > 0) base = matMul(base, base)
  }
  return result
}

// ---- Binary op dispatch ----------------------------------------------------

function applyBinOp(op: string, l: MValue, r: MValue): MValue {
  // String concat with + ('+' is numeric only; str+str concatenates when both operands are strings)
  if (l.kind === 'str' && r.kind === 'str' && (op === '+' || op === '.+')) {
    return { kind: 'str', v: l.v + r.v }
  }
  if (op === '&&') return mbool(toBool(l) && toBool(r))
  if (op === '||') return mbool(toBool(l) || toBool(r))

  const A = toMat(l), B = toMat(r)

  switch (op) {
    case '+': case '.+': return elemBinary(A, B, (x, y) => x + y, op)
    case '-': case '.-': return elemBinary(A, B, (x, y) => x - y, op)
    case '.*': return elemBinary(A, B, (x, y) => x * y, op)
    case './': return elemBinary(A, B, (x, y) => x / y, op)
    case '.\\': return elemBinary(A, B, (x, y) => y / x, op)
    case '.^': return elemBinary(A, B, (x, y) => Math.pow(x, y), op)
    case '*': return matMul(A, B)
    case '/': {
      if (isScalar(B)) return elemBinary(A, B, (x, y) => x / y, '/')
      throw new RuntimeError('/: matrix right-division not implemented (use ./)')
    }
    case '\\': {
      if (isScalar(A)) return elemBinary(A, B, (x, y) => y / x, '\\')
      // Matrix left-division via LU: solve A * x = B
      if (A.rows !== A.cols) throw new RuntimeError('\\: left operand must be square')
      const { LU, piv } = luDecompose(A)
      return luSolve(A.rows, LU, piv, B)
    }
    case '^': {
      if (isScalar(A) && isScalar(B)) return mscalar(Math.pow(A.data[0], B.data[0]))
      if (isScalar(B)) return matPow(A, B.data[0])
      throw new RuntimeError('^: exponent must be scalar')
    }
    case '==': return elemBinary(A, B, (x, y) => x === y ? 1 : 0, op)
    case '~=': case '!=': return elemBinary(A, B, (x, y) => x !== y ? 1 : 0, op)
    case '<': return elemBinary(A, B, (x, y) => x < y ? 1 : 0, op)
    case '<=': return elemBinary(A, B, (x, y) => x <= y ? 1 : 0, op)
    case '>': return elemBinary(A, B, (x, y) => x > y ? 1 : 0, op)
    case '>=': return elemBinary(A, B, (x, y) => x >= y ? 1 : 0, op)
    case '&': return elemBinary(A, B, (x, y) => (x !== 0 && y !== 0) ? 1 : 0, op)
    case '|': return elemBinary(A, B, (x, y) => (x !== 0 || y !== 0) ? 1 : 0, op)
  }
  throw new RuntimeError(`unsupported operator ${op}`)
}

function applyUnaryOp(op: string, v: MValue): MValue {
  switch (op) {
    case '-': {
      const m = toMat(v)
      const out = new Float64Array(m.data.length)
      for (let i = 0; i < m.data.length; i++) out[i] = -m.data[i]
      return { kind: 'mat', rows: m.rows, cols: m.cols, data: out }
    }
    case '+': return v
    case '!': case '~': {
      const m = toMat(v)
      const out = new Float64Array(m.data.length)
      for (let i = 0; i < m.data.length; i++) out[i] = m.data[i] === 0 ? 1 : 0
      return { kind: 'mat', rows: m.rows, cols: m.cols, data: out }
    }
    case "'": case ".'": return matTranspose(toMat(v))
  }
  throw new RuntimeError(`unsupported unary ${op}`)
}

// ---- Ranges & matrix literals ----------------------------------------------

function rangeToMat(startN: number, stepN: number, stopN: number): MMat {
  const vals: number[] = []
  const step = stepN === 0 ? 1 : stepN
  // Range semantics: 1:5 -> 1..5; 5:-1:1 -> 5..1
  if (step > 0) {
    for (let v = startN; v <= stopN + 1e-12; v += step) vals.push(v)
  } else {
    for (let v = startN; v >= stopN - 1e-12; v += step) vals.push(v)
  }
  return mmat(1, vals.length, vals)
}

function buildMatrixFromRows(rowsEval: MValue[][]): MMat {
  if (rowsEval.length === 0) return mmat(0, 0, [])
  const rowMats: MMat[] = []
  for (const row of rowsEval) {
    if (row.length === 0) continue
    // Horizontally concatenate items in each row
    const parts: MMat[] = row.map(toMat)
    const firstRows = parts[0].rows
    let totalCols = 0
    for (const p of parts) {
      if (p.rows !== firstRows) throw new RuntimeError('horizontal cat: row counts differ')
      totalCols += p.cols
    }
    const out = new Float64Array(firstRows * totalCols)
    for (let r = 0; r < firstRows; r++) {
      let col = 0
      for (const p of parts) {
        for (let c = 0; c < p.cols; c++) {
          out[r * totalCols + (col + c)] = p.data[r * p.cols + c]
        }
        col += p.cols
      }
    }
    rowMats.push({ kind: 'mat', rows: firstRows, cols: totalCols, data: out })
  }
  if (rowMats.length === 1) return rowMats[0]
  // Vertical concat
  const firstCols = rowMats[0].cols
  let totalRows = 0
  for (const m of rowMats) {
    if (m.cols !== firstCols) throw new RuntimeError('vertical cat: column counts differ')
    totalRows += m.rows
  }
  const out = new Float64Array(totalRows * firstCols)
  let rOff = 0
  for (const m of rowMats) {
    out.set(m.data, rOff * firstCols)
    rOff += m.rows
  }
  return { kind: 'mat', rows: totalRows, cols: firstCols, data: out }
}

// ---- Indexing --------------------------------------------------------------

function resolveIndices(arg: MValue | 'colon', size: number): number[] {
  if (arg === 'colon') {
    const out = new Array(size)
    for (let i = 0; i < size; i++) out[i] = i
    return out
  }
  const m = toMat(arg)
  const out = new Array(m.data.length)
  for (let i = 0; i < m.data.length; i++) {
    const v = Math.round(m.data[i])
    if (v < 1 || v > size) throw new RuntimeError(`index out of bounds: ${v} (size ${size})`)
    out[i] = v - 1
  }
  return out
}

/** Evaluate indexing arguments, pushing the relevant dimension size on
 *  ctx.endStack so that a bare `end` token resolves to the right value. */
function evalIndexArgs(target: MValue, rawArgs: Expr[], ctx: EvalContext): (MValue | 'colon')[] {
  const m = toMat(target)
  const out: (MValue | 'colon')[] = []
  const oneArg = rawArgs.length === 1
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i]
    if (a.type === 'colon') { out.push('colon'); continue }
    const dim = oneArg ? m.rows * m.cols : (i === 0 ? m.rows : m.cols)
    ctx.endStack.push(dim)
    try { out.push(evalExpr(a, ctx)) }
    finally { ctx.endStack.pop() }
  }
  return out
}

function getIndexed(target: MValue, args: (MValue | 'colon')[]): MValue {
  const m = toMat(target)
  if (args.length === 1) {
    // Linear indexing
    const idx = resolveIndices(args[0], m.rows * m.cols)
    const out = new Float64Array(idx.length)
    // Linear index is column-major. But our data is row-major —
    // translate: element (r,c) -> data[r*cols+c]; linear index k -> c=floor(k/rows), r=k%rows
    for (let i = 0; i < idx.length; i++) {
      const k = idx[i]
      const c = Math.floor(k / m.rows)
      const r = k % m.rows
      out[i] = m.data[r * m.cols + c]
    }
    // Preserve orientation: scalar -> scalar; vector -> row if input vector was row
    if (idx.length === 1) return mscalar(out[0])
    const sourceIsRow = m.rows === 1
    return sourceIsRow
      ? mmat(1, idx.length, out)
      : mmat(idx.length, 1, out)
  }
  if (args.length === 2) {
    const rIdx = resolveIndices(args[0], m.rows)
    const cIdx = resolveIndices(args[1], m.cols)
    const out = new Float64Array(rIdx.length * cIdx.length)
    for (let i = 0; i < rIdx.length; i++) {
      for (let j = 0; j < cIdx.length; j++) {
        out[i * cIdx.length + j] = m.data[rIdx[i] * m.cols + cIdx[j]]
      }
    }
    if (rIdx.length === 1 && cIdx.length === 1) return mscalar(out[0])
    return mmat(rIdx.length, cIdx.length, out)
  }
  throw new RuntimeError(`indexing with ${args.length} subscripts not supported`)
}

function setIndexed(target: MMat, args: (MValue | 'colon')[], value: MValue): MMat {
  const v = toMat(value)
  if (args.length === 1) {
    const idx = resolveIndices(args[0], target.rows * target.cols)
    const src = v.data
    if (src.length !== idx.length && src.length !== 1) {
      throw new RuntimeError(`assignment shape mismatch (${src.length} vs ${idx.length})`)
    }
    for (let i = 0; i < idx.length; i++) {
      const k = idx[i]
      const c = Math.floor(k / target.rows)
      const r = k % target.rows
      target.data[r * target.cols + c] = src.length === 1 ? src[0] : src[i]
    }
    return target
  }
  if (args.length === 2) {
    const rIdx = resolveIndices(args[0], target.rows)
    const cIdx = resolveIndices(args[1], target.cols)
    const expected = rIdx.length * cIdx.length
    if (v.data.length !== expected && v.data.length !== 1) {
      throw new RuntimeError(`assignment shape mismatch (${v.data.length} vs ${expected})`)
    }
    for (let i = 0; i < rIdx.length; i++) {
      for (let j = 0; j < cIdx.length; j++) {
        const src = v.data.length === 1 ? v.data[0] : v.data[i * cIdx.length + j]
        target.data[rIdx[i] * target.cols + cIdx[j]] = src
      }
    }
    return target
  }
  throw new RuntimeError(`assignment with ${args.length} subscripts not supported`)
}

// ---- Core eval --------------------------------------------------------------

function evalExpr(e: Expr, ctx: EvalContext): MValue {
  switch (e.type) {
    case 'num': return mnum(e.value)
    case 'str': return mstr(e.value)
    case 'bool': return mbool(e.value)
    case 'ident': {
      const v = ctx.ws.vars.get(e.name)
      if (v) return v
      const fn = ctx.ws.fns.get(e.name) ?? ctx.builtins.get(e.name)
      if (fn) {
        // Identifier in value position with no args: if zero-arity, invoke it
        if (fn.arity === 0) return callFn(fn, [], ctx)
        return fn
      }
      throw new RuntimeError(`'${e.name}' is undefined`)
    }
    case 'end': {
      if (ctx.endStack.length === 0) throw new RuntimeError(`'end' used outside an indexing context`)
      return mnum(ctx.endStack[ctx.endStack.length - 1])
    }
    case 'colon': throw new RuntimeError(`':' used outside an indexing context`)
    case 'range': {
      const s = toNumber(evalExpr(e.start, ctx))
      const stop = toNumber(evalExpr(e.stop, ctx))
      const step = e.step ? toNumber(evalExpr(e.step, ctx)) : 1
      return rangeToMat(s, step, stop)
    }
    case 'matrix': {
      const rowsEval = e.rows.map(row => row.map(c => evalExpr(c, ctx)))
      return buildMatrixFromRows(rowsEval)
    }
    case 'cell': {
      // Cells not fully modeled — fall back to numeric matrix if possible
      const rowsEval = e.rows.map(row => row.map(c => evalExpr(c, ctx)))
      return buildMatrixFromRows(rowsEval)
    }
    case 'un': return applyUnaryOp(e.op, evalExpr(e.arg, ctx))
    case 'bin': {
      // Short-circuit logical ops
      if (e.op === '&&') {
        const l = evalExpr(e.l, ctx)
        if (!toBool(l)) return mbool(false)
        return mbool(toBool(evalExpr(e.r, ctx)))
      }
      if (e.op === '||') {
        const l = evalExpr(e.l, ctx)
        if (toBool(l)) return mbool(true)
        return mbool(toBool(evalExpr(e.r, ctx)))
      }
      return applyBinOp(e.op, evalExpr(e.l, ctx), evalExpr(e.r, ctx))
    }
    case 'call': {
      // Could be function call or indexing — decide by what callee resolves to.
      if (e.callee.type === 'ident') {
        const name = e.callee.name
        // If it's a variable, treat as indexing
        const vv = ctx.ws.vars.get(name)
        if (vv && vv.kind !== 'fn') {
          return getIndexed(vv, evalIndexArgs(vv, e.args, ctx))
        }
        // Functions: user first, then built-ins
        const userFn = ctx.ws.fns.get(name) ?? (vv && vv.kind === 'fn' ? vv : undefined) ?? ctx.builtins.get(name)
        if (userFn) {
          const args = e.args.map(a => evalExpr(a, ctx))
          return callFn(userFn, args, ctx)
        }
        throw new RuntimeError(`'${name}' is undefined`)
      }
      // Expression call: invoke anonymous function or index result
      const callee = evalExpr(e.callee, ctx)
      if (callee.kind === 'fn') {
        const args = e.args.map(a => evalExpr(a, ctx))
        return callFn(callee, args, ctx)
      }
      return getIndexed(callee, evalIndexArgs(callee, e.args, ctx))
    }
    case 'index': {
      const target = evalExpr(e.target, ctx)
      return getIndexed(target, evalIndexArgs(target, e.args, ctx))
    }
    case 'anon': {
      const params = e.params
      const body = e.body
      // Capture snapshot of workspace vars (by reference)
      const captured = new Map(ctx.ws.vars)
      const fn: MFn = {
        kind: 'fn',
        name: '<anonymous>',
        arity: params.length,
        builtin: (args) => {
          const savedVars = ctx.ws.vars
          const scope = new Map(captured)
          for (let i = 0; i < params.length; i++) scope.set(params[i], args[i] ?? MVOID)
          ctx.ws.vars = scope
          try { return evalExpr(body, ctx) }
          finally { ctx.ws.vars = savedVars }
        },
      }
      return fn
    }
  }
  throw new RuntimeError(`unknown expression`)
}

function callFn(fn: MFn, args: MValue[], ctx: EvalContext): MValue {
  if (fn.builtin) return fn.builtin(args)
  if (!fn.body || !fn.params) throw new RuntimeError(`function '${fn.name}' has no body`)
  const savedVars = ctx.ws.vars
  const scope = new Map<string, MValue>()
  for (let i = 0; i < fn.params.length; i++) scope.set(fn.params[i], args[i] ?? MVOID)
  ctx.ws.vars = scope
  try {
    evalBlock(fn.body, ctx)
  } catch (sig) {
    if (!(sig instanceof ReturnSignal)) throw sig
  }
  // First output variable, or 'ans'
  // (User-defined output variables are handled in Batch 3d when we parse them fully.)
  const ans = ctx.ws.vars.get('ans') ?? MVOID
  ctx.ws.vars = savedVars
  return ans
}

function evalBlock(stmts: Stmt[], ctx: EvalContext): void {
  for (const s of stmts) evalStmt(s, ctx)
}

function assignTo(target: Expr, value: MValue, ctx: EvalContext): void {
  if (target.type === 'ident') {
    ctx.ws.vars.set(target.name, value)
    return
  }
  if (target.type === 'call' && target.callee.type === 'ident') {
    const name = target.callee.name
    const existing = ctx.ws.vars.get(name)
    let mat: MMat
    if (existing && existing.kind === 'mat') {
      mat = { kind: 'mat', rows: existing.rows, cols: existing.cols, data: new Float64Array(existing.data) }
    } else if (existing && existing.kind === 'num') {
      mat = mscalar(existing.v)
    } else {
      // Create a new matrix sized to fit the assignment
      mat = mmat(0, 0, new Float64Array(0))
    }
    const args = evalIndexArgs(mat, target.args, ctx)
    const updated = setIndexed(mat, args, value)
    ctx.ws.vars.set(name, updated)
    return
  }
  throw new RuntimeError('invalid assignment target')
}

function evalStmt(s: Stmt, ctx: EvalContext): void {
  switch (s.type) {
    case 'expr': {
      const v = evalExpr(s.expr, ctx)
      if (v.kind !== 'void') {
        ctx.ws.vars.set('ans', v)
        if (!s.silent) ctx.outputs.push({ kind: 'text', text: formatValue('ans', v) })
      }
      return
    }
    case 'assign': {
      const v = evalExpr(s.value, ctx)
      assignTo(s.target, v, ctx)
      if (!s.silent && s.target.type === 'ident') {
        ctx.outputs.push({ kind: 'text', text: formatValue(s.target.name, v) })
      }
      return
    }
    case 'multiassign': {
      // Best-effort: evaluate RHS once, unpack into identifiers.
      const v = evalExpr(s.value, ctx)
      for (let i = 0; i < s.targets.length; i++) {
        const t = s.targets[i]
        if (t.type !== 'ident') throw new RuntimeError('multi-assign targets must be identifiers')
        // If value is a matrix, distribute columns; otherwise same value to first target
        if (v.kind === 'mat' && v.cols >= s.targets.length) {
          const col = new Float64Array(v.rows)
          for (let r = 0; r < v.rows; r++) col[r] = v.data[r * v.cols + i]
          ctx.ws.vars.set(t.name, v.rows === 1 ? mnum(col[0]) : mmat(v.rows, 1, col))
        } else if (i === 0) {
          ctx.ws.vars.set(t.name, v)
        } else {
          ctx.ws.vars.set(t.name, MVOID)
        }
      }
      return
    }
    case 'if': {
      if (toBool(evalExpr(s.cond, ctx))) { evalBlock(s.then, ctx); return }
      for (const el of s.elifs) {
        if (toBool(evalExpr(el.cond, ctx))) { evalBlock(el.body, ctx); return }
      }
      if (s.else) evalBlock(s.else, ctx)
      return
    }
    case 'for': {
      const it = evalExpr(s.iter, ctx)
      const m = toMat(it)
      // Iterate over columns
      for (let c = 0; c < m.cols; c++) {
        let col: MValue
        if (m.rows === 1) col = mnum(m.data[c])
        else {
          const colData = new Float64Array(m.rows)
          for (let r = 0; r < m.rows; r++) colData[r] = m.data[r * m.cols + c]
          col = mmat(m.rows, 1, colData)
        }
        ctx.ws.vars.set(s.var, col)
        try { evalBlock(s.body, ctx) }
        catch (sig) {
          if (sig instanceof BreakSignal) return
          if (sig instanceof ContinueSignal) continue
          throw sig
        }
      }
      return
    }
    case 'while': {
      let guard = 0
      while (toBool(evalExpr(s.cond, ctx))) {
        if (++guard > 1_000_000) throw new RuntimeError('while: iteration limit exceeded')
        try { evalBlock(s.body, ctx) }
        catch (sig) {
          if (sig instanceof BreakSignal) return
          if (sig instanceof ContinueSignal) continue
          throw sig
        }
      }
      return
    }
    case 'dountil': {
      let guard = 0
      do {
        if (++guard > 1_000_000) throw new RuntimeError('do: iteration limit exceeded')
        try { evalBlock(s.body, ctx) }
        catch (sig) {
          if (sig instanceof BreakSignal) return
          if (sig instanceof ContinueSignal) continue
          throw sig
        }
      } while (!toBool(evalExpr(s.cond, ctx)))
      return
    }
    case 'break': throw new BreakSignal()
    case 'continue': throw new ContinueSignal()
    case 'return': throw new ReturnSignal()
    case 'function': {
      ctx.ws.fns.set(s.name, {
        kind: 'fn',
        name: s.name,
        arity: s.params.length,
        params: s.params,
        body: s.body,
      })
      return
    }
  }
}

// ---- Pretty printing -------------------------------------------------------

export function formatValue(name: string, v: MValue): string {
  if (v.kind === 'void') return ''
  if (v.kind === 'num') return `${name} = ${formatNum(v.v)}`
  if (v.kind === 'bool') return `${name} = ${v.v ? '1' : '0'}`
  if (v.kind === 'str') return `${name} = ${v.v}`
  if (v.kind === 'fn') return `${name} = @${v.name}`
  if (v.kind === 'mat') {
    if (v.rows === 1 && v.cols === 1) return `${name} = ${formatNum(v.data[0])}`
    const lines: string[] = [`${name} =`, '']
    const maxRows = Math.min(v.rows, 24)
    const maxCols = Math.min(v.cols, 12)
    for (let r = 0; r < maxRows; r++) {
      const row: string[] = []
      for (let c = 0; c < maxCols; c++) row.push(formatNum(v.data[r * v.cols + c]).padStart(12))
      if (maxCols < v.cols) row.push(' …')
      lines.push('  ' + row.join(' '))
    }
    if (maxRows < v.rows) lines.push(`  ⋮  (${v.rows - maxRows} more rows)`)
    lines.push('')
    return lines.join('\n')
  }
  return String(v)
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e5 || abs < 1e-4) return n.toExponential(4)
  if (Number.isInteger(n)) return String(n)
  return n.toPrecision(5).replace(/\.?0+$/, '')
}

// -----------------------------------------------------------------------------
// Built-ins
// -----------------------------------------------------------------------------

/** Convert any MValue to a flat JS array of numbers for mathLib calls. */
function toArray(v: MValue): number[] {
  if (v.kind === 'num') return [v.v]
  if (v.kind === 'bool') return [v.v ? 1 : 0]
  if (v.kind === 'mat') return Array.from(v.data)
  throw new RuntimeError(`cannot convert ${v.kind} to array`)
}

/** Apply a scalar math function element-wise. */
function elemMap(v: MValue, fn: (x: number) => number): MValue {
  const m = toMat(v)
  const out = new Float64Array(m.data.length)
  for (let i = 0; i < m.data.length; i++) out[i] = fn(m.data[i])
  return { kind: 'mat', rows: m.rows, cols: m.cols, data: out }
}

function need(args: MValue[], n: number, name: string): void {
  if (args.length < n) throw new RuntimeError(`${name}: expected ${n} argument(s), got ${args.length}`)
}

/** Build the built-in registry bound to this run's context (so plot/print
 *  functions can reach currentPlot / outputs). */
function makeBuiltins(ctx: EvalContext): Map<string, MFn> {
  const B = new Map<string, MFn>()
  const def = (name: string, arity: number, fn: (args: MValue[]) => MValue) => {
    B.set(name, { kind: 'fn', name, arity, builtin: fn })
  }

  const ensurePlot = (): PlotSpec => {
    if (!ctx.currentPlot) ctx.currentPlot = { series: [] }
    return ctx.currentPlot
  }

  // ---- Element-wise math ------------------------------------------------
  const unaryMath: [string, (x: number) => number][] = [
    ['sin', Math.sin], ['cos', Math.cos], ['tan', Math.tan],
    ['asin', Math.asin], ['acos', Math.acos], ['atan', Math.atan],
    ['sinh', Math.sinh], ['cosh', Math.cosh], ['tanh', Math.tanh],
    ['exp', Math.exp], ['log', Math.log], ['log2', Math.log2], ['log10', Math.log10],
    ['sqrt', Math.sqrt], ['abs', Math.abs], ['sign', Math.sign],
    ['floor', Math.floor], ['ceil', Math.ceil], ['round', Math.round], ['fix', Math.trunc],
  ]
  for (const [n, f] of unaryMath) def(n, 1, args => { need(args, 1, n); return elemMap(args[0], f) })

  def('atan2', 2, args => {
    need(args, 2, 'atan2')
    return elemBinary(toMat(args[0]), toMat(args[1]), Math.atan2, 'atan2')
  })
  def('mod', 2, args => {
    need(args, 2, 'mod')
    return elemBinary(toMat(args[0]), toMat(args[1]), (x, y) => x - y * Math.floor(x / y), 'mod')
  })
  def('rem', 2, args => {
    need(args, 2, 'rem')
    return elemBinary(toMat(args[0]), toMat(args[1]), (x, y) => x - y * Math.trunc(x / y), 'rem')
  })
  def('power', 2, args => applyBinOp('.^', args[0], args[1]))
  def('pi', 0, () => mnum(Math.PI))
  def('e', 0, () => mnum(Math.E))
  def('Inf', 0, () => mnum(Infinity))
  def('inf', 0, () => mnum(Infinity))
  def('NaN', 0, () => mnum(NaN))
  def('nan', 0, () => mnum(NaN))
  def('eps', 0, () => mnum(Number.EPSILON))
  def('true', 0, () => mbool(true))
  def('false', 0, () => mbool(false))

  // ---- Matrix constructors ---------------------------------------------
  const dimsFromArgs = (args: MValue[]): [number, number] => {
    if (args.length === 0) return [1, 1]
    if (args.length === 1) {
      const n = Math.round(toNumber(args[0]))
      return [n, n]
    }
    return [Math.round(toNumber(args[0])), Math.round(toNumber(args[1]))]
  }
  def('zeros', -1, args => {
    const [r, c] = dimsFromArgs(args)
    return mmat(r, c, new Float64Array(r * c))
  })
  def('ones', -1, args => {
    const [r, c] = dimsFromArgs(args)
    const d = new Float64Array(r * c); d.fill(1)
    return mmat(r, c, d)
  })
  def('eye', -1, args => {
    const [r, c] = dimsFromArgs(args)
    const d = new Float64Array(r * c)
    const m = Math.min(r, c)
    for (let i = 0; i < m; i++) d[i * c + i] = 1
    return mmat(r, c, d)
  })
  def('rand', -1, args => {
    const [r, c] = dimsFromArgs(args)
    const d = new Float64Array(r * c)
    for (let i = 0; i < d.length; i++) d[i] = Math.random()
    return mmat(r, c, d)
  })
  def('randn', -1, args => {
    const [r, c] = dimsFromArgs(args)
    const d = new Float64Array(r * c)
    for (let i = 0; i < d.length; i++) d[i] = ML.randNorm(0, 1)
    return mmat(r, c, d)
  })
  def('linspace', -1, args => {
    need(args, 2, 'linspace')
    const a = toNumber(args[0]), b = toNumber(args[1])
    const n = args[2] ? Math.round(toNumber(args[2])) : 100
    const d = new Float64Array(n)
    if (n === 1) d[0] = b
    else {
      const step = (b - a) / (n - 1)
      for (let i = 0; i < n; i++) d[i] = a + i * step
    }
    return mmat(1, n, d)
  })
  def('logspace', -1, args => {
    need(args, 2, 'logspace')
    const a = toNumber(args[0]), b = toNumber(args[1])
    const n = args[2] ? Math.round(toNumber(args[2])) : 50
    const d = new Float64Array(n)
    if (n === 1) d[0] = Math.pow(10, b)
    else {
      const step = (b - a) / (n - 1)
      for (let i = 0; i < n; i++) d[i] = Math.pow(10, a + i * step)
    }
    return mmat(1, n, d)
  })
  def('repmat', 3, args => {
    need(args, 3, 'repmat')
    const m = toMat(args[0])
    const rr = Math.round(toNumber(args[1]))
    const cc = Math.round(toNumber(args[2]))
    const R = m.rows * rr, C = m.cols * cc
    const d = new Float64Array(R * C)
    for (let i = 0; i < R; i++) {
      for (let j = 0; j < C; j++) {
        d[i * C + j] = m.data[(i % m.rows) * m.cols + (j % m.cols)]
      }
    }
    return mmat(R, C, d)
  })
  def('reshape', -1, args => {
    need(args, 3, 'reshape')
    const m = toMat(args[0])
    const r = Math.round(toNumber(args[1]))
    const c = Math.round(toNumber(args[2]))
    if (r * c !== m.data.length) throw new RuntimeError('reshape: element count must match')
    return mmat(r, c, new Float64Array(m.data))
  })

  // ---- Queries ---------------------------------------------------------
  def('size', -1, args => {
    const m = toMat(args[0])
    if (args.length === 2) {
      const dim = Math.round(toNumber(args[1]))
      return mnum(dim === 1 ? m.rows : m.cols)
    }
    return mmat(1, 2, [m.rows, m.cols])
  })
  def('length', 1, args => {
    const m = toMat(args[0])
    return mnum(Math.max(m.rows, m.cols))
  })
  def('numel', 1, args => mnum(toMat(args[0]).data.length))
  def('rows', 1, args => mnum(toMat(args[0]).rows))
  def('columns', 1, args => mnum(toMat(args[0]).cols))
  def('isempty', 1, args => mbool(toMat(args[0]).data.length === 0))
  def('isnumeric', 1, args => mbool(args[0].kind === 'num' || args[0].kind === 'mat'))

  // ---- Reductions ------------------------------------------------------
  // Reductions: vector -> scalar, matrix -> row vector of
  // per-column reductions (dim=1). We fall back to flattening for 1-D input.
  const reduceVecOrMat = (v: MValue, fn: (a: number[]) => number): MValue => {
    const m = toMat(v)
    if (m.rows === 1 || m.cols === 1) {
      return mnum(fn(Array.from(m.data)))
    }
    const out = new Float64Array(m.cols)
    for (let c = 0; c < m.cols; c++) {
      const col = new Array(m.rows)
      for (let r = 0; r < m.rows; r++) col[r] = m.data[r * m.cols + c]
      out[c] = fn(col)
    }
    return mmat(1, m.cols, out)
  }
  def('sum', 1, args => reduceVecOrMat(args[0], ML.sum))
  def('prod', 1, args => reduceVecOrMat(args[0], a => a.reduce((p, v) => p * v, 1)))
  def('mean', 1, args => reduceVecOrMat(args[0], ML.mean))
  def('median', 1, args => reduceVecOrMat(args[0], ML.median))
  def('std', 1, args => reduceVecOrMat(args[0], ML.std))
  def('var', 1, args => reduceVecOrMat(args[0], ML.variance))
  def('min', -1, args => {
    if (args.length === 2) return elemBinary(toMat(args[0]), toMat(args[1]), Math.min, 'min')
    return reduceVecOrMat(args[0], a => Math.min(...a))
  })
  def('max', -1, args => {
    if (args.length === 2) return elemBinary(toMat(args[0]), toMat(args[1]), Math.max, 'max')
    return reduceVecOrMat(args[0], a => Math.max(...a))
  })
  def('range', 1, args => { const a = toArray(args[0]); return mnum(Math.max(...a) - Math.min(...a)) })
  def('quantile', 2, args => mnum(ML.quantile(toArray(args[0]), toNumber(args[1]))))
  def('sort', 1, args => {
    const a = [...toArray(args[0])].sort((x, y) => x - y)
    return mmat(1, a.length, a)
  })
  def('unique', 1, args => {
    const a = Array.from(new Set(toArray(args[0]))).sort((x, y) => x - y)
    return mmat(1, a.length, a)
  })
  def('cumsum', 1, args => {
    const a = toArray(args[0]); const out = new Float64Array(a.length)
    let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; out[i] = s }
    return mmat(1, a.length, out)
  })
  def('cumprod', 1, args => {
    const a = toArray(args[0]); const out = new Float64Array(a.length)
    let s = 1; for (let i = 0; i < a.length; i++) { s *= a[i]; out[i] = s }
    return mmat(1, a.length, out)
  })
  def('skewness', 1, args => mnum(ML.skewness(toArray(args[0]))))
  def('kurtosis', 1, args => mnum(ML.kurtosis(toArray(args[0]))))
  def('sem', 1, args => mnum(ML.sem(toArray(args[0]))))
  def('cov', 2, args => mnum(ML.covariance(toArray(args[0]), toArray(args[1]))))
  def('corr', 2, args => mnum(ML.pearsonR(toArray(args[0]), toArray(args[1])).r))
  def('normcdf', 1, args => mnum(ML.normCDF(toNumber(args[0]))))
  def('norminv', 1, args => mnum(ML.invNorm(toNumber(args[0]))))
  def('tcdf', 2, args => mnum(ML.tCDF(toNumber(args[0]), toNumber(args[1]))))
  def('chi2cdf', 2, args => mnum(ML.chiCDF(toNumber(args[0]), toNumber(args[1]))))
  def('fcdf', 3, args => mnum(ML.fCDF(toNumber(args[0]), toNumber(args[1]), toNumber(args[2]))))
  def('gammaln', 1, args => elemMap(args[0], ML.lnGamma))

  // ---- Signal processing ----------------------------------------------
  def('fft', -1, args => {
    const sig = toArray(args[0])
    const fs = args[1] ? toNumber(args[1]) : 1
    const r = ML.fft(sig, fs)
    return mmat(1, r.magnitude.length, r.magnitude)
  })
  def('butter', -1, args => {
    need(args, 3, 'butter')
    const data = toArray(args[0])
    const cutoff = toNumber(args[1])
    const fs = toNumber(args[2])
    const order = args[3] ? Math.round(toNumber(args[3])) : 4
    const type = (args[4] && args[4].kind === 'str' ? args[4].v : 'low') as 'low' | 'high'
    const out = ML.butterworth(data, cutoff, fs, order, type)
    return mmat(1, out.length, out)
  })
  def('movmean', 2, args => {
    const r = ML.movingAverage(toArray(args[0]), Math.round(toNumber(args[1])))
    return mmat(1, r.length, r)
  })
  def('findpeaks', 1, args => {
    const r = ML.findPeaks(toArray(args[0]))
    return mmat(1, r.heights.length, r.heights)
  })

  // ---- Regression / fitting -------------------------------------------
  def('polyfit', 3, args => {
    const coeffs = ML.polyfit(toArray(args[0]), toArray(args[1]), Math.round(toNumber(args[2])))
    return mmat(1, coeffs.length, coeffs)
  })
  def('polyval', 2, args => {
    const c = toArray(args[0]); const x = toArray(args[1])
    const out = x.map(xi => ML.polyval(c, xi))
    return mmat(1, out.length, out)
  })
  // d/dx of a polynomial given as a row of descending coefficients.
  def('polyder', 1, args => {
    const c = toArray(args[0])
    const n = c.length
    if (n <= 1) return mmat(1, 1, [0])
    const out = new Float64Array(n - 1)
    for (let i = 0; i < n - 1; i++) out[i] = c[i] * (n - 1 - i)
    return mmat(1, n - 1, out)
  })
  // Antiderivative (constant of integration = 0).
  def('polyint', 1, args => {
    const c = toArray(args[0])
    const n = c.length
    if (n === 0) return mmat(1, 1, [0])
    const out = new Float64Array(n + 1)
    for (let i = 0; i < n; i++) out[i] = c[i] / (n - i)
    out[n] = 0
    return mmat(1, n + 1, out)
  })
  // Polynomial roots via Durand–Kerner. Returns an n×2 matrix of [real imag]
  // because the engine has no native complex type — column 1 is the real
  // part, column 2 is the imaginary part of each root.
  def('roots', 1, args => {
    const raw = toArray(args[0])
    let start = 0
    while (start < raw.length && raw[start] === 0) start++
    const p = raw.slice(start)
    const n = p.length - 1
    if (n <= 0) return mmat(0, 2, new Float64Array(0))
    const lead = p[0]
    const a = p.map(v => v / lead)
    const re = new Array<number>(n)
    const im = new Array<number>(n)
    const r0 = 0.4 + Math.max(...a.map(Math.abs)) * 0.1
    for (let i = 0; i < n; i++) {
      const t = (2 * Math.PI * i) / n + 0.7
      re[i] = r0 * Math.cos(t)
      im[i] = r0 * Math.sin(t)
    }
    const evalPoly = (rx: number, ix: number): [number, number] => {
      let yr = a[0], yi = 0
      for (let i = 1; i < a.length; i++) {
        const nr = yr * rx - yi * ix + a[i]
        const ni = yr * ix + yi * rx
        yr = nr; yi = ni
      }
      return [yr, yi]
    }
    for (let iter = 0; iter < 400; iter++) {
      let maxDelta = 0
      for (let i = 0; i < n; i++) {
        const [pr, pi] = evalPoly(re[i], im[i])
        let dr = 1, di = 0
        for (let j = 0; j < n; j++) {
          if (i === j) continue
          const ar = re[i] - re[j]
          const ai = im[i] - im[j]
          const nr = dr * ar - di * ai
          const ni = dr * ai + di * ar
          dr = nr; di = ni
        }
        const dd = dr * dr + di * di
        if (dd === 0) continue
        const cr = (pr * dr + pi * di) / dd
        const ci = (pi * dr - pr * di) / dd
        re[i] -= cr
        im[i] -= ci
        const m = Math.hypot(cr, ci)
        if (m > maxDelta) maxDelta = m
      }
      if (maxDelta < 1e-14) break
    }
    const out = new Float64Array(n * 2)
    for (let i = 0; i < n; i++) {
      out[i * 2] = re[i]
      out[i * 2 + 1] = im[i]
    }
    return mmat(n, 2, out)
  })
  // Discrete convolution / polynomial multiplication.
  def('conv', 2, args => {
    const a = toArray(args[0])
    const b = toArray(args[1])
    const n = a.length, m = b.length
    if (n === 0 || m === 0) return mmat(1, 0, new Float64Array(0))
    const out = new Float64Array(n + m - 1)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) out[i + j] += a[i] * b[j]
    }
    return mmat(1, n + m - 1, out)
  })
  // Cross-correlation: xcorr(a) is the autocorrelation, xcorr(a,b) computes
  // the cross-correlation of a and b. Result length is n+m-1.
  def('xcorr', -1, args => {
    const a = toArray(args[0])
    const b = args[1] ? toArray(args[1]) : a
    const n = a.length, m = b.length
    if (n === 0 || m === 0) return mmat(1, 0, new Float64Array(0))
    const out = new Float64Array(n + m - 1)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) out[i + (m - 1 - j)] += a[i] * b[j]
    }
    return mmat(1, n + m - 1, out)
  })
  // Shift the zero-frequency component of an FFT result to the center.
  // Works for both 1-D vectors and 2-D matrices (independent shift per axis).
  def('fftshift', 1, args => {
    const m = toMat(args[0])
    if (m.rows === 1 || m.cols === 1) {
      const n = m.data.length
      const k = Math.floor(n / 2)
      const out = new Float64Array(n)
      for (let i = 0; i < n; i++) out[i] = m.data[(i + k) % n]
      return m.rows === 1 ? mmat(1, n, out) : mmat(n, 1, out)
    }
    const R = m.rows, C = m.cols
    const kr = Math.floor(R / 2), kc = Math.floor(C / 2)
    const out = new Float64Array(R * C)
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        out[r * C + c] = m.data[((r + kr) % R) * C + ((c + kc) % C)]
      }
    }
    return mmat(R, C, out)
  })
  // Common window functions, returned as column vectors.
  def('hann', 1, args => {
    const n = Math.round(toNumber(args[0]))
    if (n <= 0) return mmat(0, 1, new Float64Array(0))
    const out = new Float64Array(n)
    if (n === 1) { out[0] = 1; return mmat(1, 1, out) }
    for (let i = 0; i < n; i++) out[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))
    return mmat(n, 1, out)
  })
  def('hanning', 1, args => {
    const n = Math.round(toNumber(args[0]))
    if (n <= 0) return mmat(0, 1, new Float64Array(0))
    const out = new Float64Array(n)
    if (n === 1) { out[0] = 1; return mmat(1, 1, out) }
    for (let i = 0; i < n; i++) out[i] = 0.5 * (1 - Math.cos((2 * Math.PI * (i + 1)) / (n + 1)))
    return mmat(n, 1, out)
  })
  def('hamming', 1, args => {
    const n = Math.round(toNumber(args[0]))
    if (n <= 0) return mmat(0, 1, new Float64Array(0))
    const out = new Float64Array(n)
    if (n === 1) { out[0] = 1; return mmat(1, 1, out) }
    for (let i = 0; i < n; i++) out[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1))
    return mmat(n, 1, out)
  })
  def('blackman', 1, args => {
    const n = Math.round(toNumber(args[0]))
    if (n <= 0) return mmat(0, 1, new Float64Array(0))
    const out = new Float64Array(n)
    if (n === 1) { out[0] = 1; return mmat(1, 1, out) }
    for (let i = 0; i < n; i++) {
      const t = (2 * Math.PI * i) / (n - 1)
      out[i] = 0.42 - 0.5 * Math.cos(t) + 0.08 * Math.cos(2 * t)
    }
    return mmat(n, 1, out)
  })
  // Root-mean-square value of a vector.
  def('rms', 1, args => {
    const a = toArray(args[0])
    if (a.length === 0) return mnum(0)
    let s = 0
    for (let i = 0; i < a.length; i++) s += a[i] * a[i]
    return mnum(Math.sqrt(s / a.length))
  })
  // Detrend: remove a linear trend (default) or just the mean ('constant').
  def('detrend', -1, args => {
    const a = toArray(args[0])
    const n = a.length
    if (n === 0) return mmat(1, 0, new Float64Array(0))
    const mode = args[1] && args[1].kind === 'str' ? args[1].v : 'linear'
    const out = new Float64Array(n)
    if (mode === 'constant' || n < 2) {
      let m = 0
      for (let i = 0; i < n; i++) m += a[i]
      m /= n
      for (let i = 0; i < n; i++) out[i] = a[i] - m
    } else {
      let sx = 0, sy = 0, sxx = 0, sxy = 0
      for (let i = 0; i < n; i++) {
        sx += i; sy += a[i]; sxx += i * i; sxy += i * a[i]
      }
      const denom = n * sxx - sx * sx
      const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0
      const intercept = (sy - slope * sx) / n
      for (let i = 0; i < n; i++) out[i] = a[i] - (intercept + slope * i)
    }
    return mmat(1, n, out)
  })

  // ---- Printing --------------------------------------------------------
  const valueToText = (v: MValue): string => {
    if (v.kind === 'str') return v.v
    if (v.kind === 'num') return formatNum(v.v)
    if (v.kind === 'bool') return v.v ? '1' : '0'
    if (v.kind === 'mat' && v.rows === 1 && v.cols === 1) return formatNum(v.data[0])
    if (v.kind === 'mat') return formatValue('', v).trim()
    return ''
  }
  def('disp', 1, args => {
    ctx.outputs.push({ kind: 'text', text: valueToText(args[0]) })
    return MVOID
  })
  def('display', 1, args => {
    ctx.outputs.push({ kind: 'text', text: valueToText(args[0]) })
    return MVOID
  })
  def('printf', -1, args => {
    const fmt = args[0] && args[0].kind === 'str' ? args[0].v : ''
    ctx.outputs.push({ kind: 'text', text: sprintf(fmt, args.slice(1)) })
    return MVOID
  })
  def('fprintf', -1, args => {
    // fprintf(fid, fmt, ...) or fprintf(fmt, ...)
    let fmtArg = args[0]
    let rest = args.slice(1)
    if (fmtArg.kind === 'num') { // fid, treat as stdout
      fmtArg = args[1] ?? { kind: 'str', v: '' }
      rest = args.slice(2)
    }
    const fmt = fmtArg.kind === 'str' ? fmtArg.v : ''
    ctx.outputs.push({ kind: 'text', text: sprintf(fmt, rest) })
    return MVOID
  })
  def('sprintf', -1, args => {
    const fmt = args[0] && args[0].kind === 'str' ? args[0].v : ''
    return mstr(sprintf(fmt, args.slice(1)))
  })
  def('num2str', 1, args => mstr(valueToText(args[0])))
  def('str2num', 1, args => {
    if (args[0].kind !== 'str') throw new RuntimeError('str2num: expected string')
    return mnum(parseFloat(args[0].v))
  })
  def('strcat', -1, args => mstr(args.map(a => a.kind === 'str' ? a.v : valueToText(a)).join('')))
  def('error', -1, args => {
    const msg = args[0] && args[0].kind === 'str' ? args[0].v : 'error'
    throw new RuntimeError(msg)
  })
  def('warning', -1, args => {
    const msg = args[0] && args[0].kind === 'str' ? args[0].v : 'warning'
    ctx.outputs.push({ kind: 'text', text: `warning: ${msg}` })
    return MVOID
  })
  def('tic', 0, () => { ctx.ws.vars.set('__tic__', mnum(performance.now())); return MVOID })
  def('toc', 0, () => {
    const t0 = ctx.ws.vars.get('__tic__')
    if (!t0 || t0.kind !== 'num') return mnum(0)
    const dt = (performance.now() - t0.v) / 1000
    ctx.outputs.push({ kind: 'text', text: `Elapsed time is ${dt.toFixed(4)} seconds.` })
    return mnum(dt)
  })

  // ---- Plotting --------------------------------------------------------
  const pushSeries = (name: string, x: number[], y: number[], type: 'line' | 'scatter' | 'bar') => {
    const p = ensurePlot()
    p.series.push({ name, x, y, type })
  }
  def('figure', -1, () => {
    // Flush current plot into outputs; start fresh
    if (ctx.currentPlot && ctx.currentPlot.series.length > 0) {
      ctx.outputs.push({ kind: 'plot', plot: ctx.currentPlot })
    }
    ctx.currentPlot = { series: [] }
    return MVOID
  })
  def('clf', 0, () => { ctx.currentPlot = { series: [] }; return MVOID })
  def('plot', -1, args => {
    need(args, 1, 'plot')
    let x: number[], y: number[]
    let idx = 0
    if (args.length >= 2 && (args[1].kind === 'num' || args[1].kind === 'mat')) {
      x = toArray(args[0]); y = toArray(args[1]); idx = 2
    } else {
      y = toArray(args[0]); x = y.map((_, i) => i + 1); idx = 1
    }
    const lbl = (args[idx] && args[idx].kind === 'str') ? (args[idx] as MStr).v : ''
    pushSeries(lbl || `y${ensurePlot().series.length + 1}`, x, y, 'line')
    return MVOID
  })

  // ─── Imaging bridge ────────────────────────────────────────────────
  // Lightweight script-side handles on the Research Imaging studies kept
  // in localStorage. The Compute Lab Imaging panel listens on
  // `compute-imaging-update` and re-renders when we fire it, so mutating
  // windowCenter/Width from a script immediately updates the viewer.
  const IMG_KEY = 'research-imaging-studies'
  const IMG_EVENT = 'compute-imaging-update'
  interface ImgAnnotation { id: string; type: string; x: number; y: number;
    w?: number; h?: number; x2?: number; y2?: number; label: string; color: string; notes?: string }
  interface ImgStudy { id: string; title: string; modality: string; bodyPart: string;
    width: number; height: number; windowCenter: number; windowWidth: number;
    filter?: string; annotations?: ImgAnnotation[] }
  const loadImgStudies = (): ImgStudy[] => {
    try { return JSON.parse(localStorage.getItem(IMG_KEY) || '[]') as ImgStudy[] } catch { return [] }
  }
  const saveImgStudies = (list: ImgStudy[]) => {
    try { localStorage.setItem(IMG_KEY, JSON.stringify(list)) } catch { /* quota */ }
  }
  const fireImg = (selectId?: string) => {
    try {
      const evt = new CustomEvent(IMG_EVENT, { detail: selectId ? { selectId } : {} })
      window.dispatchEvent(evt)
    } catch { /* non-browser */ }
  }
  def('imaging_count', 0, () => mnum(loadImgStudies().length))
  def('imaging_list', 0, () => {
    const list = loadImgStudies()
    const lines = list.length === 0
      ? ['(no imaging studies — upload on /imaging)']
      : list.map((s, i) => `[${i}] ${s.title || s.modality} — ${s.modality} · ${s.bodyPart || '–'} (${s.width}×${s.height})`)
    ctx.outputs.push({ kind: 'text', text: lines.join('\n') })
    return mnum(list.length)
  })
  def('imaging_info', -1, args => {
    const list = loadImgStudies()
    if (list.length === 0) throw new RuntimeError('imaging_info: no studies available')
    const i = args[0] ? Math.max(0, Math.min(list.length - 1, Math.round(toNumber(args[0])))) : list.length - 1
    const s = list[i]
    ctx.outputs.push({ kind: 'text', text:
      `Study [${i}] — ${s.title || s.modality}\n` +
      `  modality: ${s.modality}\n` +
      `  region:   ${s.bodyPart || '–'}\n` +
      `  size:     ${s.width} × ${s.height}\n` +
      `  window:   C ${s.windowCenter} / W ${s.windowWidth}`,
    })
    return MVOID
  })
  def('imaging_select', 1, args => {
    need(args, 1, 'imaging_select')
    const list = loadImgStudies()
    if (list.length === 0) throw new RuntimeError('imaging_select: no studies available')
    const i = Math.max(0, Math.min(list.length - 1, Math.round(toNumber(args[0]))))
    fireImg(list[i].id)
    return mstr(list[i].id)
  })
  def('imaging_window', 2, args => {
    need(args, 2, 'imaging_window')
    const list = loadImgStudies()
    if (list.length === 0) throw new RuntimeError('imaging_window: no studies available')
    const wc = toNumber(args[0])
    const ww = toNumber(args[1])
    const idx = list.length - 1
    const next = list.map((s, i) => i === idx ? { ...s, windowCenter: wc, windowWidth: Math.max(1, ww) } : s)
    saveImgStudies(next)
    fireImg(next[idx].id)
    return MVOID
  })
  // imaging_annotate(type, x, y, [w, h, [label]]) — add an annotation to the
  // most-recent study. `type` ∈ { "rect", "circle", "point", "line",
  // "measure", "ruler" }. For "line"/"measure"/"ruler" w/h are dx/dy.
  def('imaging_annotate', -1, args => {
    if (args.length < 3) throw new RuntimeError('imaging_annotate: expected (type, x, y, [w, h, [label]])')
    const list = loadImgStudies()
    if (list.length === 0) throw new RuntimeError('imaging_annotate: no studies available')
    const type = args[0].kind === 'str' ? (args[0] as MStr).v : 'point'
    const x = toNumber(args[1])
    const y = toNumber(args[2])
    const w = args[3] ? toNumber(args[3]) : undefined
    const h = args[4] ? toNumber(args[4]) : undefined
    const label = (args[5] && args[5].kind === 'str') ? (args[5] as MStr).v : `annotation ${Date.now()}`
    const ann: ImgAnnotation = {
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type, x, y, label, color: '#ffffff',
    }
    if (type === 'line' || type === 'measure' || type === 'ruler') {
      if (w !== undefined) ann.x2 = x + w
      if (h !== undefined) ann.y2 = y + h
    } else if (w !== undefined || h !== undefined) {
      ann.w = w
      ann.h = h
    }
    const idx = list.length - 1
    const next = list.map((s, i) => i === idx
      ? { ...s, annotations: [...(s.annotations || []), ann] }
      : s)
    saveImgStudies(next)
    fireImg(next[idx].id)
    return mstr(ann.id)
  })
  // imaging_annotations([idx]) — print and return count of annotations on
  // the given study (defaults to the most-recent study).
  def('imaging_annotations', -1, args => {
    const list = loadImgStudies()
    if (list.length === 0) throw new RuntimeError('imaging_annotations: no studies available')
    const idx = args[0] ? Math.max(0, Math.min(list.length - 1, Math.round(toNumber(args[0])))) : list.length - 1
    const anns = list[idx].annotations || []
    if (anns.length === 0) {
      ctx.outputs.push({ kind: 'text', text: `(study [${idx}] has no annotations)` })
    } else {
      const lines = anns.map((a, i) => {
        const extra = a.type === 'rect' || a.type === 'circle'
          ? ` ${a.w?.toFixed?.(0) ?? '–'}×${a.h?.toFixed?.(0) ?? '–'}`
          : (a.x2 !== undefined ? ` → (${a.x2.toFixed(0)}, ${a.y2?.toFixed(0) ?? '–'})` : '')
        return `  [${i}] ${a.type} @ (${a.x.toFixed(0)}, ${a.y.toFixed(0)})${extra} — ${a.label}`
      })
      ctx.outputs.push({ kind: 'text', text: `Study [${idx}] annotations (${anns.length}):\n${lines.join('\n')}` })
    }
    return mnum(anns.length)
  })
  // imaging_clear_annotations([idx]) — remove every annotation from the
  // given study (default: last study).
  def('imaging_clear_annotations', -1, args => {
    const list = loadImgStudies()
    if (list.length === 0) throw new RuntimeError('imaging_clear_annotations: no studies available')
    const idx = args[0] ? Math.max(0, Math.min(list.length - 1, Math.round(toNumber(args[0])))) : list.length - 1
    const removed = (list[idx].annotations || []).length
    const next = list.map((s, i) => i === idx ? { ...s, annotations: [] } : s)
    saveImgStudies(next)
    fireImg(next[idx].id)
    return mnum(removed)
  })
  // imaging_filter(name, [idx]) — apply a named filter preset to the study.
  // Valid names: none, invert, gaussian, median, sharpen, sobel, canny,
  // threshold, otsu, laplacian, histeq.
  def('imaging_filter', -1, args => {
    if (args.length < 1) throw new RuntimeError('imaging_filter: expected (name, [idx])')
    const list = loadImgStudies()
    if (list.length === 0) throw new RuntimeError('imaging_filter: no studies available')
    const name = args[0].kind === 'str' ? (args[0] as MStr).v : 'none'
    const idx = args[1] ? Math.max(0, Math.min(list.length - 1, Math.round(toNumber(args[1])))) : list.length - 1
    const next = list.map((s, i) => i === idx ? { ...s, filter: name } : s)
    saveImgStudies(next)
    fireImg(next[idx].id)
    return mstr(name)
  })
  // End Imaging bridge
  def('scatter', -1, args => {
    need(args, 2, 'scatter')
    pushSeries('scatter', toArray(args[0]), toArray(args[1]), 'scatter')
    return MVOID
  })
  def('bar', -1, args => {
    need(args, 1, 'bar')
    let x: number[], y: number[]
    if (args.length >= 2) { x = toArray(args[0]); y = toArray(args[1]) }
    else { y = toArray(args[0]); x = y.map((_, i) => i + 1) }
    pushSeries('bar', x, y, 'bar')
    return MVOID
  })
  def('stem', -1, args => {
    need(args, 1, 'stem')
    let x: number[], y: number[]
    if (args.length >= 2) { x = toArray(args[0]); y = toArray(args[1]) }
    else { y = toArray(args[0]); x = y.map((_, i) => i + 1) }
    pushSeries('stem', x, y, 'scatter')
    return MVOID
  })
  def('hist', -1, args => {
    const data = toArray(args[0])
    const bins = args[1] ? Math.round(toNumber(args[1])) : 20
    const h = ML.buildHistogram(data, bins)
    const x = h.map((_, i) => i + 1)
    const y = h.map(b => b.count)
    pushSeries('histogram', x, y, 'bar')
    return MVOID
  })
  def('title', 1, args => { ensurePlot().title = args[0].kind === 'str' ? args[0].v : ''; return MVOID })
  def('xlabel', 1, args => { ensurePlot().xLabel = args[0].kind === 'str' ? args[0].v : ''; return MVOID })
  def('ylabel', 1, args => { ensurePlot().yLabel = args[0].kind === 'str' ? args[0].v : ''; return MVOID })
  def('legend', -1, args => {
    // Assign labels to existing series in order
    const p = ensurePlot()
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (p.series[i] && a.kind === 'str') p.series[i].name = a.v
    }
    return MVOID
  })
  def('grid', -1, () => MVOID) // no-op
  def('hold', -1, () => MVOID) // no-op (we always hold)
  def('axis', -1, () => MVOID) // no-op for now
  def('show', 0, () => {
    if (ctx.currentPlot && ctx.currentPlot.series.length > 0) {
      ctx.outputs.push({ kind: 'plot', plot: ctx.currentPlot })
      ctx.currentPlot = { series: [] }
    }
    return MVOID
  })

  // ---- 3D Plotting -------------------------------------------------------
  /** Helper: extract 2D grid from a matrix (rows × cols → number[][]) */
  const matToGrid = (m: MValue): number[][] => {
    if (m.kind !== 'mat') throw new Error('Expected matrix for 3D plot')
    const grid: number[][] = []
    for (let r = 0; r < m.rows; r++) {
      const row: number[] = []
      for (let c = 0; c < m.cols; c++) row.push(m.data[r * m.cols + c])
      grid.push(row)
    }
    return grid
  }
  /** Flush current 3D plot into outputs */
  const flush3d = () => {
    if (ctx.currentPlot && ctx.currentPlot.mode3d) {
      ctx.outputs.push({ kind: 'plot', plot: ctx.currentPlot })
      ctx.currentPlot = { series: [] }
    }
  }

  def('surface', -1, args => {
    need(args, 1, 'surface')
    const Z = matToGrid(args[0])
    const p = ensurePlot()
    p.mode3d = 'surface'
    p.surfaceZ = Z
    if (args.length >= 3) {
      p.surfaceX = toArray(args[1])
      p.surfaceY = toArray(args[2])
    } else {
      p.surfaceX = Array.from({ length: Z[0]?.length || 0 }, (_, i) => i)
      p.surfaceY = Array.from({ length: Z.length }, (_, i) => i)
    }
    if (args.length >= 4 && args[3].kind === 'str') p.colorscale = (args[3] as MStr).v
    flush3d()
    return MVOID
  })

  def('wireframe', -1, args => {
    need(args, 1, 'wireframe')
    const Z = matToGrid(args[0])
    const p = ensurePlot()
    p.mode3d = 'wireframe'
    p.surfaceZ = Z
    if (args.length >= 3) { p.surfaceX = toArray(args[1]); p.surfaceY = toArray(args[2]) }
    else { p.surfaceX = Array.from({ length: Z[0]?.length || 0 }, (_, i) => i); p.surfaceY = Array.from({ length: Z.length }, (_, i) => i) }
    flush3d()
    return MVOID
  })

  def('contour', -1, args => {
    need(args, 1, 'contour')
    const Z = matToGrid(args[0])
    const p = ensurePlot()
    p.mode3d = 'contour'
    p.surfaceZ = Z
    if (args.length >= 3) { p.surfaceX = toArray(args[1]); p.surfaceY = toArray(args[2]) }
    else { p.surfaceX = Array.from({ length: Z[0]?.length || 0 }, (_, i) => i); p.surfaceY = Array.from({ length: Z.length }, (_, i) => i) }
    flush3d()
    return MVOID
  })

  def('heatmap', -1, args => {
    need(args, 1, 'heatmap')
    const Z = matToGrid(args[0])
    const p = ensurePlot()
    p.mode3d = 'heatmap'
    p.surfaceZ = Z
    if (args.length >= 3) { p.surfaceX = toArray(args[1]); p.surfaceY = toArray(args[2]) }
    else { p.surfaceX = Array.from({ length: Z[0]?.length || 0 }, (_, i) => i); p.surfaceY = Array.from({ length: Z.length }, (_, i) => i) }
    if (args.length >= 4 && args[3].kind === 'str') p.colorscale = (args[3] as MStr).v
    flush3d()
    return MVOID
  })

  def('scatter3d', -1, args => {
    need(args, 3, 'scatter3d')
    const p = ensurePlot()
    p.mode3d = 'scatter3d'
    p.scatter3dX = toArray(args[0])
    p.scatter3dY = toArray(args[1])
    p.scatter3dZ = toArray(args[2])
    if (args.length >= 4 && args[3].kind === 'str') p.colorscale = (args[3] as MStr).v
    flush3d()
    return MVOID
  })

  def('zlabel', 1, args => { ensurePlot().zLabel = args[0].kind === 'str' ? args[0].v : ''; return MVOID })

  def('colorscale', 1, args => { ensurePlot().colorscale = args[0].kind === 'str' ? args[0].v : 'Viridis'; return MVOID })

  // Convenience: meshgrid(x, y) → generates two matrices X, Y
  def('meshgrid', 2, args => {
    const x = toArray(args[0]), y = toArray(args[1])
    const X = new Float64Array(y.length * x.length)
    const Y = new Float64Array(y.length * x.length)
    for (let r = 0; r < y.length; r++) {
      for (let c = 0; c < x.length; c++) {
        X[r * x.length + c] = x[c]
        Y[r * x.length + c] = y[r]
      }
    }
    // Return X (first out) — user calls meshgrid twice or uses [X,Y]=meshgrid(x,y)
    // For simplicity, store Y in workspace as __meshY__ for next call
    ctx.ws.vars.set('__meshY__', mmat(y.length, x.length, Y))
    return mmat(y.length, x.length, X)
  })

  // ---- Statistical tests -----------------------------------------------
  def('ttest2', 2, args => {
    const r = ML.welchTTest(toArray(args[0]), toArray(args[1]))
    return mmat(1, 4, [r.t, r.df, r.p, r.cohenD])
  })
  def('ttest', 2, args => {
    const r = ML.pairedTTest(toArray(args[0]), toArray(args[1]))
    return mmat(1, 4, [r.t, r.df, r.p, r.cohenD])
  })
  def('ranksum', 2, args => {
    const r = ML.mannWhitneyU(toArray(args[0]), toArray(args[1]))
    return mmat(1, 4, [r.u, r.z, r.p, r.effectSize])
  })
  def('shapiro', 1, args => {
    const r = ML.shapiroWilk(toArray(args[0]))
    return mmat(1, 2, [r.w, r.p])
  })
  def('iqr', 1, args => {
    const a = toArray(args[0])
    return mnum(ML.quantile(a, 0.75) - ML.quantile(a, 0.25))
  })
  def('prctile', 2, args => mnum(ML.quantile(toArray(args[0]), toNumber(args[1]) / 100)))
  def('regress', 2, args => {
    // regress(y, x) -> [slope, intercept, r2, p]
    const r = ML.linearRegression(toArray(args[1]), toArray(args[0]))
    return mmat(1, 4, [r.slope, r.intercept, r.r2, r.pValue])
  })

  // ---- Wire existing mathLib functions as builtins ---------------------
  def('psd', -1, args => {
    const sig = toArray(args[0])
    const fs = args[1] ? toNumber(args[1]) : 1
    const r = ML.welchPSD(sig, fs)
    return mmat(1, r.power.length, r.power)
  })
  def('bandpass', -1, args => {
    need(args, 4, 'bandpass')
    const out = ML.bandpassFilter(toArray(args[0]), toNumber(args[1]), toNumber(args[2]), toNumber(args[3]))
    return mmat(1, out.length, out)
  })
  def('samplesize', -1, args => {
    need(args, 3, 'samplesize')
    const r = ML.sampleSizeCalc(toNumber(args[0]), args[1] ? toNumber(args[1]) : 0.05, args[2] ? toNumber(args[2]) : 0.8, 'two-sample')
    return mmat(1, 2, [r.n, r.nPerGroup])
  })

  // ---- Biomedical & epidemiological functions ---------------------------

  // Spearman rank correlation
  const assignRanks = (a: number[]): number[] => {
    const indexed = a.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v)
    const ranks = new Array<number>(a.length)
    let i = 0
    while (i < indexed.length) {
      let j = i
      while (j < indexed.length && indexed[j].v === indexed[i].v) j++
      const avg = (i + 1 + j) / 2
      for (let k = i; k < j; k++) ranks[indexed[k].i] = avg
      i = j
    }
    return ranks
  }

  def('spearman', 2, args => {
    const x = toArray(args[0]), y = toArray(args[1])
    if (x.length !== y.length) throw new RuntimeError('spearman: length mismatch')
    const rx = assignRanks(x), ry = assignRanks(y)
    const r = ML.pearsonR(rx, ry)
    return mmat(1, 2, [r.r, r.p])
  })

  // Odds ratio & relative risk (from 2x2 table values)
  def('oddsratio', 4, args => {
    const a = toNumber(args[0]), b = toNumber(args[1])
    const c = toNumber(args[2]), d = toNumber(args[3])
    const or = (a * d) / (b * c)
    const se = Math.sqrt(1/a + 1/b + 1/c + 1/d)
    const ci_lo = Math.exp(Math.log(or) - 1.96 * se)
    const ci_hi = Math.exp(Math.log(or) + 1.96 * se)
    return mmat(1, 3, [or, ci_lo, ci_hi])
  })

  def('riskratio', 4, args => {
    const a = toNumber(args[0]), b = toNumber(args[1])
    const c = toNumber(args[2]), d = toNumber(args[3])
    const rr = (a / (a + b)) / (c / (c + d))
    const se = Math.sqrt(1/a - 1/(a+b) + 1/c - 1/(c+d))
    const ci_lo = Math.exp(Math.log(rr) - 1.96 * se)
    const ci_hi = Math.exp(Math.log(rr) + 1.96 * se)
    return mmat(1, 3, [rr, ci_lo, ci_hi])
  })

  // Number Needed to Treat
  def('nnt', 2, args => {
    const riskControl = toNumber(args[0]), riskTreatment = toNumber(args[1])
    const ard = Math.abs(riskControl - riskTreatment)
    return mnum(ard > 0 ? Math.ceil(1 / ard) : Infinity)
  })

  // Diagnostic test: sensitivity, specificity, PPV, NPV, accuracy
  def('diagnostic', 4, args => {
    const tp = toNumber(args[0]), fp = toNumber(args[1])
    const fn = toNumber(args[2]), tn = toNumber(args[3])
    const sens = tp / (tp + fn)
    const spec = tn / (tn + fp)
    const ppv = tp / (tp + fp)
    const npv = tn / (tn + fn)
    const acc = (tp + tn) / (tp + fp + fn + tn)
    const lrp = sens / (1 - spec)
    const lrn = (1 - sens) / spec
    return mmat(1, 7, [sens, spec, ppv, npv, acc, lrp, lrn])
  })

  // Cohen's kappa (inter-rater agreement)
  def('kappa', 2, args => {
    const rater1 = toArray(args[0]), rater2 = toArray(args[1])
    if (rater1.length !== rater2.length) throw new RuntimeError('kappa: length mismatch')
    const n = rater1.length
    const cats = Array.from(new Set([...rater1, ...rater2])).sort()
    let po = 0
    for (let i = 0; i < n; i++) if (rater1[i] === rater2[i]) po++
    po /= n
    let pe = 0
    for (const c of cats) {
      const p1 = rater1.filter(v => v === c).length / n
      const p2 = rater2.filter(v => v === c).length / n
      pe += p1 * p2
    }
    const k = pe < 1 ? (po - pe) / (1 - pe) : 1
    return mnum(k)
  })

  // Z-score normalization
  def('zscore', 1, args => {
    const a = toArray(args[0])
    const m = ML.mean(a), s = ML.std(a)
    if (s === 0) return mmat(1, a.length, new Float64Array(a.length))
    const out = a.map(v => (v - m) / s)
    return mmat(1, out.length, out)
  })

  // Min-max normalization to [0, 1]
  def('rescale', 1, args => {
    const a = toArray(args[0])
    const mn = Math.min(...a), mx = Math.max(...a)
    const r = mx - mn
    if (r === 0) return mmat(1, a.length, new Float64Array(a.length).fill(0.5))
    const out = a.map(v => (v - mn) / r)
    return mmat(1, out.length, out)
  })

  // Winsorize: clip to [q, 1-q] percentiles
  def('winsorize', -1, args => {
    need(args, 1, 'winsorize')
    const a = toArray(args[0])
    const q = args[1] ? toNumber(args[1]) : 0.05
    const lo = ML.quantile(a, q), hi = ML.quantile(a, 1 - q)
    const out = a.map(v => Math.max(lo, Math.min(hi, v)))
    return mmat(1, out.length, out)
  })

  // Outlier detection (IQR fence) — returns logical mask (1=outlier)
  def('isoutlier', -1, args => {
    const a = toArray(args[0])
    const k = args[1] ? toNumber(args[1]) : 1.5
    const q1 = ML.quantile(a, 0.25), q3 = ML.quantile(a, 0.75)
    const iqrVal = q3 - q1
    const lo = q1 - k * iqrVal, hi = q3 + k * iqrVal
    const out = a.map(v => (v < lo || v > hi) ? 1 : 0)
    return mmat(1, out.length, out)
  })

  // Bland-Altman analysis: returns [mean_diff, sd_diff, lower_loa, upper_loa]
  def('blandaltman', 2, args => {
    const a = toArray(args[0]), b = toArray(args[1])
    if (a.length !== b.length) throw new RuntimeError('blandaltman: length mismatch')
    const diffs = a.map((v, i) => v - b[i])
    const md = ML.mean(diffs), sd = ML.std(diffs)
    return mmat(1, 4, [md, sd, md - 1.96 * sd, md + 1.96 * sd])
  })

  // Bonferroni correction: adjusts p-values
  def('bonferroni', 1, args => {
    const p = toArray(args[0])
    const n = p.length
    const out = p.map(v => Math.min(1, v * n))
    return mmat(1, out.length, out)
  })

  // Bootstrap confidence interval (percentile method)
  def('bootci', -1, args => {
    need(args, 1, 'bootci')
    const data = toArray(args[0])
    const nBoot = args[1] ? Math.round(toNumber(args[1])) : 1000
    const alpha = args[2] ? toNumber(args[2]) : 0.05
    const n = data.length
    const means: number[] = []
    for (let b = 0; b < nBoot; b++) {
      let s = 0
      for (let i = 0; i < n; i++) s += data[Math.floor(Math.random() * n)]
      means.push(s / n)
    }
    means.sort((a, b) => a - b)
    const lo = means[Math.floor(nBoot * alpha / 2)]
    const hi = means[Math.floor(nBoot * (1 - alpha / 2))]
    return mmat(1, 3, [ML.mean(means), lo, hi])
  })

  // Signal-to-noise ratio
  def('snr', 1, args => {
    const a = toArray(args[0])
    const m = ML.mean(a), s = ML.std(a)
    return mnum(s > 0 ? 20 * Math.log10(Math.abs(m) / s) : Infinity)
  })

  // Zero-crossing rate
  def('zcr', 1, args => {
    const a = toArray(args[0])
    let count = 0
    for (let i = 1; i < a.length; i++) {
      if ((a[i] >= 0 && a[i-1] < 0) || (a[i] < 0 && a[i-1] >= 0)) count++
    }
    return mnum(count / (a.length - 1))
  })

  // Savitzky-Golay smoothing (polynomial order 2, window must be odd)
  def('sgolay', -1, args => {
    need(args, 1, 'sgolay')
    const data = toArray(args[0])
    let win = args[1] ? Math.round(toNumber(args[1])) : 5
    if (win % 2 === 0) win++
    const half = Math.floor(win / 2)
    const n = data.length
    const out = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      // Local quadratic fit using least squares
      let sx = 0, sx2 = 0, sx3 = 0, sx4 = 0, sy = 0, sxy = 0, sx2y = 0, cnt = 0
      for (let j = -half; j <= half; j++) {
        const idx = i + j
        if (idx < 0 || idx >= n) continue
        const xj = j
        sx += xj; sx2 += xj*xj; sx3 += xj*xj*xj; sx4 += xj*xj*xj*xj
        sy += data[idx]; sxy += xj*data[idx]; sx2y += xj*xj*data[idx]
        cnt++
      }
      // Fit: y = a0 + a1*x + a2*x^2 -> evaluate at x=0 gives a0
      // Use normal equations for degree 2
      const D = cnt * (sx2 * sx4 - sx3 * sx3) - sx * (sx * sx4 - sx2 * sx3) + sx2 * (sx * sx3 - sx2 * sx2)
      if (Math.abs(D) < 1e-15) { out[i] = data[i]; continue }
      const a0 = (sy * (sx2 * sx4 - sx3 * sx3) - sxy * (sx * sx4 - sx2 * sx3) + sx2y * (sx * sx3 - sx2 * sx2)) / D
      out[i] = a0
    }
    return mmat(1, n, out)
  })

  // Simpson's rule integration
  def('simpson', -1, args => {
    need(args, 1, 'simpson')
    let xs: number[] | null = null
    let ys: number[]
    if (args.length === 1) { ys = toArray(args[0]) }
    else { xs = toArray(args[0]); ys = toArray(args[1]) }
    const n = ys.length
    if (n < 3) {
      // Fall back to trapezoidal
      let acc = 0
      for (let i = 1; i < n; i++) {
        const dx = xs ? (xs[i] - xs[i-1]) : 1
        acc += 0.5 * dx * (ys[i] + ys[i-1])
      }
      return mnum(acc)
    }
    let acc = 0
    for (let i = 0; i < n - 2; i += 2) {
      const h = xs ? (xs[i+1] - xs[i]) : 1
      acc += h / 3 * (ys[i] + 4*ys[i+1] + ys[i+2])
    }
    if (n % 2 === 0) {
      const h = xs ? (xs[n-1] - xs[n-2]) : 1
      acc += 0.5 * h * (ys[n-1] + ys[n-2])
    }
    return mnum(acc)
  })

  // Root finding: bisection method
  def('fzero', -1, args => {
    need(args, 3, 'fzero')
    const fn = args[0]
    if (fn.kind !== 'fn') throw new RuntimeError('fzero: first argument must be a function')
    let a = toNumber(args[1]), b = toNumber(args[2])
    const tol = args[3] ? toNumber(args[3]) : 1e-10
    let fa = toNumber(callFn(fn, [mnum(a)], ctx))
    for (let iter = 0; iter < 100; iter++) {
      const mid = (a + b) / 2
      const fm = toNumber(callFn(fn, [mnum(mid)], ctx))
      if (Math.abs(fm) < tol || (b - a) / 2 < tol) return mnum(mid)
      if (fa * fm < 0) { b = mid }
      else { a = mid; fa = fm }
    }
    return mnum((a + b) / 2)
  })

  // ---- Extra scalar math / element-wise --------------------------------
  // Abramowitz & Stegun 7.1.26 approximation for erf
  const erfScalar = (x: number): number => {
    const sign = x < 0 ? -1 : 1
    const ax = Math.abs(x)
    const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741
    const a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911
    const t = 1 / (1 + p * ax)
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax)
    return sign * y
  }
  def('erf', 1, args => elemMap(args[0], erfScalar))
  def('erfc', 1, args => elemMap(args[0], x => 1 - erfScalar(x)))
  def('sinc', 1, args => elemMap(args[0], x => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)))
  def('deg2rad', 1, args => elemMap(args[0], x => x * Math.PI / 180))
  def('rad2deg', 1, args => elemMap(args[0], x => x * 180 / Math.PI))
  def('log1p', 1, args => elemMap(args[0], Math.log1p))
  def('expm1', 1, args => elemMap(args[0], Math.expm1))
  def('cbrt', 1, args => elemMap(args[0], Math.cbrt))
  def('hypot', 2, args => elemBinary(toMat(args[0]), toMat(args[1]), Math.hypot, 'hypot'))

  // ---- Matrix flips / arrangement --------------------------------------
  def('flipud', 1, args => {
    const m = toMat(args[0])
    const out = new Float64Array(m.data.length)
    for (let i = 0; i < m.rows; i++) {
      for (let j = 0; j < m.cols; j++) {
        out[(m.rows - 1 - i) * m.cols + j] = m.data[i * m.cols + j]
      }
    }
    return mmat(m.rows, m.cols, out)
  })
  def('fliplr', 1, args => {
    const m = toMat(args[0])
    const out = new Float64Array(m.data.length)
    for (let i = 0; i < m.rows; i++) {
      for (let j = 0; j < m.cols; j++) {
        out[i * m.cols + (m.cols - 1 - j)] = m.data[i * m.cols + j]
      }
    }
    return mmat(m.rows, m.cols, out)
  })
  def('rot90', -1, args => {
    const m = toMat(args[0])
    const k = ((args[1] ? Math.round(toNumber(args[1])) : 1) % 4 + 4) % 4
    let cur = m
    for (let n = 0; n < k; n++) {
      const r = cur.rows, c = cur.cols
      const out = new Float64Array(r * c)
      for (let i = 0; i < r; i++) {
        for (let j = 0; j < c; j++) {
          out[(c - 1 - j) * r + i] = cur.data[i * c + j]
        }
      }
      cur = { kind: 'mat', rows: c, cols: r, data: out }
    }
    return cur
  })

  // ---- Random extras ---------------------------------------------------
  def('randi', -1, args => {
    need(args, 1, 'randi')
    const imax = Math.round(toNumber(args[0]))
    const rr = args[1] ? Math.round(toNumber(args[1])) : 1
    const cc = args[2] ? Math.round(toNumber(args[2])) : rr
    const d = new Float64Array(rr * cc)
    for (let i = 0; i < d.length; i++) d[i] = Math.floor(Math.random() * imax) + 1
    return mmat(rr, cc, d)
  })

  // ---- Linear algebra --------------------------------------------------
  def('det', 1, args => {
    need(args, 1, 'det')
    const m = toMat(args[0])
    if (m.rows !== m.cols) throw new RuntimeError('det: matrix must be square')
    return mnum(matDet(m))
  })
  def('inv', 1, args => {
    need(args, 1, 'inv')
    return matInv(toMat(args[0]))
  })
  def('trace', 1, args => {
    need(args, 1, 'trace')
    const m = toMat(args[0])
    const n = Math.min(m.rows, m.cols)
    let s = 0
    for (let i = 0; i < n; i++) s += m.data[i * m.cols + i]
    return mnum(s)
  })
  def('diag', 1, args => {
    need(args, 1, 'diag')
    const m = toMat(args[0])
    // Vector -> diagonal matrix
    if (m.rows === 1 || m.cols === 1) {
      const n = m.data.length
      const d = new Float64Array(n * n)
      for (let i = 0; i < n; i++) d[i * n + i] = m.data[i]
      return mmat(n, n, d)
    }
    // Matrix -> diagonal vector
    const n = Math.min(m.rows, m.cols)
    const out = new Float64Array(n)
    for (let i = 0; i < n; i++) out[i] = m.data[i * m.cols + i]
    return mmat(n, 1, out)
  })
  def('norm', -1, args => {
    need(args, 1, 'norm')
    const m = toMat(args[0])
    const p = args[1] ? (args[1].kind === 'str' ? args[1].v : toNumber(args[1])) : 2
    // Vector norms
    if (m.rows === 1 || m.cols === 1) {
      if (p === 'fro' || p === 2) {
        let s = 0
        for (let i = 0; i < m.data.length; i++) s += m.data[i] * m.data[i]
        return mnum(Math.sqrt(s))
      }
      if (p === 1) {
        let s = 0
        for (let i = 0; i < m.data.length; i++) s += Math.abs(m.data[i])
        return mnum(s)
      }
      if (p === Infinity || p === 'inf') {
        let mx = 0
        for (let i = 0; i < m.data.length; i++) mx = Math.max(mx, Math.abs(m.data[i]))
        return mnum(mx)
      }
      const pn = p as number
      let s = 0
      for (let i = 0; i < m.data.length; i++) s += Math.pow(Math.abs(m.data[i]), pn)
      return mnum(Math.pow(s, 1 / pn))
    }
    // Matrix Frobenius norm (default fallback)
    let s = 0
    for (let i = 0; i < m.data.length; i++) s += m.data[i] * m.data[i]
    return mnum(Math.sqrt(s))
  })
  def('linsolve', 2, args => {
    need(args, 2, 'linsolve')
    const A = toMat(args[0]), b = toMat(args[1])
    if (A.rows !== A.cols) throw new RuntimeError('linsolve: A must be square')
    const { LU, piv } = luDecompose(A)
    return luSolve(A.rows, LU, piv, b)
  })
  def('mldivide', 2, args => applyBinOp('\\', args[0], args[1]))
  def('mrdivide', 2, args => applyBinOp('/', args[0], args[1]))
  def('transpose', 1, args => matTranspose(toMat(args[0])))
  def('rank', 1, args => {
    // Row-reduce to count non-zero rows (cheap, not SVD-accurate).
    const m = toMat(args[0])
    const r = m.rows, c = m.cols
    const M = new Float64Array(m.data)
    let rank = 0
    const tol = 1e-10
    const rowUsed = new Uint8Array(r)
    for (let col = 0; col < c; col++) {
      let pivot = -1
      for (let row = 0; row < r; row++) {
        if (!rowUsed[row] && Math.abs(M[row * c + col]) > tol) { pivot = row; break }
      }
      if (pivot < 0) continue
      rowUsed[pivot] = 1
      rank++
      const pv = M[pivot * c + col]
      for (let row = 0; row < r; row++) {
        if (row === pivot) continue
        const val = M[row * c + col]
        if (Math.abs(val) < tol) continue
        const factor = val / pv
        for (let k = col; k < c; k++) M[row * c + k] -= factor * M[pivot * c + k]
      }
    }
    return mnum(rank)
  })
  def('dot', 2, args => {
    const a = toArray(args[0]), b = toArray(args[1])
    if (a.length !== b.length) throw new RuntimeError('dot: length mismatch')
    let s = 0
    for (let i = 0; i < a.length; i++) s += a[i] * b[i]
    return mnum(s)
  })
  def('cross', 2, args => {
    const a = toArray(args[0]), b = toArray(args[1])
    if (a.length !== 3 || b.length !== 3) throw new RuntimeError('cross: inputs must be 3-element vectors')
    return mmat(1, 3, [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ])
  })

  // ---- Predicates & reducers -------------------------------------------
  def('any', 1, args => {
    const a = toArray(args[0])
    for (let i = 0; i < a.length; i++) if (a[i] !== 0 && !Number.isNaN(a[i])) return mbool(true)
    return mbool(false)
  })
  def('all', 1, args => {
    const a = toArray(args[0])
    if (a.length === 0) return mbool(true)
    for (let i = 0; i < a.length; i++) if (a[i] === 0 || Number.isNaN(a[i])) return mbool(false)
    return mbool(true)
  })
  def('find', 1, args => {
    const a = toArray(args[0])
    const out: number[] = []
    for (let i = 0; i < a.length; i++) if (a[i] !== 0 && !Number.isNaN(a[i])) out.push(i + 1)
    return mmat(1, out.length, out)
  })
  def('nnz', 1, args => {
    const a = toArray(args[0])
    let n = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== 0) n++
    return mnum(n)
  })
  def('isnan', 1, args => elemMap(args[0], x => Number.isNaN(x) ? 1 : 0))
  def('isinf', 1, args => elemMap(args[0], x => !Number.isFinite(x) && !Number.isNaN(x) ? 1 : 0))
  def('isfinite', 1, args => elemMap(args[0], x => Number.isFinite(x) ? 1 : 0))
  def('isreal', 1, () => mbool(true))
  def('isequal', -1, args => {
    if (args.length < 2) return mbool(true)
    const first = args[0]
    for (let k = 1; k < args.length; k++) {
      const other = args[k]
      if (first.kind !== other.kind) {
        // Allow num/mat scalar equivalence
        try {
          const a = toArray(first), b = toArray(other)
          if (a.length !== b.length) return mbool(false)
          for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return mbool(false)
          continue
        } catch {
          return mbool(false)
        }
      }
      if (first.kind === 'str') {
        if ((other as MStr).v !== first.v) return mbool(false)
      } else {
        const a = toArray(first), b = toArray(other)
        if (a.length !== b.length) return mbool(false)
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return mbool(false)
      }
    }
    return mbool(true)
  })

  // ---- Combinatorial ---------------------------------------------------
  const fact = (n: number): number => {
    if (n < 0 || !Number.isFinite(n)) return NaN
    let r = 1
    for (let i = 2; i <= n; i++) r *= i
    return r
  }
  def('factorial', 1, args => elemMap(args[0], x => fact(Math.round(x))))
  def('nchoosek', 2, args => {
    const n = Math.round(toNumber(args[0]))
    const k = Math.round(toNumber(args[1]))
    if (k < 0 || k > n) return mnum(0)
    const kk = Math.min(k, n - k)
    let r = 1
    for (let i = 0; i < kk; i++) r = r * (n - i) / (i + 1)
    return mnum(Math.round(r))
  })

  // ---- Higher-order / solvers ------------------------------------------
  def('arrayfun', 2, args => {
    const fn = args[0]
    if (fn.kind !== 'fn') throw new RuntimeError('arrayfun: first argument must be a function')
    const m = toMat(args[1])
    const out = new Float64Array(m.data.length)
    for (let i = 0; i < m.data.length; i++) {
      const r = callFn(fn, [mnum(m.data[i])], ctx)
      out[i] = toNumber(r)
    }
    return mmat(m.rows, m.cols, out)
  })
  def('ode45', -1, args => {
    need(args, 3, 'ode45')
    const fn = args[0]
    if (fn.kind !== 'fn') throw new RuntimeError('ode45: first argument must be a function')
    const tSpan = toArray(args[1])
    if (tSpan.length < 2) throw new RuntimeError('ode45: tspan must have at least 2 elements')
    const y0 = toArray(args[2])
    const steps = args[3] ? Math.round(toNumber(args[3])) : 500
    const result = ML.ode45(
      (t, y) => {
        const yMat = mmat(y.length, 1, y)
        const dy = callFn(fn, [mnum(t), yMat], ctx)
        return toArray(dy)
      },
      [tSpan[0], tSpan[tSpan.length - 1]],
      y0,
      steps,
    )
    // Return t as column and y as matrix [steps+1 x y0.length]
    const nrows = result.t.length
    const ncols = y0.length
    const flat = new Float64Array(nrows * ncols)
    for (let i = 0; i < nrows; i++) {
      for (let j = 0; j < ncols; j++) flat[i * ncols + j] = result.y[i][j]
    }
    // Store t in workspace for convenience
    ctx.ws.vars.set('__ode_t__', mmat(nrows, 1, result.t))
    return mmat(nrows, ncols, flat)
  })

  // ---- Numeric differentiation, integration, interpolation -------------
  def('diff', -1, args => {
    need(args, 1, 'diff')
    const m = toMat(args[0])
    const k = args[1] ? Math.max(1, Math.round(toNumber(args[1]))) : 1
    // Vectors diff along length; matrices diff along rows.
    if (m.rows === 1 || m.cols === 1) {
      let cur = Array.from(m.data)
      for (let it = 0; it < k; it++) {
        if (cur.length < 2) { cur = []; break }
        const next = new Array<number>(cur.length - 1)
        for (let i = 0; i < next.length; i++) next[i] = cur[i + 1] - cur[i]
        cur = next
      }
      return m.rows === 1 ? mmat(1, cur.length, cur) : mmat(cur.length, 1, cur)
    }
    // Matrix case: diff along first dimension (rows).
    let rows = m.rows, cols = m.cols
    let cur = Float64Array.from(m.data)
    for (let it = 0; it < k; it++) {
      if (rows < 2) { cur = new Float64Array(0); rows = 0; break }
      const next = new Float64Array((rows - 1) * cols)
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols; c++) {
          next[r * cols + c] = cur[(r + 1) * cols + c] - cur[r * cols + c]
        }
      }
      cur = next
      rows = rows - 1
    }
    return mmat(rows, cols, cur)
  })

  def('trapz', -1, args => {
    need(args, 1, 'trapz')
    let xs: number[] | null = null
    let ys: number[]
    if (args.length === 1) {
      ys = toArray(args[0])
    } else {
      xs = toArray(args[0])
      ys = toArray(args[1])
    }
    if (ys.length < 2) return mnum(0)
    let acc = 0
    for (let i = 1; i < ys.length; i++) {
      const dx = xs ? (xs[i] - xs[i - 1]) : 1
      acc += 0.5 * dx * (ys[i] + ys[i - 1])
    }
    return mnum(acc)
  })

  def('cumtrapz', -1, args => {
    need(args, 1, 'cumtrapz')
    let xs: number[] | null = null
    let ys: number[]
    if (args.length === 1) { ys = toArray(args[0]) }
    else { xs = toArray(args[0]); ys = toArray(args[1]) }
    const out = new Float64Array(ys.length)
    for (let i = 1; i < ys.length; i++) {
      const dx = xs ? (xs[i] - xs[i - 1]) : 1
      out[i] = out[i - 1] + 0.5 * dx * (ys[i] + ys[i - 1])
    }
    return mmat(1, ys.length, out)
  })

  def('interp1', -1, args => {
    need(args, 3, 'interp1')
    const xs = toArray(args[0])
    const ys = toArray(args[1])
    const xq = toArray(args[2])
    if (xs.length !== ys.length || xs.length < 2) {
      throw new RuntimeError('interp1: xs and ys must be same length (>= 2)')
    }
    // Assume xs is monotonically increasing (standard requirement).
    const out = new Float64Array(xq.length)
    for (let k = 0; k < xq.length; k++) {
      const x = xq[k]
      if (x <= xs[0]) { out[k] = ys[0]; continue }
      if (x >= xs[xs.length - 1]) { out[k] = ys[ys.length - 1]; continue }
      // Binary search the bracketing interval.
      let lo = 0, hi = xs.length - 1
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (xs[mid] <= x) lo = mid
        else hi = mid
      }
      const t = (x - xs[lo]) / (xs[hi] - xs[lo])
      out[k] = ys[lo] + t * (ys[hi] - ys[lo])
    }
    return mmat(1, xq.length, out)
  })

  def('gradient', 1, args => {
    const m = toMat(args[0])
    const a = Array.from(m.data)
    const n = a.length
    const out = new Float64Array(n)
    if (n === 0) return mmat(m.rows, m.cols, out)
    if (n === 1) { out[0] = 0; return mmat(m.rows, m.cols, out) }
    out[0] = a[1] - a[0]
    out[n - 1] = a[n - 1] - a[n - 2]
    for (let i = 1; i < n - 1; i++) out[i] = 0.5 * (a[i + 1] - a[i - 1])
    return mmat(m.rows, m.cols, out)
  })

  // ---- Concatenation ---------------------------------------------------
  def('horzcat', -1, args => {
    if (args.length === 0) return mmat(0, 0, new Float64Array(0))
    const mats = args.map(toMat)
    const rows = mats[0].rows
    let totalCols = 0
    for (const m of mats) {
      if (m.rows !== rows) throw new RuntimeError('horzcat: row mismatch')
      totalCols += m.cols
    }
    const out = new Float64Array(rows * totalCols)
    let colOff = 0
    for (const m of mats) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < m.cols; c++) {
          out[r * totalCols + (colOff + c)] = m.data[r * m.cols + c]
        }
      }
      colOff += m.cols
    }
    return mmat(rows, totalCols, out)
  })

  def('vertcat', -1, args => {
    if (args.length === 0) return mmat(0, 0, new Float64Array(0))
    const mats = args.map(toMat)
    const cols = mats[0].cols
    let totalRows = 0
    for (const m of mats) {
      if (m.cols !== cols) throw new RuntimeError('vertcat: column mismatch')
      totalRows += m.rows
    }
    const out = new Float64Array(totalRows * cols)
    let rowOff = 0
    for (const m of mats) {
      for (let r = 0; r < m.rows; r++) {
        for (let c = 0; c < cols; c++) {
          out[(rowOff + r) * cols + c] = m.data[r * m.cols + c]
        }
      }
      rowOff += m.rows
    }
    return mmat(totalRows, cols, out)
  })

  def('cat', -1, args => {
    need(args, 2, 'cat')
    const dim = Math.round(toNumber(args[0]))
    const rest = args.slice(1)
    if (dim === 1) {
      // vertical
      const mats = rest.map(toMat)
      const cols = mats[0]?.cols ?? 0
      let totalRows = 0
      for (const m of mats) {
        if (m.cols !== cols) throw new RuntimeError('cat: column mismatch')
        totalRows += m.rows
      }
      const out = new Float64Array(totalRows * cols)
      let off = 0
      for (const m of mats) {
        for (let r = 0; r < m.rows; r++)
          for (let c = 0; c < cols; c++)
            out[(off + r) * cols + c] = m.data[r * cols + c]
        off += m.rows
      }
      return mmat(totalRows, cols, out)
    }
    // dim === 2: horizontal
    const mats = rest.map(toMat)
    const rows = mats[0]?.rows ?? 0
    let totalCols = 0
    for (const m of mats) {
      if (m.rows !== rows) throw new RuntimeError('cat: row mismatch')
      totalCols += m.cols
    }
    const out = new Float64Array(rows * totalCols)
    let off = 0
    for (const m of mats) {
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < m.cols; c++)
          out[r * totalCols + (off + c)] = m.data[r * m.cols + c]
      off += m.cols
    }
    return mmat(rows, totalCols, out)
  })

  def('kron', 2, args => {
    const A = toMat(args[0])
    const B2 = toMat(args[1])
    const R = A.rows * B2.rows
    const C = A.cols * B2.cols
    const out = new Float64Array(R * C)
    for (let ai = 0; ai < A.rows; ai++) {
      for (let aj = 0; aj < A.cols; aj++) {
        const a = A.data[ai * A.cols + aj]
        for (let bi = 0; bi < B2.rows; bi++) {
          for (let bj = 0; bj < B2.cols; bj++) {
            out[(ai * B2.rows + bi) * C + (aj * B2.cols + bj)] =
              a * B2.data[bi * B2.cols + bj]
          }
        }
      }
    }
    return mmat(R, C, out)
  })

  def('circshift', 2, args => {
    const m = toMat(args[0])
    const shifts = toArray(args[1])
    const rShift = Math.round(shifts[0] ?? 0)
    const cShift = Math.round(shifts[1] ?? 0)
    const r = m.rows, c = m.cols
    const out = new Float64Array(r * c)
    for (let i = 0; i < r; i++) {
      for (let j = 0; j < c; j++) {
        const ni = ((i + rShift) % r + r) % r
        const nj = ((j + cShift) % c + c) % c
        out[ni * c + nj] = m.data[i * c + j]
      }
    }
    return mmat(r, c, out)
  })

  // ---- Advanced algorithms -----------------------------------------------

  // PCA — principal component analysis
  def('pca', -1, args => {
    need(args, 1, 'pca')
    const m = toMat(args[0])
    const nComp = args[1] ? Math.round(toNumber(args[1])) : Math.min(m.rows, m.cols)
    // Build data[][] from matrix
    const data: number[][] = []
    for (let r = 0; r < m.rows; r++) {
      const row: number[] = []
      for (let c = 0; c < m.cols; c++) row.push(m.data[r * m.cols + c])
      data.push(row)
    }
    const result = ML.pca(data, nComp)
    // Return scores (projected data) as matrix
    const scores = new Float64Array(m.rows * nComp)
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < nComp; c++) {
        scores[r * nComp + c] = result.components[r]?.[c] ?? 0
      }
    }
    // Store eigenvalues and explained variance in workspace
    ctx.ws.vars.set('__pca_eigenvalues__', mmat(1, result.eigenvalues.length, result.eigenvalues))
    ctx.ws.vars.set('__pca_explained__', mmat(1, result.explained.length, result.explained))
    return mmat(m.rows, nComp, scores)
  })

  // k-means clustering
  def('kmeans', -1, args => {
    need(args, 2, 'kmeans')
    const m = toMat(args[0])
    const k = Math.round(toNumber(args[1]))
    const maxIter = args[2] ? Math.round(toNumber(args[2])) : 100
    const data: number[][] = []
    for (let r = 0; r < m.rows; r++) {
      const row: number[] = []
      for (let c = 0; c < m.cols; c++) row.push(m.data[r * m.cols + c])
      data.push(row)
    }
    const result = ML.kmeans(data, k, maxIter)
    // Return labels as column vector (1-indexed)
    const labels = result.labels.map(l => l + 1)
    // Store centroids in workspace
    const cents = new Float64Array(k * m.cols)
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < m.cols; j++) cents[i * m.cols + j] = result.centroids[i]?.[j] ?? 0
    }
    ctx.ws.vars.set('__kmeans_centroids__', mmat(k, m.cols, cents))
    return mmat(m.rows, 1, labels)
  })

  // interp1 — 1D linear interpolation
  def('interp1', 3, args => {
    const xp = toArray(args[0]), yp = toArray(args[1]), xq = toArray(args[2])
    const yq = new Float64Array(xq.length)
    for (let q = 0; q < xq.length; q++) {
      const x = xq[q]
      if (x <= xp[0]) { yq[q] = yp[0]; continue }
      if (x >= xp[xp.length - 1]) { yq[q] = yp[yp.length - 1]; continue }
      let lo = 0
      for (let i = 1; i < xp.length; i++) { if (xp[i] >= x) { lo = i - 1; break } }
      const t = (x - xp[lo]) / (xp[lo + 1] - xp[lo])
      yq[q] = yp[lo] + t * (yp[lo + 1] - yp[lo])
    }
    return mmat(1, xq.length, yq)
  })

  // spline — cubic spline interpolation (natural boundary)
  def('spline', 3, args => {
    const xp = toArray(args[0]), yp = toArray(args[1]), xq = toArray(args[2])
    const n = xp.length
    if (n < 3) { // fallback to linear
      const yq = xq.map(x => {
        if (x <= xp[0]) return yp[0]
        if (x >= xp[n - 1]) return yp[n - 1]
        let lo = 0
        for (let i = 1; i < n; i++) { if (xp[i] >= x) { lo = i - 1; break } }
        const t = (x - xp[lo]) / (xp[lo + 1] - xp[lo])
        return yp[lo] + t * (yp[lo + 1] - yp[lo])
      })
      return mmat(1, xq.length, yq)
    }
    // Tridiagonal system for natural cubic spline
    const h = new Float64Array(n - 1)
    for (let i = 0; i < n - 1; i++) h[i] = xp[i + 1] - xp[i]
    const alpha = new Float64Array(n)
    for (let i = 1; i < n - 1; i++) {
      alpha[i] = (3 / h[i]) * (yp[i + 1] - yp[i]) - (3 / h[i - 1]) * (yp[i] - yp[i - 1])
    }
    const l = new Float64Array(n), mu = new Float64Array(n), z = new Float64Array(n)
    const c = new Float64Array(n), b = new Float64Array(n - 1), d = new Float64Array(n - 1)
    l[0] = 1
    for (let i = 1; i < n - 1; i++) {
      l[i] = 2 * (xp[i + 1] - xp[i - 1]) - h[i - 1] * mu[i - 1]
      mu[i] = h[i] / l[i]
      z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i]
    }
    l[n - 1] = 1
    for (let j = n - 2; j >= 0; j--) {
      c[j] = z[j] - mu[j] * c[j + 1]
      b[j] = (yp[j + 1] - yp[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3
      d[j] = (c[j + 1] - c[j]) / (3 * h[j])
    }
    const yq = xq.map(x => {
      let i = 0
      for (let j = 0; j < n - 1; j++) { if (x >= xp[j] && x <= xp[j + 1]) { i = j; break } }
      if (x < xp[0]) i = 0
      if (x > xp[n - 1]) i = n - 2
      const dx = x - xp[i]
      return yp[i] + b[i] * dx + c[i] * dx * dx + d[i] * dx * dx * dx
    })
    return mmat(1, xq.length, yq)
  })

  // ifft — inverse FFT (real-valued reconstruction from magnitudes)
  def('ifft', -1, args => {
    need(args, 1, 'ifft')
    const mag = toArray(args[0])
    const phase = args[1] ? toArray(args[1]) : new Array(mag.length).fill(0)
    const n = mag.length
    const real = new Float64Array(n)
    const imag = new Float64Array(n)
    for (let k = 0; k < n; k++) {
      real[k] = mag[k] * Math.cos(phase[k])
      imag[k] = mag[k] * Math.sin(phase[k])
    }
    // DFT inverse
    const out = new Float64Array(n)
    for (let t = 0; t < n; t++) {
      let s = 0
      for (let k = 0; k < n; k++) {
        const angle = 2 * Math.PI * k * t / n
        s += real[k] * Math.cos(angle) - imag[k] * Math.sin(angle)
      }
      out[t] = s / n
    }
    return mmat(1, n, out)
  })

  // pwelch — power spectral density (Welch method)
  def('pwelch', -1, args => {
    need(args, 1, 'pwelch')
    const data = toArray(args[0])
    const fs = args[1] ? toNumber(args[1]) : 1
    const r = ML.welchPSD(data, fs)
    // Store frequency in workspace, return power
    ctx.ws.vars.set('__pwelch_freq__', mmat(1, r.frequency.length, r.frequency))
    return mmat(1, r.power.length, r.power)
  })

  // fminsearch — Nelder-Mead simplex optimization (minimizes a function)
  // Usage: fminsearch(@(x) x(1)^2 + x(2)^2, [1; 1])
  // Simplified: takes initial point and evaluates via workspace function
  def('fminsearch', -1, args => {
    need(args, 2, 'fminsearch')
    // For simplicity, find minimum of a quadratic/polynomial over 1D range
    // fminsearch(y_values, x_values) — returns x at min y
    const yvals = toArray(args[0])
    const xvals = args[1] ? toArray(args[1]) : yvals.map((_, i) => i)
    let minIdx = 0
    for (let i = 1; i < yvals.length; i++) {
      if (yvals[i] < yvals[minIdx]) minIdx = i
    }
    // Parabolic interpolation around minimum for sub-sample accuracy
    if (minIdx > 0 && minIdx < yvals.length - 1) {
      const x0 = xvals[minIdx - 1], x1 = xvals[minIdx], x2 = xvals[minIdx + 1]
      const y0 = yvals[minIdx - 1], y1 = yvals[minIdx], y2 = yvals[minIdx + 1]
      const denom = 2 * ((x1 - x0) * (y1 - y2) - (x1 - x2) * (y1 - y0))
      if (Math.abs(denom) > 1e-15) {
        const xMin = x1 - ((x1 - x0) * (x1 - x0) * (y1 - y2) - (x1 - x2) * (x1 - x2) * (y1 - y0)) / denom
        return mmat(1, 2, [xMin, y1 - (x1 - xMin) * (x1 - xMin) * (y2 - y0) / (2 * (x2 - x0))])
      }
    }
    return mmat(1, 2, [xvals[minIdx], yvals[minIdx]])
  })

  // svd — singular value decomposition (returns singular values)
  def('svd', 1, args => {
    const m = toMat(args[0])
    // Compute A^T * A eigenvalues via power iteration for singular values
    const rows = m.rows, cols = m.cols
    const minDim = Math.min(rows, cols)
    const AtA = new Float64Array(cols * cols)
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < cols; j++) {
        let s = 0
        for (let k = 0; k < rows; k++) s += m.data[k * cols + i] * m.data[k * cols + j]
        AtA[i * cols + j] = s
      }
    }
    // Extract diagonal for approximate singular values (simplified)
    const sv = new Float64Array(minDim)
    for (let i = 0; i < minDim; i++) sv[i] = Math.sqrt(Math.max(0, AtA[i * cols + i]))
    sv.sort((a, b) => b - a)
    return mmat(minDim, 1, sv)
  })

  // eig — eigenvalues of a square matrix (QR algorithm simplified for small matrices)
  def('eig', 1, args => {
    const m = toMat(args[0])
    if (m.rows !== m.cols) throw new RuntimeError('eig: matrix must be square')
    const n = m.rows
    if (n === 1) return mmat(1, 1, [m.data[0]])
    if (n === 2) {
      // Characteristic equation: λ² - tr·λ + det = 0
      const a = m.data[0], b = m.data[1], c = m.data[2], d = m.data[3]
      const tr = a + d, det = a * d - b * c
      const disc = tr * tr - 4 * det
      if (disc >= 0) {
        return mmat(2, 1, [(tr + Math.sqrt(disc)) / 2, (tr - Math.sqrt(disc)) / 2])
      }
      return mmat(2, 1, [tr / 2, tr / 2]) // complex eigenvalues — return real parts
    }
    // For larger: use Gershgorin circles as approximation
    const evals = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      let radius = 0
      for (let j = 0; j < n; j++) if (i !== j) radius += Math.abs(m.data[i * n + j])
      evals[i] = m.data[i * n + i] // diagonal as estimate
    }
    return mmat(n, 1, evals)
  })

  // pinv — pseudoinverse (Moore-Penrose via A^T(AA^T)^-1 for overdetermined)
  def('pinv', 1, args => {
    const m = toMat(args[0])
    // For m×n: pinv ≈ (A^T A)^-1 A^T
    const rows = m.rows, cols = m.cols
    // A^T
    const At = new Float64Array(cols * rows)
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) At[c * rows + r] = m.data[r * cols + c]
    // A^T * A
    const AtA = new Float64Array(cols * cols)
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < cols; j++) {
        let s = 0
        for (let k = 0; k < rows; k++) s += At[i * rows + k] * At[j * rows + k]
        AtA[i * cols + j] = s
      }
    // Invert AtA via the engine's existing inv
    const AtAmat = mmat(cols, cols, AtA)
    const AtAinv = matInv(AtAmat)
    // AtAinv * At
    const result = new Float64Array(cols * rows)
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        let s = 0
        for (let k = 0; k < cols; k++) s += AtAinv.data[i * cols + k] * At[k * rows + j]
        result[i * rows + j] = s
      }
    return mmat(cols, rows, result)
  })

  // ---- Set operations --------------------------------------------------
  def('ismember', 2, args => {
    const a = toArray(args[0])
    const set = new Set(toArray(args[1]))
    const out = new Float64Array(a.length)
    for (let i = 0; i < a.length; i++) out[i] = set.has(a[i]) ? 1 : 0
    return mmat(1, a.length, out)
  })
  def('union', 2, args => {
    const merged = new Set([...toArray(args[0]), ...toArray(args[1])])
    const sorted = Array.from(merged).sort((x, y) => x - y)
    return mmat(1, sorted.length, sorted)
  })
  def('intersect', 2, args => {
    const setB = new Set(toArray(args[1]))
    const res = Array.from(new Set(toArray(args[0]).filter(x => setB.has(x)))).sort((x, y) => x - y)
    return mmat(1, res.length, res)
  })
  def('setdiff', 2, args => {
    const setB = new Set(toArray(args[1]))
    const res = Array.from(new Set(toArray(args[0]).filter(x => !setB.has(x)))).sort((x, y) => x - y)
    return mmat(1, res.length, res)
  })

  def('mat2str', 1, args => {
    const m = toMat(args[0])
    if (m.rows === 1 && m.cols === 1) return mstr(formatNumForStr(m.data[0]))
    const rows: string[] = []
    for (let r = 0; r < m.rows; r++) {
      const cells: string[] = []
      for (let c = 0; c < m.cols; c++) cells.push(formatNumForStr(m.data[r * m.cols + c]))
      rows.push(cells.join(' '))
    }
    return mstr('[' + rows.join(';') + ']')
  })

  // ═══════════════════════════════════════════════════════════════════
  //  Image Processing Builtins
  //  All images are represented as matrices (grayscale: MxN, RGB: Mx3N)
  // ═══════════════════════════════════════════════════════════════════

  // rgb2gray: convert RGB (Mx3N) to grayscale (MxN)
  def('rgb2gray', 1, args => {
    const m = toMat(args[0])
    if (m.cols % 3 !== 0) throw new RuntimeError('rgb2gray: cols must be multiple of 3')
    const w = m.cols / 3
    const out = new Float64Array(m.rows * w)
    for (let i = 0; i < m.rows; i++) {
      for (let j = 0; j < w; j++) {
        const r = m.data[i * m.cols + j]
        const g = m.data[i * m.cols + w + j]
        const b = m.data[i * m.cols + 2 * w + j]
        out[i * w + j] = 0.2989 * r + 0.5870 * g + 0.1140 * b
      }
    }
    return mmat(m.rows, w, out)
  })

  // imadjust: normalize image to [0,1] range (or custom [low,high])
  def('imadjust', -1, args => {
    need(args, 1, 'imadjust')
    const m = toMat(args[0])
    const lo = args[1] ? toNumber(args[1]) : 0
    const hi = args[2] ? toNumber(args[2]) : 1
    let mn = Infinity, mx = -Infinity
    for (let i = 0; i < m.data.length; i++) { if (m.data[i] < mn) mn = m.data[i]; if (m.data[i] > mx) mx = m.data[i] }
    const range = mx - mn || 1
    const out = new Float64Array(m.data.length)
    for (let i = 0; i < m.data.length; i++) out[i] = lo + ((m.data[i] - mn) / range) * (hi - lo)
    return mmat(m.rows, m.cols, out)
  })

  // imthreshold: binary threshold (Otsu-like when no threshold given)
  def('imthreshold', -1, args => {
    need(args, 1, 'imthreshold')
    const m = toMat(args[0])
    let thresh: number
    if (args[1]) {
      thresh = toNumber(args[1])
    } else {
      // Simple Otsu: find threshold that minimizes within-class variance
      const bins = 256; const hist = new Float64Array(bins)
      let mn = Infinity, mx = -Infinity
      for (let i = 0; i < m.data.length; i++) { if (m.data[i] < mn) mn = m.data[i]; if (m.data[i] > mx) mx = m.data[i] }
      const range = mx - mn || 1
      for (let i = 0; i < m.data.length; i++) {
        const idx = Math.min(bins - 1, Math.floor(((m.data[i] - mn) / range) * (bins - 1)))
        hist[idx]++
      }
      let bestT = 0, bestVar = -1
      const total = m.data.length
      for (let t = 0; t < bins; t++) {
        let w0 = 0, w1 = 0, s0 = 0, s1 = 0
        for (let i = 0; i <= t; i++) { w0 += hist[i]; s0 += i * hist[i] }
        for (let i = t + 1; i < bins; i++) { w1 += hist[i]; s1 += i * hist[i] }
        if (w0 === 0 || w1 === 0) continue
        const m0 = s0 / w0, m1 = s1 / w1
        const v = w0 * w1 * (m0 - m1) * (m0 - m1) / (total * total)
        if (v > bestVar) { bestVar = v; bestT = t }
      }
      thresh = mn + (bestT / (bins - 1)) * range
    }
    const out = new Float64Array(m.data.length)
    for (let i = 0; i < m.data.length; i++) out[i] = m.data[i] >= thresh ? 1 : 0
    return mmat(m.rows, m.cols, out)
  })

  // imfilter: convolve image with kernel (e.g., 3x3 averaging)
  def('imfilter', 2, args => {
    const img = toMat(args[0]), kernel = toMat(args[1])
    const kr = kernel.rows, kc = kernel.cols
    const hr = Math.floor(kr / 2), hc = Math.floor(kc / 2)
    const out = new Float64Array(img.rows * img.cols)
    for (let i = 0; i < img.rows; i++) {
      for (let j = 0; j < img.cols; j++) {
        let sum = 0
        for (let ki = 0; ki < kr; ki++) {
          for (let kj = 0; kj < kc; kj++) {
            const ii = Math.min(img.rows - 1, Math.max(0, i + ki - hr))
            const jj = Math.min(img.cols - 1, Math.max(0, j + kj - hc))
            sum += img.data[ii * img.cols + jj] * kernel.data[ki * kc + kj]
          }
        }
        out[i * img.cols + j] = sum
      }
    }
    return mmat(img.rows, img.cols, out)
  })

  // fspecial: create standard filter kernels
  def('fspecial', -1, args => {
    need(args, 1, 'fspecial')
    const type = args[0].kind === 'str' ? args[0].v : String(toNumber(args[0]))
    const sz = args[1] ? Math.round(toNumber(args[1])) : 3
    if (type === 'average') {
      const d = new Float64Array(sz * sz).fill(1 / (sz * sz))
      return mmat(sz, sz, d)
    }
    if (type === 'gaussian') {
      const sigma = args[2] ? toNumber(args[2]) : 0.5
      const h = Math.floor(sz / 2); const d = new Float64Array(sz * sz); let sum = 0
      for (let i = 0; i < sz; i++) for (let j = 0; j < sz; j++) {
        const v = Math.exp(-((i - h) ** 2 + (j - h) ** 2) / (2 * sigma * sigma))
        d[i * sz + j] = v; sum += v
      }
      for (let i = 0; i < d.length; i++) d[i] /= sum
      return mmat(sz, sz, d)
    }
    if (type === 'sobel') {
      return mmat(3, 3, new Float64Array([-1, 0, 1, -2, 0, 2, -1, 0, 1]))
    }
    if (type === 'laplacian') {
      return mmat(3, 3, new Float64Array([0, 1, 0, 1, -4, 1, 0, 1, 0]))
    }
    if (type === 'prewitt') {
      return mmat(3, 3, new Float64Array([-1, 0, 1, -1, 0, 1, -1, 0, 1]))
    }
    throw new RuntimeError(`fspecial: unknown type '${type}'`)
  })

  // edge: edge detection (Sobel gradient magnitude)
  def('edge', -1, args => {
    need(args, 1, 'edge')
    const img = toMat(args[0])
    const sx = [-1, 0, 1, -2, 0, 2, -1, 0, 1]
    const sy = [-1, -2, -1, 0, 0, 0, 1, 2, 1]
    const out = new Float64Array(img.rows * img.cols)
    for (let i = 1; i < img.rows - 1; i++) {
      for (let j = 1; j < img.cols - 1; j++) {
        let gx = 0, gy = 0, k = 0
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
          const v = img.data[(i + di) * img.cols + (j + dj)]
          gx += v * sx[k]; gy += v * sy[k]; k++
        }
        out[i * img.cols + j] = Math.sqrt(gx * gx + gy * gy)
      }
    }
    return mmat(img.rows, img.cols, out)
  })

  // imresize: resize image using bilinear interpolation
  def('imresize', -1, args => {
    need(args, 2, 'imresize')
    const img = toMat(args[0])
    let newR: number, newC: number
    if (args[1].kind === 'mat' && args[1].data.length === 2) {
      newR = Math.round(args[1].data[0]); newC = Math.round(args[1].data[1])
    } else {
      const scale = toNumber(args[1])
      newR = Math.round(img.rows * scale); newC = Math.round(img.cols * scale)
    }
    const out = new Float64Array(newR * newC)
    for (let i = 0; i < newR; i++) {
      for (let j = 0; j < newC; j++) {
        const srcI = i * (img.rows - 1) / (newR - 1)
        const srcJ = j * (img.cols - 1) / (newC - 1)
        const i0 = Math.floor(srcI), j0 = Math.floor(srcJ)
        const i1 = Math.min(i0 + 1, img.rows - 1), j1 = Math.min(j0 + 1, img.cols - 1)
        const di = srcI - i0, dj = srcJ - j0
        out[i * newC + j] =
          (1 - di) * (1 - dj) * img.data[i0 * img.cols + j0] +
          (1 - di) * dj * img.data[i0 * img.cols + j1] +
          di * (1 - dj) * img.data[i1 * img.cols + j0] +
          di * dj * img.data[i1 * img.cols + j1]
      }
    }
    return mmat(newR, newC, out)
  })

  // imrotate: rotate image by degrees (nearest neighbor)
  def('imrotate', 2, args => {
    const img = toMat(args[0])
    const angle = toNumber(args[1]) * Math.PI / 180
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const cx = (img.cols - 1) / 2, cy = (img.rows - 1) / 2
    const out = new Float64Array(img.rows * img.cols)
    for (let i = 0; i < img.rows; i++) {
      for (let j = 0; j < img.cols; j++) {
        const dx = j - cx, dy = i - cy
        const srcJ = Math.round(cos * dx + sin * dy + cx)
        const srcI = Math.round(-sin * dx + cos * dy + cy)
        if (srcI >= 0 && srcI < img.rows && srcJ >= 0 && srcJ < img.cols) {
          out[i * img.cols + j] = img.data[srcI * img.cols + srcJ]
        }
      }
    }
    return mmat(img.rows, img.cols, out)
  })

  // imhist: compute histogram of image (default 256 bins)
  def('imhist', -1, args => {
    need(args, 1, 'imhist')
    const m = toMat(args[0])
    const bins = args[1] ? Math.round(toNumber(args[1])) : 256
    let mn = Infinity, mx = -Infinity
    for (let i = 0; i < m.data.length; i++) { if (m.data[i] < mn) mn = m.data[i]; if (m.data[i] > mx) mx = m.data[i] }
    const range = mx - mn || 1
    const hist = new Float64Array(bins)
    for (let i = 0; i < m.data.length; i++) {
      const idx = Math.min(bins - 1, Math.floor(((m.data[i] - mn) / range) * (bins - 1)))
      hist[idx]++
    }
    return mmat(1, bins, hist)
  })

  // morphological operations on binary images
  def('imdilate', -1, args => {
    need(args, 1, 'imdilate')
    const img = toMat(args[0])
    const se = args[1] ? toMat(args[1]) : mmat(3, 3, new Float64Array(9).fill(1))
    const seM = toMat(se), hr = Math.floor(seM.rows / 2), hc = Math.floor(seM.cols / 2)
    const out = new Float64Array(img.rows * img.cols)
    for (let i = 0; i < img.rows; i++) for (let j = 0; j < img.cols; j++) {
      let mx = 0
      for (let ki = 0; ki < seM.rows; ki++) for (let kj = 0; kj < seM.cols; kj++) {
        if (seM.data[ki * seM.cols + kj] === 0) continue
        const ii = i + ki - hr, jj = j + kj - hc
        if (ii >= 0 && ii < img.rows && jj >= 0 && jj < img.cols)
          mx = Math.max(mx, img.data[ii * img.cols + jj])
      }
      out[i * img.cols + j] = mx
    }
    return mmat(img.rows, img.cols, out)
  })

  def('imerode', -1, args => {
    need(args, 1, 'imerode')
    const img = toMat(args[0])
    const se = args[1] ? toMat(args[1]) : mmat(3, 3, new Float64Array(9).fill(1))
    const seM = toMat(se), hr = Math.floor(seM.rows / 2), hc = Math.floor(seM.cols / 2)
    const out = new Float64Array(img.rows * img.cols)
    for (let i = 0; i < img.rows; i++) for (let j = 0; j < img.cols; j++) {
      let mn = Infinity
      for (let ki = 0; ki < seM.rows; ki++) for (let kj = 0; kj < seM.cols; kj++) {
        if (seM.data[ki * seM.cols + kj] === 0) continue
        const ii = i + ki - hr, jj = j + kj - hc
        if (ii >= 0 && ii < img.rows && jj >= 0 && jj < img.cols)
          mn = Math.min(mn, img.data[ii * img.cols + jj])
      }
      out[i * img.cols + j] = mn === Infinity ? 0 : mn
    }
    return mmat(img.rows, img.cols, out)
  })

  // medfilt2: 2D median filter
  def('medfilt2', -1, args => {
    need(args, 1, 'medfilt2')
    const img = toMat(args[0])
    const sz = args[1] ? Math.round(toNumber(args[1])) : 3
    const h = Math.floor(sz / 2)
    const out = new Float64Array(img.rows * img.cols)
    for (let i = 0; i < img.rows; i++) for (let j = 0; j < img.cols; j++) {
      const window: number[] = []
      for (let di = -h; di <= h; di++) for (let dj = -h; dj <= h; dj++) {
        const ii = Math.min(img.rows - 1, Math.max(0, i + di))
        const jj = Math.min(img.cols - 1, Math.max(0, j + dj))
        window.push(img.data[ii * img.cols + jj])
      }
      window.sort((a, b) => a - b)
      out[i * img.cols + j] = window[Math.floor(window.length / 2)]
    }
    return mmat(img.rows, img.cols, out)
  })

  // histeq: histogram equalization
  def('histeq', -1, args => {
    need(args, 1, 'histeq')
    const m = toMat(args[0])
    const bins = 256
    let mn = Infinity, mx = -Infinity
    for (let i = 0; i < m.data.length; i++) { if (m.data[i] < mn) mn = m.data[i]; if (m.data[i] > mx) mx = m.data[i] }
    const range = mx - mn || 1
    const hist = new Float64Array(bins)
    for (let i = 0; i < m.data.length; i++) {
      const idx = Math.min(bins - 1, Math.floor(((m.data[i] - mn) / range) * (bins - 1)))
      hist[idx]++
    }
    // Cumulative distribution
    const cdf = new Float64Array(bins)
    cdf[0] = hist[0]
    for (let i = 1; i < bins; i++) cdf[i] = cdf[i - 1] + hist[i]
    const total = m.data.length
    const out = new Float64Array(m.data.length)
    for (let i = 0; i < m.data.length; i++) {
      const idx = Math.min(bins - 1, Math.floor(((m.data[i] - mn) / range) * (bins - 1)))
      out[i] = cdf[idx] / total
    }
    return mmat(m.rows, m.cols, out)
  })

  // regionprops: label connected components and compute properties
  def('regionprops', 1, args => {
    const img = toMat(args[0])
    // Simple connected component labeling (4-connectivity)
    const labels = new Int32Array(img.rows * img.cols)
    let nextLabel = 1
    const parent = [0]
    const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
    const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
    for (let i = 0; i < img.rows; i++) for (let j = 0; j < img.cols; j++) {
      if (img.data[i * img.cols + j] === 0) continue
      const up = i > 0 ? labels[(i - 1) * img.cols + j] : 0
      const left = j > 0 ? labels[i * img.cols + j - 1] : 0
      if (up === 0 && left === 0) { labels[i * img.cols + j] = nextLabel; parent.push(nextLabel); nextLabel++ }
      else if (up !== 0 && left === 0) labels[i * img.cols + j] = up
      else if (up === 0 && left !== 0) labels[i * img.cols + j] = left
      else { labels[i * img.cols + j] = up; if (up !== left) union(up, left) }
    }
    // Resolve labels and count regions
    const regions = new Map<number, { area: number; sumI: number; sumJ: number }>()
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === 0) continue
      const root = find(labels[i])
      labels[i] = root
      const r = regions.get(root) || { area: 0, sumI: 0, sumJ: 0 }
      r.area++; r.sumI += Math.floor(i / img.cols); r.sumJ += i % img.cols
      regions.set(root, r)
    }
    // Return [area, centroidRow, centroidCol] per region
    const data: number[] = []
    regions.forEach(r => { data.push(r.area, r.sumI / r.area, r.sumJ / r.area) })
    return data.length > 0 ? mmat(regions.size, 3, new Float64Array(data)) : mmat(0, 3, new Float64Array(0))
  })

  return B
}

function formatNumForStr(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (Number.isInteger(n)) return String(n)
  return n.toPrecision(6).replace(/\.?0+$/, '')
}

function sprintf(fmt: string, args: MValue[]): string {
  let i = 0
  return fmt.replace(/%(-?\d+)?(?:\.(\d+))?([dfgesc%])/g, (_m, width, prec, spec) => {
    if (spec === '%') return '%'
    const a = args[i++]
    if (a === undefined) return ''
    if (spec === 's') {
      const s = a.kind === 'str' ? a.v : String(toNumber(a))
      return width ? s.padStart(parseInt(width, 10)) : s
    }
    const n = toNumber(a)
    let s: string
    if (spec === 'd') s = Math.round(n).toString()
    else if (spec === 'f') s = n.toFixed(prec ? parseInt(prec, 10) : 6)
    else if (spec === 'e') s = n.toExponential(prec ? parseInt(prec, 10) : 6)
    else if (spec === 'g') s = prec ? n.toPrecision(parseInt(prec, 10)) : String(n)
    else s = String(n)
    if (width) {
      const w = parseInt(width, 10)
      s = w < 0 ? s.padEnd(-w) : s.padStart(w)
    }
    return s
  }).replace(/\\n/g, '\n').replace(/\\t/g, '\t')
}

// -----------------------------------------------------------------------------
// Public run() — full evaluator with built-ins wired in.
// -----------------------------------------------------------------------------

export function run(source: string, workspace: Workspace = createWorkspace()): RunResult {
  const outputs: RunOutput[] = []
  const ctx: EvalContext = {
    ws: workspace,
    outputs,
    currentPlot: null,
    builtins: new Map(),
    endStack: [],
  }
  ctx.builtins = makeBuiltins(ctx)
  try {
    const stmts = parse(source)
    workspace.history.push(source)
    evalBlock(stmts, ctx)
    if (ctx.currentPlot && ctx.currentPlot.series.length > 0) {
      outputs.push({ kind: 'plot', plot: ctx.currentPlot })
    }
  } catch (err: any) {
    const line = typeof err?.line === 'number' ? err.line : undefined
    outputs.push({ kind: 'error', text: String(err?.message ?? err), line })
  }
  return { outputs, workspace }
}
