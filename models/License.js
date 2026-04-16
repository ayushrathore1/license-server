const mongoose = require('mongoose')

const licenseSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  vendor_name: {
    type: String,
    default: 'Unknown Vendor',
  },
  vendor_phone: {
    type: String,
    default: '',
  },
  vendor_email: {
    type: String,
    default: '',
  },
  machine_id: {
    type: String,
    default: null,
  },
  expires_at: {
    type: String,
    default: '2099-12-31',
  },
  active: {
    type: Boolean,
    default: true,
  },
  notes: {
    type: String,
    default: '',
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  activated_at: {
    type: Date,
    default: null,
  },
})

// Virtual: compute status from fields
licenseSchema.virtual('status').get(function () {
  if (!this.active) return 'deactivated'
  const today = new Date().toISOString().slice(0, 10)
  if (this.expires_at < today) return 'expired'
  if (this.machine_id) return 'active'
  return 'pending'
})

// Ensure virtuals are included in JSON/Object output
licenseSchema.set('toJSON', { virtuals: true })
licenseSchema.set('toObject', { virtuals: true })

module.exports = mongoose.model('License', licenseSchema)
