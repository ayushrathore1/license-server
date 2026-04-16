const express = require('express')
const License = require('../models/License')
const ActivityLog = require('../models/ActivityLog')
const router = express.Router()

// POST /validate — called by BillEasy desktop app
router.post('/', async (req, res) => {
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

      await ActivityLog.create({
        action: 'ACTIVATE',
        license_key: key,
        details: `Auto-activated on machine ${machine_id.substring(0, 16)}...`,
      })

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
  } catch (err) {
    console.error('[VALIDATE ERROR]', err)
    res.status(500).json({ valid: false, message: 'Server error during validation.' })
  }
})

module.exports = router
