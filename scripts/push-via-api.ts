// 通过 GitHub REST API 推送本地提交（备用通路：github.com:443 不可用时，api.github.com 直连可用）。
// 关键点：用与本地完全一致的 tree/parent/author/committer/message 重建提交 → API 返回相同 SHA，
// 因此推送后本地与远程仍是 fast-forward，后续 `git push` 不受影响。
// 踩过的坑（都已在下方注释标明）：
//   1) 日期必须保留原始时区偏移（+08:00 而非 Z），否则 commit SHA 不同；
//   2) message 必须保留结尾换行，否则 SHA 不同；
//   3) 已上传但未更新 ref 的提交，其 tree 已在远端存在，可直接引用。
// 用法：node --import tsx/esm scripts/push-via-api.ts [commit...]
import { execFileSync } from 'node:child_process'

const REPO = 'cheng200606/meta-tuning-engine'
const API = 'https://api.github.com'

function git(args: string[], encoding: 'utf8' | 'buffer' = 'utf8'): string | Buffer {
  return execFileSync('git', args, { encoding: encoding as BufferEncoding, maxBuffer: 64 * 1024 * 1024 })
}
const gitText = (args: string[]): string => git(args, 'utf8') as string

// 凭据（不回显）
const cred = execFileSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
}).split('\n')
const token = cred.find((l) => l.startsWith('password='))?.slice('password='.length).trim()
if (!token) throw new Error('no credential found')

async function api(path: string, method: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'meta-tuning-engine-push',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: unknown = undefined
  try { json = text.length > 0 ? JSON.parse(text) : undefined } catch { json = text }
  return { status: res.status, json }
}

interface CommitInfo {
  sha: string
  tree: string
  parents: string[]
  author: { name: string; email: string; date: string }
  committer: { name: string; email: string; date: string }
  message: string
}

/** epoch + 原始偏移 → ISO8601（保留偏移，如 2026-11-19T16:32:12+08:00；必须保留偏移否则 SHA 不一致）。 */
function isoWithOffset(ts: string, tz: string): string {
  const sign = tz[0] === '+' ? 1 : -1
  const offMin = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)))
  const d = new Date((Number(ts) + offMin * 60) * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  const tzo = `${tz.slice(0, 3)}:${tz.slice(3)}`
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}${tzo}`
}

function readCommit(sha: string): CommitInfo {
  const raw = gitText(['cat-file', 'commit', sha])
  const headerEnd = raw.indexOf('\n\n')
  const header = raw.slice(0, headerEnd)
  const message = raw.slice(headerEnd + 2) // 保留结尾换行
  const tree = /tree ([0-9a-f]{40})/.exec(header)?.[1] ?? ''
  const parents = [...header.matchAll(/parent ([0-9a-f]{40})/g)].map((m) => m[1])
  const a = /author (.*) <(.*)> (\d+) ([+-]\d{4})/.exec(header)
  const c = /committer (.*) <(.*)> (\d+) ([+-]\d{4})/.exec(header)
  if (a === null || c === null) throw new Error(`cannot parse commit ${sha}`)
  return {
    sha, tree, parents, message,
    author: { name: a[1], email: a[2], date: isoWithOffset(a[3], a[4]) },
    committer: { name: c[1], email: c[2], date: isoWithOffset(c[3], c[4]) },
  }
}

async function ensureBlob(blobSha: string): Promise<void> {
  const check = await api(`/repos/${REPO}/git/blobs/${blobSha}`, 'GET')
  if (check.status === 200) return
  const content = git(['cat-file', 'blob', blobSha], 'buffer') as Buffer
  const res = await api(`/repos/${REPO}/git/blobs`, 'POST', { content: content.toString('base64'), encoding: 'base64' })
  if (res.status !== 201 && res.status !== 422) throw new Error(`blob ${blobSha} failed: ${res.status}`)
}

async function ensureTree(sha: string, info: CommitInfo): Promise<string> {
  const check = await api(`/repos/${REPO}/git/trees/${info.tree}`, 'GET')
  if (check.status === 200) return info.tree // 之前 push 已上传对象，tree 已在远端
  const parentTree = gitText(['rev-parse', `${info.parents[0]}^{tree}`]).trim()
  const changes = gitText(['diff-tree', '-r', '--no-commit-id', '--name-status', '-M', sha]).split('\n').filter((l) => l.length > 0)
  const entries: Array<{ path: string; mode: string; type: 'blob'; sha: string | null }> = []
  for (const line of changes) {
    const [status, ...rest] = line.split('\t')
    if (status.startsWith('D')) {
      const path = rest[rest.length - 1]
      const mode = gitText(['ls-tree', info.parents[0], '--', path]).trim().split(/\s+/)[0] || '100644'
      entries.push({ path, mode, type: 'blob', sha: null })
      continue
    }
    if (status.startsWith('R')) {
      const [oldPath, newPath] = rest
      const oldMode = gitText(['ls-tree', info.parents[0], '--', oldPath]).trim().split(/\s+/)[0] || '100644'
      entries.push({ path: oldPath, mode: oldMode, type: 'blob', sha: null })
      const newMode = gitText(['ls-tree', sha, '--', newPath]).trim().split(/\s+/)[0]
      const blobSha = gitText(['rev-parse', `${sha}:${newPath}`]).trim()
      await ensureBlob(blobSha)
      entries.push({ path: newPath, mode: newMode, type: 'blob', sha: blobSha })
      continue
    }
    const path = rest[rest.length - 1]
    const mode = gitText(['ls-tree', sha, '--', path]).trim().split(/\s+/)[0]
    const blobSha = gitText(['rev-parse', `${sha}:${path}`]).trim()
    await ensureBlob(blobSha)
    entries.push({ path, mode, type: 'blob', sha: blobSha })
  }
  const treeRes = await api(`/repos/${REPO}/git/trees`, 'POST', { base_tree: parentTree, tree: entries })
  if (treeRes.status !== 201) throw new Error(`tree failed: ${treeRes.status} ${JSON.stringify(treeRes.json).slice(0, 200)}`)
  return treeRes.json.sha
}

async function pushCommit(sha: string): Promise<void> {
  const info = readCommit(sha)
  const tree = await ensureTree(sha, info)
  const res = await api(`/repos/${REPO}/git/commits`, 'POST', {
    message: info.message,
    tree,
    parents: info.parents,
    author: info.author,
    committer: info.committer,
  })
  if (res.status !== 201) throw new Error(`commit ${sha.slice(0, 8)} failed: ${res.status} ${JSON.stringify(res.json).slice(0, 200)}`)
  const same = res.json.sha === sha
  console.log(`  commit ${sha.slice(0, 8)} tree ${tree.slice(0, 8)} → ${res.json.sha.slice(0, 8)} ${same ? 'SHAs identical ✓' : 'SHA MISMATCH ✗'}`)
  if (!same) throw new Error(`commit SHA mismatch: api=${res.json.sha} local=${sha}`)
}

const targets = process.argv.slice(2)
const local = gitText(['rev-list', '--reverse', 'origin/main..HEAD']).trim().split('\n').filter((s) => s.length > 0)
const shas = targets.length > 0 ? targets : local
if (shas.length === 0) {
  console.log('nothing to push')
  process.exit(0)
}
console.log(`pushing ${shas.length} commit(s) via GitHub API: ${shas.map((s) => s.slice(0, 8)).join(', ')}`)
for (const sha of shas) await pushCommit(sha)
const finalSha = shas[shas.length - 1]
const refRes = await api(`/repos/${REPO}/git/refs/heads/main`, 'PATCH', { sha: finalSha, force: false })
if (refRes.status !== 200) {
  console.error(`ref update failed: ${refRes.status} ${JSON.stringify(refRes.json).slice(0, 300)}`)
  process.exit(1)
}
console.log(`remote main → ${finalSha.slice(0, 8)} ✓`)
// 本地远程跟踪引用同步（github.com 不通，git fetch 不可用）
gitText(['update-ref', 'refs/remotes/origin/main', finalSha])
console.log('local origin/main updated ✓')
