const express = require('express')
const cors = require('cors')
const path = require('path')
const connectDB = require('./config/db')

const authRoutes = require('./routes/auth')
const adminRoutes = require('./routes/admin')
const validateRoutes = require('./routes/validate')

const app = express()
const PORT = process.env.PORT || 3001

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ── Routes ────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/admin'))

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
})

// Auth routes (no middleware)
app.use('/admin', authRoutes)

// Admin API routes (JWT-protected)
app.use('/admin', adminRoutes)

// Client validation endpoint (no auth)
app.use('/validate', validateRoutes)

// Legacy create endpoint (backward compat)
const License = require('./models/License')
const crypto = require('crypto')
const ADMIN_SECRET = 'changeme'

app.post('/admin/create-legacy', async (req, res) => {
  try {
    const { secret, vendorName, expiresAt } = req.body
    if (secret !== ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const rand = () => crypto.randomBytes(2).toString('hex').toUpperCase()
    const key = `BILL-${rand()}-${rand()}-${rand()}`
    const vendor = vendorName || 'Unknown Vendor'
    const expires = expiresAt || '2099-12-31'

    await License.create({ key, vendor_name: vendor, expires_at: expires })

    console.log(`[CREATE-LEGACY] Key: ${key} | Vendor: ${vendor} | Expires: ${expires}`)
    res.json({ key, vendorName: vendor, expiresAt: expires })
  } catch (err) {
    console.error('[CREATE-LEGACY ERROR]', err)
    res.status(500).json({ error: 'Failed to create license' })
  }
})

// Health check
app.get('/health', async (_, res) => {
  try {
    const count = await License.countDocuments()
    res.json({ status: 'ok', licenses: count })
  } catch (err) {
    res.json({ status: 'degraded', error: err.message })
  }
})

// ── Start Server ──────────────────────────────────────────────────────────
async function start() {
  await connectDB()

  app.listen(PORT, () => {
    console.log(`\n🚀 BillEasy License Server v2.0`)
    console.log(`   Port: ${PORT}`)
    console.log(`   Dashboard: http://localhost:${PORT}/admin`)
    console.log(`   Health: http://localhost:${PORT}/health\n`)
  })
}

start()
