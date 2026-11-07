// 实体注册表：别名归并与共指解析只接受明确、无歧义的匹配，歧义别名登记后保持可见。
// 刻意不做模糊匹配——猜测性合并会把两个实体捏成假事实，合并错了比缺失更难回滚。
import { createHash } from "node:crypto";
import type { ChunkAnnotation, NarrativeEntityType } from "./analysis.js";

export interface RegisteredEntity {
  id: string;
  name: string;
  type: NarrativeEntityType;
  aliases: string[];
  mentions: Array<{ chunkId: string; source: string; chapter: string; evidence: string }>;
}

export interface EntityRegistry {
  schemaVersion: 1;
  worldId: string;
  generatedAt: string;
  entities: RegisteredEntity[];
  ambiguousAliases: Array<{ alias: string; candidates: string[]; type: NarrativeEntityType }>;
  resolvedCoreferences: number;
  unresolvedCoreferences: Array<{ mention: string; refersTo: string; chunkId: string; reason: string }>;
}

function normalizeName(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\u3000·•・.。…、，,：:;；'"“”‘’()（）【】\[\]{}]/g, "");
}

/**
 * Merge entities only through explicit, unambiguous aliases that point to a
 * canonical name already observed in the corpus. No fuzzy matching or
 * pronoun-based identity guessing is performed.
 */
export function buildEntityRegistry(worldId: string, annotations: ChunkAnnotation[]): EntityRegistry {
  type Candidate = {
    key: string; name: string; type: NarrativeEntityType; aliases: string[];
    chunkId: string; source: string; chapter: string; evidence: string;
  };
  const candidates: Candidate[] = [];
  for (const annotation of annotations) {
    for (const entity of annotation.entities ?? []) {
      candidates.push({
        key: normalizeName(entity.name), name: entity.name, type: entity.type,
        aliases: (entity.aliases ?? []).filter(Boolean),
        chunkId: annotation.chunkId, source: annotation.source, chapter: annotation.chapter,
        evidence: entity.evidence
      });
    }
  }

  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const current = parent.get(key);
    if (!current) { parent.set(key, key); return key; }
    if (current === key) return key;
    const root = find(current);
    parent.set(key, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent.set(rb, ra < rb ? ra : rb), parent.set(ra, ra < rb ? ra : rb);
  };

  const namesByType = new Map<string, Set<string>>();
  const aliasClaimants = new Map<string, Set<string>>();
  for (const item of candidates) {
    const nameKey = item.type + ":" + item.key;
    find(nameKey);
    const aliases = namesByType.get(item.type) ?? new Set<string>();
    aliases.add(item.key);
    namesByType.set(item.type, aliases);
    for (const alias of item.aliases) {
      const aliasKey = normalizeName(alias);
      if (!aliasKey || aliasKey.length < 2) continue;
      const claimants = aliasClaimants.get(item.type + ":" + aliasKey) ?? new Set<string>();
      claimants.add(nameKey);
      aliasClaimants.set(item.type + ":" + aliasKey, claimants);
    }
  }

  const ambiguousAliases: EntityRegistry["ambiguousAliases"] = [];
  for (const [typedAlias, claimants] of aliasClaimants) {
    const split = typedAlias.indexOf(":");
    const type = typedAlias.slice(0, split) as NarrativeEntityType;
    const alias = typedAlias.slice(split + 1);
    const canonicalExists = namesByType.get(type)?.has(alias) ?? false;
    if (canonicalExists && claimants.size === 1) union([...claimants][0]!, type + ":" + alias);
    else if (claimants.size > 1) ambiguousAliases.push({ alias, candidates: [...claimants].sort(), type });
  }

  const groups = new Map<string, Candidate[]>();
  for (const item of candidates) {
    const root = find(item.type + ":" + item.key);
    const group = groups.get(root) ?? [];
    group.push(item);
    groups.set(root, group);
  }

  const entities: RegisteredEntity[] = [];
  const groupIds = new Map<string, string>();
  for (const [root, items] of groups) {
    const ordered = [...items].sort((a, b) =>
      a.source.localeCompare(b.source) || a.chapter.localeCompare(b.chapter) || a.chunkId.localeCompare(b.chunkId)
    );
    const first = ordered[0]!;
    const names = new Map<string, number>();
    for (const item of items) names.set(item.name, (names.get(item.name) ?? 0) + 1);
    const canonical = [...names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? first.name;
    const id = "ent_" + createHash("sha256").update(worldId + ":" + first.type + ":" + normalizeName(first.name)).digest("hex").slice(0, 16);
    groupIds.set(root, id);
    entities.push({
      id, name: canonical, type: first.type,
      aliases: [...new Set(items.flatMap(item => [item.name, ...item.aliases]).filter(name => normalizeName(name) !== normalizeName(canonical)))].sort(),
      mentions: items.map(item => ({ chunkId: item.chunkId, source: item.source, chapter: item.chapter, evidence: item.evidence }))
    });
  }

  const aliasOwners = new Map<string, Set<string>>();
  for (const entity of entities) {
    for (const name of [entity.name, ...entity.aliases]) {
      const key = entity.type + ":" + normalizeName(name);
      const owners = aliasOwners.get(key) ?? new Set<string>();
      owners.add(entity.id);
      aliasOwners.set(key, owners);
    }
  }

  let resolvedCoreferences = 0;
  const unresolvedCoreferences: EntityRegistry["unresolvedCoreferences"] = [];
  for (const annotation of annotations) {
    for (const mention of annotation.coreferences ?? []) {
      const owners = aliasOwners.get("character:" + normalizeName(mention.refersTo));
      if (owners?.size === 1) {
        mention.entityId = [...owners][0]!;
        resolvedCoreferences++;
      } else {
        unresolvedCoreferences.push({
          mention: mention.mention, refersTo: mention.refersTo, chunkId: annotation.chunkId,
          reason: owners && owners.size > 1 ? "目标别名对应多个实体" : "目标人物尚无可确认的实体记录"
        });
      }
    }
  }

  return {
    schemaVersion: 1, worldId, generatedAt: new Date().toISOString(),
    entities, ambiguousAliases, resolvedCoreferences, unresolvedCoreferences
  };
}
