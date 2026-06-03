import { Hono, type Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

// ---------- 型定義 ----------

type Env = {
  Bindings: {
    QUIZ_PASSWORD: string
    ADMIN_PASSWORD: string
    ASSETS: Fetcher
    DB: D1Database
  }
}

type Question = {
  id: number
  subject: string
  cohort: number
  question: string
  choices: string[]
  answer: number[]
  explanation: string | null
}

type SubjectSummary = {
  subject: string
  cohorts: { cohort: number, count: number }[]
  total: number
}

// ---------- D1 行 → Question 型変換 ----------

type D1Row = {
  id: number
  subject: string
  cohort: number
  question: string
  choices: string
  answer: string
  explanation: string | null
}

function rowToQuestion(row: D1Row): Question {
  return {
    ...row,
    choices: JSON.parse(row.choices),
    answer: JSON.parse(row.answer),
  }
}

// ---------- セッション ----------

const SESSION_COOKIE = 'session'
const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7日

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function getSession(c: Context<Env>): Promise<{ role: string } | null> {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null
  const row = await c.env.DB
    .prepare('SELECT role FROM sessions WHERE token = ? AND expires_at > ?')
    .bind(token, new Date().toISOString())
    .first<{ role: string }>()
  return row ?? null
}

async function createSession(c: Context<Env>, role: 'user' | 'admin'): Promise<void> {
  const now = new Date().toISOString()
  await c.env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run()

  const token = generateToken()
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString()
  await c.env.DB
    .prepare('INSERT INTO sessions (token, role, expires_at) VALUES (?, ?, ?)')
    .bind(token, role, expiresAt)
    .run()
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, path: '/', maxAge: SESSION_MAX_AGE, sameSite: 'Lax' })
}

async function deleteSession(c: Context<Env>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

// ---------- 問題データ処理 ----------

async function getSubjects(db: D1Database): Promise<SubjectSummary[]> {
  const { results } = await db
    .prepare('SELECT subject, cohort, COUNT(*) as count FROM questions GROUP BY subject, cohort')
    .all<{ subject: string; cohort: number; count: number }>()

  const map: Record<string, Record<number, number>> = {}
  for (const row of results) {
    if (!map[row.subject]) map[row.subject] = {}
    map[row.subject][row.cohort] = row.count
  }
  return Object.entries(map).map(([subject, cohortCounts]) => ({
    subject,
    cohorts: Object.entries(cohortCounts)
      .map(([c, count]) => ({ cohort: Number(c), count }))
      .sort((a, b) => b.cohort - a.cohort),
    total: Object.values(cohortCounts).reduce((s, c) => s + c, 0),
  }))
}

async function getQuestions(db: D1Database, subject: string, cohort: number): Promise<Question[]> {
  const { results } = await db
    .prepare('SELECT * FROM questions WHERE subject = ? AND cohort = ?')
    .bind(subject, cohort)
    .all<D1Row>()
  return results.map(rowToQuestion)
}

// ---------- ヘルパー ----------

function serveAsset(c: Context<Env>, path: string): Promise<Response> {
  const url = new URL(path, c.req.url)
  return c.env.ASSETS.fetch(new Request(url.toString()))
}

// ---------- Hono アプリ ----------

const app = new Hono<Env>()

// ルート → /quiz か /login にリダイレクト
app.get('/', async (c) => {
  const session = await getSession(c)
  if (session) return c.redirect('/quiz')
  return c.redirect('/login')
})

// ログイン
app.post('/api/login', async (c) => {
  const body = await c.req.parseBody()
  const password = body['password'] as string
  if (password !== c.env.QUIZ_PASSWORD) {
    return c.redirect('/login?error=1')
  }
  await createSession(c, 'user')
  return c.redirect('/quiz')
})

// ログアウト
app.get('/logout', async (c) => {
  await deleteSession(c)
  return c.redirect('/login')
})

// 科目ページ
app.get('/quiz/:subject', async (c) => {
  const session = await getSession(c)
  if (!session) return c.redirect('/login')
  return serveAsset(c, '/subject.html')
})

// 演習ページ
app.get('/quiz/:subject/:cohort', async (c) => {
  const session = await getSession(c)
  if (!session) return c.redirect('/login')
  return serveAsset(c, '/quiz_play.html')
})

// ---------- API ----------

app.get('/api/subjects', async (c) => {
  const session = await getSession(c)
  if (!session) return c.json({ error: 'unauthorized' }, 401)
  return c.json(await getSubjects(c.env.DB))
})

app.get('/api/questions/:subject/:cohort', async (c) => {
  const session = await getSession(c)
  if (!session) return c.json({ error: 'unauthorized' }, 401)
  const subject = decodeURIComponent(c.req.param('subject'))
  const cohort = Number(c.req.param('cohort'))
  if (isNaN(cohort)) return c.json({ error: 'invalid cohort' }, 400)
  return c.json(await getQuestions(c.env.DB, subject, cohort))
})

// ---------- 管理者 ----------

app.post('/api/admin/login', async (c) => {
  const body = await c.req.parseBody()
  const password = body['password'] as string
  if (password !== c.env.ADMIN_PASSWORD) {
    return c.redirect('/admin/login?error=1')
  }
  await createSession(c, 'admin')
  return c.redirect('/admin')
})

app.get('/admin', async (c) => {
  const session = await getSession(c)
  if (session?.role !== 'admin') return c.redirect('/admin/login')
  return serveAsset(c, '/admin.html')
})

app.get('/admin/login', (c) => serveAsset(c, '/admin_login.html'))

// 問題一覧取得（管理者用・subject/cohort でフィルタ可）
app.get('/api/admin/questions', async (c) => {
  const session = await getSession(c)
  if (session?.role !== 'admin') return c.json({ error: 'unauthorized' }, 401)
  const subject = c.req.query('subject')
  const cohort = c.req.query('cohort')

  const conditions: string[] = []
  const bindings: (string | number)[] = []
  if (subject) { conditions.push('subject = ?'); bindings.push(subject) }
  if (cohort)  { conditions.push('cohort = ?');  bindings.push(Number(cohort)) }

  const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : ''
  const { results } = await c.env.DB
    .prepare(`SELECT * FROM questions${where} ORDER BY id`)
    .bind(...bindings)
    .all<D1Row>()
  return c.json(results.map(rowToQuestion))
})

// 問題1件取得
app.get('/api/admin/questions/:id', async (c) => {
  const session = await getSession(c)
  if (session?.role !== 'admin') return c.json({ error: 'unauthorized' }, 401)
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'invalid id' }, 400)
  const row = await c.env.DB
    .prepare('SELECT * FROM questions WHERE id = ?')
    .bind(id)
    .first<D1Row>()
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json(rowToQuestion(row))
})

// 問題削除
app.delete('/api/admin/questions/:id', async (c) => {
  const session = await getSession(c)
  if (session?.role !== 'admin') return c.json({ error: 'unauthorized' }, 401)
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'invalid id' }, 400)
  const { meta } = await c.env.DB
    .prepare('DELETE FROM questions WHERE id = ?')
    .bind(id)
    .run()
  if (meta.changes === 0) return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})

// 問題更新
app.put('/api/admin/questions/:id', async (c) => {
  const session = await getSession(c)
  if (session?.role !== 'admin') return c.json({ error: 'unauthorized' }, 401)
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'invalid id' }, 400)

  const body = await c.req.json<{
    subject: string
    cohort: number
    question: string
    choices: string[]
    answer: number[]
    explanation?: string
  }>()

  const { subject, cohort, question, choices, answer, explanation } = body

  if (!subject || !question || !Array.isArray(choices) || choices.length < 2 || !Array.isArray(answer) || answer.length < 1) {
    return c.json({ error: 'invalid input' }, 400)
  }

  const { meta } = await c.env.DB
    .prepare('UPDATE questions SET subject=?, cohort=?, question=?, choices=?, answer=?, explanation=? WHERE id=?')
    .bind(subject, cohort, question, JSON.stringify(choices), JSON.stringify(answer), explanation ?? null, id)
    .run()

  if (meta.changes === 0) return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})

// ---------- 報告 ----------

app.post('/api/reports', async (c) => {
  const session = await getSession(c)
  if (!session) return c.json({ error: 'unauthorized' }, 401)
  const body = await c.req.json<{ question_id: number; comment: string }>()
  if (!body.question_id || !body.comment?.trim()) {
    return c.json({ error: 'invalid input' }, 400)
  }
  await c.env.DB
    .prepare('INSERT INTO reports (question_id, comment, created_at) VALUES (?, ?, ?)')
    .bind(body.question_id, body.comment.trim(), new Date().toISOString())
    .run()
  return c.json({ ok: true }, 201)
})

app.get('/api/admin/reports', async (c) => {
  const session = await getSession(c)
  if (session?.role !== 'admin') return c.json({ error: 'unauthorized' }, 401)
  const subject = c.req.query('subject')

  const where = subject ? 'WHERE q.subject = ?' : ''
  const sql = `
    SELECT r.id, r.question_id, r.comment, r.created_at,
           q.subject, q.cohort, q.question
    FROM reports r
    JOIN questions q ON r.question_id = q.id
    ${where}
    ORDER BY r.created_at DESC
  `
  const { results } = await c.env.DB
    .prepare(sql)
    .bind(...(subject ? [subject] : []))
    .all<{ id: number; question_id: number; comment: string; created_at: string; subject: string; cohort: number; question: string }>()

  const groups: Record<number, { question_id: number; subject: string; cohort: number; question: string; reports: { id: number; comment: string; created_at: string }[] }> = {}
  for (const row of results) {
    if (!groups[row.question_id]) {
      groups[row.question_id] = {
        question_id: row.question_id,
        subject: row.subject,
        cohort: row.cohort,
        question: row.question,
        reports: [],
      }
    }
    groups[row.question_id].reports.push({ id: row.id, comment: row.comment, created_at: row.created_at })
  }
  return c.json(Object.values(groups))
})

app.delete('/api/admin/reports/:id', async (c) => {
  const session = await getSession(c)
  if (session?.role !== 'admin') return c.json({ error: 'unauthorized' }, 401)
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'invalid id' }, 400)
  await c.env.DB.prepare('DELETE FROM reports WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

app.delete('/api/admin/reports/question/:question_id', async (c) => {
  const session = await getSession(c)
  if (session?.role !== 'admin') return c.json({ error: 'unauthorized' }, 401)
  const qid = Number(c.req.param('question_id'))
  if (isNaN(qid)) return c.json({ error: 'invalid id' }, 400)
  await c.env.DB.prepare('DELETE FROM reports WHERE question_id = ?').bind(qid).run()
  return c.json({ ok: true })
})

// ---------- 静的ファイル（CSS, JS）キャッチオール ----------
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env['Bindings']) {
    await env.DB
      .prepare('DELETE FROM sessions WHERE expires_at < ?')
      .bind(new Date().toISOString())
      .run()
  },
}
