const mongoose= require('mongoose');
require('dotenv').config()
const connectDB= async ()=>{

try {
  await mongoose.connect(process.env.MONGO_URI),console.log("Mongoose Connected ")
} catch (
  err
) {
  console.log('error failed to connect',err

  )
  process.exit(1);
}

}

module.exports= connectDB;