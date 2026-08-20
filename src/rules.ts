export type Severity = "high" | "medium" | "low";
export type Finding = {
  ruleId: string;
  severity: Severity;
  title: string;
  detail: string;
  file: string;
};

type PathMap = Map<string, Set<string>>;

function collectPaths(spec: unknown, out: PathMap, prefix = ""): void {
  if (!spec || typeof spec !== "object") return;
  const obj = spec as Record<string, unknown>;
  if (obj.paths && typeof obj.paths === "object") {
    for (const [p, methods] of Object.entries(obj.paths as Record<string, unknown>)) {
      const key = p;
      if (!out.has(key)) out.set(key, new Set());
      if (methods && typeof methods === "object") {
        for (const m of Object.keys(methods as object)) {
          if (["get", "post", "put", "patch", "delete", "head", "options", "trace"].includes(m.toLowerCase())) {
            out.get(key)!.add(m.toLowerCase());
          }
        }
      }
    }
  }
  // OpenAPI 2 swagger paths already handled; nested components ignored for v0.1
  void prefix;
}

export function parseSpec(text: string): unknown {
  const t = text.trim();
  if (t.startsWith("{")) return JSON.parse(t);
  // minimal YAML path extractor without full yaml parser
  const paths: Record<string, Record<string, unknown>> = {};
  let currentPath: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const pathMatch = line.match(/^ {2}(\/[^:]*):\s*$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      paths[currentPath] = {};
      continue;
    }
    const methodMatch = line.match(/^ {4}(get|post|put|patch|delete|head|options|trace):\s*$/i);
    if (methodMatch && currentPath) {
      paths[currentPath][methodMatch[1].toLowerCase()] = {};
    }
  }
  if (Object.keys(paths).length) return { paths };
  throw new Error("Could not parse OpenAPI/Swagger (need JSON or simple YAML paths)");
}

export function diffSpecs(baseText: string, headText: string, file: string): Finding[] {
  const baseMap: PathMap = new Map();
  const headMap: PathMap = new Map();
  collectPaths(parseSpec(baseText), baseMap);
  collectPaths(parseSpec(headText), headMap);
  const findings: Finding[] = [];

  for (const [path, methods] of baseMap) {
    if (!headMap.has(path)) {
      findings.push({
        ruleId: "path-removed",
        severity: "high",
        title: `Removed path ${path}`,
        detail: "Removing an API path is a breaking change for clients.",
        file,
      });
      continue;
    }
    const headMethods = headMap.get(path)!;
    for (const m of methods) {
      if (!headMethods.has(m)) {
        findings.push({
          ruleId: "method-removed",
          severity: "high",
          title: `Removed ${m.toUpperCase()} ${path}`,
          detail: "Removing an HTTP method is a breaking change.",
          file,
        });
      }
    }
  }
  return findings;
}

export function detectSpecPath(files: string[]): string | null {
  const candidates = [
    "openapi.yaml",
    "openapi.yml",
    "openapi.json",
    "swagger.yaml",
    "swagger.yml",
    "swagger.json",
    "docs/openapi.yaml",
    "docs/swagger.json",
  ];
  for (const c of candidates) {
    if (files.includes(c) || files.some((f) => f.endsWith("/" + c) || f === c)) {
      const hit = files.find((f) => f === c || f.endsWith("/" + c));
      if (hit) return hit;
    }
  }
  return files.find((f) => /openapi|swagger/i.test(f) && /\.(ya?ml|json)$/i.test(f)) || null;
}
