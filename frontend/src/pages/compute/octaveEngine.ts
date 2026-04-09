// Humanovo in-browser Octave/MATLAB-compatible interpreter.
// Batch 3a: core types + tokenizer.
// This file is being built incrementally. The parser and evaluator live
// beside these types and will be filled in over subsequent commits.

// -----------------------------------------------------------------------------
// Values
// -----------------------------------------------------------------------------

/** Runtime value tag. */
export type MKind = 'num' | 'mat' | 'str' | 'bool' | 'fn' | 'void'

/** A scalar number. In MATLAB-land scalars are technically 1x1 matrices,
 *  but we keep a fast path to avoid allocation churn. */
export interface MNum { kind: 'num'; v: number }

/** Row-major real matrix. `data.length === rows * cols`. */
export interface MMat { kind: 'mat'; rows: number; cols: number; data: Float64Array }

/** Character row vector (Octave strings are rows of chars). */
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

/** Tokenize Octave/MATLAB source. Produces a stream ending in an 'eof' token.
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
}

export interface PlotSpec {
  title?: string
  xLabel?: string
  yLabel?: string
  series: { name: string; x: number[]; y: number[]; type: 'line' | 'scatter' | 'bar' }[]
}

export interface RunResult {
  outputs: RunOutput[]
  workspace: Workspace
}

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
  private eat(type: TokType): Token | null {
    if (this.peek().type === type) return this.toks[this.i++]
    return null
  }
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
    this.match('end', 'endfunction') // optional in Octave scripts
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
      const exp = this.parseUnary() // right-assoc, allows -2^3 = -(2^3) per MATLAB
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
// Placeholder run() — will be replaced in Batch 3c with a real evaluator.
// Kept here so the rest of the UI can begin wiring against a stable API.
// -----------------------------------------------------------------------------

export function run(source: string, workspace: Workspace = createWorkspace()): RunResult {
  try {
    const stmts = parse(source)
    workspace.history.push(source)
    return {
      outputs: [{
        kind: 'text',
        text: `[engine] parsed ${stmts.length} statement(s) — evaluator arriving in next batch`,
      }],
      workspace,
    }
  } catch (err: any) {
    return {
      outputs: [{ kind: 'error', text: String(err?.message ?? err) }],
      workspace,
    }
  }
}
