/**
 * No-eval replacement for godot_js_eval.
 *
 * WeChat Mini Games disable eval() and new Function(). This bridge
 * evaluates a small subset of JS expressions using string manipulation
 * and property access only — no dynamic code execution.
 *
 * Supported forms:
 *   "path.to.fn(...args)"          → function call
 *   "path.to.prop"                 → property access
 *   "typeof path.to.thing"         → typeof check
 *   "expr === val" / "expr !== val"→ strict comparison
 *   "expr == val" / "expr != val"  → loose comparison
 *   "a && b" / "a || b"            → logical and/or
 *   "!expr"                        → negation
 *   "( ... )"                      → grouping
 */

function __godotEvalParseLiteral(str) {
    str = str.trim();
    if (str === "null") return null;
    if (str === "true") return true;
    if (str === "false") return false;
    if (str === "undefined") return undefined;
    if (/^-?\d+(\.\d+)?$/.test(str)) return Number(str);
    if (
        (str.startsWith("'") && str.endsWith("'")) ||
        (str.startsWith('"') && str.endsWith('"'))
    ) {
        return str.slice(1, -1);
    }
    if (
        (str.startsWith("{") && str.endsWith("}")) ||
        (str.startsWith("[") && str.endsWith("]"))
    ) {
        try { return JSON.parse(str); } catch (_) { /* raw */ }
    }
    return str;
}

function __godotEvalSplitArgs(argsStr) {
    if (!argsStr.trim()) return [];
    const args = [];
    let depth = 0, current = "", inString = false, stringChar = "";
    for (const ch of argsStr) {
        if (inString) {
            current += ch;
            if (ch === stringChar) inString = false;
            continue;
        }
        if (ch === "'" || ch === '"') { inString = true; stringChar = ch; current += ch; continue; }
        if (ch === "(" || ch === "{" || ch === "[") { depth++; current += ch; continue; }
        if (ch === ")" || ch === "}" || ch === "]") { depth--; current += ch; continue; }
        if (ch === "," && depth === 0) { args.push(__godotEvalParseLiteral(current)); current = ""; continue; }
        current += ch;
    }
    if (current.trim()) args.push(__godotEvalParseLiteral(current));
    return args;
}

function __godotEvalSplitBy(expr, sep) {
    const parts = [];
    let depth = 0, current = "", inString = false, stringChar = "";
    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i];
        if (inString) {
            current += ch;
            if (ch === stringChar) inString = false;
            continue;
        }
        if (ch === "'" || ch === '"') { inString = true; stringChar = ch; current += ch; continue; }
        if (ch === "(") { depth++; current += ch; continue; }
        if (ch === ")") { depth--; current += ch; continue; }
        if (depth === 0 && expr.slice(i, i + sep.length) === sep) {
            parts.push(current);
            current = "";
            i += sep.length - 1;
            continue;
        }
        current += ch;
    }
    parts.push(current);
    return parts;
}

function __godotEvalRoot() {
    return typeof window !== "undefined" ? window : globalThis;
}

function __godotEvalResolve(pathStr) {
    const path = pathStr.trim().split(".");
    let obj = __godotEvalRoot();
    for (const key of path) {
        if (obj == null) return undefined;
        obj = obj[key];
    }
    return obj;
}

function __godotEvalAtom(expr) {
    expr = expr.trim();

    if (expr.startsWith("(") && expr.endsWith(")")) {
        return __godotEvalExpr(expr.slice(1, -1).trim());
    }

    if (/^typeof[\s(]/.test(expr)) {
        let inner = expr.slice(6).trim();
        if (inner.startsWith("(") && inner.endsWith(")")) {
            inner = inner.slice(1, -1).trim();
        }
        if (/^([$\w][$\w.]*)$/.test(inner)) {
            return typeof __godotEvalResolve(inner);
        }
        return typeof __godotEvalExpr(inner);
    }

    if (expr.startsWith("!")) {
        return !__godotEvalAtom(expr.slice(1).trim());
    }

    if (
        expr === "null" || expr === "true" || expr === "false" ||
        expr === "undefined" || /^-?\d+(\.\d+)?$/.test(expr) ||
        (expr.startsWith("'") && expr.endsWith("'")) ||
        (expr.startsWith('"') && expr.endsWith('"'))
    ) {
        return __godotEvalParseLiteral(expr);
    }

    const callRe = /^([$\w][$\w.]*)\(([\s\S]*)\)$/;
    const callMatch = expr.match(callRe);
    if (callMatch) {
        const pathParts = callMatch[1].split(".");
        const argsRaw = callMatch[2];
        let obj = __godotEvalRoot();
        for (let i = 0; i < pathParts.length - 1; i++) {
            if (obj == null) return null;
            obj = obj[pathParts[i]];
        }
        const fn = obj != null ? obj[pathParts[pathParts.length - 1]] : undefined;
        if (typeof fn !== "function") return null;
        const args = __godotEvalSplitArgs(argsRaw);
        return fn.apply(obj, args);
    }

    const propRe = /^([$\w][$\w.]*)$/;
    const propMatch = expr.match(propRe);
    if (propMatch) {
        return __godotEvalResolve(propMatch[1]);
    }

    return null;
}

function __godotEvalComparison(expr) {
    for (const op of ["!==", "===", "!=", "=="]) {
        const parts = __godotEvalSplitBy(expr, op);
        if (parts.length > 1) {
            const left = __godotEvalComparison(parts[0]);
            const right = __godotEvalComparison(parts.slice(1).join(op));
            switch (op) {
                case "!==": return left !== right;
                case "===": return left === right;
                case "!=":  return left != right;
                case "==":  return left == right;
            }
        }
    }
    return __godotEvalAtom(expr);
}

function __godotEvalAnd(expr) {
    const parts = __godotEvalSplitBy(expr, "&&");
    if (parts.length > 1) {
        for (let i = 0; i < parts.length; i++) {
            const val = __godotEvalComparison(parts[i]);
            if (!val || i === parts.length - 1) return val;
        }
    }
    return __godotEvalComparison(expr);
}

function __godotEvalOr(expr) {
    const parts = __godotEvalSplitBy(expr, "||");
    if (parts.length > 1) {
        for (let i = 0; i < parts.length; i++) {
            const val = __godotEvalAnd(parts[i]);
            if (val || i === parts.length - 1) return val;
        }
    }
    return __godotEvalAnd(expr);
}

function __godotEvalExpr(expr) {
    return __godotEvalOr(expr.trim());
}

function __godotEval(code) {
    if (typeof code !== "string") return null;
    return __godotEvalExpr(code);
}

globalThis.__godotEval = __godotEval;
