const express = require('express')
const crypto = require('crypto')
const License = require('../models/License')
const ActivityLog = require('../models/ActivityLog')
const adminAuth = require('../middleware/adminAuth')
const router = express.Router()

// All routes in this file require admin auth
router.use(adminAuth)

// Helper
function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function generateKey() {
  const rand = () => crypto.randomBytes(2).toString('hex').toUpperCase()
  return `BILL-${rand()}-${rand()}-${rand()}`
}

function enrichLicense(lic) {
  const today = todayStr()
  return {
    key: lic.key,
    vendor_name: lic.vendor_name,
    vendor_phone: lic.vendor_phone || '',
    vendor_email: lic.vendor_email || '',
    machine_id: lic.machine_id,
    expires_at: lic.expires_at,
    active: lic.active,
    notes: lic.notes || '',
    created_at: lic.created_at,
    activated_at: lic.activated_at,
    status: !lic.active ? 'deactivated'
          : lic.expires_at < today ? 'expired'
          : lic.machine_id ? 'active'
          : 'pending',
  }
}

// ── GET /admin/stats ──────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
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

// ── GET /admin/licenses ───────────────────────────────────────────────────
router.get('/licenses', async (req, res) => {
  try {
    const { search, status, sort } = req.query
    let query = {}

    // Status filter
    const today = todayStr()
    if (status === 'active') {
      query.active = true
      query.machine_id = { $ne: null }
      query.expires_at = { $gte: today }
    } else if (status === 'pending') {
      query.active = true
      query.machine_id = null
    } else if (status === 'expired') {
      query.expires_at = { $lt: today }
    } else if (status === 'deactivated') {
      query.active = false
    }

    // Search filter
    if (search) {
      const regex = new RegExp(search, 'i')
      query.$or = [
        { key: regex },
        { vendor_name: regex },
        { vendor_phone: regex },
        { vendor_email: regex },
        { notes: regex },
      ]
    }

    // Sort
    let sortObj = { created_at: -1 }
    if (sort === 'vendor') sortObj = { vendor_name: 1 }
    else if (sort === 'expires') sortObj = { expires_at: 1 }
    else if (sort === 'status') sortObj = { active: -1, machine_id: -1 }

    const licenses = await License.find(query).sort(sortObj).lean()
    const enriched = licenses.map(enrichLicense)

    res.json(enriched)
  } catch (err) {
    console.error('[LIST ERROR]', err)
    res.status(500).json({ error: 'Failed to fetch licenses' })
  }
})

// ── GET /admin/licenses/:key ──────────────────────────────────────────────
router.get('/licenses/:key', async (req, res) => {
  try {
    const lic = await License.findOne({ key: req.params.key }).lean()
    if (!lic) return res.status(404).json({ error: 'License not found' })
    res.json(enrichLicense(lic))
  } catch (err) {
    console.error('[GET LICENSE ERROR]', err)
    res.status(500).json({ error: 'Failed to fetch license' })
  }
})

// ── POST /admin/create ────────────────────────────────────────────────────
router.post('/create', async (req, res) => {
  try {
    const { vendorName, vendorPhone, vendorEmail, expiresAt, notes } = req.body
    const key = generateKey()
    const vendor = vendorName || 'Unknown Vendor'
    const expires = expiresAt || '2099-12-31'

    await License.create({
      key,
      vendor_name: vendor,
      vendor_phone: vendorPhone || '',
      vendor_email: vendorEmail || '',
      expires_at: expires,
      notes: notes || '',
    })

    await ActivityLog.create({
      action: 'CREATE',
      license_key: key,
      details: `Created for "${vendor}" | Expires: ${expires}`,
    })

    console.log(`[CREATE] Key: ${key} | Vendor: ${vendor} | Expires: ${expires}`)
    res.json({ key, vendorName: vendor, expiresAt: expires })
  } catch (err) {
    console.error('[CREATE ERROR]', err)
    res.status(500).json({ error: 'Failed to create license' })
  }
})

// ── PUT /admin/edit ───────────────────────────────────────────────────────
router.put('/edit', async (req, res) => {
  try {
    const { key, vendorName, vendorPhone, vendorEmail, expiresAt, notes } = req.body
    const lic = await License.findOne({ key })
    if (!lic) return res.status(404).json({ error: 'License not found' })

    const changes = []
    if (vendorName !== undefined && vendorName !== lic.vendor_name) {
      changes.push(`name: "${lic.vendor_name}" → "${vendorName}"`)
      lic.vendor_name = vendorName
    }
    if (vendorPhone !== undefined) lic.vendor_phone = vendorPhone
    if (vendorEmail !== undefined) lic.vendor_email = vendorEmail
    if (expiresAt !== undefined && expiresAt !== lic.expires_at) {
      changes.push(`expires: ${lic.expires_at} → ${expiresAt}`)
      lic.expires_at = expiresAt
    }
    if (notes !== undefined) lic.notes = notes

    await lic.save()

    await ActivityLog.create({
      action: 'EDIT',
      license_key: key,
      details: changes.length > 0 ? changes.join(' | ') : 'Updated details',
    })

    console.log(`[EDIT] Key: ${key} | Changes: ${changes.join(', ') || 'minor'}`)
    res.json({ message: 'License updated', key })
  } catch (err) {
    console.error('[EDIT ERROR]', err)
    res.status(500).json({ error: 'Failed to edit license' })
  }
})

// ── POST /admin/toggle ────────────────────────────────────────────────────
router.post('/toggle', async (req, res) => {
  try {
    const { key } = req.body
    const lic = await License.findOne({ key })
    if (!lic) return res.status(404).json({ error: 'License not found' })

    lic.active = !lic.active
    await lic.save()

    await ActivityLog.create({
      action: lic.active ? 'ENABLE' : 'DEACTIVATE',
      license_key: key,
      details: `License ${lic.active ? 'enabled' : 'deactivated'}`,
    })

    console.log(`[TOGGLE] Key: ${key} → ${lic.active ? 'active' : 'deactivated'}`)
    res.json({ key, active: lic.active })
  } catch (err) {
    console.error('[TOGGLE ERROR]', err)
    res.status(500).json({ error: 'Failed to toggle license' })
  }
})

// ── POST /admin/unbind ────────────────────────────────────────────────────
router.post('/unbind', async (req, res) => {
  try {
    const { key } = req.body
    const lic = await License.findOne({ key })
    if (!lic) return res.status(404).json({ error: 'License not found' })

    const oldMachine = lic.machine_id
    lic.machine_id = null
    lic.activated_at = null
    await lic.save()

    await ActivityLog.create({
      action: 'UNBIND',
      license_key: key,
      details: `Unbound from machine ${oldMachine ? oldMachine.substring(0, 16) + '...' : 'N/A'}`,
    })

    console.log(`[UNBIND] Key: ${key} — machine unbound`)
    res.json({ key, message: 'Machine unbound. Key can be activated on a new PC.' })
  } catch (err) {
    console.error('[UNBIND ERROR]', err)
    res.status(500).json({ error: 'Failed to unbind machine' })
  }
})

// ── POST /admin/renew ─────────────────────────────────────────────────────
router.post('/renew', async (req, res) => {
  try {
    const { key, expiresAt } = req.body
    const lic = await License.findOne({ key })
    if (!lic) return res.status(404).json({ error: 'License not found' })

    const oldExpiry = lic.expires_at
    lic.expires_at = expiresAt
    if (!lic.active) lic.active = true
    await lic.save()

    await ActivityLog.create({
      action: 'RENEW',
      license_key: key,
      details: `Renewed: ${oldExpiry} → ${expiresAt}`,
    })

    console.log(`[RENEW] Key: ${key} | ${oldExpiry} → ${expiresAt}`)
    res.json({ key, expires_at: expiresAt, message: 'License renewed' })
  } catch (err) {
    console.error('[RENEW ERROR]', err)
    res.status(500).json({ error: 'Failed to renew license' })
  }
})

// ── POST /admin/delete ────────────────────────────────────────────────────
router.post('/delete', async (req, res) => {
  try {
    const { key } = req.body
    const lic = await License.findOne({ key }).lean()
    if (!lic) return res.status(404).json({ error: 'License not found' })

    await License.deleteOne({ key })

    await ActivityLog.create({
      action: 'DELETE',
      license_key: key,
      details: `Deleted license for "${lic.vendor_name}"`,
    })

    console.log(`[DELETE] Key: ${key}`)
    res.json({ message: 'License deleted.' })
  } catch (err) {
    console.error('[DELETE ERROR]', err)
    res.status(500).json({ error: 'Failed to delete license' })
  }
})

// ── POST /admin/bulk/create ───────────────────────────────────────────────
router.post('/bulk/create', async (req, res) => {
  try {
    const { count, vendorPrefix, expiresAt } = req.body
    const num = Math.min(parseInt(count) || 1, 50) // max 50 at once
    const expires = expiresAt || '2099-12-31'
    const keys = []

    for (let i = 0; i < num; i++) {
      const key = generateKey()
      const vendor = vendorPrefix ? `${vendorPrefix} #${i + 1}` : `Vendor #${i + 1}`
      await License.create({
        key,
        vendor_name: vendor,
        expires_at: expires,
      })
      keys.push(key)
    }

    await ActivityLog.create({
      action: 'BULK_CREATE',
      license_key: keys[0],
      details: `Bulk created ${num} licenses | Prefix: "${vendorPrefix || 'Vendor'}" | Expires: ${expires}`,
    })

    console.log(`[BULK CREATE] ${num} keys generated`)
    res.json({ count: num, keys })
  } catch (err) {
    console.error('[BULK CREATE ERROR]', err)
    res.status(500).json({ error: 'Failed to bulk create licenses' })
  }
})

// ── POST /admin/bulk/toggle ───────────────────────────────────────────────
router.post('/bulk/toggle', async (req, res) => {
  try {
    const { keys, active } = req.body
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: 'Keys array is required' })
    }

    await License.updateMany({ key: { $in: keys } }, { active: !!active })

    await ActivityLog.create({
      action: 'BULK_TOGGLE',
      license_key: keys[0],
      details: `Bulk ${active ? 'enabled' : 'disabled'} ${keys.length} licenses`,
    })

    console.log(`[BULK TOGGLE] ${keys.length} keys → ${active ? 'enabled' : 'disabled'}`)
    res.json({ message: `${keys.length} licenses ${active ? 'enabled' : 'disabled'}` })
  } catch (err) {
    console.error('[BULK TOGGLE ERROR]', err)
    res.status(500).json({ error: 'Failed to bulk toggle licenses' })
  }
})

// ── POST /admin/bulk/delete ───────────────────────────────────────────────
router.post('/bulk/delete', async (req, res) => {
  try {
    const { keys } = req.body
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: 'Keys array is required' })
    }

    const result = await License.deleteMany({ key: { $in: keys } })

    await ActivityLog.create({
      action: 'BULK_DELETE',
      license_key: keys[0],
      details: `Bulk deleted ${result.deletedCount} licenses`,
    })

    console.log(`[BULK DELETE] ${result.deletedCount} keys deleted`)
    res.json({ message: `${result.deletedCount} licenses deleted` })
  } catch (err) {
    console.error('[BULK DELETE ERROR]', err)
    res.status(500).json({ error: 'Failed to bulk delete licenses' })
  }
})

// ── GET /admin/activity ───────────────────────────────────────────────────
router.get('/activity', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const logs = await ActivityLog.find().sort({ timestamp: -1 }).limit(limit).lean()
    res.json(logs)
  } catch (err) {
    console.error('[ACTIVITY ERROR]', err)
    res.status(500).json({ error: 'Failed to fetch activity log' })
  }
})

// ── GET /admin/export ─────────────────────────────────────────────────────
router.get('/export', async (req, res) => {
  try {
    const licenses = await License.find().sort({ created_at: -1 }).lean()
    const today = todayStr()

    const csvHeader = 'Key,Vendor Name,Phone,Email,Machine ID,Status,Expires At,Created At,Activated At,Notes\n'
    const csvRows = licenses.map(lic => {
      const status = !lic.active ? 'deactivated'
                   : lic.expires_at < today ? 'expired'
                   : lic.machine_id ? 'active'
                   : 'pending'

      return [
        lic.key,
        `"${(lic.vendor_name || '').replace(/"/g, '""')}"`,
        lic.vendor_phone || '',
        lic.vendor_email || '',
        lic.machine_id || '',
        status,
        lic.expires_at,
        lic.created_at ? new Date(lic.created_at).toISOString() : '',
        lic.activated_at ? new Date(lic.activated_at).toISOString() : '',
        `"${(lic.notes || '').replace(/"/g, '""')}"`,
      ].join(',')
    }).join('\n')

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename=billeasy_licenses_${today}.csv`)
    res.send(csvHeader + csvRows)
  } catch (err) {
    console.error('[EXPORT ERROR]', err)
    res.status(500).json({ error: 'Failed to export licenses' })
  }
})

module.exports = router
