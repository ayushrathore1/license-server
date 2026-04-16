const mongoose = require('mongoose')

const activityLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: ['CREATE', 'ACTIVATE', 'DEACTIVATE', 'ENABLE', 'UNBIND', 'DELETE', 'RENEW', 'EDIT', 'BULK_CREATE', 'BULK_TOGGLE', 'BULK_DELETE'],
  },
  license_key: {
    type: String,
    default: null,
  },
  details: {
    type: String,
    default: '',
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
})

// Index for fast queries on recent activity
activityLogSchema.index({ timestamp: -1 })

module.exports = mongoose.model('ActivityLog', activityLogSchema)
