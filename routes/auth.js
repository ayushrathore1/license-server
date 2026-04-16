const express = require('express')
const jwt = require('jsonwebtoken')
const router = express.Router()

const ADMIN_SECRET = 'changeme'
const JWT_SECRET = 'changeme'
const TOKEN_EXPIRY = '24h'

// POST /admin/login — verify admin secret and return JWT
router.post('/login', (req, res) => {
  const { secret } = req.body

  if (!secret) {
    return res.status(400).json({ valid: false, message: 'Secret is required.' })
  }

  if (secret === ADMIN_SECRET) {
    const token = jwt.sign(
      { role: 'admin', iat: Math.floor(Date.now() / 1000) },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    )

    res.json({ valid: true, token })
  } else {
    res.status(401).json({ valid: false, message: 'Invalid admin secret.' })
  }
})

module.exports = router
