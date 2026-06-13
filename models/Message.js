const mongoose=require('mongoose')
const { text } = require('node:stream/consumers')

const messageSchema= new mongoose.Schema({

    senderId:{
      type:mongoose.Schema.Types.ObjectId,
      ref:'User',
      required:true

    },

    receiverId:{
     type:mongoose.Schema.Types.ObjectId,
     ref:'User',
     required:true
    },
    text:{
        type:String,
        required:true,
        maxlength:1000
    },
    isRead:{
        type:Boolean,
        default:false,
    },
    createAt:{
        type:Date,
        default:Date.now
    }
    ,
})

module.exports= mongoose.model('Message',messageSchema)