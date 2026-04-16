const jwt = require('jsonwebtoken')

const JWT_SECRET = 'elytron@krixov'

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token']

  if (!token) {
    return res.status(401).json({ error: 'No authentication token provided' })
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.admin = decoded
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' })
  }
}

module.exports = adminAuth
