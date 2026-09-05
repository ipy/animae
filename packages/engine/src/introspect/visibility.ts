import type { EngineState } from "../state.ts";
import type { WorldTime } from "../types.ts";
import { worldMinutes } from "../timeline/time.ts";
import type { ResolvedPolicy } from "../schema/policy.ts";

export function globMatch(pattern: string, value: string): boolean {
  if (pattern === value) return true;
  if (pattern === "*") return true;
  const re = globToRegExp(pattern);
  return re.test(value);
}

function globToRegExp(glob: string): RegExp {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += "[^/]+";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += ".";
    } else if (/[+^${}()|[\]\\.]/.test(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re);
}

function grantStillActive(g: { expiresAt?: WorldTime }, now: WorldTime): boolean {
  if (!g.expiresAt) return true;
  return worldMinutes(now) <= worldMinutes(g.expiresAt);
}

export function grantActive(grants: EngineState["grants"], viewer: string, path: string, now: WorldTime): boolean {
  for (const g of grants) {
    if (!grantStillActive(g, now)) continue;
    if (g.viewer !== viewer && !globMatch(g.viewer, viewer)) continue;
    if (!globMatch(g.path, path)) continue;
    return true;
  }
  return false;
}

export function evaluateVisibility(
  policy: ResolvedPolicy,
  viewer: string,
  path: string,
  grants: EngineState["grants"],
  now: WorldTime,
): boolean {
  if (viewer === "debug") return true;
  if (grantActive(grants, viewer, path, now)) return true;
  let matched: boolean | undefined;
  for (const rule of policy.visibility.rules) {
    if (!globMatch(rule.viewer, viewer)) continue;
    if (!globMatch(rule.path, path)) continue;
    matched = rule.allow;
  }
  return matched === true;
}

export function eventKindAllowed(
  policy: ResolvedPolicy,
  viewer: string,
  eventKind: string,
  grants: EngineState["grants"],
  now: WorldTime,
): boolean {
  if (viewer === "debug") return true;
  if (!evaluateVisibility(policy, viewer, "events", grants, now)) return false;
  let matchedKinds: string[] | undefined;
  for (const rule of policy.visibility.rules) {
    if (!globMatch(rule.viewer, viewer)) continue;
    if (!globMatch(rule.path, "events")) continue;
    if (rule.kinds) matchedKinds = rule.kinds;
  }
  if (!matchedKinds?.length) return true;
  return matchedKinds.some((g) => globMatch(g, eventKind));
}
