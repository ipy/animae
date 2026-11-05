import type { EngineState } from "../state.ts";
import type { WorldTime } from "../types.ts";
import { worldMinutes } from "../timeline/time.ts";
import type { ResolvedPolicy } from "../schema/policy.ts";
import { customViewerMap, introspectKernelForEval, viewerInheritanceChain } from "./custom-viewers.ts";

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

function viewerRuleChain(viewer: string): string[] {
  const k = introspectKernelForEval();
  const defs = k ? customViewerMap(k) : undefined;
  return viewerInheritanceChain(viewer, defs);
}

function ruleMatchesViewer(ruleViewer: string, chain: string[]): boolean {
  return chain.some((v) => globMatch(ruleViewer, v));
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
  const chain = viewerRuleChain(viewer);
  let matched: boolean | undefined;
  for (const rule of policy.visibility.rules) {
    if (!ruleMatchesViewer(rule.viewer, chain)) continue;
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
  const chain = viewerRuleChain(viewer);
  let matchedKinds: string[] | undefined;
  for (const rule of policy.visibility.rules) {
    if (!ruleMatchesViewer(rule.viewer, chain)) continue;
    if (!globMatch(rule.path, "events")) continue;
    if (rule.kinds) matchedKinds = rule.kinds;
  }
  if (!matchedKinds?.length) return true;
  return matchedKinds.some((g) => globMatch(g, eventKind));
}

/**
 * Visibility paths of a narration event, most general first: `events/narration` for every paragraph and
 * `events/narration/style:scene_break` additionally for scene breaks. A rule on one of them narrows what the
 * `events` rule lets a viewer see; it never widens it.
 */
export function narrationVisibilityPaths(style: string | undefined): string[] {
  return style === "scene_break" ? ["events/narration", "events/narration/style:scene_break"] : ["events/narration"];
}

/**
 * True when a rule that matches exactly `path` denies it and no active grant covers it. Queries use this to let an
 * explicit deny on a child path beat an allow on its parent (`characters/<id>`, `world/locations`); a path that no
 * rule mentions is not "explicitly denied" and simply inherits the parent's decision.
 */
export function explicitlyDenied(
  policy: ResolvedPolicy,
  viewer: string,
  path: string,
  grants: EngineState["grants"],
  now: WorldTime,
): boolean {
  if (viewer === "debug") return false;
  if (grantActive(grants, viewer, path, now)) return false;
  return deniedByPathRule(policy, viewer, path);
}

function deniedByPathRule(policy: ResolvedPolicy, viewer: string, path: string): boolean {
  const chain = viewerRuleChain(viewer);
  let matched: boolean | undefined;
  for (const rule of policy.visibility.rules) {
    if (!ruleMatchesViewer(rule.viewer, chain)) continue;
    if (!globMatch(rule.path, path)) continue;
    matched = rule.allow;
  }
  return matched === false;
}

/** Whether `viewer` may see this event: its kind is allowed and, for narration, no path rule hides it. */
export function eventVisible(
  policy: ResolvedPolicy,
  viewer: string,
  event: { kind: string; style?: string },
  grants: EngineState["grants"],
  now: WorldTime,
): boolean {
  if (viewer === "debug") return true;
  if (!eventKindAllowed(policy, viewer, event.kind, grants, now)) return false;
  if (event.kind !== "narration") return true;
  for (const path of narrationVisibilityPaths(event.style)) {
    if (deniedByPathRule(policy, viewer, path) && !grantActive(grants, viewer, path, now)) return false;
  }
  return true;
}
