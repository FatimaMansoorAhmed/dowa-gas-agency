import ast
import os
import re
import glob
from collections import defaultdict

ROUTERS_DIR = r"C:\Users\WINDOWS10\Desktop\dowa-gas-agency\backend\app\routers"

def unparse_msg(node):
    """Return a normalized template string for a message-argument AST node."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        # f-string: replace each formatted value with {} placeholder
        parts = []
        for v in node.values:
            if isinstance(v, ast.Constant):
                parts.append(v.value)
            elif isinstance(v, ast.FormattedValue):
                parts.append("{}")
        return "".join(parts)
    try:
        return ast.unparse(node)
    except Exception:
        return "<complex-expr>"

results = []  # (file, lineno, status_code, message_template)

for path in glob.glob(os.path.join(ROUTERS_DIR, "*.py")):
    fname = os.path.basename(path)
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()
    try:
        tree = ast.parse(src, filename=fname)
    except SyntaxError as e:
        print("SYNTAX ERROR", fname, e)
        continue
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            fn = node.func
            name = fn.id if isinstance(fn, ast.Name) else (fn.attr if isinstance(fn, ast.Attribute) else None)
            if name == "HTTPException":
                status = None
                msg_node = None
                # positional args: (status_code, detail) or (status_code,)
                pos = node.args
                for kw in node.keywords:
                    if kw.arg == "status_code":
                        status = unparse_msg(kw.value) if not (isinstance(kw.value, ast.Constant)) else kw.value.value
                    if kw.arg == "detail":
                        msg_node = kw.value
                if pos:
                    if status is None:
                        status = pos[0].value if isinstance(pos[0], ast.Constant) else unparse_msg(pos[0])
                    if len(pos) > 1 and msg_node is None:
                        msg_node = pos[1]
                if msg_node is not None:
                    template = unparse_msg(msg_node)
                else:
                    template = "<no message>"
                results.append((fname, node.lineno, status, template))

print(f"Total HTTPException calls with a message: {len(results)}")

# Normalize further: collapse whitespace, and also produce a "pattern key"
# where any remaining {} placeholders count as parameterization.
def normalize(template):
    t = re.sub(r"\s+", " ", template).strip()
    return t

by_exact = defaultdict(list)
for fname, lineno, status, template in results:
    by_exact[normalize(template)].append((fname, lineno, status))

print(f"Distinct exact (post f-string-normalized) message templates: {len(by_exact)}")

# Now group further by a "loose" signature: strip leading/trailing punctuation,
# lowercase, and collapse any {}-runs and quoted/number tokens, to catch
# near-duplicates that differ only by a literal name embedded outside {}.
def loose_key(template):
    t = normalize(template).lower()
    t = re.sub(r"\{\}", "<X>", t)
    # collapse quoted segments like 'foo' or "foo"
    t = re.sub(r"'[^']*'", "<X>", t)
    t = re.sub(r'"[^"]*"', "<X>", t)
    # collapse digit runs
    t = re.sub(r"\d+", "<N>", t)
    return t

by_loose = defaultdict(list)
for fname, lineno, status, template in results:
    by_loose[loose_key(template)].append((fname, lineno, status, template))

print(f"Distinct loose-pattern groups: {len(by_loose)}")

with open(r"C:\Users\WINDOWS10\Desktop\dowa-gas-agency\scratchpad\exceptions_report.txt", "w", encoding="utf-8") as out:
    out.write(f"Total HTTPException calls with a message: {len(results)}\n")
    out.write(f"Distinct exact templates: {len(by_exact)}\n")
    out.write(f"Distinct loose-pattern groups: {len(by_loose)}\n\n")
    out.write("=" * 80 + "\n")
    out.write("LOOSE PATTERN GROUPS (sorted by frequency desc)\n")
    out.write("=" * 80 + "\n")
    for key, items in sorted(by_loose.items(), key=lambda kv: -len(kv[1])):
        out.write(f"\n[{len(items)}x] KEY: {key}\n")
        seen_exact = set()
        for fname, lineno, status, template in items:
            if template not in seen_exact:
                out.write(f"    e.g. ({fname}:{lineno}, {status}): {template!r}\n")
                seen_exact.add(template)

print("Wrote detailed report to exceptions_report.txt")
