const mongoose = require('mongoose')

const MONGO_URI = 'mongodb+srv://rathoreayush512_db_user:MF9Ts3d6l8b4FngS@cluster0.kkrqo6c.mongodb.net/?appName=Cluster0'

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI)
    console.log('✅ Connected to MongoDB')
    console.log(`   Database: ${MONGO_URI.replace(/\/\/.*@/, '//***@')}`)
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message)
    process.exit(1)
  }
}

module.exports = connectDB
