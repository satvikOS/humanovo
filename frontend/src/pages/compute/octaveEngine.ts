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
// Placeholder run() — will be replaced in Batch 3b/3c with a real evaluator.
// Kept here so the rest of the UI can begin wiring against a stable API.
// -----------------------------------------------------------------------------

export function run(source: string, workspace: Workspace = createWorkspace()): RunResult {
  try {
    const tokens = tokenize(source)
    workspace.history.push(source)
    return {
      outputs: [{
        kind: 'text',
        text: `[engine] tokenized ${tokens.length - 1} tokens — parser arriving in next batch`,
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
