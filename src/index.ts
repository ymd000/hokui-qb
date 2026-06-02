import { Hono, type Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import questions from './questions.json'

// ---------- 型定義 ----------

type Env = {
  Bindings: {
    QUIZ_PASSWORD: string
    ASSETS: Fetcher
  }
}

type Question = {
  id: number
  subject: string
  year: number
  cohort: number
  question: string
  choices: string[]
  answer: number | number[]
  explanation: string | null
}

type SubjectSummary = {
  subject: string
  cohorts: { cohort: number, count: number }[]
  total: number
}

// ---------- 問題データ処理 ----------

const allQuestions: Question[] = questions

function getSubjects(): SubjectSummary[] {
  const map: Record<string, Record<number, number>> = {}
  for (const q of allQuestions) {
    if (!map[q.subject]) map[q.subject] = {}
    map[q.subject][q.cohort] = (map[q.subject][q.cohort] ?? 0) + 1
  }
  return Object.entries(map).map(([subject, cohortCounts]) => ({
    subject,
    cohorts: Object.entries(cohortCounts)
      .map(([y, count]) => ({ cohort: Number(y), count }))
      .sort((a, b) => b.cohort - a.cohort),
    total: Object.values(cohortCounts).reduce((s, c) => s + c, 0),
  }))
}

function getQuestions(subject: string, cohort: number): Question[] {
  return allQuestions.filter(q => q.subject === subject && q.cohort === cohort)
}

// ---------- 認証ヘルパー ----------

function isLoggedIn(c: Context<Env>): boolean {
  return getCookie(c, 'logged_in') === '1'
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

// ログイン処理（GET /login は assets が login.html を配信するので Worker 不要）
// POST 先を /api/login にすることで assets ルーターとの競合を回避
app.post('/api/login', async (c) => {
  const body = await c.req.parseBody()
  const password = body['password'] as string

  if (password !== c.env.QUIZ_PASSWORD) {
    return c.redirect('/login?error=1')
  }
  setCookie(c, 'logged_in', '1', { httpOnly: true, path: '/' })
  return c.redirect('/quiz')
})

// ログアウト
app.get('/logout', (c) => {
  deleteCookie(c, 'logged_in', { path: '/' })
  return c.redirect('/login')
})

// 科目ページ（認証ガード付き: /quiz/:subject は静的ファイルと競合しないので Worker が受け取る）
app.get('/quiz/:subject', (c) => {
  if (!isLoggedIn(c)) return c.redirect('/login')
  return serveAsset(c, '/subject.html')
})

// 演習ページ（認証ガード付き）
app.get('/quiz/:subject/:year', (c) => {
  if (!isLoggedIn(c)) return c.redirect('/login')
  return serveAsset(c, '/quiz_play.html')
})

// ---------- API ----------

app.get('/api/subjects', (c) => {
  if (!isLoggedIn(c)) return c.json({ error: 'unauthorized' }, 401)
  return c.json(getSubjects())
})

app.get('/api/questions/:subject/:year', (c) => {
  if (!isLoggedIn(c)) return c.json({ error: 'unauthorized' }, 401)
  const subject = decodeURIComponent(c.req.param('subject'))
  const year = Number(c.req.param('year'))
  if (isNaN(year)) return c.json({ error: 'invalid year' }, 400)
  return c.json(getQuestions(subject, year))
})

// ---------- 静的ファイル（CSS, JS）キャッチオール ----------
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
