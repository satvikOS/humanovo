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
  // String concat with +  (Octave has [a,b]; we keep '+' as numeric only and use str+str only when both strings)
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
      throw new RuntimeError('\\: matrix left-division not implemented (use .\\)')
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
  // Octave semantics: 1:5 -> 1..5; 5:-1:1 -> 5..1
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

function getIndexed(target: MValue, args: (MValue | 'colon')[]): MValue {
  const m = toMat(target)
  if (args.length === 1) {
    // Linear indexing
    const idx = resolveIndices(args[0], m.rows * m.cols)
    const out = new Float64Array(idx.length)
    // Octave/MATLAB linear index is column-major. But our data is row-major —
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
      const fn = ctx.ws.fns.get(e.name)
      if (fn) {
        // Identifier in value position with no args: if zero-arity, invoke it
        if (fn.arity === 0) return callFn(fn, [], ctx)
        return fn
      }
      throw new RuntimeError(`'${e.name}' is undefined`)
    }
    case 'end': throw new RuntimeError(`'end' used outside an indexing context`)
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
        // Functions first (user then builtin)
        const userFn = ctx.ws.fns.get(name)
        if (userFn) {
          const args = e.args.map(a => evalExpr(a, ctx))
          return callFn(userFn, args, ctx)
        }
        // If it's a variable, treat as indexing
        const vv = ctx.ws.vars.get(name)
        if (vv) {
          const args = e.args.map(a => a.type === 'colon' ? 'colon' as const : evalExpr(a, ctx))
          return getIndexed(vv, args)
        }
        throw new RuntimeError(`'${name}' is undefined`)
      }
      // Expression call: invoke anonymous function or index result
      const callee = evalExpr(e.callee, ctx)
      if (callee.kind === 'fn') {
        const args = e.args.map(a => evalExpr(a, ctx))
        return callFn(callee, args, ctx)
      }
      const args = e.args.map(a => a.type === 'colon' ? 'colon' as const : evalExpr(a, ctx))
      return getIndexed(callee, args)
    }
    case 'index': {
      const target = evalExpr(e.target, ctx)
      const args = e.args.map(a => a.type === 'colon' ? 'colon' as const : evalExpr(a, ctx))
      return getIndexed(target, args)
    }
    case 'anon': {
      const params = e.params
      const body = e.body
      // Capture snapshot of workspace vars (by reference — Octave-ish)
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
    const args = target.args.map(a => a.type === 'colon' ? 'colon' as const : evalExpr(a, ctx))
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
      // MATLAB iterates over columns
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
// Public run() — real evaluator. Built-ins land in Batch 3d.
// -----------------------------------------------------------------------------

export function run(source: string, workspace: Workspace = createWorkspace()): RunResult {
  const outputs: RunOutput[] = []
  const ctx: EvalContext = { ws: workspace, outputs, currentPlot: null }
  try {
    const stmts = parse(source)
    workspace.history.push(source)
    evalBlock(stmts, ctx)
    if (ctx.currentPlot && ctx.currentPlot.series.length > 0) {
      outputs.push({ kind: 'plot', plot: ctx.currentPlot })
    }
  } catch (err: any) {
    outputs.push({ kind: 'error', text: String(err?.message ?? err) })
  }
  return { outputs, workspace }
}
