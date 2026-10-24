import type { ChangeDraft, DraftEntity, Profile, Subscription, Version } from './types.js'

// 两个 SQL 存储共用字段编码，确保 CAS 比较涵盖所有行为配置与分享状态。
const columns: Record<DraftEntity, string[]> = {
  profiles: ['id', 'name', 'subscriptionIds', 'target', 'script', 'profile', 'token', 'shareDisabled', 'createdAt', 'updatedAt'],
  subscriptions: ['id', 'name', 'url', 'content', 'fetchedAt', 'userInfo', 'fetchPolicy', 'createdAt', 'updatedAt'],
  templates: ['id', 'name', 'description', 'profile', 'script', 'createdAt', 'updatedAt'],
}
const jsonFields = new Set(['subscriptionIds', 'profile', 'userInfo', 'fetchPolicy'])
export function draftValues(entity: DraftEntity, value: ChangeDraft['before']): unknown[] {
  const row = value as unknown as Record<string, unknown> | null
  return columns[entity].map((key) => key === 'shareDisabled' ? (row?.[key] ? 1 : 0) :
    row?.[key] == null ? null : jsonFields.has(key) ? JSON.stringify(row[key]) : row[key])
}

export function subscriptionUpdateStatement(expected: Subscription, next: Subscription) {
  return {
    sql: `UPDATE subscriptions SET ${columns.subscriptions.map(key => `${key} = ?`).join(',')} WHERE ${columns.subscriptions.map(key => `${key} IS ?`).join(' AND ')}`,
    values: [...draftValues('subscriptions', next), ...draftValues('subscriptions', expected)],
  }
}

export function profileUpdateStatements(expected: Profile, next: Profile, version?: Version) {
  const fields = columns.profiles
  const statements = [{
    sql: `UPDATE profiles SET ${fields.map(key => `${key} = ?`).join(',')} WHERE ${fields.map(key => `${key} IS ?`).join(' AND ')}
      AND NOT EXISTS (SELECT 1 FROM json_each(?) AS ids WHERE NOT EXISTS (SELECT 1 FROM subscriptions WHERE id = ids.value))`,
    values: [...draftValues('profiles', next), ...draftValues('profiles', expected), JSON.stringify(next.subscriptionIds)],
  }]
  if (version) statements.push({
    sql: 'INSERT INTO versions (id,entity,entityId,snapshot,note,createdAt) SELECT ?,?,?,?,?,? WHERE changes() = 1',
    values: [version.id, version.entity, version.entityId, version.snapshot, version.note ?? null, version.createdAt],
  })
  return statements
}

export function draftStatements(draft: ChangeDraft, version?: Version): { sql: string; values: unknown[] }[] {
  const fields = columns[draft.entity]
  const values: unknown[] = []
  let condition = 'EXISTS (SELECT 1 FROM kv WHERE k = ? AND v = ?)'
  values.push(`draft:${draft.id}`, JSON.stringify(draft))
  if (draft.before) {
    condition += ` AND ${fields.map((key) => `${key} IS ?`).join(' AND ')}`
    values.push(...draftValues(draft.entity, draft.before))
  } else {
    condition += ` AND NOT EXISTS (SELECT 1 FROM ${draft.entity} WHERE id = ?)`
    values.push(draft.entityId)
  }
  // 与 HTTP 删除订阅一致，并在 SQL 写入时再次检查，避免跨 isolate 的 TOCTOU。
  if (draft.entity === 'subscriptions' && !draft.after) {
    condition += ' AND NOT EXISTS (SELECT 1 FROM profiles, json_each(profiles.subscriptionIds) WHERE json_each.value = ?)'
    values.push(draft.entityId)
  }
  if (draft.entity === 'profiles' && draft.after) {
    condition += ' AND NOT EXISTS (SELECT 1 FROM json_each(?) AS ids WHERE NOT EXISTS (SELECT 1 FROM subscriptions WHERE id = ids.value))'
    values.push(JSON.stringify((draft.after as import('./types.js').Profile).subscriptionIds))
  }
  for (const source of draft.sources || []) {
    condition += ` AND EXISTS (SELECT 1 FROM subscriptions WHERE ${columns.subscriptions.map((key) => `${key} IS ?`).join(' AND ')})`
    values.push(...draftValues('subscriptions', source))
  }
  const after = draftValues(draft.entity, draft.after)
  const first = !draft.after
    ? { sql: `DELETE FROM ${draft.entity} WHERE id = ? AND ${condition}`, values: [draft.entityId, ...values] }
    : draft.before
      ? { sql: `UPDATE ${draft.entity} SET ${fields.map((key) => `${key} = ?`).join(',')} WHERE ${condition}`, values: [...after, ...values] }
      : { sql: `INSERT INTO ${draft.entity} (${fields.join(',')}) SELECT ${fields.map(() => '?').join(',')} WHERE ${condition}`, values: [...after, ...values] }
  const statements = [first]
  if (version) statements.push({
    sql: 'INSERT INTO versions (id,entity,entityId,snapshot,note,createdAt) SELECT ?,?,?,?,?,? WHERE changes() = 1',
    values: [version.id, version.entity, version.entityId, version.snapshot, version.note ?? null, version.createdAt],
  })
  statements.push({ sql: 'DELETE FROM kv WHERE k = ? AND changes() = 1', values: [`draft:${draft.id}`] })
  return statements
}
