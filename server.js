const express = require('express')
const crypto = require('crypto')
const path = require('path')
const Database = require('better-sqlite3')

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const PORT = process.env.PORT || 3001
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'changeme'

// ── SQLite Database ────────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'licenses.db')
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    key          TEXT PRIMARY KEY,
    vendor_name  TEXT NOT NULL DEFAULT 'Unknown Vendor',
    machine_id   TEXT,
    expires_at   TEXT NOT NULL DEFAULT '2099-12-31',
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    activated_at TEXT
  )
`)

// ── Admin Auth Middleware ──────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token']
  if (token !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// ── Admin: Dashboard page ─────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
})

// ── Admin: Login (verify secret) ──────────────────────────────────────────
app.post('/admin/login', (req, res) => {
  const { secret } = req.body
  if (secret === ADMIN_SECRET) {
    res.json({ valid: true, token: ADMIN_SECRET })
  } else {
    res.status(401).json({ valid: false, message: 'Invalid admin secret.' })
  }
})

// ── Admin: Dashboard stats ────────────────────────────────────────────────
app.get('/admin/stats', adminAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10)

  const total = db.prepare('SELECT COUNT(*) as count FROM licenses').get().count
  const active = db.prepare('SELECT COUNT(*) as count FROM licenses WHERE active=1 AND machine_id IS NOT NULL AND expires_at >= ?').get(today).count
  const pending = db.prepare('SELECT COUNT(*) as count FROM licenses WHERE active=1 AND machine_id IS NULL').get().count
  const expired = db.prepare('SELECT COUNT(*) as count FROM licenses WHERE expires_at < ?').get(today).count
  const deactivated = db.prepare('SELECT COUNT(*) as count FROM licenses WHERE active=0').get().count
  const thisWeek = db.prepare("SELECT COUNT(*) as count FROM licenses WHERE created_at >= datetime('now', '-7 days')").get().count

  res.json({ total, active, pending, expired, deactivated, thisWeek })
})

// ── Admin: List all licenses ──────────────────────────────────────────────
app.get('/admin/licenses', adminAuth, (req, res) => {
  const licenses = db.prepare('SELECT * FROM licenses ORDER BY created_at DESC').all()
  const today = new Date().toISOString().slice(0, 10)

  const enriched = licenses.map(lic => ({
    ...lic,
    status: !lic.active ? 'deactivated'
          : lic.expires_at < today ? 'expired'
          : lic.machine_id ? 'active'
          : 'pending',
  }))

  res.json(enriched)
})

// ── Admin: Create a license key ───────────────────────────────────────────
app.post('/admin/create', adminAuth, (req, res) => {
  const { vendorName, expiresAt } = req.body

  // Also support old format with `secret` field for backward compat
  if (!req.headers['x-admin-token'] && req.body.secret === ADMIN_SECRET) {
    // OK — legacy auth
  }

  const rand = () => crypto.randomBytes(2).toString('hex').toUpperCase()
  const key = `BILL-${rand()}-${rand()}-${rand()}`
  const vendor = vendorName || 'Unknown Vendor'
  const expires = expiresAt || '2099-12-31'

  db.prepare(
    'INSERT INTO licenses (key, vendor_name, expires_at) VALUES (?, ?, ?)'
  ).run(key, vendor, expires)

  console.log(`[CREATE] Key: ${key} | Vendor: ${vendor} | Expires: ${expires}`)
  res.json({ key, vendorName: vendor, expiresAt: expires })
})

// ── Admin: Toggle license active/inactive ─────────────────────────────────
app.post('/admin/toggle', adminAuth, (req, res) => {
  const { key } = req.body
  const lic = db.prepare('SELECT * FROM licenses WHERE key=?').get(key)
  if (!lic) return res.status(404).json({ error: 'License not found' })

  const newActive = lic.active ? 0 : 1
  db.prepare('UPDATE licenses SET active=? WHERE key=?').run(newActive, key)
  console.log(`[TOGGLE] Key: ${key} → ${newActive ? 'active' : 'deactivated'}`)
  res.json({ key, active: newActive })
})

// ── Admin: Unbind machine (allow re-activation on different PC) ───────────
app.post('/admin/unbind', adminAuth, (req, res) => {
  const { key } = req.body
  const lic = db.prepare('SELECT * FROM licenses WHERE key=?').get(key)
  if (!lic) return res.status(404).json({ error: 'License not found' })

  db.prepare('UPDATE licenses SET machine_id=NULL, activated_at=NULL WHERE key=?').run(key)
  console.log(`[UNBIND] Key: ${key} — machine unbound`)
  res.json({ key, message: 'Machine unbound. Key can be activated on a new PC.' })
})

// ── Admin: Delete a license ───────────────────────────────────────────────
app.post('/admin/delete', adminAuth, (req, res) => {
  const { key } = req.body
  const result = db.prepare('DELETE FROM licenses WHERE key=?').run(key)
  if (result.changes === 0) return res.status(404).json({ error: 'License not found' })

  console.log(`[DELETE] Key: ${key}`)
  res.json({ message: 'License deleted.' })
})

// ── Validate / activate a license (called by BillEasy desktop app) ────────
app.post('/validate', (req, res) => {
  const { key, machine_id } = req.body

  if (!key || !machine_id) {
    return res.status(400).json({ valid: false, message: 'Key and machine_id are required.' })
  }

  const license = db.prepare('SELECT * FROM licenses WHERE key=?').get(key)

  if (!license) {
    return res.json({ valid: false, message: 'Invalid license key.' })
  }

  if (!license.active) {
    return res.json({ valid: false, message: 'This license has been deactivated.' })
  }

  // Bind machine on first activation
  if (!license.machine_id) {
    db.prepare("UPDATE licenses SET machine_id=?, activated_at=datetime('now') WHERE key=?")
      .run(machine_id, key)
    console.log(`[ACTIVATE] Key: ${key} | Machine: ${machine_id}`)
  } else if (license.machine_id !== machine_id) {
    return res.json({
      valid: false,
      message: 'This key is already activated on a different PC. Contact support.',
    })
  }

  // Check expiry
  const today = new Date().toISOString().slice(0, 10)
  if (license.expires_at < today) {
    return res.json({ valid: false, message: 'License has expired. Please renew.' })
  }

  res.json({
    valid: true,
    vendor_name: license.vendor_name,
    expires_at: license.expires_at,
  })
})

// ── Legacy admin create (backward compat with secret in body) ─────────────
app.post('/admin/create-legacy', (req, res) => {
  const { secret, vendorName, expiresAt } = req.body
  if (secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  req.headers['x-admin-token'] = ADMIN_SECRET
  req.body = { vendorName, expiresAt }

  // Forward to the new create handler
  const rand = () => crypto.randomBytes(2).toString('hex').toUpperCase()
  const key = `BILL-${rand()}-${rand()}-${rand()}`
  const vendor = vendorName || 'Unknown Vendor'
  const expires = expiresAt || '2099-12-31'

  db.prepare(
    'INSERT INTO licenses (key, vendor_name, expires_at) VALUES (?, ?, ?)'
  ).run(key, vendor, expires)

  console.log(`[CREATE-LEGACY] Key: ${key} | Vendor: ${vendor} | Expires: ${expires}`)
  res.json({ key, vendorName: vendor, expiresAt: expires })
})

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', licenses: db.prepare('SELECT COUNT(*) as c FROM licenses').get().c }))

app.listen(PORT, () => {
  const count = db.prepare('SELECT COUNT(*) as c FROM licenses').get().c
  console.log(`BillEasy License Server running on port ${PORT}`)
  console.log(`Database: ${DB_PATH} (${count} licenses)`)
  console.log(`Admin dashboard: http://localhost:${PORT}/admin`)
})
