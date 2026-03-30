import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_LICENSES = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'Python-2.0',
  'WTFPL',
  'Zlib',
]);

const REVIEWED_PACKAGE_RULES = [
  {
    matches: (name) => name === 'ffmpeg-static',
    allows: (license) => license === 'GPL-3.0-or-later',
    reason:
      'Development-only FFmpeg fallback. It is no longer bundled in release artifacts, but upgrades still require review.',
  },
  {
    matches: (name) => name === 'lightningcss' || name.startsWith('lightningcss-'),
    allows: (license) => license === 'MPL-2.0',
    reason: 'Build-time CSS tooling pulled in by Vite/Tailwind.',
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeLicense(pkg) {
  if (typeof pkg.license === 'string' && pkg.license.trim()) {
    return pkg.license.trim();
  }

  if (pkg.license && typeof pkg.license === 'object' && typeof pkg.license.type === 'string') {
    return pkg.license.type.trim();
  }

  if (Array.isArray(pkg.licenses)) {
    const types = pkg.licenses
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry.trim();
        }
        if (entry && typeof entry.type === 'string') {
          return entry.type.trim();
        }
        return null;
      })
      .filter(Boolean);

    if (types.length === 1) {
      return types[0];
    }

    if (types.length > 1) {
      return types.join(' OR ');
    }
  }

  return 'UNKNOWN';
}

function trimOuterParens(input) {
  let value = input.trim();

  while (value.startsWith('(') && value.endsWith(')')) {
    let depth = 0;
    let balanced = true;
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (depth === 0 && index < value.length - 1) {
        balanced = false;
        break;
      }
      if (depth < 0) {
        balanced = false;
        break;
      }
    }

    if (!balanced) {
      break;
    }

    value = value.slice(1, -1).trim();
  }

  return value;
}

function splitTopLevel(input, separator) {
  const parts = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;

    if (depth === 0 && input.startsWith(separator, index)) {
      parts.push(input.slice(start, index).trim());
      start = index + separator.length;
      index += separator.length - 1;
    }
  }

  if (start === 0) {
    return [input.trim()];
  }

  parts.push(input.slice(start).trim());
  return parts;
}

function evaluateLicenseExpression(expression, packageName) {
  const normalized = trimOuterParens(expression);

  if (!normalized) {
    return { status: 'issue', license: 'UNKNOWN' };
  }

  const orParts = splitTopLevel(normalized, ' OR ');
  if (orParts.length > 1) {
    const results = orParts.map((part) => evaluateLicenseExpression(part, packageName));
    const allowed = results.find((result) => result.status === 'allowed');
    if (allowed) {
      return allowed;
    }
    const reviewed = results.find((result) => result.status === 'reviewed');
    if (reviewed) {
      return reviewed;
    }
    return { status: 'issue', license: normalized };
  }

  const andParts = splitTopLevel(normalized, ' AND ');
  if (andParts.length > 1) {
    const results = andParts.map((part) => evaluateLicenseExpression(part, packageName));
    if (results.some((result) => result.status === 'issue')) {
      return { status: 'issue', license: normalized };
    }
    const reviewed = results.find((result) => result.status === 'reviewed');
    if (reviewed) {
      return reviewed;
    }
    return { status: 'allowed', license: normalized };
  }

  if (ALLOWED_LICENSES.has(normalized)) {
    return { status: 'allowed', license: normalized };
  }

  const reviewedRule = REVIEWED_PACKAGE_RULES.find(
    (rule) => rule.matches(packageName) && rule.allows(normalized)
  );
  if (reviewedRule) {
    return { status: 'reviewed', license: normalized, reason: reviewedRule.reason };
  }

  return { status: 'issue', license: normalized };
}

function collectPackages(nodeModulesDir) {
  const seen = new Set();
  const packages = [];

  function visitDirectory(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.bin') {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.name.startsWith('@')) {
        visitDirectory(fullPath);
        continue;
      }

      const packageJsonPath = path.join(fullPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const pkg = readJson(packageJsonPath);
        const key = `${pkg.name}@${pkg.version}`;
        if (!seen.has(key)) {
          seen.add(key);
          packages.push({
            name: pkg.name,
            version: pkg.version,
            license: normalizeLicense(pkg),
          });
        }
      }

      const nestedNodeModules = path.join(fullPath, 'node_modules');
      if (fs.existsSync(nestedNodeModules)) {
        visitDirectory(nestedNodeModules);
      }
    }
  }

  visitDirectory(nodeModulesDir);
  return packages.sort((left, right) => left.name.localeCompare(right.name));
}

function formatPackage(pkg) {
  return `${pkg.name}@${pkg.version} (${pkg.license})`;
}

function main() {
  const nodeModulesDir = path.join(process.cwd(), 'node_modules');

  if (!fs.existsSync(nodeModulesDir)) {
    console.error('[audit-licenses] node_modules not found. Run `npm ci` first.');
    process.exit(1);
  }

  const packages = collectPackages(nodeModulesDir);
  const counts = new Map();
  const reviewed = [];
  const issues = [];

  for (const pkg of packages) {
    counts.set(pkg.license, (counts.get(pkg.license) || 0) + 1);
    const evaluation = evaluateLicenseExpression(pkg.license, pkg.name);
    if (evaluation.status === 'reviewed') {
      reviewed.push({ ...pkg, reason: evaluation.reason });
      continue;
    }
    if (evaluation.status === 'issue') {
      issues.push(pkg);
    }
  }

  console.log(`[audit-licenses] Scanned ${packages.length} installed packages.`);

  console.log('[audit-licenses] License summary:');
  for (const [license, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3, ' ')}  ${license}`);
  }

  if (reviewed.length > 0) {
    console.log('[audit-licenses] Reviewed exceptions:');
    for (const pkg of reviewed) {
      console.log(`  - ${formatPackage(pkg)}: ${pkg.reason}`);
    }
  }

  if (issues.length > 0) {
    console.error('[audit-licenses] Unreviewed license entries found:');
    for (const pkg of issues) {
      console.error(`  - ${formatPackage(pkg)}`);
    }
    process.exit(1);
  }

  console.log('[audit-licenses] All installed package licenses are allowed or reviewed.');
}

main();
