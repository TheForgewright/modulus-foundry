/**
 * Tiny, safe arithmetic evaluator for designer-editable formula settings
 * such as "5 + level" or "2 + floor(level / 4)". Pure JS, no eval.
 *
 * Supports: integers, named variables, + - * /, parentheses, unary minus,
 * and functions floor, ceil, round, min, max. Results are floored (§2.5: round down).
 */

const FUNCS = {
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max
};

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(.))/gy;
  let m;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[1] !== undefined) tokens.push({ t: "num", v: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: "id", v: m[2] });
    else if (m[3] !== undefined && m[3].trim()) tokens.push({ t: "op", v: m[3] });
  }
  return tokens;
}

export function evaluateFormula(src, vars = {}) {
  const tokens = tokenize(String(src));
  let i = 0;
  const peek = () => tokens[i];
  const take = (v) => {
    const tok = tokens[i];
    if (!tok || (v !== undefined && tok.v !== v)) throw new Error(`Formula error in "${src}": expected ${v ?? "token"}`);
    i++;
    return tok;
  };
  const expr = () => {
    let v = term();
    while (peek()?.t === "op" && "+-".includes(peek().v)) v = take().v === "+" ? v + term() : v - term();
    return v;
  };
  const term = () => {
    let v = unary();
    while (peek()?.t === "op" && "*/".includes(peek().v)) v = take().v === "*" ? v * unary() : v / unary();
    return v;
  };
  const unary = () => {
    if (peek()?.t === "op" && peek().v === "-") {
      take();
      return -unary();
    }
    return atom();
  };
  const atom = () => {
    const tok = take();
    if (tok.t === "num") return tok.v;
    if (tok.t === "op" && tok.v === "(") {
      const v = expr();
      take(")");
      return v;
    }
    if (tok.t === "id") {
      if (peek()?.v === "(") {
        const fn = FUNCS[tok.v];
        if (!fn) throw new Error(`Formula error in "${src}": unknown function ${tok.v}`);
        take("(");
        const args = [expr()];
        while (peek()?.v === ",") {
          take(",");
          args.push(expr());
        }
        take(")");
        return fn(...args);
      }
      if (!(tok.v in vars)) throw new Error(`Formula error in "${src}": unknown variable ${tok.v}`);
      return Number(vars[tok.v]);
    }
    throw new Error(`Formula error in "${src}": unexpected ${tok.v}`);
  };
  const result = expr();
  if (i !== tokens.length) throw new Error(`Formula error in "${src}": trailing input`);
  if (!Number.isFinite(result)) throw new Error(`Formula error in "${src}": not a finite number`);
  return Math.floor(result);
}
