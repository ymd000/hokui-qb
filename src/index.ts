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

// ---------- 認証ヘルパー ----------

function isLoggedIn(c: Context<Env>): boolean {
  return getCookie(c, 'logged_in') === '1'
}

function isAdmin(c: Context<Env>): boolean {
  return getCookie(c, 'admin_logged_in') === '1'
}

function serveAsset(c: Context<Env>, path: string): Promise<Response> {
  const url = new URL(path, c.req.url)
  return c.env.ASSETS.fetch(new Request(url.toString()))
}

// ---------- Hono アプリ ----------

const app = new Hono<Env>()

// ルート → /quiz か /login にリダイレクト
app.get('/', (c) => {
  if (isLoggedIn(c)) return c.redirect('/quiz')
  return c.redirect('/login')
})

app.post('/api/login', async (c) => {
  const body = await c.req.parseBody()
  const password = body['password'] as string

  if (password !== c.env.QUIZ_PASSWORD) {
    return c.redirect('/login?error=1')
  }
  setCookie(c, 'logged_in', '1', { httpOnly: true, path: '/', maxAge: 60 * 60 * 24 * 7 })
  return c.redirect('/quiz')
})

// ログアウト
app.get('/logout', (c) => {
  deleteCookie(c, 'logged_in', { path: '/' })
  deleteCookie(c, 'admin_logged_in', { path: '/' })
  return c.redirect('/login')
})

// 科目ページ
app.get('/quiz/:subject', (c) => {
  if (!isLoggedIn(c)) return c.redirect('/login')
  return serveAsset(c, '/subject.html')
})

// 演習ページ
app.get('/quiz/:subject/:cohort', (c) => {
  if (!isLoggedIn(c)) return c.redirect('/login')
  return serveAsset(c, '/quiz_play.html')
})

// ---------- API ----------

app.get('/api/subjects', async (c) => {
  if (!isLoggedIn(c)) return c.json({ error: 'unauthorized' }, 401)
  return c.json(await getSubjects(c.env.DB))
})

app.get('/api/questions/:subject/:cohort', async (c) => {
  if (!isLoggedIn(c)) return c.json({ error: 'unauthorized' }, 401)
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
  setCookie(c, 'admin_logged_in', '1', { httpOnly: true, path: '/', maxAge: 60 * 60 * 24 * 7 })
  return c.redirect('/admin')
})

app.get('/admin', (c) => {
  if (!isAdmin(c)) return c.redirect('/admin/login')
  return serveAsset(c, '/admin.html')
})

app.get('/admin/login', (c) => serveAsset(c, '/admin_login.html'))

// 問題一覧取得（管理者用・全件）
app.get('/api/admin/questions', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'unauthorized' }, 401)
  const { results } = await c.env.DB
    .prepare('SELECT * FROM questions ORDER BY subject, cohort, id')
    .all<D1Row>()
  return c.json(results.map(rowToQuestion))
})

// 問題追加
app.post('/api/admin/questions', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'unauthorized' }, 401)
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
    .prepare('INSERT INTO questions (subject, cohort, question, choices, answer, explanation) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(subject, cohort, question, JSON.stringify(choices), JSON.stringify(answer), explanation ?? null)
    .run()

  return c.json({ id: meta.last_row_id }, 201)
})

// 問題削除
app.delete('/api/admin/questions/:id', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'unauthorized' }, 401)
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
  if (!isAdmin(c)) return c.json({ error: 'unauthorized' }, 401)
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

// ---------- 静的ファイル（CSS, JS）キャッチオール ----------
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
