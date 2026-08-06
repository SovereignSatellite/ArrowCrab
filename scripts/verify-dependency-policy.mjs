import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

function readJson(fileName) {
  return JSON.parse(readFileSync(join(repositoryRoot, fileName), "utf8"));
}

function hashFile(fileName) {
  return createHash("sha256")
    .update(readFileSync(join(repositoryRoot, fileName)))
    .digest("hex");
}

function normalize(value) {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }

  return value;
}

function equal(left, right) {
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function reportMismatch(label, expected, actual) {
  console.error(`Dependency policy mismatch: ${label}`);
  console.error(`Expected: ${JSON.stringify(expected)}`);
  console.error(`Actual:   ${JSON.stringify(actual)}`);
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const policy = readJson(".dependency-policy.json");
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
];
const actualDependencySections = Object.fromEntries(
  dependencyFields.map((field) => [field, packageJson[field] ?? {}]),
);
const lockfileSha256 = hashFile("package-lock.json");
const npmrcSha256 = hashFile(".npmrc");
const lockfileRootDependencies = packageLock.packages?.[""]?.dependencies ?? {};
const mismatches = [];

if (!equal(policy.dependencySections, actualDependencySections)) {
  reportMismatch(
    "package.json dependency sections changed without an approved policy update",
    policy.dependencySections,
    actualDependencySections,
  );
  mismatches.push("package.json dependency sections");
}

if (packageLock.lockfileVersion !== 3) {
  reportMismatch(
    "package-lock.json lockfileVersion",
    3,
    packageLock.lockfileVersion,
  );
  mismatches.push("lockfileVersion");
}

if (!equal(lockfileRootDependencies, actualDependencySections.dependencies)) {
  reportMismatch(
    "package-lock.json root dependencies do not match package.json",
    actualDependencySections.dependencies,
    lockfileRootDependencies,
  );
  mismatches.push("root dependency synchronization");
}

if (lockfileSha256 !== policy.lockfileSha256) {
  reportMismatch(
    "package-lock.json changed without an approved policy update",
    policy.lockfileSha256,
    lockfileSha256,
  );
  mismatches.push("lockfile hash");
}

if (npmrcSha256 !== policy.npmrcSha256) {
  reportMismatch(
    ".npmrc changed without an approved policy update",
    policy.npmrcSha256,
    npmrcSha256,
  );
  mismatches.push("npm configuration hash");
}

if (mismatches.length > 0) {
  console.error(
    "Dependency changes must be explicitly approved. Update the manifest and lockfile together, refresh the policy snapshot, and rerun this check.",
  );
  process.exitCode = 1;
} else {
  console.log(
    "Dependency policy verified: manifest and lockfile match the approved snapshot.",
  );
}
