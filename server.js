const express = require('express')
const crypto = require('crypto')
const path = require('path')
const mongoose = require('mongoose')

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const PORT = process.env.PORT || 3001
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'changeme'
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/billeasy-licenses'

// ── Mongoose Schema ───────────────────────────────────────────────────────
const licenseSchema = new mongoose.Schema({
  key:          { type: String, required: true, unique: true, index: true },
  vendor_name:  { type: String, default: 'Unknown Vendor' },
  machine_id:   { type: String, default: null },
  expires_at:   { type: String, default: '2099-12-31' },
  active:       { type: Boolean, default: true },
  created_at:   { type: Date, default: Date.now },
  activated_at: { type: Date, default: null },
})

const License = mongoose.model('License', licenseSchema)

// ── Admin Auth Middleware ──────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token']
  if (token !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// ── Root redirect ─────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/admin'))

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

// ── Helper: format date for comparison ────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

// ── Admin: Dashboard stats ────────────────────────────────────────────────
app.get('/admin/stats', adminAuth, async (req, res) => {
  try {
    const today = todayStr()
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const [total, active, pending, expired, deactivated, thisWeek] = await Promise.all([
      License.countDocuments(),
      License.countDocuments({ active: true, machine_id: { $ne: null }, expires_at: { $gte: today } }),
      License.countDocuments({ active: true, machine_id: null }),
      License.countDocuments({ expires_at: { $lt: today } }),
      License.countDocuments({ active: false }),
      License.countDocuments({ created_at: { $gte: weekAgo } }),
    ])

    res.json({ total, active, pending, expired, deactivated, thisWeek })
  } catch (err) {
    console.error('[STATS ERROR]', err)
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})

// ── Admin: List all licenses ──────────────────────────────────────────────
app.get('/admin/licenses', adminAuth, async (req, res) => {
  try {
    const licenses = await License.find().sort({ created_at: -1 }).lean()
    const today = todayStr()

    const enriched = licenses.map(lic => ({
      key: lic.key,
      vendor_name: lic.vendor_name,
      machine_id: lic.machine_id,
      expires_at: lic.expires_at,
      active: lic.active,
      created_at: lic.created_at,
      activated_at: lic.activated_at,
      status: !lic.active ? 'deactivated'
            : lic.expires_at < today ? 'expired'
            : lic.machine_id ? 'active'
            : 'pending',
    }))

    res.json(enriched)
  } catch (err) {
    console.error('[LIST ERROR]', err)
    res.status(500).json({ error: 'Failed to fetch licenses' })
  }
})

// ── Admin: Create a license key ───────────────────────────────────────────
app.post('/admin/create', adminAuth, async (req, res) => {
  try {
    const { vendorName, expiresAt } = req.body

    const rand = () => crypto.randomBytes(2).toString('hex').toUpperCase()
    const key = `BILL-${rand()}-${rand()}-${rand()}`
    const vendor = vendorName || 'Unknown Vendor'
    const expires = expiresAt || '2099-12-31'

    await License.create({
      key,
      vendor_name: vendor,
      expires_at: expires,
    })

    console.log(`[CREATE] Key: ${key} | Vendor: ${vendor} | Expires: ${expires}`)
    res.json({ key, vendorName: vendor, expiresAt: expires })
  } catch (err) {
    console.error('[CREATE ERROR]', err)
    res.status(500).json({ error: 'Failed to create license' })
  }
})

// ── Admin: Toggle license active/inactive ─────────────────────────────────
app.post('/admin/toggle', adminAuth, async (req, res) => {
  try {
    const { key } = req.body
    const lic = await License.findOne({ key })
    if (!lic) return res.status(404).json({ error: 'License not found' })

    lic.active = !lic.active
    await lic.save()

    console.log(`[TOGGLE] Key: ${key} → ${lic.active ? 'active' : 'deactivated'}`)
    res.json({ key, active: lic.active })
  } catch (err) {
    console.error('[TOGGLE ERROR]', err)
    res.status(500).json({ error: 'Failed to toggle license' })
  }
})

// ── Admin: Unbind machine (allow re-activation on different PC) ───────────
app.post('/admin/unbind', adminAuth, async (req, res) => {
  try {
    const { key } = req.body
    const lic = await License.findOne({ key })
    if (!lic) return res.status(404).json({ error: 'License not found' })

    lic.machine_id = null
    lic.activated_at = null
    await lic.save()

    console.log(`[UNBIND] Key: ${key} — machine unbound`)
    res.json({ key, message: 'Machine unbound. Key can be activated on a new PC.' })
  } catch (err) {
    console.error('[UNBIND ERROR]', err)
    res.status(500).json({ error: 'Failed to unbind machine' })
  }
})

// ── Admin: Delete a license ───────────────────────────────────────────────
app.post('/admin/delete', adminAuth, async (req, res) => {
  try {
    const { key } = req.body
    const result = await License.deleteOne({ key })
    if (result.deletedCount === 0) return res.status(404).json({ error: 'License not found' })

    console.log(`[DELETE] Key: ${key}`)
    res.json({ message: 'License deleted.' })
  } catch (err) {
    console.error('[DELETE ERROR]', err)
    res.status(500).json({ error: 'Failed to delete license' })
  }
})

// ── Validate / activate a license (called by BillEasy desktop app) ────────
app.post('/validate', async (req, res) => {
  try {
    const { key, machine_id } = req.body

    if (!key || !machine_id) {
      return res.status(400).json({ valid: false, message: 'Key and machine_id are required.' })
    }

    const license = await License.findOne({ key })

    if (!license) {
      return res.json({ valid: false, message: 'Invalid license key.' })
    }

    if (!license.active) {
      return res.json({ valid: false, message: 'This license has been deactivated.' })
    }

    // Bind machine on first activation
    if (!license.machine_id) {
      license.machine_id = machine_id
      license.activated_at = new Date()
      await license.save()
      console.log(`[ACTIVATE] Key: ${key} | Machine: ${machine_id}`)
    } else if (license.machine_id !== machine_id) {
      return res.json({
        valid: false,
        message: 'This key is already activated on a different PC. Contact support.',
      })
    }

    // Check expiry
    const today = todayStr()
    if (license.expires_at < today) {
      return res.json({ valid: false, message: 'License has expired. Please renew.' })
    }

    res.json({
      valid: true,
      vendor_name: license.vendor_name,
      expires_at: license.expires_at,
    })
  } catch (err) {
    console.error('[VALIDATE ERROR]', err)
    res.status(500).json({ valid: false, message: 'Server error during validation.' })
  }
})

// ── Legacy admin create (backward compat with secret in body) ─────────────
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

    await License.create({
      key,
      vendor_name: vendor,
      expires_at: expires,
    })

    console.log(`[CREATE-LEGACY] Key: ${key} | Vendor: ${vendor} | Expires: ${expires}`)
    res.json({ key, vendorName: vendor, expiresAt: expires })
  } catch (err) {
    console.error('[CREATE-LEGACY ERROR]', err)
    res.status(500).json({ error: 'Failed to create license' })
  }
})

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', async (_, res) => {
  try {
    const count = await License.countDocuments()
    res.json({ status: 'ok', licenses: count })
  } catch (err) {
    res.json({ status: 'degraded', error: err.message })
  }
})

// ── Connect to MongoDB & Start Server ─────────────────────────────────────
async function start() {
  try {
    await mongoose.connect(MONGO_URI)
    console.log(`✅ Connected to MongoDB`)

    app.listen(PORT, () => {
      console.log(`BillEasy License Server running on port ${PORT}`)
      console.log(`Database: ${MONGO_URI.replace(/\/\/.*@/, '//***@')}`)
      console.log(`Admin dashboard: http://localhost:${PORT}/admin`)
    })
  } catch (err) {
    console.error('❌ Failed to connect to MongoDB:', err.message)
    process.exit(1)
  }
}

start()
